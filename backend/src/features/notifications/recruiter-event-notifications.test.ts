import { describe, expect, test } from 'bun:test'

import { notifyRecipientsForEvent } from './recruiter-event-notifications'

const env = {
  MOBILE_PUSH_ENABLED: false,
} as const

describe('recruiter event notifications', () => {
  test('creates one in-app notification and deduplicates repeat event calls', async () => {
    const state = createState({ assignedToUserId: 'user-assigned' })

    await notifyRecipientsForEvent({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      template: 'application.new',
      eventKey: 'hh.sync.candidate_imported:neg-1',
      payload: { source: 'hh_sync' },
    })
    await notifyRecipientsForEvent({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      template: 'application.new',
      eventKey: 'hh.sync.candidate_imported:neg-1',
      payload: { source: 'hh_sync' },
    })

    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      recipientUserId: 'user-assigned',
      template: 'application.new',
      payload: expect.objectContaining({
        applicationId: 'app-1',
        eventKey: 'hh.sync.candidate_imported:neg-1',
      }),
    })
  })

  test('falls back to hr_admin recipients when assignee is missing', async () => {
    const state = createState({
      assignedToUserId: null,
      userRoles: [
        { userId: 'admin-1', role: 'hr_admin' },
        { userId: 'admin-2', role: 'hr_admin' },
        { userId: 'recruiter-1', role: 'recruiter' },
      ],
    })

    await notifyRecipientsForEvent({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      template: 'application.auto_rejected',
      eventKey: 'application.auto_rejected:app-1',
    })

    expect(state.notifications.map((item) => item.recipientUserId).sort()).toEqual(['admin-1', 'admin-2'])
  })

  test('swallows notification-layer errors and writes audit', async () => {
    const state = createState({ assignedToUserId: 'user-assigned', failFindMany: true })

    await expect(
      notifyRecipientsForEvent({
        prisma: state.prisma as never,
        env: env as never,
        tenantId: 'tenant-1',
        applicationId: 'app-1',
        template: 'assessment.completed',
        eventKey: 'assessment_session.completed:sess-1',
      }),
    ).resolves.toBeUndefined()

    expect(state.auditEvents).toHaveLength(1)
    expect(state.auditEvents[0]).toMatchObject({
      action: 'notification.dispatch_failed',
      entityType: 'Application',
      entityId: 'app-1',
    })
  })
})

function createState(input: {
  assignedToUserId: string | null
  userRoles?: Array<{ userId: string; role: string }>
  failFindMany?: boolean
}) {
  const notifications: Array<Record<string, unknown>> = []
  const auditEvents: Array<Record<string, unknown>> = []
  const userRoles = input.userRoles ?? []

  const prisma = {
    application: {
      findFirst: async () => ({
        id: 'app-1',
        assignedToUserId: input.assignedToUserId,
      }),
    },
    userRole: {
      findMany: async ({ where }: { where: { role: { in: string[] } } }) =>
        userRoles
          .filter((row) => where.role.in.includes(row.role))
          .map((row) => ({ userId: row.userId })),
    },
    notification: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if (input.failFindMany) throw new Error('db down')
        return notifications
          .filter((row) => {
            if (row.tenantId !== where.tenantId) return false
            if (row.recipientUserId !== where.recipientUserId) return false
            if (row.channel !== where.channel) return false
            if (row.template !== where.template) return false
            if (where.readAt === null && row.readAt !== null) return false
            const createdAtGte = (where.createdAt as { gte?: Date } | undefined)?.gte
            if (createdAtGte && row.createdAt instanceof Date && row.createdAt < createdAtGte) return false
            return true
          })
          .map((row) => ({ payload: row.payload }))
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `n-${notifications.length + 1}`,
          ...data,
          readAt: null,
          createdAt: new Date(),
        }
        notifications.push(row)
        return row
      },
    },
    deviceToken: {
      findMany: async () => [],
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data)
        return data
      },
    },
  }

  return { prisma, notifications, auditEvents }
}
