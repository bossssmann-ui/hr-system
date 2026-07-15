import { Prisma, SelectionRetentionOutcomeStatus } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { SelectionScoringWeights } from '../../generated/prisma/client'

export interface DomesticScoringWeightCaps {
  hardSkillFactology: number
  resumeAndInterview: number
  coreOperations: number
  primarySpec: number
  secondarySpec: number
  practicalAssignment: number
  communication: number
}

export const DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS: DomesticScoringWeightCaps = {
  hardSkillFactology: 10,
  resumeAndInterview: 5,
  coreOperations: 20,
  primarySpec: 25,
  secondarySpec: 15,
  practicalAssignment: 20,
  communication: 5,
}

const CALIBRATION_MODEL_VERSION = 'retention-v1'
const MIN_RESOLVED_SAMPLE = 30

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseDomesticScoringWeightCaps(value: unknown): DomesticScoringWeightCaps | null {
  const obj = asRecord(value)
  if (!obj) return null
  const hardSkillFactology = asNumber(obj['hardSkillFactology'])
  const resumeAndInterview = asNumber(obj['resumeAndInterview'])
  const coreOperations = asNumber(obj['coreOperations'])
  const primarySpec = asNumber(obj['primarySpec'])
  const secondarySpec = asNumber(obj['secondarySpec'])
  const practicalAssignment = asNumber(obj['practicalAssignment'])
  const communication = asNumber(obj['communication'])
  if (
    hardSkillFactology == null ||
    resumeAndInterview == null ||
    coreOperations == null ||
    primarySpec == null ||
    secondarySpec == null ||
    practicalAssignment == null ||
    communication == null
  ) {
    return null
  }
  return {
    hardSkillFactology,
    resumeAndInterview,
    coreOperations,
    primarySpec,
    secondarySpec,
    practicalAssignment,
    communication,
  }
}

export async function getActiveSelectionScoringWeights(
  prisma: DbClient,
  tenantId: string,
): Promise<DomesticScoringWeightCaps | null> {
  const row = await prisma.selectionScoringWeights.findFirst({
    where: { tenantId, active: true },
    orderBy: { computedAt: 'desc' },
    select: { weights: true },
  })
  if (!row) return null
  return parseDomesticScoringWeightCaps(row.weights)
}

type ComponentRow = {
  hardSkillFactology: number
  resumeAndInterview: number
  coreOperations: number
  primarySpec: number
  secondarySpec: number
  practicalAssignment: number
  communication: number
  survived90: number
}

function pearson(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 2) return 0
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let covariance = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i]! - meanX
    const dy = ys[i]! - meanY
    covariance += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX <= 0 || varY <= 0) return 0
  return covariance / Math.sqrt(varX * varY)
}

export function calibrateWeightCaps(rows: ComponentRow[]): DomesticScoringWeightCaps {
  if (rows.length < MIN_RESOLVED_SAMPLE) {
    return DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS
  }

  const y = rows.map((r) => r.survived90)
  const componentKeys: Array<keyof DomesticScoringWeightCaps> = [
    'hardSkillFactology',
    'resumeAndInterview',
    'coreOperations',
    'primarySpec',
    'secondarySpec',
    'practicalAssignment',
    'communication',
  ]

  const rawAdjustments = componentKeys.map((key) => {
    const corr = pearson(
      rows.map((r) => r[key]),
      y,
    )
    return Math.max(0, corr)
  })
  const adjustmentSum = rawAdjustments.reduce((sum, value) => sum + value, 0)
  if (adjustmentSum <= 0) {
    return DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS
  }

  const defaults = DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS
  const defaultSum =
    defaults.hardSkillFactology +
    defaults.resumeAndInterview +
    defaults.coreOperations +
    defaults.primarySpec +
    defaults.secondarySpec +
    defaults.practicalAssignment +
    defaults.communication

  const blended = componentKeys.map((key, index) => {
    const base = defaults[key]
    const corrContribution = rawAdjustments[index]! / adjustmentSum
    return base * 0.7 + defaultSum * corrContribution * 0.3
  })
  const blendedSum = blended.reduce((sum, value) => sum + value, 0)
  if (blendedSum <= 0) {
    return DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS
  }

  const scaled = blended.map((value) => (value / blendedSum) * defaultSum)
  return {
    hardSkillFactology: Number(scaled[0]!.toFixed(4)),
    resumeAndInterview: Number(scaled[1]!.toFixed(4)),
    coreOperations: Number(scaled[2]!.toFixed(4)),
    primarySpec: Number(scaled[3]!.toFixed(4)),
    secondarySpec: Number(scaled[4]!.toFixed(4)),
    practicalAssignment: Number(scaled[5]!.toFixed(4)),
    communication: Number(scaled[6]!.toFixed(4)),
  }
}

