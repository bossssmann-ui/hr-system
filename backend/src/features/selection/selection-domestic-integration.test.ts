import { describe, it, expect } from 'bun:test'
import { buildDomesticStages } from './domestic-stage-content'
import { selectSpecializations } from './domestic-specializations'
import { scoreDomesticAssessment } from './domestic-scoring'
import { computeDomesticCrossCheckFlags } from './domestic-cross-check'
import { buildStagesForRole, isDomesticRole } from './selection-role-adapter'
import type { StageContent, TestStageContent, QuestionnaireStageContent, AssignmentStageContent, PsychologyStageContent } from './stage-content'
import type { SpecializationAssignment } from './domestic-specializations'

describe('buildStagesForRole', () => {
  it('logist → возвращает 4 этапа с вопросами logist', () => {
    const stages = buildStagesForRole('logist')
    expect(stages).toHaveLength(4)
    // Stage 1 should be questionnaire for logist
    const stage1 = stages[0] as QuestionnaireStageContent
    expect(stage1.type).toBe('questionnaire')
    expect(stage1.stage).toBe(1)
    // Stage 2 should be test
    const stage2 = stages[1] as TestStageContent
    expect(stage2.type).toBe('test')
    expect(stage2.stage).toBe(2)
    // Logist-specific question key should be present in stage 2
    const questionKeys = stage2.questions.map((q) => q.key)
    expect(questionKeys.some((k) => !k.startsWith('core_') && !k.startsWith('road_'))).toBe(true)
  })

  it('sales_manager → возвращает 4 этапа с вопросами sales_manager', () => {
    const stages = buildStagesForRole('sales_manager')
    expect(stages).toHaveLength(4)
    const stage1 = stages[0] as QuestionnaireStageContent
    expect(stage1.type).toBe('questionnaire')
    expect(stage1.stage).toBe(1)
    const stage2 = stages[1] as TestStageContent
    expect(stage2.type).toBe('test')
    expect(stage2.stage).toBe(2)
  })

  it('logist_domestic без специализаций → core + road_ftl_ltl', () => {
    const stages = buildStagesForRole('logist_domestic')
    expect(stages).toHaveLength(4)
    // Stage 1: core questionnaire (domestic)
    const stage1 = stages[0] as QuestionnaireStageContent
    expect(stage1.type).toBe('questionnaire')
    expect(stage1.stage).toBe(1)
    // Stage 2 should contain core questions
    const stage2 = stages[1] as TestStageContent
    expect(stage2.type).toBe('test')
    const keys = stage2.questions.map((q) => q.key)
    expect(keys.some((k) => k.startsWith('core_'))).toBe(true)
    // Default fallback adds road_ftl_ltl questions
    expect(keys.some((k) => k.startsWith('road_'))).toBe(true)
  })

  it('logist_domestic с oversized → включает oversized вопросы в Stage 2', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_oversized_heavy', level: 'primary' },
    ]
    const stages = buildStagesForRole('logist_domestic', { specializations })
    expect(stages).toHaveLength(4)
    const stage2 = stages[1] as TestStageContent
    const keys = stage2.questions.map((q) => q.key)
    expect(keys.some((k) => k.startsWith('oversized_'))).toBe(true)
  })

  it('logist_domestic → Stage 3 психотест присутствует', () => {
    const stages = buildStagesForRole('logist_domestic')
    expect(stages).toHaveLength(4)
    const stage3 = stages[2] as PsychologyStageContent
    expect(stage3.type).toBe('psychology')
    expect(stage3.stage).toBe(3)
  })

  it('logist_domestic → Stage 4 практическое задание присутствует', () => {
    const stages = buildStagesForRole('logist_domestic')
    expect(stages).toHaveLength(4)
    const stage4 = stages[3] as AssignmentStageContent
    expect(stage4.type).toBe('assignment')
    expect(stage4.stage).toBe(4)
  })
})

describe('isDomesticRole', () => {
  it('logist_domestic → true', () => {
    expect(isDomesticRole('logist_domestic')).toBe(true)
  })

  it('logist → false', () => {
    expect(isDomesticRole('logist')).toBe(false)
  })

  it('sales_manager → false', () => {
    expect(isDomesticRole('sales_manager')).toBe(false)
  })
})
