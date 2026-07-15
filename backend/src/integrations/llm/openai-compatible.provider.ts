import { buildScoringUserMessage, SCORING_SYSTEM_PROMPT } from './scoring.prompts'
import { ScoringProviderMalformedResponseError, type ScoringProvider } from './provider'
import {
  SCORING_SCHEMA_VERSION,
  isScoringResultInternallyInconsistent,
  scoringResultCoreSchema,
  scoringResultSchema,
  type ScoringInput,
  type ScoringResult,
} from './scoring.schemas'

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://openrouter.ai/api/v1'
const SCORING_MAX_TOKENS = 3000

type OpenAiCompatibleProviderOptions = {
  apiKey: string
  model: string
  baseUrl?: string
  fetch?: FetchLike
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ChatCompletionResponse = {
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
  usage?: {
    total_tokens?: number
  }
}

export class OpenAiCompatibleScoringProvider implements ScoringProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.apiKey = options.apiKey
    this.model = options.model
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
    this.fetchImpl = options.fetch ?? fetch
  }

  async score(input: ScoringInput): Promise<ScoringResult> {
    const firstAttempt = await this.request(input, false)
    const parsedFirst = tryParseScoringJson(firstAttempt.content, input)
    if (parsedFirst) {
      return this.withMetadata(parsedFirst, firstAttempt)
    }

    const retryAttempt = await this.request(input, true)
    const parsedRetry = tryParseScoringJson(retryAttempt.content, input)
    if (!parsedRetry) {
      throw new ScoringProviderMalformedResponseError(this.model)
    }

    return this.withMetadata(parsedRetry, retryAttempt)
  }

  private async request(input: ScoringInput, forceJsonOnly: boolean) {
    const userMessage = buildScoringUserMessage(input)
    const reminder = forceJsonOnly
      ? '\n\nReminder: return strictly valid JSON only. No markdown, no prose outside JSON. All text values must be in Russian.'
      : ''

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: SCORING_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SCORING_SYSTEM_PROMPT },
          { role: 'user', content: `${userMessage}${reminder}` },
        ],
      }),
    })

    const text = await response.text()
    const body = text.length > 0 ? safeJsonParse<ChatCompletionResponse>(text) : null

    if (!response.ok) {
      throw new Error(`OpenAI-compatible scoring request failed: ${response.status}`)
    }

    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new ScoringProviderMalformedResponseError(this.model, 'Missing chat completion content')
    }

    return {
      content,
      modelVersion: body?.model,
      tokensUsed: body?.usage?.total_tokens,
    }
  }

  private withMetadata(
    parsed: Omit<ScoringResult, 'model' | 'scored_at' | 'schema_version'>,
    metadata: { modelVersion?: string; tokensUsed?: number },
  ) {
    return scoringResultSchema.parse({
      ...parsed,
      model: this.model,
      model_version: metadata.modelVersion,
      tokens_used: metadata.tokensUsed,
      scored_at: new Date().toISOString(),
      schema_version: SCORING_SCHEMA_VERSION,
    })
  }
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function tryParseScoringJson(raw: string, input: ScoringInput): Omit<ScoringResult, 'model' | 'scored_at' | 'schema_version'> | null {
  const normalized = extractJson(raw)
  if (!normalized) return null

  try {
    const parsed = JSON.parse(normalized)
    const result = scoringResultCoreSchema.parse(parsed)
    if (isScoringResultInternallyInconsistent(result, input)) return null
    return result
  } catch {
    return null
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeFenceMatch?.[1]) {
    return codeFenceMatch[1]
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return null
}
