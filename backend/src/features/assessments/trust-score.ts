import { trustSignalsSchema, type TrustSignals } from '@web-app-demo/contracts'

export type TrustScoreWeights = {
  paste: number
  focus: number
  keystroke: number
}

type NormalizedPenaltyInput = {
  pasteEvents: number
  pastedChars: number
  focusLossEvents: number
  focusAwayMs: number
  keystrokeAnomalies: number
}

const PASTE_EVENT_PENALTY_THRESHOLD = 8
const PASTED_CHAR_PENALTY_THRESHOLD = 3000
const FOCUS_LOSS_EVENT_PENALTY_THRESHOLD = 10
const FOCUS_AWAY_MS_PENALTY_THRESHOLD = 300000
const KEYSTROKE_ANOMALY_PENALTY_THRESHOLD = 6

export function computeTrustScore(signalsInput: unknown, weights: TrustScoreWeights): number {
  const signals = trustSignalsSchema.parse(signalsInput)
  const normalized = normalizePenaltyInput(signals)
  const totalWeight = Math.max(0, weights.paste) + Math.max(0, weights.focus) + Math.max(0, weights.keystroke)

  if (totalWeight <= 0) return 100

  const pastePenalty =
    Math.min(
      1,
      normalized.pasteEvents / PASTE_EVENT_PENALTY_THRESHOLD +
      normalized.pastedChars / PASTED_CHAR_PENALTY_THRESHOLD,
    )
  const focusPenalty =
    Math.min(
      1,
      normalized.focusLossEvents / FOCUS_LOSS_EVENT_PENALTY_THRESHOLD +
      normalized.focusAwayMs / FOCUS_AWAY_MS_PENALTY_THRESHOLD,
    )
  const keystrokePenalty = Math.min(1, normalized.keystrokeAnomalies / KEYSTROKE_ANOMALY_PENALTY_THRESHOLD)

  const weightedPenalty =
    (pastePenalty * Math.max(0, weights.paste) +
      focusPenalty * Math.max(0, weights.focus) +
      keystrokePenalty * Math.max(0, weights.keystroke)) /
    totalWeight

  return clampToScore(Math.round((1 - weightedPenalty) * 100))
}

function normalizePenaltyInput(signals: TrustSignals): NormalizedPenaltyInput {
  return {
    pasteEvents: signals.paste_events.count,
    pastedChars: signals.paste_events.sizes.reduce((sum, size) => sum + Math.max(0, size), 0),
    focusLossEvents: signals.focus_loss_events.count,
    focusAwayMs: signals.focus_loss_events.total_away_ms,
    keystrokeAnomalies: signals.keystroke_timing.anomaly_flags + signals.keystroke_timing.burst_events,
  }
}

function clampToScore(value: number) {
  return Math.max(0, Math.min(100, value))
}
