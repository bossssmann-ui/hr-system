import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../../db'
import {
  buildPayrollExport,
  computeRecruiterFunnel,
  computeHrSnapshot,
  payrollRowsToCsv,
} from './analytics.service'

function mkEmployee(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'emp',
    status: 'active',
    orgUnitId: 'org-a',
    hireDate: null,
    terminatedAt: null,
    probationOutcome: null,
    fullName: 'Test Employee',
    email: null,
    jobTitle: null,
    grade: null,
    currency: null,
    agreedBaseSalary: null,
    ...overrides,
  }
}

describe('computeHrSnapshot', () => {
  test('aggregates headcount, MTD, time-to-hire, probation pass rate and upserts the row', async () => {
    const now = new Date('2026-06-15T12:00:00.000Z')
    const monthStart = new Date(Date.UTC(2026, 5, 1))
    const quarterStart = new Date(Date.UTC(2026, 3, 1)) // Q2 starts Apr 1
    let upserted: unknown = null

    const prisma = {
      employee: {
        findMany: async () => [
          mkEmployee({ id: 'e1', status: 'active', orgUnitId: 'org-a' }),
          mkEmployee({ id: 'e2', status: 'active', orgUnitId: 'org-b' }),
          mkEmployee({
            id: 'e3',
            status: 'probation',
            orgUnitId: 'org-a',
            hireDate: new Date('2026-06-05T00:00:00.000Z'),
            probationOutcome: 'passed',
          }),
          mkEmployee({
            id: 'e4',
            status: 'terminated',
            orgUnitId: 'org-b',
            terminatedAt: new Date('2026-06-10T00:00:00.000Z'),
            hireDate: new Date('2026-05-01T00:00:00.000Z'),
            probationOutcome: 'failed',
          }),
          // hire in current quarter, decided pass — counts toward probation pool
          mkEmployee({
            id: 'e5',
            status: 'active',
            orgUnitId: 'org-a',
            hireDate: new Date('2026-04-20T00:00:00.000Z'),
            probationOutcome: 'passed',
          }),
        ],
      },
      hiringRequisition: {
        count: async ({ where }: { where: { status: { in: string[] } } }) => {
          expect(where.status.in).toContain('approved')
          return 3
        },
      },
      application: {
        findMany: async ({ where }: { where: { updatedAt: { gte: Date } } }) => {
          expect(where.updatedAt.gte.getTime()).toBe(monthStart.getTime())
          // 10-day TTH + 20-day TTH → avg 15
          return [
            {
              createdAt: new Date('2026-06-01T00:00:00.000Z'),
              updatedAt: new Date('2026-06-11T00:00:00.000Z'),
            },
            {
              createdAt: new Date('2026-05-15T00:00:00.000Z'),
              updatedAt: new Date('2026-06-04T00:00:00.000Z'),
            },
          ]
        },
      },
      engagementSurvey: {
        findFirst: async () => null,
      },
      surveyResponse: {
        findMany: async () => [],
      },
      hrSnapshot: {
        upsert: async (args: unknown) => {
          upserted = args
          return {}
        },
      },
    } as unknown as DbClient

    const result = await computeHrSnapshot({ prisma, tenantId: 't1', now })

    expect(result.headcount).toBe(4)
    expect(result.headcountByStatus).toEqual({ active: 3, probation: 1 })
    expect(result.headcountByOrgUnit).toEqual({ 'org-a': 3, 'org-b': 1 })
    expect(result.openRequisitions).toBe(3)
    expect(result.hiredMtd).toBe(1) // only e3 hired in June
    expect(result.terminatedMtd).toBe(1) // e4 terminated in June
    expect(result.avgTimeToHireDays).toBe(15)
    // probation pool (decided this quarter, hired in Q2):
    //   e3 (passed), e4 (failed, hired 2026-05-01), e5 (passed)
    //   = 3 decided, 2 passed → 66.67%
    expect(result.probationPassRateQtd).toBe(66.67)
    expect(result.snapshotDate).toBe('2026-06-15')
    expect(result.enpsScore).toBeNull()
    expect(upserted).not.toBeNull()
    // Sanity: upsert call uses the unique (tenant, date) key
    void quarterStart
  })

  test('returns null aggregates when there is no data', async () => {
    const prisma = {
      employee: { findMany: async () => [] },
      hiringRequisition: { count: async () => 0 },
      application: { findMany: async () => [] },
      engagementSurvey: { findFirst: async () => null },
      surveyResponse: { findMany: async () => [] },
      hrSnapshot: { upsert: async () => ({}) },
    } as unknown as DbClient

    const result = await computeHrSnapshot({
      prisma,
      tenantId: 't1',
      now: new Date('2026-06-15T00:00:00.000Z'),
    })
    expect(result.headcount).toBe(0)
    expect(result.avgTimeToHireDays).toBeNull()
    expect(result.probationPassRateQtd).toBeNull()
    expect(result.enpsScore).toBeNull()
  })

  test('enpsScore is computed from the last closed eNPS survey', async () => {
    // 4 promoters (9-10), 1 detractor (0-6) → eNPS = round(80 − 20) = 60
    const prisma = {
      employee: { findMany: async () => [] },
      hiringRequisition: { count: async () => 0 },
      application: { findMany: async () => [] },
      engagementSurvey: {
        findFirst: async () => ({ id: 'survey-1' }),
      },
      surveyResponse: {
        findMany: async () => [
          { score: 10 },
          { score: 9 },
          { score: 10 },
          { score: 9 },
          { score: 3 },
        ],
      },
      hrSnapshot: { upsert: async () => ({}) },
    } as unknown as DbClient

    const result = await computeHrSnapshot({
      prisma,
      tenantId: 't1',
      now: new Date('2026-06-15T00:00:00.000Z'),
    })
    // promoters=4 (80%), detractors=1 (20%) → 80−20 = 60
    expect(result.enpsScore).toBe(60)
  })

  test('enpsScore is null when closed survey has no responses', async () => {
    const prisma = {
      employee: { findMany: async () => [] },
      hiringRequisition: { count: async () => 0 },
      application: { findMany: async () => [] },
      engagementSurvey: {
        findFirst: async () => ({ id: 'survey-empty' }),
      },
      surveyResponse: {
        findMany: async () => [],
      },
      hrSnapshot: { upsert: async () => ({}) },
    } as unknown as DbClient

    const result = await computeHrSnapshot({
      prisma,
      tenantId: 't1',
      now: new Date('2026-06-15T00:00:00.000Z'),
    })
    expect(result.enpsScore).toBeNull()
  })
})

