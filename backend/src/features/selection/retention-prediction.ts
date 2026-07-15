import type { DomesticCrossCheckFlag, DomesticScoringResult } from './domestic-scoring'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Number(value.toFixed(4))
}

export interface RetentionPrediction {
  survival30: number
  survival60: number
  survival90: number
  confidence: number
  basis: {
    totalWeightedScore: number
    redFlags: number
    orangeFlags: number
    riskFlagsCount: number
    componentScores: {
      resumeAndInterviewScore: number
      coreOperationsScore: number
      primarySpecScore: number
      secondarySpecScore: number
      practicalAssignmentScore: number
      communicationScore: number
    }
  }
  modelVersion: string
}

export function buildRetentionPrediction(input: {
  stageScores: DomesticScoringResult
  crossCheckFlags: DomesticCrossCheckFlag[]
  riskFlags: string[]
}): RetentionPrediction {
  const redFlags = input.crossCheckFlags.filter((f) => f.type === 'RED').length
  const orangeFlags = input.crossCheckFlags.filter((f) => f.type === 'ORANGE').length
  const riskFlagsCount = input.riskFlags.length
  const totalRatio = clamp(input.stageScores.totalScore / 100, 0, 1)

  const base90 = clamp(
    0.3 + totalRatio * 0.62 - redFlags * 0.18 - orangeFlags * 0.06 - riskFlagsCount * 0.03,
    0.03,
    0.98,
  )
  const survival60 = clamp(base90 + 0.09, base90, 0.995)
  const survival30 = clamp(survival60 + 0.08, survival60, 0.999)
  const confidence = clamp(
    0.5 + Math.abs(totalRatio - 0.5) * 0.45 - Math.min(0.2, (redFlags + orangeFlags) * 0.05),
    0.35,
    0.92,
  )

  return {
    survival30: round(survival30),
    survival60: round(survival60),
    survival90: round(base90),
    confidence: round(confidence),
    basis: {
      totalWeightedScore: round(input.stageScores.totalScore),
      redFlags,
      orangeFlags,
      riskFlagsCount,
      componentScores: {
        resumeAndInterviewScore: round(input.stageScores.resumeAndInterviewScore),
        coreOperationsScore: round(input.stageScores.coreOperationsScore),
        primarySpecScore: round(input.stageScores.primarySpecScore),
        secondarySpecScore: round(input.stageScores.secondarySpecScore),
        practicalAssignmentScore: round(input.stageScores.practicalAssignmentScore),
        communicationScore: round(input.stageScores.communicationScore),
      },
    },
    modelVersion: 'retention-v1',
  }
}
