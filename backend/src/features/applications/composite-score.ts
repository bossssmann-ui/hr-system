import { compositeScoreSchema, type CompositeScore } from '@web-app-demo/contracts'

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { resolvePipelineFlag } from '../tenant/resolve-pipeline-flag'

type WeightKey = 'resume' | 'selection' | 'assessment' | 'retention'
type ScoringWeights = Record<WeightKey, number>
type SelectionBreakdown = NonNullable<CompositeScore['breakdown']['selection']>
type AssessmentBreakdown = NonNullable<CompositeScore['breakdown']['assessment']>
type CompositeScoreDb = DbClient | Prisma.TransactionClient

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  resume: 0.25,
  selection: 0.4,
  assessment: 0.25,
  retention: 0.1,
}

export function computeCompositeScore(input: {
  resume: number | null
  selection: SelectionBreakdown | null
  assessment: AssessmentBreakdown | null
  retention: number | null
  scoringWeights?: unknown
  updatedAt?: Date | string
}): CompositeScore {
  const breakdown: CompositeScore['breakdown'] = {
    resume: normalizeScore(input.resume),
    selection: normalizeSelectionBreakdown(input.selection),
    assessment: normalizeAssessmentBreakdown(input.assessment),
    retention: normalizeScore(input.retention),
  }

  const componentValues: Record<WeightKey, number | null> = {
    resume: breakdown.resume,
    selection: breakdown.selection?.total ?? null,
    assessment: resolveAssessmentValue(breakdown.assessment),
    retention: breakdown.retention,
  }

  const configuredWeights = readScoringWeights(input.scoringWeights)
  const availableKeys = (Object.keys(componentValues) as WeightKey[]).filter((key) => componentValues[key] !== null)
  const appliedWeights = buildAppliedWeights(configuredWeights, availableKeys)

  const overall =
    availableKeys.length === 0
      ? 0
      : roundScore(
          availableKeys.reduce((sum, key) => sum + (componentValues[key] ?? 0) * appliedWeights[key], 0),
        )

  return compositeScoreSchema.parse({
    overall,
    breakdown,
    weights: appliedWeights,
    updatedAt: toIsoString(input.updatedAt),
  })
}

