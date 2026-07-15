import { describe, expect, test } from 'bun:test'

import { OpenAiCompatibleScoringProvider } from './openai-compatible.provider'

const scoringInput = {
  job_profile: {
    title: 'Logist',
    grade: 'M2',
    description: 'Coordinate freight and oversized cargo.',
    required_skills: ['Freight planning'],
    salary_range: { min: 100000, max: 150000, currency: 'RUB' },
  },
  candidate_resume: {
    title: 'Logistics specialist',
    experience: ['Freight coordinator'],
    education: [],
    skills: ['Freight planning'],
    total_experience_months: 48,
    location: 'Vladivostok',
  },
}

const scoringJson = {
  relevance_score: 83,
  summary: 'Strong logistics match with relevant freight experience.',
  strengths: ['Freight planning'],
  gaps: ['Oversized cargo evidence is limited'],
  soft_skills_signals: ['Operational ownership'],
  red_flags: [],
  anti_fraud_signals: [],
  values_fit_hypothesis: 'Likely fits a delivery-oriented team.',
  interview_focus_areas: ['Oversized cargo examples'],
}

describe('OpenAiCompatibleScoringProvider', () => {
  test('posts chat completions request and parses JSON content', async () => {
    let capturedUrl = ''
    let capturedBody: any = null

    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      baseUrl: 'https://llm.example.test/v1/',
      fetch: async (url, init) => {
        capturedUrl = String(url)
        capturedBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            model: 'deepseek/deepseek-v4-flash-20260701',
            choices: [{ message: { content: JSON.stringify(scoringJson) } }],
            usage: { total_tokens: 321 },
          }),
          { status: 200 },
        )
      },
    })

    const result = await provider.score(scoringInput)

    expect(capturedUrl).toBe('https://llm.example.test/v1/chat/completions')
    expect(capturedBody.model).toBe('deepseek/deepseek-v4-flash')
    expect(capturedBody.max_tokens).toBe(3000)
    expect(capturedBody.response_format).toEqual({ type: 'json_object' })
    expect(result.relevance_score).toBe(83)
    expect(result.model).toBe('deepseek/deepseek-v4-flash')
    expect(result.model_version).toBe('deepseek/deepseek-v4-flash-20260701')
    expect(result.tokens_used).toBe(321)
    expect(result.schema_version).toBe(2)
  })

  test('retries once when first content is malformed JSON', async () => {
    let calls = 0
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      fetch: async () => {
        calls += 1
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: calls === 1 ? 'not json' : JSON.stringify(scoringJson),
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    const result = await provider.score(scoringInput)

    expect(calls).toBe(2)
    expect(result.relevance_score).toBe(83)
  })

  test('retries internally inconsistent zero score for same-domain evidence', async () => {
    let calls = 0
    const inconsistent = {
      ...scoringJson,
      relevance_score: 0,
      strengths: ['Relevant logistics experience'],
      competencies: {
        logistics: {
          score: 7,
          reasoning: 'Relevant freight coordination.',
        },
      },
    }
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetch: async () => {
        calls += 1
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(calls === 1 ? inconsistent : scoringJson),
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    const result = await provider.score(scoringInput)

    expect(calls).toBe(2)
    expect(result.relevance_score).toBe(83)
  })
})
