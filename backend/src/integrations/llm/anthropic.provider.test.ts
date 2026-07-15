import { describe, expect, test } from 'bun:test'

import { AnthropicScoringProvider } from './anthropic.provider'
import { OpenAiCompatibleScoringProvider } from './openai-compatible.provider'

describe('AnthropicScoringProvider', () => {
  test('parses valid JSON and adds model metadata', async () => {
    const provider = new AnthropicScoringProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      client: {
        messages: {
          create: async () => ({
            content: [{
              type: 'text',
              text: JSON.stringify({
                relevance_score: 82,
                summary: 'Strong technical alignment with partial domain gap.',
                strengths: ['Backend API design', 'TypeScript'],
                gaps: ['No direct payroll domain'],
                soft_skills_signals: ['Clear ownership language'],
                red_flags: [],
                anti_fraud_signals: [],
                values_fit_hypothesis: 'Likely collaborative and delivery-focused.',
                interview_focus_areas: ['Domain adaptation speed'],
              }),
            }],
          }),
        },
      },
    })

    const result = await provider.score({
      job_profile: {
        title: 'Backend Engineer',
        grade: 'M3',
        description: 'Build APIs',
        required_skills: ['TypeScript'],
        salary_range: { min: 200000, max: 300000, currency: 'RUB' },
      },
      candidate_resume: {
        title: 'Senior Backend Engineer',
        experience: ['Node.js API Engineer at Acme'],
        education: ['MSc Computer Science'],
        skills: ['TypeScript'],
        total_experience_months: 72,
        location: 'Moscow',
      },
    })

    expect(result.relevance_score).toBe(82)
    expect(result.model).toBe('claude-haiku-4-5-20251001')
    expect(result.schema_version).toBe(2)
  })

  test('retries once when first response is malformed JSON', async () => {
    let calls = 0
    const provider = new AnthropicScoringProvider({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      client: {
        messages: {
          create: async () => {
            calls += 1
            if (calls === 1) {
              return { content: [{ type: 'text', text: 'not json' }] }
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  relevance_score: 55,
                  summary: 'Some match but gaps remain.',
                  strengths: ['API basics'],
                  gaps: ['System design depth'],
                  soft_skills_signals: ['Concise writing'],
                  red_flags: [],
                  anti_fraud_signals: [],
                  values_fit_hypothesis: 'Unknown due to sparse evidence.',
                  interview_focus_areas: ['Depth in distributed systems'],
                }),
              }],
            }
          },
        },
      },
    })

    const result = await provider.score({
      job_profile: {
        title: 'Backend Engineer',
        grade: 'M3',
        description: 'Build APIs',
        required_skills: ['TypeScript'],
        salary_range: { min: 200000, max: 300000, currency: 'RUB' },
      },
      candidate_resume: {
        title: null,
        experience: [],
        education: [],
        skills: [],
        total_experience_months: null,
        location: null,
      },
    })

    expect(calls).toBe(2)
    expect(result.relevance_score).toBe(55)
  })
})

describe('OpenAiCompatibleScoringProvider', () => {
  const scoringInput = {
    job_profile: {
      title: 'Backend Engineer',
      grade: 'M3',
      description: 'Build APIs',
      required_skills: ['TypeScript'],
      salary_range: { min: 200000, max: 300000, currency: 'RUB' },
    },
    candidate_resume: {
      title: null,
      experience: [],
      education: [],
      skills: [],
      total_experience_months: null,
      location: null,
    },
  }

  test('parses OpenAI-compatible response into scoring result', async () => {
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relevance_score: 91,
                    summary: 'Strong technical fit.',
                    strengths: ['TypeScript'],
                    gaps: [],
                    soft_skills_signals: ['Clear communication'],
                    red_flags: [],
                    anti_fraud_signals: [],
                    values_fit_hypothesis: 'Likely aligned.',
                    interview_focus_areas: ['Domain depth'],
                  }),
                },
              },
            ],
          }),
        ),
    })

    const result = await provider.score(scoringInput)

    expect(result.relevance_score).toBe(91)
    expect(result.model).toBe('deepseek-chat')
    expect(result.schema_version).toBe(2)
  })

  test('throws on invalid JSON after retry', async () => {
    const provider = new OpenAiCompatibleScoringProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'not json' } }],
          }),
        ),
    })

    await expect(provider.score(scoringInput)).rejects.toThrow('Malformed JSON response from scoring provider')
  })
})
