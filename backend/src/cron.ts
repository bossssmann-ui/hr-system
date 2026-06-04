import { randomUUID } from 'node:crypto'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { createBackendRuntime, type BackendRuntime } from './runtime'
import { sendProbationReminders } from './features/employees/employees.service'
import { expireOverdueOffers } from './features/offers/offers.service'
import {
  send1on1Reminders,
  sendOkrQuarterStartReminders,
  sendReviewReminders,
} from './features/learning/learning.service'
import { computeHrSnapshot } from './features/analytics/analytics.service'
import { computeSignalsForTenant } from './features/signals/signals.service'
import { runDataRetention } from './features/tenant/tenant.service'
import { collectSelectionRetentionOutcomes } from './features/selection/retention-outcomes'
import { runSelectionScoringCalibration } from './features/selection/retention-calibration'
import { createInMemoryQueue, drainDurableQueue } from './queues'
import { sourceHhResumesForTenant } from './integrations/hh/sourcing'
import './features/assessments/assessments.queue'
import './features/interviews/interviews.queue'
import './features/messaging/messaging.queue'
import './features/scoring/scoring.queue'
import './features/selection/selection.queue'
import './features/selection/selection-application-bridge'

type CronTask = (runtime: BackendRuntime) => Promise<void>

const cronTasks = {
  noop: async () => {
    console.log('Cron noop task completed.')
  },
  'db:ping': async ({ prisma }) => {
    await prisma.$queryRaw`SELECT 1`
    console.log('Cron db:ping task completed.')
  },
  'probation.reminder': async ({ prisma }) => {
    const result = await sendProbationReminders({ prisma })
    console.log(
      `Cron probation.reminder task completed. employees=${result.employeesMatched} notifications=${result.notificationsSent}`,
    )
  },
  'offer:expire': async ({ prisma }) => {
    const result = await expireOverdueOffers({ prisma })
    console.log(`Cron offer:expire completed. matched=${result.matched} expired=${result.expired}`)
  },
  '1on1.reminder': async ({ prisma }) => {
    const result = await send1on1Reminders({ prisma })
    console.log(`Cron 1on1.reminder completed. matched=${result.matched} sent=${result.sent}`)
  },
  'okr.quarter_start': async ({ prisma }) => {
    const result = await sendOkrQuarterStartReminders({ prisma })
    console.log(`Cron okr.quarter_start completed. matched=${result.matched} sent=${result.sent}`)
  },
  'review.reminder': async ({ prisma }) => {
    const result = await sendReviewReminders({ prisma })
    console.log(`Cron review.reminder completed. matched=${result.matched} sent=${result.sent}`)
  },
  // Phase 7 — daily HR analytics snapshot per tenant.
  'analytics.snapshot': async ({ prisma }) => {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let totalHeadcount = 0
    for (const t of tenants) {
      const result = await computeHrSnapshot({ prisma, tenantId: t.id })
      totalHeadcount += result.headcount
    }
    console.log(
      `Cron analytics.snapshot completed. tenants=${tenants.length} headcount_sum=${totalHeadcount}`,
    )
  },
  // Phase 9 — daily flight-risk / burnout signal computation per tenant.
  'signals.compute': async ({ prisma, env }) => {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let opened = 0
    let upserted = 0
    for (const t of tenants) {
      const result = await computeSignalsForTenant({
        prisma,
        tenantId: t.id,
        openThreshold: env.SIGNALS_OPEN_THRESHOLD,
      })
      opened += result.opened
      upserted += result.upserted
    }
    console.log(
      `Cron signals.compute completed. tenants=${tenants.length} upserted=${upserted} opened=${opened}`,
    )
  },
  // Phase 12 — monthly data retention sweep (152-ФЗ / GDPR).
  // Iterates every tenant; for each policy, anonymises or deletes rows whose
  // age exceeds `retain_days`. Writes one AuditEvent(data_retention.run) per
  // tenant. AuditEvent rows themselves are never touched.
  'data.retention': async ({ prisma }) => {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let totalCandidates = 0
    let totalEmployees = 0
    for (const t of tenants) {
      const r = await runDataRetention(prisma, { tenantId: t.id })
      totalCandidates += r.processedCandidates
      totalEmployees += r.processedEmployees
    }
    console.log(
      `Cron data.retention completed. tenants=${tenants.length} candidates=${totalCandidates} employees=${totalEmployees}`,
    )
  },
  'selection.retention_outcomes': async ({ prisma }) => {
    const result = await collectSelectionRetentionOutcomes({ prisma })
    console.log(
      `Cron selection.retention_outcomes completed. employees=${result.employeesMatched} upserted=${result.outcomesUpserted}`,
    )
  },
  'selection.retention_calibration': async ({ prisma }) => {
    const result = await runSelectionScoringCalibration({ prisma })
    console.log(
      `Cron selection.retention_calibration completed. tenants=${result.totalTenants} calibrated=${result.calibratedTenants}`,
    )
  },
  'hh.sourcing': async ({ prisma, env }) => {
    const tenants = await prisma.tenant.findMany({ select: { id: true } })
    let candidatesImported = 0
    let applicationsCreated = 0
    for (const tenant of tenants) {
      const result = await sourceHhResumesForTenant(prisma, env, tenant.id)
      candidatesImported += result.candidatesImported
      applicationsCreated += result.applicationsCreated
    }
    console.log(
      `Cron hh.sourcing completed. tenants=${tenants.length} candidates=${candidatesImported} applications=${applicationsCreated}`,
    )
  },
  'queue.drain': async ({ prisma, env }) => {
    const result = await drainDurableQueue({ prisma, env })
    console.log(`Cron queue.drain completed. claimed=${result.claimed} processed=${result.processed}`)
  },
} satisfies Record<string, CronTask>

