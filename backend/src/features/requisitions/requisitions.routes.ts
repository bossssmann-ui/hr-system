/**
 * Phase 1B requisitions routes.
 *
 * Full CRUD + FSM transition for hiring requisitions. Every mutating route
 * sets `c.set('auditEntry', …)` so the audit middleware writes the row.
 */

import type {
  CreateRequisitionRequest,
  ListRequisitionsResponse,
  Requisition,
  TransitionRequisitionRequest,
} from '@web-app-demo/contracts'
import {
  createRequisitionRequestSchema,
  listRequisitionsResponseSchema,
  transitionRequisitionRequestSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { canTransition } from './requisitions.fsm'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

function toDto(row: {
  id: string
  title: string
  grade: string
  salaryMin: number
  salaryMax: number
  currency: string
  status: string
  justification: string
  orgUnitId: string
  createdByUserId: string
  deadlineAt: Date | null
  createdAt: Date
  updatedAt: Date
}): Requisition {
  return {
    id: row.id,
    title: row.title,
    grade: row.grade,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency as Requisition['currency'],
    justification: row.justification,
    status: row.status as Requisition['status'],
    orgUnitId: row.orgUnitId,
    createdByUserId: row.createdByUserId,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createRequisitionsRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── List ──────────────────────────────────────────────────────────────────

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', z.object({ status: z.string().optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { status } = c.req.valid('query')

      const isHiringManagerOnly =
        roles.includes('hiring_manager') &&
        !roles.includes('owner') &&
        !roles.includes('hr_admin') &&
        !roles.includes('recruiter')

      const rows = await prisma.hiringRequisition.findMany({
        where: {
          tenantId,
          ...(isHiringManagerOnly ? { createdByUserId: userId } : {}),
          ...(status ? { status: status as Requisition['status'] } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      const body: ListRequisitionsResponse = { items: rows.map(toDto) }
      return c.json(listRequisitionsResponseSchema.parse(body))
    },
  )

  // ─── Create ────────────────────────────────────────────────────────────────

  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('json', createRequisitionRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body: CreateRequisitionRequest = c.req.valid('json')

      if (body.salaryMin > body.salaryMax) {
        throw new AppError(400, 'VALIDATION_ERROR', 'salaryMin must be ≤ salaryMax')
      }

      const row = await prisma.hiringRequisition.create({
        data: {
          tenantId,
          orgUnitId: body.orgUnitId,
          createdByUserId: userId,
          title: body.title,
          grade: body.grade,
          salaryMin: body.salaryMin,
          salaryMax: body.salaryMax,
          currency: body.currency,
          justification: body.justification,
          deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
        },
      })

      c.set('auditEntry', {
        action: 'requisition.create',
        entityType: 'HiringRequisition',
        entityId: row.id,
        diff: body,
      })

      return c.json(toDto(row), 201)
    },
  )

  // ─── Detail ────────────────────────────────────────────────────────────────

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.hiringRequisition.findFirst({
        where: { id, tenantId },
      })

      if (!row) throw new AppError(404, 'NOT_FOUND', 'Requisition not found')

      return c.json(toDto(row))
    },
  )

  // ─── FSM Transition ────────────────────────────────────────────────────────

  app.patch(
    '/:id/transition',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('json', transitionRequisitionRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body: TransitionRequisitionRequest = c.req.valid('json')

      const row = await prisma.hiringRequisition.findFirst({
        where: { id, tenantId },
      })

      if (!row) throw new AppError(404, 'NOT_FOUND', 'Requisition not found')

      if (!canTransition(row.status, body.to, roles)) {
        return c.json(
          {
            error: {
              code: 'FSM_TRANSITION_DENIED',
              message: `Transition from '${row.status}' to '${body.to}' is not allowed`,
              details: { from: row.status, to: body.to },
            },
          },
          422,
        )
      }

      const updated = await prisma.hiringRequisition.update({
        where: { id },
        data: { status: body.to },
      })

      // Auto-create Vacancy on reaching 'approved' (idempotent).
      if (body.to === 'approved') {
        await prisma.vacancy.upsert({
          where: { requisitionId: id },
          update: {},
          create: {
            tenantId,
            requisitionId: id,
            orgUnitId: row.orgUnitId,
            title: row.title,
            description: row.justification,
            isPublished: false,
          },
        })
      }

      c.set('auditEntry', {
        action: 'requisition.transition',
        entityType: 'HiringRequisition',
        entityId: id,
        diff: { from: row.status, to: body.to, comment: body.comment, actorUserId: userId },
      })

      return c.json(toDto(updated))
    },
  )

  return app
}
