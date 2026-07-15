import { describe, expect, test } from 'bun:test'

import type { Notifier, NotifyInput } from '../../services/notifier'
import {
  handleInboundApplicationCreated,
  recoverPendingInboundApplications,
  withInboundProcessingPending,
} from './inbound-application.service'

describe('handleInboundApplicationCreated', () => {
  test('creates a conversation and notifies active recruiting users', async () => {
    const state = createState()
    const prisma = createFakePrisma(state)
    const notifications: NotifyInput[] = []
    const notifier: Notifier = {
      async notify(input) {
        notifications.push(input)
      },
    }

    const result = await handleInboundApplicationCreated({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      candidateId: 'candidate-1',
      vacancyId: 'vacancy-1',
      source: 'hh_ru',
      candidateName: 'Alice Candidate',
      vacancyTitle: 'Logistics Manager',
      notifier,
    })

    expect(result).toEqual({
      conversationId: 'conv-1',
      conversationCreated: true,
      notificationsSent: 3,
    })
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]).toMatchObject({
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      applicationId: 'app-1',
      subject: 'Alice Candidate - Logistics Manager (HH.ru)',
    })
    expect(notifications.map((item) => item.recipient.userId).sort()).toEqual(['owner-1', 'recruiter-1', 'recruiter-2'])
    expect(notifications.every((item) => item.template === 'application.new_inbound')).toBe(true)
    expect(notifications[0]?.payload).toMatchObject({
      title: 'New application',
      applicationId: 'app-1',
      conversationId: 'conv-1',
      source: 'hh_ru',
    })
  })

  test('reuses an existing candidate conversation', async () => {
    const state = createState()
    state.conversations.push({
      id: 'conv-existing',
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      applicationId: 'app-old',
      subject: 'Existing thread',
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const prisma = createFakePrisma(state)
    const notifications: NotifyInput[] = []

    const result = await handleInboundApplicationCreated({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      applicationId: 'app-2',
      candidateId: 'candidate-1',
      vacancyId: 'vacancy-2',
      source: 'careers_page',
      notifier: {
        async notify(input) {
          notifications.push(input)
        },
      },
    })

    expect(result.conversationId).toBe('conv-existing')
    expect(result.conversationCreated).toBe(false)
    expect(state.conversations).toHaveLength(1)
    expect(notifications).toHaveLength(3)
  })

  test('does not duplicate inbound notifications for the same application', async () => {
    const state = createState()
    state.notifications.push({
      id: 'notif-existing',
      tenantId: 'tenant-1',
      recipientUserId: 'owner-1',
      template: 'application.new_inbound',
      payload: { applicationId: 'app-1' },
    })
    const prisma = createFakePrisma(state)
    const notifications: NotifyInput[] = []

    await handleInboundApplicationCreated({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      candidateId: 'candidate-1',
      vacancyId: 'vacancy-1',
      source: 'hh_ru',
      notifier: {
        async notify(input) {
          notifications.push(input)
          state.notifications.push({
            id: `notif-${state.notifications.length + 1}`,
            tenantId: input.recipient.tenantId,
            recipientUserId: input.recipient.userId,
            template: input.template,
            payload: input.payload,
          })
        },
      },
    })

    expect(notifications.map((item) => item.recipient.userId).sort()).toEqual(['recruiter-1', 'recruiter-2'])
  })

  test('recovers stale pending inbound applications', async () => {
    const state = createState()
    const now = new Date('2026-07-07T00:00:00.000Z')
    const originalNow = Date.now
    Date.now = () => now.getTime()
    state.applications.push(
      {
        id: 'app-stale',
        tenantId: 'tenant-1',
        candidateId: 'candidate-1',
        vacancyId: 'vacancy-1',
        externalIds: withInboundProcessingPending({}, 'careers_page', new Date('2026-07-06T23:50:00.000Z')),
        updatedAt: new Date('2026-07-06T23:50:00.000Z'),
        candidate: { fullName: 'Alice Candidate' },
        vacancy: { title: 'Logistics Manager' },
      },
      {
        id: 'app-fresh',
        tenantId: 'tenant-1',
        candidateId: 'candidate-2',
        vacancyId: 'vacancy-2',
        externalIds: withInboundProcessingPending({}, 'hh_ru', new Date('2026-07-06T23:58:00.000Z')),
        updatedAt: new Date('2026-07-06T23:58:00.000Z'),
        candidate: { fullName: 'Fresh Candidate' },
        vacancy: { title: 'Sales Manager' },
      },
    )
    const prisma = createFakePrisma(state)
    const processed: string[] = []

    try {
      const result = await recoverPendingInboundApplications({
        prisma: prisma as never,
        process: async ({ applicationId }) => {
          processed.push(applicationId)
        },
      })

      expect(result).toEqual({ recovered: 1, skipped: 1 })
      expect(processed).toEqual(['app-stale'])
    } finally {
      Date.now = originalNow
    }
  })
})

