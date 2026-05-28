import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../../db'
import {
  autoAssignLearningPaths,
  send1on1Reminders,
  sendOkrQuarterStartReminders,
  sendReviewReminders,
} from './learning.service'

type MockNotifier = { notify: (input: unknown) => Promise<void>; sent: unknown[] }

function mockNotifier(): MockNotifier {
  const sent: unknown[] = []
  return {
    sent,
    notify: async (input) => {
      sent.push(input)
    },
  }
}

describe('autoAssignLearningPaths', () => {
  test('assigns auto-assign paths matching the employee role family (and roleFamily=null)', async () => {
    const inserts: unknown[] = []
    const prisma = {
      learningPath: {
        findMany: async ({ where }: { where: { tenantId: string; OR: Array<{ roleFamily?: string | null }> } }) => {
          expect(where.tenantId).toBe('t1')
          // Caller asked for null OR 'engineering'
          expect(where.OR).toEqual([{ roleFamily: null }, { roleFamily: 'engineering' }])
          return [{ id: 'path-a' }, { id: 'path-b' }]
        },
      },
      learningAssignment: {
        createMany: async (args: unknown) => {
          inserts.push(args)
          return { count: 2 }
        },
      },
    } as unknown as DbClient

    const result = await autoAssignLearningPaths({
      prisma,
      tenantId: 't1',
      employeeId: 'emp-1',
      roleFamily: 'engineering',
      actorUserId: 'actor',
    })
    expect(result.assigned).toBe(2)
    expect(inserts.length).toBe(1)
  })

  test('returns 0 when there are no auto-assign paths', async () => {
    const prisma = {
      learningPath: { findMany: async () => [] },
      learningAssignment: { createMany: async () => ({ count: 0 }) },
    } as unknown as DbClient
    const result = await autoAssignLearningPaths({
      prisma,
      tenantId: 't1',
      employeeId: 'emp-1',
      roleFamily: null,
      actorUserId: 'actor',
    })
    expect(result.assigned).toBe(0)
  })
})

describe('send1on1Reminders', () => {
  test('notifies manager and employee 24h before scheduled meeting and marks reminder_sent_at', async () => {
    const now = new Date('2026-06-01T10:00:00.000Z')
    const scheduledAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const updates: unknown[] = []
    const prisma = {
      oneOnOne: {
        findMany: async ({ where }: { where: { scheduledAt: { gte: Date; lte: Date } } }) => {
          expect(where.scheduledAt.gte.getTime()).toBeLessThan(scheduledAt.getTime())
          expect(where.scheduledAt.lte.getTime()).toBeGreaterThan(scheduledAt.getTime())
          return [
            {
              id: 'm1',
              tenantId: 't1',
              employeeId: 'emp-1',
              managerUserId: 'mgr-1',
              scheduledAt,
              employee: { id: 'emp-1', userId: 'user-1', tenantId: 't1', fullName: 'Ivan' },
            },
          ]
        },
        update: async (args: unknown) => {
          updates.push(args)
          return {}
        },
      },
    } as unknown as DbClient
    const notifier = mockNotifier()
    const result = await send1on1Reminders({ prisma, notifier, now })
    expect(result.matched).toBe(1)
    expect(result.sent).toBe(2)
    expect(updates.length).toBe(1)
  })
})

describe('sendReviewReminders', () => {
  test('notifies each pending reviewer once and stamps reminder_sent_at', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const closesAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
    const updates: string[] = []
    const prisma = {
      reviewCycle: {
        findMany: async () => [{ id: 'c1', tenantId: 't1', title: 'Q2', closesAt }],
      },
      reviewRequest: {
        findMany: async () => [
          { id: 'r1', tenantId: 't1', cycleId: 'c1', reviewerUserId: 'u1' },
          { id: 'r2', tenantId: 't1', cycleId: 'c1', reviewerUserId: 'u2' },
        ],
        update: async ({ where }: { where: { id: string } }) => {
          updates.push(where.id)
          return {}
        },
      },
    } as unknown as DbClient
    const notifier = mockNotifier()
    const result = await sendReviewReminders({ prisma, notifier, now })
    expect(result.matched).toBe(2)
    expect(result.sent).toBe(2)
    expect(updates).toEqual(['r1', 'r2'])
  })
})

describe('sendOkrQuarterStartReminders', () => {
  test('only notifies employees without an OKR in the current quarter', async () => {
    const now = new Date('2026-04-15T00:00:00.000Z') // Q2
    const prisma = {
      employee: {
        findMany: async () => [
          { id: 'e1', userId: 'u1', tenantId: 't1', fullName: 'A' },
          { id: 'e2', userId: 'u2', tenantId: 't1', fullName: 'B' },
        ],
      },
      okr: {
        findFirst: async ({ where }: { where: { employeeId: string; quarter: string } }) => {
          expect(where.quarter).toBe('2026-Q2')
          return where.employeeId === 'e1' ? { id: 'okr-existing' } : null
        },
      },
    } as unknown as DbClient
    const notifier = mockNotifier()
    const result = await sendOkrQuarterStartReminders({ prisma, notifier, now })
    expect(result.matched).toBe(2)
    expect(result.sent).toBe(1)
  })
})
