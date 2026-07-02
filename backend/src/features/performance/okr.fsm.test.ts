import { describe, expect, test } from 'bun:test'

import { ROLES, type Role } from '../requisitions/requisitions.fsm'
import {
  KEY_RESULT_ACHIEVED_RATIO,
  KEY_RESULT_ON_TRACK_RATIO,
  OKR_STATUSES,
  OKR_TRANSITIONS,
  canOkrTransition,
  computeKeyResultRatio,
  computeOkrProgressPercent,
  isTerminalOkrStatus,
  keyResultStatusFromRatio,
  type OkrStatus,
} from './okr.fsm'

describe('okr FSM + key-result progress', () => {
  test('allow-list transitions are respected', () => {
    for (const transition of OKR_TRANSITIONS) {
      for (const role of transition.allowedRoles) {
        expect(canOkrTransition(transition.from, transition.to, [role])).toBe(true)
      }
      const denied = ROLES.filter((r) => !transition.allowedRoles.includes(r))
      for (const role of denied) {
        expect(canOkrTransition(transition.from, transition.to, [role])).toBe(false)
      }
    }
  })

  test('undeclared transitions are rejected and terminal statuses are blocked', () => {
    const declared = new Set(OKR_TRANSITIONS.map((transition) => `${transition.from}->${transition.to}`))
    for (const from of OKR_STATUSES) {
      for (const to of OKR_STATUSES) {
        if (from === to) continue
        if (declared.has(`${from}->${to}`)) continue
        for (const role of ROLES) {
          expect(canOkrTransition(from, to, [role])).toBe(false)
        }
      }
    }

    const terminal: OkrStatus[] = ['achieved', 'missed']
    for (const status of terminal) {
      expect(isTerminalOkrStatus(status)).toBe(true)
      for (const to of OKR_STATUSES) {
        for (const role of ROLES) {
          expect(canOkrTransition(status, to, [role])).toBe(false)
        }
      }
    }
    expect(isTerminalOkrStatus('draft')).toBe(false)
    expect(isTerminalOkrStatus('active')).toBe(false)
  })

  test('key-result ratio and status derive correctly with clamping and zero-denominator guard', () => {
    expect(
      computeKeyResultRatio({
        startValue: 0,
        targetValue: 10,
        currentValue: 12,
      }),
    ).toBe(1)

    expect(
      computeKeyResultRatio({
        startValue: 0,
        targetValue: 10,
        currentValue: -5,
      }),
    ).toBe(0)

    expect(
      computeKeyResultRatio({
        startValue: 10,
        targetValue: 10,
        currentValue: 9,
      }),
    ).toBe(0)
    expect(
      computeKeyResultRatio({
        startValue: 10,
        targetValue: 10,
        currentValue: 11,
      }),
    ).toBe(1)

    expect(keyResultStatusFromRatio(KEY_RESULT_ACHIEVED_RATIO)).toBe('achieved')
    expect(keyResultStatusFromRatio(KEY_RESULT_ON_TRACK_RATIO)).toBe('on_track')
    expect(keyResultStatusFromRatio(0.01)).toBe('at_risk')
    expect(keyResultStatusFromRatio(0)).toBe('open')
  })

  test('okr progress roll-up is an average of KR ratios * 100 with rounding', () => {
    expect(
      computeOkrProgressPercent([
        { startValue: 0, targetValue: 10, currentValue: 7 },
        { startValue: 0, targetValue: 10, currentValue: 10 },
      ]),
    ).toBe(85)

    expect(computeOkrProgressPercent([])).toBe(0)
  })
})
