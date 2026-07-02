import {
  closeOkrRequestSchema,
  createOkrKeyResultRequestSchema,
  createOkrRequestSchema,
  patchOkrKeyResultRequestSchema,
  patchOkrRequestSchema,
  performanceOkrStatusSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  activateOkr,
  closeOkr,
  createKeyResult,
  createOkr,
  deleteKeyResult,
  getOkrById,
  listOkrs,
  patchKeyResult,
  patchOkr,
} from './okr.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

function isAdmin(roles: readonly string[]) {
  return roles.includes('hr_admin') || roles.includes('owner')
}

async function assertCanAccessEmployee({
  prisma,
  tenantId,
  employeeId,
  actorUserId,
  actorRoles,
}: {
  prisma: DbClient
  tenantId: string
  employeeId: string
  actorUserId: string
  actorRoles: readonly string[]
}) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true, userId: true },
  })
  if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

  if (isAdmin(actorRoles)) return employee
  if (employee.userId === actorUserId) return employee

  if (actorRoles.includes('hiring_manager')) {
    const mapping = await prisma.oneOnOne.findFirst({
      where: { tenantId, employeeId, managerUserId: actorUserId },
      select: { id: true },
    })
    if (mapping) return employee
  }

  throw new AppError(403, 'FORBIDDEN', 'Not allowed for this employee')
}

async function scopedEmployeeIds({
  prisma,
  tenantId,
  actorUserId,
  actorRoles,
}: {
  prisma: DbClient
  tenantId: string
  actorUserId: string
  actorRoles: readonly string[]
}) {
  if (isAdmin(actorRoles)) return undefined

  const ids = new Set<string>()
  const ownEmployee = await prisma.employee.findFirst({
    where: { tenantId, userId: actorUserId },
    select: { id: true },
  })
  if (ownEmployee) ids.add(ownEmployee.id)

  if (actorRoles.includes('hiring_manager')) {
    const managed = await prisma.oneOnOne.findMany({
      where: { tenantId, managerUserId: actorUserId },
      select: { employeeId: true },
    })
    for (const row of managed) ids.add(row.employeeId)
  }
  return [...ids]
}

export function createOkrRoutes() {
  const app = new Hono<RouteBindings>()

  app.post(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', createOkrRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const body = c.req.valid('json')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: body.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const okr = await createOkr({
        prisma,
        tenantId,
        actorUserId: userId,
        employeeId: body.employeeId,
        quarter: body.quarter,
        objective: body.objective,
        description: body.description,
        parentOkrId: body.parentOkrId,
      })

      c.set('auditEntry', {
        action: 'okr.created',
        entityType: 'okr',
        entityId: okr.id,
        diff: {
          employeeId: okr.employeeId,
          quarter: okr.quarter,
          parentOkrId: okr.parentOkrId,
        },
      })

      return c.json(okr, 201)
    },
  )

  app.patch(
    '/:id',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', patchOkrRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existing.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const okr = await patchOkr({
        prisma,
        tenantId,
        id,
        objective: body.objective,
        description: body.description,
        parentOkrId: body.parentOkrId,
      })

      return c.json(okr)
    },
  )

  app.post('/:id/activate', requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { id } = c.req.param()

    const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')

    await assertCanAccessEmployee({
      prisma,
      tenantId,
      employeeId: existing.employeeId,
      actorUserId: userId,
      actorRoles: roles,
    })

    const okr = await activateOkr({ prisma, tenantId, id, actorRoles: roles })

    c.set('auditEntry', {
      action: 'okr.activated',
      entityType: 'okr',
      entityId: okr.id,
      diff: { status: okr.status },
    })

    return c.json(okr)
  })

  app.post(
    '/:id/close',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', closeOkrRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existing.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const okr = await closeOkr({
        prisma,
        tenantId,
        id,
        actorRoles: roles,
        finalStatus: body.finalStatus,
      })

      c.set('auditEntry', {
        action: 'okr.closed',
        entityType: 'okr',
        entityId: okr.id,
        diff: { status: okr.status, progressPercent: okr.progressPercent },
      })

      return c.json(okr)
    },
  )

  app.get(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator(
      'query',
      z.object({
        employeeId: z.string().uuid().optional(),
        quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q1').optional(),
        status: performanceOkrStatusSchema.optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const query = c.req.valid('query')

      if (query.employeeId) {
        await assertCanAccessEmployee({
          prisma,
          tenantId,
          employeeId: query.employeeId,
          actorUserId: userId,
          actorRoles: roles,
        })
      }

      const scopedIds = query.employeeId
        ? undefined
        : await scopedEmployeeIds({ prisma, tenantId, actorUserId: userId, actorRoles: roles })

      const result = await listOkrs({
        prisma,
        tenantId,
        employeeId: query.employeeId,
        quarter: query.quarter,
        status: query.status,
        scopedEmployeeIds: scopedIds,
      })
      return c.json(result)
    },
  )

  app.get('/:id', requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { id } = c.req.param()

    const okr = await getOkrById({ prisma, tenantId, id })
    await assertCanAccessEmployee({
      prisma,
      tenantId,
      employeeId: okr.employeeId,
      actorUserId: userId,
      actorRoles: roles,
    })

    return c.json(okr)
  })

  app.post(
    '/:id/key-results',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', createOkrKeyResultRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const okr = await prisma.okr.findFirst({ where: { id, tenantId } })
      if (!okr) throw new AppError(404, 'NOT_FOUND', 'OKR not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: okr.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const keyResult = await createKeyResult({
        prisma,
        tenantId,
        okrId: id,
        title: body.title,
        unit: body.unit,
        startValue: body.startValue,
        targetValue: body.targetValue,
      })

      return c.json(keyResult, 201)
    },
  )

  app.patch(
    '/key-results/:krId',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', patchOkrKeyResultRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { krId } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.keyResult.findFirst({
        where: { id: krId, tenantId },
        include: { okr: true },
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Key result not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existing.okr.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const result = await patchKeyResult({
        prisma,
        tenantId,
        krId,
        title: body.title,
        unit: body.unit,
        targetValue: body.targetValue,
        currentValue: body.currentValue,
      })

      c.set('auditEntry', {
        action: 'key_result.updated',
        entityType: 'key_result',
        entityId: result.keyResult.id,
        diff: {
          okrId: result.okrId,
          status: result.keyResult.status,
          currentValue: result.keyResult.currentValue,
          targetValue: result.keyResult.targetValue,
          progressPercent: result.progressPercent,
        },
      })

      return c.json(result.keyResult)
    },
  )

  app.delete('/key-results/:krId', requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { krId } = c.req.param()

    const existing = await prisma.keyResult.findFirst({
      where: { id: krId, tenantId },
      include: { okr: true },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Key result not found')

    await assertCanAccessEmployee({
      prisma,
      tenantId,
      employeeId: existing.okr.employeeId,
      actorUserId: userId,
      actorRoles: roles,
    })

    await deleteKeyResult({ prisma, tenantId, krId })
    return c.body(null, 204)
  })

  return app
}
