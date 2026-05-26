/**
 * Finite state machine for `Employee.status`.
 *
 * The state diagram and the per-role transition table live in
 * `docs/employee-lifecycle-design.md` (§3.1, §3.2). This file is the
 * executable encoding of that table. Routes MUST call
 * `canTransition(from, to, actorRoles)` before mutating `Employee.status` and
 * respond with HTTP 422 `fsm.forbidden_transition` on failure.
 *
 * Pure module — no I/O, no Prisma.
 */

import type { Role } from '../requisitions/requisitions.fsm'

export const EMPLOYEE_STATUSES = [
  'pre_onboarding',
  'onboarding',
  'probation',
  'active',
  'notice',
  'terminated',
] as const

export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]
export type ProbationReviewDecision = 'passed' | 'failed' | 'extended'

type Transition = {
  from: EmployeeStatus
  to: EmployeeStatus
  allowedRoles: ReadonlyArray<Role>
}

type OnboardingExitInvariantInput = {
  checklistCompletedAt: Date | null
  probationEndsAt: Date | null
}

/**
 * Single source of truth for legal employee lifecycle transitions.
 */
export const EMPLOYEE_TRANSITIONS: ReadonlyArray<Transition> = [
  { from: 'pre_onboarding', to: 'onboarding', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'pre_onboarding', to: 'terminated', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'onboarding', to: 'probation', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'onboarding', to: 'active', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'probation', to: 'active', allowedRoles: ['hr_admin', 'hiring_manager', 'owner'] },
  { from: 'probation', to: 'notice', allowedRoles: ['hr_admin', 'hiring_manager', 'owner'] },
  { from: 'active', to: 'notice', allowedRoles: ['hr_admin', 'owner'] },
  { from: 'notice', to: 'terminated', allowedRoles: ['hr_admin', 'owner'] },
] as const

const TERMINAL_STATUSES = new Set<EmployeeStatus>(['terminated'])

export function isTerminalStatus(status: EmployeeStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function canTransition(
  from: EmployeeStatus,
  to: EmployeeStatus,
  actorRoles: ReadonlyArray<Role>,
): boolean {
  if (from === to) return false
  const transition = EMPLOYEE_TRANSITIONS.find((t) => t.from === from && t.to === to)
  if (!transition) return false
  return actorRoles.some((role) => transition.allowedRoles.includes(role))
}

export function satisfiesOnboardingExitInvariant(
  to: EmployeeStatus,
  { checklistCompletedAt, probationEndsAt }: OnboardingExitInvariantInput,
): boolean {
  if (to === 'probation') {
    return checklistCompletedAt !== null && probationEndsAt !== null
  }
  if (to === 'active') {
    return checklistCompletedAt !== null && probationEndsAt === null
  }
  return true
}

export function canTransitionWithInvariants(
  from: EmployeeStatus,
  to: EmployeeStatus,
  actorRoles: ReadonlyArray<Role>,
  onboarding?: OnboardingExitInvariantInput,
): boolean {
  if (!canTransition(from, to, actorRoles)) return false
  if (from !== 'onboarding') return true
  if (!onboarding) return false
  return satisfiesOnboardingExitInvariant(to, onboarding)
}

export function satisfiesProbationTransitionInvariant(
  from: EmployeeStatus,
  to: EmployeeStatus,
  probationOutcome: ProbationReviewDecision | null | undefined,
): boolean {
  if (from !== 'probation') return true
  if (to === 'active') return probationOutcome === 'passed'
  if (to === 'notice') return probationOutcome === 'failed'
  return true
}

export function allowedNextStatuses(
  from: EmployeeStatus,
  actorRoles: ReadonlyArray<Role>,
): EmployeeStatus[] {
  return EMPLOYEE_TRANSITIONS
    .filter((t) => t.from === from && actorRoles.some((role) => t.allowedRoles.includes(role)))
    .map((t) => t.to)
}
