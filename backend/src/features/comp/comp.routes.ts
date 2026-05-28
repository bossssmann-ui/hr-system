/**
 * Compensation calculator routes — Phase 3.
 *
 * Bands are an admin-curated catalogue per tenant of grade × currency salary
 * ranges. The calculator endpoint computes a percentile (0-100) and a zone
 * ('below' | 'within' | 'above') for a given grade+currency+salary input.
 */

import {
  compBandCreateRequestSchema,
  compBandSchema,
  compBandUpdateRequestSchema,
  compCalculatorQuerySchema,
  compCalculatorResponseSchema,
  listCompBandsResponseSchema,
  type CompBand,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

type RawBand = {
  id: string
  tenantId: string
  grade: string
  currency: string
  minSalary: number
  midSalary: number
  maxSalary: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toDto(row: RawBand): CompBand {
  return compBandSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    grade: row.grade,
    currency: row.currency,
    minSalary: row.minSalary,
    midSalary: row.midSalary,
    maxSalary: row.maxSalary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

function computePercentile(salary: number, min: number, mid: number, max: number) {
  if (salary < min) {
    return {
      zone: 'below' as const,
      percentile: Math.max(0, Math.round((salary / min) * 25)),
    }
  }
  if (salary > max) {
    return {
      zone: 'above' as const,
      percentile: Math.min(100, 75 + Math.round(((salary - max) / max) * 25)),
    }
  }
  // within band: 25 at min, 50 at mid, 100 at max.
  let percentile: number
  if (salary <= mid) {
    if (mid === min) percentile = 50
    else percentile = 25 + ((salary - min) / (mid - min)) * 25
  } else {
    if (max === mid) percentile = 100
    else percentile = 50 + ((salary - mid) / (max - mid)) * 50
  }
  return { zone: 'within' as const, percentile: Math.round(percentile) }
}

export function createCompRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── List bands ─────────────────────────────────────────────────────────
  app.get(
    '/bands',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const rows = await prisma.compBand.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ grade: 'asc' }, { currency: 'asc' }],
      })
      return c.json(listCompBandsResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )

  app.post(
    '/bands',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compBandCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const body = c.req.valid('json')

      const row = await prisma.compBand.create({
        data: {
          tenantId,
          grade: body.grade,
          currency: body.currency,
          minSalary: body.minSalary,
          midSalary: body.midSalary,
          maxSalary: body.maxSalary,
        },
      })

      c.set('auditEntry', {
        action: 'comp_band.create',
        entityType: 'CompBand',
        entityId: row.id,
        diff: body,
      })

      return c.json(toDto(row), 201)
    },
  )

  app.patch(
    '/bands/:id',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compBandUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.compBand.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'CompBand not found')

      const merged = {
        minSalary: body.minSalary ?? existing.minSalary,
        midSalary: body.midSalary ?? existing.midSalary,
        maxSalary: body.maxSalary ?? existing.maxSalary,
      }
      if (
        merged.minSalary > merged.midSalary ||
        merged.midSalary > merged.maxSalary ||
        merged.minSalary <= 0
      ) {
        throw new AppError(400, 'VALIDATION_ERROR', 'minSalary <= midSalary <= maxSalary required')
      }

      const updated = await prisma.compBand.update({
        where: { id },
        data: {
          grade: body.grade ?? undefined,
          currency: body.currency ?? undefined,
          minSalary: body.minSalary ?? undefined,
          midSalary: body.midSalary ?? undefined,
          maxSalary: body.maxSalary ?? undefined,
        },
      })

      c.set('auditEntry', {
        action: 'comp_band.update',
        entityType: 'CompBand',
        entityId: id,
        diff: body,
      })

      return c.json(toDto(updated))
    },
  )

  app.delete(
    '/bands/:id',
    requireRole('owner', 'hr_admin'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const existing = await prisma.compBand.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'CompBand not found')

      await prisma.compBand.update({ where: { id }, data: { deletedAt: new Date() } })

      c.set('auditEntry', {
        action: 'comp_band.delete',
        entityType: 'CompBand',
        entityId: id,
        diff: {},
      })

      return c.json({ ok: true })
    },
  )

  // ─── Calculator ────────────────────────────────────────────────────────
  app.get(
    '/calculator',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', compCalculatorQuerySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { grade, salary, currency } = c.req.valid('query')

      const band = await prisma.compBand.findFirst({
        where: { tenantId, grade, currency, deletedAt: null },
      })
      if (!band) throw new AppError(404, 'NOT_FOUND', 'CompBand not found for grade/currency')

      const { zone, percentile } = computePercentile(
        salary,
        band.minSalary,
        band.midSalary,
        band.maxSalary,
      )

      return c.json(
        compCalculatorResponseSchema.parse({
          band: toDto(band),
          percentile,
          zone,
        }),
      )
    },
  )

  return app
}
