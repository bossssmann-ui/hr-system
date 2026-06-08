/**
 * Phase 15a — Domestic Logist Scoring
 */

import type { SpecializationPackageId, SpecializationLevel } from './domestic-specializations'
import { asNonEmptyStringArray } from './domestic-answer-helpers'
import {
  DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS,
  type DomesticScoringWeightCaps,
} from './retention-calibration'

export type { SpecializationPackageId, SpecializationLevel }
export type { DomesticScoringWeightCaps }

export interface SpecializationAssignment {
  packageId: SpecializationPackageId
  level: SpecializationLevel
}

export interface DomesticAssessmentProfile {
  candidateId: string
  signals: string[]
  specializations: SpecializationAssignment[]
  riskFlags: string[]
  /** Deterministic Stage-1 hard-skill factology score (0-cap) */
  hardSkillFactologyScore?: number
  /** Pre-computed scores fed in from outside (0-15 max) */
  resumeAndInterviewScore?: number
  /** Pre-computed communication score (0-5 max) */
  communicationScore?: number
  /** Pre-computed practical assignment raw score (0-max) */
  practicalScore?: number
}

export interface ModuleScore {
  packageId: SpecializationPackageId
  level: SpecializationLevel
  rawScore: number
  maxScore: number
  weightedScore: number
}

export interface RawModuleResult {
  packageId: SpecializationPackageId
  rawScore: number
  maxScore: number
}

export type DomesticAdmissionVerdict =
  | 'STRONG_CANDIDATE'
  | 'ADMIT_TO_INTERVIEW'
  | 'MANUAL_EXCEPTION_ONLY'
  | 'REJECT'
  | 'MANUAL_REVIEW_HR'
  | 'AUTO_REJECT'

export interface DomesticCrossCheckFlag {
  id: number
  type: 'RED' | 'ORANGE'
  packageId?: SpecializationPackageId
  description: string
  impact: string
}

export interface DomesticScoringResult {
  hardSkillFactologyScore: number // max 10
  resumeAndInterviewScore: number   // max 5
  coreOperationsScore: number       // max 20
  primarySpecScore: number          // max 25 (or 35 without secondaries)
  secondarySpecScore: number        // max 15 (or 0, redistributed)
  practicalAssignmentScore: number  // max 20 (or 25 without secondaries)
  communicationScore: number        // max 5
  totalScore: number                // 0-100
  moduleScores: ModuleScore[]
  admission: DomesticAdmissionVerdict
}

/** Check whether profile has any secondary specializations */
function hasSecondary(profile: DomesticAssessmentProfile): boolean {
  return profile.specializations.some((s) => s.level === 'secondary')
}

const CARGO_TYPE_OPTIONS = [
  'тент',
  'рефрижератор/изотерм',
  'негабарит',
  'сборные/догруз',
  'наливные',
  'опасные/ADR',
  'ценные',
] as const
const CARGO_TYPE_OPTION_SET = new Set<string>(CARGO_TYPE_OPTIONS)

export interface DomesticHardSkillFactologyResult {
  rawScore: number
  maxScore: number
  passed1CThreshold: boolean
  passedCounterpartyThreshold: boolean
}

export function scoreDomesticHardSkillFactology(
  answers: Record<string, unknown>,
): DomesticHardSkillFactologyResult {
  const oneCExperience = answers['q_1c_experience']
  let oneCScore = 0
  if (oneCExperience === 'базово (просмотр)') oneCScore = 1
  if (oneCExperience === 'уверенно (ТТН, ТрН, путевые листы)') oneCScore = 3
  if (oneCExperience === 'администрирование') oneCScore = 4

  const counterpartyChecks = new Set(asNonEmptyStringArray(answers['q_counterparty_checks']))
  const usesAtiSearch = counterpartyChecks.has('ati.su (поиск грузов/машин)')
  const usesRiskTool =
    counterpartyChecks.has('АТИ Светофор (рейтинг/риски)') ||
    counterpartyChecks.has('Контур.Фокус / СБИС / аналоги (проверка юрлица)')
  const usesRegistryCheck = counterpartyChecks.has('проверка по ЕГРЮЛ/ФНС')
  const skipsChecks = counterpartyChecks.has('не проверяю')
  let counterpartyScore = 0
  if (!skipsChecks) {
    if (usesAtiSearch) counterpartyScore += 1
    if (usesRiskTool) counterpartyScore += 3
    if (usesRegistryCheck) counterpartyScore += 1
  }

  const cargoCoverage = Math.min(
    4,
    asNonEmptyStringArray(answers['q_cargo_types']).filter((item) =>
      CARGO_TYPE_OPTION_SET.has(item),
    ).length,
  )

  return {
    rawScore: oneCScore + counterpartyScore + cargoCoverage,
    maxScore: 13,
    passed1CThreshold:
      oneCExperience === 'уверенно (ТТН, ТрН, путевые листы)' ||
      oneCExperience === 'администрирование',
    passedCounterpartyThreshold: usesRiskTool && !skipsChecks,
  }
}

