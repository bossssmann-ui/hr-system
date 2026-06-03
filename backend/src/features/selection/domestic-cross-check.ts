/**
 * Phase 15a — Domestic Logist Cross-Check Flags
 */

import type { DomesticAssessmentProfile, DomesticCrossCheckFlag } from './domestic-scoring'
import { asNonEmptyString, asNonEmptyStringArray } from './domestic-answer-helpers'

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

// Below ~55/100 the rubric answer is usually too generic for confident
// confirmation, and <35 words often means the candidate listed only slogans
// instead of a concrete sequence of checks/actions.
const MIN_ACCEPTABLE_OPEN_SCORE = 55
const MIN_OPEN_ANSWER_WORD_COUNT = 35

function getOpenAnswerCorpus(stageAnswers: Record<string, unknown>) {
  return [
    asNonEmptyString(stageAnswers['q_new_carrier_check']),
    asNonEmptyString(stageAnswers['q_contract_risk_signs']),
    asNonEmptyString(stageAnswers['q_hardest_shipment']),
    asNonEmptyString(stageAnswers['q_breakdown_500km']) ?? asNonEmptyString(stageAnswers['road_q4']),
    asNonEmptyString(stageAnswers['rail_q4']),
    asNonEmptyString(stageAnswers['rail_q5']),
    asNonEmptyString(stageAnswers['rail_q_operators_open']),
    asNonEmptyString(stageAnswers['rail_q_tariffs_open']),
    asNonEmptyString(stageAnswers['rail_q_benefits_open']),
    asNonEmptyString(stageAnswers['oversized_q4']),
    asNonEmptyString(stageAnswers['oversized_q5']),
    asNonEmptyString(stageAnswers['oversized_q_project_permits_open']),
    asNonEmptyString(stageAnswers['oversized_q_liability_open']),
    asNonEmptyString(stageAnswers['oversized_q_escort_open']),
    asNonEmptyString(stageAnswers['remote_q4']),
    asNonEmptyString(stageAnswers['remote_q5']),
    asNonEmptyString(stageAnswers['remote_q_regions_open']),
    asNonEmptyString(stageAnswers['remote_q_north_delivery_open']),
    asNonEmptyString(stageAnswers['cab_q4']),
    asNonEmptyString(stageAnswers['cab_q5']),
    asNonEmptyString(stageAnswers['cab_q_ports_lines_open']),
    asNonEmptyString(stageAnswers['dist_q4']),
    asNonEmptyString(stageAnswers['dist_q5']),
    asNonEmptyString(stageAnswers['dist_q_wms_open']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()
}

function hasPrimarySpecialization(
  profile: DomesticAssessmentProfile,
  packageId: NonNullable<DomesticCrossCheckFlag['packageId']>,
) {
  return profile.specializations.some((s) => s.packageId === packageId && s.level === 'primary')
}

function readModuleRatio(stageAnswers: Record<string, unknown>, packageId: string) {
  const rawScore = stageAnswers[`${packageId}.rawScore`]
  const maxScore = stageAnswers[`${packageId}.maxScore`]
  if (typeof rawScore !== 'number' || typeof maxScore !== 'number' || maxScore <= 0) return null
  return rawScore / maxScore
}

function readAverageOpenScore(stageAnswers: Record<string, unknown>) {
  const maybeScores = stageAnswers['open_answer_grades']
  if (!Array.isArray(maybeScores) || maybeScores.length === 0) return null
  const numeric = maybeScores
    .map((item) =>
      item && typeof item === 'object' && 'score' in item && typeof item.score === 'number'
        ? item.score
        : null,
    )
    .filter((item): item is number => item != null)
  if (numeric.length === 0) return null
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length
}

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

  // ── ORANGE id=106..110: заявлена специализация, глубина не подтверждена ───
  const railCorpus = [
    asNonEmptyString(stageAnswers['rail_q_operators_open']),
    asNonEmptyString(stageAnswers['rail_q_tariffs_open']),
    asNonEmptyString(stageAnswers['rail_q_benefits_open']),
    asNonEmptyString(stageAnswers['rail_q4']),
    asNonEmptyString(stageAnswers['rail_q5']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()
  const oversizedCorpus = [
    asNonEmptyString(stageAnswers['oversized_q_project_permits_open']),
    asNonEmptyString(stageAnswers['oversized_q_liability_open']),
    asNonEmptyString(stageAnswers['oversized_q_escort_open']),
    asNonEmptyString(stageAnswers['oversized_q4']),
    asNonEmptyString(stageAnswers['oversized_q5']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()
  const remoteCorpus = [
    asNonEmptyString(stageAnswers['remote_q_regions_open']),
    asNonEmptyString(stageAnswers['remote_q_north_delivery_open']),
    asNonEmptyString(stageAnswers['remote_q4']),
    asNonEmptyString(stageAnswers['remote_q5']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()
  const cabotageCorpus = [
    asNonEmptyString(stageAnswers['cab_q_ports_lines_open']),
    asNonEmptyString(stageAnswers['cab_q4']),
    asNonEmptyString(stageAnswers['cab_q5']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()
  const distributionCorpus = [
    asNonEmptyString(stageAnswers['dist_q_wms_open']),
    asNonEmptyString(stageAnswers['dist_q4']),
    asNonEmptyString(stageAnswers['dist_q5']),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()

  const railRatio = readModuleRatio(stageAnswers, 'domestic_rail_container')
  const hasRailDepth =
    railCorpus.includes('оператор') ||
    railCorpus.includes('линии') ||
    railCorpus.includes('этран') ||
    railCorpus.includes('гу-12') ||
    railCorpus.includes('етснг') ||
    railCorpus.includes('ставк')
  if (
    hasPrimarySpecialization(profile, 'domestic_rail_container') &&
    ((railRatio != null && railRatio < 0.4) || !hasRailDepth)
  ) {
    flags.push({
      id: 106,
      type: 'ORANGE',
      packageId: 'domestic_rail_container',
      description:
        'Заявлен опыт ЖД/контейнеров, но ответы не подтверждают глубину (операторы, тарифы, терминальные процессы)',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const oversizedRatio = readModuleRatio(stageAnswers, 'domestic_oversized_heavy')
  const hasOversizedDepth =
    oversizedCorpus.includes('разреш') ||
    oversizedCorpus.includes('осев') ||
    oversizedCorpus.includes('маршрут') ||
    oversizedCorpus.includes('сопровожд') ||
    oversizedCorpus.includes('габарит')
  if (
    hasPrimarySpecialization(profile, 'domestic_oversized_heavy') &&
    ((oversizedRatio != null && oversizedRatio >= 0.3 && oversizedRatio < 0.45) || !hasOversizedDepth)
  ) {
    flags.push({
      id: 107,
      type: 'ORANGE',
      packageId: 'domestic_oversized_heavy',
      description:
        'Заявлен опыт негабарита/тяжеловеса, но недостаточно глубины по разрешениям, маршруту и ограничениям',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const remoteRatio = readModuleRatio(stageAnswers, 'domestic_remote_regions')
  const hasRemoteDepth =
    remoteCorpus.includes('зимник') ||
    remoteCorpus.includes('навигац') ||
    remoteCorpus.includes('северн') ||
    remoteCorpus.includes('последн') ||
    remoteCorpus.includes('сезон')
  if (
    hasPrimarySpecialization(profile, 'domestic_remote_regions') &&
    ((remoteRatio != null && remoteRatio < 0.45) || !hasRemoteDepth)
  ) {
    flags.push({
      id: 108,
      type: 'ORANGE',
      packageId: 'domestic_remote_regions',
      description:
        'Заявлен опыт труднодоступных направлений, но не раскрыты сезонность, навигация и последняя миля',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const cabotageRatio = readModuleRatio(stageAnswers, 'domestic_cabotage')
  const hasCabotageDepth =
    cabotageCorpus.includes('порт') ||
    cabotageCorpus.includes('линии') ||
    cabotageCorpus.includes('коносам') ||
    cabotageCorpus.includes('хранен') ||
    cabotageCorpus.includes('фрахт')
  if (
    hasPrimarySpecialization(profile, 'domestic_cabotage') &&
    ((cabotageRatio != null && cabotageRatio < 0.45) || !hasCabotageDepth)
  ) {
    flags.push({
      id: 109,
      type: 'ORANGE',
      packageId: 'domestic_cabotage',
      description:
        'Заявлен опыт каботажа, но не подтверждена глубина по портам, линии, документам и расходам',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const distributionRatio = readModuleRatio(stageAnswers, 'domestic_distribution')
  const hasDistributionDepth =
    distributionCorpus.includes('окн') ||
    distributionCorpus.includes('otif') ||
    distributionCorpus.includes('sla') ||
    distributionCorpus.includes('wms') ||
    distributionCorpus.includes('штрих') ||
    distributionCorpus.includes('документ')
  if (
    hasPrimarySpecialization(profile, 'domestic_distribution') &&
    ((distributionRatio != null && distributionRatio < 0.45) || !hasDistributionDepth)
  ) {
    flags.push({
      id: 110,
      type: 'ORANGE',
      packageId: 'domestic_distribution',
      description:
        'Заявлен большой опыт развозки, но ответы поверхностны по SLA/OTIF, окнам, WMS и документообороту',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const peakShipments = stageAnswers['q_peak_shipments_per_day']
  const cargoTypes = asNonEmptyStringArray(stageAnswers['q_cargo_types'])
  const openAnswerCorpus = getOpenAnswerCorpus(stageAnswers)
  const averageOpenScore = readAverageOpenScore(stageAnswers)
  const hasHighDeclaredVolume = peakShipments === '6–10' || peakShipments === '10+'
  const hasWideCargoBreadth = cargoTypes.length >= 4
  const mentionsCarrierChecks =
    openAnswerCorpus.includes('ати') ||
    openAnswerCorpus.includes('светофор') ||
    openAnswerCorpus.includes('контур') ||
    openAnswerCorpus.includes('сбис') ||
    openAnswerCorpus.includes('егрюл') ||
    openAnswerCorpus.includes('фнс')
  const mentionsDocuments =
    openAnswerCorpus.includes('ттн') ||
    openAnswerCorpus.includes('трн') ||
    openAnswerCorpus.includes('договор') ||
    openAnswerCorpus.includes('заявк') ||
    openAnswerCorpus.includes('эдо') ||
    openAnswerCorpus.includes('доверен')
  const seemsShallow =
    (averageOpenScore != null && averageOpenScore < MIN_ACCEPTABLE_OPEN_SCORE) ||
    (openAnswerCorpus.length > 0 &&
      openAnswerCorpus.split(/\s+/).filter(Boolean).length < MIN_OPEN_ANSWER_WORD_COUNT) ||
    (!mentionsCarrierChecks && !mentionsDocuments)

  if ((hasHighDeclaredVolume || hasWideCargoBreadth) && seemsShallow) {
    flags.push({
      id: 104,
      type: 'ORANGE',
      description: 'Заявленный объём или широта опыта не подтверждены глубиной открытых ответов',
      impact: 'MANUAL_REVIEW_HR',
    })
  }

  const claimsSpecialCargo =
    cargoTypes.includes('опасные/ADR') || cargoTypes.includes('негабарит')
  const mentionsSpecialRequirements =
    openAnswerCorpus.includes('разреш') ||
    openAnswerCorpus.includes('маршрут') ||
    openAnswerCorpus.includes('согласован') ||
    openAnswerCorpus.includes('сопровожд') ||
    openAnswerCorpus.includes('доопог') ||
    openAnswerCorpus.includes('adr')
  if (claimsSpecialCargo && !mentionsSpecialRequirements) {
    flags.push({
      id: 105,
      type: 'ORANGE',
      description: 'Заявлены ADR/негабарит, но в ответах нет признаков знания спецтребований',
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
