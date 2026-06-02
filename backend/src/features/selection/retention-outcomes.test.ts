import { describe, expect, test } from 'bun:test'

import { computeRetentionOutcome } from './retention-outcomes'

describe('computeRetentionOutcome', () => {
  test('termination on day 29 -> not survived30', () => {
    const out = computeRetentionOutcome({
      hireDate: new Date('2026-01-01T00:00:00.000Z'),
      terminatedAt: new Date('2026-01-30T00:00:00.000Z'),
      now: new Date('2026-02-15T00:00:00.000Z'),
    })
    expect(out.observedDays).toBe(29)
    expect(out.survived30).toBe(false)
  })

  test('termination on day 31 -> survived30', () => {
    const out = computeRetentionOutcome({
      hireDate: new Date('2026-01-01T00:00:00.000Z'),
      terminatedAt: new Date('2026-02-01T00:00:00.000Z'),
      now: new Date('2026-02-15T00:00:00.000Z'),
    })
    expect(out.observedDays).toBe(31)
    expect(out.survived30).toBe(true)
  })
})
