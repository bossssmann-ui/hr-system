import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  REVIEW_CYCLE_STATUSES,
  REVIEW_CYCLE_TRANSITIONS,
  REVIEW_REQUEST_STATUSES,
  REVIEW_REQUEST_TRANSITIONS,
  canReviewCycleTransition,
  canReviewRequestTransition,
  isTerminalReviewCycleStatus,
  isTerminalReviewRequestStatus,
  type ReviewCycleStatus,
  type ReviewRequestStatus,
} from './review.fsm'

describe('review FSM', () => {
  test('cycle transitions: allow-list is respected', () => {
    for (const transition of REVIEW_CYCLE_TRANSITIONS) {
      for (const role of transition.allowedRoles) {
        expect(canReviewCycleTransition(transition.from, transition.to, [role])).toBe(true)
      }

      const denied = ROLES.filter((r) => !transition.allowedRoles.includes(r))
      for (const role of denied) {
        expect(canReviewCycleTransition(transition.from, transition.to, [role])).toBe(false)
      }
    }
  })

  test('cycle transitions: undeclared transitions are rejected', () => {
    const declared = new Set(REVIEW_CYCLE_TRANSITIONS.map((t) => `${t.from}->${t.to}`))

    for (const from of REVIEW_CYCLE_STATUSES) {
      for (const to of REVIEW_CYCLE_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue

        for (const role of ROLES) {
          expect(canReviewCycleTransition(from, to, [role])).toBe(false)
        }
      }
    }
  })

  test('cycle terminal states are enforced', () => {
    const terminal: ReviewCycleStatus[] = ['closed']

    for (const state of terminal) {
      expect(isTerminalReviewCycleStatus(state)).toBe(true)
      for (const to of REVIEW_CYCLE_STATUSES) {
        for (const role of ROLES) {
          expect(canReviewCycleTransition(state, to, [role])).toBe(false)
        }
      }
    }

    expect(isTerminalReviewCycleStatus('draft')).toBe(false)
    expect(isTerminalReviewCycleStatus('open')).toBe(false)
  })

  test('only hr_admin/owner can open and close cycles', () => {
    for (const role of ['hr_admin', 'owner'] as Role[]) {
      expect(canReviewCycleTransition('draft', 'open', [role])).toBe(true)
      expect(canReviewCycleTransition('open', 'closed', [role])).toBe(true)
    }

    for (const role of ['hiring_manager', 'employee', 'recruiter', 'candidate'] as Role[]) {
      expect(canReviewCycleTransition('draft', 'open', [role])).toBe(false)
      expect(canReviewCycleTransition('open', 'closed', [role])).toBe(false)
    }
  })

  test('request transitions are limited to pending->submitted/declined', () => {
    for (const transition of REVIEW_REQUEST_TRANSITIONS) {
      expect(canReviewRequestTransition(transition.from, transition.to)).toBe(true)
    }

    const declared = new Set(REVIEW_REQUEST_TRANSITIONS.map((t) => `${t.from}->${t.to}`))
    for (const from of REVIEW_REQUEST_STATUSES) {
      for (const to of REVIEW_REQUEST_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        expect(canReviewRequestTransition(from, to)).toBe(false)
      }
    }
  })

  test('request terminal states are enforced', () => {
    const terminal: ReviewRequestStatus[] = ['submitted', 'declined']

    for (const state of terminal) {
      expect(isTerminalReviewRequestStatus(state)).toBe(true)
      for (const to of REVIEW_REQUEST_STATUSES) {
        expect(canReviewRequestTransition(state, to)).toBe(false)
      }
    }

    expect(isTerminalReviewRequestStatus('pending')).toBe(false)
  })
})
