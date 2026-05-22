import { createHash } from 'node:crypto'

import { Prisma } from '../../generated/prisma/client'
import {
  createScoringProvider,
  isAiScoringConfigured,
  ScoringProviderMalformedResponseError,
  type ScoringInput,
  type ScoringProvider,
} from '../../integrations/llm'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'

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

  // Idempotency/cost control: if we already scored the same normalized input
  // and this is not an explicit re-score (`force=true`), skip provider calls.
  if (!force && existingScoring?.status === 'scored' && existingScoring.input_hash === inputHash) {
    return { skipped: true as const, reason: 'unchanged_input' as const }
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      aiScoring: {
        status: 'pending',
        input_hash: inputHash,
      } as Prisma.InputJsonValue,
    },
  })

  try {
    const result = await provider.score(scoringInput)

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScoring: {
          status: 'scored',
          input_hash: inputHash,
          result,
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

    return { skipped: false as const, status: 'scored' as const, result }
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
        } as Prisma.InputJsonValue,
      },
    })

    return { skipped: false as const, status: 'failed' as const, error: message }
  }
}

export function withScoringPresentation(aiScoring: unknown, env: AppEnv): Record<string, unknown> {
  if (!isAiScoringConfigured(env)) {
    return NOT_CONFIGURED_PAYLOAD
  }

  const record = asRecord(aiScoring)
  if (!record || typeof record.status !== 'string') return { status: 'not_scored' }
  return record
}

export function hashScoringInput(input: ScoringInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
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
  },
  parsedResumePayload: unknown,
): ScoringInput {
  const resumePayload = asRecord(parsedResumePayload)
  const hhResumeSnapshot = asRecord(asRecord(snapshot.candidate.externalIds)?.hh_resume_snapshot)

  const mergedResume = {
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
  }

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
  }
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
