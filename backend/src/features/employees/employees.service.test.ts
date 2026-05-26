/**
 * Unit tests for employees.service — Phase 4.3.
 * Spec: docs/employee-lifecycle-design.md §1.2.
 */

import { describe, expect, test } from 'bun:test'

import type { Role } from '../requisitions/requisitions.fsm'
import {
  createFromApplication,
  recordProbationReview,
  sendProbationReminders,
} from './employees.service'

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function createPrismaMock(opts: { hasInterview?: boolean; hasOfferDraft?: boolean } = {}) {
  const { hasInterview = true, hasOfferDraft = true } = opts

  const state = {
    employee: null as Record<string, unknown> | null,
    auditEvents: [] as Array<Record<string, unknown>>,
  }

  const application = {
    id: 'app-1',
    tenantId: 'tenant-1',
    candidateId: 'cand-1',
    candidate: {
      id: 'cand-1',
      fullName: 'Иван Иванов',
      email: 'ivan@example.com',
      phone: '+79001234567',
    },
    vacancy: {
      id: 'vac-1',
      title: 'Логист-экспедитор',
      orgUnitId: 'org-1',
      requisition: {
        id: 'req-1',
        grade: 'M2',
        currency: 'RUB',
        salaryMin: 100000,
        salaryMax: 150000,
      },
    },
  }

  const interview = hasInterview
    ? {
        offerDraft: hasOfferDraft
          ? {
              salary: 130000,
              currency: 'RUB',
              start_date: '2026-07-01',
              grade: 'M3',
              conditions: [],
              status: 'draft',
            }
          : null,
      }
    : null

  const prisma = {
    employee: {
      findUnique: async ({ where }: { where: { applicationId: string } }) => {
        if (state.employee && state.employee.applicationId === where.applicationId)
          return state.employee
        return null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: 'emp-1', ...data }
        state.employee = created
        return created
      },
    },
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        return where.id === application.id && where.tenantId === application.tenantId
          ? application
          : null
      },
    },
    interview: {
      findFirst: async () => interview,
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
      },
    },
  }

  return { prisma, state }
}

function createProbationReviewPrismaMock(
  overrides: {
    employee?: Record<string, unknown>
    memberships?: Array<{ tenantId: string; userId: string; role: Role }>
  } = {},
) {
  const state = {
    employee: {
      id: 'emp-1',
      tenantId: 'tenant-1',
      userId: 'employee-user',
      fullName: 'Иван Иванов',
      status: 'probation',
      probationEndsAt: new Date('2026-06-30T00:00:00.000Z'),
      probationOutcome: null,
      ...overrides.employee,
    } as Record<string, unknown>,
    lifecycleEvents: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    memberships:
      overrides.memberships ?? [
        { tenantId: 'tenant-1', userId: 'manager-user', role: 'hiring_manager' },
        { tenantId: 'tenant-1', userId: 'hr-user', role: 'hr_admin' },
      ],
  }

  const prisma = {
    employee: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === state.employee.id && where.tenantId === state.employee.tenantId
          ? state.employee
          : null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (where.id !== state.employee.id) throw new Error('employee not found')
        state.employee = { ...state.employee, ...data }
        return state.employee
      },
      findMany: async () => [state.employee],
    },
    employeeLifecycleEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.lifecycleEvents.push(data)
        return data
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
        return data
      },
    },
    userRole: {
      findMany: async ({
        where,
      }: {
        where: { tenantId: string | { in: string[] }; role: { in: Role[] } }
      }) => {
        const tenantIds =
          typeof where.tenantId === 'string' ? [where.tenantId] : where.tenantId.in
        return state.memberships
          .filter(
            (membership) =>
              tenantIds.includes(membership.tenantId) && where.role.in.includes(membership.role),
          )
          .map(({ tenantId, userId }) => ({ tenantId, userId }))
      },
    },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.notifications.push(data)
        return data
      },
    },
    $transaction: async <T>(callback: (tx: Record<string, unknown>) => Promise<T>) =>
      callback(prisma as unknown as Record<string, unknown>),
  }

  return { prisma, state }
}

