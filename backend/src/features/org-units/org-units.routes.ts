import type { CreateOrgUnitRequest, OrgUnit } from '@web-app-demo/contracts'
import { createOrgUnitRequestSchema, listOrgUnitsResponseSchema } from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
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

  return app
}
