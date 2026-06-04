import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runCronTask } from './cron'

describe('runCronTask', () => {
  test('runs the noop task', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()
  })

  test('runs the probation.reminder task', async () => {
    const notifications: unknown[] = []
    const runtime = {
      prisma: {
        employee: {
          findMany: async () => [
            {
              id: 'emp-1',
              tenantId: 'tenant-1',
              fullName: 'Иван Иванов',
              probationEndsAt: new Date('2026-06-08T00:00:00.000Z'),
            },
          ],
        },
        userRole: {
          findMany: async () => [{ tenantId: 'tenant-1', userId: 'manager-user' }],
        },
        notification: {
          create: async ({ data }: { data: unknown }) => {
            notifications.push(data)
            return data
          },
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('probation.reminder', runtime)).resolves.toBeUndefined()
    expect(notifications).toHaveLength(1)
  })

  test('runs the selection.retention_outcomes task', async () => {
    const upserts: unknown[] = []
    const runtime = {
      prisma: {
        employee: {
          findMany: async () => [
            {
              tenantId: 'tenant-1',
              applicationId: 'app-1',
              hireDate: new Date('2026-01-01T00:00:00.000Z'),
              terminatedAt: null,
              terminationGround: null,
            },
          ],
        },
        selectionSession: {
          findMany: async () => [
            {
              id: 'sess-1',
              tenantId: 'tenant-1',
              applicationId: 'app-1',
              createdAt: new Date('2026-01-02T00:00:00.000Z'),
            },
          ],
        },
        selectionRetentionOutcome: {
          upsert: async (args: unknown) => {
            upserts.push(args)
            return { id: 'out-1' }
          },
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('selection.retention_outcomes', runtime)).resolves.toBeUndefined()
    expect(upserts).toHaveLength(1)
  })

  test('runs the selection.retention_calibration task', async () => {
    const runtime = {
      prisma: {
        tenant: {
          findMany: async () => [],
        },
      },
    } as unknown as BackendRuntime
    await expect(runCronTask('selection.retention_calibration', runtime)).resolves.toBeUndefined()
  })

  test('rejects unknown tasks', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('missing', runtime)).rejects.toThrow('Unknown cron task')
  })

  test('logs durable cron runs and keeps one successful run per window', async () => {
    const runtime = buildDurableRuntime()

    await runCronTask('noop', runtime as unknown as BackendRuntime, { scheduledWindow: '2026-06-04' })
    await runCronTask('noop', runtime as unknown as BackendRuntime, { scheduledWindow: '2026-06-04' })

    const successRuns = runtime.cronRuns.filter(
      (run) => run.job_name === 'noop' && run.scheduled_window === '2026-06-04' && run.status === 'succeeded',
    )
    expect(successRuns).toHaveLength(1)
    expect(successRuns[0]?.attempt).toBe(1)
  })

})

type QueueJob = {
  id: string
  queue_name: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'done' | 'failed'
  attempts: number
  max_retries: number
  available_at: number
  last_error: string | null
}

type CronRun = {
  id: string
  job_name: string
  tenant_id: string | null
  scheduled_window: string
  status: 'running' | 'succeeded' | 'failed'
  attempt: number
  error: string | null
}

function buildDurableRuntime(options?: { failDbPingAttempts?: number }) {
  const queueJobs = new Map<string, QueueJob>()
  const cronRuns: CronRun[] = []
  let dbPingAttempts = 0
  const failDbPingAttempts = options?.failDbPingAttempts ?? 0

  const prisma = {
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')
      const now = Date.now()

      if (sql.includes('INSERT INTO queue_jobs')) {
        const id = values[0] as string
        const queueName = values.length >= 5 ? (values[1] as string) : 'cron.run'
        const payload = values.length >= 5 ? (values[2] as Record<string, unknown>) : (values[1] as Record<string, unknown>)
        const maxRetries = values.length >= 5 ? (values[3] as number) : (values[2] as number)
        const delayMs = values.length >= 5 ? (values[4] as number) : 0
        queueJobs.set(id, {
          id,
          queue_name: queueName,
          payload,
          status: 'pending',
          attempts: 0,
          max_retries: maxRetries,
          available_at: now + delayMs,
          last_error: null,
        })
        return 1
      }

      if (sql.includes("SET status = 'done'")) {
        const [id] = values as [string]
        const job = queueJobs.get(id)
        if (!job) return 0
        job.status = 'done'
        return 1
      }

      if (sql.includes("SET status = 'failed'")) {
        const [nextAttempts, message, id] = values as [number, string, string]
        const job = queueJobs.get(id)
        if (!job) return 0
        job.status = 'failed'
        job.attempts = nextAttempts
        job.last_error = message
        return 1
      }

      if (sql.includes("SET status = 'pending'")) {
        if (sql.includes('attempts =')) {
          const [nextAttempts, delay, message, id] = values as [number, number, string, string]
          const job = queueJobs.get(id)
          if (!job) return 0
          job.status = 'pending'
          job.attempts = nextAttempts
          job.available_at = now + delay
          job.last_error = message
          return 1
        }
        const [delay, id] = values as [number, string]
        const job = queueJobs.get(id)
        if (!job) return 0
        job.status = 'pending'
        job.available_at = now + delay
        return 1
      }

      if (sql.includes('INSERT INTO cron_job_runs')) {
        const [id, jobName, tenantId, scheduledWindow, attempt] =
          values as [string, string, string | null, string, number]
        cronRuns.push({
          id,
          job_name: jobName,
          tenant_id: tenantId,
          scheduled_window: scheduledWindow,
          status: 'running',
          attempt,
          error: null,
        })
        return 1
      }

      if (sql.includes("UPDATE cron_job_runs") && sql.includes("status = 'succeeded'")) {
        const [id] = values as [string]
        const run = cronRuns.find((item) => item.id === id)
        if (!run) return 0
        run.status = 'succeeded'
        run.error = null
        return 1
      }

      if (sql.includes("UPDATE cron_job_runs") && sql.includes("status = 'failed'")) {
        const [message, id] = values as [string, string]
        const run = cronRuns.find((item) => item.id === id)
        if (!run) return 0
        run.status = 'failed'
        run.error = message
        return 1
      }

      return 0
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')

      if (sql.includes('SELECT 1')) {
        dbPingAttempts += 1
        if (dbPingAttempts <= failDbPingAttempts) throw new Error('boom')
        return [{ '?column?': 1 }]
      }

      if (sql.includes('WITH picked AS')) {
        const now = Date.now()
        const hasQueueFilter = sql.includes('queue_name =')
        const queueName = hasQueueFilter ? (values[0] as string) : undefined
        const batchSize = hasQueueFilter ? (values[1] as number) : (values[0] as number)
        const picked = Array.from(queueJobs.values())
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
      }

      if (sql.includes("FROM cron_job_runs") && sql.includes("status = 'succeeded'")) {
        const [jobName, tenantId, scheduledWindow] = values as [string, string | null, string]
        const found = cronRuns.find((run) =>
          run.job_name === jobName &&
          run.tenant_id === tenantId &&
          run.scheduled_window === scheduledWindow &&
          run.status === 'succeeded',
        )
        return found ? [{ id: found.id }] : []
      }

      if (sql.includes('COALESCE(MAX(attempt), 0) + 1')) {
        const [jobName, tenantId, scheduledWindow] = values as [string, string | null, string]
        const current = cronRuns
          .filter((run) => run.job_name === jobName && run.tenant_id === tenantId && run.scheduled_window === scheduledWindow)
          .reduce((max, run) => Math.max(max, run.attempt), 0)
        return [{ attempt: current + 1 }]
      }

      return []
    },
  }

  const env = {
    QUEUE_POLL_INTERVAL_MS: 5,
    QUEUE_BATCH_SIZE: 20,
    QUEUE_MAX_RETRIES: 3,
    QUEUE_JOB_TIMEOUT_MS: 1000,
  } as BackendRuntime['env']

  return { prisma, env, close: async () => undefined, queueJobs, cronRuns }
}
