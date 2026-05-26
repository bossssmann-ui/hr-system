import { describe, expect, test } from 'bun:test'

import { computeChecklistAggregate, createChecklist, isChecklistComplete } from './onboarding.engine'
import { getOnboardingTemplate } from './onboarding.templates'

describe('onboarding templates', () => {
  test('seeds logist template with expected day-1 and training tasks', () => {
    const template = getOnboardingTemplate('logist')
    expect(template).not.toBeNull()
    expect(template?.templateVersion).toBe(1)

    const keys = template?.tasks.map((task) => task.key) ?? []
    expect(keys).toEqual([
      'provision_ati',
      'provision_corp_email',
      'provision_corp_phone',
      'provision_yougile',
      'provision_smart_logistics',
      'agree_employment_type',
      'training_regulations',
      'training_sales_scripts',
      'training_smart_logistics',
      'training_yougile_regulations',
    ])

    const automatedKeys = template?.tasks.filter((task) => task.isAutomated).map((task) => task.key) ?? []
    expect(automatedKeys).toEqual([
      'provision_ati',
      'provision_corp_email',
      'provision_corp_phone',
      'provision_yougile',
      'provision_smart_logistics',
    ])
  })

  test('employment-form task keeps all variants open and has no default', () => {
    const employmentTask = getOnboardingTemplate('logist')?.tasks.find((task) => task.key === 'agree_employment_type')
    expect(employmentTask?.metadata).toEqual({
      default: null,
      options: ['td', 'gph', 'self_employed', 'ip'],
    })
  })
})

describe('onboarding checklist engine', () => {
  test('creates checklist and task drafts from template_key', () => {
    const startedAt = new Date('2026-05-26T00:00:00.000Z')
    const result = createChecklist({
      employeeId: 'emp-1',
      templateKey: 'logist',
      startedAt,
    })

    expect(result.checklist).toEqual({
      employeeId: 'emp-1',
      templateKey: 'logist',
      templateVersion: 1,
      title: 'Онбординг логиста',
      startedAt,
      completedAt: null,
    })
    expect(result.tasks).toHaveLength(10)
    expect(result.tasks.every((task) => task.status === 'pending')).toBe(true)
  })

  test('aggregate marks checklist complete only when every task is completed or skipped and none blocked', () => {
    const now = new Date('2026-05-30T00:00:00.000Z')
    const complete = computeChecklistAggregate([{ status: 'completed' }, { status: 'skipped' }], now)
    expect(complete.isComplete).toBe(true)
    expect(complete.completedAt).toEqual(now)

    const withPending = computeChecklistAggregate([{ status: 'completed' }, { status: 'pending' }], now)
    expect(withPending.isComplete).toBe(false)
    expect(withPending.completedAt).toBeNull()

    const withBlocked = computeChecklistAggregate([{ status: 'completed' }, { status: 'blocked' }], now)
    expect(withBlocked.isComplete).toBe(false)
    expect(withBlocked.completedAt).toBeNull()
  })

  test('isChecklistComplete is a convenience wrapper over aggregate logic', () => {
    expect(isChecklistComplete([{ status: 'completed' }, { status: 'skipped' }])).toBe(true)
    expect(isChecklistComplete([{ status: 'completed' }, { status: 'in_progress' }])).toBe(false)
  })
})
