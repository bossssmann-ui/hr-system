import { callGeminiGenerateContent } from '../../integrations/llm/gemini'
import type { FetchLike } from '../../integrations/llm/gemini'
import type { SpecializationAssignment, SpecializationPackageId } from './domestic-specializations'

export interface InterviewQuestion {
  key: string
  text: string
  type: 'textarea'
  hint?: string
}

export interface InterviewClassification {
  specializations: SpecializationAssignment[]
  riskFlags: string[]
  geminiRaw?: unknown
}

// Базовые вопросы для всех domestic логистов (из spec раздел domestic_core_operations)
const CORE_QUESTIONS: InterviewQuestion[] = [
  { key: 'core_q1', type: 'textarea', text: 'Опишите последнюю перевозку, которую вы вели от заявки до закрывающих документов. Что именно делали вы?' },
  { key: 'core_q2', type: 'textarea', text: 'Какие данные о грузе вы обязательно уточняете до поиска транспорта?' },
  { key: 'core_q3', type: 'textarea', text: 'Что должно быть в заявке перевозчику?' },
  { key: 'core_q4', type: 'textarea', text: 'Что вы делаете, если склад сообщает о повреждении паллеты перед погрузкой?' },
  { key: 'core_q5', type: 'textarea', text: 'Что вы делаете, если получатель принял груз с расхождением по количеству мест?' },
  { key: 'core_q6', type: 'textarea', text: 'Когда нужно сообщать клиенту о риске срыва доставки?' },
]

// Дополнительные вопросы по специализациям (из spec)
const PACKAGE_QUESTIONS: Partial<Record<SpecializationPackageId, InterviewQuestion[]>> = {
  domestic_road_ftl_ltl: [
    { key: 'road_q1', type: 'textarea', text: 'Какие типы машин вы подбирали чаще всего и под какие грузы?' },
    { key: 'road_q2', type: 'textarea', text: 'Как проверяете перевозчика перед постановкой на рейс?' },
    { key: 'road_q3', type: 'textarea', text: 'Что делаете, если машина сорвала подачу за 2 часа до погрузки?' },
  ],
  domestic_distribution: [
    { key: 'dist_q1', type: 'textarea', text: 'Сколько точек в день вы обычно вели на одного водителя или маршрут?' },
    { key: 'dist_q2', type: 'textarea', text: 'Что делаете, если одна точка задерживает весь маршрут?' },
    { key: 'dist_q3', type: 'textarea', text: 'Как фиксируете отказ получателя принять груз?' },
  ],
  domestic_rail_container: [
    { key: 'rail_q1', type: 'textarea', text: 'Какие ЖД или контейнерные перевозки вы реально организовывали?' },
    { key: 'rail_q2', type: 'textarea', text: 'Что проверяете до выбора контейнерной схемы?' },
    { key: 'rail_q3', type: 'textarea', text: 'Что делаете, если контейнер задержался на станции назначения?' },
  ],
  domestic_oversized_heavy: [
    { key: 'over_q1', type: 'textarea', text: 'Какие негабаритные или тяжеловесные грузы вы реально перевозили? Назовите габариты и вес хотя бы одного.' },
    { key: 'over_q2', type: 'textarea', text: 'Кто занимался разрешениями и маршрутом: вы, подрядчик или перевозчик?' },
    { key: 'over_q3', type: 'textarea', text: 'Что контролировали при погрузке и креплении?' },
  ],
  domestic_remote_regions: [
    { key: 'remote_q1', type: 'textarea', text: 'В какие труднодоступные регионы вы организовывали доставки?' },
    { key: 'remote_q2', type: 'textarea', text: 'Какие сезонные ограничения учитывали?' },
    { key: 'remote_q3', type: 'textarea', text: 'Что делали, если окно доставки закрывалось?' },
  ],
  domestic_cabotage: [
    { key: 'cab_q1', type: 'textarea', text: 'С какими портами РФ вы работали?' },
    { key: 'cab_q2', type: 'textarea', text: 'Что делали при задержке судна или закрытии порта по погоде?' },
    { key: 'cab_q3', type: 'textarea', text: 'Как организовывали доставку от порта до конечного получателя?' },
  ],
}

export function buildInterviewQuestions(
  specializations: SpecializationAssignment[]
): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [...CORE_QUESTIONS]
  const seenKeys = new Set(CORE_QUESTIONS.map(q => q.key))

  for (const spec of specializations) {
    if (spec.packageId === 'domestic_core_operations') continue
    const pkgQs = PACKAGE_QUESTIONS[spec.packageId] ?? []
    for (const q of pkgQs) {
      if (!seenKeys.has(q.key)) {
        questions.push(q)
        seenKeys.add(q.key)
      }
    }
  }

  return questions
}

const CLASSIFY_SYSTEM_PROMPT = `Ты — оценщик глубины опыта логиста.
Проанализируй ответы кандидата на вопросы AI-собеседования.
Для каждой специализации определи уровень: primary / secondary / mentioned_only / contradicted.
Поставь флаги риска из этого списка если применимо:
oversized_depth_risk, remote_region_depth_risk, cabotage_depth_risk —
только если кандидат заявил специализацию но не смог объяснить базовую последовательность.
Верни строго JSON без markdown: { "specializations": [...], "riskFlags": [...] }`

export async function classifyInterviewAnswers(
  specializations: SpecializationAssignment[],
  answers: Record<string, string>,
  apiKey: string,
  fetchImpl?: FetchLike
): Promise<InterviewClassification> {
  try {
    const userText = JSON.stringify({ specializations, answers })
    const result = await callGeminiGenerateContent({
      apiKey,
      model: 'gemini-2.0-flash',
      systemInstruction: CLASSIFY_SYSTEM_PROMPT,
      userText,
      fetchImpl,
    })

    const parsed = JSON.parse(result.text)
    if (
      Array.isArray(parsed?.specializations) &&
      Array.isArray(parsed?.riskFlags)
    ) {
      return {
        specializations: parsed.specializations as SpecializationAssignment[],
        riskFlags: parsed.riskFlags as string[],
        geminiRaw: result.raw,
      }
    }
  } catch {
    // graceful fallback
  }

  return { specializations, riskFlags: [] }
}
