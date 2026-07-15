/**
 * Phase 15a — Domestic Logist Cross-Check Flags
 */

import type { DomesticAssessmentProfile, DomesticCrossCheckFlag } from './domestic-scoring'

export type { DomesticCrossCheckFlag }

// Fake TMS names used as traps for domestic logists
const FAKE_DOMESTIC_TMS_POOL = [
  'LogiTrack PRO X7',
  'CargoSoft NextGen',
  'TransOptima 4D',
  // Also include sales pool in case they mix
  'TransLogic Северо-Запад',
  'FreightPro Analytics',
  'SalesBoost TMS',
]

export function computeDomesticCrossCheckFlags(
  profile: DomesticAssessmentProfile,
  stageAnswers: Record<string, unknown>,
): DomesticCrossCheckFlag[] {
  const flags: DomesticCrossCheckFlag[] = []

  // ── RED id=1: Confirmed non-existent TMS from trap pool ──────────────────
  const trapAnswer1 = stageAnswers['trap_answer_1']
  const trapAnswer2 = stageAnswers['trap_answer_2']

  const trapAnswersToCheck = [trapAnswer1, trapAnswer2].filter(Boolean)
  const confirmedFakeTMS = trapAnswersToCheck.some(
    (ans) =>
      typeof ans === 'string' &&
      FAKE_DOMESTIC_TMS_POOL.some(
        (fake) => ans.toLowerCase().includes(fake.toLowerCase()),
      ),
  )

  if (confirmedFakeTMS) {
    flags.push({
      id: 1,
      type: 'RED',
      description: 'Кандидат подтвердил опыт работы с несуществующей TMS из ловушки',
      impact: 'AUTO_REJECT',
    })
  }

  // ── RED id=2: Claims oversized but can't explain process ─────────────────
  if (profile.riskFlags.includes('oversized_depth_risk')) {
    flags.push({
      id: 2,
      type: 'RED',
      packageId: 'domestic_oversized_heavy',
      description:
        'Кандидат заявил опыт негабаритных перевозок, но не смог объяснить базовый процесс (габариты, маршрут, разрешения)',
      impact: 'AUTO_REJECT',
    })
  }

  // ── RED id=3: Claimed primary oversized but scored < 30% ─────────────────
  const claimedPrimaryOversized = profile.specializations.some(
    (s) => s.packageId === 'domestic_oversized_heavy' && s.level === 'primary',
  )
  if (claimedPrimaryOversized) {
    const rawScore = stageAnswers['domestic_oversized_heavy.rawScore']
    const maxScore = stageAnswers['domestic_oversized_heavy.maxScore']
    if (
      typeof rawScore === 'number' &&
      typeof maxScore === 'number' &&
      maxScore > 0 &&
      rawScore / maxScore < 0.3
    ) {
      flags.push({
        id: 3,
        type: 'RED',
        packageId: 'domestic_oversized_heavy',
        description:
          'Кандидат заявил основную специализацию по негабариту, но набрал менее 30% баллов по этому модулю',
        impact: 'AUTO_REJECT',
      })
    }
  }

  // ── ORANGE id=101: L-scale ≥ 3 answers of '5' ────────────────────────────
  const lScaleKeys = ['q17', 'q18', 'q19', 'q20']
  const fiveCount = lScaleKeys.filter((key) => stageAnswers[key] === '5').length
  if (fiveCount >= 3) {
    flags.push({
      id: 101,
      type: 'ORANGE',
      description:
        'L-шкала: кандидат дал ≥3 ответа "5" — риск социально желательных ответов',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  // ── ORANGE id=102: remote_region_depth_risk ───────────────────────────────
  if (profile.riskFlags.includes('remote_region_depth_risk')) {
    flags.push({
      id: 102,
      type: 'ORANGE',
      packageId: 'domestic_remote_regions',
      description:
        'Кандидат заявил опыт в труднодоступных регионах, но ответы поверхностные (только "искал машину")',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  // ── ORANGE id=103: cabotage_depth_risk ────────────────────────────────────
  if (profile.riskFlags.includes('cabotage_depth_risk')) {
    flags.push({
      id: 103,
      type: 'ORANGE',
      packageId: 'domestic_cabotage',
      description:
        'Кандидат заявил опыт каботажа, но не назвал ни порт, ни процесс',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  // Post-process: if 2+ RED, mark all RED flags with AUTO_REJECT impact
  const redCount = flags.filter((f) => f.type === 'RED').length
  if (redCount >= 2) {
    for (const flag of flags) {
      if (flag.type === 'RED') {
        flag.impact = 'AUTO_REJECT'
      }
    }
  }

  return flags
}
