import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import {
  idpCreateRequestSchema,
  idpItemCreateRequestSchema,
  idpItemUpdateRequestSchema,
  idpUpdateRequestSchema,
  keyResultCreateRequestSchema,
  keyResultUpdateRequestSchema,
  learningAssignmentCreateRequestSchema,
  learningAssignmentUpdateRequestSchema,
  learningCourseCreateRequestSchema,
  learningCourseUpdateRequestSchema,
  learningPathCreateRequestSchema,
  learningPathUpdateRequestSchema,
  okrCreateRequestSchema,
  okrUpdateRequestSchema,
  oneOnOneCreateRequestSchema,
  oneOnOneUpdateRequestSchema,
  reviewCycleCreateRequestSchema,
  reviewCycleUpdateRequestSchema,
  reviewDeclineRequestSchema,
  reviewRequestsCreateRequestSchema,
  reviewSubmitRequestSchema,
} from '@web-app-demo/contracts'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient }
}

async function ensureEmployeeAccess(
  prisma: DbClient,
  tenantId: string,
  employeeId: string,
  ctx: { userId: string; roles: string[] },
) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } })
  if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')
  const isAdmin = ctx.roles.includes('hr_admin') || ctx.roles.includes('owner')
  const isManager = ctx.roles.includes('hiring_manager')
  const isSelf = ctx.roles.includes('employee') && employee.userId === ctx.userId
  if (!isAdmin && !isManager && !isSelf) {
    throw new AppError(403, 'FORBIDDEN', 'Not allowed for this employee')
  }
  return { employee, isAdmin, isSelf }
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/learning — courses & paths
// ─────────────────────────────────────────────────────────────────────────────

export function createLearningRoutes() {
  const app = new Hono<RouteBindings>()

  // ── Courses ────────────────────────────────────────────────────────────────

  app.get('/courses', requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const items = await prisma.learningCourse.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/courses',
    requireRole('hr_admin', 'owner'),
    zValidator('json', learningCourseCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const course = await prisma.learningCourse.create({
        data: { ...body, tenantId, createdByUserId: userId },
      })
      return c.json(course, 201)
    },
  )

  app.patch(
    '/courses/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', learningCourseUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')
      const existing = await prisma.learningCourse.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Course not found')
      const updated = await prisma.learningCourse.update({ where: { id }, data: body })
      return c.json(updated)
    },
  )

  app.delete('/courses/:id', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const id = c.req.param('id') as string
    const existing = await prisma.learningCourse.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Course not found')
    await prisma.learningCourse.update({ where: { id }, data: { deletedAt: new Date() } })
    return c.body(null, 204)
  })

  // ── Learning paths ─────────────────────────────────────────────────────────

  app.get('/paths', requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const items = await prisma.learningPath.findMany({
      where: { tenantId, deletedAt: null },
      include: { items: { include: { course: true }, orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/paths',
    requireRole('hr_admin', 'owner'),
    zValidator('json', learningPathCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { courseIds, ...body } = c.req.valid('json')
      const path = await prisma.$transaction(async (tx) => {
        const created = await tx.learningPath.create({
          data: { ...body, tenantId, createdByUserId: userId },
        })
        if (courseIds && courseIds.length > 0) {
          await tx.learningPathItem.createMany({
            data: courseIds.map((courseId, idx) => ({
              tenantId,
              pathId: created.id,
              courseId,
              order: idx + 1,
            })),
          })
        }
        return created
      })
      return c.json(path, 201)
    },
  )

  app.patch(
    '/paths/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', learningPathUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const id = c.req.param('id') as string
      const { courseIds, ...body } = c.req.valid('json')
      const existing = await prisma.learningPath.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Path not found')
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.learningPath.update({ where: { id }, data: body })
        if (courseIds) {
          await tx.learningPathItem.deleteMany({ where: { pathId: id } })
          if (courseIds.length > 0) {
            await tx.learningPathItem.createMany({
              data: courseIds.map((courseId, idx) => ({
                tenantId,
                pathId: id,
                courseId,
                order: idx + 1,
              })),
            })
          }
        }
        return u
      })
      return c.json(updated)
    },
  )

  app.delete('/paths/:id', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const id = c.req.param('id') as string
    const existing = await prisma.learningPath.findFirst({ where: { id, tenantId, deletedAt: null } })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Path not found')
    await prisma.learningPath.update({ where: { id }, data: { deletedAt: new Date() } })
    return c.body(null, 204)
  })

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/reviews — 360° cycles
// ─────────────────────────────────────────────────────────────────────────────

