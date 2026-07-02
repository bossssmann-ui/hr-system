import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  ONE_ON_ONE_STATUSES,
  ONE_ON_ONE_TRANSITIONS,
  canTransition,
  isTerminalStatus,
  type OneOnOneStatus,
} from './one-on-one.fsm'

describe('one-on-one FSM', () => {
  test('every declared transition is allowed for at least one of its roles', () => {
    for (const t of ONE_ON_ONE_TRANSITIONS) {
      for (const role of t.allowedRoles) {
        expect(canTransition(t.from, t.to, [role])).toBe(true)
      }
    }
  })

  test('every declared transition is forbidden for roles outside the allow-list', () => {
    for (const t of ONE_ON_ONE_TRANSITIONS) {
      const forbidden = ROLES.filter((r) => !t.allowedRoles.includes(r))
      for (const role of forbidden) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('transitions not in the table are rejected for every role', () => {
    const declared = new Set(ONE_ON_ONE_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of ONE_ON_ONE_STATUSES) {
      for (const to of ONE_ON_ONE_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('completed and cancelled are terminal — no outbound transitions', () => {
    const terminal: OneOnOneStatus[] = ['completed', 'cancelled']
    for (const from of terminal) {
      expect(isTerminalStatus(from)).toBe(true)
      for (const to of ONE_ON_ONE_STATUSES) {
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('scheduled is not terminal', () => {
    expect(isTerminalStatus('scheduled')).toBe(false)
  })

  test('hiring_manager can complete or cancel a scheduled meeting', () => {
    expect(canTransition('scheduled', 'completed', ['hiring_manager'])).toBe(true)
    expect(canTransition('scheduled', 'cancelled', ['hiring_manager'])).toBe(true)
  })

  test('hr_admin and owner can complete or cancel a scheduled meeting', () => {
    for (const role of ['hr_admin', 'owner'] as Role[]) {
      expect(canTransition('scheduled', 'completed', [role])).toBe(true)
      expect(canTransition('scheduled', 'cancelled', [role])).toBe(true)
    }
  })

  test('employee, recruiter, and candidate cannot drive any transition', () => {
    for (const role of ['employee', 'recruiter', 'candidate'] as Role[]) {
      for (const t of ONE_ON_ONE_TRANSITIONS) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('same-status transition is always rejected', () => {
    for (const status of ONE_ON_ONE_STATUSES) {
      for (const role of ROLES) {
        expect(canTransition(status, status, [role])).toBe(false)
      }
    }
  })
})
