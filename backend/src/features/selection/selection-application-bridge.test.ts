import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../../db'
import { drainDurableQueue } from '../../queues'
import { enqueueSelectionBridgeJob, handleApplicationCreatedForSelection } from './selection-application-bridge'

const baseEnv = {
  ASSESSMENT_SYSTEM_ENABLED: true,
  HH_INTEGRATION_ENABLED: false,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
} as const

describe('selection application bridge', () => {
  test('creates a session for supported role and is idempotent', async () => {
    const state = makeState({
      application: {
        id: 'app-1',
        tenantId: 'tenant-1',
        vacancyId: 'vac-1',
        candidate: { source: 'manual', email: 'candidate@example.com', externalIds: {} },
        vacancy: {
          title: 'Logist Specialist',
          description: 'Operations role',
          requisition: { title: 'Logist' },
        },
      },
      featureFlags: {},
    })

    const first = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      source: 'manual',
    })
    const second = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      source: 'manual',
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(state.sessions).toHaveLength(1)
  })

  test('skips creation when role is not supported', async () => {
    const state = makeState({
      application: {
        id: 'app-2',
        tenantId: 'tenant-1',
        vacancyId: 'vac-2',
        candidate: { source: 'manual', email: null, externalIds: {} },
        vacancy: {
          title: 'Frontend Engineer',
          description: 'UI role',
          requisition: { title: 'Frontend' },
        },
      },
      featureFlags: {},
    })

    const result = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-2',
      source: 'manual',
    })

    expect(result).toEqual({ created: false, reason: 'role_not_supported' })
    expect(state.sessions).toHaveLength(0)
    expect(state.applicationUpdates.at(-1)).toMatchObject({
      aiFlags: {
        selectionPipelineBindingRequired: true,
        selectionPipelineBindingReason: 'role_not_supported',
      },
    })
  })

  test('uses explicit vacancy role when provided', async () => {
    const state = makeState({
      application: {
        id: 'app-3',
        tenantId: 'tenant-1',
        vacancyId: 'vac-3',
        candidate: { source: 'manual', email: null, externalIds: {} },
        vacancy: {
          title: 'Frontend Engineer',
          description: 'UI role',
          role: 'sales_manager',
          requisition: { title: 'Frontend' },
        },
      },
      featureFlags: {},
    })

    const result = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-3',
      source: 'manual',
    })

    expect(result.created).toBe(true)
    expect(state.sessions).toHaveLength(1)
  })

  test('enqueues durable bridge job and stays idempotent on retry', async () => {
    const state = makeState({
      application: {
        id: 'app-4',
        tenantId: 'tenant-1',
        vacancyId: 'vac-4',
        candidate: { source: 'manual', email: null, externalIds: {} },
        vacancy: {
          title: 'Logist Specialist',
          description: 'Operations role',
          requisition: { title: 'Logist' },
        },
      },
      featureFlags: {},
    })
    const durable = withDurableQueue(state.prisma as unknown as DbClient)

    await enqueueSelectionBridgeJob({
      prisma: durable.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-4',
      source: 'manual',
    })

    expect(durable.jobs.size).toBeGreaterThan(0)

    await drainDurableQueue({
      prisma: durable.prisma as never,
      env: baseEnv as never,
      queueName: 'selection.bridge',
    })
    await enqueueSelectionBridgeJob({
      prisma: durable.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-4',
      source: 'manual',
    })
    await drainDurableQueue({
      prisma: durable.prisma as never,
      env: baseEnv as never,
      queueName: 'selection.bridge',
    })

    expect(state.sessions).toHaveLength(1)
  })
})

function makeState(input: {
  application: {
    id: string
    tenantId: string
    vacancyId: string
    candidate: { source: string; email: string | null; externalIds: Record<string, unknown> }
    vacancy: { title: string; description: string; role?: string; requisition: { title: string } | null }
    aiFlags?: Record<string, unknown> | null
  }
  featureFlags: Record<string, boolean>
}) {
  const sessions: Array<Record<string, unknown>> = []
  const templates: Array<Record<string, unknown>> = []
  const applicationUpdates: Array<Record<string, unknown>> = []
  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        if (where.id !== input.application.id || where.tenantId !== input.application.tenantId) return null
        return input.application
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        applicationUpdates.push(data)
      },
    },
    selectionSession: {
      findFirst: async ({ where }: { where: { applicationId?: string } }) => {
        if (!where.applicationId) return null
        return sessions.find((s) => s.applicationId === where.applicationId) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sess-${sessions.length + 1}`, token: `token-${sessions.length + 1}`, ...data }
        sessions.push(row)
        return row
      },
    },
    selectionTemplate: {
      findFirst: async ({ where }: { where: { vacancyId: string; role: string } }) => {
        return templates.find((t) => t.vacancyId === where.vacancyId && t.role === where.role) ?? null
      },
      findMany: async ({ where }: { where: { vacancyId: string } }) => {
        return templates.filter((t) => t.vacancyId === where.vacancyId)
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `tpl-${templates.length + 1}`, ...data }
        templates.push(row)
        return row
      },
    },
    tenantSettings: {
      findUnique: async () => ({ featureFlags: input.featureFlags }),
    },
    hhConnection: {
      findUnique: async () => null,
    },
  }
  return { prisma, sessions, applicationUpdates }
}

type QueueJob = {
  id: string
  queue_name: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'done' | 'failed'
  attempts: number
  max_retries: number
  available_at: number
}

function withDurableQueue(basePrisma: DbClient) {
  const jobs = new Map<string, QueueJob>()
  const prisma = {
    ...basePrisma,
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')
      const now = Date.now()
      if (sql.includes('INSERT INTO queue_jobs')) {
        const [id, queueName, payload, maxRetries, delayMs] =
          values as [string, string, Record<string, unknown>, number, number]
        jobs.set(id, {
          id,
          queue_name: queueName,
          payload,
          status: 'pending',
          attempts: 0,
          max_retries: maxRetries,
          available_at: now + delayMs,
        })
        return 1
      }
      if (sql.includes("SET status = 'done'")) {
        const [id] = values as [string]
        const job = jobs.get(id)
        if (!job) return 0
        job.status = 'done'
        return 1
      }
      if (sql.includes("SET status = 'failed'")) {
        const [, , id] = values as [number, string, string]
        const job = jobs.get(id)
        if (!job) return 0
        job.status = 'failed'
        return 1
      }
      if (sql.includes("SET status = 'pending'")) {
        const job = jobs.get(values.at(-1) as string)
        if (!job) return 0
        job.status = 'pending'
        return 1
      }
      return 0
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')
      if (!sql.includes('WITH picked AS')) return []
      const hasQueueFilter = sql.includes('queue_name =')
      const queueName = hasQueueFilter ? (values[0] as string) : undefined
      const batchSize = hasQueueFilter ? (values[1] as number) : (values[0] as number)
      const now = Date.now()
      const picked = Array.from(jobs.values())
        .filter((job) => job.status === 'pending' && job.available_at <= now)
        .filter((job) => (queueName ? job.queue_name === queueName : true))
        .slice(0, batchSize)

      for (const job of picked) {
        job.status = 'processing'
      }

      return picked.map((job) => ({
        id: job.id,
        queue_name: job.queue_name,
        payload: job.payload,
        attempts: job.attempts,
        max_retries: job.max_retries,
      }))
    },
  }
  return { prisma: prisma as DbClient, jobs }
}
