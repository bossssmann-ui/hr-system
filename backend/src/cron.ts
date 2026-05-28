import { createBackendRuntime, type BackendRuntime } from './runtime'
import { sendProbationReminders } from './features/employees/employees.service'
import { expireOverdueOffers } from './features/offers/offers.service'
import {
  send1on1Reminders,
  sendOkrQuarterStartReminders,
  sendReviewReminders,
} from './features/learning/learning.service'

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
