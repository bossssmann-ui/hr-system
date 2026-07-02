import type { Role } from '../requisitions/requisitions.fsm'

export const OKR_STATUSES = ['draft', 'active', 'achieved', 'missed'] as const
export type OkrStatus = (typeof OKR_STATUSES)[number]

export const KEY_RESULT_STATUSES = ['open', 'on_track', 'at_risk', 'achieved'] as const
export type KeyResultStatus = (typeof KEY_RESULT_STATUSES)[number]

export const KEY_RESULT_ON_TRACK_RATIO = 0.7
export const KEY_RESULT_ACHIEVED_RATIO = 1

type OkrTransition = {
  from: OkrStatus
  to: OkrStatus
  allowedRoles: ReadonlyArray<Role>
}

export const OKR_TRANSITIONS: ReadonlyArray<OkrTransition> = [
  { from: 'draft', to: 'active', allowedRoles: ['employee', 'hiring_manager', 'hr_admin', 'owner'] },
  { from: 'active', to: 'achieved', allowedRoles: ['employee', 'hiring_manager', 'hr_admin', 'owner'] },
  { from: 'active', to: 'missed', allowedRoles: ['employee', 'hiring_manager', 'hr_admin', 'owner'] },
]

const TERMINAL_OKR_STATUSES = new Set<OkrStatus>(['achieved', 'missed'])

export function isTerminalOkrStatus(status: OkrStatus): boolean {
  return TERMINAL_OKR_STATUSES.has(status)
}

export function canOkrTransition(from: OkrStatus, to: OkrStatus, actorRoles: ReadonlyArray<Role>): boolean {
  if (from === to) return false
  if (isTerminalOkrStatus(from)) return false
  const transition = OKR_TRANSITIONS.find((item) => item.from === from && item.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function computeKeyResultRatio({
  currentValue,
  startValue,
  targetValue,
}: {
  currentValue: number
  startValue: number
  targetValue: number
}): number {
  if (targetValue === startValue) {
    return currentValue >= targetValue ? 1 : 0
  }

  const raw = (currentValue - startValue) / (targetValue - startValue)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(1, raw))
}

export function keyResultStatusFromRatio(ratio: number): KeyResultStatus {
  if (ratio >= KEY_RESULT_ACHIEVED_RATIO) return 'achieved'
  if (ratio >= KEY_RESULT_ON_TRACK_RATIO) return 'on_track'
  if (ratio > 0) return 'at_risk'
  return 'open'
}

export function computeOkrProgressPercent(
  keyResults: Array<{ currentValue: number; startValue: number; targetValue: number }>,
): number {
  if (keyResults.length === 0) return 0
  const avgRatio =
    keyResults.reduce(
      (acc, keyResult) =>
        acc +
        computeKeyResultRatio({
          currentValue: keyResult.currentValue,
          startValue: keyResult.startValue,
          targetValue: keyResult.targetValue,
        }),
      0,
    ) / keyResults.length
  return Math.round(avgRatio * 100)
}
