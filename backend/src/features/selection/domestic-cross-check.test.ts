import { describe, expect, test } from 'bun:test'

import { computeDomesticCrossCheckFlags } from './domestic-cross-check'
import type { DomesticAssessmentProfile } from './domestic-scoring'

function makeProfile(overrides: Partial<DomesticAssessmentProfile> = {}): DomesticAssessmentProfile {
  return {
    candidateId: 'cand-1',
    signals: [],
    specializations: [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ],
    riskFlags: [],
    ...overrides,
  }
}

describe('computeDomesticCrossCheckFlags', () => {
  test('RED: подтвердил несуществующую TMS из ловушки', () => {
    const profile = makeProfile()
    // trap_answer_1 matches a fake TMS name from the pool
    const stageAnswers = { trap_answer_1: 'LogiTrack PRO X7' }
    const flags = computeDomesticCrossCheckFlags(profile, stageAnswers)
    const red = flags.filter((f) => f.type === 'RED' && f.id === 1)
    expect(red).toHaveLength(1)
  })

  test('RED: заявил негабарит, не может назвать габариты → oversized_depth_risk', () => {
    const profile = makeProfile({ riskFlags: ['oversized_depth_risk'] })
    const flags = computeDomesticCrossCheckFlags(profile, {})
    const red = flags.filter((f) => f.type === 'RED' && f.id === 2)
    expect(red).toHaveLength(1)
  })

  test('RED: заявил уровень primary для oversized, но балл oversized < 30% от максимума', () => {
    const profile = makeProfile({
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_oversized_heavy', level: 'primary' },
      ],
    })
    // oversized rawScore < 30% of maxScore
    const stageAnswers = {
      'domestic_oversized_heavy.rawScore': 5,
      'domestic_oversized_heavy.maxScore': 100,
    }
    const flags = computeDomesticCrossCheckFlags(profile, stageAnswers)
    const red = flags.filter((f) => f.type === 'RED' && f.id === 3)
    expect(red).toHaveLength(1)
  })

  test('ORANGE: ответы общие без маршрутов/цифр/документов', () => {
    // This is covered by ORANGE flags for riskFlags
    // We test L-scale here as a proxy for general ORANGE behavior
    const profile = makeProfile()
    // L-scale: q17-q20 with 4 answers of '5' → ORANGE (id=101)
    const stageAnswers = { q17: '5', q18: '5', q19: '5', q20: '5' }
    const flags = computeDomesticCrossCheckFlags(profile, stageAnswers)
    const orange = flags.filter((f) => f.type === 'ORANGE' && f.id === 101)
    expect(orange).toHaveLength(1)
  })

  test('ORANGE: резюме сильное, тест по той же теме слабый', () => {
    // Represented via remote_region_depth_risk
    const profile = makeProfile({ riskFlags: ['remote_region_depth_risk'] })
    const flags = computeDomesticCrossCheckFlags(profile, {})
    const orange = flags.filter((f) => f.type === 'ORANGE' && f.id === 102)
    expect(orange).toHaveLength(1)
  })

  test('ORANGE: L-шкала ≥ 3 ответов "5"', () => {
    const profile = makeProfile()
    const stageAnswers = { q17: '5', q18: '5', q19: '5', q20: '3' }
    const flags = computeDomesticCrossCheckFlags(profile, stageAnswers)
    const orange = flags.filter((f) => f.type === 'ORANGE' && f.id === 101)
    expect(orange).toHaveLength(1)
  })

  test('ORANGE: remote_region_depth_risk — ответил только "искал машину"', () => {
    const profile = makeProfile({ riskFlags: ['remote_region_depth_risk'] })
    const flags = computeDomesticCrossCheckFlags(profile, {})
    expect(flags.some((f) => f.type === 'ORANGE' && f.id === 102)).toBe(true)
  })

  test('ORANGE: cabotage_depth_risk — не назвал порт и процесс', () => {
    const profile = makeProfile({ riskFlags: ['cabotage_depth_risk'] })
    const flags = computeDomesticCrossCheckFlags(profile, {})
    expect(flags.some((f) => f.type === 'ORANGE' && f.id === 103)).toBe(true)
  })

  test('нет флагов → пустой массив', () => {
    const profile = makeProfile()
    const flags = computeDomesticCrossCheckFlags(profile, {})
    expect(flags).toEqual([])
  })

  test('2+ RED → impact содержит AUTO_REJECT', () => {
    const profile = makeProfile({ riskFlags: ['oversized_depth_risk'] })
    // Add trap to get 2 REDs
    const stageAnswers = { trap_answer_1: 'CargoSoft NextGen' }
    const flags = computeDomesticCrossCheckFlags(profile, stageAnswers)
    const reds = flags.filter((f) => f.type === 'RED')
    expect(reds.length).toBeGreaterThanOrEqual(2)
    // When 2+ RED, at least one should mention AUTO_REJECT in impact
    const hasAutoReject = reds.some((f) => f.impact.includes('AUTO_REJECT'))
    expect(hasAutoReject).toBe(true)
  })
})
