/**
 * Phase 12 — focused unit tests for tenant.service.
 *
 * Keeps the same shape as other backend feature tests (pure JS Prisma mock,
 * no DB), so the suite runs in the same `test:unit` pass.
 */
import { describe, expect, test } from 'bun:test'

import {
  ANON_NAME,
  eraseCandidate,
  exportCandidateData,
  exportEmployeeData,
  getBillingStatus,
  hashEmail,
  runDataRetention,
} from './tenant.service'

type Row = Record<string, unknown>

function createPrismaMock(initial?: {
  candidates?: Row[]
  applications?: Row[]
  resumes?: Row[]
  employees?: Row[]
  policies?: Row[]
  conversations?: Row[]
  subscriptions?: Row[]
  plans?: Row[]
  userRoles?: Row[]
  auditEvents?: Row[]
}) {
  const state = {
    candidates: initial?.candidates ?? [],
    applications: initial?.applications ?? [],
    resumes: initial?.resumes ?? [],
    employees: initial?.employees ?? [],
    policies: initial?.policies ?? [],
    conversations: initial?.conversations ?? [],
    subscriptions: initial?.subscriptions ?? [],
    plans: initial?.plans ?? [],
    userRoles: initial?.userRoles ?? [],
    auditEvents: initial?.auditEvents ?? [],
  }

  const match = (row: Row, where: Row): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'NOT') {
        if (match(row, v as Row)) return false
        continue
      }
      if (k === 'applications') {
        // we only implement `none: {}` here
        const target = (v as { none?: Row }).none
        if (target !== undefined) {
          const rels = state.applications.filter((a) => a.candidateId === row.id)
          if (rels.length > 0) return false
        }
        continue
      }
      const fieldValue = row[k]
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        const ops = v as Record<string, unknown>
        for (const [op, opv] of Object.entries(ops)) {
          if (op === 'lt' && !(fieldValue instanceof Date && opv instanceof Date && fieldValue < opv)) return false
          if (op === 'not' && fieldValue === opv) return false
        }
      } else if (fieldValue !== v) {
        return false
      }
    }
    return true
  }

  const prisma = {
    candidate: {
      findFirst: async ({ where }: { where: Row }) =>
        state.candidates.find((c) => match(c, where)) ?? null,
      findMany: async ({ where }: { where?: Row } = {}) =>
        state.candidates.filter((c) => (where ? match(c, where) : true)),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const c = state.candidates.find((x) => x.id === where.id)!
        Object.assign(c, data)
        return c
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.candidates = state.candidates.filter((c) => c.id !== where.id)
        return {}
      },
      count: async () => state.candidates.length,
    },
    application: {
      findMany: async ({ where }: { where: Row }) =>
        state.applications.filter((a) => match(a, where)),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const a = state.applications.find((x) => x.id === where.id)!
        Object.assign(a, data)
        return a
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.applications = state.applications.filter((a) => a.id !== where.id)
        return {}
      },
    },
    resume: {
      findMany: async ({ where }: { where: Row }) =>
        state.resumes.filter((r) => match(r, where)),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const r = state.resumes.find((x) => x.id === where.id)!
        Object.assign(r, data)
        return r
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const r of state.resumes) {
          if (match(r, where)) {
            Object.assign(r, data)
            count++
          }
        }
        return { count }
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.resumes = state.resumes.filter((r) => r.id !== where.id)
        return {}
      },
    },
    employee: {
      findFirst: async ({ where }: { where: Row }) =>
        state.employees.find((e) => match(e, where)) ?? null,
      findMany: async ({ where }: { where: Row }) =>
        state.employees.filter((e) => match(e, where)),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const e = state.employees.find((x) => x.id === where.id)!
        Object.assign(e, data)
        return e
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.employees = state.employees.filter((e) => e.id !== where.id)
        return {}
      },
      count: async ({ where }: { where?: Row } = {}) =>
        state.employees.filter((e) => (where ? match(e, where) : true)).length,
    },
    dataRetentionPolicy: {
      findMany: async () => state.policies,
    },
    subscription: {
      findUnique: async ({ where }: { where: { tenantId: string } }) => {
        const sub = state.subscriptions.find((s) => s.tenantId === where.tenantId)
        if (!sub) return null
        const plan = state.plans.find((p) => p.id === sub.planId)
        return { ...sub, plan }
      },
    },
    userRole: {
      findMany: async ({ distinct }: { distinct?: string[] } = {}) => {
        if (distinct?.includes('userId')) {
          const seen = new Set<unknown>()
          return state.userRoles.filter((r) => {
            if (seen.has(r.userId)) return false
            seen.add(r.userId)
            return true
          })
        }
        return state.userRoles
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Row }) => {
        state.auditEvents.push(data)
        return data
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }

  return { prisma, state }
}

