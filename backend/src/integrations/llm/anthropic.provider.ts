import Anthropic from '@anthropic-ai/sdk'

import { buildScoringUserMessage, SCORING_SYSTEM_PROMPT } from './scoring.prompts'
import { ScoringProviderMalformedResponseError, type ScoringProvider } from './provider'
import {
  SCORING_SCHEMA_VERSION,
  scoringResultCoreSchema,
  scoringResultSchema,
  type ScoringInput,
  type ScoringResult,
} from './scoring.schemas'

type AnthropicMessageCreateInput = {
  model: string
  max_tokens: number
  system: string
  messages: Array<{ role: 'user'; content: string }>
}

type AnthropicMessageCreateOutput = {
  content: Array<{ type: string; text?: string }>
}

type AnthropicClientLike = {
  messages: {
    create: (input: AnthropicMessageCreateInput) => Promise<AnthropicMessageCreateOutput>
  }
}

type AnthropicScoringProviderOptions = {
  apiKey: string
  model: string
  client?: AnthropicClientLike
}

export class AnthropicScoringProvider implements ScoringProvider {
  private readonly model: string
  private readonly client: AnthropicClientLike

  constructor(options: AnthropicScoringProviderOptions) {
    this.model = options.model
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey })
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1200,
      system: SCORING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${userMessage}${reminder}` }],
    })

    return response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }
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
