/**
 * Phase 17 — Domestic Logist auto-scoring & verdict.
 *
 * Pure scoring helpers + a Prisma-backed `finalizeDomesticStage4` orchestrator
 * that is invoked from the Stage-4 submission handler in `selection.routes.ts`.
 *
 * The deterministic verdict produced here is written to `SelectionVerdict`
 * before the AI evaluator runs. The AI evaluator (`selection.queue.ts`)
 * appends its second opinion into `verdictReason` / `hrNotes` rather than
 * overwriting the deterministic numbers.
 */

import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import {
  computeDomesticCrossCheckFlags,
} from './domestic-cross-check'
import {
  scoreDomesticAssessment,
  shouldAdmitToLiveInterview,
  type DomesticAdmissionVerdict,
  type DomesticAssessmentProfile,
  type DomesticCrossCheckFlag,
  type DomesticScoringResult,
  type RawModuleResult,
  type SpecializationAssignment,
} from './domestic-scoring'
import { getDomesticStageContent } from './domestic-stage-content'
import type { TestStageContent } from './stage-content'

// ─── Stage 2 auto-scoring ─────────────────────────────────────────────────────

/**
 * Score Stage-2 answers against the radio questions of each assigned package.
 *
 * Iterates over `specializations`, fetches the package's Stage-2 content via
 * `getDomesticStageContent(packageId, 2)`, and for every radio question with a
 * `correct` answer + `weight` adds the weight to `maxScore` and the same value
 * to `rawScore` when `answers[q.key] === q.correct`.
 *
 * Unknown/empty packages are skipped silently — the function never throws.
 */
export function scoreDomesticStage2(
  specializations: SpecializationAssignment[],
  answers: Record<string, unknown>,
): RawModuleResult[] {
  const results: RawModuleResult[] = []
  const seen = new Set<string>()
  for (const spec of specializations) {
    if (seen.has(spec.packageId)) continue
    seen.add(spec.packageId)
    const content = getDomesticStageContent(spec.packageId, 2) as TestStageContent | null
    if (!content || content.type !== 'test') continue
    let rawScore = 0
    let maxScore = 0
    for (const q of content.questions) {
      if (q.type !== 'radio' || !q.correct) continue
      const weight = q.weight ?? 0
      maxScore += weight
      const given = answers[q.key]
      if (typeof given === 'string' && given === q.correct) {
        rawScore += weight
      }
    }
    results.push({ packageId: spec.packageId, rawScore, maxScore })
  }
  return results
}

// ─── Provisional component scoring ───────────────────────────────────────────

const DEPTH_RISK_FLAGS = [
  'oversized_depth_risk',
  'remote_region_depth_risk',
  'cabotage_depth_risk',
] as const

export interface ProvisionalComponents {
  resumeAndInterviewScore: number
  communicationScore: number
  practicalScore: number
}

/**
 * Compute provisional values for the subjective components that the
 * deterministic scorer cannot measure directly. The Gemini second-opinion
 * evaluator may later refine these without overwriting the deterministic
 * verdict.
 */
export function deriveProvisionalComponents(
  moduleResults: RawModuleResult[],
  riskFlags: string[],
  hasSecondary: boolean,
): ProvisionalComponents {
  const depthRiskCount = DEPTH_RISK_FLAGS.filter((f) => riskFlags.includes(f)).length
  const resumeAndInterviewScore = Math.max(3, 15 - 4 * depthRiskCount)

  const communicationScore = riskFlags.length > 0 ? 3 : 5

  let totalRaw = 0
  let totalMax = 0
  for (const r of moduleResults) {
    totalRaw += r.rawScore
    totalMax += r.maxScore
  }
  const ratio = totalMax > 0 ? totalRaw / totalMax : 0
  const practicalCap = hasSecondary ? 20 : 25
  const practicalScore = practicalCap * ratio

  return { resumeAndInterviewScore, communicationScore, practicalScore }
}

// ─── Admission → status / verdict label mapping ──────────────────────────────

export type DomesticSessionStatus = 'completed' | 'manual_review' | 'rejected'
export type DomesticVerdictLabel = 'ДОПУСТИТЬ' | 'НА РУЧНУЮ ПРОВЕРКУ HR' | 'ОТКЛОНИТЬ'

export function admissionToStatus(admission: DomesticAdmissionVerdict): DomesticSessionStatus {
  switch (admission) {
    case 'STRONG_CANDIDATE':
    case 'ADMIT_TO_INTERVIEW':
      return 'completed'
    case 'MANUAL_REVIEW_HR':
    case 'MANUAL_EXCEPTION_ONLY':
      return 'manual_review'
    case 'REJECT':
    case 'AUTO_REJECT':
      return 'rejected'
  }
}

export function admissionToVerdictLabel(admission: DomesticAdmissionVerdict): DomesticVerdictLabel {
  switch (admissionToStatus(admission)) {
    case 'completed':
      return 'ДОПУСТИТЬ'
    case 'manual_review':
      return 'НА РУЧНУЮ ПРОВЕРКУ HR'
    case 'rejected':
      return 'ОТКЛОНИТЬ'
  }
}

// ─── Pure verdict computation ────────────────────────────────────────────────

export interface DomesticVerdictInputs {
  candidateId?: string
  specializations: SpecializationAssignment[]
  riskFlags: string[]
  moduleResults: RawModuleResult[]
  /** Merged answers across stages (used for cross-check trap detection). */
  mergedAnswers: Record<string, unknown>
}

export interface DomesticVerdictComputation {
  totalScore: number
  admission: DomesticAdmissionVerdict
  status: DomesticSessionStatus
  verdictLabel: DomesticVerdictLabel
  flags: DomesticCrossCheckFlag[]
  moduleResults: RawModuleResult[]
  stageScores: DomesticScoringResult
}

