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
  'domestic_rail_container',
  'domestic_oversized_heavy',
  'domestic_remote_regions',
  'domestic_cabotage',
] as const

describe('getDomesticStageContent', () => {
  it('добавлены новые батареи вопросов для rail/oversized/remote/cabotage', () => {
    const rail = getDomesticStageContent('domestic_rail_container', 2) as TestStageContent
    const oversized = getDomesticStageContent('domestic_oversized_heavy', 2) as TestStageContent
    const remote = getDomesticStageContent('domestic_remote_regions', 2) as TestStageContent
    const cab = getDomesticStageContent('domestic_cabotage', 2) as TestStageContent

    expect(rail.questions.some((q) => q.key === 'rail_q_etran')).toBe(true)
    expect(rail.questions.some((q) => q.key === 'rail_q_gu12')).toBe(true)
    expect(rail.questions.some((q) => q.key === 'rail_q_etsng')).toBe(true)
    expect(rail.questions.some((q) => q.key === 'rail_q_operators_open')).toBe(true)

    expect(oversized.questions.some((q) => q.key === 'oversized_q_dimensions')).toBe(true)
    expect(oversized.questions.some((q) => q.key === 'oversized_q_permit_authority')).toBe(true)
    expect(oversized.questions.some((q) => q.key === 'oversized_q_project_permits_open')).toBe(true)

    expect(remote.questions.some((q) => q.key === 'remote_q_regions_open')).toBe(true)
    expect(remote.questions.some((q) => q.key === 'remote_q_north_delivery_open')).toBe(true)

    expect(cab.questions.some((q) => q.key === 'cab_q_document')).toBe(true)
    expect(cab.questions.some((q) => q.key === 'cab_q_svh')).toBe(true)
    expect(cab.questions.some((q) => q.key === 'cab_q_ports_lines_open')).toBe(true)
  })

  it('кросс-блок раскладки груза включён в road/rail/oversized', () => {
    const road = getDomesticStageContent('domestic_road_ftl_ltl', 2) as TestStageContent
    const rail = getDomesticStageContent('domestic_rail_container', 2) as TestStageContent
    const oversized = getDomesticStageContent('domestic_oversized_heavy', 2) as TestStageContent

    expect(road.questions.some((q) => q.key === 'q_cargo_layout_experience')).toBe(true)
    expect(rail.questions.some((q) => q.key === 'q_cargo_layout_experience')).toBe(true)
    expect(oversized.questions.some((q) => q.key === 'q_cargo_layout_experience')).toBe(true)
  })

  it('переведённые в open вопросы не содержат options/correct', () => {
    const rail = getDomesticStageContent('domestic_rail_container', 2) as TestStageContent
    const oversized = getDomesticStageContent('domestic_oversized_heavy', 2) as TestStageContent
    const remote = getDomesticStageContent('domestic_remote_regions', 2) as TestStageContent
    const cab = getDomesticStageContent('domestic_cabotage', 2) as TestStageContent
    const road = getDomesticStageContent('domestic_road_ftl_ltl', 2) as TestStageContent
    const core = getDomesticStageContent('domestic_core_operations', 2) as TestStageContent

    const keys = [
      'road_q2',
      'road_q3',
      'rail_q_etran',
      'rail_q_gu12',
      'rail_q_etsng',
      'rail_q1',
      'rail_q2',
      'rail_q3',
      'rail_q_container_types',
      'rail_q_demurrage_detention_storage',
      'oversized_q_dimensions',
      'oversized_q_train_length',
      'oversized_q_permit_authority',
      'oversized_q_axle_load',
      'oversized_q1',
      'oversized_q2',
      'oversized_q3',
      'remote_q1',
      'remote_q2',
      'remote_q3',
      'cab_q1',
      'cab_q2',
      'cab_q3',
      'cab_q_document',
      'cab_q_svh',
      'cab_q_free_period',
      'core_q2',
    ]
    const all = [...core.questions, ...road.questions, ...rail.questions, ...oversized.questions, ...remote.questions, ...cab.questions]

    for (const key of keys) {
      const q = all.find((item) => item.key === key)
      expect(q?.type).toBe('textarea')
      expect(q?.options).toBeUndefined()
      expect(q?.correct).toBeUndefined()
    }
  })

  it('возвращает null для неизвестного packageId', () => {
    const result = getDomesticStageContent('unknown_package' as any, 2)
    expect(result).toBeNull()
  })

  it('возвращает null для stage=99 любого пакета', () => {
    const result = getDomesticStageContent('domestic_core_operations', 99)
    expect(result).toBeNull()
  })

  it('domestic_distribution больше не отдаётся из package content', () => {
    const stage2 = getDomesticStageContent('domestic_distribution', 2)
    const stage4 = getDomesticStageContent('domestic_distribution', 4)
    expect(stage2).toBeNull()
    expect(stage4).toBeNull()
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
      const sumWeights = result.questions.reduce((acc, q) => acc + (q.weight ?? 0), 0)
      expect(sumWeights).toBe(result.maxScore)
    })
  }

  it('domestic_core_operations: stage=1 возвращает questionnaire', () => {
    const result = getDomesticStageContent('domestic_core_operations', 1) as QuestionnaireStageContent
    expect(result).not.toBeNull()
    expect(result.type).toBe('questionnaire')
    expect(result.stage).toBe(1)
    expect(result.questions.length).toBeGreaterThan(0)
    expect(result.questions.some((q) => q.key === 'q_1c_experience')).toBe(true)
    expect(result.questions.some((q) => q.key === 'q_counterparty_checks')).toBe(true)
    expect(result.questions.some((q) => q.key === 'q_hardest_shipment')).toBe(true)
  })

  it('domestic_core_operations: stage=2 passThreshold обновлён под новый maxScore', () => {
    const result = getDomesticStageContent('domestic_core_operations', 2) as TestStageContent
    expect(result.maxScore).toBe(21)
    expect(result.passThreshold).toBe(13)
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
    expect(s2.questions.filter((q) => q.key === 'q_breakdown_500km')).toHaveLength(1)
  })

  it('нет дублирования вопросов в Stage 2', () => {
    const specializations: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
      { packageId: 'domestic_rail_container', level: 'primary' },
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
      { packageId: 'domestic_cabotage', level: 'primary' },
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
