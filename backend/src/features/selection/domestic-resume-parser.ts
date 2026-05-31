import { callGeminiGenerateContent } from '../../integrations/llm/gemini'

export interface ResumeParseResult {
  signals: string[]
  rawText: string
  geminiRaw?: unknown
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
  fetchImpl?: typeof fetch
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
