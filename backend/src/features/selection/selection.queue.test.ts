import { describe, expect, test } from 'bun:test'

import {
  computeCrossCheckFlags,
  shouldAutoRejectAfterStage1,
} from './selection.queue'

describe('computeCrossCheckFlags', () => {
  test('returns no flags for a clean stage 1 questionnaire', () => {
    const flags = computeCrossCheckFlags(1, {}, 'logist', [])
    expect(flags).toEqual([])
  })

  test('flags stop-criterion answers on stage 1 as RED', () => {
    const flags = computeCrossCheckFlags(
      1,
      { stop_salary: true, stop_location: 'fail' },
      'logist',
      [],
    )
    expect(flags).toHaveLength(2)
    expect(flags.every((f) => f.type === 'RED')).toBe(true)
    expect(flags.every((f) => f.id >= 100)).toBe(true)
  })

  test('flags both trap answers on stage 1 for logist', () => {
    const flags = computeCrossCheckFlags(
      1,
      { trap_answer_1: true, trap_answer_2: 'regular' },
      'logist',
      [],
    )
    expect(flags.map((f) => f.id).sort()).toEqual([1, 2])
    expect(flags.every((f) => f.type === 'RED')).toBe(true)
    expect(flags[0]?.description).toContain('несуществующей TMS')
  })

  test('uses sales-manager wording for traps when role=sales_manager', () => {
    const flags = computeCrossCheckFlags(
      1,
      { trap_answer_1: 'active' },
      'sales_manager',
      [],
    )
    expect(flags).toHaveLength(1)
    expect(flags[0]?.description).toContain('несуществующей CRM')
  })

  test('flags the Russian-labelled trap answer when the candidate selected the trap', () => {
    const flags = computeCrossCheckFlags(
      1,
      { trap_answer_1: 'Активно использовал' },
      'logist',
      [],
    )
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ id: 1, type: 'RED' })
  })

  test('does not flag the trap when the candidate selected "Не работал"', () => {
    const flags = computeCrossCheckFlags(
      1,
      { trap_answer_1: 'Не работал' },
      'logist',
      [],
    )
    expect(flags).toEqual([])
  })

  test('L-scale ORANGE on stage 3 fires only when 3+ fives are present', () => {
    const twoFives = computeCrossCheckFlags(3, { q17: 5, q18: 5, q19: 4, q20: 3 }, 'logist', [])
    expect(twoFives).toEqual([])

    const threeFives = computeCrossCheckFlags(3, { q17: 5, q18: 5, q19: '5', q20: 1 }, 'logist', [])
    expect(threeFives).toHaveLength(1)
    expect(threeFives[0]).toMatchObject({ id: 5, type: 'ORANGE' })
  })
})

describe('shouldAutoRejectAfterStage1', () => {
  test('does not auto-reject on a clean stage 1', () => {
    expect(shouldAutoRejectAfterStage1([])).toBe(false)
  })

  test('does not auto-reject on a single non-stop RED flag (HR review)', () => {
    expect(
      shouldAutoRejectAfterStage1([
        { id: 1, type: 'RED', description: 'trap', triggeredAt: 1 },
      ]),
    ).toBe(false)
  })

  test('auto-rejects on 2+ RED flags', () => {
    expect(
      shouldAutoRejectAfterStage1([
        { id: 1, type: 'RED', description: 'trap-1', triggeredAt: 1 },
        { id: 2, type: 'RED', description: 'trap-2', triggeredAt: 1 },
      ]),
    ).toBe(true)
  })

  test('auto-rejects on any single stop-criterion (id >= 100)', () => {
    expect(
      shouldAutoRejectAfterStage1([
        { id: 100, type: 'RED', description: 'salary out of range', triggeredAt: 1 },
      ]),
    ).toBe(true)
  })

  test('ignores ORANGE-only stage outcomes', () => {
    expect(
      shouldAutoRejectAfterStage1([
        { id: 5, type: 'ORANGE', description: 'L-scale', triggeredAt: 3 },
        { id: 7, type: 'ORANGE', description: 'inconsistency', triggeredAt: 2 },
      ]),
    ).toBe(false)
  })
})
