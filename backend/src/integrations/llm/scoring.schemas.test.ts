import { describe, expect, test } from 'bun:test'

import {
  competencyAssessmentSchema,
  scoringResultSchema,
  SCORING_SCHEMA_VERSION,
} from './scoring.schemas'

describe('scoring schemas v2 (Phase 9)', () => {
  test('schema version is 2', () => {
    expect(SCORING_SCHEMA_VERSION).toBe(2)
  })

  test('accepts the v1 minimal payload (backwards compatible)', () => {
    const parsed = scoringResultSchema.parse({
      relevance_score: 70,
      summary: 'Good match',
      strengths: ['x'],
      gaps: [],
      soft_skills_signals: [],
      red_flags: [],
      anti_fraud_signals: [],
      values_fit_hypothesis: 'aligned',
      interview_focus_areas: [],
      model: 'claude',
      scored_at: '2026-06-01T00:00:00.000Z',
    })
    expect(parsed.competencies).toBeUndefined()
    expect(parsed.suggested_salary).toBeUndefined()
  })

  test('accepts v2 fields (competencies, suggested_salary, interview_questions, tokens_used)', () => {
    const parsed = scoringResultSchema.parse({
      relevance_score: 80,
      summary: 'Strong',
      strengths: ['backend'],
      gaps: [],
      soft_skills_signals: [],
      red_flags: [],
      anti_fraud_signals: [],
      values_fit_hypothesis: 'aligned',
      interview_focus_areas: [],
      competencies: {
        backend: { score: 8, reasoning: 'Built large systems' },
        leadership: { score: 6, reasoning: 'Mentors juniors' },
      },
      suggested_grade: 'M3',
      suggested_salary: 250000,
      interview_questions: ['Q1', 'Q2'],
      tokens_used: 1234,
      model_version: 'claude-haiku-4-5-20251001',
      model: 'claude-haiku-4-5-20251001',
      scored_at: '2026-06-01T00:00:00.000Z',
    })
    expect(parsed.competencies?.backend?.score).toBe(8)
    expect(parsed.suggested_salary).toBe(250000)
    expect(parsed.interview_questions).toHaveLength(2)
    expect(parsed.tokens_used).toBe(1234)
  })

  test('competency assessment rejects out-of-range scores', () => {
    expect(() => competencyAssessmentSchema.parse({ score: 11, reasoning: 'x' })).toThrow()
    expect(() => competencyAssessmentSchema.parse({ score: -1, reasoning: 'x' })).toThrow()
  })
})
