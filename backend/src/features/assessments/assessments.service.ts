import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createAssessmentProvider } from '../../integrations/llm'

type GenerateInterviewQuestionsInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId: string
}

export async function generateInterviewQuestions(input: GenerateInterviewQuestionsInput) {
  const { prisma, env, applicationId, actorUserId } = input
  if (!env.AI_SCORING_ENABLED || !env.LLM_SCORING_API_KEY) {
    return { ok: false as const, reason: 'not_configured' as const }
  }

  const snapshot = await prisma.application.findFirst({
    where: { id: applicationId },
    include: {
      candidate: true,
      vacancy: {
        include: { requisition: true },
      },
    },
  })
  if (!snapshot) return { ok: false as const, reason: 'application_not_found' as const }

  const latestResume = await prisma.resume.findFirst({
    where: { tenantId: snapshot.tenantId, candidateId: snapshot.candidateId, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { parsedPayload: true },
  })

  const provider = createAssessmentProvider(env)
  const providerInput = buildInterviewQuestionInput(snapshot, latestResume?.parsedPayload)
  const result = await provider.generateInterviewQuestions(providerInput)

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      aiInterviewQuestions: result.items as Prisma.InputJsonValue,
    },
  })

  await prisma.auditEvent.create({
    data: {
      tenantId: snapshot.tenantId,
      actorUserId,
      action: 'application.questions_generated',
      entityType: 'Application',
      entityId: snapshot.id,
      diff: {
        count: result.items.length,
      } as Prisma.InputJsonValue,
    },
  })

  return { ok: true as const, items: result.items }
}

export function buildInterviewQuestionInput(
  snapshot: {
    candidate: {
      location: string | null
      externalIds: unknown
    }
    vacancy: {
      title: string
      description: string
      requisition: {
        grade: string
      }
    }
  },
  parsedResumePayload: unknown,
) {
  const resumePayload = asRecord(parsedResumePayload)
  const hhResumeSnapshot = asRecord(asRecord(snapshot.candidate.externalIds)?.hh_resume_snapshot)

  const candidateResume = {
    title: asString(hhResumeSnapshot?.title) ?? asString(resumePayload?.title) ?? null,
    experience: asStringArray(hhResumeSnapshot?.experience ?? resumePayload?.experience),
    education: asStringArray(hhResumeSnapshot?.education ?? resumePayload?.education),
    skills: asStringArray(hhResumeSnapshot?.skills ?? resumePayload?.skills),
    total_experience_months:
      asNumber(hhResumeSnapshot?.total_experience_months) ??
      asNumber(resumePayload?.total_experience_months) ??
      null,
    location:
      asString(snapshot.candidate.location) ??
      asString(hhResumeSnapshot?.location) ??
      asString(resumePayload?.location) ??
      null,
    career_transitions: asStringArray(hhResumeSnapshot?.career_transitions ?? resumePayload?.career_transitions),
  }

  return {
    vacancyProfile: {
      title: snapshot.vacancy.title,
      grade: snapshot.vacancy.requisition.grade,
      description: snapshot.vacancy.description,
    },
    candidateResume,
  }
}

export async function gradeOpenAssessmentAnswers(input: {
  prisma: DbClient
  env: AppEnv
  sessionId: string
}) {
  const { prisma, env, sessionId } = input
  if (!env.AI_SCORING_ENABLED || !env.LLM_SCORING_API_KEY) {
    return { queued: false as const, reason: 'not_configured' as const }
  }

  const session = await prisma.assessmentSession.findFirst({
    where: { id: sessionId },
    include: {
      answers: true,
      template: {
        include: { questions: true },
      },
    },
  })
  if (!session) return { queued: false as const, reason: 'session_not_found' as const }

  const provider = createAssessmentProvider(env)
  for (const answer of session.answers) {
    const question = session.template.questions.find((item) => item.id === answer.questionId)
    if (!question || question.type !== 'open' || !question.rubric) continue
    const answerText = normalizeAnswerText(answer.answer)
    if (!answerText) continue

    const grade = await provider.gradeOpenAnswer({
      question: question.prompt,
      rubric: question.rubric,
      answer: answerText,
    })

    await prisma.assessmentAnswer.update({
      where: { id: answer.id },
      data: {
        aiGrade: grade as Prisma.InputJsonValue,
      },
    })
  }

  await prisma.assessmentSession.update({
    where: { id: sessionId },
    data: { status: 'graded' },
  })

  return { queued: true as const }
}

function normalizeAnswerText(answer: unknown) {
  if (typeof answer === 'string') return answer.trim()
  if (typeof answer === 'object' && answer && 'text' in answer && typeof answer.text === 'string') {
    return answer.text.trim()
  }
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}
