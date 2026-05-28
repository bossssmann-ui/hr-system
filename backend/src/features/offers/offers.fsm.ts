/**
 * Finite state machine for `Offer.status` — Phase 3.
 *
 * The state diagram and per-role transition table live in
 * `docs/contracts/20-fsm.md`. Routes MUST call
 * `canTransition(from, to, actorRoles)` before mutating `Offer.status` and
 * respond with HTTP 422 `fsm.forbidden_transition` on failure. RLS is the
 * second line of defence — never the first.
 *
 * Pure module — no I/O, no Prisma.
 */

import type { Role } from '../requisitions/requisitions.fsm'

export const OFFER_STATUSES = [
  'draft',
  'manager_review',
  'approved',
  'sent',
  'accepted',
  'declined',
  'expired',
] as const

export type OfferStatus = (typeof OFFER_STATUSES)[number]

type Transition = {
  from: OfferStatus
  to: OfferStatus
  allowedRoles: ReadonlyArray<Role>
}

export const OFFER_TRANSITIONS: ReadonlyArray<Transition> = [
  { from: 'draft', to: 'manager_review', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'manager_review', to: 'approved', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
  { from: 'manager_review', to: 'draft', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
  { from: 'approved', to: 'sent', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'sent', to: 'accepted', allowedRoles: ['recruiter', 'hr_admin', 'owner', 'candidate'] },
  { from: 'sent', to: 'declined', allowedRoles: ['recruiter', 'hr_admin', 'owner', 'candidate'] },
  { from: 'sent', to: 'expired', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'approved', to: 'draft', allowedRoles: ['hr_admin', 'owner'] },
]

const TERMINAL_STATUSES = new Set<OfferStatus>(['accepted', 'declined', 'expired'])

export function isTerminalStatus(status: OfferStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function canTransition(
  from: OfferStatus,
  to: OfferStatus,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = OFFER_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function allowedNextStatuses(
  from: OfferStatus,
  actorRoles: ReadonlyArray<Role>,
): OfferStatus[] {
  return OFFER_TRANSITIONS
    .filter((t) => t.from === from && actorRoles.some((role) => t.allowedRoles.includes(role)))
    .map((t) => t.to)
}
