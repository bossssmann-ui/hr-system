import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { EmailChannel, type SmtpTransport } from '../../integrations/messaging/email.channel'
import { createAssessmentProvider, type AssessmentProvider, type ScoringProvider } from '../../integrations/llm'
import { findOrCreateConversation } from '../messaging/messaging.service'
import { buildInterviewQuestionInput } from '../assessments/assessments.service'
import { scoreApplication } from '../scoring/scoring.service'

type SendQuestionnaireInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId: string
  transport?: SmtpTransport
}

type ProcessQuestionnaireReplyInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  fromEmail?: string
  body: string
  externalId?: string
  provider?: AssessmentProvider
  scoringProvider?: ScoringProvider
}

export async function sendCandidateQuestionnaire(input: SendQuestionnaireInput) {
  const snapshot = await loadApplicationSnapshot(input.prisma, input.applicationId)
  if (!snapshot) return { ok: false as const, reason: 'application_not_found' as const }
  if (!snapshot.candidate.email) return { ok: false as const, reason: 'candidate_email_missing' as const }

  const questions = currentQuestionnaireQuestions(snapshot.aiScoring, snapshot.aiInterviewQuestions)
  if (questions.length === 0) return { ok: false as const, reason: 'questions_missing' as const }

  if (!input.env.EMAIL_ENABLED || !input.env.SMTP_HOST || !input.env.SMTP_PORT || !input.env.SMTP_FROM) {
    return { ok: false as const, reason: 'email_not_configured' as const }
  }

  const { conversation } = await findOrCreateConversation({
    prisma: input.prisma,
    tenantId: snapshot.tenantId,
    candidateId: snapshot.candidateId,
    applicationId: snapshot.id,
    subject: `Уточняющие вопросы по вакансии ${snapshot.vacancy.title}`,
  })

  const subject = `Уточняющие вопросы по вакансии ${snapshot.vacancy.title}`
  const body = buildQuestionnaireEmailBody({
    candidateName: snapshot.candidate.fullName,
    vacancyTitle: snapshot.vacancy.title,
    applicationId: snapshot.id,
    questions,
  })

  const message = await input.prisma.message.create({
    data: {
      tenantId: snapshot.tenantId,
      conversationId: conversation.id,
      channel: 'email',
      direction: 'outbound',
      body,
      senderUserId: input.actorUserId,
      status: 'queued',
    },
  })

  const channel = new EmailChannel({
    host: input.env.SMTP_HOST,
    port: input.env.SMTP_PORT,
    from: input.env.SMTP_FROM,
    user: input.env.SMTP_USER,
    pass: input.env.SMTP_PASS,
    transport: input.transport,
  })
  const delivery = await channel.send({
    destination: snapshot.candidate.email,
    subject,
    body,
  })

  await input.prisma.message.update({
    where: { id: message.id },
    data: {
      externalId: delivery.externalId,
      status: delivery.status === 'sent' ? 'sent' : 'failed',
      sentAt: delivery.status === 'sent' ? new Date() : null,
    },
  })
  await input.prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  await input.prisma.application.update({
    where: { id: snapshot.id },
    data: {
      externalIds: {
        ...asRecord(snapshot.externalIds),
        candidate_questionnaire: {
          status: delivery.status === 'sent' ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          message_id: message.id,
          question_count: questions.length,
          input_hash: asRecord(snapshot.aiScoring)?.input_hash,
        },
      } as Prisma.InputJsonValue,
    },
  })

  await input.prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId: input.actorUserId,
      action: 'application.questionnaire_sent',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        channel: 'email',
        question_count: questions.length,
        delivery_status: delivery.status,
      } as Prisma.InputJsonValue,
    },
  })

  if (delivery.status !== 'sent') {
    return { ok: false as const, reason: 'email_send_failed' as const, messageId: message.id }
  }

  return { ok: true as const, messageId: message.id, questionCount: questions.length }
}

