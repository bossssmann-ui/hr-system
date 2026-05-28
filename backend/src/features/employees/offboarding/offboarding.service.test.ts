import { describe, expect, test } from 'bun:test'

import {
  completeOffboarding,
  markOffboardingTaskDone,
  startOffboarding,
} from './offboarding.service'

function createOffboardingPrismaMock() {
  const state = {
    employee: {
      id: 'emp-1',
      tenantId: 'tenant-1',
      status: 'active',
      fullName: 'Ivan Employee',
      userId: 'user-1',
      candidateId: 'cand-1',
      preStartPortalEntry: { id: 'portal-1', status: 'active' },
      exitInterview: { wouldRehire: true, notes: 'Good alumni candidate' },
      offboardingChecklists: [] as Array<Record<string, unknown>>,
    } as Record<string, unknown>,
    checklists: [] as Array<Record<string, unknown>>,
    tasks: [] as Array<Record<string, unknown>>,
    lifecycleEvents: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    disabledUsers: [] as string[],
    deletedSessionsFor: [] as string[],
    portalUpdates: [] as Array<Record<string, unknown>>,
    alumniProfiles: [] as Array<Record<string, unknown>>,
  }

  const prisma: Record<string, unknown> = {
    employee: {
      findFirst: async () => state.employee,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.employee = { ...state.employee, ...data }
        return state.employee
      },
    },
    offboardingChecklist: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const checklist = { id: 'checklist-1', completedAt: null, ...data }
        state.checklists.push(checklist)
        return checklist
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.checklists[0] = { ...state.checklists[0], ...data }
        return state.checklists[0]
      },
    },
    offboardingTask: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const task = { id: `task-${state.tasks.length + 1}`, ...data }
        state.tasks.push(task)
        return task
      },
      findFirst: async ({ where }: { where: { id: string } }) => {
        const task = state.tasks.find((item) => item.id === where.id)
        if (!task) return null
        return { ...task, checklist: { id: 'checklist-1', completedAt: null, tasks: state.tasks } }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = state.tasks.findIndex((item) => item.id === where.id)
        state.tasks[index] = { ...state.tasks[index], ...data }
        return state.tasks[index]
      },
    },
    employeeLifecycleEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.lifecycleEvents.push(data)
        return data
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
        return data
      },
    },
    userRole: {
      findMany: async () => [{ userId: 'hr-user' }],
    },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.notifications.push(data)
        return data
      },
    },
    user: {
      update: async ({ where }: { where: { id: string } }) => {
        state.disabledUsers.push(where.id)
        return { id: where.id }
      },
    },
    authSession: {
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        state.deletedSessionsFor.push(where.userId)
        return { count: 1 }
      },
    },
    preStartPortalEntry: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.portalUpdates.push(data)
        return data
      },
    },
    alumniProfile: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const profile = { id: 'alumni-1', ...create }
        state.alumniProfiles.push(profile)
        return profile
      },
    },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
  }

  return { prisma, state }
}

describe('offboarding service', () => {
  test('startOffboarding moves active employee to notice and creates default checklist', async () => {
    const { prisma, state } = createOffboardingPrismaMock()

    const result = await startOffboarding({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      actorRoles: ['hr_admin'],
      actorUserId: 'actor-1',
    })

    expect(state.employee.status).toBe('notice')
    expect(result.tasks).toHaveLength(5)
    expect(state.lifecycleEvents[0]?.type).toBe('notice_started')
    expect(state.auditEvents[0]?.action).toBe('employee.begin_notice')
    expect(state.notifications[0]?.template).toBe('offboarding.task_assigned')
  })

  test('markOffboardingTaskDone persists completed status and closes checklist when all tasks are complete', async () => {
    const { prisma, state } = createOffboardingPrismaMock()
    state.tasks.push(
      { id: 'task-1', tenantId: 'tenant-1', checklistId: 'checklist-1', status: 'pending' },
      { id: 'task-2', tenantId: 'tenant-1', checklistId: 'checklist-1', status: 'completed' },
    )
    state.checklists.push({ id: 'checklist-1', completedAt: null })

    const updated = await markOffboardingTaskDone({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      taskId: 'task-1',
      actorUserId: 'actor-1',
      status: 'done',
    })

    expect(updated?.status).toBe('completed')
    expect(state.checklists[0]?.completedAt).toBeInstanceOf(Date)
    expect(state.auditEvents[0]?.action).toBe('offboarding.task.completed')
  })

  test('completeOffboarding requires completed checklist before termination', async () => {
    const { prisma, state } = createOffboardingPrismaMock()
    state.employee = {
      ...state.employee,
      status: 'notice',
      offboardingChecklists: [{ id: 'checklist-1', completedAt: null, tasks: [] }],
    }

    await expect(
      completeOffboarding({
        prisma: prisma as never,
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        actorRoles: ['hr_admin'],
      }),
    ).rejects.toThrow('offboarding checklist must be completed')
  })

  test('completeOffboarding terminates employee, deactivates user, and creates alumni profile', async () => {
    const { prisma, state } = createOffboardingPrismaMock()
    state.employee = {
      ...state.employee,
      status: 'notice',
      offboardingChecklists: [{ id: 'checklist-1', completedAt: new Date('2026-05-30T00:00:00.000Z'), tasks: [] }],
    }

    const result = await completeOffboarding({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      actorRoles: ['hr_admin'],
      actorUserId: 'actor-1',
    })

    expect(result.employee.status).toBe('terminated')
    expect(state.disabledUsers).toEqual(['user-1'])
    expect(state.deletedSessionsFor).toEqual(['user-1'])
    expect(state.portalUpdates[0]?.status).toBe('closed')
    expect(result.alumniProfile.id).toBe('alumni-1')
    expect(state.auditEvents.map((event) => event.action)).toContain('alumni.created')
    expect(state.notifications[0]?.template).toBe('employee.terminated')
  })
})