export function createReviewsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/cycles', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const items = await prisma.reviewCycle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/cycles',
    requireRole('hr_admin', 'owner'),
    zValidator('json', reviewCycleCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const cycle = await prisma.reviewCycle.create({
        data: {
          tenantId,
          title: body.title,
          quarter: body.quarter,
          closesAt: body.closesAt ? new Date(body.closesAt) : null,
          questions: body.questions ?? [],
          createdByUserId: userId,
        },
      })
      return c.json(cycle, 201)
    },
  )

  app.patch(
    '/cycles/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', reviewCycleUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')
      const existing = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Cycle not found')

      const data: Record<string, unknown> = {}
      if (body.questions !== undefined) data.questions = body.questions
      if (body.closesAt !== undefined) data.closesAt = new Date(body.closesAt)
      if (body.status !== undefined) {
        if (body.status === 'open' && existing.status === 'draft') {
          data.status = 'open'
          data.openedAt = new Date()
        } else if (body.status === 'closed' && existing.status === 'open') {
          data.status = 'closed'
          data.closedAt = new Date()
        } else if (body.status === existing.status) {
          // no-op
        } else {
          throw new AppError(409, 'CONFLICT', `Cannot move cycle from ${existing.status} to ${body.status}`)
        }
      }
      const updated = await prisma.reviewCycle.update({ where: { id }, data })
      return c.json(updated)
    },
  )

  app.post(
    '/cycles/:id/requests',
    requireRole('hr_admin', 'owner'),
    zValidator('json', reviewRequestsCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')
      const cycle = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
      if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Cycle not found')
      if (cycle.status === 'closed') throw new AppError(409, 'CONFLICT', 'Cycle already closed')

      const created = await prisma.reviewRequest.createMany({
        data: body.requests.map((r) => ({
          tenantId,
          cycleId: id,
          subjectEmployeeId: r.subjectEmployeeId,
          reviewerUserId: r.reviewerUserId,
          relationship: r.relationship ?? 'peer',
        })),
        skipDuplicates: true,
      })
      return c.json({ created: created.count }, 201)
    },
  )

  app.get('/my-requests', requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const items = await prisma.reviewRequest.findMany({
      where: { tenantId, reviewerUserId: userId, status: 'pending' },
      include: {
        cycle: { select: { id: true, title: true, quarter: true, closesAt: true, questions: true } },
        subjectEmployee: { select: { id: true, fullName: true, jobTitle: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/requests/:id/submit',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', reviewSubmitRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const existing = await prisma.reviewRequest.findFirst({ where: { id, tenantId, reviewerUserId: userId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review request not found')
      if (existing.status !== 'pending') throw new AppError(409, 'CONFLICT', 'Request already resolved')

      const updated = await prisma.reviewRequest.update({
        where: { id },
        data: { status: 'submitted', response: body.response, submittedAt: new Date() },
      })
      return c.json(updated)
    },
  )

  app.post(
    '/requests/:id/decline',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', reviewDeclineRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const existing = await prisma.reviewRequest.findFirst({ where: { id, tenantId, reviewerUserId: userId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review request not found')
      if (existing.status !== 'pending') throw new AppError(409, 'CONFLICT', 'Request already resolved')

      const updated = await prisma.reviewRequest.update({
        where: { id },
        data: { status: 'declined', declineReason: body.reason ?? null, declinedAt: new Date() },
      })
      return c.json(updated)
    },
  )

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/okrs — objectives & key results
// ─────────────────────────────────────────────────────────────────────────────

export function createOkrsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator(
      'query',
      z.object({
        quarter: z.string().optional(),
        employee_id: z.string().uuid().optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const q = c.req.valid('query')

      const isAdmin = roles.includes('hr_admin') || roles.includes('owner') || roles.includes('hiring_manager')
      const employeeFilter = isAdmin
        ? q.employee_id
          ? { id: q.employee_id, tenantId }
          : undefined
        : { userId, tenantId }

      const where = {
        tenantId,
        ...(q.quarter ? { quarter: q.quarter } : {}),
        ...(employeeFilter ? { employee: employeeFilter } : {}),
      }

      const items = await prisma.okr.findMany({
        where,
        include: { keyResults: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })
      return c.json({ items })
    },
  )

  app.post(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', okrCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const body = c.req.valid('json')

      await ensureEmployeeAccess(prisma, tenantId, body.employeeId, { userId, roles })

      const okr = await prisma.okr.create({
        data: {
          tenantId,
          employeeId: body.employeeId,
          parentOkrId: body.parentOkrId,
          quarter: body.quarter,
          objective: body.objective,
          description: body.description,
          status: body.status ?? 'draft',
          createdByUserId: userId,
        },
      })
      return c.json(okr, 201)
    },
  )

  app.patch(
    '/:id',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', okrUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')
      await ensureEmployeeAccess(prisma, tenantId, existing.employeeId, { userId, roles })

      const updated = await prisma.okr.update({ where: { id }, data: body })
      return c.json(updated)
    },
  )

  app.post(
    '/:id/key-results',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', keyResultCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const okr = await prisma.okr.findFirst({ where: { id, tenantId } })
      if (!okr) throw new AppError(404, 'NOT_FOUND', 'OKR not found')
      await ensureEmployeeAccess(prisma, tenantId, okr.employeeId, { userId, roles })

      const kr = await prisma.keyResult.create({
        data: {
          tenantId,
          okrId: id,
          title: body.title,
          unit: body.unit,
          startValue: body.startValue ?? 0,
          targetValue: body.targetValue,
          currentValue: body.currentValue ?? 0,
        },
      })
      return c.json(kr, 201)
    },
  )

  app.patch(
    '/:id/key-results/:krid',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', keyResultUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
    const { krid } = c.req.param()
      const body = c.req.valid('json')

      const kr = await prisma.keyResult.findFirst({
        where: { id: krid, tenantId, okrId: id },
        include: { okr: true },
      })
      if (!kr) throw new AppError(404, 'NOT_FOUND', 'Key result not found')
      await ensureEmployeeAccess(prisma, tenantId, kr.okr.employeeId, { userId, roles })

      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.keyResult.update({ where: { id: krid }, data: body })
        const siblings = await tx.keyResult.findMany({ where: { okrId: id } })
        const progress =
          siblings.length === 0
            ? 0
            : Math.round(
                siblings.reduce((acc, k) => {
                  if (k.targetValue === k.startValue) return acc + (k.currentValue >= k.targetValue ? 100 : 0)
                  const pct = ((k.currentValue - k.startValue) / (k.targetValue - k.startValue)) * 100
                  return acc + Math.max(0, Math.min(100, pct))
                }, 0) / siblings.length,
              )
        await tx.okr.update({ where: { id }, data: { progressPercent: progress } })
        return u
      })
      return c.json(updated)
    },
  )

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee-scoped routes: /api/employees/:id/(learning|1on1s|idp)
// Mounted from the employees router.
// ─────────────────────────────────────────────────────────────────────────────

