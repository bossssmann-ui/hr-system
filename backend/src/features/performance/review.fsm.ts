import type { Role } from '../requisitions/requisitions.fsm'

export const REVIEW_CYCLE_STATUSES = ['draft', 'open', 'closed'] as const
export type ReviewCycleStatus = (typeof REVIEW_CYCLE_STATUSES)[number]

export const REVIEW_REQUEST_STATUSES = ['pending', 'submitted', 'declined'] as const
export type ReviewRequestStatus = (typeof REVIEW_REQUEST_STATUSES)[number]

type ReviewCycleTransition = {
  from: ReviewCycleStatus
  to: ReviewCycleStatus
  allowedRoles: ReadonlyArray<Role>
}

type ReviewRequestTransition = {
  from: ReviewRequestStatus
  to: ReviewRequestStatus
}

export const REVIEW_CYCLE_TRANSITIONS: ReadonlyArray<ReviewCycleTransition> = [
  { from: 'draft', to: 'open', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'open', to: 'closed', allowedRoles: ['hr_admin', 'owner'] },
]

export const REVIEW_REQUEST_TRANSITIONS: ReadonlyArray<ReviewRequestTransition> = [
  { from: 'pending', to: 'submitted' },
  { from: 'pending', to: 'declined' },
]

const TERMINAL_REVIEW_CYCLE_STATUSES = new Set<ReviewCycleStatus>(['closed'])
const TERMINAL_REVIEW_REQUEST_STATUSES = new Set<ReviewRequestStatus>(['submitted', 'declined'])

export function isTerminalReviewCycleStatus(status: ReviewCycleStatus): boolean {
  return TERMINAL_REVIEW_CYCLE_STATUSES.has(status)
}

export function isTerminalReviewRequestStatus(status: ReviewRequestStatus): boolean {
  return TERMINAL_REVIEW_REQUEST_STATUSES.has(status)
}

export function canReviewCycleTransition(
  from: ReviewCycleStatus,
  to: ReviewCycleStatus,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = REVIEW_CYCLE_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function canReviewRequestTransition(from: ReviewRequestStatus, to: ReviewRequestStatus): boolean {
  if (from === to) return false
  return REVIEW_REQUEST_TRANSITIONS.some((t) => t.from === from && t.to === to)
}
