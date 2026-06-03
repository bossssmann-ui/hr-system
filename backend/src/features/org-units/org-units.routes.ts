import type { CreateOrgUnitRequest, OrgUnit, UpdateOrgUnitRequest } from '@web-app-demo/contracts'
import { createOrgUnitRequestSchema, listOrgUnitsResponseSchema, updateOrgUnitRequestSchema } from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

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

const orgUnitIdParamSchema = z.object({
  id: z.string().uuid(),
})

async function assertNoParentCycle(
  prisma: DbClient,
  tenantId: string,
  orgUnitId: string,
  parentId: string,
) {
  let currentId: string | null = parentId

  while (currentId) {
    if (currentId === orgUnitId) {
      throw new AppError(409, 'CONFLICT', 'Org unit cannot be its own ancestor')
    }

    const parentRow: { parentId: string | null } | null = await prisma.orgUnit.findFirst({
      where: { id: currentId, tenantId },
      select: { parentId: true },
    })

    if (!parentRow) {
      throw new AppError(404, 'NOT_FOUND', 'Parent org unit not found')
    }

    currentId = parentRow.parentId
  }
}

function toDto(row: {
  id: string
  name: string
  tenantId: string
  parentId: string | null
  createdAt: Date
  updatedAt: Date
}): OrgUnit {
  return {
    id: row.id,
    name: row.name,
    tenantId: row.tenantId,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createOrgUnitsRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')

      const rows = await prisma.orgUnit.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      })

      return c.json(listOrgUnitsResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )

  app.post(
    '/',
    requireRole('owner', 'hr_admin'),
    zValidator('json', createOrgUnitRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const body: CreateOrgUnitRequest = c.req.valid('json')

      const row = await prisma.orgUnit.create({
        data: {
          tenantId,
          name: body.name,
          parentId: body.parentId ?? null,
        },
      })

      c.set('auditEntry', {
        action: 'org_unit.create',
        entityType: 'OrgUnit',
        entityId: row.id,
        diff: body,
      })

      return c.json(toDto(row), 201)
    },
  )

  app.patch(
    '/:id',
    requireRole('owner', 'hr_admin'),
    zValidator('param', orgUnitIdParamSchema),
    zValidator('json', updateOrgUnitRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.valid('param')
      const body: UpdateOrgUnitRequest = c.req.valid('json')

      const existing = await prisma.orgUnit.findFirst({
        where: { id, tenantId },
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Org unit not found')

      if (body.parentId === id) {
        throw new AppError(409, 'CONFLICT', 'Org unit cannot be its own parent')
      }

      if (body.parentId !== undefined && body.parentId !== null) {
        await assertNoParentCycle(prisma, tenantId, id, body.parentId)
      }

      const updated = await prisma.orgUnit.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          parentId: body.parentId,
        },
      })

      c.set('auditEntry', {
        action: 'org_unit.update',
        entityType: 'OrgUnit',
        entityId: updated.id,
        diff: body,
      })

      return c.json(toDto(updated))
    },
  )

  app.delete(
    '/:id',
    requireRole('owner', 'hr_admin'),
    zValidator('param', orgUnitIdParamSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.valid('param')

      const existing = await prisma.orgUnit.findFirst({
        where: { id, tenantId },
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Org unit not found')

      const [childrenCount, requisitionsCount, vacanciesCount, employeesCount, learningCoursesCount] = await Promise.all([
        prisma.orgUnit.count({ where: { tenantId, parentId: id } }),
        prisma.hiringRequisition.count({ where: { tenantId, orgUnitId: id } }),
        prisma.vacancy.count({ where: { tenantId, orgUnitId: id } }),
        prisma.employee.count({ where: { tenantId, orgUnitId: id } }),
        prisma.learningCourse.count({ where: { tenantId, orgUnitId: id } }),
      ])

      if (childrenCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Cannot delete org unit: child org units exist')
      }
      if (requisitionsCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Cannot delete org unit: referenced by requisitions')
      }
      if (vacanciesCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Cannot delete org unit: referenced by vacancies')
      }
      if (employeesCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Cannot delete org unit: referenced by employees')
      }
      if (learningCoursesCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Cannot delete org unit: referenced by learning courses')
      }

      await prisma.orgUnit.delete({
        where: { id },
      })

      c.set('auditEntry', {
        action: 'org_unit.delete',
        entityType: 'OrgUnit',
        entityId: id,
        diff: {},
      })

      return c.json({ ok: true })
    },
  )

  return app
}
