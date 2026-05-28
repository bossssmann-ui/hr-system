import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { markOffboardingTaskDone } from '../employees/offboarding/offboarding.service'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient }
}

export function createPortalRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/me', requireRole('employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const employee = await prisma.employee.findFirst({
      where: { userId, tenantId },
      select: {
        id: true,
        fullName: true,
        email: true,
        jobTitle: true,
        grade: true,
        employmentType: true,
        hireDate: true,
        probationEndsAt: true,
        probationOutcome: true,
        status: true,
        terminatedAt: true,
        orgUnit: { select: { id: true, name: true } },
      },
    })

    if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee record not found')
    return c.json(employee)
  })

  app.get('/me/checklist', requireRole('employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const employee = await prisma.employee.findFirst({ where: { userId, tenantId }, select: { id: true, status: true } })
    if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee record not found')

    const [onboardingTasks, offboardingTasks] = await Promise.all([
      prisma.onboardingTask.findMany({ where: { tenantId, assigneeUserId: userId }, orderBy: { order: 'asc' } }),
      employee.status === 'notice'
        ? prisma.offboardingTask.findMany({ where: { tenantId, assigneeUserId: userId }, orderBy: { order: 'asc' } })
        : Promise.resolve([]),
    ])

    return c.json({ onboardingTasks, offboardingTasks })
  })

  app.patch(
    '/me/checklist/tasks/:taskId',
    requireRole('employee'),
    zValidator('json', z.object({ status: z.enum(['done', 'skipped']).default('done') })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { taskId } = c.req.param()
      const body = c.req.valid('json')

      const onboardingTask = await prisma.onboardingTask.findFirst({ where: { id: taskId, tenantId, assigneeUserId: userId } })
      if (onboardingTask) {
        const updated = await prisma.onboardingTask.update({
          where: { id: taskId },
          data: { status: body.status === 'done' ? 'completed' : 'skipped', completedAt: new Date(), completedByUserId: userId },
        })
        return c.json(updated)
      }

      const offboardingTask = await prisma.offboardingTask.findFirst({ where: { id: taskId, tenantId, assigneeUserId: userId } })
      if (offboardingTask) {
        const updated = await markOffboardingTaskDone({ prisma, tenantId, taskId, actorUserId: userId, status: body.status })
        return c.json(updated)
      }

      throw new AppError(404, 'NOT_FOUND', 'Task not found or not assigned to you')
    },
  )

  app.get('/me/documents', requireRole('employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const employee = await prisma.employee.findFirst({ where: { userId, tenantId }, select: { id: true } })
    if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee record not found')

    const documents = await prisma.employmentDocument.findMany({ where: { employeeId: employee.id, tenantId }, orderBy: { createdAt: 'desc' } })
    return c.json({ documents })
  })

  return app
}
