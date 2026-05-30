import { describe, expect, test } from 'bun:test'

import {
  applyChosenTrap,
  getAllStagesContent,
  getStageContent,
  getTrapPool,
  pickRandomTrapKey,
  scoreStage2,
  type QuestionnaireStageContent,
  type TestStageContent,
} from './stage-content'

const ROLES = ['logist', 'sales_manager'] as const

describe('getStageContent — shape validation', () => {
  for (const role of ROLES) {
    test(`returns 4 stages for ${role} with required fields`, () => {
      const stages = getAllStagesContent(role)
      expect(stages).toHaveLength(4)
      expect(stages.map((s) => s.stage)).toEqual([1, 2, 3, 4])
      for (const s of stages) {
        expect(typeof s.title).toBe('string')
        expect(s.title.length).toBeGreaterThan(0)
      }
    })

    test(`stage 1 (${role}) is a questionnaire with stop_* keys and a trap pool`, () => {
      const s = getStageContent(role, 1) as QuestionnaireStageContent
      expect(s.type).toBe('questionnaire')
      const keys = s.questions.map((q) => q.key)
      for (const k of ['stop_salary', 'stop_experience', 'stop_location', 'stop_format', 'trap_answer_1']) {
        expect(keys).toContain(k)
      }
      expect(s.trapPool?.questionKey).toBe('trap_answer_1')
      expect(s.trapPool?.options.length).toBeGreaterThanOrEqual(3)
    })

    test(`stage 2 (${role}) has 15 questions and weights summing to maxScore`, () => {
      const s = getStageContent(role, 2) as TestStageContent
      expect(s.type).toBe('test')
      expect(s.timeLimitMin).toBe(30)
      expect(s.questions).toHaveLength(15)
      const sumWeights = s.questions.reduce((acc, q) => acc + (q.weight ?? 0), 0)
      expect(sumWeights).toBe(s.maxScore)
      // every radio has a correct value
      for (const q of s.questions) {
        if (q.type === 'radio') {
          expect(typeof q.correct).toBe('string')
          expect(q.options?.includes(q.correct!)).toBe(true)
        }
      }
    })

    test(`stage 3 (${role}) is a psychology scale with 20 items including L-scale q17..q20`, () => {
      const s = getStageContent(role, 3)
      expect(s.type).toBe('psychology')
      if (s.type !== 'psychology') return
      expect(s.questions).toHaveLength(20)
      const lKeys = s.questions.filter((q) => q.block === 'L').map((q) => q.key)
      for (const k of ['q17', 'q18', 'q19', 'q20']) {
        expect(lKeys).toContain(k)
      }
    })

    test(`stage 4 (${role}) is a free-text assignment with traps`, () => {
      const s = getStageContent(role, 4)
      expect(s.type).toBe('assignment')
      if (s.type !== 'assignment') return
      expect(s.answerKey).toBe('stage4_answer')
      expect(s.timeEstimate).toContain('35')
      expect(s.traps.length).toBeGreaterThanOrEqual(3)
    })
  }

  test('returned objects are clones — mutation does not leak across calls', () => {
    const a = getStageContent('logist', 1)
    if (a.type === 'questionnaire') a.questions[0]!.text = 'MUTATED'
    const b = getStageContent('logist', 1)
    expect(b.type === 'questionnaire' && b.questions[0]!.text).not.toBe('MUTATED')
  })
})

describe('trap randomisation', () => {
  for (const role of ROLES) {
    test(`pickRandomTrapKey(${role}) always returns a pool member`, () => {
      const pool = getTrapPool(role)
      for (let i = 0; i < 30; i += 1) {
        expect(pool).toContain(pickRandomTrapKey(role))
      }
    })
  }

  test('applyChosenTrap renames placeholder and strips the pool', () => {
    const s = getStageContent('logist', 1) as QuestionnaireStageContent
    const applied = applyChosenTrap(s, 'CargoSoft NextGen')
    const trapQ = applied.questions.find((q) => q.key === 'trap_answer_1')
    expect(trapQ?.text).toContain('CargoSoft NextGen')
    expect(trapQ?.text).not.toContain('[TRAP]')
    // pool must NOT be returned to the candidate
    expect(applied.trapPool).toBeUndefined()
  })
})

describe('scoreStage2 — auto-scoring of radio questions', () => {
  test('all correct logist radio answers yield the full auto-max', () => {
    const s = getStageContent('logist', 2) as TestStageContent
    const answers: Record<string, unknown> = {}
    for (const q of s.questions) {
      if (q.type === 'radio' && q.correct) answers[q.key] = q.correct
    }
    const result = scoreStage2('logist', answers)
    expect(result.autoScore).toBe(result.autoMax)
    // auto-max must be the sum of radio weights, which is < stageMax (open Qs)
    expect(result.autoMax).toBeLessThan(result.stageMax)
  })

  test('all wrong sales_manager radio answers yield 0', () => {
    const result = scoreStage2('sales_manager', { q1: 'nonsense', q2: 'nonsense' })
    expect(result.autoScore).toBe(0)
    expect(result.autoMax).toBeGreaterThan(0)
  })

  test('partial correctness sums per-question weights', () => {
    const s = getStageContent('logist', 2) as TestStageContent
    const q1 = s.questions.find((q) => q.key === 'q1')!
    const result = scoreStage2('logist', { q1: q1.correct })
    expect(result.autoScore).toBe(q1.weight!)
    expect(result.perQuestion['q1']).toMatchObject({ correct: true, awarded: q1.weight! })
  })
})
