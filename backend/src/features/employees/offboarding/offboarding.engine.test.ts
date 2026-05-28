import { describe, expect, test } from 'bun:test'

import {
  computeOffboardingChecklistAggregate,
  createOffboardingChecklist,
  isOffboardingChecklistComplete,
} from './offboarding.engine'
import { getOffboardingTemplate } from './offboarding.templates'

describe('offboarding templates', () => {
  test('seeds default offboarding template with required handoff tasks', () => {
    const template = getOffboardingTemplate('default')
    expect(template).not.toBeNull()
    expect(template?.templateVersion).toBe(1)
    expect(template?.tasks.map((task) => task.key)).toEqual([
      'return_equipment',
      'project_handoff',
      'close_projects',
      'exit_interview',
      'revoke_accesses',
    ])
  })
})

describe('offboarding checklist engine', () => {
  test('creates checklist and task drafts from template_key', () => {
    const createdAt = new Date('2026-05-28T00:00:00.000Z')
    const result = createOffboardingChecklist({ employeeId: 'emp-1', templateKey: 'default', createdAt })

    expect(result.checklist).toEqual({
      employeeId: 'emp-1',
      templateKey: 'default',
      templateVersion: 1,
      title: 'Offboarding',
      createdAt,
      completedAt: null,
    })
    expect(result.tasks).toHaveLength(5)
    expect(result.tasks.every((task) => task.status === 'pending')).toBe(true)
  })

  test('aggregate marks checklist complete only when every task is done/completed/skipped and none blocked', () => {
    const now = new Date('2026-05-30T00:00:00.000Z')
    const complete = computeOffboardingChecklistAggregate([{ status: 'done' }, { status: 'skipped' }], now)
    expect(complete.isComplete).toBe(true)
    expect(complete.completedAt).toEqual(now)

    const withPending = computeOffboardingChecklistAggregate([{ status: 'completed' }, { status: 'pending' }], now)
    expect(withPending.isComplete).toBe(false)
    expect(withPending.completedAt).toBeNull()

    const withBlocked = computeOffboardingChecklistAggregate([{ status: 'completed' }, { status: 'blocked' }], now)
    expect(withBlocked.isComplete).toBe(false)
    expect(withBlocked.completedAt).toBeNull()
  })

  test('isOffboardingChecklistComplete is a convenience wrapper over aggregate logic', () => {
    expect(isOffboardingChecklistComplete([{ status: 'completed' }, { status: 'skipped' }])).toBe(true)
    expect(isOffboardingChecklistComplete([{ status: 'completed' }, { status: 'in_progress' }])).toBe(false)
  })
})
