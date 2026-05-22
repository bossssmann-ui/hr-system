/**
 * Quiet Hours helper — Phase 1E.
 *
 * Automated outbound messages (templated auto-ack, scheduled follow-ups)
 * must be deferred if sent during Quiet Hours: 22:00–09:00 tenant-local time.
 *
 * Manual recruiter sends are NEVER blocked.
 *
 * TODO(phase-1e+): tenant timezone preference — currently defaults to UTC.
 * When tenant-level timezone lands, pass it as `timezoneOffset` (minutes from UTC).
 */

const QUIET_HOUR_START = 22 // 22:00 local
const QUIET_HOUR_END = 9 // 09:00 local

/**
 * Returns true if `date` falls within Quiet Hours (22:00–09:00) in UTC.
 */
export function isInQuietHours(date: Date): boolean {
  const hour = date.getUTCHours()
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END
}

/**
 * Returns how many milliseconds to wait from `now` until Quiet Hours end.
 * Returns 0 if `now` is not in Quiet Hours.
 */
export function msUntilQuietHoursEnd(now: Date): number {
  if (!isInQuietHours(now)) return 0

  // Compute the next 09:00 UTC.
  const next = new Date(now)
  next.setUTCHours(QUIET_HOUR_END, 0, 0, 0)
  if (next <= now) {
    // 09:00 already passed today — target 09:00 tomorrow.
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return Math.max(0, next.getTime() - now.getTime())
}
