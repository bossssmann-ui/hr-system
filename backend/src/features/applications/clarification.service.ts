/**
 * AI Clarification Loop — Phase N.
 *
 * Sends gap-based clarification questions to candidates whose AI score falls
 * in the clarification band (CLARIFICATION_MIN_SCORE ≤ score < AUTO_SCREEN_THRESHOLD).
 * Processes inbound answers, updates `aiClarification` JSON on the application,
 * and triggers a forced re-score so the updated evidence is captured.
 *
 * Feature gates:
 *   - env:    CLARIFICATION_LOOP_ENABLED=true
 *   - tenant: featureFlags.clarification=true (via resolvePipelineFlag)
 * Both must be enabled for automated triggers. Manual sends via the API bypass
 * the auto-trigger check but still enforce the guard (no send to hired/rejected).
 */

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createAssessmentProvider, type AssessmentProvider } from '../../integrations/llm'
import { getChannelAdapter } from '../messaging/messaging.service'
import { findOrCreateConversation } from '../messaging/messaging.service'
import { resolvePipelineFlag } from '../tenant/resolve-pipeline-flag'
import { enqueueApplicationScoringJob } from '../scoring/scoring.queue'
import {
  resolvePreferredChannel,
  resolveDestination,
  resolveHhAccessToken,
} from '../selection/auto-selection-after-scoring'

const AUTO_SCREEN_THRESHOLD = 60
const MAX_CLARIFICATION_ROUNDS = 3
const TERMINAL_STAGES = new Set(['hired', 'rejected'])

// ─── Types ───────────────────────────────────────────────────────────────────

type SendClarificationInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId: string
  /** When true, skips automatic-trigger guards (score band, round limit, flags).
   *  Rounds still cap at MAX_CLARIFICATION_ROUNDS. */
  manual?: boolean
  provider?: AssessmentProvider
  /** Optional injected channel adapter — used in tests to avoid real network calls. */
  channelAdapter?: import('../../integrations/messaging').MessageChannelAdapter
}

type HandleClarificationAnswerInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  answer: string
  actorUserId?: string
}

type MaybeTriggerInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  relevanceScore: number
  actorUserId?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function parseClarification(value: unknown): {
  status: string
  channel: string
  questions: string[]
  sentAt: string
  answers?: string[]
  answeredAt?: string | null
  rounds?: number
} | null {
  const record = asRecord(value)
  if (typeof record.status !== 'string') return null
  return {
    status: record.status as string,
    channel: typeof record.channel === 'string' ? record.channel : '',
    questions: asStringArray(record.questions),
    sentAt: typeof record.sentAt === 'string' ? record.sentAt : new Date().toISOString(),
    answers: asStringArray(record.answers),
    answeredAt: typeof record.answeredAt === 'string' ? record.answeredAt : null,
    rounds: typeof record.rounds === 'number' ? record.rounds : 0,
  }
}

// ─── Send clarification questions ────────────────────────────────────────────

