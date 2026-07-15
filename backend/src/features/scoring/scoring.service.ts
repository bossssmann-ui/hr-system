import { createHash } from 'node:crypto'

import { Prisma } from '../../generated/prisma/client'
import {
  createScoringProvider,
  isAiScoringConfigured,
  ScoringProviderMalformedResponseError,
  type ScoringInput,
  type ScoringProvider,
  type ScoringResult,
} from '../../integrations/llm'
import { isScoringResultInternallyInconsistent, scoringResultSchema } from '../../integrations/llm/scoring.schemas'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
} from '../applications/composite-score'
import { maybeTriggerClarificationAfterScoring } from '../applications/clarification.service'

const AUTO_SCREEN_THRESHOLD = 60
const AUTO_NEW_MAX_SCORE = 59
const ATTENTION_SCORE_MAX = 69
const SCORING_HISTORY_LIMIT = 10
const SCORING_RULESET_VERSION = 7

const NOT_CONFIGURED_PAYLOAD = {
  status: 'not_configured',
} as const

type ScoreApplicationInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  force?: boolean
  provider?: ScoringProvider
}

export async function scoreApplication(input: ScoreApplicationInput) {
  const { prisma, env, applicationId, actorUserId, force = false } = input

  if (!isAiScoringConfigured(env)) {
    return { skipped: true as const, reason: 'not_configured' as const }
  }

  const provider = input.provider ?? createScoringProvider(env)

  const snapshot = await prisma.application.findFirst({
    where: { id: applicationId },
    include: {
      candidate: true,
      vacancy: {
        include: {
          requisition: true,
        },
      },
    },
  })

  if (!snapshot) {
    return { skipped: true as const, reason: 'application_not_found' as const }
  }

  const latestResume = await prisma.resume.findFirst({
    where: { tenantId: snapshot.tenantId, candidateId: snapshot.candidateId, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { parsedPayload: true },
  })

  const scoringInput = buildScoringInput(snapshot, latestResume?.parsedPayload)
  const inputHash = hashScoringInput(scoringInput)
  const existingScoring = asRecord(snapshot.aiScoring)
  const previousSuccessfulScoring = getPreviousSuccessfulScoring(existingScoring)
  const existingResult = asScoringResult(existingScoring?.result)
  const previousResult = asScoringResult(previousSuccessfulScoring?.result)
  const currentSameInputIsConsistent =
    !existingResult || !isScoringResultInternallyInconsistent(existingResult, scoringInput)
  const previousSameInputIsConsistent =
    !previousResult || !isScoringResultInternallyInconsistent(previousResult, scoringInput)
  const hasScoredSameInput =
    (existingScoring?.status === 'scored' && existingScoring.input_hash === inputHash && currentSameInputIsConsistent) ||
    (previousSuccessfulScoring?.input_hash === inputHash && previousSameInputIsConsistent)

  // Idempotency/cost control: if we already scored the same normalized input
  // skip provider calls. This also covers queued/pending manual re-score jobs:
  // `markApplicationScoringQueued` moves the current score into
  // `previous_scoring`, so checking only `status=scored` would let the same
  // input be overwritten by a nondeterministic LLM response.
  if (hasScoredSameInput) {
    if (existingScoring?.status !== 'scored' && previousSuccessfulScoring) {
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          aiScoring: previousSuccessfulScoring as Prisma.InputJsonValue,
        },
      })
    }
    return { skipped: true as const, reason: 'unchanged_input' as const }
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      aiScoring: {
        status: 'pending',
        input_hash: inputHash,
        previous_scoring: previousSuccessfulScoring ?? undefined,
      } as Prisma.InputJsonValue,
    },
  })

  try {
    const rawResult = await provider.score(scoringInput)
    const result = calibrateScoringResult(rawResult, scoringInput)
    const scoredAt = new Date().toISOString()

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScoring: {
          status: 'scored',
          input_hash: inputHash,
          result,
          history: buildScoringHistory(existingScoring, {
            replacedAt: scoredAt,
            replacedByModel: result.model,
          }),
        } as Prisma.InputJsonValue,
      },
    })

    await prisma.auditEvent.create({
      data: {
        tenantId: snapshot.tenantId,
        actorUserId: actorUserId ?? null,
        action: 'application.ai_scored',
        entityType: 'Application',
        entityId: snapshot.id,
        diff: {
          relevance_score: result.relevance_score,
          model: result.model,
          status: 'scored',
        } as Prisma.InputJsonValue,
      },
    })

    const autoStage = await maybeAutoAdvanceToScreen({
      prisma,
      tenantId: snapshot.tenantId,
      applicationId: snapshot.id,
      actorUserId,
      relevanceScore: result.relevance_score,
    })
    const autoReturn = autoStage.advanced
      ? { moved: false as const, reason: 'already_advanced' as const }
      : await maybeAutoReturnToNewForLowScore({
          prisma,
          tenantId: snapshot.tenantId,
          applicationId: snapshot.id,
          actorUserId,
          relevanceScore: result.relevance_score,
        })

    try {
      await recomputeCompositeScoreForApplication({
        prisma,
        env,
        applicationId: snapshot.id,
      })
    } catch (error) {
      await recordCompositeScoreRecomputeFailure({
        prisma,
        applicationId: snapshot.id,
        error,
      })
    }

    // Best-effort: trigger clarification cycle if score is in the clarification band
    // and all guards pass. Errors are swallowed so they never block scoring.
    try {
      await maybeTriggerClarificationAfterScoring({
        prisma,
        env,
        applicationId: snapshot.id,
        relevanceScore: result.relevance_score,
        actorUserId,
      })
    } catch {
      // non-blocking
    }

    return { skipped: false as const, status: 'scored' as const, result, autoStage, autoReturn }
  } catch (error) {
    const model = env.LLM_SCORING_MODEL
    const scoredAt = new Date().toISOString()

    const message =
      error instanceof ScoringProviderMalformedResponseError
        ? 'Provider returned malformed JSON twice'
        : error instanceof Error
          ? error.message
          : 'Unknown scoring error'

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScoring: {
          status: 'failed',
          input_hash: inputHash,
          failure: {
            error: message,
            model,
            scored_at: scoredAt,
          },
          previous_scoring: previousSuccessfulScoring ?? undefined,
        } as Prisma.InputJsonValue,
      },
    })

    return { skipped: false as const, status: 'failed' as const, error: message }
  }
}

