/**
 * Minimal Gemini 2.0 Flash client for Phase 14 — Assessment System.
 *
 * Calls the public Generative Language API via fetch:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}
 *
 * The response body for `generateContent` has the shape:
 *   { candidates: [{ content: { parts: [{ text: string }] } }], ... }
 *
 * We extract the first text part and return it as `text`. Parsing/validation
 * of any JSON inside the model output is the caller's responsibility.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiGenerateInput = {
  apiKey: string
  model: string
  /** System instruction (becomes `system_instruction.parts[0].text`). */
  systemInstruction: string
  /** User prompt text (becomes the first `contents[0].parts[0].text`). */
  userText: string
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch
  /** Optional response generation overrides. */
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    responseMimeType?: string
  }
}

export type GeminiGenerateResult = {
  text: string
  raw: unknown
}

export class GeminiApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = 'GeminiApiError'
  }
}

export async function callGeminiGenerateContent(input: GeminiGenerateInput): Promise<GeminiGenerateResult> {
  const { apiKey, model, systemInstruction, userText, generationConfig } = input
  if (!apiKey) {
    throw new GeminiApiError('GEMINI_API_KEY is required to call Gemini')
  }

  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature: generationConfig?.temperature ?? 0.2,
      maxOutputTokens: generationConfig?.maxOutputTokens ?? 2000,
      responseMimeType: generationConfig?.responseMimeType ?? 'application/json',
    },
  }

  const doFetch = input.fetchImpl ?? fetch
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GeminiApiError(
      `Gemini API responded with HTTP ${res.status}`,
      res.status,
      text,
    )
  }

  const raw = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
    }>
  }
  const text = raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  return { text, raw }
}
