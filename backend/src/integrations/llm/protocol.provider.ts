/**
 * Interview protocol builder using the Anthropic LLM provider seam (Phase 1C).
 *
 * Privacy note: transcript PII is NOT stripped (unlike Phase 1C resume scoring)
 * because the protocol legitimately needs full interview context. Legal basis:
 * consent_recorded = true. If using a non-RF LLM, this is a data-residency
 * consideration for the owner (documented in docs/contracts/40-audit.md).
 */

import Anthropic from '@anthropic-ai/sdk'

import { buildProtocolUserMessage, PROTOCOL_SYSTEM_PROMPT } from './protocol.prompts'
import type { TranscriptSegment } from '../../features/interviews/interviews.schemas'
import {
  interviewProtocolCoreSchema,
  interviewProtocolSchema,
  PROTOCOL_SCHEMA_VERSION,
  type InterviewProtocol,
} from '../../features/interviews/interviews.schemas'

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

export class ProtocolProviderMalformedResponseError extends Error {
  readonly model: string

  constructor(model: string, message = 'Malformed JSON response from protocol provider') {
    super(message)
    this.model = model
  }
}

export interface ProtocolProvider {
  buildProtocol(segments: TranscriptSegment[]): Promise<InterviewProtocol>
}

type AnthropicProtocolProviderOptions = {
  apiKey: string
  model: string
  client?: AnthropicClientLike
}

export class AnthropicProtocolProvider implements ProtocolProvider {
  private readonly model: string
  private readonly client: AnthropicClientLike
  private static readonly PROTOCOL_MAX_TOKENS = 2000

  constructor(options: AnthropicProtocolProviderOptions) {
    this.model = options.model
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  }

  async buildProtocol(segments: TranscriptSegment[]): Promise<InterviewProtocol> {
    const firstAttempt = await this.request(segments, false)
    const parsedFirst = tryParseProtocolJson(firstAttempt)
    if (parsedFirst) {
      return interviewProtocolSchema.parse({
        ...parsedFirst,
        model: this.model,
        generated_at: new Date().toISOString(),
        schema_version: PROTOCOL_SCHEMA_VERSION,
      })
    }

    // Retry once with strict JSON reminder.
    const retryAttempt = await this.request(segments, true)
    const parsedRetry = tryParseProtocolJson(retryAttempt)
    if (!parsedRetry) {
      throw new ProtocolProviderMalformedResponseError(this.model)
    }

    return interviewProtocolSchema.parse({
      ...parsedRetry,
      model: this.model,
      generated_at: new Date().toISOString(),
      schema_version: PROTOCOL_SCHEMA_VERSION,
    })
  }

  private async request(segments: TranscriptSegment[], forceJsonOnly: boolean) {
    const userMessage = buildProtocolUserMessage(segments)
    const reminder = forceJsonOnly
      ? '\n\nReminder: return strictly valid JSON only. No markdown, no prose outside JSON.'
      : ''

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: AnthropicProtocolProvider.PROTOCOL_MAX_TOKENS,
      system: PROTOCOL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${userMessage}${reminder}` }],
    })

    return response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }
}

function tryParseProtocolJson(
  raw: string,
): Omit<InterviewProtocol, 'model' | 'generated_at' | 'schema_version'> | null {
  const normalized = extractJson(raw)
  if (!normalized) return null

  try {
    const parsed = JSON.parse(normalized)
    return interviewProtocolCoreSchema.parse(parsed)
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
