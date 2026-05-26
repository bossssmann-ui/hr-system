/**
 * Employee lifecycle service — Phase 4.3 / 4.6.
 *
 * Implements `createFromApplication`: the side-effect triggered by the
 * `Application.offer → hired` transition that creates an `Employee` row
 * and writes an `employee.created` audit event.
 *
 * Spec: docs/employee-lifecycle-design.md §1.2.
 */

import type { DbClient } from '../../db'
import type { Prisma } from '../../generated/prisma/client'
import { createNotifier, type Notifier } from '../../services/notifier'
import { offerDraftSchema } from '../interviews/interviews.schemas'
import type { Role } from '../requisitions/requisitions.fsm'
import {
  canTransition,
  satisfiesProbationTransitionInvariant,
  type ProbationReviewDecision,
} from './employees.fsm'

export type CreateFromApplicationInput = {
  prisma: DbClient
  applicationId: string
  actorUserId?: string
  tenantId: string
}

export const DEFAULT_PROBATION_REMINDER_DAYS_BEFORE = 7

const PROBATION_REVIEW_ALLOWED_ROLES: ReadonlyArray<Role> = ['hr_admin', 'hiring_manager', 'owner']

export type RecordProbationReviewInput = {
  prisma: DbClient
  tenantId: string
  employeeId: string
  actorRoles: ReadonlyArray<Role>
  actorUserId?: string
  decision: ProbationReviewDecision
  periodStart?: Date | null
  periodEnd?: Date | null
  marginalContributionRub?: number | null
  closedDeals?: number | null
  managerNotes?: string | null
  extendedProbationEndsAt?: Date | null
  reviewedAt?: Date
  notifier?: Notifier
}

export type SendProbationRemindersInput = {
  prisma: DbClient
  today?: Date
  reminderDaysBefore?: number
  notifier?: Notifier
}

/**
 * Create an `Employee(pre_onboarding)` from a hired `Application`.
 *
 * - Idempotent: if an `Employee` already exists for the given `applicationId`
 *   (invariant: UNIQUE), the existing row is returned without creating a
 *   duplicate (satisfies the "re-run after rollback" requirement).
 * - Snapshots candidate, org-unit, requisition, position, grade, currency,
 *   agreed salary, and agreed start date at the moment of hire so the
 *   `Employee` record is decoupled from later edits to `Application` /
 *   `HiringRequisition`.
 * - Writes an `AuditEvent` with `action = 'employee.created'` and
 *   `diff.via = 'hired_application'`.
 *
 * Call this inside the same `prisma.$transaction` callback as the stage
 * update so the employee is created atomically with the `hired` stage.
 */
export async function createFromApplication(input: CreateFromApplicationInput) {
  const { prisma, applicationId, actorUserId, tenantId } = input

  // ── Idempotency check ────────────────────────────────────────────────────
  const existing = await prisma.employee.findUnique({
    where: { applicationId },
  })
  if (existing) return existing

  // ── Load application data ────────────────────────────────────────────────
  const application = await prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    include: {
      candidate: true,
      vacancy: {
        include: {
          requisition: true,
        },
      },
    },
  })

  if (!application) {
    throw new Error(`createFromApplication: application ${applicationId} not found`)
  }

  const { candidate, vacancy } = application
  const { requisition } = vacancy

  // ── Resolve agreed terms from the latest offer draft ────────────────────
  // The offer draft is stored as JSONB on the latest Interview for the
  // application. Terms are optional — the employee is created regardless.
  const interview = await prisma.interview.findFirst({
    where: { applicationId, tenantId },
    orderBy: { createdAt: 'desc' },
    select: { offerDraft: true },
  })

  const offerDraft =
    interview?.offerDraft != null
      ? offerDraftSchema.safeParse(interview.offerDraft).data
      : undefined

  // ── Create employee ──────────────────────────────────────────────────────
  const employee = await prisma.employee.create({
    data: {
      tenantId,
      applicationId,
      candidateId: candidate.id,
      requisitionId: requisition.id,
      orgUnitId: vacancy.orgUnitId,
      fullName: candidate.fullName,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      jobTitle: vacancy.title,
      grade: offerDraft?.grade ?? requisition.grade,
      currency: offerDraft?.currency ?? requisition.currency,
      agreedBaseSalary: offerDraft?.salary ?? null,
      agreedStartDate:
        offerDraft?.start_date != null ? new Date(offerDraft.start_date) : null,
      status: 'pre_onboarding',
    },
  })

  // ── Audit event ──────────────────────────────────────────────────────────
  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorUserId: actorUserId ?? null,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      diff: {
        via: 'hired_application',
        applicationId,
        candidateId: candidate.id,
      },
    },
  })

  return employee
}