export function createEmployeeLearningRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/', requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const id = c.req.param('id') as string

    await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })
    const items = await prisma.learningAssignment.findMany({
      where: { tenantId, employeeId: id },
      include: { course: true, path: true },
      orderBy: { createdAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/',
    requireRole('hr_admin', 'owner'),
    zValidator('json', learningAssignmentCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const employee = await prisma.employee.findFirst({ where: { id, tenantId } })
      if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

      const assignment = await prisma.learningAssignment.create({
        data: {
          tenantId,
          employeeId: id,
          courseId: body.courseId ?? null,
          pathId: body.pathId ?? null,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          assignedByUserId: userId,
        },
      })
      return c.json(assignment, 201)
    },
  )

  app.patch(
    '/:aid',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', learningAssignmentUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
    const { aid } = c.req.param()
      const body = c.req.valid('json')

      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })
      const existing = await prisma.learningAssignment.findFirst({ where: { id: aid, tenantId, employeeId: id } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Assignment not found')

      const data: Record<string, unknown> = {}
      if (body.status !== undefined) {
        data.status = body.status
        if (body.status === 'started' && !existing.startedAt) data.startedAt = new Date()
        if (body.status === 'completed' && !existing.completedAt) {
          data.completedAt = new Date()
          data.progressPercent = 100
        }
      }
      if (body.progressPercent !== undefined) data.progressPercent = body.progressPercent
      if (body.score !== undefined) data.score = body.score

      const updated = await prisma.learningAssignment.update({ where: { id: aid }, data })
      return c.json(updated)
    },
  )

  return app
}