export type CronTaskName = keyof typeof cronTasks

type CronRunJob = {
  prisma: DbClient
  env: AppEnv
  taskName: CronTaskName
  scheduledWindow: string
}

const cronRunQueue = createInMemoryQueue<CronRunJob>('cron.run')
let cronRunQueueRegistered = false

function ensureCronRunQueueRegistered() {
  if (cronRunQueueRegistered) return
  cronRunQueueRegistered = true
  cronRunQueue.process(async (job) => {
    await executeCronRun(job)
  })
}

async function executeCronRun(job: CronRunJob) {
  const task = cronTasks[job.taskName]
  if (!task) throw new Error(`Unknown cron task "${job.taskName}"`)
  if (!hasDurableSql(job.prisma)) {
    await task({ prisma: job.prisma, env: job.env, close: async () => undefined })
    return
  }

  const tenantId: string | null = null
  if (await hasSucceededRun(job.prisma, job.taskName, tenantId, job.scheduledWindow)) {
    return
  }

  const attempt = await nextAttempt(job.prisma, job.taskName, tenantId, job.scheduledWindow)
  const runId = randomUUID()
  await job.prisma.$executeRaw`
    INSERT INTO cron_job_runs (
      id,
      job_name,
      tenant_id,
      scheduled_window,
      started_at,
      status,
      attempt,
      created_at,
      updated_at
    )
    VALUES (
      ${runId}::uuid,
      ${job.taskName},
      ${tenantId}::uuid,
      ${job.scheduledWindow},
      now(),
      'running',
      ${attempt},
      now(),
      now()
    )
  `

  try {
    await task({ prisma: job.prisma, env: job.env, close: async () => undefined })
    await job.prisma.$executeRaw`
      UPDATE cron_job_runs
      SET status = 'succeeded',
          finished_at = now(),
          error = NULL,
          updated_at = now()
      WHERE id = ${runId}::uuid
    `
  } catch (err) {
    await job.prisma.$executeRaw`
      UPDATE cron_job_runs
      SET status = 'failed',
          finished_at = now(),
          error = ${safeErrorMessage(err)},
          updated_at = now()
      WHERE id = ${runId}::uuid
    `
    throw err
  }
}

function hasDurableSql(prisma: DbClient) {
  if (!prisma) return false
  return (
    typeof (prisma as unknown as { $executeRaw?: unknown }).$executeRaw === 'function' &&
    typeof (prisma as unknown as { $queryRaw?: unknown }).$queryRaw === 'function'
  )
}

async function hasSucceededRun(prisma: DbClient, jobName: string, tenantId: string | null, scheduledWindow: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM cron_job_runs
    WHERE job_name = ${jobName}
      AND tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
      AND scheduled_window = ${scheduledWindow}
      AND status = 'succeeded'
    LIMIT 1
  `
  return rows.length > 0
}

async function nextAttempt(prisma: DbClient, jobName: string, tenantId: string | null, scheduledWindow: string) {
  const rows = await prisma.$queryRaw<Array<{ attempt: number }>>`
    SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
    FROM cron_job_runs
    WHERE job_name = ${jobName}
      AND tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
      AND scheduled_window = ${scheduledWindow}
  `
  return rows[0]?.attempt ?? 1
}

function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.slice(0, 2000)
}

function resolveScheduledWindow(taskName: CronTaskName, now: Date): string {
  const iso = now.toISOString()
  if (taskName === 'data.retention') return iso.slice(0, 7)
  return iso.slice(0, 10)
}

async function enqueueCronRunJob(prisma: DbClient, env: AppEnv, taskName: CronTaskName, scheduledWindow: string) {
  const maxRetries = env.QUEUE_MAX_RETRIES ?? 5
  await prisma.$executeRaw`
    INSERT INTO queue_jobs (
      id,
      queue_name,
      payload,
      status,
      attempts,
      max_retries,
      available_at,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()}::uuid,
      'cron.run',
      ${{ taskName, scheduledWindow }}::jsonb,
      'pending',
      0,
      ${maxRetries},
      now(),
      now(),
      now()
    )
  `
}

export async function runCronTask(
  taskName: string,
  runtime: BackendRuntime,
  options?: { scheduledWindow?: string },
) {
  const task = cronTasks[taskName as CronTaskName]

  if (!task) {
    throw new Error(`Unknown cron task "${taskName}". Available tasks: ${Object.keys(cronTasks).join(', ')}`)
  }

  if (!hasDurableSql(runtime.prisma)) {
    await task(runtime)
    return
  }

  const jobName = taskName as CronTaskName
  const scheduledWindow = options?.scheduledWindow ?? resolveScheduledWindow(jobName, new Date())
  ensureCronRunQueueRegistered()
  await enqueueCronRunJob(runtime.prisma, runtime.env, jobName, scheduledWindow)
  await drainDurableQueue({
    prisma: runtime.prisma,
    env: runtime.env,
    queueName: 'cron.run',
  })
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const [taskName] = argv

  if (!taskName) {
    console.error(`Cron task name is required. Available tasks: ${Object.keys(cronTasks).join(', ')}`)
    process.exit(1)
  }

  const runtime = createBackendRuntime()

  try {
    await runCronTask(taskName, runtime)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}
