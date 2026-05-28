import { describe, expect, test } from 'bun:test'

import { buildFallbackInterviewQuestions } from './ai.routes'

describe('buildFallbackInterviewQuestions', () => {
  test('emits an opening question seeded with the vacancy title', () => {
    const questions = buildFallbackInterviewQuestions({
      vacancyTitle: 'Senior Backend Engineer',
      vacancyDescription: 'Design REST APIs. Lead service ownership. Mentor juniors.',
      candidateSkills: [],
    })
    expect(questions[0]).toContain('Senior Backend Engineer')
    // Always ends with the reflection probe required by HR contract.
    expect(questions[questions.length - 1]).toContain('regret')
    expect(questions.length).toBeLessThanOrEqual(6)
  })

  test('weaves candidate skills into a tailored question when available', () => {
    const questions = buildFallbackInterviewQuestions({
      vacancyTitle: 'Engineer',
      vacancyDescription: 'TypeScript • PostgreSQL • Kafka',
      candidateSkills: ['TypeScript', 'PostgreSQL', 'AWS'],
    })
    const joined = questions.join('\n')
    expect(joined).toContain('TypeScript')
  })
})