function readComponentRow(
  stageScores: unknown,
  survived90: boolean,
): ComponentRow | null {
  const scores = asRecord(stageScores)
  if (!scores) return null
  const hardSkillFactology = asNumber(scores['hardSkillFactologyScore'])
  const resumeAndInterview = asNumber(scores['resumeAndInterviewScore'])
  const coreOperations = asNumber(scores['coreOperationsScore'])
  const primarySpec = asNumber(scores['primarySpecScore'])
  const secondarySpec = asNumber(scores['secondarySpecScore'])
  const practicalAssignment = asNumber(scores['practicalAssignmentScore'])
  const communication = asNumber(scores['communicationScore'])
  if (
    hardSkillFactology == null ||
    resumeAndInterview == null ||
    coreOperations == null ||
    primarySpec == null ||
    secondarySpec == null ||
    practicalAssignment == null ||
    communication == null
  ) {
    return null
  }
  return {
    hardSkillFactology,
    resumeAndInterview,
    coreOperations,
    primarySpec,
    secondarySpec,
    practicalAssignment,
    communication,
    survived90: survived90 ? 1 : 0,
  }
}

export async function calibrateSelectionScoringWeightsForTenant(input: {
  prisma: DbClient
  tenantId: string
  now?: Date
  modelVersion?: string
}) {
  const {
    prisma,
    tenantId,
    now = new Date(),
    modelVersion = CALIBRATION_MODEL_VERSION,
  } = input

  const outcomes = await prisma.selectionRetentionOutcome.findMany({
    where: {
      tenantId,
      outcomeStatus: {
        in: [
          SelectionRetentionOutcomeStatus.resolved_survived_90,
          SelectionRetentionOutcomeStatus.resolved_terminated,
        ],
      },
    },
    include: {
      session: {
        include: { verdict: true },
      },
    },
  })

  const rows: ComponentRow[] = []
  for (const outcome of outcomes) {
    if (!outcome.session.verdict) continue
    const row = readComponentRow(outcome.session.verdict.stageScores, outcome.survived90)
    if (row) rows.push(row)
  }

  if (rows.length < MIN_RESOLVED_SAMPLE) {
    await prisma.selectionScoringWeights.updateMany({
      where: { tenantId, active: true },
      data: { active: false },
    })
    return { calibrated: false as const, sampleSize: rows.length }
  }

  const calibratedWeights = calibrateWeightCaps(rows)
  await prisma.$transaction(async (tx) => {
    await tx.selectionScoringWeights.updateMany({
      where: { tenantId, active: true },
      data: { active: false },
    })
    await tx.selectionScoringWeights.upsert({
      where: { tenantId_modelVersion: { tenantId, modelVersion } },
      update: {
        weights: calibratedWeights as unknown as Prisma.InputJsonValue,
        sampleSize: rows.length,
        computedAt: now,
        active: true,
      },
      create: {
        tenantId,
        modelVersion,
        weights: calibratedWeights as unknown as Prisma.InputJsonValue,
        sampleSize: rows.length,
        computedAt: now,
        active: true,
      },
    })
  })

  return { calibrated: true as const, sampleSize: rows.length, weights: calibratedWeights }
}

export async function runSelectionScoringCalibration(input: {
  prisma: DbClient
  now?: Date
}) {
  const { prisma, now = new Date() } = input
  const tenants = await prisma.tenant.findMany({ select: { id: true } })
  let calibratedTenants = 0
  let totalTenants = 0
  for (const tenant of tenants) {
    totalTenants += 1
    const result = await calibrateSelectionScoringWeightsForTenant({
      prisma,
      tenantId: tenant.id,
      now,
    })
    if (result.calibrated) calibratedTenants += 1
  }
  return { totalTenants, calibratedTenants }
}

export type { SelectionScoringWeights }
