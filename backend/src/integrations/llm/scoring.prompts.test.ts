import { describe, expect, test } from 'bun:test'

import { buildScoringUserMessage, SCORING_SYSTEM_PROMPT } from './scoring.prompts'

describe('scoring prompts', () => {
  test('system prompt includes explicit bias-avoidance instruction', () => {
    expect(SCORING_SYSTEM_PROMPT.toLowerCase()).toContain('avoid bias')
    expect(SCORING_SYSTEM_PROMPT.toLowerCase()).toContain('protected characteristics')
  })

  test('user message embeds structured input payload', () => {
    const message = buildScoringUserMessage({
      job_profile: {
        title: 'Backend Engineer',
        grade: 'M3',
        description: 'Build APIs',
        required_skills: ['TypeScript'],
        salary_range: { min: 200000, max: 300000, currency: 'RUB' },
      },
      candidate_resume: {
        title: 'Senior Engineer',
        experience: ['Built APIs'],
        education: ['MSc'],
        skills: ['TypeScript'],
        total_experience_months: 72,
        location: 'Moscow',
      },
    })

    expect(message).toContain('"relevance_score"')
    expect(message).toContain('"job_profile"')
    expect(message).toContain('"candidate_resume"')
  })
})