function getPreviousSuccessfulScoring(existingScoring: Record<string, unknown> | null) {
  if (existingScoring?.status === 'scored') return existingScoring

  const previousScoring = asRecord(existingScoring?.previous_scoring)
  if (previousScoring?.status === 'scored') return previousScoring

  return null
}

function asScoringResult(value: unknown) {
  const parsed = scoringResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

async function maybeAutoReturnToNewForLowScore(input: {
  prisma: DbClient
  tenantId: string
  applicationId: string
  actorUserId?: string
  relevanceScore: number
}) {
  if (input.relevanceScore > AUTO_NEW_MAX_SCORE) {
    return { moved: false as const, reason: 'above_new_threshold' as const }
  }

  const actorUserId = input.actorUserId ?? (await findAutomationActorUserId(input.prisma, input.tenantId))
  if (!actorUserId) {
    return { moved: false as const, reason: 'automation_actor_missing' as const }
  }

  return input.prisma.$transaction(async (tx) => {
    const current = await tx.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: input.tenantId,
      },
      select: {
        stage: true,
      },
    })

    if (!current) {
      return { moved: false as const, reason: 'application_not_found' as const }
    }

    if (current.stage !== 'screen') {
      return { moved: false as const, reason: 'not_screen_stage' as const }
    }

    const lastScreenEvent = await tx.applicationStageEvent.findFirst({
      where: {
        applicationId: input.applicationId,
        fromStage: 'new',
        toStage: 'screen',
      },
      orderBy: { createdAt: 'desc' },
      select: { comment: true },
    })

    if (!lastScreenEvent?.comment?.startsWith('Auto-moved to screening after AI relevance score')) {
      return { moved: false as const, reason: 'not_auto_screened' as const }
    }

    await tx.application.update({
      where: { id: input.applicationId },
      data: { stage: 'new' },
    })

    const comment = `Auto-returned to new after AI relevance score ${input.relevanceScore} <= ${AUTO_NEW_MAX_SCORE}`

    await tx.applicationStageEvent.create({
      data: {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        fromStage: 'screen',
        toStage: 'new',
        actorUserId,
        comment,
      },
    })

    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId,
        action: 'application.auto_returned_to_new',
        entityType: 'Application',
        entityId: input.applicationId,
        diff: {
          from: 'screen',
          to: 'new',
          relevance_score: input.relevanceScore,
          threshold: AUTO_NEW_MAX_SCORE,
        } as Prisma.InputJsonValue,
      },
    })

    return { moved: true as const, to: 'new' as const }
  })
}

