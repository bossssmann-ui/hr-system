import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../../db'
import {
  buildPayrollExport,
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
    expect(upserted).not.toBeNull()
    // Sanity: upsert call uses the unique (tenant, date) key
    void quarterStart
  })

  test('returns null aggregates when there is no data', async () => {
    const prisma = {
      employee: { findMany: async () => [] },
      hiringRequisition: { count: async () => 0 },
      application: { findMany: async () => [] },
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
