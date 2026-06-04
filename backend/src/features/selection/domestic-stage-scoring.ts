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
import type { AppEnv } from '../../env'
import { createAssessmentProvider, isAiScoringConfigured } from '../../integrations/llm'
import { canTransition, type ApplicationStage } from '../applications/applications.fsm'
import { notifyRecruitersAboutSelectionReady } from '../applications/application-notifications'
import { asNonEmptyString } from './domestic-answer-helpers'
import {
  computeDomesticCrossCheckFlags,
} from './domestic-cross-check'
import {
  scoreDomesticHardSkillFactology,
  scoreDomesticAssessment,
  shouldAdmitToLiveInterview,
  type DomesticScoringWeightCaps,
  type DomesticAdmissionVerdict,
  type DomesticAssessmentProfile,
  type DomesticCrossCheckFlag,
  type DomesticScoringResult,
  type RawModuleResult,
  type SpecializationAssignment,
} from './domestic-scoring'
import { getDomesticStageContent } from './domestic-stage-content'
import type { TestStageContent } from './stage-content'
import { buildRetentionPrediction, type RetentionPrediction } from './retention-prediction'
import {
  DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS,
  getActiveSelectionScoringWeights,
} from './retention-calibration'

const CARGO_LAYOUT_BONUS_ELIGIBLE_PACKAGES = new Set<string>([
  'domestic_road_ftl_ltl',
  'domestic_oversized_heavy',
  'domestic_rail_container',
])

export const CARGO_LAYOUT_RECRUITER_FLAG = 'cargo_layout_test_required'
const VERDICT_ADMIT = 'ДОПУСТИТЬ'
const VERDICT_REJECT = 'ОТКЛОНИТЬ'
const AUTOMATION_STAGE_ROLES = ['recruiter', 'hr_admin', 'owner'] as const

type CargoLayoutEvaluation = {
  claimedSelfLayout: boolean
  hasConcreteEvidence: boolean
}

