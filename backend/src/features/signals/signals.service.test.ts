import { describe, expect, test } from 'bun:test'

import { computeBurnout, computeFlightRisk } from './signals.service'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function emp(overrides: Partial<{ id: string; hireDate: Date | null; status: string; probationOutcome: string | null; agreedBaseSalary: number | null }> = {}) {
  return {
    id: 'e1',
    hireDate: new Date('2023-01-01T00:00:00.000Z'),
    status: 'active',
    probationOutcome: null,
    agreedBaseSalary: 100000,
    ...overrides,
  }
}

describe('computeFlightRisk', () => {
  test('scores 0 for a fresh hire with no negative signals', () => {
    const result = computeFlightRisk({
      now: NOW,
      employee: emp({ hireDate: new Date('2026-05-15T00:00:00.000Z') }),
      lastOneOnOne: { employeeId: 'e1', scheduledAt: new Date('2026-05-25T00:00:00.000Z'), status: 'completed' },
      cancelled1on1sLast90d: 0,
      declinedReviewsLast180d: 0,
      lastCompChange: null,
      lastPromotion: null,
    })
    expect(result.type).toBe('flight_risk')
    expect(result.score).toBe(0)
    expect(result.factors).toEqual([])
  })

  test('accumulates factors for long-tenure stagnation + missed 1on1s', () => {
    const result = computeFlightRisk({
      now: NOW,
      employee: emp({ hireDate: new Date('2022-01-01T00:00:00.000Z') }), // >3y tenure
      lastOneOnOne: null,
      cancelled1on1sLast90d: 3,
      declinedReviewsLast180d: 2,
      lastCompChange: null,
      lastPromotion: null,
    })
    const codes = result.factors.map((f) => f.code)
    expect(codes).toContain('no_recent_1on1')
    expect(codes).toContain('cancelled_1on1s')
    expect(codes).toContain('declined_reviews')
    expect(codes).toContain('comp_stagnation')
    expect(codes).toContain('no_promotion')
    expect(result.score).toBe(100) // capped
  })
})

describe('computeBurnout', () => {
  test('triggers on at-risk OKR overload + support gap', () => {
    const result = computeBurnout({
      now: NOW,
      employee: emp(),
      lastOneOnOne: null,
      cancelled1on1sLast90d: 0,
      okrAtRisk: 3,
      okrActive: 4,
      consecutiveQuartersWithoutPromotion: 2,
    })
    const codes = result.factors.map((f) => f.code)
    expect(codes).toContain('support_gap')
    expect(codes).toContain('okr_overload')
    expect(result.score).toBeGreaterThanOrEqual(55)
  })

  test('extended probation adds a dedicated factor', () => {
    const result = computeBurnout({
      now: NOW,
      employee: emp({ probationOutcome: 'extended' }),
      lastOneOnOne: { employeeId: 'e1', scheduledAt: new Date('2026-05-20T00:00:00.000Z'), status: 'completed' },
      cancelled1on1sLast90d: 0,
      okrAtRisk: 0,
      okrActive: 0,
      consecutiveQuartersWithoutPromotion: 0,
    })
    const codes = result.factors.map((f) => f.code)
    expect(codes).toContain('probation_extended')
  })
})