export async function sendAiClarification(input: SendClarificationInput) {
  const { prisma, env, applicationId, actorUserId, manual = false } = input

  const snapshot = await prisma.application.findFirst({
    where: { id: applicationId },
    include: {
      candidate: true,
      vacancy: {
        include: { requisition: true },
      },
    },
  })
  if (!snapshot) {
    return { ok: false as const, reason: 'application_not_found' as const }
  }

  // Guard: no send to terminal stages.
  if (TERMINAL_STAGES.has(snapshot.stage)) {
    return { ok: false as const, reason: 'terminal_stage' as const }
  }

  const existingClarification = parseClarification(snapshot.aiClarification)
  const currentRounds = existingClarification?.rounds ?? 0

  // Guard: max rounds limit.
  if (currentRounds >= MAX_CLARIFICATION_ROUNDS) {
    return { ok: false as const, reason: 'max_rounds_reached' as const }
  }

  // Guard: for auto-triggers, only one auto-round is allowed (manual can send more).
  if (!manual && currentRounds >= 1) {
    return { ok: false as const, reason: 'auto_round_already_sent' as const }
  }

  // Resolve channel + destination.
  const channel = resolvePreferredChannel(snapshot.externalIds, snapshot.candidate.externalIds)
  const hhAccessToken = channel === 'hh_chat'
    ? await resolveHhAccessToken(prisma, env, snapshot.tenantId)
    : null
  const adapter = input.channelAdapter ?? getChannelAdapter(channel, env, hhAccessToken ?? undefined)
  if (!adapter) {
    return { ok: false as const, reason: 'channel_unavailable' as const }
  }

  const destination = resolveDestination(channel, snapshot.externalIds, snapshot.candidate.externalIds, snapshot.candidate.email)
  if (!destination) {
    return { ok: false as const, reason: 'destination_unavailable' as const }
  }

  // Extract gaps from latest scoring result.
  const aiScoring = asRecord(snapshot.aiScoring)
  const result = asRecord(aiScoring.result)
  const gaps = asStringArray(result.gaps)

  if (gaps.length === 0) {
    return { ok: false as const, reason: 'no_gaps_in_scoring' as const }
  }

  // Generate questions based on gaps.
  const provider = input.provider ?? createAssessmentProvider(env)
  const generated = await provider.generateClarificationQuestions({
    vacancyTitle: snapshot.vacancy.title,
    gaps,
  })

  if (generated.questions.length === 0) {
    return { ok: false as const, reason: 'question_generation_failed' as const }
  }

  // Create/find conversation linked to this application.
  const { conversation } = await findOrCreateConversation({
    prisma,
    tenantId: snapshot.tenantId,
    candidateId: snapshot.candidateId,
    applicationId: snapshot.id,
    subject: `Уточняющие вопросы по вакансии ${snapshot.vacancy.title}`,
  })

  const body = buildClarificationMessageBody({
    candidateName: snapshot.candidate.fullName,
    vacancyTitle: snapshot.vacancy.title,
    questions: generated.questions,
  })

  // Create message row.
  const message = await prisma.message.create({
    data: {
      tenantId: snapshot.tenantId,
      conversationId: conversation.id,
      channel: channel as never,
      direction: 'outbound',
      body,
      senderUserId: actorUserId,
      status: 'queued',
    },
  })

  // Send immediately via adapter (quiet hours managed by messaging queue for
  // automated sends; here we send directly and mark the message status).
  let deliveryStatus: 'sent' | 'failed' = 'failed'
  let externalId: string | undefined
  try {
    const deliveryResult = await adapter.send({
      destination,
      body,
      subject: `Уточняющие вопросы: ${snapshot.vacancy.title}`,
    })
    deliveryStatus = deliveryResult.status === 'sent' ? 'sent' : 'failed'
    externalId = deliveryResult.externalId ?? undefined
  } catch {
    deliveryStatus = 'failed'
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: deliveryStatus,
      externalId: externalId ?? null,
      sentAt: deliveryStatus === 'sent' ? new Date() : null,
    },
  })
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  if (deliveryStatus !== 'sent') {
    return { ok: false as const, reason: 'delivery_failed' as const, messageId: message.id }
  }

  // Persist clarification state on the application.
  const newClarification = {
    status: 'sent',
    channel,
    questions: generated.questions,
    sentAt: new Date().toISOString(),
    rounds: currentRounds + 1,
  }

  await prisma.application.update({
    where: { id: snapshot.id },
    data: { aiClarification: newClarification as Prisma.InputJsonValue },
  })

  await prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId,
      action: 'application.clarification_sent',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        channel,
        question_count: generated.questions.length,
        round: currentRounds + 1,
        manual,
      } as Prisma.InputJsonValue,
    },
  })

  return {
    ok: true as const,
    messageId: message.id,
    questionCount: generated.questions.length,
    channel,
  }
}

// ─── Handle inbound clarification answer ─────────────────────────────────────

