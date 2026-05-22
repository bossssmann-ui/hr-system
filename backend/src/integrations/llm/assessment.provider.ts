import Anthropic from '@anthropic-ai/sdk'
import { aiInterviewQuestionSchema } from '@web-app-demo/contracts'
import { z } from 'zod'

const questionGenerationSchema = z.object({
  items: z.array(aiInterviewQuestionSchema).min(1).max(12),
})

const openAnswerGradeSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().min(1),
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
      ].join(' '),
      JSON.stringify(input),
      openAnswerGradeSchema,
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
      ? '\n\nReminder: return strictly valid JSON only. No markdown or extra prose.'
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
