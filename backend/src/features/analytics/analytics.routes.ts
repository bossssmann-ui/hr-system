/**
 * Phase 7 — HR Analytics & Finance routes.
 *
 *   GET  /api/analytics/snapshots                — list historical HrSnapshots
 *   GET  /api/analytics/snapshots/latest         — most recent snapshot
 *   POST /api/analytics/snapshots/compute        — manually trigger snapshot
 *   GET  /api/analytics/dashboard                — live KPI dashboard
 *   GET  /api/payroll/export                     — JSON or CSV payroll export
 *
 * All endpoints are HR admin / owner scoped. Read endpoints additionally
 * include `hiring_manager` so managers can consult their org's KPIs.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  hrDashboardSchema,
  hrSnapshotSchema,
  listHrSnapshotsResponseSchema,
  payrollExportQuerySchema,
  payrollExportResponseSchema,
} from '@web-app-demo/contracts'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  buildPayrollExport,
  computeRecruiterFunnel,
  computeHrSnapshot,
  payrollRowsToCsv,
} from './analytics.service'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient; auditEntry?: unknown }
}

type DecimalLike = { toString: () => string }
function decimalToNumber(value: DecimalLike | number | string | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  const n = Number(typeof value === 'string' ? value : value.toString())
  return Number.isFinite(n) ? n : null
}

function snapshotToDto(row: {
  id: string
  tenantId: string
  snapshotDate: Date
  headcount: number
  headcountByStatus: unknown
  headcountByOrgUnit: unknown
  openRequisitions: number
  hiredMtd: number
  terminatedMtd: number
  avgTimeToHireDays: DecimalLike | null
  probationPassRateQtd: DecimalLike | null
  createdAt: Date
}) {
  return hrSnapshotSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    snapshotDate: row.snapshotDate.toISOString().slice(0, 10),
    headcount: row.headcount,
    headcountByStatus: (row.headcountByStatus ?? {}) as Record<string, number>,
    headcountByOrgUnit: (row.headcountByOrgUnit ?? {}) as Record<string, number>,
    openRequisitions: row.openRequisitions,
    hiredMtd: row.hiredMtd,
    terminatedMtd: row.terminatedMtd,
    avgTimeToHireDays: decimalToNumber(row.avgTimeToHireDays),
    probationPassRateQtd: decimalToNumber(row.probationPassRateQtd),
    createdAt: row.createdAt.toISOString(),
  })
}

export function createAnalyticsRoutes() {
  const app = new Hono<RouteBindings>()

  // ── List snapshots (default: last 30) ────────────────────────────────────
  app.get(
    '/snapshots',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    zValidator(
      'query',
      z.object({
        limit: z.coerce.number().int().min(1).max(365).default(30),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { limit, from, to } = c.req.valid('query')
      const rows = await prisma.hrSnapshot.findMany({
        where: {
          tenantId,
          ...(from || to
            ? {
                snapshotDate: {
                  ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                  ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
                },
              }
            : {}),
        },
        orderBy: { snapshotDate: 'desc' },
        take: limit,
      })
      return c.json(listHrSnapshotsResponseSchema.parse({ items: rows.map(snapshotToDto) }))
    },
  )

  // ── Latest snapshot ───────────────────────────────────────────────────────
  app.get(
    '/snapshots/latest',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const row = await prisma.hrSnapshot.findFirst({
        where: { tenantId },
        orderBy: { snapshotDate: 'desc' },
      })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No snapshots yet')
      return c.json(snapshotToDto(row))
    },
  )

  // ── Manual compute (also used by daily cron) ─────────────────────────────
  app.post(
    '/snapshots/compute',
    requireRole('hr_admin', 'owner'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const result = await computeHrSnapshot({ prisma, tenantId })
      c.set('auditEntry', {
        action: 'analytics.snapshot_computed',
        entityType: 'hr_snapshot',
        entityId: tenantId,
        diff: { snapshotDate: result.snapshotDate, headcount: result.headcount, actor: userId },
      })
      return c.json(hrDashboardSchema.parse(result))
    },
  )

  // ── Live dashboard (computed on demand, does not persist) ────────────────
  app.get(
    '/dashboard',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      // Reuse the snapshot computation logic but skip the upsert in the
      // hot path by reading from the latest snapshot if it is from today;
      // otherwise compute fresh and persist (idempotent upsert).
      const today = new Date()
      const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      const latest = await prisma.hrSnapshot.findFirst({
        where: { tenantId, snapshotDate: todayDate },
      })
      if (latest) {
        return c.json(
          hrDashboardSchema.parse({
            snapshotDate: latest.snapshotDate.toISOString().slice(0, 10),
            headcount: latest.headcount,
            headcountByStatus: (latest.headcountByStatus ?? {}) as Record<string, number>,
            headcountByOrgUnit: (latest.headcountByOrgUnit ?? {}) as Record<string, number>,
            openRequisitions: latest.openRequisitions,
            hiredMtd: latest.hiredMtd,
            terminatedMtd: latest.terminatedMtd,
            avgTimeToHireDays: decimalToNumber(latest.avgTimeToHireDays),
            probationPassRateQtd: decimalToNumber(latest.probationPassRateQtd),
          }),
        )
      }
      const result = await computeHrSnapshot({ prisma, tenantId })
      return c.json(hrDashboardSchema.parse(result))
    },
  )

  app.get(
    '/recruiter-funnel',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator(
      'query',
      z.object({
        period: z.enum(['today', 'week', 'all']).default('today'),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { period } = c.req.valid('query')
      const result = await computeRecruiterFunnel({ prisma, tenantId, period })
      return c.json(result)
    },
  )

  return app
}

export function createPayrollRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/export',
    requireRole('hr_admin', 'owner'),
    zValidator('query', payrollExportQuerySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { month, format } = c.req.valid('query')
      const result = await buildPayrollExport({ prisma, tenantId, month })

      if (format === 'csv') {
        const csv = payrollRowsToCsv(result.rows)
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="payroll-${month}.csv"`,
          },
        })
      }
      return c.json(payrollExportResponseSchema.parse(result))
    },
  )

  return app
}