async function maybeAutoAdvanceToScreen(input: {
  prisma: DbClient
  tenantId: string
  applicationId: string
  actorUserId?: string
  relevanceScore: number
}) {
  if (input.relevanceScore < AUTO_SCREEN_THRESHOLD) {
    return { advanced: false as const, reason: 'below_threshold' as const }
  }

  const actorUserId = input.actorUserId ?? (await findAutomationActorUserId(input.prisma, input.tenantId))
  if (!actorUserId) {
    return { advanced: false as const, reason: 'automation_actor_missing' as const }
  }

  return input.prisma.$transaction(async (tx) => {
    const current = await tx.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: input.tenantId,
      },
      select: {
        stage: true,
      },
    })

    if (!current) {
      return { advanced: false as const, reason: 'application_not_found' as const }
    }

    if (current.stage !== 'new') {
      return { advanced: false as const, reason: 'not_new_stage' as const }
    }

    await tx.application.update({
      where: { id: input.applicationId },
      data: { stage: 'screen' },
    })

    const comment = `Auto-moved to screening after AI relevance score ${input.relevanceScore} >= ${AUTO_SCREEN_THRESHOLD}`

    await tx.applicationStageEvent.create({
      data: {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        fromStage: 'new',
        toStage: 'screen',
        actorUserId,
        comment,
      },
    })

    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId,
        action: 'application.auto_screened',
        entityType: 'Application',
        entityId: input.applicationId,
        diff: {
          from: 'new',
          to: 'screen',
          relevance_score: input.relevanceScore,
          threshold: AUTO_SCREEN_THRESHOLD,
        } as Prisma.InputJsonValue,
      },
    })

    return { advanced: true as const, to: 'screen' as const }
  })
}

async function findAutomationActorUserId(prisma: DbClient, tenantId: string) {
  const rows = await prisma.userRole.findMany({
    where: {
      tenantId,
      role: { in: ['owner', 'hr_admin', 'recruiter'] },
      user: { disabledAt: null },
    },
    select: {
      userId: true,
      role: true,
    },
  })

  const priority = ['owner', 'hr_admin', 'recruiter']
  return priority
    .map((role) => rows.find((row) => row.role === role)?.userId)
    .find((userId): userId is string => Boolean(userId)) ?? null
}

export function withScoringPresentation(aiScoring: unknown, env: AppEnv): Record<string, unknown> {
  if (!isAiScoringConfigured(env)) {
    return NOT_CONFIGURED_PAYLOAD
  }

  const record = asRecord(aiScoring)
  if (!record || typeof record.status !== 'string') return { status: 'not_scored' }
  return record
}

function buildScoringHistory(
  existingScoring: Record<string, unknown> | null,
  meta: { replacedAt: string; replacedByModel?: string },
) {
  const sourceScoring =
    existingScoring?.status === 'scored'
      ? existingScoring
      : asRecord(existingScoring?.previous_scoring)

  const history = Array.isArray(sourceScoring?.history)
    ? sourceScoring.history.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : []

  if (sourceScoring?.status !== 'scored' || !asRecord(sourceScoring.result)) {
    return history.slice(-SCORING_HISTORY_LIMIT)
  }

  return [
    ...history,
    {
      input_hash: asString(sourceScoring.input_hash) ?? undefined,
      result: sourceScoring.result,
      replaced_at: meta.replacedAt,
      replaced_by_model: meta.replacedByModel,
    },
  ].slice(-SCORING_HISTORY_LIMIT)
}

