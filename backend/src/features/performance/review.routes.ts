import {
  createReviewCycleRequestSchema,
  createReviewRequestsRequestSchema,
  declineReviewRequestSchema,
  openReviewCycleRequestSchema,
  patchReviewCycleRequestSchema,
  performanceReviewRequestStatusSchema,
  submitReviewRequestSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  closeReviewCycle,
  createReviewCycle,
  declineReviewRequest,
  fanOutReviewRequests,
  getReviewCycleById,
  getReviewSubjectResults,
  listReviewCycles,
  listReviewRequestsForReviewer,
  listReviewRequestsForSubject,
  openReviewCycle,
  patchReviewCycle,
  submitReviewRequest,
} from './review.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

export function createReviewRoutes() {
  const app = new Hono<RouteBindings>()

  app.post(
    '/cycles',
    requireRole('hr_admin', 'owner'),
    zValidator('json', createReviewCycleRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const cycle = await createReviewCycle({
        prisma,
        tenantId,
        actorUserId: userId,
        title: body.title,
        quarter: body.quarter,
        questions: body.questions,
      })

      return c.json(cycle, 201)
    },
  )

  app.patch(
    '/cycles/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', patchReviewCycleRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const cycle = await patchReviewCycle({
        prisma,
        tenantId,
        id,
        title: body.title,
        quarter: body.quarter,
        questions: body.questions,
      })

      return c.json(cycle)
    },
  )

  app.post(
    '/cycles/:id/open',
    requireRole('hr_admin', 'owner'),
    zValidator('json', openReviewCycleRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const cycle = await openReviewCycle({
        prisma,
        tenantId,
        id,
        closesAt: body.closesAt,
        actorRoles: roles,
      })

      c.set('auditEntry', {
        action: 'review_cycle.opened',
        entityType: 'review_cycle',
        entityId: cycle.id,
        diff: { status: cycle.status, closesAt: cycle.closesAt },
      })

      return c.json(cycle)
    },
  )

  app.post('/cycles/:id/close', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const roles = c.get('roles')
    const { id } = c.req.param()

    const cycle = await closeReviewCycle({
      prisma,
      tenantId,
      id,
      actorRoles: roles,
    })

    c.set('auditEntry', {
      action: 'review_cycle.closed',
      entityType: 'review_cycle',
      entityId: cycle.id,
      diff: { status: cycle.status, closedAt: cycle.closedAt },
    })

    return c.json(cycle)
  })

  app.get('/cycles', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const result = await listReviewCycles({ prisma, tenantId })
    return c.json(result)
  })

  app.get('/cycles/:id', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()
    const cycle = await getReviewCycleById({ prisma, tenantId, id })
    return c.json(cycle)
  })

  app.post(
    '/cycles/:id/requests',
    requireRole('hr_admin', 'owner'),
    zValidator('json', createReviewRequestsRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const result = await fanOutReviewRequests({
        prisma,
        tenantId,
        cycleId: id,
        subjectEmployeeId: body.subjectEmployeeId,
        reviewers: body.reviewers,
      })

      c.set('auditEntry', {
        action: 'review_request.created',
        entityType: 'review_cycle',
        entityId: id,
        diff: {
          subjectEmployeeId: body.subjectEmployeeId,
          requested: body.reviewers.length,
          created: result.created,
        },
      })

      return c.json(result, 201)
    },
  )

  app.get(
    '/requests',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator(
      'query',
      z.object({
        reviewerUserId: z.string().uuid().optional(),
        status: performanceReviewRequestStatusSchema.optional(),
        cycleId: z.string().uuid().optional(),
        subjectEmployeeId: z.string().uuid().optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const query = c.req.valid('query')

      if (query.reviewerUserId) {
        if (query.reviewerUserId !== userId) {
          throw new AppError(403, 'FORBIDDEN', 'Can only read own review requests')
        }

        const result = await listReviewRequestsForReviewer({
          prisma,
          tenantId,
          reviewerUserId: query.reviewerUserId,
          status: query.status,
        })
        return c.json(result)
      }

      if (query.cycleId && query.subjectEmployeeId) {
        if (!roles.includes('hr_admin') && !roles.includes('owner')) {
          throw new AppError(403, 'FORBIDDEN', 'Not allowed to read cycle subject requests')
        }

        const result = await listReviewRequestsForSubject({
          prisma,
          tenantId,
          cycleId: query.cycleId,
          subjectEmployeeId: query.subjectEmployeeId,
        })

        return c.json(result)
      }

      throw new AppError(400, 'BAD_REQUEST', 'Either reviewerUserId or cycleId+subjectEmployeeId must be provided')
    },
  )

  app.post(
    '/requests/:id/submit',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', submitReviewRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const request = await submitReviewRequest({
        prisma,
        tenantId,
        id,
        actorUserId: userId,
        response: body.response,
      })

      c.set('auditEntry', {
        action: 'review_request.submitted',
        entityType: 'review_request',
        entityId: request.id,
        diff: { status: request.status, submittedAt: request.submittedAt },
      })

      return c.json(request)
    },
  )

  app.post(
    '/requests/:id/decline',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', declineReviewRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const request = await declineReviewRequest({
        prisma,
        tenantId,
        id,
        actorUserId: userId,
        reason: body.reason,
      })

      c.set('auditEntry', {
        action: 'review_request.declined',
        entityType: 'review_request',
        entityId: request.id,
        diff: { status: request.status, declineReason: request.declineReason },
      })

      return c.json(request)
    },
  )

  app.get(
    '/cycles/:id/subjects/:employeeId/results',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id, employeeId } = c.req.param()

      const result = await getReviewSubjectResults({
        prisma,
        tenantId,
        cycleId: id,
        subjectEmployeeId: employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      return c.json(result)
    },
  )

  return app
}
