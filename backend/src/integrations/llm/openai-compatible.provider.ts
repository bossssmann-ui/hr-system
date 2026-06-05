import { buildScoringUserMessage, SCORING_SYSTEM_PROMPT } from './scoring.prompts'
import { ScoringProviderMalformedResponseError, type ScoringProvider } from './provider'
import {
  SCORING_SCHEMA_VERSION,
  scoringResultCoreSchema,
  scoringResultSchema,
  type ScoringInput,
  type ScoringResult,
} from './scoring.schemas'

type OpenAiCompatibleScoringProviderOptions = {
  apiKey: string
  model: string
  baseUrl: string
  fetcher?: Fetcher
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

export class OpenAiCompatibleScoringProvider implements ScoringProvider {
  private readonly fetcher: Fetcher
  private readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private static readonly REQUEST_TIMEOUT_MS = 15_000
  private static readonly REQUEST_RETRIES = 2

  constructor(options: OpenAiCompatibleScoringProviderOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.model = options.model
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
  }

  async score(input: ScoringInput): Promise<ScoringResult> {
    const firstAttempt = await this.request(input, false)
    const parsedFirst = tryParseScoringJson(firstAttempt)
    if (parsedFirst) {
      return scoringResultSchema.parse({
        ...parsedFirst,
        model: this.model,
        scored_at: new Date().toISOString(),
        schema_version: SCORING_SCHEMA_VERSION,
      })
    }

    const retryAttempt = await this.request(input, true)
    const parsedRetry = tryParseScoringJson(retryAttempt)
    if (!parsedRetry) {
      throw new ScoringProviderMalformedResponseError(this.model)
    }

    return scoringResultSchema.parse({
      ...parsedRetry,
      model: this.model,
      scored_at: new Date().toISOString(),
      schema_version: SCORING_SCHEMA_VERSION,
    })
  }

  private async request(input: ScoringInput, forceJsonOnly: boolean) {
    const userMessage = buildScoringUserMessage(input)
    const reminder = forceJsonOnly
      ? '\n\nReminder: return strictly valid JSON only. No markdown, no prose outside JSON.'
      : ''
    const payload = {
      model: this.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SCORING_SYSTEM_PROMPT },
        { role: 'user', content: `${userMessage}${reminder}` },
      ],
    }

    let lastError: unknown
    for (let attempt = 1; attempt <= OpenAiCompatibleScoringProvider.REQUEST_RETRIES; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), OpenAiCompatibleScoringProvider.REQUEST_TIMEOUT_MS)
      try {
        const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: ['Bearer', this.apiKey].join(' '),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!response.ok) {
          const details = await response.text()
          throw new Error(
            `OpenAI-compatible scoring request failed with status ${response.status}${details ? `: ${details}` : ''}`,
          )
        }
        const data = (await response.json()) as OpenAiChatCompletionResponse
        return readChatContent(data)
      } catch (error) {
        lastError = error
        if (attempt >= OpenAiCompatibleScoringProvider.REQUEST_RETRIES) throw error
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('OpenAI-compatible scoring request failed')
  }
}

function readChatContent(response: OpenAiChatCompletionResponse): string {
  const message = response.choices?.[0]?.message?.content
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function tryParseScoringJson(raw: string): Omit<ScoringResult, 'model' | 'scored_at' | 'schema_version'> | null {
  const normalized = extractJson(raw)
  if (!normalized) return null

  try {
    const parsed = JSON.parse(normalized)
    return scoringResultCoreSchema.parse(parsed)
  } catch {
    return null
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeFenceMatch?.[1]) return codeFenceMatch[1]

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}