export async function handleClarificationAnswer(input: HandleClarificationAnswerInput) {
  const { prisma, env, applicationId, answer, actorUserId } = input

  const snapshot = await prisma.application.findFirst({
    where: { id: applicationId },
    select: {
      id: true,
      tenantId: true,
      aiClarification: true,
      stage: true,
    },
  })
  if (!snapshot) {
    return { ok: false as const, reason: 'application_not_found' as const }
  }

  const clarification = parseClarification(snapshot.aiClarification)
  if (!clarification || clarification.status !== 'sent') {
    return { ok: false as const, reason: 'no_pending_clarification' as const }
  }

  const existingAnswers = clarification.answers ?? []
  const updatedClarification = {
    ...clarification,
    status: 'answered',
    answers: [...existingAnswers, answer],
    answeredAt: new Date().toISOString(),
  }

  await prisma.application.update({
    where: { id: snapshot.id },
    data: { aiClarification: updatedClarification as Prisma.InputJsonValue },
  })

  await prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId: actorUserId ?? null,
      action: 'application.clarification_answered',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        answer_length: answer.length,
        round: clarification.rounds ?? 1,
      } as Prisma.InputJsonValue,
    },
  })

  // Trigger forced re-score to incorporate the clarification answer.
  const queueResult = await enqueueApplicationScoringJob({
    prisma,
    env,
    applicationId: snapshot.id,
    actorUserId: actorUserId ?? undefined,
    force: true,
  })

  return { ok: true as const, queued: queueResult.queued }
}

// ─── Auto-trigger after scoring ──────────────────────────────────────────────

/**
 * Called from `scoreApplication` after a successful score.
 * Checks all guards and, if eligible, sends clarification questions.
 */
export async function maybeTriggerClarificationAfterScoring(input: MaybeTriggerInput) {
  const { prisma, env, applicationId, relevanceScore, actorUserId } = input

  // Fast exit: env flag off.
  if (!env.CLARIFICATION_LOOP_ENABLED) {
    return { triggered: false as const, reason: 'env_disabled' as const }
  }

  const minScore = env.CLARIFICATION_MIN_SCORE

  // Score outside clarification band.
  if (relevanceScore < minScore || relevanceScore >= AUTO_SCREEN_THRESHOLD) {
    return { triggered: false as const, reason: 'score_out_of_band' as const }
  }

  const application = await prisma.application.findFirst({
    where: { id: applicationId },
    select: {
      id: true,
      tenantId: true,
      stage: true,
      aiClarification: true,
      externalIds: true,
      candidate: { select: { email: true, externalIds: true } },
    },
  })
  if (!application) {
    return { triggered: false as const, reason: 'application_not_found' as const }
  }

  // Check tenant feature flag.
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: application.tenantId },
    select: { featureFlags: true },
  })
  if (!resolvePipelineFlag('clarification', settings?.featureFlags, env)) {
    return { triggered: false as const, reason: 'tenant_flag_disabled' as const }
  }

  // Guard: terminal stage.
  if (TERMINAL_STAGES.has(application.stage)) {
    return { triggered: false as const, reason: 'terminal_stage' as const }
  }

  // Guard: already had an auto-round.
  const existing = parseClarification(application.aiClarification)
  if (existing && (existing.rounds ?? 0) >= 1) {
    return { triggered: false as const, reason: 'auto_round_already_sent' as const }
  }

  // Guard: candidate has no reachable channel.
  const channel = resolvePreferredChannel(application.externalIds, application.candidate.externalIds)
  const hhToken = channel === 'hh_chat'
    ? await resolveHhAccessToken(prisma, env, application.tenantId)
    : null
  const adapter = getChannelAdapter(channel, env, hhToken ?? undefined)
  const destination = resolveDestination(channel, application.externalIds, application.candidate.externalIds, application.candidate.email)
  if (!adapter || !destination) {
    return { triggered: false as const, reason: 'no_channel' as const }
  }

  // All guards passed — find a system actor to attribute the audit event.
  const systemActor = await findSystemActor(prisma, application.tenantId)

  const result = await sendAiClarification({
    prisma,
    env,
    applicationId,
    actorUserId: systemActor ?? 'system',
    manual: false,
  })

  return { triggered: result.ok, reason: result.ok ? undefined : result.reason }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildClarificationMessageBody(input: {
  candidateName: string
  vacancyTitle: string
  questions: string[]
}) {
  return [
    `${input.candidateName}, добрый день!`,
    '',
    `Спасибо за отклик на вакансию «${input.vacancyTitle}». Чтобы точнее оценить ваш опыт, у нас есть несколько уточняющих вопросов:`,
    '',
    ...input.questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Пожалуйста, ответьте в этом чате — мы учтём ваши ответы при дальнейшем рассмотрении.',
  ].join('\n')
}

async function findSystemActor(prisma: DbClient, tenantId: string): Promise<string | null> {
  const actor = await prisma.user.findFirst({
    where: { roles: { some: { tenantId, role: 'owner' } } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  return actor?.id ?? null
}