export async function recordProbationReview(input: RecordProbationReviewInput) {
  const {
    prisma,
    tenantId,
    employeeId,
    actorRoles,
    actorUserId,
    decision,
    periodStart,
    periodEnd,
    marginalContributionRub,
    closedDeals,
    managerNotes,
    extendedProbationEndsAt,
    reviewedAt = new Date(),
  } = input

  if (!actorRoles.some((role) => PROBATION_REVIEW_ALLOWED_ROLES.includes(role))) {
    throw new Error('recordProbationReview: actor is not allowed to review probation')
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      fullName: true,
      status: true,
      probationEndsAt: true,
    },
  })

  if (!employee) {
    throw new Error(`recordProbationReview: employee ${employeeId} not found`)
  }

  if (employee.status !== 'probation') {
    throw new Error('recordProbationReview: employee must be in probation status')
  }

  if (decision === 'extended') {
    if (!extendedProbationEndsAt) {
      throw new Error('recordProbationReview: extended decision requires extendedProbationEndsAt')
    }
    if (employee.probationEndsAt && extendedProbationEndsAt <= employee.probationEndsAt) {
      throw new Error('recordProbationReview: extendedProbationEndsAt must move probation forward')
    }
  }

  const targetStatus = probationDecisionTargetStatus(decision)
  if (targetStatus) {
    if (!canTransition(employee.status, targetStatus, actorRoles)) {
      throw new Error(`recordProbationReview: transition ${employee.status} -> ${targetStatus} is not allowed`)
    }
    if (!satisfiesProbationTransitionInvariant(employee.status, targetStatus, decision)) {
      throw new Error(`recordProbationReview: decision ${decision} does not satisfy ${employee.status} -> ${targetStatus}`)
    }
  }

  const payload = buildProbationReviewPayload({
    decision,
    periodStart,
    periodEnd,
    marginalContributionRub,
    closedDeals,
    managerNotes,
    extendedProbationEndsAt,
  })

  const employeeUpdateData = {
    probationOutcome: decision,
    ...(decision === 'extended' ? { probationEndsAt: extendedProbationEndsAt } : {}),
    ...(targetStatus ? { status: targetStatus } : {}),
  }

  const { updatedEmployee, lifecycleEvent } = await prisma.$transaction(async (tx) => {
    const updatedEmployee = await tx.employee.update({
      where: { id: employeeId },
      data: employeeUpdateData,
    })

    const lifecycleEvent = await tx.employeeLifecycleEvent.create({
      data: {
        tenantId,
        employeeId,
        type: probationDecisionLifecycleEvent(decision),
        fromStatus: employee.status,
        toStatus: targetStatus,
        effectiveAt: reviewedAt,
        actorUserId: actorUserId ?? null,
        payload,
        note: managerNotes ?? null,
      },
    })

    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action: 'employee.record_probation_review',
        entityType: 'Employee',
        entityId: employeeId,
        diff: {
          decision,
          fromStatus: employee.status,
          toStatus: targetStatus,
          review: payload,
        } satisfies Prisma.InputJsonValue,
      },
    })

    if (targetStatus === 'active') {
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: actorUserId ?? null,
          action: 'employee.confirm',
          entityType: 'Employee',
          entityId: employeeId,
          diff: { fromStatus: employee.status, toStatus: targetStatus, decision },
        },
      })
    }

    if (targetStatus === 'notice') {
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: actorUserId ?? null,
          action: 'employee.begin_notice',
          entityType: 'Employee',
          entityId: employeeId,
          diff: { fromStatus: employee.status, toStatus: targetStatus, decision },
        },
      })
    }

    return { updatedEmployee, lifecycleEvent }
  })

  const notifier = input.notifier ?? createNotifier(prisma)
  if (targetStatus === 'active') {
    const recipientUserIds = await listProbationStakeholderUserIds(prisma, tenantId, employee.userId)
    await Promise.all(
      recipientUserIds.map((userId) =>
        notifier.notify({
          channel: 'in_app',
          recipient: { tenantId, userId },
          template: 'employee.confirmed',
          payload: {
            employeeId: updatedEmployee.id,
            employeeName: updatedEmployee.fullName,
            probationEndsAt: updatedEmployee.probationEndsAt?.toISOString() ?? null,
          },
        }),
      ),
    )
  }

  return { employee: updatedEmployee, lifecycleEvent }
}

