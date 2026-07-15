/**
 * AI clarification loop — mid-band score → gap questions → candidate reply → force rescore.
 *
 * Enabled only when BOTH env `CLARIFICATION_LOOP_ENABLED` and tenant
 * `featureFlags.clarification` (or nested `clarification.enabled`) are true.
 */
import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { MessageChannelAdapter } from '../../integrations/messaging'
import {
  findOrCreateConversation,
  getChannelAdapter,
} from '../messaging/messaging.service'
import { enqueueMessageSend } from '../messaging/messaging.queue'
import {
  resolveDestination,
  resolveHhAccessToken,
  resolvePreferredChannel,
} from '../selection/auto-selection-after-scoring'

export const AUTO_SCREEN_THRESHOLD = 60
export const MAX_AUTO_CLARIFICATION_ROUNDS = 1
export const MAX_TOTAL_CLARIFICATION_ROUNDS = 3

export type AiClarificationStatus = 'sent' | 'answered' | 'rescored'

export type AiClarificationState = {
  status: AiClarificationStatus
  channel: string
  questions: string[]
  answers?: Array<{ question: string; answer: string }>
  sentAt: string
  answeredAt?: string
  roundCount: number
  rescoredAt?: string
}

type ClarificationMode = 'auto' | 'manual'

type SendClarificationInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  mode: ClarificationMode
  /** Injectable question generator (tests). */
  generateQuestions?: (gaps: string[], companyName?: string | null) => Promise<string[]>
  /** Injectable adapter (tests). */
  adapter?: MessageChannelAdapter
  /** Injectable clock (tests / quiet hours). */
  now?: () => Date
}

type MaybeAutoClarificationInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  relevanceScore: number
  generateQuestions?: SendClarificationInput['generateQuestions']
  adapter?: MessageChannelAdapter
  now?: () => Date
}

type HandleInboundClarificationInput = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  candidateId: string
  conversationApplicationId: string | null
  body: string
  enqueueRescore?: (input: {
    prisma: DbClient
    env: AppEnv
    applicationId: string
    force?: boolean
  }) => Promise<unknown>
}

/**
 * Tenant clarification flag AND global env must both be on.
 * Accepts flat `clarification: true` or nested `{ clarification: { enabled: true } }`.
 */
export function isClarificationLoopEnabled(featureFlags: unknown, env: Pick<AppEnv, 'CLARIFICATION_LOOP_ENABLED'>): boolean {
  if (!env.CLARIFICATION_LOOP_ENABLED) return false
  return readTenantClarificationFlag(featureFlags) === true
}

export function readTenantClarificationFlag(featureFlags: unknown): boolean | null {
  if (featureFlags === null || typeof featureFlags !== 'object' || Array.isArray(featureFlags)) {
    return null
  }
  const record = featureFlags as Record<string, unknown>
  if (typeof record.clarification === 'boolean') return record.clarification
  const nested = record.clarification
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    const enabled = (nested as Record<string, unknown>).enabled
    if (typeof enabled === 'boolean') return enabled
  }
  return null
}

export function isScoreInClarificationBand(
  score: number,
  env: Pick<AppEnv, 'CLARIFICATION_MIN_SCORE'>,
  autoScreenThreshold = AUTO_SCREEN_THRESHOLD,
): boolean {
  return score >= env.CLARIFICATION_MIN_SCORE && score < autoScreenThreshold
}

export function parseAiClarification(value: unknown): AiClarificationState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const status = record.status
  if (status !== 'sent' && status !== 'answered' && status !== 'rescored') return null
  if (!Array.isArray(record.questions)) return null
  const questions = record.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
  if (questions.length === 0) return null
  if (typeof record.channel !== 'string' || typeof record.sentAt !== 'string') return null
  const roundCount = typeof record.roundCount === 'number' && Number.isFinite(record.roundCount) ? record.roundCount : 0

  const answers = Array.isArray(record.answers)
    ? record.answers
        .map((item) => {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
          const row = item as Record<string, unknown>
          if (typeof row.question !== 'string' || typeof row.answer !== 'string') return null
          return { question: row.question, answer: row.answer }
        })
        .filter((item): item is { question: string; answer: string } => Boolean(item))
    : undefined

  return {
    status,
    channel: record.channel,
    questions,
    answers,
    sentAt: record.sentAt,
    answeredAt: typeof record.answeredAt === 'string' ? record.answeredAt : undefined,
    roundCount,
    rescoredAt: typeof record.rescoredAt === 'string' ? record.rescoredAt : undefined,
  }
}

