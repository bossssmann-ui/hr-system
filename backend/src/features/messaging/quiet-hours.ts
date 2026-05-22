/**
 * Quiet Hours helper — configurable active-send-window enforcement.
 *
 * This company spans Vladivostok (UTC+10) → Moscow (UTC+3). The active send
 * window is therefore 09:00 Vladivostok → 18:00 Moscow = 23:00 UTC → 15:00 UTC.
 * Automated outbound is deferred when outside the active window (i.e. during
 * the "quiet" period 15:00–23:00 UTC). Manual recruiter sends are NEVER blocked.
 *
 * Configuration (env vars — see AppEnv):
 *   QUIET_HOURS_QUIET_START_UTC   UTC hour when the quiet period begins (default 15)
 *   QUIET_HOURS_QUIET_END_UTC     UTC hour when the quiet period ends / active resumes (default 23)
 *
 * Both helpers accept an optional QuietHoursConfig so they can be reused by
 * any future automated-outbound path (Notifier, scheduled jobs, etc.) without
 * drifting from the central definition.
 */

export type QuietHoursConfig = {
  /** UTC hour (0–23) when the quiet period begins, inclusive. Default 15. */
  quietStartUtcHour: number
  /** UTC hour (0–23) when the quiet period ends (exclusive — active resumes). Default 23. */
  quietEndUtcHour: number
}

/**
 * Default config: quiet 15:00–23:00 UTC, active 23:00 UTC → 15:00 UTC (next day).
 * Encodes the Vladivostok (09:00, UTC+10) → Moscow (18:00, UTC+3) active window.
 */
export const DEFAULT_QUIET_HOURS_CONFIG: QuietHoursConfig = {
  quietStartUtcHour: 15,
  quietEndUtcHour: 23,
}

/**
 * Builds a QuietHoursConfig from the relevant AppEnv fields.
 */
export function quietHoursConfigFromEnv(env: {
  QUIET_HOURS_QUIET_START_UTC: number
  QUIET_HOURS_QUIET_END_UTC: number
}): QuietHoursConfig {
  return {
    quietStartUtcHour: env.QUIET_HOURS_QUIET_START_UTC,
    quietEndUtcHour: env.QUIET_HOURS_QUIET_END_UTC,
  }
}

/**
 * Returns true if `date` falls within the configured quiet period.
 *
 * Handles wrap-around: when quietStart > quietEnd the quiet window spans
 * midnight UTC (e.g. 22:00–09:00). When quietStart < quietEnd the window is
 * a daytime range (e.g. 15:00–23:00). When quietStart === quietEnd there is
 * no quiet period (returns false).
 */
export function isInQuietHours(date: Date, config: QuietHoursConfig = DEFAULT_QUIET_HOURS_CONFIG): boolean {
  const h = date.getUTCHours()
  const { quietStartUtcHour: s, quietEndUtcHour: e } = config
  if (s === e) return false
  if (s < e) {
    // Simple range — quiet when s <= h < e (no midnight wrap).
    return h >= s && h < e
  }
  // Wrap-around — quiet when h >= s OR h < e.
  return h >= s || h < e
}

/**
 * Returns milliseconds from `now` until the quiet period ends (active window resumes).
 * Returns 0 if `now` is not in quiet hours.
 *
 * Deferred messages are released at the next `quietEndUtcHour:00:00 UTC`.
 */
export function msUntilQuietHoursEnd(now: Date, config: QuietHoursConfig = DEFAULT_QUIET_HOURS_CONFIG): number {
  if (!isInQuietHours(now, config)) return 0

  const { quietEndUtcHour: e } = config
  const next = new Date(now)
  next.setUTCHours(e, 0, 0, 0)
  if (next <= now) {
    // End hour already passed today — target tomorrow.
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return Math.max(0, next.getTime() - now.getTime())
}
