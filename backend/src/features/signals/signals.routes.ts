/**
 * Phase 9 — Analytics signals routes.
 *
 *   GET   /api/analytics/signals             — list open signals (admin scope)
 *   PATCH /api/analytics/signals/:id         — dismiss / mark reviewed
 *   POST  /api/analytics/signals/compute     — manual trigger (admin)
 *   GET   /api/employees/:id/signals         — per-employee
 *
 * Read endpoints include `hiring_manager` so managers can see their team.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { computeSignalsForTenant } from './signals.service'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient; auditEntry?: unknown }
}

const updateSignalSchema = z.object({
  status: z.enum(['reviewed', 'dismissed', 'open']),
})

function signalToDto(row: {
  id: string
  tenantId: string
  employeeId: string
  type: string
  score: number
  factors: unknown
  status: string
  computedAt: Date
  reviewedAt: Date | null
  reviewedBy: string | null
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    type: row.type,
    score: row.score,
    factors: Array.isArray(row.factors) ? (row.factors as unknown[]) : [],
    status: row.status,
    computedAt: row.computedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
  }
}

export function createSignalsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    zValidator(
      'query',
      z.object({
        status: z.enum(['open', 'reviewed', 'dismissed']).optional(),
        type: z.enum(['flight_risk', 'burnout']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { status, type, limit } = c.req.valid('query')
      const rows = await prisma.analyticsSignal.findMany({
        where: {
          tenantId,
          ...(status ? { status: status as never } : {}),
          ...(type ? { type: type as never } : {}),
        },
        orderBy: [{ score: 'desc' }, { computedAt: 'desc' }],
        take: limit,
      })
      return c.json({ items: rows.map(signalToDto) })
    },
  )

  app.patch(
    '/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', updateSignalSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const { status } = c.req.valid('json')

      const existing = await prisma.analyticsSignal.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Signal not found')

      const updated = await prisma.analyticsSignal.update({
        where: { id },
        data: {
          status: status as never,
          reviewedAt: status === 'open' ? null : new Date(),
          reviewedBy: status === 'open' ? null : userId,
        },
      })
      c.set('auditEntry', {
        action: 'analytics.signal_updated',
        entityType: 'AnalyticsSignal',
        entityId: id,
        diff: { status, actor: userId },
      })
      return c.json(signalToDto(updated))
    },
  )

  app.post(
    '/compute',
    requireRole('hr_admin', 'owner'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const result = await computeSignalsForTenant({
        prisma,
        tenantId,
        openThreshold: env.SIGNALS_OPEN_THRESHOLD,
      })
      c.set('auditEntry', {
        action: 'analytics.signals_computed',
        entityType: 'AnalyticsSignal',
        entityId: tenantId,
        diff: result,
      })
      return c.json(result)
    },
  )

  return app
}

/** Mounted under /api/employees so the route stays close to other employee data. */
export function createEmployeeSignalsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/:employeeId/signals',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { employeeId } = c.req.param()
      const rows = await prisma.analyticsSignal.findMany({
        where: { tenantId, employeeId },
        orderBy: { computedAt: 'desc' },
      })
      return c.json({ items: rows.map(signalToDto) })
    },
  )

  return app
}