export function computeDomesticVerdict(
  inputs: DomesticVerdictInputs,
): DomesticVerdictComputation {
  const { specializations, riskFlags, moduleResults, mergedAnswers } = inputs
  const hasSecondary = specializations.some((s) => s.level === 'secondary')

  const components = deriveProvisionalComponents(moduleResults, riskFlags, hasSecondary)

  const profile: DomesticAssessmentProfile = {
    candidateId: inputs.candidateId ?? '',
    signals: [],
    specializations,
    riskFlags,
    resumeAndInterviewScore: components.resumeAndInterviewScore,
    communicationScore: components.communicationScore,
    practicalScore: components.practicalScore,
  }

  // Surface module raw/max scores as `${packageId}.rawScore` / `.maxScore`
  // entries in the answers map so `computeDomesticCrossCheckFlags` can reason
  // about per-package performance (e.g. RED-3: claimed primary oversized but
  // scored < 30 % on that module).
  const crossCheckAnswers: Record<string, unknown> = { ...mergedAnswers }
  for (const r of moduleResults) {
    crossCheckAnswers[`${r.packageId}.rawScore`] = r.rawScore
    crossCheckAnswers[`${r.packageId}.maxScore`] = r.maxScore
  }

  const flags = computeDomesticCrossCheckFlags(profile, crossCheckAnswers)
  const scoring = scoreDomesticAssessment(profile, moduleResults)
  const admission = shouldAdmitToLiveInterview(scoring.totalScore, flags)
  const status = admissionToStatus(admission)
  const verdictLabel = admissionToVerdictLabel(admission)

  return {
    totalScore: scoring.totalScore,
    admission,
    status,
    verdictLabel,
    flags,
    moduleResults,
    stageScores: scoring,
  }
}

// ─── Prisma-backed orchestrator ──────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readModuleResultsFromScores(scores: unknown): RawModuleResult[] | null {
  const obj = asRecord(scores)
  const candidate = obj['moduleResults']
  if (!Array.isArray(candidate)) return null
  const out: RawModuleResult[] = []
  for (const entry of candidate) {
    const e = asRecord(entry)
    if (
      typeof e['packageId'] === 'string' &&
      typeof e['rawScore'] === 'number' &&
      typeof e['maxScore'] === 'number'
    ) {
      out.push({
        packageId: e['packageId'] as RawModuleResult['packageId'],
        rawScore: e['rawScore'] as number,
        maxScore: e['maxScore'] as number,
      })
    }
  }
  return out.length > 0 ? out : null
}

/**
 * Finalize the deterministic verdict for a `logist_domestic` session right
 * after Stage 4 has been submitted. Returns the computation, or `null` for
 * non-domestic sessions (caller should fall back to its existing flow).
 */
export async function finalizeDomesticStage4(
  prisma: DbClient,
  sessionId: string,
): Promise<DomesticVerdictComputation | null> {
  const session = await prisma.selectionSession.findUnique({
    where: { id: sessionId },
    include: {
      template: true,
      stageResults: { orderBy: { stageNumber: 'asc' } },
    },
  })
  if (!session) return null
  if (session.template.role !== 'logist_domestic') return null

  const specializations = Array.isArray(session.specializations)
    ? (session.specializations as unknown as SpecializationAssignment[])
    : []

  const assessmentProfile = asRecord(session.assessmentProfile)
  const riskFlags = Array.isArray(assessmentProfile['riskFlags'])
    ? (assessmentProfile['riskFlags'] as string[]).filter((x) => typeof x === 'string')
    : []

  // Merge answers from all stages for cross-check evaluation.
  const mergedAnswers: Record<string, unknown> = {}
  let stage2Answers: Record<string, unknown> = {}
  let stage2Scores: unknown = null
  for (const r of session.stageResults) {
    const a = asRecord(r.answers)
    Object.assign(mergedAnswers, a)
    if (r.stageNumber === 2) {
      stage2Answers = a
      stage2Scores = r.scores
    }
  }

  const moduleResults =
    readModuleResultsFromScores(stage2Scores) ??
    scoreDomesticStage2(specializations, stage2Answers)

  const computation = computeDomesticVerdict({
    candidateId: session.applicationId ?? session.id,
    specializations,
    riskFlags,
    moduleResults,
    mergedAnswers,
  })

  const stageScoresJson = {
    resumeAndInterviewScore: computation.stageScores.resumeAndInterviewScore,
    coreOperationsScore: computation.stageScores.coreOperationsScore,
    primarySpecScore: computation.stageScores.primarySpecScore,
    secondarySpecScore: computation.stageScores.secondarySpecScore,
    practicalAssignmentScore: computation.stageScores.practicalAssignmentScore,
    communicationScore: computation.stageScores.communicationScore,
    totalScore: computation.stageScores.totalScore,
    moduleResults: computation.moduleResults,
    admission: computation.admission,
  } as unknown as Prisma.InputJsonValue

  await prisma.selectionVerdict.upsert({
    where: { sessionId: session.id },
    update: {
      verdict: computation.verdictLabel,
      totalWeightedScore: new Prisma.Decimal(computation.totalScore.toFixed(4)),
      stageScores: stageScoresJson,
      crossCheckFlags: computation.flags as unknown as Prisma.InputJsonValue,
    },
    create: {
      sessionId: session.id,
      verdict: computation.verdictLabel,
      totalWeightedScore: new Prisma.Decimal(computation.totalScore.toFixed(4)),
      stageScores: stageScoresJson,
      crossCheckFlags: computation.flags as unknown as Prisma.InputJsonValue,
      lieScaleResult: Prisma.JsonNull,
    },
  })

  return computation
}