export function buildClarificationQuestionsFromGaps(gaps: string[]): string[] {
  const cleaned = gaps.map((g) => g.trim()).filter(Boolean)
  if (cleaned.length === 0) {
    return [
      'Расскажите, пожалуйста, о конкретном опыте, релевантном этой вакансии: задачи, обязанности, сроки и результаты.',
      'Какими системами, инструментами или процессами вы пользовались в этой работе? Приведите примеры.',
      'Опишите один недавний кейс с цифрами или измеримым результатом (объёмы, сроки, KPI).',
    ]
  }

  return cleaned.slice(0, 5).map((gap) => {
    const trimmed = gap.replace(/\s+/g, ' ').trim()
    if (/[?？]$/.test(trimmed)) return trimmed
    return `Уточните, пожалуйста: ${trimmed}. Приведите конкретику — годы, объёмы, системы или пример.`
  })
}

export function buildClarificationMessageBody(input: {
  candidateName: string | null
  vacancyTitle: string
  companyName?: string | null
  questions: string[]
}): string {
  const greeting = input.candidateName ? `Здравствуйте, ${input.candidateName}!` : 'Здравствуйте!'
  const company = input.companyName?.trim() || null
  const intro = company
    ? `Команда ${company} рассматривает ваш отклик на вакансию «${input.vacancyTitle}» и просит уточнить несколько деталей.`
    : `Мы рассматриваем ваш отклик на вакансию «${input.vacancyTitle}» и просим уточнить несколько деталей.`

  const lines = input.questions.map((q, i) => `${i + 1}. ${q}`)
  return [
    greeting,
    '',
    intro,
    '',
    'Пожалуйста, ответьте по пунктам одним сообщением:',
    ...lines,
    '',
    'Спасибо! Это поможет быстрее продолжить рассмотрение.',
  ].join('\n')
}