type ConversationRow = {
  id: string
  tenantId: string
  candidateId: string
  applicationId: string | null
  subject: string | null
  lastMessageAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type ApplicationRow = {
  id: string
  tenantId: string
  candidateId: string
  vacancyId: string
  externalIds: unknown
  updatedAt: Date
  candidate: { fullName: string }
  vacancy: { title: string }
}

function createState() {
  return {
    conversationSeq: 0,
    conversations: [] as ConversationRow[],
    applications: [] as ApplicationRow[],
    notifications: [] as Array<{
      id: string
      tenantId: string
      recipientUserId: string
      template: string
      payload: unknown
    }>,
    userRoles: [
      { tenantId: 'tenant-1', userId: 'owner-1', role: 'owner', user: { disabledAt: null } },
      { tenantId: 'tenant-1', userId: 'hr-1', role: 'hr_admin', user: { disabledAt: new Date() } },
      { tenantId: 'tenant-1', userId: 'recruiter-1', role: 'recruiter', user: { disabledAt: null } },
      { tenantId: 'tenant-1', userId: 'recruiter-1', role: 'owner', user: { disabledAt: null } },
      { tenantId: 'tenant-1', userId: 'recruiter-2', role: 'recruiter', user: { disabledAt: null } },
      { tenantId: 'tenant-1', userId: 'manager-1', role: 'hiring_manager', user: { disabledAt: null } },
      { tenantId: 'tenant-2', userId: 'owner-2', role: 'owner', user: { disabledAt: null } },
    ],
  }
}

function createFakePrisma(state: ReturnType<typeof createState>) {
  return {
    application: {
      findMany: async () => {
        return state.applications
          .filter((row) => {
            const externalIds = asRecord(row.externalIds)
            const marker = asRecord(externalIds.inbound_processing)
            return marker.status === 'pending'
          })
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      },
      findFirst: async ({ where }: { where: { id: string } }) => {
        return state.applications.find((row) => row.id === where.id) ?? null
      },
      update: async ({ where, data }: { where: { id: string }; data: { externalIds: unknown } }) => {
        const row = state.applications.find((item) => item.id === where.id)
        if (!row) throw new Error('application not found')
        row.externalIds = data.externalIds
        return row
      },
    },
    conversation: {
      findFirst: async ({ where }: { where: { tenantId: string; candidateId: string } }) => {
        return (
          state.conversations.find(
            (row) => row.tenantId === where.tenantId && row.candidateId === where.candidateId,
          ) ?? null
        )
      },
      create: async ({ data }: { data: Omit<ConversationRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const now = new Date()
        const row = {
          ...data,
          id: `conv-${++state.conversationSeq}`,
          createdAt: now,
          updatedAt: now,
        }
        state.conversations.push(row)
        return row
      },
    },
    userRole: {
      findMany: async ({ where }: { where: { tenantId: string; role: { in: string[] }; user: { disabledAt: null } } }) => {
        return state.userRoles
          .filter((row) => row.tenantId === where.tenantId)
          .filter((row) => where.role.in.includes(row.role))
          .filter((row) => row.user.disabledAt === where.user.disabledAt)
          .map((row) => ({ userId: row.userId }))
      },
    },
    notification: {
      findFirst: async ({ where }: {
        where: {
          tenantId: string
          recipientUserId: string
          template: string
          payload: { path: string[]; equals: string }
        }
      }) => {
        return (
          state.notifications.find((row) => {
            const payload = asRecord(row.payload)
            return row.tenantId === where.tenantId &&
              row.recipientUserId === where.recipientUserId &&
              row.template === where.template &&
              payload[where.payload.path[0]!] === where.payload.equals
          }) ?? null
        )
      },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