export function evaluateCargoLayoutExperience(answer: unknown): CargoLayoutEvaluation {
  const text = asNonEmptyString(answer)
  if (!text) return { claimedSelfLayout: false, hasConcreteEvidence: false }

  const normalized = text.toLowerCase()
  const hasNegativeClaim =
    normalized.includes('не делал') ||
    normalized.includes('не занимал') ||
    normalized.includes('не выполнял') ||
    normalized.includes('нет')
  const claimedSelfLayout =
    !hasNegativeClaim &&
    (normalized.includes('да') ||
      normalized.includes('сам') ||
      normalized.includes('самостоятель') ||
      normalized.includes('делал') ||
      normalized.includes('расклад'))

  const hasToolMention =
    normalized.includes('excel') ||
    normalized.includes('эксель') ||
    normalized.includes('1с') ||
    normalized.includes('wms') ||
    normalized.includes('tms') ||
    normalized.includes('planner') ||
    normalized.includes('программ')
  const hasVolumeMention =
    /\d/.test(normalized) ||
    normalized.includes('паллет') ||
    normalized.includes('тонн') ||
    normalized.includes('тн') ||
    normalized.includes('м3') ||
    normalized.includes('куб') ||
    normalized.includes('мест')
  const hasCargoMention =
    normalized.includes('груз') ||
    normalized.includes('оборуд') ||
    normalized.includes('контейнер') ||
    normalized.includes('негабарит') ||
    normalized.includes('строймат') ||
    normalized.includes('металл') ||
    normalized.includes('продукт')

  return {
    claimedSelfLayout,
    hasConcreteEvidence: claimedSelfLayout && hasToolMention && hasVolumeMention && hasCargoMention,
  }
}

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
  const cargoLayout = evaluateCargoLayoutExperience(answers['q_cargo_layout_experience'])
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
    if (CARGO_LAYOUT_BONUS_ELIGIBLE_PACKAGES.has(spec.packageId) && cargoLayout.hasConcreteEvidence) {
      rawScore += 1
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

type OpenAnswerGrade = {
  key: string
  question: string
  score: number
  rationale: string
}

type OpenAnswerGradingProvider = {
  gradeOpenAnswer: (input: {
    question: string
    rubric: string
    answer: string
  }) => Promise<{ score: number; rationale: string }>
}

const DOMESTIC_OPEN_QUESTION_CONFIG = [
  {
    key: 'q_new_carrier_check',
    question: 'Как вы ищете и проверяете нового перевозчика, которому впервые отдаёте груз?',
    rubric:
      'Оцени глубину ответа логиста по шкале 0-100. Высокий балл требует конкретной последовательности действий: поиск перевозчика, проверка рейтинга/рисков (например, АТИ Светофор), проверка юрлица и документов, страховки/ЭДО/ЭЦП, отзывов/истории работы, резервного плана. Низкий балл — общие слова без инструментов, документов и критериев риска.',
  },
  {
    key: 'q_contract_risk_signs',
    question: 'По каким признакам в заявке/договоре вы видите риск срыва перевозки?',
    rubric:
      'Оцени глубину ответа по шкале 0-100. Сильный ответ называет конкретные красные флаги: неполные условия заявки, окна погрузки/выгрузки, штрафы, неопределённый груз, несогласованные простои/доплаты, документы, ответственность сторон, требования к машине/водителю. Слабый ответ — абстрактные формулировки без деталей договора и логистических рисков.',
  },
  {
    key: 'q_hardest_shipment',
    question: 'Расскажите про самую сложную перевозку в вашей практике и как вы решали проблему.',
    rubric:
      'Оцени глубину ответа по шкале 0-100. Сильный ответ содержит контекст перевозки, ограничения, тип груза/маршрут, документы, переговоры, принятые решения, результат и выводы. Слабый ответ — короткий пересказ без цифр, ограничений, действий и результата.',
  },
  {
    key: 'q_breakdown_500km',
    question: 'Машина с грузом сломалась в пути в 500 км, водитель недоступен 2 часа — ваши действия?',
    rubric:
      'Оцени ответ по шкале 0-100. Сильный ответ включает контроль статуса груза и связи, уведомление клиента/склада, поиск резервного перевозчика или перегруза, фиксацию инцидента, проверку документов и SLA, оценку рисков срока/сохранности и дальнейший мониторинг. Слабый ответ — только общие слова без конкретного плана действий.',
  },
  {
    key: 'rail_q_operators_open',
    question: 'С какими операторами/экспедиторами и контейнерными линиями вы реально работали?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: реальные операторы/линии, примеры направлений/контейнеров, роли кандидата. Слабый: общие фразы без конкретных названий и процесса.',
  },
  {
    key: 'rail_q_tariffs_open',
    question: 'Откуда брали ставки ЖД-тарифов и как часто обновляли у поставщиков?',
    rubric:
      'Оцени глубину по шкале 0-100. Высокий балл: конкретные источники тарифов (операторы/экспедиторы/терминалы/системы), периодичность обновлений, валидация ставок и ответственность кандидата. Низкий: "получал готовое" без деталей.',
  },
  {
    key: 'rail_q_benefits_open',
    question: 'Что знаете о льготных категориях груза и понижающих коэффициентах по ЖД?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: понимание льгот/исключительных тарифов, понижающих коэффициентов по грузам/направлениям и влияния на калькуляцию. Слабый: отсутствие предметных терминов и практики.',
  },
  {
    key: 'oversized_q_project_permits_open',
    question: 'Что такое проектные разрешения и при каких габаритах/массе они нужны?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: критерии применения проектных разрешений, маршрутные согласования, сроки оформления и ограничения движения. Слабый: неопределённые формулировки без регуляторики.',
  },
  {
    key: 'oversized_q_liability_open',
    question: 'Когда ответственность за перевес/негабарит на экспедиторе, а когда на перевозчике?',
    rubric:
      'Оцени глубину по шкале 0-100. Высокий балл: разделение ответственности по договору-заявке (достоверность данных, разрешения, крепление, соблюдение режима в пути), примеры рисков и действий. Низкий: "все отвечают одинаково".',
  },
  {
    key: 'oversized_q_escort_open',
    question: 'Когда обязательно сопровождение (машины прикрытия/ГИБДД) и от чего это зависит?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: зависимость от превышений габаритов/условий разрешения, планирование сопровождения и ограничений. Слабый: без критериев и без понимания процедур.',
  },
  {
    key: 'remote_q_regions_open',
    question: 'Какие районы РФ относите к труднодоступным и почему?',
    rubric:
      'Оцени глубину по шкале 0-100. Высокий балл: корректные примеры регионов/населённых пунктов, связь с северным завозом/навигацией/отсутствием круглогодичной дороги. Низкий: общие слова без географии.',
  },
  {
    key: 'remote_q_north_delivery_open',
    question: 'Как северный завоз и навигационные окна влияют на планирование?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: сезонные окна, буфер сроков, резервные сценарии, хранение, последняя миля. Слабый: игнорирование сезонности и навигации.',
  },
  {
    key: 'cab_q_ports_lines_open',
    question: 'С какими портами и линиями работали и какие портовые расходы кроме фрахта учитывали?',
    rubric:
      'Оцени глубину по шкале 0-100. Сильный ответ: реальные порты/линии, детализация расходов (терминальная обработка, хранение, вывоз, сверхнорматив) и процесс координации. Слабый: без конкретики.',
  },
  {
    key: 'dist_q_wms_open',
    question: 'Работали ли с WMS / сканированием / штрихкодами при развозке? Как именно?',
    rubric:
      'Оцени глубину по шкале 0-100. Высокий балл: реальные сценарии работы с WMS/ТСД/штрихкодами, влияние на SLA/OTIF, фиксацию расхождений. Низкий: декларативный ответ без примеров.',
  },
] as const
const HEURISTIC_WORD_COUNT_MULTIPLIER = 1.5
const HEURISTIC_KEYWORD_HIT_POINTS = 8
const HEURISTIC_MAX_KEYWORD_BONUS = 40

function getOpenAnswerText(answers: Record<string, unknown>, key: string): string | null {
  if (key === 'q_breakdown_500km') {
    // Keep reading the legacy `road_q4` key so in-flight sessions created
    // before the shared breakdown question was introduced still grade cleanly.
    return asNonEmptyString(answers['q_breakdown_500km']) ?? asNonEmptyString(answers['road_q4'])
  }
  return asNonEmptyString(answers[key])
}

/**
 * Fallback scoring for domestic open answers when Anthropic grading is not
 * configured. It rewards answer length plus domain-specific keywords so the
 * deterministic verdict still reacts to obviously shallow vs. concrete
 * responses, but `gradeOpenAnswer` remains the primary path whenever AI
 * scoring is enabled. The current tuning lets ~67 words saturate the length
 * portion (67 × 1.5 ≈ 100) while keyword hits add up to 40 bonus points to
 * reward logistics-specific specificity instead of generic prose.
 */
function estimateDomesticOpenAnswerScore(answer: string, key: string) {
  const normalized = answer.toLowerCase()
  const wordCount = normalized.split(/\s+/).filter(Boolean).length
  const keywordMap: Record<string, string[]> = {
    q_new_carrier_check: [
      'ати',
      'светофор',
      'контур',
      'сбис',
      'егрюл',
      'фнс',
      'инн',
      'страх',
      'эдо',
      'эцп',
      'документ',
      'договор',
      'отзыв',
    ],
    q_contract_risk_signs: [
      'окн',
      'погруз',
      'выгруз',
      'штраф',
      'простой',
      'доплат',
      'вес',
      'габарит',
      'температур',
      'документ',
      'договор',
      'заявк',
      'ответствен',
    ],
    q_hardest_shipment: [
      'маршрут',
      'клиент',
      'перевоз',
      'груз',
      'проблем',
      'решил',
      'документ',
      'срок',
      'ставк',
      'резерв',
      'перегруз',
      'погруз',
      'выгруз',
    ],
    q_breakdown_500km: [
      'клиент',
      'водител',
      'связ',
      'резерв',
      'перегруз',
      'эваку',
      'страх',
      'груз',
      'срок',
      'склад',
      'документ',
      'монитор',
      'gps',
    ],
    rail_q_operators_open: [
      'оператор',
      'линии',
      'контейнер',
      'терминал',
      'жд',
      'платформ',
      'экспедитор',
    ],
    rail_q_tariffs_open: ['ставк', 'тариф', 'оператор', 'обновл', 'этран', 'запрос', 'калькуляц'],
    rail_q_benefits_open: ['льгот', 'коэффиц', 'тариф', 'груз', 'направлен'],
    oversized_q_project_permits_open: [
      'проект',
      'разреш',
      'габарит',
      'масса',
      'маршрут',
      'согласован',
      'росавтодор',
    ],
    oversized_q_liability_open: [
      'ответствен',
      'экспедитор',
      'перевозчик',
      'договор',
      'креплен',
      'перевес',
      'разреш',
    ],
    oversized_q_escort_open: ['сопровожд', 'прикрыти', 'гибдд', 'габарит', 'разреш', 'маршрут'],
    remote_q_regions_open: ['якут', 'чукот', 'камчат', 'северн', 'завоз', 'зимник', 'навигац'],
    remote_q_north_delivery_open: ['навигац', 'окно', 'сезон', 'завоз', 'буфер', 'последн', 'хранен'],
    cab_q_ports_lines_open: ['порт', 'линии', 'фрахт', 'коносам', 'хранен', 'терминал', 'вывоз'],
    dist_q_wms_open: ['wms', 'скан', 'штрих', 'тсд', 'otif', 'sla', 'расхожд', 'документ'],
  }
  const keywords = keywordMap[key] ?? []
  const keywordHits = keywords.filter((token) => normalized.includes(token)).length
  const base = Math.min(100, wordCount * HEURISTIC_WORD_COUNT_MULTIPLIER)
  const keywordBonus = Math.min(
    HEURISTIC_MAX_KEYWORD_BONUS,
    keywordHits * HEURISTIC_KEYWORD_HIT_POINTS,
  )
  return Math.max(0, Math.min(100, base + keywordBonus))
}

export async function gradeDomesticOpenAnswers(input: {
  answers: Record<string, unknown>
  env?: AppEnv
  provider?: OpenAnswerGradingProvider
}) {
  const { answers, env, provider } = input
  const gradingProvider =
    provider ?? (env && isAiScoringConfigured(env) ? createAssessmentProvider(env) : null)

  const grades: OpenAnswerGrade[] = []
  for (const item of DOMESTIC_OPEN_QUESTION_CONFIG) {
    const answer = getOpenAnswerText(answers, item.key)
    if (!answer) continue
    if (gradingProvider) {
      const grade = await gradingProvider.gradeOpenAnswer({
        question: item.question,
        rubric: item.rubric,
        answer,
      })
      grades.push({ key: item.key, question: item.question, score: grade.score, rationale: grade.rationale })
      continue
    }
    grades.push({
      key: item.key,
      question: item.question,
      score: estimateDomesticOpenAnswerScore(answer, item.key),
      rationale: 'Fallback heuristic score derived from answer specificity.',
    })
  }

  return grades
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
  openAnswerGrades?: Array<{ key: string; question: string; score: number; rationale: string }>
  hardSkillFactologyScore?: number
  resumeAndInterviewScore?: number
  scoringWeightCaps?: DomesticScoringWeightCaps
}

export interface DomesticVerdictComputation {
  totalScore: number
  admission: DomesticAdmissionVerdict
  status: DomesticSessionStatus
  verdictLabel: DomesticVerdictLabel
  flags: DomesticCrossCheckFlag[]
  moduleResults: RawModuleResult[]
  stageScores: DomesticScoringResult
  retentionPrediction: RetentionPrediction
  recruiterChecklistFlags: string[]
}

export function computeDomesticVerdict(
  inputs: DomesticVerdictInputs,
): DomesticVerdictComputation {
  const { specializations, riskFlags, moduleResults, mergedAnswers, scoringWeightCaps } = inputs
  const hasSecondary = specializations.some((s) => s.level === 'secondary')

  const components = deriveProvisionalComponents(moduleResults, riskFlags, hasSecondary)

  const profile: DomesticAssessmentProfile = {
    candidateId: inputs.candidateId ?? '',
    signals: [],
    specializations,
    riskFlags,
    hardSkillFactologyScore: inputs.hardSkillFactologyScore,
    resumeAndInterviewScore: inputs.resumeAndInterviewScore ?? components.resumeAndInterviewScore,
    communicationScore: components.communicationScore,
    practicalScore: components.practicalScore,
  }

  // Surface module raw/max scores as `${packageId}.rawScore` / `.maxScore`
  // entries in the answers map so `computeDomesticCrossCheckFlags` can reason
  // about per-package performance (e.g. RED-3: claimed primary oversized but
  // scored < 30 % on that module).
  const crossCheckAnswers: Record<string, unknown> = { ...mergedAnswers }
  if (inputs.openAnswerGrades) {
    crossCheckAnswers['open_answer_grades'] = inputs.openAnswerGrades
  }
  for (const r of moduleResults) {
    crossCheckAnswers[`${r.packageId}.rawScore`] = r.rawScore
    crossCheckAnswers[`${r.packageId}.maxScore`] = r.maxScore
  }

  const flags = computeDomesticCrossCheckFlags(profile, crossCheckAnswers)
  const scoring = scoreDomesticAssessment(profile, moduleResults, scoringWeightCaps)
  const admission = shouldAdmitToLiveInterview(scoring.totalScore, flags)
  const status = admissionToStatus(admission)
  const verdictLabel = admissionToVerdictLabel(admission)
  const cargoLayout = evaluateCargoLayoutExperience(mergedAnswers['q_cargo_layout_experience'])
  const recruiterChecklistFlags =
    cargoLayout.claimedSelfLayout &&
    (admission === 'STRONG_CANDIDATE' || admission === 'ADMIT_TO_INTERVIEW')
      ? [CARGO_LAYOUT_RECRUITER_FLAG]
      : []
  const retentionPrediction = buildRetentionPrediction({
    stageScores: scoring,
    crossCheckFlags: flags,
    riskFlags,
  })

  return {
    totalScore: scoring.totalScore,
    admission,
    status,
    verdictLabel,
    flags,
    moduleResults,
    stageScores: scoring,
    retentionPrediction,
    recruiterChecklistFlags,
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
  env?: AppEnv,
  provider?: OpenAnswerGradingProvider,
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

  const activeWeightCaps = await getActiveSelectionScoringWeights(prisma, session.tenantId)
  const effectiveWeightCaps = activeWeightCaps ?? DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS
  const factology = scoreDomesticHardSkillFactology(mergedAnswers)
  const hardSkillFactologyScore =
    factology.maxScore > 0
      ? (factology.rawScore / factology.maxScore) * effectiveWeightCaps.hardSkillFactology
      : 0
  const openAnswerGrades = await gradeDomesticOpenAnswers({
    answers: mergedAnswers,
    env,
    provider,
  })
  const openAnswerAverage =
    openAnswerGrades.length > 0
      ? openAnswerGrades.reduce((sum, item) => sum + item.score, 0) / openAnswerGrades.length
      : null

  const computation = computeDomesticVerdict({
    candidateId: session.applicationId ?? session.id,
    specializations,
    riskFlags,
    moduleResults,
    mergedAnswers,
    openAnswerGrades,
    hardSkillFactologyScore,
    resumeAndInterviewScore:
      openAnswerAverage == null
        ? undefined
        : (openAnswerAverage / 100) * effectiveWeightCaps.resumeAndInterview,
    scoringWeightCaps: effectiveWeightCaps,
  })

  const stageScoresJson = {
    hardSkillFactologyScore: computation.stageScores.hardSkillFactologyScore,
    resumeAndInterviewScore: computation.stageScores.resumeAndInterviewScore,
    coreOperationsScore: computation.stageScores.coreOperationsScore,
    primarySpecScore: computation.stageScores.primarySpecScore,
    secondarySpecScore: computation.stageScores.secondarySpecScore,
    practicalAssignmentScore: computation.stageScores.practicalAssignmentScore,
    communicationScore: computation.stageScores.communicationScore,
    totalScore: computation.stageScores.totalScore,
    moduleResults: computation.moduleResults,
    openAnswerGrades,
    admission: computation.admission,
    recruiterChecklistFlags: computation.recruiterChecklistFlags,
  } as unknown as Prisma.InputJsonValue
  const hrNotes = buildDomesticHrNotes({
    specializations,
    riskFlags,
    crossCheckFlags: computation.flags,
    stageScores: computation.stageScores,
    openAnswerGrades,
  })

  const currentChecklistFlags = Array.isArray(assessmentProfile['recruiterChecklistFlags'])
    ? (assessmentProfile['recruiterChecklistFlags'] as unknown[]).filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  const mergedChecklistFlags = Array.from(
    new Set([...currentChecklistFlags, ...computation.recruiterChecklistFlags]),
  )

  await prisma.selectionSession.update({
    where: { id: session.id },
    data: {
      assessmentProfile: {
        ...assessmentProfile,
        recruiterChecklistFlags: mergedChecklistFlags,
      } as Prisma.InputJsonValue,
    },
  })

  await prisma.selectionVerdict.upsert({
    where: { sessionId: session.id },
    update: {
      verdict: computation.verdictLabel,
      totalWeightedScore: new Prisma.Decimal(computation.totalScore.toFixed(4)),
      stageScores: stageScoresJson,
      crossCheckFlags: computation.flags as unknown as Prisma.InputJsonValue,
      retentionPrediction: computation.retentionPrediction as unknown as Prisma.InputJsonValue,
      hrNotes,
    },
    create: {
      sessionId: session.id,
      verdict: computation.verdictLabel,
      totalWeightedScore: new Prisma.Decimal(computation.totalScore.toFixed(4)),
      stageScores: stageScoresJson,
      crossCheckFlags: computation.flags as unknown as Prisma.InputJsonValue,
      retentionPrediction: computation.retentionPrediction as unknown as Prisma.InputJsonValue,
      lieScaleResult: Prisma.JsonNull,
      hrNotes,
    },
  })

  await writeBackVerdictToApplication(prisma, {
    sessionId: session.id,
    tenantId: session.tenantId,
    applicationId: session.applicationId,
    verdictLabel: computation.verdictLabel,
    totalScore: computation.totalScore,
    crossCheckFlags: computation.flags as unknown as Prisma.InputJsonValue,
    recruiterChecklistFlags: mergedChecklistFlags,
    retentionPrediction: computation.retentionPrediction as unknown as Prisma.InputJsonValue,
  })

  if (env && computation.verdictLabel === VERDICT_ADMIT) {
    void notifyRecruitersAboutSelectionReady({
      prisma,
      env,
      tenantId: session.tenantId,
      applicationId: session.applicationId,
      totalScore: Number(computation.totalScore.toFixed(1)),
    })
  }

  function buildDomesticHrNotes(input: {
    specializations: SpecializationAssignment[]
    riskFlags: string[]
    crossCheckFlags: DomesticCrossCheckFlag[]
    stageScores: DomesticScoringResult
    openAnswerGrades: Array<{ key: string; question: string; score: number; rationale: string }>
  }) {
    const primarySpecs = input.specializations
      .filter((item) => item.level === 'primary')
      .map((item) => item.packageId)
    const secondarySpecs = input.specializations
      .filter((item) => item.level === 'secondary')
      .map((item) => item.packageId)
    const redFlags = input.crossCheckFlags.filter((flag) => flag.type === 'RED').map((flag) => flag.description)
    const orangeFlags = input.crossCheckFlags.filter((flag) => flag.type === 'ORANGE').map((flag) => flag.description)
    const lowOpenAnswers = input.openAnswerGrades
      .filter((item) => item.score < 60)
      .map((item) => `${item.question}: ${item.rationale}`)
    const lines = [
      `Сильные стороны: core=${input.stageScores.coreOperationsScore.toFixed(1)}, practical=${input.stageScores.practicalAssignmentScore.toFixed(1)}.`,
      `Специализации: primary=${primarySpecs.join(', ') || '—'}; secondary=${secondarySpecs.join(', ') || '—'}.`,
      `Слабые стороны: communication=${input.stageScores.communicationScore.toFixed(1)}, resume/interview=${input.stageScores.resumeAndInterviewScore.toFixed(1)}.`,
      `Спорные моменты и несоответствия: RED=${redFlags.length}; ORANGE=${orangeFlags.length}.`,
      redFlags.length > 0 ? `Выявленное враньё/критичные флаги: ${redFlags.join(' | ')}.` : 'Выявленное враньё/критичные флаги: не обнаружено.',
      orangeFlags.length > 0 ? `Наблюдения для уточнения: ${orangeFlags.join(' | ')}.` : 'Наблюдения для уточнения: нет.',
      input.riskFlags.length > 0 ? `Риски из AI-собеседования: ${input.riskFlags.join(' | ')}.` : 'Риски из AI-собеседования: нет.',
      lowOpenAnswers.length > 0 ? `Открытые ответы на проверку: ${lowOpenAnswers.join(' | ')}.` : 'Открытые ответы на проверку: без существенных замечаний.',
    ]
    return lines.join('\n')
  }

  return computation
}

async function writeBackVerdictToApplication(
  prisma: DbClient,
  input: {
    sessionId: string
    tenantId: string
    applicationId: string | null
    verdictLabel: string
    totalScore: number
    crossCheckFlags: Prisma.InputJsonValue
    recruiterChecklistFlags: string[]
    retentionPrediction: Prisma.InputJsonValue
  },
) {
  if (!input.applicationId) return
  const application = await prisma.application.findFirst({
    where: {
      id: input.applicationId,
      tenantId: input.tenantId,
    },
  })
  if (!application) return

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: input.tenantId },
    select: { featureFlags: true },
  })
  const automationActorUserId = await resolveAutomationActorUserId(prisma, {
    tenantId: input.tenantId,
    assignedToUserId: application.assignedToUserId,
  })
  const featureFlags = asRecord(settings?.featureFlags)
  const autoAdvanceEnabled = featureFlags['selection.autoAdvance.enabled'] === true
  const autoRejectEnabled = featureFlags['selection.autoReject.enabled'] === true

  let moveToStage: ApplicationStage | null = null
  if (
    automationActorUserId &&
    input.verdictLabel === VERDICT_ADMIT &&
    autoAdvanceEnabled &&
    application.stage === 'new' &&
    canTransition(application.stage as ApplicationStage, 'screen', AUTOMATION_STAGE_ROLES)
  ) {
    moveToStage = 'screen'
  } else if (
    automationActorUserId &&
    input.verdictLabel === VERDICT_REJECT &&
    autoRejectEnabled &&
    canTransition(application.stage as ApplicationStage, 'rejected', AUTOMATION_STAGE_ROLES)
  ) {
    moveToStage = 'rejected'
  }

  const aiAssessedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: application.id },
      data: {
        aiScore: new Prisma.Decimal(input.totalScore.toFixed(4)),
        aiVerdict: input.verdictLabel,
        aiAssessedAt,
        aiFlags: {
          selectionSessionId: input.sessionId,
          aiQualifiedForRecruiter: input.verdictLabel === VERDICT_ADMIT,
          crossCheckFlags: input.crossCheckFlags,
          recruiterChecklistFlags: input.recruiterChecklistFlags,
          retentionPrediction: input.retentionPrediction,
        } as Prisma.InputJsonValue,
        ...(moveToStage ? { stage: moveToStage } : {}),
      },
    })

    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: automationActorUserId ?? null,
        action: 'application.ai_assessed',
        entityType: 'Application',
        entityId: application.id,
        diff: {
          aiScore: Number(input.totalScore.toFixed(4)),
          aiVerdict: input.verdictLabel,
          movedToStage: moveToStage,
        },
      },
    })

    if (moveToStage && automationActorUserId) {
      await tx.applicationStageEvent.create({
        data: {
          tenantId: input.tenantId,
          applicationId: application.id,
          fromStage: application.stage as ApplicationStage,
          toStage: moveToStage,
          actorUserId: automationActorUserId,
          comment: `Auto-moved by selection verdict: ${input.verdictLabel}`,
        },
      })
      await tx.auditEvent.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: automationActorUserId ?? null,
          action: 'application.move_stage',
          entityType: 'Application',
          entityId: application.id,
          diff: {
            from: application.stage,
            to: moveToStage,
            comment: 'Auto-moved by selection verdict',
            actorUserId: automationActorUserId ?? null,
          },
        },
      })
    }

  })
}

async function resolveAutomationActorUserId(
  prisma: DbClient,
  input: { tenantId: string; assignedToUserId: string | null },
) {
  if (input.assignedToUserId) return input.assignedToUserId
  const actor = await prisma.userRole.findFirst({
    where: {
      tenantId: input.tenantId,
      role: {
        in: ['recruiter', 'hr_admin', 'owner'],
      },
    },
    select: { userId: true },
  })
  return actor?.userId ?? null
}
