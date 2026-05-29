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
} satisfies Record<string, CronTask>

export type CronTaskName = keyof typeof cronTasks

export async function runCronTask(taskName: string, runtime: BackendRuntime) {
  const task = cronTasks[taskName as CronTaskName]

  if (!task) {
    throw new Error(`Unknown cron task "${taskName}". Available tasks: ${Object.keys(cronTasks).join(', ')}`)
  }

  await task(runtime)
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
