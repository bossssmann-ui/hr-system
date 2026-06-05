import { describe, expect, test } from 'bun:test'

import { AnthropicAssessmentProvider, OpenAiCompatibleAssessmentProvider } from './assessment.provider'

describe('AnthropicAssessmentProvider', () => {
  test('retries malformed JSON once for question generation', async () => {
    let calls = 0
    const provider = new AnthropicAssessmentProvider({
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
                  items: [
                    {
                      question: 'How would you close your architecture gap from the previous role?',
                      rationale: 'Resume shows transition from frontend to backend scope.',
                      competency: 'system design',
                    },
                  ],
                }),
              }],
            }
          },
        },
      },
    })

    const result = await provider.generateInterviewQuestions({
      vacancyProfile: { title: 'Backend Engineer' },
      candidateResume: { experience: ['Frontend Engineer at Acme'] },
    })

    expect(calls).toBe(2)
    expect(result.items).toHaveLength(1)
  })
})

describe('OpenAiCompatibleAssessmentProvider', () => {
  test('parses gradeOpenAnswer response', async () => {
    const provider = new OpenAiCompatibleAssessmentProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"score":87,"rationale":"Good rubric coverage."}' } }],
          }),
        ),
    })

    const result = await provider.gradeOpenAnswer({
      question: 'Describe trade-offs.',
      rubric: 'Clarity + structure',
      answer: 'Candidate answer',
    })

    expect(result.score).toBe(87)
    expect(result.rationale).toContain('Good rubric coverage')
  })

  test('throws on invalid JSON response', async () => {
    const provider = new OpenAiCompatibleAssessmentProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'not json' } }],
          }),
        ),
    })

    await expect(
      provider.gradeOpenAnswer({
        question: 'Describe trade-offs.',
        rubric: 'Clarity + structure',
        answer: 'Candidate answer',
      }),
    ).rejects.toThrow('Malformed JSON response from assessment provider')
  })
})