export function createEmployee1on1Routes() {
  const app = new Hono<RouteBindings>()

  app.get('/', requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const id = c.req.param('id') as string

    await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })
    const items = await prisma.oneOnOne.findMany({
      where: { tenantId, employeeId: id },
      orderBy: { scheduledAt: 'desc' },
    })
    return c.json({ items })
  })

  app.post(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    zValidator('json', oneOnOneCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      const employee = await prisma.employee.findFirst({ where: { id, tenantId } })
      if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

      const meeting = await prisma.oneOnOne.create({
        data: {
          tenantId,
          employeeId: id,
          managerUserId: body.managerUserId ?? userId,
          scheduledAt: new Date(body.scheduledAt),
          durationMinutes: body.durationMinutes ?? null,
          agenda: body.agenda ?? null,
          createdByUserId: userId,
        },
      })
      return c.json(meeting, 201)
    },
  )

  app.patch(
    '/:mid',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    zValidator('json', oneOnOneUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const id = c.req.param('id') as string
    const { mid } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.oneOnOne.findFirst({ where: { id: mid, tenantId, employeeId: id } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', '1:1 not found')

      const data: Record<string, unknown> = {}
      if (body.status !== undefined) {
        data.status = body.status
        if (body.status === 'completed') data.completedAt = new Date()
      }
      if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt)
      if (body.agenda !== undefined) data.agenda = body.agenda
      if (body.notes !== undefined) data.notes = body.notes
      if (body.actionItems !== undefined) data.actionItems = body.actionItems

      const updated = await prisma.oneOnOne.update({ where: { id: mid }, data })
      return c.json(updated)
    },
  )

  return app
}

export function createEmployeeIdpRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('query', z.object({ quarter: z.string().optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
      const { quarter } = c.req.valid('query')

      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })
      const items = await prisma.idp.findMany({
        where: { tenantId, employeeId: id, ...(quarter ? { quarter } : {}) },
        include: { items: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })
      return c.json({ items })
    },
  )

  app.post(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', idpCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
      const body = c.req.valid('json')

      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })
      const idp = await prisma.idp.create({
        data: { tenantId, employeeId: id, quarter: body.quarter, summary: body.summary, createdByUserId: userId },
      })
      return c.json(idp, 201)
    },
  )

  app.patch(
    '/:iid',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', idpUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
    const { iid } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.idp.findFirst({ where: { id: iid, tenantId, employeeId: id } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP not found')
      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })

      const updated = await prisma.idp.update({ where: { id: iid }, data: body })
      return c.json(updated)
    },
  )

  app.post(
    '/:iid/items',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', idpItemCreateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
    const { iid } = c.req.param()
      const body = c.req.valid('json')

      const idp = await prisma.idp.findFirst({ where: { id: iid, tenantId, employeeId: id } })
      if (!idp) throw new AppError(404, 'NOT_FOUND', 'IDP not found')
      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })

      const item = await prisma.idpItem.create({
        data: {
          tenantId,
          idpId: iid,
          title: body.title,
          description: body.description,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
        },
      })
      return c.json(item, 201)
    },
  )

  app.patch(
    '/:iid/items/:itemId',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'employee'),
    zValidator('json', idpItemUpdateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const id = c.req.param('id') as string
    const { iid, itemId } = c.req.param()
      const body = c.req.valid('json')

      const item = await prisma.idpItem.findFirst({
        where: { id: itemId, tenantId, idpId: iid, idp: { employeeId: id } },
        include: { idp: true },
      })
      if (!item) throw new AppError(404, 'NOT_FOUND', 'IDP item not found')
      await ensureEmployeeAccess(prisma, tenantId, id, { userId, roles })

      const data: Record<string, unknown> = {}
      if (body.title !== undefined) data.title = body.title
      if (body.description !== undefined) data.description = body.description
      if (body.dueDate !== undefined) data.dueDate = new Date(body.dueDate)
      if (body.status !== undefined) {
        data.status = body.status
        if (body.status === 'completed' && !item.completedAt) data.completedAt = new Date()
      }

      const updated = await prisma.idpItem.update({ where: { id: itemId }, data })
      return c.json(updated)
    },
  )

  return app
}