describe('buildPayrollExport', () => {
  test('rejects invalid month formats', async () => {
    const prisma = {
      employee: { findMany: async () => [] },
    } as unknown as DbClient
    await expect(
      buildPayrollExport({ prisma, tenantId: 't1', month: '2026/06' }),
    ).rejects.toThrow('month must be YYYY-MM')
  })

  test('includes active employees and excludes those terminated before period start', async () => {
    const prisma = {
      employee: {
        findMany: async ({ where }: { where: unknown }) => {
          void where
          return [
            {
              id: 'e1',
              fullName: 'Alice',
              email: 'a@x',
              jobTitle: 'Eng',
              orgUnitId: 'o1',
              status: 'active',
              grade: 'M3',
              currency: 'RUB',
              agreedBaseSalary: 100000,
              hireDate: new Date('2026-01-01T00:00:00.000Z'),
              terminatedAt: null,
            },
          ]
        },
      },
    } as unknown as DbClient

    const result = await buildPayrollExport({ prisma, tenantId: 't1', month: '2026-06' })
    expect(result.month).toBe('2026-06')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      employeeId: 'e1',
      fullName: 'Alice',
      baseSalary: 100000,
      currency: 'RUB',
      hireDate: '2026-01-01',
    })
  })
})

describe('payrollRowsToCsv', () => {
  test('serialises rows with header and quotes values containing commas / quotes', () => {
    const csv = payrollRowsToCsv([
      {
        employeeId: 'e1',
        fullName: 'Smith, John',
        email: null,
        jobTitle: 'CEO "Big"',
        orgUnitId: null,
        status: 'active',
        grade: null,
        currency: 'RUB',
        baseSalary: 200000,
        hireDate: '2026-01-01',
        terminatedAt: null,
      },
    ])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toContain('employee_id')
    expect(lines[1]).toContain('"Smith, John"')
    expect(lines[1]).toContain('"CEO ""Big"""')
    expect(lines[1]).toContain('200000')
  })
})

