import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  OFFER_STATUSES,
  OFFER_TRANSITIONS,
  allowedNextStatuses,
  canTransition,
  isTerminalStatus,
  type OfferStatus,
} from './offers.fsm'

describe('offers FSM', () => {
  test('every declared transition is allowed for at least one of its roles', () => {
    for (const t of OFFER_TRANSITIONS) {
      for (const role of t.allowedRoles) {
        expect(canTransition(t.from, t.to, [role])).toBe(true)
      }
    }
  })

  test('every declared transition is forbidden for roles outside the allow-list', () => {
    for (const t of OFFER_TRANSITIONS) {
      const forbidden = ROLES.filter((r) => !t.allowedRoles.includes(r))
      for (const role of forbidden) {
        expect(canTransition(t.from, t.to, [role])).toBe(false)
      }
    }
  })

  test('transitions not in the table are rejected for every role', () => {
    const declared = new Set(OFFER_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of OFFER_STATUSES) {
      for (const to of OFFER_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('accepted / declined / expired are terminal — no outbound transitions', () => {
    const terminal: OfferStatus[] = ['accepted', 'declined', 'expired']
    for (const from of terminal) {
      expect(isTerminalStatus(from)).toBe(true)
      for (const to of OFFER_STATUSES) {
        for (const role of ROLES) {
          expect(canTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('recruiter can submit draft → manager_review and send approved → sent', () => {
    expect(canTransition('draft', 'manager_review', ['recruiter'])).toBe(true)
    expect(canTransition('approved', 'sent', ['recruiter'])).toBe(true)
    expect(canTransition('manager_review', 'approved', ['recruiter'])).toBe(false)
  })

  test('hiring_manager can approve or reject manager_review but cannot submit or send', () => {
    expect(canTransition('manager_review', 'approved', ['hiring_manager'])).toBe(true)
    expect(canTransition('manager_review', 'draft', ['hiring_manager'])).toBe(true)
    expect(canTransition('draft', 'manager_review', ['hiring_manager'])).toBe(false)
    expect(canTransition('approved', 'sent', ['hiring_manager'])).toBe(false)
  })

  test('candidate can accept or decline a sent offer but cannot drive any other transition', () => {
    expect(canTransition('sent', 'accepted', ['candidate'])).toBe(true)
    expect(canTransition('sent', 'declined', ['candidate'])).toBe(true)
    expect(canTransition('draft', 'manager_review', ['candidate'])).toBe(false)
    expect(canTransition('approved', 'sent', ['candidate'])).toBe(false)
    expect(canTransition('sent', 'expired', ['candidate'])).toBe(false)
  })

  test('only hr_admin / owner can expire or recall to draft', () => {
    for (const role of ['hr_admin', 'owner'] as Role[]) {
      expect(canTransition('sent', 'expired', [role])).toBe(true)
      expect(canTransition('approved', 'draft', [role])).toBe(true)
    }
    expect(canTransition('sent', 'expired', ['recruiter'])).toBe(false)
    expect(canTransition('approved', 'draft', ['recruiter'])).toBe(false)
  })

  test('employee cannot move any offer', () => {
    for (const t of OFFER_TRANSITIONS) {
      expect(canTransition(t.from, t.to, ['employee'])).toBe(false)
    }
  })

  test('allowedNextStatuses returns the union of role permissions', () => {
    expect(allowedNextStatuses('draft', ['recruiter'])).toEqual(['manager_review'])
    expect(allowedNextStatuses('sent', ['candidate']).sort()).toEqual(['accepted', 'declined'])
    const admin = allowedNextStatuses('approved', ['hr_admin']).sort()
    expect(admin).toContain('sent')
    expect(admin).toContain('draft')
  })
})