export function scoreDomesticAssessment(
  profile: DomesticAssessmentProfile,
  moduleResults: RawModuleResult[],
  weightCaps: DomesticScoringWeightCaps = DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS,
): DomesticScoringResult {
  const withSecondary = hasSecondary(profile)

  // Weight caps per component
  const hardSkillFactologyMax = weightCaps.hardSkillFactology
  const redistributedSecondary = withSecondary ? 0 : weightCaps.secondarySpec
  const primarySpecMax = withSecondary
    ? weightCaps.primarySpec
    : weightCaps.primarySpec + (redistributedSecondary * 2) / 3
  const secondarySpecMax = withSecondary ? weightCaps.secondarySpec : 0
  const practicalMax = withSecondary
    ? weightCaps.practicalAssignment
    : weightCaps.practicalAssignment + redistributedSecondary / 3
  const resumeMax = weightCaps.resumeAndInterview
  const coreMax = weightCaps.coreOperations
  const commMax = weightCaps.communication

  // Gather module result maps
  const moduleMap = new Map<string, RawModuleResult>()
  for (const r of moduleResults) {
    moduleMap.set(r.packageId, r)
  }

  // Compute core operations score
  const coreRaw = moduleMap.get('domestic_core_operations')
  const coreRatio = coreRaw && coreRaw.maxScore > 0 ? coreRaw.rawScore / coreRaw.maxScore : 0
  const coreOperationsScore = Math.min(coreMax, coreRatio * coreMax)

  // Compute primary spec score
  const primarySpecs = profile.specializations.filter(
    (s) => s.level === 'primary' && s.packageId !== 'domestic_core_operations',
  )
  let primaryRawTotal = 0
  let primaryMaxTotal = 0
  for (const spec of primarySpecs) {
    const r = moduleMap.get(spec.packageId)
    if (r) {
      primaryRawTotal += r.rawScore
      primaryMaxTotal += r.maxScore
    }
  }
  const primaryRatio = primaryMaxTotal > 0 ? primaryRawTotal / primaryMaxTotal : 0
  const primarySpecScore = Math.min(primarySpecMax, primaryRatio * primarySpecMax)

  // Compute secondary spec score
  const secondarySpecs = profile.specializations.filter((s) => s.level === 'secondary')
  let secondaryRawTotal = 0
  let secondaryMaxTotal = 0
  for (const spec of secondarySpecs) {
    const r = moduleMap.get(spec.packageId)
    if (r) {
      secondaryRawTotal += r.rawScore
      secondaryMaxTotal += r.maxScore
    }
  }
  const secondaryRatio = secondaryMaxTotal > 0 ? secondaryRawTotal / secondaryMaxTotal : 0
  const secondarySpecScore = Math.min(secondarySpecMax, secondaryRatio * secondarySpecMax)

  // External component scores (passed in or 0)
  const hardSkillFactologyScore = Math.min(
    hardSkillFactologyMax,
    profile.hardSkillFactologyScore ?? 0,
  )
  const resumeAndInterviewScore = Math.min(
    resumeMax,
    profile.resumeAndInterviewScore ?? 0,
  )
  const communicationScore = Math.min(commMax, profile.communicationScore ?? 0)

  // Practical score
  const practicalRaw = profile.practicalScore ?? 0
  const practicalAssignmentScore = Math.min(practicalMax, practicalRaw)

  const totalScore =
    hardSkillFactologyScore +
    resumeAndInterviewScore +
    coreOperationsScore +
    primarySpecScore +
    secondarySpecScore +
    practicalAssignmentScore +
    communicationScore

  // Build module scores list
  const moduleScores: ModuleScore[] = []
  for (const spec of profile.specializations) {
    const r = moduleMap.get(spec.packageId)
    if (r) {
      const ratio = r.maxScore > 0 ? r.rawScore / r.maxScore : 0
      let cap: number
      if (spec.packageId === 'domestic_core_operations') {
        cap = coreMax
      } else if (spec.level === 'primary') {
        cap = primarySpecMax
      } else {
        cap = secondarySpecMax
      }
      moduleScores.push({
        packageId: spec.packageId,
        level: spec.level,
        rawScore: r.rawScore,
        maxScore: r.maxScore,
        weightedScore: ratio * cap,
      })
    }
  }

  const admission = shouldAdmitToLiveInterview(totalScore, [])

  return {
    hardSkillFactologyScore,
    resumeAndInterviewScore,
    coreOperationsScore,
    primarySpecScore,
    secondarySpecScore,
    practicalAssignmentScore,
    communicationScore,
    totalScore,
    moduleScores,
    admission,
  }
}

export function shouldAdmitToLiveInterview(
  totalScore: number,
  flags: DomesticCrossCheckFlag[],
): DomesticAdmissionVerdict {
  const redFlags = flags.filter((f) => f.type === 'RED')
  const orangeFlags = flags.filter((f) => f.type === 'ORANGE')

  // Stop-criterion: any RED flag with id >= 100
  const hasStopCriterion = redFlags.some((f) => f.id >= 100)
  if (hasStopCriterion) return 'AUTO_REJECT'

  // 2+ RED → AUTO_REJECT
  if (redFlags.length >= 2) return 'AUTO_REJECT'

  // 1 RED → MANUAL_REVIEW_HR (regardless of score, as long as score >= 70)
  if (redFlags.length === 1 && totalScore >= 70) return 'MANUAL_REVIEW_HR'

  // Score-based verdicts (no RED)
  if (totalScore >= 85 && orangeFlags.length <= 1) return 'STRONG_CANDIDATE'
  if (totalScore >= 70 && orangeFlags.length <= 2) return 'ADMIT_TO_INTERVIEW'
  if (totalScore >= 70) return 'ADMIT_TO_INTERVIEW'
  if (totalScore >= 60) return 'MANUAL_EXCEPTION_ONLY'
  return 'REJECT'
}
