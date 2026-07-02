import type { Role } from '../requisitions/requisitions.fsm'

// ─── IDP Status FSM ───────────────────────────────────────────────────────────

export const IDP_STATUSES = ['draft', 'active', 'completed'] as const
export type IdpStatus = (typeof IDP_STATUSES)[number]

export const IDP_ITEM_STATUSES = ['planned', 'in_progress', 'completed', 'dropped'] as const
export type IdpItemStatus = (typeof IDP_ITEM_STATUSES)[number]

type IdpTransition = {
  from: IdpStatus
  to: IdpStatus
  allowedRoles: ReadonlyArray<Role>
}

export const IDP_TRANSITIONS: ReadonlyArray<IdpTransition> = [
  {
    from: 'draft',
    to: 'active',
    allowedRoles: ['employee', 'hiring_manager', 'hr_admin', 'owner'],
  },
  {
    from: 'active',
    to: 'completed',
    allowedRoles: ['employee', 'hiring_manager', 'hr_admin', 'owner'],
  },
]

const TERMINAL_IDP_STATUSES = new Set<IdpStatus>(['completed'])

export function isTerminalIdpStatus(status: IdpStatus): boolean {
  return TERMINAL_IDP_STATUSES.has(status)
}

export function canIdpTransition(from: IdpStatus, to: IdpStatus, actorRoles: ReadonlyArray<Role>): boolean {
  if (from === to) return false
  if (isTerminalIdpStatus(from)) return false
  const transition = IDP_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

// ─── IdpItem Status FSM ───────────────────────────────────────────────────────

type IdpItemTransition = {
  from: IdpItemStatus
  to: IdpItemStatus
}

export const IDP_ITEM_TRANSITIONS: ReadonlyArray<IdpItemTransition> = [
  { from: 'planned', to: 'in_progress' },
  { from: 'in_progress', to: 'planned' },
  { from: 'planned', to: 'completed' },
  { from: 'in_progress', to: 'completed' },
  { from: 'planned', to: 'dropped' },
  { from: 'in_progress', to: 'dropped' },
  { from: 'completed', to: 'planned' },
  { from: 'completed', to: 'in_progress' },
  { from: 'dropped', to: 'planned' },
  { from: 'dropped', to: 'in_progress' },
]

export function canIdpItemTransition(from: IdpItemStatus, to: IdpItemStatus): boolean {
  if (from === to) return false
  return IDP_ITEM_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

// ─── Progress computation ─────────────────────────────────────────────────────

export function computeIdpProgress(items: Array<{ status: string }>): number {
  const countable = items.filter((i) => i.status !== 'dropped')
  if (countable.length === 0) return 0
  const completed = countable.filter((i) => i.status === 'completed').length
  return Math.round((completed / countable.length) * 100)
}
