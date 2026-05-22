/**
 * Messaging draft provider — Phase 1E.
 *
 * Reuses the LLM seam (Anthropic SDK) established in Phase 1C to generate
 * recruiter reply drafts. Returns a draft string — never auto-sends.
 *
 * Privacy: the prompt contains conversation history + role context only.
 * No contact PII (email, phone, full_name) is sent to the LLM provider.
 */

import Anthropic from '@anthropic-ai/sdk'

const DRAFT_SYSTEM_PROMPT = `You are a professional recruiter assistant writing on behalf of a recruiter.
Given the conversation history and context below, draft a short, professional reply to continue the conversation.
Return ONLY the reply text — no preamble, no metadata, no explanation.
Write in the language used in the conversation history. Keep it concise (2-4 sentences unless context requires more).`

type AnthropicClientLike = {
  messages: {
    create: (input: {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: 'user'; content: string }>
    }) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

export interface MessagingDraftProvider {
  generateDraft(input: DraftInput): Promise<DraftResult>
}

export type DraftInput = {
  conversationHistory: string
  context: string
  hint?: string
}

export type DraftResult = {
  draft: string
  model: string
}

type AnthropicDraftProviderOptions = {
  apiKey: string
  model: string
  client?: AnthropicClientLike
}

export class AnthropicDraftProvider implements MessagingDraftProvider {
  private readonly model: string
  private readonly client: AnthropicClientLike

  constructor(options: AnthropicDraftProviderOptions) {
    this.model = options.model
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  }

  async generateDraft(input: DraftInput): Promise<DraftResult> {
    const userMessage = [
      'Context:',
      input.context,
      '',
      'Conversation history:',
      input.conversationHistory || '(no messages yet — write an opening message)',
      ...(input.hint ? ['', `Recruiter hint: ${input.hint}`] : []),
    ].join('\n')

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = response.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim()

    return {
      draft: text || 'Thank you for your message. We will be in touch soon.',
      model: this.model,
    }
  }
}

export function createDraftProvider(env: {
  LLM_SCORING_API_KEY?: string
  LLM_SCORING_MODEL: string
}): MessagingDraftProvider {
  if (!env.LLM_SCORING_API_KEY) {
    throw new Error('LLM_SCORING_API_KEY is required for AI draft')
  }
  return new AnthropicDraftProvider({
    apiKey: env.LLM_SCORING_API_KEY,
    model: env.LLM_SCORING_MODEL,
  })
}