export function hashScoringInput(input: ScoringInput) {
  return createHash('sha256')
    .update(JSON.stringify({ ruleset_version: SCORING_RULESET_VERSION, input }))
    .digest('hex')
}

function calibrateScoringResult(result: ScoringResult, input: ScoringInput): ScoringResult {
  if (result.relevance_score >= 70 && hasLimitedResumeProof(input)) {
    return {
      ...result,
      relevance_score: ATTENTION_SCORE_MAX,
      gaps: appendUnique(
        result.gaps,
        'Есть несколько релевантных логистических сигналов, но нет достаточно проверяемых обязанностей, KPI, объёмов или результатов для уверенной оценки 70+.',
      ),
      interview_focus_areas: appendUnique(result.interview_focus_areas, 'Подтвердить реальные обязанности, объёмы и результаты'),
    }
  }

  if (result.relevance_score < AUTO_SCREEN_THRESHOLD || !hasSparseEvidence(input)) {
    return result
  }

  return {
    ...result,
    relevance_score: AUTO_NEW_MAX_SCORE,
    gaps: appendUnique(
      result.gaps,
      'Недостаточно проверяемых фактов в вакансии и резюме: похожее название должности само по себе не подтверждает соответствие.',
    ),
    interview_focus_areas: appendUnique(result.interview_focus_areas, 'Проверить фактический опыт по индивидуальным вопросам'),
  }
}

function hasSparseEvidence(input: ScoringInput) {
  return hasSparseJobProfile(input) && hasSparseResumeProfile(input)
}

function hasSparseJobProfile(input: ScoringInput) {
  const descriptionWords = wordCount(input.job_profile.description)
  return descriptionWords < 8 && input.job_profile.required_skills.length <= 1
}

function hasSparseResumeProfile(input: ScoringInput) {
  const resume = input.candidate_resume
  if (resume.skills.length > 0) return false

  const factualExperienceItems = resume.experience.filter(hasConcreteEvidenceMarker)
  return factualExperienceItems.length === 0
}

function hasLimitedResumeProof(input: ScoringInput) {
  const resume = input.candidate_resume
  if (resume.skills.length > 0) return false

  return !resume.experience.some(hasDetailedExperienceEvidence)
}

function hasDetailedExperienceEvidence(value: string) {
  return wordCount(value) >= 10 && hasConcreteEvidenceMarker(value)
}

function hasConcreteEvidenceMarker(value: string) {
  const normalized = value.toLowerCase()
  return (
    /\d/.test(normalized) ||
    normalized.includes('@') ||
    /\b(tms|wms|erp|crm|kpi|sla|ftl|ltl|api|sql|1c|sap|oracle)\b/i.test(normalized) ||
    /тонн|рейс|маршрут|контейнер|перевоз|постав|склад|объем|объём|выруч|бюджет/.test(normalized)
  )
}

function wordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value]
}

