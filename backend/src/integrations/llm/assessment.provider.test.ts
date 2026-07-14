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
  test('posts chat completions request and parses generated interview questions', async () => {
    let capturedUrl = ''
    let capturedBody: any = null
    const provider = new OpenAiCompatibleAssessmentProvider({
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      baseUrl: 'https://llm.example.test/v1/',
      fetch: async (url, init) => {
        capturedUrl = String(url)
        capturedBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        question: 'Расскажите о самом сложном маршруте, который вы вели.',
                        rationale: 'Проверяет реальный опыт транспортной логистики.',
                        competency: 'Логистика',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    const result = await provider.generateInterviewQuestions({
      vacancyProfile: { title: 'Логист' },
      candidateResume: { experience: ['Транспортная логистика'] },
    })

    expect(capturedUrl).toBe('https://llm.example.test/v1/chat/completions')
    expect(capturedBody.model).toBe('deepseek/deepseek-v4-flash')
    expect(capturedBody.response_format).toEqual({ type: 'json_object' })
    expect(capturedBody.messages[0].content).toContain('Russian')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.question).toContain('Расскажите')
  })

  test('retries malformed JSON once for question generation', async () => {
    let calls = 0
    const provider = new OpenAiCompatibleAssessmentProvider({
      apiKey: 'test-key',
      model: 'deepseek/deepseek-v4-flash',
      fetch: async () => {
        calls += 1
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: calls === 1
                    ? 'not json'
                    : JSON.stringify({
                        items: [
                          {
                            question: 'Какие KPI вы контролировали?',
                            rationale: 'Проверяет управленческий опыт.',
                            competency: 'Управление',
                          },
                        ],
                      }),
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    const result = await provider.generateInterviewQuestions({
      vacancyProfile: { title: 'Логист' },
      candidateResume: { experience: ['Руководитель отдела'] },
    })

    expect(calls).toBe(2)
    expect(result.items).toHaveLength(1)
  })
})
