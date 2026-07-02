/**
 * Finite state machine for `OneOnOne.status` — Horizon 4.
 *
 * Transitions:  scheduled → completed
 *               scheduled → cancelled
 *
 * `completed` and `cancelled` are terminal — no outbound transitions exist.
 *
 * Routes MUST call `canTransition(from, to, actorRoles)` before any status
 * mutation and respond with HTTP 409 on a terminal source state or HTTP 422
 * on a disallowed transition.
 *
 * Pure module — no I/O, no Prisma.
 */

import type { Role } from '../requisitions/requisitions.fsm'

export const ONE_ON_ONE_STATUSES = ['scheduled', 'completed', 'cancelled'] as const

export type OneOnOneStatus = (typeof ONE_ON_ONE_STATUSES)[number]

type Transition = {
  from: OneOnOneStatus
  to: OneOnOneStatus
  allowedRoles: ReadonlyArray<Role>
}

export const ONE_ON_ONE_TRANSITIONS: ReadonlyArray<Transition> = [
  { from: 'scheduled', to: 'completed', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
  { from: 'scheduled', to: 'cancelled', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
]

const TERMINAL_STATUSES = new Set<OneOnOneStatus>(['completed', 'cancelled'])

export function isTerminalStatus(status: OneOnOneStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function canTransition(
  from: OneOnOneStatus,
  to: OneOnOneStatus,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = ONE_ON_ONE_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}
