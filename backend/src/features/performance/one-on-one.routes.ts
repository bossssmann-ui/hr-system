/**
 * OneOnOne routes — Horizon 4 Performance module.
 *
 * Mounted at /api/one-on-ones in app.ts.
 *
 * Endpoints:
 *   POST   /                — schedule a 1:1
 *   GET    /                — list with filters
 *   GET    /:id             — get one
 *   PATCH  /:id             — reschedule / update agenda
 *   POST   /:id/complete    — mark completed
 *   POST   /:id/cancel      — cancel
 */

import {
  createOneOnOneRequestSchema,
  patchOneOnOneRequestSchema,
  completeOneOnOneRequestSchema,
  performanceOneOnOneStatusSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  createOneOnOne,
  listOneOnOnes,
  getOneOnOneById,
  patchOneOnOne,
  completeOneOnOne,
  cancelOneOnOne,
} from './one-on-one.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

export function createOneOnOneRoutes() {
  const app = new Hono<RouteBindings>()

  // ── POST / — schedule ─────────────────────────────────────────────────────
  app.post(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner'),
    zValidator('json', createOneOnOneRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const meeting = await createOneOnOne({
        prisma,
        tenantId,
        actorUserId: userId,
        employeeId: body.employeeId,
        managerUserId: body.managerUserId,
        scheduledAt: body.scheduledAt,
        durationMinutes: body.durationMinutes,
        agenda: body.agenda,
      })

      c.set('auditEntry', {
        action: 'one_on_one.scheduled',
        entityType: 'one_on_one',
        entityId: meeting.id,
        diff: { employeeId: meeting.employeeId, scheduledAt: meeting.scheduledAt },
      })

      return c.json(meeting, 201)
    },
  )

  // ── GET / — list ──────────────────────────────────────────────────────────
  app.get(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator(
      'query',
      z.object({
        employeeId: z.string().uuid().optional(),
        managerUserId: z.string().uuid().optional(),
        status: performanceOneOnOneStatusSchema.optional(),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(20),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const q = c.req.valid('query')

      const result = await listOneOnOnes({
        prisma,
        tenantId,
        employeeId: q.employeeId,
        managerUserId: q.managerUserId,
        status: q.status,
        page: q.page,
        pageSize: q.pageSize,
      })

      return c.json(result)
    },
  )

  // ── GET /:id — get one ────────────────────────────────────────────────────
  app.get(
    '/:id',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const meeting = await getOneOnOneById(prisma, tenantId, id)
      return c.json(meeting)
    },
  )

  // ── PATCH /:id — reschedule / edit ────────────────────────────────────────
  app.patch(
    '/:id',
    requireRole('hiring_manager', 'hr_admin', 'owner'),
    zValidator('json', patchOneOnOneRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const meeting = await patchOneOnOne({
        prisma,
        tenantId,
        id,
        scheduledAt: body.scheduledAt,
        agenda: body.agenda,
        durationMinutes: body.durationMinutes,
      })

      c.set('auditEntry', {
        action: 'one_on_one.updated',
        entityType: 'one_on_one',
        entityId: meeting.id,
        diff: body,
      })

      return c.json(meeting)
    },
  )

  // ── POST /:id/complete ────────────────────────────────────────────────────
  app.post(
    '/:id/complete',
    requireRole('hiring_manager', 'hr_admin', 'owner'),
    zValidator('json', completeOneOnOneRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const meeting = await completeOneOnOne({
        prisma,
        tenantId,
        id,
        actorRoles: roles,
        notes: body.notes,
        actionItems: body.actionItems,
      })

      c.set('auditEntry', {
        action: 'one_on_one.completed',
        entityType: 'one_on_one',
        entityId: meeting.id,
        diff: { notes: meeting.notes, completedAt: meeting.completedAt },
      })

      return c.json(meeting)
    },
  )

  // ── POST /:id/cancel ──────────────────────────────────────────────────────
  app.post(
    '/:id/cancel',
    requireRole('hiring_manager', 'hr_admin', 'owner'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const { id } = c.req.param()

      const meeting = await cancelOneOnOne({ prisma, tenantId, id, actorRoles: roles })

      c.set('auditEntry', {
        action: 'one_on_one.cancelled',
        entityType: 'one_on_one',
        entityId: meeting.id,
        diff: { status: 'cancelled' },
      })

      return c.json(meeting)
    },
  )

  return app
}
