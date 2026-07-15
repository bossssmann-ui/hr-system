import { describe, expect, test } from 'bun:test'

import {
  notifyRecruitersAboutApplicationCreated,
  notifyRecruitersAboutSelectionReady,
} from './application-notifications'

const env = {
  EMAIL_ENABLED: false,
  MOBILE_PUSH_ENABLED: false,
} as const

describe('application notifications', () => {
  test('notifies assigned recruiter for new application', async () => {
    const state = makeState({ assignedToUserId: 'user-assigned' })
    await notifyRecruitersAboutApplicationCreated({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
    })
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      recipientUserId: 'user-assigned',
      template: 'application.created',
    })
  })

  test('falls back to recruiter roles when assignee is empty', async () => {
    const state = makeState({ assignedToUserId: null })
    await notifyRecruitersAboutApplicationCreated({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
    })
    expect(state.notifications.map((n) => n.recipientUserId).sort()).toEqual(['user-a', 'user-b'])
  })

  test('sends selection-ready notification with score payload', async () => {
    const state = makeState({ assignedToUserId: 'user-assigned' })
    await notifyRecruitersAboutSelectionReady({
      prisma: state.prisma as never,
      env: env as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      totalScore: 87.5,
    })
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      recipientUserId: 'user-assigned',
      template: 'selection.verdict_ready',
      payload: expect.objectContaining({
        totalScore: 87.5,
      }),
    })
  })
})

function makeState(input: { assignedToUserId: string | null }) {
  const notifications: Array<Record<string, unknown>> = []
  const prisma = {
    application: {
      findFirst: async () => ({
        id: 'app-1',
        vacancy: { title: 'Logist' },
        assignedToUserId: input.assignedToUserId,
      }),
    },
    userRole: {
      findMany: async () => [{ userId: 'user-a' }, { userId: 'user-b' }, { userId: 'user-a' }],
    },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data)
        return {
          id: `n-${notifications.length}`,
          template: String(data.template),
          payload: data.payload ?? {},
          createdAt: new Date(),
        }
      },
    },
  }
  return { prisma, notifications }
}
