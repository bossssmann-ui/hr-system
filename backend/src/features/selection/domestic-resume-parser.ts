import { callGeminiGenerateContent, type FetchLike } from '../../integrations/llm/gemini'

export interface ResumeParseResult {
  signals: string[]
  rawText: string
  geminiRaw?: unknown
}

export interface AiWritingDetectionResult {
  score: number          // 0–100, где 100 = точно ИИ
  detected: boolean      // true если score >= 70
  signals: string[]      // признаки: ['Нет конкретных дат', 'Шаблонные формулировки', ...]
  trapQuestions: string[] // 3–5 вопросов-ловушек для рекрутера
}

const SYSTEM_PROMPT = `Ты — парсер резюме логиста. Извлеки сигналы специализации из текста резюме.
Верни JSON-массив строк — только ключевые термины из этого списка:
FTL, LTL, сборные, ATI, генгруз, развозка, маршруты, окна доставки, SLA,
ЖД, контейнер, станция, терминал, ЭТРАН, негабарит, тяжеловес, трал,
Север, Якутия, Камчатка, Чукотка, зимник, переправа, каботаж, Сахалин, Магадан.
Только термины которые ЯВНО упомянуты. Формат: ["сигнал1", "сигнал2"]. Без пояснений.`

export async function parseResume(
  resumeText: string,
  apiKey: string,
  fetchImpl?: FetchLike
): Promise<ResumeParseResult> {
  if (!resumeText.trim()) return { signals: [], rawText: resumeText }

  const result = await callGeminiGenerateContent({
    apiKey,
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
    userText: resumeText,
    fetchImpl,
  })

  let signals: string[] = []
  try {
    const parsed = JSON.parse(result.text)
    if (Array.isArray(parsed)) {
      signals = parsed.filter((s): s is string => typeof s === 'string')
    }
  } catch {
    // не массив — возвращаем пустой
  }

  return { signals, rawText: resumeText, geminiRaw: result.raw }
}

const AI_WRITING_PROMPT = `Ты эксперт по обнаружению AI-написанных резюме.
Проанализируй текст и определи признаки ИИ-генерации.
Признаки: нет имён коллег/руководителей, нет конкретных дат и цифр, шаблонные формулировки, одинаковый стиль для всех мест работы, клише без деталей.
Создай 3–5 вопросов-ловушек для живого интервью — на которые человек с реальным опытом ответит конкретно, а ИИ-выдумщик запнётся.
Верни строго JSON: { "score": <0-100>, "signals": ["..."], "trapQuestions": ["..."] }`

const AI_WRITING_FALLBACK: AiWritingDetectionResult = {
  score: 0,
  detected: false,
  signals: [],
  trapQuestions: [],
}

export async function detectAiWriting(
  resumeText: string,
  apiKey: string,
  fetchImpl?: FetchLike
): Promise<AiWritingDetectionResult> {
  if (!resumeText.trim()) return { ...AI_WRITING_FALLBACK }

  try {
    const result = await callGeminiGenerateContent({
      apiKey,
      model: 'gemini-2.0-flash',
      systemInstruction: AI_WRITING_PROMPT,
      userText: resumeText,
      fetchImpl,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(result.text)
    } catch {
      return { ...AI_WRITING_FALLBACK }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { ...AI_WRITING_FALLBACK }
    }

    const obj = parsed as Record<string, unknown>
    const rawScore = obj['score']
    const score = typeof rawScore === 'number' ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0

    const rawSignals = obj['signals']
    const signals = Array.isArray(rawSignals)
      ? rawSignals.filter((s): s is string => typeof s === 'string')
      : []

    const rawTrap = obj['trapQuestions']
    const trapQuestions = Array.isArray(rawTrap)
      ? rawTrap.filter((q): q is string => typeof q === 'string')
      : []

    return {
      score,
      detected: score >= 70,
      signals,
      trapQuestions,
    }
  } catch {
    return { ...AI_WRITING_FALLBACK }
  }
}