export async function recomputeCompositeScoreForApplication(input: {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  tx?: Prisma.TransactionClient
}) {
  const db: CompositeScoreDb = input.tx ?? input.prisma
  const application = await db.application.findUnique({
    where: { id: input.applicationId },
    select: {
      id: true,
      tenantId: true,
      aiScoring: true,
    },
  })

  if (!application) return null

  const [tenantSettings, selectionSession, assessmentSession] = await Promise.all([
    db.tenantSettings.findUnique({
      where: { tenantId: application.tenantId },
      select: { scoringWeights: true, featureFlags: true },
    }),
    db.selectionSession.findFirst({
      where: {
        applicationId: application.id,
        verdict: { isNot: null },
      },
      include: { verdict: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.assessmentSession.findFirst({
      where: { applicationId: application.id },
      select: {
        trustScore: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  if (!resolvePipelineFlag('compositeScore', tenantSettings?.featureFlags, input.env)) return null

  const score = computeCompositeScore({
    resume: readResumeScore(application.aiScoring),
    selection: readSelectionBreakdown(
      selectionSession?.verdict?.stageScores ?? null,
      selectionSession?.verdict?.totalWeightedScore ?? null,
    ),
    assessment: assessmentSession
      ? {
          score: null,
          trust: normalizeScore(assessmentSession.trustScore),
        }
      : null,
    retention: readRetentionScore(selectionSession?.verdict?.retentionPrediction ?? null),
    scoringWeights: tenantSettings?.scoringWeights ?? null,
  })

  await db.application.update({
    where: { id: application.id },
    data: {
      compositeScore: score as unknown as Prisma.InputJsonValue,
    },
  })

  return score
}

export async function recordCompositeScoreRecomputeFailure(input: {
  prisma: DbClient
  applicationId: string
  error: unknown
}) {
  const message = toErrorMessage(input.error)

  try {
    const application = await input.prisma.application.findUnique({
      where: { id: input.applicationId },
      select: { tenantId: true },
    })

    if (application) {
      await input.prisma.auditEvent.create({
        data: {
          tenantId: application.tenantId,
          actorUserId: null,
          action: 'application.composite_score_recompute_failed',
          entityType: 'Application',
          entityId: input.applicationId,
          diff: {
            error: message,
          } as Prisma.InputJsonValue,
        },
      })
    }
  } catch (auditError) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'applications.composite_score_recompute_audit_failed',
        applicationId: input.applicationId,
        error: toErrorMessage(auditError),
      }),
    )
  }

  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'applications.composite_score_recompute_failed',
      applicationId: input.applicationId,
      error: message,
    }),
  )
}

function readResumeScore(aiScoring: unknown) {
  const record = asRecord(aiScoring)
  const result = asRecord(record?.result)
  return normalizeScore(result?.relevance_score)
}

function readSelectionBreakdown(stageScores: unknown, totalWeightedScore: Prisma.Decimal | number | null): SelectionBreakdown | null {
  const scores = asRecord(stageScores)
  const total =
    normalizeScore(totalWeightedScore) ??
    normalizeScore(scores?.total) ??
    normalizeScore(scores?.totalScore) ??
    normalizeScore(scores?.total_weighted_score) ??
    null

  if (!scores && total === null) return null

  return {
    stage1: normalizeScore(scores?.stage1) ?? normalizeScore(scores?.stage_1_score),
    stage2: normalizeScore(scores?.stage2) ?? normalizeScore(scores?.stage_2_score),
    stage3: normalizeScore(scores?.stage3) ?? normalizeScore(scores?.stage_3_score),
    stage4: normalizeScore(scores?.stage4) ?? normalizeScore(scores?.stage_4_score),
    total,
  }
}

function readRetentionScore(retentionPrediction: unknown) {
  const record = asRecord(retentionPrediction)
  if (!record) return null

  const direct =
    normalizeScore(record.retention) ??
    normalizeScore(record.retentionScore) ??
    normalizeScore(record.retention_score)

  if (direct !== null) return direct

  const survival90 = toFiniteNumber(record.survival90)
  return survival90 === null ? null : normalizeScore(survival90 <= 1 ? survival90 * 100 : survival90)
}

function normalizeSelectionBreakdown(value: SelectionBreakdown | null): SelectionBreakdown | null {
  if (!value) return null
  return {
    stage1: normalizeScore(value.stage1),
    stage2: normalizeScore(value.stage2),
    stage3: normalizeScore(value.stage3),
    stage4: normalizeScore(value.stage4),
    total: normalizeScore(value.total),
  }
}

function normalizeAssessmentBreakdown(value: AssessmentBreakdown | null): AssessmentBreakdown | null {
  if (!value) return null
  return {
    score: normalizeScore(value.score),
    trust: normalizeScore(value.trust),
  }
}

function resolveAssessmentValue(value: AssessmentBreakdown | null) {
  if (!value) return null
  const available = [value.score, value.trust].filter((item): item is number => item !== null)
  if (available.length === 0) return null
  return roundScore(available.reduce((sum, item) => sum + item, 0) / available.length)
}

function readScoringWeights(value: unknown): ScoringWeights {
  const record = asRecord(value)
  return {
    resume: normalizeWeight(record?.resume, DEFAULT_SCORING_WEIGHTS.resume),
    selection: normalizeWeight(record?.selection, DEFAULT_SCORING_WEIGHTS.selection),
    assessment: normalizeWeight(record?.assessment, DEFAULT_SCORING_WEIGHTS.assessment),
    retention: normalizeWeight(record?.retention, DEFAULT_SCORING_WEIGHTS.retention),
  }
}

function buildAppliedWeights(configured: ScoringWeights, availableKeys: WeightKey[]): ScoringWeights {
  const base: ScoringWeights = {
    resume: 0,
    selection: 0,
    assessment: 0,
    retention: 0,
  }

  if (availableKeys.length === 0) return base

  const total = availableKeys.reduce((sum, key) => sum + configured[key], 0)
  if (total <= 0) return base

  for (const key of availableKeys) {
    base[key] = roundScore(configured[key] / total)
  }

  return base
}

function normalizeWeight(value: unknown, fallback: number) {
  const numeric = toFiniteNumber(value)
  if (numeric === null || numeric < 0) return fallback
  return numeric
}

function normalizeScore(value: unknown) {
  const numeric = toFiniteNumber(value)
  if (numeric === null) return null
  return roundScore(Math.min(100, Math.max(0, numeric)))
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Prisma.Decimal) return Number(value)
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function toIsoString(value: Date | string | undefined) {
  if (!value) return new Date().toISOString()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function roundScore(value: number) {
  return Number(value.toFixed(4))
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
