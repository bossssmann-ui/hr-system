import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  IDP_ITEM_STATUSES,
  IDP_ITEM_TRANSITIONS,
  IDP_STATUSES,
  IDP_TRANSITIONS,
  canIdpItemTransition,
  canIdpTransition,
  computeIdpProgress,
  isTerminalIdpStatus,
  type IdpStatus,
} from './idp.fsm'

describe('IDP FSM', () => {
  test('allow-list transitions are respected (draft→active→completed)', () => {
    for (const transition of IDP_TRANSITIONS) {
      for (const role of transition.allowedRoles) {
        expect(canIdpTransition(transition.from, transition.to, [role])).toBe(true)
      }
      const denied = ROLES.filter((r) => !transition.allowedRoles.includes(r as Role))
      for (const role of denied) {
        expect(canIdpTransition(transition.from, transition.to, [role as Role])).toBe(false)
      }
    }
  })

  test('undeclared transitions are rejected', () => {
    const declared = new Set(IDP_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of IDP_STATUSES) {
      for (const to of IDP_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canIdpTransition(from, to, [role as Role])).toBe(false)
        }
      }
    }
  })

  test('completed is terminal — no transitions out', () => {
    const terminal: IdpStatus[] = ['completed']
    for (const status of terminal) {
      expect(isTerminalIdpStatus(status)).toBe(true)
      for (const to of IDP_STATUSES) {
        for (const role of ROLES) {
          expect(canIdpTransition(status, to, [role as Role])).toBe(false)
        }
      }
    }
    expect(isTerminalIdpStatus('draft')).toBe(false)
    expect(isTerminalIdpStatus('active')).toBe(false)
  })

  test('backward transition draft←active is rejected', () => {
    for (const role of ROLES) {
      expect(canIdpTransition('active', 'draft', [role as Role])).toBe(false)
    }
  })
})

describe('IdpItem FSM', () => {
  test('allowed item transitions are accepted', () => {
    for (const t of IDP_ITEM_TRANSITIONS) {
      expect(canIdpItemTransition(t.from, t.to)).toBe(true)
    }
  })

  test('undeclared item transitions are rejected', () => {
    const declared = new Set(IDP_ITEM_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of IDP_ITEM_STATUSES) {
      for (const to of IDP_ITEM_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        expect(canIdpItemTransition(from, to)).toBe(false)
      }
    }
  })
})

describe('computeIdpProgress', () => {
  test('dropped items are excluded from denominator', () => {
    const items = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'dropped' },
    ]
    // 2 completed / 2 countable (dropped excluded) = 100%
    expect(computeIdpProgress(items)).toBe(100)
  })

  test('empty non-dropped list returns 0', () => {
    expect(computeIdpProgress([])).toBe(0)
    expect(computeIdpProgress([{ status: 'dropped' }])).toBe(0)
  })

  test('partial progress is calculated correctly', () => {
    const items = [
      { status: 'completed' },
      { status: 'in_progress' },
      { status: 'planned' },
      { status: 'dropped' },
    ]
    // 1 completed / 3 countable = 33%
    expect(computeIdpProgress(items)).toBe(33)
  })

  test('all planned returns 0', () => {
    expect(
      computeIdpProgress([
        { status: 'planned' },
        { status: 'planned' },
      ]),
    ).toBe(0)
  })
})