export async function sendProbationReminders(input: SendProbationRemindersInput) {
  const {
    prisma,
    today = new Date(),
    reminderDaysBefore = DEFAULT_PROBATION_REMINDER_DAYS_BEFORE,
  } = input

  const targetDayStart = addUtcDays(startOfUtcDay(today), reminderDaysBefore)
  const targetDayEnd = addUtcDays(targetDayStart, 1)

  const employees = await prisma.employee.findMany({
    where: {
      status: 'probation',
      probationEndsAt: {
        gte: targetDayStart,
        lt: targetDayEnd,
      },
    },
    select: {
      id: true,
      tenantId: true,
      fullName: true,
      probationEndsAt: true,
    },
  })

  if (employees.length === 0) {
    return { employeesMatched: 0, notificationsSent: 0 }
  }

  const notifier = input.notifier ?? createNotifier(prisma)
  const memberships = await prisma.userRole.findMany({
    where: {
      tenantId: { in: [...new Set(employees.map((employee) => employee.tenantId))] },
      role: { in: ['hr_admin', 'hiring_manager'] },
    },
    select: {
      tenantId: true,
      userId: true,
    },
  })

  const recipientsByTenant = new Map<string, Set<string>>()
  for (const membership of memberships) {
    const existing = recipientsByTenant.get(membership.tenantId) ?? new Set<string>()
    existing.add(membership.userId)
    recipientsByTenant.set(membership.tenantId, existing)
  }

  let notificationsSent = 0
  for (const employee of employees) {
    const recipientUserIds = [...(recipientsByTenant.get(employee.tenantId) ?? new Set<string>())]
    await Promise.all(
      recipientUserIds.map(async (userId) => {
        await notifier.notify({
          channel: 'in_app',
          recipient: { tenantId: employee.tenantId, userId },
          template: 'probation.reminder',
          payload: {
            employeeId: employee.id,
            employeeName: employee.fullName,
            probationEndsAt: employee.probationEndsAt?.toISOString() ?? null,
            reminderDaysBefore,
          },
        })
        notificationsSent += 1
      }),
    )
  }

  return { employeesMatched: employees.length, notificationsSent }
}

function probationDecisionTargetStatus(decision: ProbationReviewDecision) {
  if (decision === 'passed') return 'active' as const
  if (decision === 'failed') return 'notice' as const
  return null
}

function probationDecisionLifecycleEvent(decision: ProbationReviewDecision) {
  if (decision === 'passed') return 'probation_passed' as const
  if (decision === 'failed') return 'probation_failed' as const
  return 'probation_extended' as const
}

function buildProbationReviewPayload(input: {
  decision: ProbationReviewDecision
  periodStart?: Date | null
  periodEnd?: Date | null
  marginalContributionRub?: number | null
  closedDeals?: number | null
  managerNotes?: string | null
  extendedProbationEndsAt?: Date | null
}): Prisma.InputJsonValue {
  return {
    decision: input.decision,
    ...(input.periodStart ? { period_start: formatDateOnly(input.periodStart) } : {}),
    ...(input.periodEnd ? { period_end: formatDateOnly(input.periodEnd) } : {}),
    ...(input.marginalContributionRub != null
      ? { marginal_contribution_rub: input.marginalContributionRub }
      : {}),
    ...(input.closedDeals != null ? { closed_deals: input.closedDeals } : {}),
    ...(input.managerNotes ? { manager_notes: input.managerNotes } : {}),
    ...(input.extendedProbationEndsAt
      ? { extended_probation_ends_at: formatDateOnly(input.extendedProbationEndsAt) }
      : {}),
  }
}

async function listProbationStakeholderUserIds(
  prisma: DbClient,
  tenantId: string,
  employeeUserId?: string | null,
) {
  const memberships = await prisma.userRole.findMany({
    where: {
      tenantId,
      role: { in: ['hr_admin', 'hiring_manager'] },
    },
    select: {
      userId: true,
    },
  })

  const userIds = new Set(memberships.map((membership) => membership.userId))
  if (employeeUserId) {
    userIds.add(employeeUserId)
  }

  return [...userIds]
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}
