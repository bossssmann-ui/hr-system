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
import { recordProbationReview } from './employees.service'
import { recordProbationReviewRequestSchema } from '@web-app-demo/contracts'

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

  app.post(
    '/:id/probation-review',
    requireRole('hr_admin', 'hiring_manager', 'owner'),
    zValidator('json', recordProbationReviewRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      try {
        const result = await recordProbationReview({
          prisma,
          tenantId,
          employeeId: id,
          actorRoles: roles,
          actorUserId: userId,
          decision: body.decision,
          extendedProbationEndsAt: body.extendedProbationEndsAt
            ? new Date(body.extendedProbationEndsAt)
            : undefined,
          managerNotes: body.note,
        })

        return c.json({
          employeeId: result.employee.id,
          status: result.employee.status,
          probationOutcome: result.employee.probationOutcome ?? null,
          probationEndsAt: result.employee.probationEndsAt?.toISOString() ?? null,
        })
      } catch (err) {
        if (!(err instanceof Error)) throw err
        const msg = err.message
        if (msg.includes('not found')) throw new AppError(404, 'NOT_FOUND', 'Employee not found')
        if (msg.includes('not allowed to review probation')) throw new AppError(403, 'FORBIDDEN', 'Forbidden')
        if (msg.includes('must be in probation status'))
          throw new AppError(422, 'FSM_TRANSITION_DENIED', 'Employee is not in probation status')
        if (msg.includes('requires extendedProbationEndsAt'))
          throw new AppError(400, 'BAD_REQUEST', 'extendedProbationEndsAt is required for extended decision')
        if (msg.includes('must move probation forward'))
          throw new AppError(422, 'VALIDATION_ERROR', 'extendedProbationEndsAt must be after the current probation end date')
        if (msg.includes('transition') && msg.includes('not allowed'))
          throw new AppError(422, 'FSM_TRANSITION_DENIED', msg)
        if (msg.includes('does not satisfy'))
          throw new AppError(422, 'FSM_TRANSITION_DENIED', msg)
        throw err
      }
    },
  )

  return app
}