describe('computeRecruiterFunnel', () => {
  test('calculates weekly funnel counters and processed candidates', async () => {
    const now = new Date('2026-06-18T10:00:00.000Z')
    const prisma = {
      application: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          if ('id' in where) {
            // Second call: apps by ID for processedCandidates
            return [
              { id: 'app-1', candidateId: 'cand-1', aiScore: 73, createdAt: new Date('2026-06-16T10:00:00.000Z') },
              { id: 'app-2', candidateId: 'cand-2', aiScore: null, createdAt: new Date('2026-06-17T10:00:00.000Z') },
            ]
          }
          // First call: all apps in period (for source/newApplications counting)
          return [
            { id: 'app-1', externalIds: {} },
            { id: 'app-2', externalIds: {} },
            { id: 'app-3', externalIds: {} },
            { id: 'app-4', externalIds: {} },
          ]
        },
      },
      selectionSession: {
        findMany: async () => [
          {
            id: 's-1',
            applicationId: 'app-1',
            createdAt: new Date('2026-06-16T10:00:00.000Z'),
            verdict: {
              verdict: 'ДОПУСТИТЬ',
              totalWeightedScore: 88,
              retentionPrediction: { survival90: 0.8 },
              hrNotes: 'Сильный кандидат',
            },
          },
          {
            id: 's-2',
            applicationId: 'app-2',
            createdAt: new Date('2026-06-17T10:00:00.000Z'),
            verdict: {
              verdict: 'НА РУЧНУЮ ПРОВЕРКУ HR',
              totalWeightedScore: null,
              retentionPrediction: null,
              hrNotes: 'Проверить детали',
            },
          },
          {
            id: 's-3',
            applicationId: 'app-3',
            createdAt: new Date('2026-06-17T11:00:00.000Z'),
            verdict: {
              verdict: 'ОТКЛОНИТЬ',
              totalWeightedScore: 40,
              retentionPrediction: null,
              hrNotes: null,
            },
          },
          {
            id: 's-4',
            applicationId: 'app-4',
            createdAt: new Date('2026-06-17T12:00:00.000Z'),
            verdict: null,
          },
        ],
      },
      assessmentSession: {
        findMany: async () => [
          {
            applicationId: 'app-1',
            trustScore: 91,
            createdAt: new Date('2026-06-17T12:30:00.000Z'),
          },
          {
            applicationId: 'app-2',
            trustScore: 67,
            createdAt: new Date('2026-06-17T13:30:00.000Z'),
          },
        ],
      },
    } as unknown as DbClient

    const result = await computeRecruiterFunnel({
      prisma,
      tenantId: 'tenant-1',
      period: 'week',
      now,
    })

    expect(result.newApplications).toBe(4)
    expect(result.aiProcessed).toBe(3)
    expect(result.passedToRecruiter).toBe(1)
    expect(result.aiRejected).toBe(1)
    expect(result.manualReview).toBe(1)
    expect(result.inProgress).toBe(1)
    expect(result.processedCandidates).toHaveLength(3)
    expect(result.processedCandidates[0]).toMatchObject({
      applicationId: 'app-1',
      scoreStatus: 'final',
      trustScore: 91,
      verdict: 'ДОПУСТИТЬ',
    })
  })

  test('returns empty funnel for tenant without data', async () => {
    const prisma = {
      application: {
        findMany: async () => [],
      },
      selectionSession: {
        findMany: async () => [],
      },
      assessmentSession: {
        findMany: async () => [],
      },
    } as unknown as DbClient

    const result = await computeRecruiterFunnel({
      prisma,
      tenantId: 'tenant-empty',
      period: 'today',
      now: new Date('2026-06-18T10:00:00.000Z'),
    })

    expect(result).toMatchObject({
      newApplications: 0,
      aiProcessed: 0,
      passedToRecruiter: 0,
      aiRejected: 0,
      manualReview: 0,
      inProgress: 0,
    })
    expect(result.processedCandidates).toEqual([])
    expect(result.bySource).toEqual({})
  })

  test('bySource: hh_* externalIds → hh bucket, others → direct; sums match overall counters', async () => {
    const now = new Date('2026-06-18T10:00:00.000Z')
    const prisma = {
      application: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          if ('id' in where) {
            return [
              { id: 'app-hh', candidateId: 'cand-hh', aiScore: null, createdAt: new Date('2026-06-16T10:00:00.000Z') },
              { id: 'app-direct', candidateId: 'cand-d', aiScore: null, createdAt: new Date('2026-06-16T11:00:00.000Z') },
            ]
          }
          // All apps in period: 2 HH, 2 direct
          return [
            { id: 'app-hh', externalIds: { hh_negotiation_id: '123' } },
            { id: 'app-hh2', externalIds: { hh_resume_id: '456' } },
            { id: 'app-direct', externalIds: {} },
            { id: 'app-direct2', externalIds: {} },
          ]
        },
      },
      selectionSession: {
        findMany: async () => [
          {
            id: 's-hh',
            applicationId: 'app-hh',
            createdAt: new Date('2026-06-16T10:00:00.000Z'),
            verdict: { verdict: 'ДОПУСТИТЬ', totalWeightedScore: 90, retentionPrediction: null, hrNotes: null },
          },
          {
            id: 's-direct',
            applicationId: 'app-direct',
            createdAt: new Date('2026-06-16T11:00:00.000Z'),
            verdict: { verdict: 'ОТКЛОНИТЬ', totalWeightedScore: 30, retentionPrediction: null, hrNotes: null },
          },
          {
            id: 's-direct2',
            applicationId: 'app-direct2',
            createdAt: new Date('2026-06-16T12:00:00.000Z'),
            verdict: null,
          },
        ],
      },
      assessmentSession: {
        findMany: async () => [],
      },
    } as unknown as DbClient

    const result = await computeRecruiterFunnel({ prisma, tenantId: 'tenant-src', period: 'week', now })

    // Overall counters
    expect(result.newApplications).toBe(4)
    expect(result.aiProcessed).toBe(2)
    expect(result.passedToRecruiter).toBe(1)
    expect(result.aiRejected).toBe(1)
    expect(result.inProgress).toBe(1)

    // bySource exists and has hh + direct
    expect(result.bySource.hh).toBeDefined()
    expect(result.bySource.direct).toBeDefined()

    // HH bucket: 2 apps, 1 processed (passed), 0 rejected, 0 inProgress
    expect(result.bySource.hh.applications).toBe(2)
    expect(result.bySource.hh.aiProcessed).toBe(1)
    expect(result.bySource.hh.passedToRecruiter).toBe(1)
    expect(result.bySource.hh.aiRejected).toBe(0)
    expect(result.bySource.hh.inProgress).toBe(0)

    // Direct bucket: 2 apps, 1 processed (rejected), 1 inProgress
    expect(result.bySource.direct.applications).toBe(2)
    expect(result.bySource.direct.aiProcessed).toBe(1)
    expect(result.bySource.direct.passedToRecruiter).toBe(0)
    expect(result.bySource.direct.aiRejected).toBe(1)
    expect(result.bySource.direct.inProgress).toBe(1)

    // Sums across sources match overall counters
    const totalApps = Object.values(result.bySource).reduce((s, v) => s + v.applications, 0)
    const totalProcessed = Object.values(result.bySource).reduce((s, v) => s + v.aiProcessed, 0)
    const totalPassed = Object.values(result.bySource).reduce((s, v) => s + v.passedToRecruiter, 0)
    const totalInProgress = Object.values(result.bySource).reduce((s, v) => s + v.inProgress, 0)
    expect(totalApps).toBe(result.newApplications)
    expect(totalProcessed).toBe(result.aiProcessed)
    expect(totalPassed).toBe(result.passedToRecruiter)
    expect(totalInProgress).toBe(result.inProgress)
  })
})