function createProbationReminderPrismaMock() {
  const state = {
    employees: [
      {
        id: 'emp-match',
        tenantId: 'tenant-1',
        fullName: 'Мария Логист',
        status: 'probation',
        probationEndsAt: new Date('2026-06-08T18:15:00.000Z'),
      },
      {
        id: 'emp-late',
        tenantId: 'tenant-1',
        fullName: 'Пётр Логист',
        status: 'probation',
        probationEndsAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    ] as Array<Record<string, unknown>>,
    memberships: [
      { tenantId: 'tenant-1', userId: 'manager-user', role: 'hiring_manager' as const },
      { tenantId: 'tenant-1', userId: 'hr-user', role: 'hr_admin' as const },
      { tenantId: 'tenant-1', userId: 'manager-user', role: 'hr_admin' as const },
    ],
    notifications: [] as Array<Record<string, unknown>>,
  }

  const prisma = {
    employee: {
      findMany: async ({
        where,
      }: {
        where: {
          status: string
          probationEndsAt: { gte: Date; lt: Date }
        }
      }) =>
        state.employees.filter((employee) => {
          const probationEndsAt = employee.probationEndsAt as Date | null
          return (
            employee.status === where.status &&
            probationEndsAt !== null &&
            probationEndsAt >= where.probationEndsAt.gte &&
            probationEndsAt < where.probationEndsAt.lt
          )
        }),
    },
    userRole: {
      findMany: async ({
        where,
      }: {
        where: { tenantId: { in: string[] }; role: { in: Role[] } }
      }) =>
        state.memberships
          .filter(
            (membership) =>
              where.tenantId.in.includes(membership.tenantId) &&
              where.role.in.includes(membership.role),
          )
          .map(({ tenantId, userId }) => ({ tenantId, userId })),
    },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.notifications.push(data)
        return data
      },
    },
  }

  return { prisma, state }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createFromApplication', () => {
  test('creates Employee with snapshotted data', async () => {
    const { prisma, state } = createPrismaMock()

    const employee = await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(employee).toBeTruthy()
    expect(state.employee).toBeTruthy()
    expect(state.employee!.applicationId).toBe('app-1')
    expect(state.employee!.candidateId).toBe('cand-1')
    expect(state.employee!.requisitionId).toBe('req-1')
    expect(state.employee!.orgUnitId).toBe('org-1')
    expect(state.employee!.fullName).toBe('Иван Иванов')
    expect(state.employee!.email).toBe('ivan@example.com')
    expect(state.employee!.phone).toBe('+79001234567')
    expect(state.employee!.jobTitle).toBe('Логист-экспедитор')
    expect(state.employee!.status).toBe('pre_onboarding')
  })

  test('snapshots grade, currency, salary, start date from offer draft', async () => {
    const { prisma, state } = createPrismaMock({ hasInterview: true, hasOfferDraft: true })

    await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    // offer draft overrides requisition values
    expect(state.employee!.grade).toBe('M3')
    expect(state.employee!.currency).toBe('RUB')
    expect(state.employee!.agreedBaseSalary).toBe(130000)
    expect(state.employee!.agreedStartDate).toEqual(new Date('2026-07-01'))
  })

  test('falls back to requisition grade and currency when no offer draft', async () => {
    const { prisma, state } = createPrismaMock({ hasInterview: false })

    await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(state.employee!.grade).toBe('M2')
    expect(state.employee!.currency).toBe('RUB')
    expect(state.employee!.agreedBaseSalary).toBeNull()
    expect(state.employee!.agreedStartDate).toBeNull()
  })

  test('writes employee.created audit event with via=hired_application', async () => {
    const { prisma, state } = createPrismaMock()

    await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(state.auditEvents).toHaveLength(1)
    const audit = state.auditEvents[0]!
    expect(audit.action).toBe('employee.created')
    expect(audit.entityType).toBe('Employee')
    expect(audit.actorUserId).toBe('user-1')
    expect((audit.diff as Record<string, unknown>).via).toBe('hired_application')
    expect((audit.diff as Record<string, unknown>).applicationId).toBe('app-1')
  })

  test('is idempotent — returns existing employee without creating duplicate', async () => {
    const { prisma, state } = createPrismaMock()

    // First call: creates the employee
    const first = await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    // Second call: must return the existing employee, not write a second audit
    const second = await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      tenantId: 'tenant-1',
    })

    expect(first.id).toBe(second.id)
    // Audit event written only once
    expect(state.auditEvents).toHaveLength(1)
  })

  test('actorUserId is nullable (supports system/queue callers)', async () => {
    const { prisma, state } = createPrismaMock()

    await createFromApplication({
      prisma: prisma as never,
      applicationId: 'app-1',
      tenantId: 'tenant-1',
    })

    expect(state.auditEvents[0]!.actorUserId).toBeNull()
  })

  test('throws when application is not found', async () => {
    const { prisma } = createPrismaMock()

    await expect(
      createFromApplication({
        prisma: prisma as never,
        applicationId: 'nonexistent',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow('not found')
  })
})

describe('recordProbationReview', () => {
  test('records review inputs and transitions probation -> active when decision is passed', async () => {
    const { prisma, state } = createProbationReviewPrismaMock()

    const result = await recordProbationReview({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      actorRoles: ['hiring_manager'],
      actorUserId: 'manager-user',
      decision: 'passed',
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-30T00:00:00.000Z'),
      marginalContributionRub: 245000,
      closedDeals: 4,
      managerNotes: 'План выполнен',
      reviewedAt: new Date('2026-06-30T12:00:00.000Z'),
    })

    expect(result.employee.status).toBe('active')
    expect(result.employee.probationOutcome).toBe('passed')
    expect(state.lifecycleEvents).toHaveLength(1)
    expect(state.lifecycleEvents[0]!.type).toBe('probation_passed')
    expect(state.lifecycleEvents[0]!.fromStatus).toBe('probation')
    expect(state.lifecycleEvents[0]!.toStatus).toBe('active')
    expect(state.lifecycleEvents[0]!.payload).toEqual({
      decision: 'passed',
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      marginal_contribution_rub: 245000,
      closed_deals: 4,
      manager_notes: 'План выполнен',
    })
    expect(state.auditEvents.map((event) => event.action)).toEqual([
      'employee.record_probation_review',
      'employee.confirm',
    ])
    expect(state.notifications).toHaveLength(3)
    expect(state.notifications.every((notification) => notification.template === 'employee.confirmed')).toBe(true)
  })

  test('records review inputs and transitions probation -> notice when decision is failed', async () => {
    const { prisma, state } = createProbationReviewPrismaMock({
      employee: { userId: null },
    })

    const result = await recordProbationReview({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      actorRoles: ['hr_admin'],
      actorUserId: 'hr-user',
      decision: 'failed',
      marginalContributionRub: 150000,
      closedDeals: 1,
      managerNotes: 'Нужен выход из роли',
    })

    expect(result.employee.status).toBe('notice')
    expect(result.employee.probationOutcome).toBe('failed')
    expect(state.lifecycleEvents[0]!.type).toBe('probation_failed')
    expect(state.auditEvents.map((event) => event.action)).toEqual([
      'employee.record_probation_review',
      'employee.begin_notice',
    ])
    expect(state.notifications).toHaveLength(0)
  })

  test('records extension inputs without leaving probation', async () => {
    const { prisma, state } = createProbationReviewPrismaMock()

    const result = await recordProbationReview({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      actorRoles: ['owner'],
      actorUserId: 'owner-user',
      decision: 'extended',
      extendedProbationEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      managerNotes: 'Продлить на 2 недели',
    })

    expect(result.employee.status).toBe('probation')
    expect(result.employee.probationOutcome).toBe('extended')
    expect(result.employee.probationEndsAt).toEqual(new Date('2026-07-15T00:00:00.000Z'))
    expect(state.lifecycleEvents[0]!.type).toBe('probation_extended')
    expect(state.lifecycleEvents[0]!.toStatus).toBeNull()
    expect(state.auditEvents.map((event) => event.action)).toEqual(['employee.record_probation_review'])
  })

  test('rejects review when actor is not allowed to drive probation outcome', async () => {
    const { prisma } = createProbationReviewPrismaMock()

    await expect(
      recordProbationReview({
        prisma: prisma as never,
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        actorRoles: ['recruiter'],
        decision: 'passed',
      }),
    ).rejects.toThrow('not allowed')
  })
})

describe('sendProbationReminders', () => {
  test('notifies hr_admin and hiring_manager N days before probation end date once per recipient', async () => {
    const { prisma, state } = createProbationReminderPrismaMock()

    const result = await sendProbationReminders({
      prisma: prisma as never,
      today: new Date('2026-06-01T10:00:00.000Z'),
      reminderDaysBefore: 7,
    })

    expect(result).toEqual({ employeesMatched: 1, notificationsSent: 2 })
    expect(state.notifications).toHaveLength(2)
    expect(state.notifications.every((notification) => notification.template === 'probation.reminder')).toBe(true)
    expect(state.notifications.map((notification) => notification.recipientUserId).sort()).toEqual(
      ['hr-user', 'manager-user'],
    )
    expect(state.notifications[0]!.payload).toMatchObject({
      employeeId: 'emp-match',
      employeeName: 'Мария Логист',
      reminderDaysBefore: 7,
    })
  })
})
