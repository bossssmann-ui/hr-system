import {
  createIdpItemRequestSchema,
  createIdpRequestSchema,
  patchIdpItemRequestSchema,
  patchIdpRequestSchema,
  performanceIdpStatusSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  createIdp,
  createIdpItem,
  deleteIdpItem,
  getIdpById,
  listIdps,
  patchIdp,
  patchIdpItem,
} from './idp.service'

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

export function createIdpRoutes() {
  const app = new Hono<RouteBindings>()

  // POST / — create IDP
  app.post(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', createIdpRequestSchema),
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

      const idp = await createIdp({
        prisma,
        tenantId,
        actorUserId: userId,
        employeeId: body.employeeId,
        quarter: body.quarter,
        summary: body.summary,
      })

      c.set('auditEntry', {
        action: 'idp.created',
        entityType: 'idp',
        entityId: idp.id,
        diff: {
          employeeId: idp.employeeId,
          quarter: idp.quarter,
        },
      })

      return c.json(idp, 201)
    },
  )

  // PATCH /:id — edit summary / advance status
  app.patch(
    '/:id',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', patchIdpRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.idp.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existing.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const idp = await patchIdp({
        prisma,
        tenantId,
        id,
        summary: body.summary,
        status: body.status,
        actorRoles: roles,
      })

      if (body.status !== undefined) {
        c.set('auditEntry', {
          action: 'idp.status_changed',
          entityType: 'idp',
          entityId: idp.id,
          diff: { status: idp.status },
        })
      }

      return c.json(idp)
    },
  )

  // GET / — list with filters
  app.get(
    '/',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator(
      'query',
      z.object({
        employeeId: z.string().uuid().optional(),
        quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q1').optional(),
        status: performanceIdpStatusSchema.optional(),
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

      const result = await listIdps({
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

  // GET /:id — with items and computed progress
  app.get('/:id', requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { id } = c.req.param()

    const idp = await getIdpById({ prisma, tenantId, id })
    await assertCanAccessEmployee({
      prisma,
      tenantId,
      employeeId: idp.employeeId,
      actorUserId: userId,
      actorRoles: roles,
    })

    return c.json(idp)
  })

  // POST /:id/items — add item
  app.post(
    '/:id/items',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', createIdpItemRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.idp.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existing.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const item = await createIdpItem({
        prisma,
        tenantId,
        idpId: id,
        title: body.title,
        description: body.description,
        dueDate: body.dueDate,
      })

      c.set('auditEntry', {
        action: 'idp_item.created',
        entityType: 'idp_item',
        entityId: item.id,
        diff: { idpId: item.idpId, title: item.title },
      })

      return c.json(item, 201)
    },
  )

  // PATCH /items/:itemId — update item
  app.patch(
    '/items/:itemId',
    requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'),
    zValidator('json', patchIdpItemRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const roles = c.get('roles')
      const { itemId } = c.req.param()
      const body = c.req.valid('json')

      const existingItem = await prisma.idpItem.findFirst({
        where: { id: itemId, tenantId },
        include: { idp: true },
      })
      if (!existingItem) throw new AppError(404, 'NOT_FOUND', 'IDP item not found')

      await assertCanAccessEmployee({
        prisma,
        tenantId,
        employeeId: existingItem.idp.employeeId,
        actorUserId: userId,
        actorRoles: roles,
      })

      const item = await patchIdpItem({
        prisma,
        tenantId,
        itemId,
        title: body.title,
        description: body.description,
        dueDate: body.dueDate,
        status: body.status,
      })

      c.set('auditEntry', {
        action: 'idp_item.updated',
        entityType: 'idp_item',
        entityId: item.id,
        diff: {
          status: item.status,
          completedAt: item.completedAt,
        },
      })

      return c.json(item)
    },
  )

  // DELETE /items/:itemId — remove item
  app.delete('/items/:itemId', requireRole('hiring_manager', 'hr_admin', 'owner', 'employee'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const roles = c.get('roles')
    const { itemId } = c.req.param()

    const existingItem = await prisma.idpItem.findFirst({
      where: { id: itemId, tenantId },
      include: { idp: true },
    })
    if (!existingItem) throw new AppError(404, 'NOT_FOUND', 'IDP item not found')

    await assertCanAccessEmployee({
      prisma,
      tenantId,
      employeeId: existingItem.idp.employeeId,
      actorUserId: userId,
      actorRoles: roles,
    })

    await deleteIdpItem({ prisma, tenantId, itemId })

    c.set('auditEntry', {
      action: 'idp_item.deleted',
      entityType: 'idp_item',
      entityId: itemId,
      diff: { idpId: existingItem.idpId },
    })

    return c.body(null, 204)
  })

  return app
}
