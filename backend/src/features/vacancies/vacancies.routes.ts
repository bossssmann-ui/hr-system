import type { PublishVacancyRequest, Vacancy } from '@web-app-demo/contracts'
import {
  listVacanciesResponseSchema,
  publishVacancyRequestSchema,
  vacancySchema,
} from '@web-app-demo/contracts'
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

function toDto(row: {
  id: string
  title: string
  description: string
  isPublished: boolean
  tenantId: string
  requisitionId: string
  orgUnitId: string
  hhVacancyId: string | null
  createdAt: Date
  updatedAt: Date
}): Vacancy {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isPublished: row.isPublished,
    tenantId: row.tenantId,
    requisitionId: row.requisitionId,
    orgUnitId: row.orgUnitId,
    hhVacancyId: row.hhVacancyId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createVacanciesRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', z.object({ is_published: z.enum(['true', 'false']).optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { is_published } = c.req.valid('query')

      const rows = await prisma.vacancy.findMany({
        where: {
          tenantId,
          ...(is_published !== undefined ? { isPublished: is_published === 'true' } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      return c.json(listVacanciesResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      return c.json(vacancySchema.parse(toDto(row)))
    },
  )

  app.patch(
    '/:id/publish',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', publishVacancyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body: PublishVacancyRequest = c.req.valid('json')

      const existing = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      const updated = await prisma.vacancy.update({
        where: { id },
        data: { isPublished: body.isPublished },
      })

      c.set('auditEntry', {
        action: 'vacancy.publish',
        entityType: 'Vacancy',
        entityId: id,
        diff: { isPublished: body.isPublished },
      })

      return c.json(vacancySchema.parse(toDto(updated)))
    },
  )

  return app
}