export function buildScoringInput(
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
        salaryMin: number
        salaryMax: number
        currency: string
      }
    }
    aiClarification?: unknown
  },
  parsedResumePayload: unknown,
): ScoringInput {
  const resumePayload = asRecord(parsedResumePayload)
  const candidateExternalIds = asRecord(snapshot.candidate.externalIds)
  const hhResumeSnapshot = asRecord(candidateExternalIds?.hh_resume_snapshot)
  const questionnaireEnrichment = normalizeQuestionnaireEnrichment(candidateExternalIds?.ai_questionnaire_enrichment)

  const mergedResume = {
    title: asString(hhResumeSnapshot?.title) ?? asString(resumePayload?.title) ?? null,
    experience: [
      ...asStringArray(hhResumeSnapshot?.experience ?? resumePayload?.experience),
      ...asStringArray(questionnaireEnrichment?.experience),
      ...asStringArray(questionnaireEnrichment?.facts),
    ],
    education: asStringArray(hhResumeSnapshot?.education ?? resumePayload?.education),
    skills: [
      ...asStringArray(hhResumeSnapshot?.skills ?? resumePayload?.skills),
      ...asStringArray(questionnaireEnrichment?.skills),
    ],
    total_experience_months:
      asNumber(hhResumeSnapshot?.total_experience_months) ??
      asNumber(resumePayload?.total_experience_months) ??
      null,
    location:
      asString(snapshot.candidate.location) ??
      asString(hhResumeSnapshot?.location) ??
      asString(resumePayload?.location) ??
      null,
    previous_versions: resumeHistory(candidateExternalIds?.hh_resume_history, hhResumeSnapshot),
    questionnaire_enrichment: questionnaireEnrichment ?? undefined,
  }

  const candidateClarifications = normalizeClarifications(snapshot.aiClarification)

  return {
    job_profile: {
      title: snapshot.vacancy.title,
      grade: snapshot.vacancy.requisition.grade,
      description: snapshot.vacancy.description,
      required_skills: extractRequiredSkills(snapshot.vacancy.description),
      salary_range: {
        min: snapshot.vacancy.requisition.salaryMin,
        max: snapshot.vacancy.requisition.salaryMax,
        currency: snapshot.vacancy.requisition.currency,
      },
    },
    candidate_resume: mergedResume,
    ...(candidateClarifications.length > 0 ? { candidate_clarifications: candidateClarifications } : {}),
  }
}

function normalizeClarifications(value: unknown): Array<{ question: string; answer: string }> {
  const record = asRecord(value)
  if (!record || record.status !== 'answered') return []

  const questions = asStringArray(record.questions)
  const answers = asStringArray(record.answers)
  if (questions.length === 0 || answers.length === 0) return []

  const pairs: Array<{ question: string; answer: string }> = []
  const len = Math.min(questions.length, answers.length)
  for (let i = 0; i < len; i++) {
    pairs.push({ question: questions[i]!, answer: answers[i]! })
  }
  return pairs
}

function normalizeQuestionnaireEnrichment(value: unknown) {
  const record = asRecord(value)
  if (!record) return null

  return {
    summary: asString(record.summary) ?? undefined,
    facts: asStringArray(record.facts),
    experience: asStringArray(record.experience),
    skills: asStringArray(record.skills),
    contradictions: asStringArray(record.contradictions),
    confidence: asNumber(record.confidence) ?? undefined,
  }
}

function resumeHistory(value: unknown, currentSnapshot: Record<string, unknown> | null) {
  if (!Array.isArray(value)) return undefined

  const currentFingerprint = currentSnapshot ? resumeFingerprint(currentSnapshot) : null
  const versions = value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => !currentFingerprint || resumeFingerprint(item) !== currentFingerprint)
    .map((item) => ({
      title: asString(item.title),
      experience: asStringArray(item.experience),
      education: asStringArray(item.education),
      skills: asStringArray(item.skills),
      total_experience_months: asNumber(item.total_experience_months),
      location: asString(item.location),
    }))

  return versions.length > 0 ? versions.slice(-4) : undefined
}

function resumeFingerprint(snapshot: Record<string, unknown>) {
  return JSON.stringify({
    title: asString(snapshot.title),
    experience: asStringArray(snapshot.experience),
    education: asStringArray(snapshot.education),
    skills: asStringArray(snapshot.skills),
    total_experience_months: asNumber(snapshot.total_experience_months),
    location: asString(snapshot.location),
  })
}

function extractRequiredSkills(description: string) {
  // Heuristic fallback: we split the free-form vacancy description into short
  // skill-like fragments. This keeps scoring input deterministic even when
  // requisitions do not yet have a dedicated required-skills field.
  return description
    .split(/[\n,•-]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .slice(0, 12)
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
