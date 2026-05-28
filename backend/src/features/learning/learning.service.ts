/**
 * Phase 6 — Learning & Performance services.
 *
 * Side-effect helpers reused by the API layer and cron jobs.
 *
 * Auto-assignment intent (issue Phase 6 §4):
 *   When an Employee is created, every LearningPath with `autoAssign=true` and
 *   matching `roleFamily` (or `roleFamily=null` for all-employees paths) is
 *   attached as a `LearningAssignment` in `assigned` state. Idempotent — the
 *   `(employeeId, pathId)` unique index protects against duplicates.
 *
 * Cron helpers (issue Phase 6 §4):
 *   - `send1on1Reminders` — 24h pre-meeting in-app reminder.
 *   - `sendOkrQuarterStartReminders` — start-of-quarter prompt.
 *   - `sendReviewReminders` — pre-close reminder to pending reviewers.
 */

import type { DbClient } from '../../db'
import { createNotifier, type Notifier } from '../../services/notifier'

export type AutoAssignLearningPathsInput = {
  prisma: DbClient
  tenantId: string
  employeeId: string
  roleFamily?: string | null
  actorUserId: string
}

export async function autoAssignLearningPaths({
  prisma,
  tenantId,
  employeeId,
  roleFamily,
  actorUserId,
}: AutoAssignLearningPathsInput): Promise<{ assigned: number }> {
  const paths = await prisma.learningPath.findMany({
    where: {
      tenantId,
      autoAssign: true,
      deletedAt: null,
      OR: [{ roleFamily: null }, ...(roleFamily ? [{ roleFamily }] : [])],
    },
    select: { id: true },
  })
  if (paths.length === 0) return { assigned: 0 }

  const result = await prisma.learningAssignment.createMany({
    data: paths.map((p) => ({
      tenantId,
      employeeId,
      pathId: p.id,
      assignedByUserId: actorUserId,
    })),
    skipDuplicates: true,
  })
  return { assigned: result.count }
}

export type CronResult = { matched: number; sent: number }

export async function send1on1Reminders(
  { prisma, notifier, now }: { prisma: DbClient; notifier?: Notifier; now?: Date } = {
    prisma: undefined as unknown as DbClient,
  },
): Promise<CronResult> {
  const nowDate = now ?? new Date()
  const windowStart = new Date(nowDate.getTime() + 23 * 60 * 60 * 1000)
  const windowEnd = new Date(nowDate.getTime() + 25 * 60 * 60 * 1000)
  const transport = notifier ?? createNotifier(prisma)

  const upcoming = await prisma.oneOnOne.findMany({
    where: {
      status: 'scheduled',
      reminderSentAt: null,
      scheduledAt: { gte: windowStart, lte: windowEnd },
    },
    include: { employee: { select: { id: true, userId: true, tenantId: true, fullName: true } } },
  })

  let sent = 0
  for (const meeting of upcoming) {
    const recipients = new Set<string>()
    if (meeting.managerUserId) recipients.add(meeting.managerUserId)
    if (meeting.employee.userId) recipients.add(meeting.employee.userId)
    for (const userId of recipients) {
      await transport.notify({
        channel: 'in_app',
        recipient: { userId, tenantId: meeting.tenantId },
        template: '1on1.reminder',
        payload: {
          meetingId: meeting.id,
          employeeId: meeting.employeeId,
          employeeName: meeting.employee.fullName,
          scheduledAt: meeting.scheduledAt.toISOString(),
        },
      })
      sent += 1
    }
    await prisma.oneOnOne.update({ where: { id: meeting.id }, data: { reminderSentAt: nowDate } })
  }

  return { matched: upcoming.length, sent }
}

function currentQuarter(date: Date): string {
  const month = date.getUTCMonth() + 1
  const q = Math.ceil(month / 3)
  return `${date.getUTCFullYear()}-Q${q}`
}

export async function sendOkrQuarterStartReminders({
  prisma,
  notifier,
  now,
}: {
  prisma: DbClient
  notifier?: Notifier
  now?: Date
}): Promise<CronResult> {
  const nowDate = now ?? new Date()
  const quarter = currentQuarter(nowDate)
  const transport = notifier ?? createNotifier(prisma)

  const employees = await prisma.employee.findMany({
    where: { status: { in: ['active', 'probation'] as never }, userId: { not: null } },
    select: { id: true, userId: true, tenantId: true, fullName: true },
  })

  let sent = 0
  for (const emp of employees) {
    if (!emp.userId) continue
    const hasOkr = await prisma.okr.findFirst({ where: { tenantId: emp.tenantId, employeeId: emp.id, quarter }, select: { id: true } })
    if (hasOkr) continue

    await transport.notify({
      channel: 'in_app',
      recipient: { userId: emp.userId, tenantId: emp.tenantId },
      template: 'okr.quarter_start',
      payload: { employeeId: emp.id, quarter },
    })
    sent += 1
  }

  return { matched: employees.length, sent }
}

export async function sendReviewReminders({
  prisma,
  notifier,
  now,
  daysBeforeClose = 3,
}: {
  prisma: DbClient
  notifier?: Notifier
  now?: Date
  daysBeforeClose?: number
}): Promise<CronResult> {
  const nowDate = now ?? new Date()
  const windowEnd = new Date(nowDate.getTime() + daysBeforeClose * 24 * 60 * 60 * 1000)
  const transport = notifier ?? createNotifier(prisma)

  const cycles = await prisma.reviewCycle.findMany({
    where: {
      status: 'open',
      closesAt: { gte: nowDate, lte: windowEnd },
    },
    select: { id: true, tenantId: true, title: true, closesAt: true },
  })

  let sent = 0
  let matched = 0
  for (const cycle of cycles) {
    const pending = await prisma.reviewRequest.findMany({
      where: { tenantId: cycle.tenantId, cycleId: cycle.id, status: 'pending', reminderSentAt: null },
    })
    matched += pending.length
    for (const req of pending) {
      await transport.notify({
        channel: 'in_app',
        recipient: { userId: req.reviewerUserId, tenantId: cycle.tenantId },
        template: 'review.reminder',
        payload: { cycleId: cycle.id, cycleTitle: cycle.title, requestId: req.id, closesAt: cycle.closesAt?.toISOString() ?? null },
      })
      await prisma.reviewRequest.update({ where: { id: req.id }, data: { reminderSentAt: nowDate } })
      sent += 1
    }
  }

  return { matched, sent }
}
