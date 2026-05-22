import { describe, expect, test } from 'bun:test'

import { AnthropicAssessmentProvider } from './assessment.provider'

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
