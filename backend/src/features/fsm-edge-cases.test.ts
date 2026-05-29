/**
 * FSM edge-case audit — дополнение к существующим тестам.
 *
 * Покрывает кейсы, отсутствующие в employees.fsm.test.ts и offers.fsm.test.ts.
 * Запуск: bun test backend/src/features/fsm-edge-cases.test.ts
 *
 * Положить в: backend/src/features/fsm-edge-cases.test.ts
 */

import { describe, expect, test } from 'bun:test'

import type { Role } from './requisitions/requisitions.fsm'

import {
  canTransition as empCanTransition,
  canTransitionWithInvariants,
  satisfiesProbationTransitionInvariant,
  satisfiesOnboardingExitInvariant,
} from './employees/employees.fsm'

import {
  canTransition as offerCanTransition,
  allowedNextStatuses,
  isTerminalStatus,
  OFFER_STATUSES,
} from './offers/offers.fsm'

// ─────────────────────────────────────────────────────────────────────────────
// employees.fsm — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('employees FSM — edge cases', () => {

  // GAP 1: canTransitionWithInvariants без onboarding-аргумента
  test('canTransitionWithInvariants returns false when onboarding arg is missing', () => {
    // from='onboarding' но данные не переданы → guard должен заблокировать
    expect(
      canTransitionWithInvariants('onboarding', 'probation', ['hr_admin'], undefined),
    ).toBe(false)

    expect(
      canTransitionWithInvariants('onboarding', 'active', ['hr_admin'], undefined),
    ).toBe(false)

    // Но для других from-состояний отсутствие onboarding не важно
    expect(
      canTransitionWithInvariants('pre_onboarding', 'onboarding', ['hr_admin'], undefined),
    ).toBe(true)
  })

  // GAP 2: satisfiesProbationTransitionInvariant с null / undefined для 'active'
  test('probation → active requires outcome=passed; null and undefined both fail', () => {
    expect(satisfiesProbationTransitionInvariant('probation', 'active', null)).toBe(false)
    expect(satisfiesProbationTransitionInvariant('probation', 'active', undefined)).toBe(false)
  })

  // GAP 3: notice → terminated — только hr_admin и owner, не recruiter/hiring_manager
  test('only hr_admin/owner can terminate employee from notice', () => {
    expect(empCanTransition('notice', 'terminated', ['hr_admin'])).toBe(true)
    expect(empCanTransition('notice', 'terminated', ['owner'])).toBe(true)
    expect(empCanTransition('notice', 'terminated', ['hiring_manager'])).toBe(false)
    expect(empCanTransition('notice', 'terminated', ['recruiter'])).toBe(false)
  })

  // GAP 4: hiring_manager явно НЕ может переводить active → notice
  test('hiring_manager cannot terminate active employees (active → notice blocked)', () => {
    expect(empCanTransition('active', 'notice', ['hiring_manager'])).toBe(false)
    // Только hr_admin и owner имеют право
    expect(empCanTransition('active', 'notice', ['hr_admin'])).toBe(true)
    expect(empCanTransition('active', 'notice', ['owner'])).toBe(true)
  })

  // Дополнительно: satisfiesOnboardingExitInvariant для non-probation/active to
  test('satisfiesOnboardingExitInvariant returns true for non-probation/active targets', () => {
    // Переход в terminated со стадии onboarding (edge case — нет в таблице, но invariant должен не блокировать)
    expect(
      satisfiesOnboardingExitInvariant('terminated', {
        checklistCompletedAt: null,
        probationEndsAt: null,
      }),
    ).toBe(true)
  })

  // Дополнительно: pre_onboarding → terminated явно разрешён (сразу уволить до выхода)
  test('pre_onboarding can be immediately terminated by hr_admin', () => {
    expect(empCanTransition('pre_onboarding', 'terminated', ['hr_admin'])).toBe(true)
    expect(empCanTransition('pre_onboarding', 'terminated', ['recruiter'])).toBe(false)
  })

  // Дополнительно: recruiter не может никуда перевести сотрудника
  test('recruiter cannot drive any employee lifecycle transition', () => {
    expect(empCanTransition('pre_onboarding', 'onboarding', ['recruiter'])).toBe(false)
    expect(empCanTransition('onboarding', 'probation', ['recruiter'])).toBe(false)
    expect(empCanTransition('active', 'notice', ['recruiter'])).toBe(false)
    expect(empCanTransition('notice', 'terminated', ['recruiter'])).toBe(false)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// offers.fsm — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('offers FSM — edge cases', () => {

  // GAP 1: пустой массив ролей блокирует всё
  test('empty role list cannot drive any offer transition', () => {
    expect(offerCanTransition('draft', 'manager_review', [] as Role[])).toBe(false)
    expect(offerCanTransition('approved', 'sent', [] as Role[])).toBe(false)
    expect(offerCanTransition('sent', 'accepted', [] as Role[])).toBe(false)
  })

  // GAP 2: isTerminalStatus для не-терминальных статусов
  test('draft / manager_review / approved / sent are NOT terminal', () => {
    const nonTerminal = ['draft', 'manager_review', 'approved', 'sent'] as const
    for (const status of nonTerminal) {
      expect(isTerminalStatus(status)).toBe(false)
    }
  })

  // GAP 3: multi-role комбинация
  test('multi-role actor inherits union of offer permissions', () => {
    // recruiter один не может апрувить, hiring_manager один не может отправить
    expect(offerCanTransition('manager_review', 'approved', ['recruiter'])).toBe(false)
    expect(offerCanTransition('approved', 'sent', ['hiring_manager'])).toBe(false)
    // но вместе — каждый может своё
    expect(offerCanTransition('manager_review', 'approved', ['recruiter', 'hiring_manager'])).toBe(true)
    expect(offerCanTransition('approved', 'sent', ['recruiter', 'hiring_manager'])).toBe(true)
  })

  // Дополнительно: candidate не может экспайрить оффер
  test('candidate cannot expire an offer (only hr_admin/owner can)', () => {
    expect(offerCanTransition('sent', 'expired', ['candidate'])).toBe(false)
    expect(offerCanTransition('sent', 'expired', ['hr_admin'])).toBe(true)
  })

  // Дополнительно: нельзя перейти из одного статуса в тот же
  test('self-transition is always rejected regardless of role', () => {
    for (const status of OFFER_STATUSES) {
      expect(offerCanTransition(status, status, ['owner'])).toBe(false)
    }
  })

  // Дополнительно: allowedNextStatuses для terminal статуса — пустой массив
  test('allowedNextStatuses returns empty array for terminal offer statuses', () => {
    expect(allowedNextStatuses('accepted', ['owner'])).toEqual([])
    expect(allowedNextStatuses('declined', ['owner'])).toEqual([])
    expect(allowedNextStatuses('expired', ['owner'])).toEqual([])
  })

  // Дополнительно: manager_review → draft (отклонение hiring_manager)
  test('hiring_manager can send offer back to draft from manager_review', () => {
    expect(offerCanTransition('manager_review', 'draft', ['hiring_manager'])).toBe(true)
    // recruiter не может вернуть назад
    expect(offerCanTransition('manager_review', 'draft', ['recruiter'])).toBe(false)
  })

})
