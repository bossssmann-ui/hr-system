import { describe, expect, test } from 'bun:test'

import { computeTrustScore } from './trust-score'

const defaultWeights = { paste: 0.35, focus: 0.4, keystroke: 0.25 }

describe('computeTrustScore', () => {
  test('clean session yields a high score', () => {
    const score = computeTrustScore(
      {
        paste_events: { count: 0, sizes: [] },
        focus_loss_events: { count: 0, total_away_ms: 0 },
        keystroke_timing: { anomaly_flags: 0, burst_events: 0 },
      },
      defaultWeights,
    )

    expect(score).toBe(100)
  })

  test('heavy paste and focus loss yields low score', () => {
    const score = computeTrustScore(
      {
        paste_events: { count: 10, sizes: [1500, 1700, 800] },
        focus_loss_events: { count: 12, total_away_ms: 340000 },
        keystroke_timing: { anomaly_flags: 5, burst_events: 3 },
      },
      defaultWeights,
    )

    expect(score).toBeLessThan(20)
  })

  test('weight changes alter the computed score deterministically', () => {
    const signals = {
      paste_events: { count: 4, sizes: [300, 500] },
      focus_loss_events: { count: 3, total_away_ms: 120000 },
      keystroke_timing: { anomaly_flags: 1, burst_events: 1 },
    }
    const scorePasteHeavy = computeTrustScore(signals, { paste: 1, focus: 0, keystroke: 0 })
    const scoreFocusHeavy = computeTrustScore(signals, { paste: 0, focus: 1, keystroke: 0 })

    expect(scorePasteHeavy).not.toBe(scoreFocusHeavy)
  })

  test('clamps boundary values between 0 and 100', () => {
    const score = computeTrustScore(
      {
        paste_events: { count: 100, sizes: [999999] },
        focus_loss_events: { count: 100, total_away_ms: 99999999 },
        keystroke_timing: { anomaly_flags: 100, burst_events: 100 },
      },
      defaultWeights,
    )

    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
