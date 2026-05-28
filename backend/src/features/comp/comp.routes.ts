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
  compPlanCreateRequestSchema,
  compPlanItemCreateRequestSchema,
  compPlanItemUpdateRequestSchema,
  compPlanSchema,
  compPlanUpdateRequestSchema,
  listCompBandsResponseSchema,
  listCompPlansResponseSchema,
  type CompBand,
  type CompPlan,
  type CompPlanItem,
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

  // ─── Compensation Planning (Phase 7) ──────────────────────────────────
  // Plans capture an HR-curated raise / promotion cycle: line items per
  // employee with current+proposed salary and a status workflow
  // (draft → approved → applied).

  type DecimalLike = { toString: () => string }
  const decToString = (v: DecimalLike | number | string): string =>
    typeof v === 'string' ? v : typeof v === 'number' ? v.toString() : v.toString()

  function planToDto(row: {
    id: string
    tenantId: string
    name: string
    effectiveDate: Date
    budgetCurrency: string
    budgetTotal: number
    status: string
    notes: string | null
    createdByUserId: string
    approvedByUserId: string | null
    approvedAt: Date | null
    appliedAt: Date | null
    createdAt: Date
    updatedAt: Date
    items?: Array<{
      id: string
      tenantId: string
      planId: string
      employeeId: string
      currentSalary: number
      proposedSalary: number
      currency: string
      changePct: DecimalLike
      reason: string | null
      createdAt: Date
      updatedAt: Date
    }>
  }): CompPlan {
    return compPlanSchema.parse({
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      budgetCurrency: row.budgetCurrency,
      budgetTotal: row.budgetTotal,
      status: row.status,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: row.items?.map(
        (i): CompPlanItem => ({
          id: i.id,
          tenantId: i.tenantId,
          planId: i.planId,
          employeeId: i.employeeId,
          currentSalary: i.currentSalary,
          proposedSalary: i.proposedSalary,
          currency: i.currency as CompPlan['budgetCurrency'],
          changePct: decToString(i.changePct),
          reason: i.reason,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        }),
      ),
    })
  }

  function computeChangePct(current: number, proposed: number): number {
    if (current === 0) return proposed === 0 ? 0 : 100
    return Math.round(((proposed - current) / current) * 10000) / 100
  }

  app.get('/plans', requireRole('owner', 'hr_admin', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const rows = await prisma.compPlan.findMany({
      where: { tenantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    })
    return c.json(listCompPlansResponseSchema.parse({ items: rows.map(planToDto) }))
  })

  app.get('/plans/:id', requireRole('owner', 'hr_admin', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()
    const row = await prisma.compPlan.findFirst({
      where: { id, tenantId },
      include: { items: true },
    })
    if (!row) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
    return c.json(planToDto(row))
  })

  app.post(
    '/plans',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compPlanCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const row = await prisma.compPlan.create({
        data: {
          tenantId,
          name: body.name,
          effectiveDate: new Date(`${body.effectiveDate}T00:00:00.000Z`),
          budgetCurrency: body.budgetCurrency,
          budgetTotal: body.budgetTotal ?? 0,
          notes: body.notes ?? null,
          createdByUserId: userId,
        },
        include: { items: true },
      })
      c.set('auditEntry', {
        action: 'comp_plan.create',
        entityType: 'CompPlan',
        entityId: row.id,
        diff: body,
      })
      return c.json(planToDto(row), 201)
    },
  )

  app.patch(
    '/plans/:id',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compPlanUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')
      const existing = await prisma.compPlan.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
      if (existing.status === 'applied') {
        throw new AppError(409, 'CONFLICT', 'Applied plans are immutable')
      }
      const updated = await prisma.compPlan.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          effectiveDate: body.effectiveDate
            ? new Date(`${body.effectiveDate}T00:00:00.000Z`)
            : undefined,
          budgetCurrency: body.budgetCurrency ?? undefined,
          budgetTotal: body.budgetTotal ?? undefined,
          notes: body.notes ?? undefined,
        },
        include: { items: true },
      })
      c.set('auditEntry', {
        action: 'comp_plan.update',
        entityType: 'CompPlan',
        entityId: id,
        diff: body,
      })
      return c.json(planToDto(updated))
    },
  )

  app.post(
    '/plans/:id/items',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compPlanItemCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const plan = await prisma.compPlan.findFirst({ where: { id, tenantId } })
      if (!plan) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
      if (plan.status !== 'draft') {
        throw new AppError(409, 'CONFLICT', 'Items can only be added to draft plans')
      }
      const employee = await prisma.employee.findFirst({
        where: { id: body.employeeId, tenantId },
        select: { id: true },
      })
      if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

      const changePct = computeChangePct(body.currentSalary, body.proposedSalary)
      const item = await prisma.compPlanItem.create({
        data: {
          tenantId,
          planId: id,
          employeeId: body.employeeId,
          currentSalary: body.currentSalary,
          proposedSalary: body.proposedSalary,
          currency: body.currency,
          changePct,
          reason: body.reason ?? null,
        },
      })
      c.set('auditEntry', {
        action: 'comp_plan_item.create',
        entityType: 'CompPlanItem',
        entityId: item.id,
        diff: { ...body, changePct },
      })
      return c.json(planToDto({ ...plan, items: [item] }), 201)
    },
  )

  app.patch(
    '/plans/:id/items/:itemId',
    requireRole('owner', 'hr_admin'),
    zValidator('json', compPlanItemUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id, itemId } = c.req.param()
      const body = c.req.valid('json')

      const plan = await prisma.compPlan.findFirst({ where: { id, tenantId } })
      if (!plan) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
      if (plan.status !== 'draft') {
        throw new AppError(409, 'CONFLICT', 'Items can only be edited on draft plans')
      }
      const existing = await prisma.compPlanItem.findFirst({
        where: { id: itemId, tenantId, planId: id },
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'CompPlanItem not found')

      const proposed = body.proposedSalary ?? existing.proposedSalary
      const changePct = computeChangePct(existing.currentSalary, proposed)
      const updated = await prisma.compPlanItem.update({
        where: { id: itemId },
        data: {
          proposedSalary: body.proposedSalary ?? undefined,
          reason: body.reason ?? undefined,
          changePct,
        },
      })
      c.set('auditEntry', {
        action: 'comp_plan_item.update',
        entityType: 'CompPlanItem',
        entityId: itemId,
        diff: { ...body, changePct },
      })
      return c.json({
        id: updated.id,
        proposedSalary: updated.proposedSalary,
        changePct: updated.changePct.toString(),
        reason: updated.reason,
      })
    },
  )

  app.delete(
    '/plans/:id/items/:itemId',
    requireRole('owner', 'hr_admin'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id, itemId } = c.req.param()
      const plan = await prisma.compPlan.findFirst({ where: { id, tenantId } })
      if (!plan) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
      if (plan.status !== 'draft') {
        throw new AppError(409, 'CONFLICT', 'Items can only be removed from draft plans')
      }
      const item = await prisma.compPlanItem.findFirst({ where: { id: itemId, tenantId, planId: id } })
      if (!item) throw new AppError(404, 'NOT_FOUND', 'CompPlanItem not found')
      await prisma.compPlanItem.delete({ where: { id: itemId } })
      c.set('auditEntry', {
        action: 'comp_plan_item.delete',
        entityType: 'CompPlanItem',
        entityId: itemId,
        diff: {},
      })
      return c.json({ ok: true })
    },
  )

  app.post('/plans/:id/approve', requireRole('owner', 'hr_admin'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { id } = c.req.param()
    const plan = await prisma.compPlan.findFirst({ where: { id, tenantId } })
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
    if (plan.status !== 'draft') {
      throw new AppError(409, 'CONFLICT', 'Only draft plans can be approved')
    }
    const updated = await prisma.compPlan.update({
      where: { id },
      data: { status: 'approved', approvedByUserId: userId, approvedAt: new Date() },
      include: { items: true },
    })
    c.set('auditEntry', {
      action: 'comp_plan.approve',
      entityType: 'CompPlan',
      entityId: id,
      diff: { approvedByUserId: userId },
    })
    return c.json(planToDto(updated))
  })

  app.post('/plans/:id/apply', requireRole('owner', 'hr_admin'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()
    const plan = await prisma.compPlan.findFirst({ where: { id, tenantId }, include: { items: true } })
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'CompPlan not found')
    if (plan.status !== 'approved') {
      throw new AppError(409, 'CONFLICT', 'Only approved plans can be applied')
    }
    // Apply each item: update Employee.agreedBaseSalary. Wrapped in a
    // transaction so a partial apply never leaves the plan half-updated.
    await prisma.$transaction(async (tx) => {
      for (const item of plan.items) {
        await tx.employee.updateMany({
          where: { id: item.employeeId, tenantId },
          data: { agreedBaseSalary: item.proposedSalary, currency: item.currency },
        })
      }
      await tx.compPlan.update({
        where: { id },
        data: { status: 'applied', appliedAt: new Date() },
      })
    })
    const refreshed = await prisma.compPlan.findFirstOrThrow({
      where: { id, tenantId },
      include: { items: true },
    })
    c.set('auditEntry', {
      action: 'comp_plan.apply',
      entityType: 'CompPlan',
      entityId: id,
      diff: { itemCount: plan.items.length },
    })
    return c.json(planToDto(refreshed))
  })

  return app
}
