import { describe, expect, test } from 'bun:test'

import { buildScoringUserMessage, SCORING_SYSTEM_PROMPT } from './scoring.prompts'

describe('scoring prompts', () => {
  test('system prompt includes explicit bias-avoidance instruction', () => {
    expect(SCORING_SYSTEM_PROMPT.toLowerCase()).toContain('avoid bias')
    expect(SCORING_SYSTEM_PROMPT.toLowerCase()).toContain('protected characteristics')
  })

  test('system prompt requires Russian human-readable values', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('MUST be written in Russian')
    expect(SCORING_SYSTEM_PROMPT).toContain('summaries, strengths, gaps')
  })

  test('system prompt requires resume version and AI-writing fraud checks', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('previous resume versions')
    expect(SCORING_SYSTEM_PROMPT).toContain('AI-written')
    expect(SCORING_SYSTEM_PROMPT).toContain('contradictions')
  })

  test('system prompt treats weak same-domain resumes as verification risk', () => {
    expect(SCORING_SYSTEM_PROMPT).toContain('strong specialists write weak resumes')
    expect(SCORING_SYSTEM_PROMPT).toContain('verification-needed score')
    expect(SCORING_SYSTEM_PROMPT).toContain('Do not award 60+ from a matching job title alone')
    expect(SCORING_SYSTEM_PROMPT).toContain('a sparse vacancy must not be used to invent fit')
    expect(SCORING_SYSTEM_PROMPT).toContain('40-59 = relevant domain signals')
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
    expect(message).toContain('Write every text value in Russian')
    expect(message).toContain('AI-written resume indicators')
    expect(message).toContain('actual duties, routes/cargo types, volumes')
  })
})
