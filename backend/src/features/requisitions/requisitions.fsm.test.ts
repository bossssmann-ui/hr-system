import { describe, expect, test } from 'bun:test'

import {
  REQUISITION_STATUSES,
  REQUISITION_TRANSITIONS,
  ROLES,
  allowedNextStatuses,
  canTransition,
  isTerminalStatus,
  type RequisitionStatus,
  type Role,
} from './requisitions.fsm'

describe('requisitions FSM', () => {
  test('every declared transition is allowed for at least one of its roles', () => {
    for (const t of REQUISITION_TRANSITIONS) {
      for (const role of t.allowedRoles) {
        expect(canTransition(t.from, t.to, [role])).toBe(true)
      }
    }
  })

  test('every declared transition is forbidden for roles outside the allow-list', () => {
    for (const t of REQUISITION_TRANSITIONS) {
      const forbidden = ROLES.filter((r) => !t.allowedRoles.includes(r))
      for (const role of forbidden) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('transitions not in the table are rejected for every role', () => {
    const declared = new Set(REQUISITION_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of REQUISITION_STATUSES) {
      for (const to of REQUISITION_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('same-state transitions are rejected', () => {
    for (const s of REQUISITION_STATUSES) {
      expect(canTransition(s, s, ['owner'])).toBe(false)
    }
  })

  test('owner can perform every declared transition', () => {
    for (const t of REQUISITION_TRANSITIONS) {
      // The contract: owner is super-user inside the tenant and is listed in
      // every allowed-role array. If a transition deliberately omits owner,
      // this assertion catches the drift (see docs/contracts/20-fsm.md).
      expect(t.allowedRoles).toContain('owner')
      expect(canTransition(t.from, t.to, ['owner'])).toBe(true)
    }
  })

  test('employee and candidate roles cannot perform any transition', () => {
    for (const t of REQUISITION_TRANSITIONS) {
      for (const role of ['employee', 'candidate'] as Role[]) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('terminal statuses cannot be left', () => {
    const terminal: RequisitionStatus[] = ['closed', 'rejected']
    for (const from of terminal) {
      expect(isTerminalStatus(from)).toBe(true)
      for (const to of REQUISITION_STATUSES) {
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('allowedNextStatuses returns only roles the actor can perform', () => {
    expect(allowedNextStatuses('draft', ['recruiter']).sort()).toEqual(['submitted'])
    expect(allowedNextStatuses('submitted', ['hiring_manager']).sort()).toEqual(
      (['manager_approved', 'rejected'] as RequisitionStatus[]).sort(),
    )
    expect(allowedNextStatuses('draft', ['employee'])).toEqual([])
  })

  test('multi-role actor inherits the union of role permissions', () => {
    // recruiter cannot reject a submitted requisition, but hr_admin can.
    expect(canTransition('submitted', 'rejected', ['recruiter'])).toBe(false)
    expect(canTransition('submitted', 'rejected', ['recruiter', 'hr_admin'])).toBe(true)
  })
})
