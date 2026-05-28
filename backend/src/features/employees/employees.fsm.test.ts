import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_TRANSITIONS,
  allowedNextStatuses,
  canTransition,
  canTransitionWithInvariants,
  canTransitionWithOffboardingGate,
  isTerminalStatus,
  satisfiesNoticeToTerminatedInvariant,
  satisfiesProbationTransitionInvariant,
  satisfiesOnboardingExitInvariant,
  type EmployeeStatus,
} from './employees.fsm'

describe('employees FSM', () => {
  test('enumerates every (from, to, role) triple against the transition table', () => {
    for (const from of EMPLOYEE_STATUSES) {
      for (const to of EMPLOYEE_STATUSES) {
        for (const role of ROLES) {
          const transition = EMPLOYEE_TRANSITIONS.find((t) => t.from === from && t.to === to)
          const expected = from !== to && (transition?.allowedRoles.includes(role) ?? false)
          expect(canTransition(from, to, [role])).toBe(expected)
        }
      }
    }
  })

  test('owner can perform every declared transition', () => {
    for (const t of EMPLOYEE_TRANSITIONS) {
      expect(t.allowedRoles).toContain('owner')
      expect(canTransition(t.from, t.to, ['owner'])).toBe(true)
    }
  })

  test('terminal statuses cannot be left', () => {
    const terminal: EmployeeStatus[] = ['terminated']
    for (const from of terminal) {
      expect(isTerminalStatus(from)).toBe(true)
      for (const to of EMPLOYEE_STATUSES) {
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('allowedNextStatuses returns only transitions available to actor roles', () => {
    expect(allowedNextStatuses('pre_onboarding', ['hr_admin'])).toEqual(['onboarding', 'terminated'])
    expect(allowedNextStatuses('probation', ['hiring_manager']).sort()).toEqual(
      (['active', 'notice'] as EmployeeStatus[]).sort(),
    )
    expect(allowedNextStatuses('onboarding', ['employee'])).toEqual([])
  })

  test('multi-role actor inherits union of permissions', () => {
    expect(canTransition('probation', 'notice', ['recruiter'])).toBe(false)
    expect(canTransition('probation', 'notice', ['recruiter', 'hiring_manager'])).toBe(true)
  })

  test('empty actor role list cannot transition', () => {
    for (const t of EMPLOYEE_TRANSITIONS) {
      expect(canTransition(t.from, t.to, [] as Role[])).toBe(false)
    }
  })

  test('onboarding exit invariant: onboarding -> probation requires checklist complete and probation date', () => {
    expect(
      satisfiesOnboardingExitInvariant('probation', {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(true)

    expect(
      satisfiesOnboardingExitInvariant('probation', {
        checklistCompletedAt: null,
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(false)

    expect(
      satisfiesOnboardingExitInvariant('probation', {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: null,
      }),
    ).toBe(false)
  })

  test('onboarding exit invariant: onboarding -> active is allowed only when checklist is complete and probation is absent', () => {
    expect(
      satisfiesOnboardingExitInvariant('active', {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: null,
      }),
    ).toBe(true)

    expect(
      satisfiesOnboardingExitInvariant('active', {
        checklistCompletedAt: null,
        probationEndsAt: null,
      }),
    ).toBe(false)

    expect(
      satisfiesOnboardingExitInvariant('active', {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(false)
  })

  test('canTransitionWithInvariants composes FSM role checks with onboarding exit gates', () => {
    expect(
      canTransitionWithInvariants('onboarding', 'probation', ['hr_admin'], {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(true)

    expect(
      canTransitionWithInvariants('onboarding', 'probation', ['hr_admin'], {
        checklistCompletedAt: null,
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(false)

    expect(
      canTransitionWithInvariants('onboarding', 'active', ['hr_admin'], {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: null,
      }),
    ).toBe(true)

    expect(
      canTransitionWithInvariants('onboarding', 'active', ['hr_admin'], {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(false)

    expect(
      canTransitionWithInvariants('onboarding', 'active', ['employee'], {
        checklistCompletedAt: new Date('2026-05-26T00:00:00.000Z'),
        probationEndsAt: null,
      }),
    ).toBe(false)
  })

  test('probation exit invariant requires passed -> active and failed -> notice', () => {
    expect(satisfiesProbationTransitionInvariant('probation', 'active', 'passed')).toBe(true)
    expect(satisfiesProbationTransitionInvariant('probation', 'active', 'failed')).toBe(false)
    expect(satisfiesProbationTransitionInvariant('probation', 'active', 'extended')).toBe(false)

    expect(satisfiesProbationTransitionInvariant('probation', 'notice', 'failed')).toBe(true)
    expect(satisfiesProbationTransitionInvariant('probation', 'notice', 'passed')).toBe(false)
    expect(satisfiesProbationTransitionInvariant('probation', 'notice', null)).toBe(false)

    expect(satisfiesProbationTransitionInvariant('probation', 'probation', 'extended')).toBe(true)
    expect(satisfiesProbationTransitionInvariant('active', 'notice', 'failed')).toBe(true)
  })

  test('notice termination invariant requires completed offboarding checklist', () => {
    expect(
      satisfiesNoticeToTerminatedInvariant({
        offboardingChecklistCompletedAt: new Date('2026-05-30T00:00:00.000Z'),
      }),
    ).toBe(true)
    expect(satisfiesNoticeToTerminatedInvariant({ offboardingChecklistCompletedAt: null })).toBe(false)
  })

  test('canTransitionWithOffboardingGate composes role checks with checklist completion', () => {
    expect(
      canTransitionWithOffboardingGate('notice', 'terminated', ['hr_admin'], {
        offboardingChecklistCompletedAt: new Date('2026-05-30T00:00:00.000Z'),
      }),
    ).toBe(true)
    expect(
      canTransitionWithOffboardingGate('notice', 'terminated', ['hr_admin'], {
        offboardingChecklistCompletedAt: null,
      }),
    ).toBe(false)
    expect(canTransitionWithOffboardingGate('notice', 'terminated', ['employee'])).toBe(false)
    expect(canTransitionWithOffboardingGate('active', 'notice', ['hr_admin'])).toBe(true)
  })
})