export function canAutoSendClarification(input: {
  stage: string
  score: number
  clarification: AiClarificationState | null
  featureFlags: unknown
  env: AppEnv
  hasChannel: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (!isClarificationLoopEnabled(input.featureFlags, input.env)) {
    return { ok: false, reason: 'disabled' }
  }
  if (input.stage === 'hired' || input.stage === 'rejected') {
    return { ok: false, reason: 'terminal_stage' }
  }
  if (!isScoreInClarificationBand(input.score, input.env)) {
    return { ok: false, reason: 'score_out_of_band' }
  }
  if (!input.hasChannel) {
    return { ok: false, reason: 'channel_unavailable' }
  }
  const rounds = input.clarification?.roundCount ?? 0
  if (rounds >= MAX_AUTO_CLARIFICATION_ROUNDS) {
    return { ok: false, reason: 'auto_round_used' }
  }
  if (input.clarification?.status === 'sent') {
    return { ok: false, reason: 'awaiting_answer' }
  }
  return { ok: true }
}

export function canManualSendClarification(input: {
  stage: string
  clarification: AiClarificationState | null
  featureFlags: unknown
  env: AppEnv
  hasChannel: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (!isClarificationLoopEnabled(input.featureFlags, input.env)) {
    return { ok: false, reason: 'disabled' }
  }
  if (input.stage === 'hired' || input.stage === 'rejected') {
    return { ok: false, reason: 'terminal_stage' }
  }
  if (!input.hasChannel) {
    return { ok: false, reason: 'channel_unavailable' }
  }
  if (input.clarification?.status === 'sent') {
    return { ok: false, reason: 'awaiting_answer' }
  }
  const rounds = input.clarification?.roundCount ?? 0
  if (rounds >= MAX_TOTAL_CLARIFICATION_ROUNDS) {
    return { ok: false, reason: 'max_rounds' }
  }
  return { ok: true }
}

export async function maybeAutoSendClarification(input: MaybeAutoClarificationInput) {
  if (!isScoreInClarificationBand(input.relevanceScore, input.env)) {
    return { ok: false as const, reason: 'score_out_of_band' as const }
  }
  return sendClarification({
    prisma: input.prisma,
    env: input.env,
    applicationId: input.applicationId,
    actorUserId: input.actorUserId,
    mode: 'auto',
    generateQuestions: input.generateQuestions,
    adapter: input.adapter,
    now: input.now,
  })
}

export async function sendClarification(input: SendClarificationInput) {
  const snapshot = await input.prisma.application.findFirst({
    where: { id: input.applicationId },
    include: {
      candidate: true,
      vacancy: true,
    },
  })
  if (!snapshot) return { ok: false as const, reason: 'application_not_found' as const }

  const tenantSettings = await input.prisma.tenantSettings.findUnique({
    where: { tenantId: snapshot.tenantId },
    select: { featureFlags: true },
  })

  const clarification = parseAiClarification(snapshot.aiClarification)
  const channel = resolvePreferredChannel(snapshot.externalIds, snapshot.candidate.externalIds)
  const destination = resolveDestination(
    channel,
    snapshot.externalIds,
    snapshot.candidate.externalIds,
    snapshot.candidate.email,
  )
  const hasChannel = Boolean(destination)

  const gate =
    input.mode === 'auto'
      ? canAutoSendClarification({
          stage: snapshot.stage,
          score: readCurrentRelevanceScore(snapshot.aiScoring),
          clarification,
          featureFlags: tenantSettings?.featureFlags,
          env: input.env,
          hasChannel,
        })
      : canManualSendClarification({
          stage: snapshot.stage,
          clarification,
          featureFlags: tenantSettings?.featureFlags,
          env: input.env,
          hasChannel,
        })

  if (!gate.ok) return { ok: false as const, reason: gate.reason }

  if (!destination) return { ok: false as const, reason: 'channel_unavailable' as const }

  const gaps = readGaps(snapshot.aiScoring)
  const questions =
    (await input.generateQuestions?.(gaps, null)) ?? buildClarificationQuestionsFromGaps(gaps)
  if (questions.length === 0) return { ok: false as const, reason: 'questions_missing' as const }

  const actorUserId =
    input.actorUserId ?? (await findAutomationActorUserId(input.prisma, snapshot.tenantId))
  if (!actorUserId) return { ok: false as const, reason: 'automation_actor_missing' as const }

  const { conversation } = await findOrCreateConversation({
    prisma: input.prisma,
    tenantId: snapshot.tenantId,
    candidateId: snapshot.candidateId,
    applicationId: snapshot.id,
    subject: `Уточнения по вакансии ${snapshot.vacancy.title}`,
  })

  if (conversation.applicationId !== snapshot.id) {
    await input.prisma.conversation.update({
      where: { id: conversation.id },
      data: { applicationId: snapshot.id },
    })
  }

  const body = buildClarificationMessageBody({
    candidateName: snapshot.candidate.fullName,
    vacancyTitle: snapshot.vacancy.title,
    questions,
  })

  const message = await input.prisma.message.create({
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

  await input.prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  const hhAccessToken = await resolveHhAccessToken(input.prisma, input.env, snapshot.tenantId)
  const adapter =
    input.adapter ?? getChannelAdapter(channel, input.env, hhAccessToken ?? undefined)
  if (!adapter) {
    await input.prisma.message.update({ where: { id: message.id }, data: { status: 'failed' } })
    return { ok: false as const, reason: 'channel_not_available' as const }
  }

  await enqueueMessageSend({
    prisma: input.prisma,
    env: input.env,
    messageId: message.id,
    channel,
    destination,
    body,
    subject: `Уточнения по вакансии ${snapshot.vacancy.title}`,
    automated: input.mode === 'auto',
    adapter,
    now: input.now,
  })

  const nextRound = (clarification?.roundCount ?? 0) + 1
  const sentAt = (input.now?.() ?? new Date()).toISOString()
  const nextState: AiClarificationState = {
    status: 'sent',
    channel,
    questions,
    sentAt,
    roundCount: nextRound,
  }

  await input.prisma.application.update({
    where: { id: snapshot.id },
    data: { aiClarification: nextState as Prisma.InputJsonValue },
  })

  await input.prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId,
      action: 'application.clarification_sent',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        mode: input.mode,
        channel,
        question_count: questions.length,
        round_count: nextRound,
        message_id: message.id,
      } as Prisma.InputJsonValue,
    },
  })

  return {
    ok: true as const,
    messageId: message.id,
    questionCount: questions.length,
    channel,
    clarification: nextState,
  }
}

