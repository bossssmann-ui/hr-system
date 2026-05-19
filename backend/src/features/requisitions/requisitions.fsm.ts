/**
 * Finite state machine for `HiringRequisition.status`.
 *
 * The state diagram and the per-role transition table live in
 * `docs/contracts/20-fsm.md`. This file is the executable encoding of that
 * table. Routes MUST call `canTransition(from, to, actorRoles)` before any
 * status mutation and respond with HTTP 422 `fsm.forbidden_transition` on
 * failure. RLS is the second line of defence — never the first.
 *
 * The module is intentionally pure (no I/O, no Prisma) so that it can be
 * exhaustively unit-tested.
 */

export const REQUISITION_STATUSES = [
  'draft',
  'submitted',
  'manager_approved',
  'hr_approved',
  'approved',
  'in_recruitment',
  'closed',
  'rejected',
] as const

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number]

export const ROLES = [
  'owner',
  'hr_admin',
  'recruiter',
  'hiring_manager',
  'employee',
  'candidate',
] as const

export type Role = (typeof ROLES)[number]

type Transition = {
  from: RequisitionStatus
  to: RequisitionStatus
  allowedRoles: ReadonlyArray<Role>
}

/**
 * Single source of truth for legal requisition transitions. Adding or removing
 * a row here MUST also update `docs/contracts/20-fsm.md` and the FSM unit
 * tests.
 */
export const REQUISITION_TRANSITIONS: ReadonlyArray<Transition> = [
  { from: 'draft', to: 'submitted', allowedRoles: ['recruiter', 'hiring_manager', 'hr_admin', 'owner'] },
  { from: 'submitted', to: 'manager_approved', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
  { from: 'submitted', to: 'rejected', allowedRoles: ['hiring_manager', 'hr_admin', 'owner'] },
  { from: 'manager_approved', to: 'hr_approved', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'manager_approved', to: 'rejected', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'hr_approved', to: 'approved', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'approved', to: 'in_recruitment', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
  { from: 'in_recruitment', to: 'closed', allowedRoles: ['recruiter', 'hr_admin', 'owner'] },
]

const TERMINAL_STATUSES = new Set<RequisitionStatus>(['closed', 'rejected'])

export function isTerminalStatus(status: RequisitionStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function canTransition(
  from: RequisitionStatus,
  to: RequisitionStatus,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = REQUISITION_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function allowedNextStatuses(
  from: RequisitionStatus,
  actorRoles: ReadonlyArray<Role>,
): RequisitionStatus[] {
  return REQUISITION_TRANSITIONS
    .filter((t) => t.from === from && actorRoles.some((role) => t.allowedRoles.includes(role)))
    .map((t) => t.to)
}
