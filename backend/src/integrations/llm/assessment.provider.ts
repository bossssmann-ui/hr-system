import Anthropic from '@anthropic-ai/sdk'
import { aiInterviewQuestionSchema } from '@web-app-demo/contracts'
import { z } from 'zod'

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://openrouter.ai/api/v1'

const questionGenerationSchema = z.object({
  items: z.array(aiInterviewQuestionSchema).min(1).max(12),
})

const openAnswerGradeSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().min(1),
})

export const resumeEnrichmentSchema = z.object({
  summary: z.string().min(1),
  facts: z.array(z.string()).default([]),
  experience: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(100),
})

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

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

export type AssessmentProvider = {
  generateInterviewQuestions(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
  }): Promise<z.infer<typeof questionGenerationSchema>>
  gradeOpenAnswer(input: {
    question: string
    rubric: string
    answer: string
  }): Promise<z.infer<typeof openAnswerGradeSchema>>
  extractResumeEnrichment(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
    questions: string[]
    answer: string
  }): Promise<z.infer<typeof resumeEnrichmentSchema>>
}

export class AssessmentProviderMalformedResponseError extends Error {
  constructor(readonly model: string) {
    super('Malformed JSON response from assessment provider')
  }
}

export class AnthropicAssessmentProvider {
  private readonly client: AnthropicClientLike

  constructor(
    private readonly options: {
      apiKey: string
      model: string
      client?: AnthropicClientLike
    },
  ) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  }

  async generateInterviewQuestions(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
  }) {
    return this.requestStructuredJson(
      [
        'Generate personalized interview questions.',
        'Return JSON only in format: {"items":[{"question":"...","rationale":"...","competency":"..."}]}.',
        'Questions must be advisory and job-relevant.',
        'Write every human-readable text value in Russian.',
      ].join(' '),
      JSON.stringify(input),
      questionGenerationSchema,
    )
  }

  async gradeOpenAnswer(input: {
    question: string
    rubric: string
    answer: string
  }) {
    return this.requestStructuredJson(
      [
        'Grade open answer against rubric.',
        'Return JSON only in format: {"score":0-100,"rationale":"..."}.',
        'Keep rationale concise and evidence-based.',
        'Write the rationale in Russian.',
      ].join(' '),
      JSON.stringify(input),
      openAnswerGradeSchema,
    )
  }

  async extractResumeEnrichment(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
    questions: string[]
    answer: string
  }) {
    return this.requestStructuredJson(
      [
        'Extract resume enrichment facts from a candidate follow-up email.',
        'Return JSON only in format: {"summary":"...","facts":["..."],"experience":["..."],"skills":["..."],"contradictions":["..."],"confidence":0}.',
        'Use only facts present in the answer. Do not invent missing dates, employers, volumes, systems, or KPIs.',
        'Put unverifiable or conflicting claims into contradictions.',
        'Write every human-readable text value in Russian.',
      ].join(' '),
      JSON.stringify(input),
      resumeEnrichmentSchema,
    )
  }

  private async requestStructuredJson<T extends z.ZodTypeAny>(
    systemPrompt: string,
    userPayload: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const first = await this.request(systemPrompt, userPayload, false)
    const parsedFirst = tryParse(first, schema)
    if (parsedFirst) return parsedFirst

    const second = await this.request(systemPrompt, userPayload, true)
    const parsedSecond = tryParse(second, schema)
    if (!parsedSecond) {
      throw new AssessmentProviderMalformedResponseError(this.options.model)
    }
    return parsedSecond
  }

  private async request(system: string, userPayload: string, forceJsonOnly: boolean) {
    const reminder = forceJsonOnly
      ? '\n\nReminder: return strictly valid JSON only. No markdown or extra prose. All text values must be in Russian.'
      : ''
    const response = await this.client.messages.create({
      model: this.options.model,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `${userPayload}${reminder}` }],
    })

    return response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }
}

export class OpenAiCompatibleAssessmentProvider implements AssessmentProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: {
    apiKey: string
    model: string
    baseUrl?: string
    fetch?: FetchLike
  }) {
    this.apiKey = options.apiKey
    this.model = options.model
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
    this.fetchImpl = options.fetch ?? fetch
  }

  async generateInterviewQuestions(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
  }) {
    return this.requestStructuredJson(
      [
        'Generate personalized interview questions.',
        'Return JSON only in format: {"items":[{"question":"...","rationale":"...","competency":"..."}]}.',
        'Questions must be advisory and job-relevant.',
        'Write every human-readable text value in Russian.',
      ].join(' '),
      JSON.stringify(input),
      questionGenerationSchema,
    )
  }

  async gradeOpenAnswer(input: {
    question: string
    rubric: string
    answer: string
  }) {
    return this.requestStructuredJson(
      [
        'Grade open answer against rubric.',
        'Return JSON only in format: {"score":0-100,"rationale":"..."}.',
        'Keep rationale concise and evidence-based.',
        'Write the rationale in Russian.',
      ].join(' '),
      JSON.stringify(input),
      openAnswerGradeSchema,
    )
  }

  async extractResumeEnrichment(input: {
    vacancyProfile: Record<string, unknown>
    candidateResume: Record<string, unknown>
    questions: string[]
    answer: string
  }) {
    return this.requestStructuredJson(
      [
        'Extract resume enrichment facts from a candidate follow-up email.',
        'Return JSON only in format: {"summary":"...","facts":["..."],"experience":["..."],"skills":["..."],"contradictions":["..."],"confidence":0}.',
        'Use only facts present in the answer. Do not invent missing dates, employers, volumes, systems, or KPIs.',
        'Put unverifiable or conflicting claims into contradictions.',
        'Write every human-readable text value in Russian.',
      ].join(' '),
      JSON.stringify(input),
      resumeEnrichmentSchema,
    )
  }

  private async requestStructuredJson<T extends z.ZodTypeAny>(
    systemPrompt: string,
    userPayload: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const first = await this.request(systemPrompt, userPayload, false)
    const parsedFirst = tryParse(first, schema)
    if (parsedFirst) return parsedFirst

    const second = await this.request(systemPrompt, userPayload, true)
    const parsedSecond = tryParse(second, schema)
    if (!parsedSecond) {
      throw new AssessmentProviderMalformedResponseError(this.model)
    }
    return parsedSecond
  }

  private async request(system: string, userPayload: string, forceJsonOnly: boolean) {
    const reminder = forceJsonOnly
      ? '\n\nReminder: return strictly valid JSON only. No markdown or extra prose. All text values must be in Russian.'
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
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${userPayload}${reminder}` },
        ],
      }),
    })

    const text = await response.text()
    const body = text.length > 0 ? safeJsonParse<ChatCompletionResponse>(text) : null

    if (!response.ok) {
      throw new Error(`OpenAI-compatible assessment request failed: ${response.status}`)
    }

    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new AssessmentProviderMalformedResponseError(this.model)
    }

    return content
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

function tryParse<T extends z.ZodTypeAny>(raw: string, schema: T): z.infer<T> | null {
  const normalized = extractJson(raw)
  if (!normalized) return null
  try {
    return schema.parse(JSON.parse(normalized))
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
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1)

  return null
}