export async function processCandidateQuestionnaireReply(input: ProcessQuestionnaireReplyInput) {
  const snapshot = await loadApplicationSnapshot(input.prisma, input.applicationId)
  if (!snapshot) return { ok: false as const, reason: 'application_not_found' as const }

  if (input.fromEmail && snapshot.candidate.email && normalizeEmail(input.fromEmail) !== normalizeEmail(snapshot.candidate.email)) {
    return { ok: false as const, reason: 'sender_mismatch' as const }
  }

  const duplicate = input.externalId
    ? await input.prisma.message.findFirst({
        where: { tenantId: snapshot.tenantId, channel: 'email', externalId: input.externalId },
      })
    : null
  if (duplicate) return { ok: true as const, duplicate: true as const, messageId: duplicate.id }

  const { conversation } = await findOrCreateConversation({
    prisma: input.prisma,
    tenantId: snapshot.tenantId,
    candidateId: snapshot.candidateId,
    applicationId: snapshot.id,
    subject: `Уточняющие вопросы по вакансии ${snapshot.vacancy.title}`,
  })

  const message = await input.prisma.message.create({
    data: {
      tenantId: snapshot.tenantId,
      conversationId: conversation.id,
      channel: 'email',
      direction: 'inbound',
      body: input.body,
      externalId: input.externalId ?? null,
      status: 'received',
      sentAt: new Date(),
    },
  })
  await input.prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  if (!input.env.AI_SCORING_ENABLED || !input.env.LLM_SCORING_API_KEY) {
    return { ok: false as const, reason: 'ai_not_configured' as const, messageId: message.id }
  }

  const latestResume = await input.prisma.resume.findFirst({
    where: { tenantId: snapshot.tenantId, candidateId: snapshot.candidateId, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { parsedPayload: true },
  })
  const providerInput = buildInterviewQuestionInput(snapshot, latestResume?.parsedPayload)
  const questions = currentQuestionnaireQuestions(snapshot.aiScoring, snapshot.aiInterviewQuestions)
  const provider = input.provider ?? createAssessmentProvider(input.env)
  const enrichment = await provider.extractResumeEnrichment({
    vacancyProfile: providerInput.vacancyProfile,
    candidateResume: providerInput.candidateResume,
    questions,
    answer: input.body,
  })

  await input.prisma.candidate.update({
    where: { id: snapshot.candidateId },
    data: {
      externalIds: {
        ...asRecord(snapshot.candidate.externalIds),
        ai_questionnaire_enrichment: {
          ...enrichment,
          application_id: snapshot.id,
          source_message_id: message.id,
          updated_at: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  })

  await input.prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId: null,
      action: 'application.questionnaire_reply_processed',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        message_id: message.id,
        facts: enrichment.facts.length,
        contradictions: enrichment.contradictions.length,
        confidence: enrichment.confidence,
      } as Prisma.InputJsonValue,
    },
  })

  const scoring = await scoreApplication({
    prisma: input.prisma,
    env: input.env,
    applicationId: snapshot.id,
    force: true,
    provider: input.scoringProvider,
  })

  return {
    ok: true as const,
    duplicate: false as const,
    messageId: message.id,
    enrichment,
    scoring,
  }
}

function buildQuestionnaireEmailBody(input: {
  candidateName: string
  vacancyTitle: string
  applicationId: string
  questions: string[]
}) {
  return [
    `${input.candidateName}, добрый день.`,
    '',
    `Спасибо за отклик на вакансию "${input.vacancyTitle}". Чтобы корректно оценить ваш опыт, пожалуйста, ответьте на несколько уточняющих вопросов:`,
    '',
    ...input.questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    `Пожалуйста, ответьте прямо на это письмо, сохранив код отклика: ${input.applicationId}`,
  ].join('\n')
}

function currentQuestionnaireQuestions(aiScoring: unknown, aiInterviewQuestions: unknown) {
  const scoringQuestions = asStringArray(asRecord(asRecord(aiScoring)?.result)?.interview_questions)
  if (scoringQuestions.length > 0) return scoringQuestions

  if (!Array.isArray(aiInterviewQuestions)) return []
  return aiInterviewQuestions
    .map((item) => asRecord(item)?.question)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

async function loadApplicationSnapshot(prisma: DbClient, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId },
    include: {
      candidate: true,
      vacancy: {
        include: { requisition: true },
      },
    },
  })
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
