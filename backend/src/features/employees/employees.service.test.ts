/**
 * Unit tests for employees.service — Phase 4.3.
 * Spec: docs/employee-lifecycle-design.md §1.2.
 */

import { describe, expect, test } from 'bun:test'

import { createFromApplication } from './employees.service'

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
