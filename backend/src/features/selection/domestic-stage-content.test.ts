import { describe, it, expect } from 'bun:test'
import {
  getDomesticStageContent,
  buildDomesticStages,
} from './domestic-stage-content'
import type { TestStageContent, QuestionnaireStageContent, AssignmentStageContent } from './stage-content'
import type { SpecializationAssignment } from './domestic-specializations'

const ALL_PACKAGES = [
  'domestic_core_operations',
  'domestic_road_ftl_ltl',
  'domestic_distribution',
  'domestic_rail_container',
  'domestic_oversized_heavy',
  'domestic_remote_regions',
  'domestic_cabotage',
] as const

describe('getDomesticStageContent', () => {
  it('возвращает null для неизвестного packageId', () => {
    const result = getDomesticStageContent('unknown_package' as any, 2)
    expect(result).toBeNull()
  })

  it('возвращает null для stage=99 любого пакета', () => {
    const result = getDomesticStageContent('domestic_core_operations', 99)
    expect(result).toBeNull()
  })

  // Stage 2 tests for all packages
  for (const pkg of ALL_PACKAGES) {
    it(`${pkg}: stage=2 возвращает контент типа test`, () => {
      const result = getDomesticStageContent(pkg, 2)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('test')
      expect(result!.stage).toBe(2)
    })

    it(`${pkg}: stage=2 содержит вопросы (> 0)`, () => {
      const result = getDomesticStageContent(pkg, 2) as TestStageContent
      expect(result).not.toBeNull()
      expect(result.questions.length).toBeGreaterThan(0)
    })

    it(`${pkg}: stage=2 radio-вопросы имеют поле correct`, () => {
      const result = getDomesticStageContent(pkg, 2) as TestStageContent
      expect(result).not.toBeNull()
      for (const q of result.questions) {
        if (q.type === 'radio') {
          expect(typeof q.correct).toBe('string')
          expect(q.correct!.length).toBeGreaterThan(0)
          expect(q.options).toBeDefined()
          expect(q.options!.includes(q.correct!)).toBe(true)
        }
      }
    })

    it(`${pkg}: stage=2 все вопросы имеют key и text`, () => {
      const result = getDomesticStageContent(pkg, 2) as TestStageContent
      for (const q of result.questions) {
        expect(typeof q.key).toBe('string')
        expect(q.key.length).toBeGreaterThan(0)
        expect(typeof q.text).toBe('string')
        expect(q.text.length).toBeGreaterThan(0)
      }
    })

    it(`${pkg}: stage=2 вопросы имеют weight`, () => {
      const result = getDomesticStageContent(pkg, 2) as TestStageContent
      for (const q of result.questions) {
        expect(typeof q.weight).toBe('number')
        expect(q.weight!).toBeGreaterThanOrEqual(0)
      }
    })
  }

  it('domestic_core_operations: stage=1 возвращает questionnaire', () => {
    const result = getDomesticStageContent('domestic_core_operations', 1) as QuestionnaireStageContent
    expect(result).not.toBeNull()
    expect(result.type).toBe('questionnaire')
    expect(result.stage).toBe(1)
    expect(result.questions.length).toBeGreaterThan(0)
  })

  it('domestic_road_ftl_ltl: stage=1 возвращает null (нет анкеты)', () => {
    const result = getDomesticStageContent('domestic_road_ftl_ltl', 1)
    expect(result).toBeNull()
  })

  // Stage 4 for non-core packages
  const NON_CORE_PACKAGES = ALL_PACKAGES.filter((p) => p !== 'domestic_core_operations')
  for (const pkg of NON_CORE_PACKAGES) {
    it(`${pkg}: stage=4 возвращает практическое задание`, () => {
      const result = getDomesticStageContent(pkg, 4) as AssignmentStageContent
      expect(result).not.toBeNull()
      expect(result.type).toBe('assignment')
      expect(result.stage).toBe(4)
      expect(typeof result.description).toBe('string')
      expect(result.description.length).toBeGreaterThan(10)
      expect(result.traps.length).toBeGreaterThan(0)
    })
  }

  it('возвращает клон — мутация не просачивается между вызовами', () => {
    const a = getDomesticStageContent('domestic_core_operations', 2) as TestStageContent
    a.questions[0]!.text = 'MUTATED'
    const b = getDomesticStageContent('domestic_core_operations', 2) as TestStageContent
    expect(b.questions[0]!.text).not.toBe('MUTATED')
  })
})

describe('buildDomesticStages', () => {
  it('пустые специализации → только core + road_ftl_ltl (fallback), Stage 4 присутствует', () => {
    const stages = buildDomesticStages([])
    const types = stages.map((s) => s.stage)
    expect(types).toContain(1)
    expect(types).toContain(2)
    expect(types).toContain(3)
    expect(types).toContain(4)
  })

  it('всегда включает domestic_core_operations в Stage 1', () => {
    const stages = buildDomesticStages([])
    const s1 = stages.find((s) => s.stage === 1)
    expect(s1).toBeDefined()
    expect(s1!.type).toBe('questionnaire')
  })

  it('Stage 2 содержит вопросы из primary пакетов', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const stages = buildDomesticStages(specializations)
    const s2 = stages.find((s) => s.stage === 2) as TestStageContent
    expect(s2).toBeDefined()
    expect(s2.type).toBe('test')
    // Should have more questions than core alone
    const coreOnly = buildDomesticStages([{ packageId: 'domestic_core_operations', level: 'primary' }])
    const coreS2 = coreOnly.find((s) => s.stage === 2) as TestStageContent
    expect(s2.questions.length).toBeGreaterThan(coreS2.questions.length)
  })

  it('нет дублирования вопросов в Stage 2', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
      { packageId: 'domestic_distribution', level: 'primary' },
    ]
    const stages = buildDomesticStages(specializations)
    const s2 = stages.find((s) => s.stage === 2) as TestStageContent
    const keys = s2.questions.map((q) => q.key)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })

  it('Stage 4 всегда присутствует', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
    ]
    const stages = buildDomesticStages(specializations)
    const s4 = stages.find((s) => s.stage === 4)
    expect(s4).toBeDefined()
    expect(s4!.type).toBe('assignment')
  })

  it('Stage 4 использует практическое задание из первой non-core primary специализации', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_rail_container', level: 'primary' },
      { packageId: 'domestic_distribution', level: 'primary' },
    ]
    const stages = buildDomesticStages(specializations)
    const s4 = stages.find((s) => s.stage === 4) as AssignmentStageContent
    // Should use rail_container since it's first non-core primary
    const railAssignment = getDomesticStageContent('domestic_rail_container', 4) as AssignmentStageContent
    expect(s4.description).toBe(railAssignment.description)
  })

  it('Stage 4 fallback к road_ftl_ltl когда только core present', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
    ]
    const stages = buildDomesticStages(specializations)
    const s4 = stages.find((s) => s.stage === 4) as AssignmentStageContent
    const roadAssignment = getDomesticStageContent('domestic_road_ftl_ltl', 4) as AssignmentStageContent
    expect(s4.description).toBe(roadAssignment.description)
  })

  it('Stage 3 (психологический тест) присутствует', () => {
    const stages = buildDomesticStages([])
    const s3 = stages.find((s) => s.stage === 3)
    expect(s3).toBeDefined()
    expect(s3!.type).toBe('psychology')
  })

  it('возвращает ровно 4 этапа', () => {
    const stages = buildDomesticStages([
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'secondary' },
    ])
    expect(stages).toHaveLength(4)
  })
})
