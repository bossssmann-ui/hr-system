import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  completeOffboarding,
  markOffboardingTaskDone,
  recordExitInterview,
  startOffboarding,
} from './offboarding/offboarding.service'
import {
  createEmployee1on1Routes,
  createEmployeeIdpRoutes,
  createEmployeeLearningRoutes,
} from '../learning/learning.routes'

const exitReasonCategorySchema = z.enum(['voluntary', 'mutual', 'probation_failed', 'for_cause', 'other'])

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient }
}

export function createEmployeesRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/:id/offboarding', requireRole('hr_admin', 'owner', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const employee = await prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        offboardingChecklists: {
          include: { tasks: { orderBy: { order: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        exitInterview: true,
        alumniProfile: true,
      },
    })

    if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

    return c.json({
      employeeId: employee.id,
      status: employee.status,
      terminatedAt: employee.terminatedAt?.toISOString() ?? null,
      terminationGround: employee.terminationGround ?? null,
      checklist: employee.offboardingChecklists[0] ?? null,
      exitInterview: employee.exitInterview ?? null,
      alumniProfile: employee.alumniProfile ?? null,
    })
  })

  app.post('/:id/offboarding', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { id } = c.req.param()

    const result = await startOffboarding({ prisma, tenantId, employeeId: id, actorRoles: roles, actorUserId: userId })
    return c.json(result, 201)
  })

  app.post(
    '/:id/offboarding/complete',
    requireRole('hr_admin', 'owner'),
    zValidator('json', z.object({ terminationGround: z.string().optional(), terminationNote: z.string().optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const result = await completeOffboarding({
        prisma,
        tenantId,
        employeeId: id,
        actorRoles: roles,
        actorUserId: userId,
        terminationGround: body.terminationGround,
        terminationNote: body.terminationNote,
      })
      return c.json(result)
    },
  )

  app.patch(
    '/:id/offboarding/tasks/:taskId',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', z.object({ status: z.enum(['done', 'skipped']).default('done') })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { taskId } = c.req.param()
      const body = c.req.valid('json')

      const task = await markOffboardingTaskDone({ prisma, tenantId, taskId, actorUserId: userId, status: body.status })
      return c.json(task)
    },
  )

  app.post(
    '/:id/exit-interview',
    requireRole('hr_admin', 'owner'),
    zValidator(
      'json',
      z.object({
        conductedByUserId: z.string().uuid().optional(),
        conductedAt: z.string().datetime().optional(),
        reasonCategory: exitReasonCategorySchema,
        notes: z.string().optional(),
        wouldRehire: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const result = await recordExitInterview({
        prisma,
        tenantId,
        employeeId: id,
        conductedByUserId: body.conductedByUserId ?? userId,
        conductedAt: body.conductedAt ? new Date(body.conductedAt) : new Date(),
        reasonCategory: body.reasonCategory,
        notes: body.notes,
        wouldRehire: body.wouldRehire,
        metadata: body.metadata,
      })
      return c.json(result, 201)
    },
  )

  app.get('/:id/exit-interview', requireRole('hr_admin', 'owner', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const interview = await prisma.exitInterview.findFirst({ where: { employeeId: id, tenantId } })
    if (!interview) throw new AppError(404, 'NOT_FOUND', 'Exit interview not found')
    return c.json(interview)
  })

  app.route('/:id/learning', createEmployeeLearningRoutes())
  app.route('/:id/1on1s', createEmployee1on1Routes())
  app.route('/:id/idp', createEmployeeIdpRoutes())

  return app
}