/**
 * After an inbound message: if the linked application awaits clarification, store the reply
 * and enqueue a forced rescore.
 */
export async function handleInboundClarificationReply(input: HandleInboundClarificationInput) {
  const application = await findClarificationAwaitingApplication(input)
  if (!application) return { handled: false as const }

  const clarification = parseAiClarification(application.aiClarification)
  if (!clarification || clarification.status !== 'sent') {
    return { handled: false as const }
  }

  const answers = clarification.questions.map((question) => ({
    question,
    answer: input.body.trim(),
  }))
  const answeredAt = new Date().toISOString()
  const nextState: AiClarificationState = {
    ...clarification,
    status: 'answered',
    answers,
    answeredAt,
  }

  await input.prisma.application.update({
    where: { id: application.id },
    data: { aiClarification: nextState as Prisma.InputJsonValue },
  })

  await input.prisma.auditEvent.create({
    data: {
      tenantId: application.tenantId,
      actorUserId: null,
      action: 'application.clarification_answered',
      entityType: 'Application',
      entityId: application.id,
      diff: {
        round_count: clarification.roundCount,
        answer_length: input.body.trim().length,
      } as Prisma.InputJsonValue,
    },
  })

  const enqueue =
    input.enqueueRescore ??
    (async (job) => {
      const { enqueueApplicationScoringJob } = await import('../scoring/scoring.queue')
      return enqueueApplicationScoringJob(job)
    })
  await enqueue({
    prisma: input.prisma,
    env: input.env,
    applicationId: application.id,
    force: true,
  })

  return { handled: true as const, applicationId: application.id, clarification: nextState }
}

export async function markClarificationRescored(input: {
  prisma: DbClient
  applicationId: string
  now?: () => Date
}) {
  const row = await input.prisma.application.findFirst({
    where: { id: input.applicationId },
    select: { aiClarification: true },
  })
  if (!row) return { updated: false as const }

  const clarification = parseAiClarification(row.aiClarification)
  if (!clarification || clarification.status !== 'answered') {
    return { updated: false as const }
  }

  const nextState: AiClarificationState = {
    ...clarification,
    status: 'rescored',
    rescoredAt: (input.now?.() ?? new Date()).toISOString(),
  }

  await input.prisma.application.update({
    where: { id: input.applicationId },
    data: { aiClarification: nextState as Prisma.InputJsonValue },
  })

  return { updated: true as const, clarification: nextState }
}

async function findClarificationAwaitingApplication(input: HandleInboundClarificationInput) {
  if (input.conversationApplicationId) {
    const byConversation = await input.prisma.application.findFirst({
      where: {
        id: input.conversationApplicationId,
        tenantId: input.tenantId,
        candidateId: input.candidateId,
      },
      select: { id: true, tenantId: true, aiClarification: true },
    })
    if (byConversation && parseAiClarification(byConversation.aiClarification)?.status === 'sent') {
      return byConversation
    }
  }

  const candidates = await input.prisma.application.findMany({
    where: {
      tenantId: input.tenantId,
      candidateId: input.candidateId,
      stage: { notIn: ['hired', 'rejected'] },
    },
    select: { id: true, tenantId: true, aiClarification: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })

  return candidates.find((row) => parseAiClarification(row.aiClarification)?.status === 'sent') ?? null
}

function readGaps(aiScoring: unknown): string[] {
  const scoring = asRecord(aiScoring)
  const result = asRecord(scoring?.result) ?? asRecord(asRecord(scoring?.previous_scoring)?.result)
  if (!result || !Array.isArray(result.gaps)) return []
  return result.gaps.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
}

function readCurrentRelevanceScore(aiScoring: unknown): number {
  const scoring = asRecord(aiScoring)
  const result = asRecord(scoring?.result)
  const score = result?.relevance_score
  return typeof score === 'number' && Number.isFinite(score) ? score : -1
}

async function findAutomationActorUserId(prisma: DbClient, tenantId: string) {
  const user = await prisma.user.findFirst({
    where: {
      tenantId,
      role: { in: ['owner', 'hr_admin', 'recruiter'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return user?.id ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