describe('hashEmail', () => {
  test('produces stable sha256 hash with case folding', () => {
    expect(hashEmail('Foo@Example.com')).toBe(hashEmail('foo@example.com'))
    expect(hashEmail('a@b')).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('eraseCandidate', () => {
  test('anonymises PII fields and writes AuditEvent(candidate.pii_erased)', async () => {
    const { prisma, state } = createPrismaMock({
      candidates: [
        {
          id: 'cand-1',
          tenantId: 't1',
          fullName: 'Иван Иванов',
          email: 'ivan@example.com',
          phone: '+79991234567',
          location: 'Moscow',
        },
      ],
      resumes: [{ id: 'res-1', tenantId: 't1', candidateId: 'cand-1', deletedAt: null }],
    })

    await eraseCandidate(prisma as never, { tenantId: 't1', candidateId: 'cand-1', actorUserId: 'u1' })

    const cand = state.candidates[0]!
    expect(cand.fullName).toBe(ANON_NAME)
    expect(String(cand.email)).toMatch(/^sha256:/)
    expect(cand.phone).toBeNull()
    expect(state.resumes[0]!.deletedAt).not.toBeNull()
    expect(state.auditEvents[0]!.action).toBe('candidate.pii_erased')
  })

  test('throws NOT_FOUND when candidate is in another tenant', async () => {
    const { prisma } = createPrismaMock({
      candidates: [{ id: 'cand-1', tenantId: 't-other', fullName: 'X' }],
    })
    await expect(
      eraseCandidate(prisma as never, { tenantId: 't1', candidateId: 'cand-1', actorUserId: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('runDataRetention', () => {
  test('anonymises stale candidates without applications and logs audit event', async () => {
    const oldDate = new Date('2020-01-01T00:00:00Z')
    const { prisma, state } = createPrismaMock({
      policies: [
        { id: 'p1', tenantId: 't1', entityType: 'candidate', retainDays: 90, anonymize: true },
      ],
      candidates: [
        { id: 'c-old', tenantId: 't1', createdAt: oldDate, fullName: 'Old', email: 'old@x.io', phone: '1' },
        { id: 'c-new', tenantId: 't1', createdAt: new Date(), fullName: 'New', email: 'new@x.io' },
      ],
    })

    const result = await runDataRetention(prisma as never, { tenantId: 't1', now: new Date() })

    expect(result.processedCandidates).toBe(1)
    expect(state.candidates.find((c) => c.id === 'c-old')!.fullName).toBe(ANON_NAME)
    expect(state.candidates.find((c) => c.id === 'c-new')!.fullName).toBe('New')
    expect(state.auditEvents.find((e) => e.action === 'data_retention.run')).toBeDefined()
  })

  test('skips audit_event policies', async () => {
    const { prisma, state } = createPrismaMock({
      policies: [{ entityType: 'audit_event', retainDays: 30, anonymize: false }],
    })
    const result = await runDataRetention(prisma as never, { tenantId: 't1' })
    expect(result.processedCandidates).toBe(0)
    // The end-of-run AuditEvent must still be written.
    expect(state.auditEvents).toHaveLength(1)
  })

  test('deletes (does not anonymise) when policy has anonymize=false', async () => {
    const { prisma, state } = createPrismaMock({
      policies: [
        { entityType: 'candidate', retainDays: 30, anonymize: false },
      ],
      candidates: [
        { id: 'c1', tenantId: 't1', createdAt: new Date('2020-01-01'), fullName: 'Y', email: 'y@x' },
      ],
    })
    await runDataRetention(prisma as never, { tenantId: 't1', now: new Date() })
    expect(state.candidates).toHaveLength(0)
  })
})

describe('exportCandidateData / exportEmployeeData', () => {
  test('candidate export returns nested resources with ISO timestamps', async () => {
    const { prisma } = createPrismaMock()
    ;(prisma as unknown as { candidate: { findFirst: unknown } }).candidate.findFirst = async () => ({
      id: 'c1',
      tenantId: 't1',
      fullName: 'A',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      applications: [{ id: 'a1', stage: 'new', stageEvents: [] }],
      resumes: [{ id: 'r1', uploadedAt: new Date('2026-01-02T00:00:00Z') }],
      conversations: [{ id: 'conv-1', messages: [{ id: 'm1', body: 'hi' }] }],
    })

    const out = await exportCandidateData(prisma as never, { tenantId: 't1', candidateId: 'c1' })
    expect(out.candidate.id).toBe('c1')
    expect(out.applications).toHaveLength(1)
    expect(out.resumes[0]?.id).toBe('r1')
    expect(out.messages[0]?.body).toBe('hi')
    expect(out.candidate.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('employee export collects lifecycle + onboarding + documents', async () => {
    const { prisma } = createPrismaMock()
    ;(prisma as unknown as { employee: { findFirst: unknown } }).employee.findFirst = async () => ({
      id: 'e1',
      tenantId: 't1',
      fullName: 'E',
      lifecycleEvents: [{ id: 'l1', type: 'hired' }],
      documents: [{ id: 'd1' }],
      checklists: [{ id: 'cl1', tasks: [] }],
      offboardingChecklists: [],
    })

    const out = await exportEmployeeData(prisma as never, { tenantId: 't1', employeeId: 'e1' })
    expect(out.lifecycleEvents).toHaveLength(1)
    expect(out.documents).toHaveLength(1)
    expect(out.onboarding).toHaveLength(1)
  })
})

describe('getBillingStatus', () => {
  test('returns usage counts and plan info when subscription exists', async () => {
    const { prisma } = createPrismaMock({
      plans: [{ id: 'plan-1', name: 'growth', maxEmployees: 100, maxUsers: 20, priceRubMonthly: 19900 }],
      subscriptions: [
        { id: 'sub-1', tenantId: 't1', planId: 'plan-1', status: 'active', currentPeriodEnd: null },
      ],
      employees: [
        { id: 'e1', tenantId: 't1', status: 'active' },
        { id: 'e2', tenantId: 't1', status: 'terminated' },
      ],
      userRoles: [
        { userId: 'u1', tenantId: 't1' },
        { userId: 'u1', tenantId: 't1' },
        { userId: 'u2', tenantId: 't1' },
      ],
    })

    const status = await getBillingStatus(prisma as never, { tenantId: 't1', billingEnabled: true })
    expect(status.enabled).toBe(true)
    expect(status.plan?.name).toBe('growth')
    expect(status.subscription?.status).toBe('active')
    expect(status.usage.users).toBe(2)
  })

  test('returns null plan/subscription when none attached and enabled=false', async () => {
    const { prisma } = createPrismaMock()
    const status = await getBillingStatus(prisma as never, { tenantId: 't1', billingEnabled: false })
    expect(status.plan).toBeNull()
    expect(status.subscription).toBeNull()
    expect(status.enabled).toBe(false)
  })
})
