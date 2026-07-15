import type { PublishVacancyRequest, UpdateVacancyRoleRequest, UpdateVacancyAssessmentTemplatesRequest, UpdateVacancyRequest, Vacancy } from '@web-app-demo/contracts'
import {
  listVacanciesResponseSchema,
  publishVacancyRequestSchema,
  updateVacancyRoleRequestSchema,
  updateVacancyAssessmentTemplatesRequestSchema,
  updateVacancyRequestSchema,
  vacancyRoleSchema,
  vacancySchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { generateSlug } from './slug'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

function parseVacancyRole(value: string | null): Vacancy['role'] {
  if (value == null) return null
  const result = vacancyRoleSchema.safeParse(value)
  return result.success ? result.data : null
}

function toDto(row: {
  id: string
  title: string
  description: string
  role: string | null
  requiredAssessmentTemplateIds: string[]
  isPublished: boolean
  tenantId: string
  requisitionId: string
  orgUnitId: string
  slug: string | null
  hhVacancyId: string | null
  createdAt: Date
  updatedAt: Date
}): Vacancy {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    role: parseVacancyRole(row.role),
    requiredAssessmentTemplateIds: row.requiredAssessmentTemplateIds,
    isPublished: row.isPublished,
    tenantId: row.tenantId,
    requisitionId: row.requisitionId,
    orgUnitId: row.orgUnitId,
    slug: row.slug,
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
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateVacancyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body: UpdateVacancyRequest = c.req.valid('json')

      const existing = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      const data: { title?: string; description?: string } = {}
      if (body.title !== undefined) data.title = body.title
      if (body.description !== undefined) data.description = body.description

      const updated = await prisma.vacancy.update({ where: { id }, data })

      c.set('auditEntry', {
        action: 'vacancy.update',
        entityType: 'Vacancy',
        entityId: id,
        diff: data,
      })

      return c.json(vacancySchema.parse(toDto(updated)))
    },
  )

  app.patch(
    '/:id/role',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateVacancyRoleRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body: UpdateVacancyRoleRequest = c.req.valid('json')

      const existing = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      const updated = await prisma.vacancy.update({
        where: { id },
        data: { role: body.role },
      })

      c.set('auditEntry', {
        action: 'vacancy.role.update',
        entityType: 'Vacancy',
        entityId: id,
        diff: { role: body.role },
      })

      return c.json(vacancySchema.parse(toDto(updated)))
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

      // Auto-generate a URL-safe slug from the title when publishing for the
      // first time (slug stays fixed once set — re-publishing does not change it).
      let slug = existing.slug
      if (body.isPublished && !slug) {
        slug = await generateSlug(existing.title, tenantId, prisma)
      }

      const updated = await prisma.vacancy.update({
        where: { id },
        data: { isPublished: body.isPublished, ...(slug !== existing.slug ? { slug } : {}) },
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

  app.patch(
    '/:id/assessment-templates',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateVacancyAssessmentTemplatesRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body: UpdateVacancyAssessmentTemplatesRequest = c.req.valid('json')

      const existing = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      const ids = body.requiredAssessmentTemplateIds ?? []
      if (ids.length > 0) {
        const templates = await prisma.assessmentTemplate.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true },
        })
        if (templates.length !== ids.length) {
          throw new AppError(422, 'VALIDATION_ERROR', 'Some assessment template IDs are invalid or do not belong to this tenant')
        }
      }

      const updated = await prisma.vacancy.update({
        where: { id },
        data: { requiredAssessmentTemplateIds: ids },
      })

      c.set('auditEntry', {
        action: 'vacancy.assessment_templates.update',
        entityType: 'Vacancy',
        entityId: id,
        diff: { requiredAssessmentTemplateIds: ids },
      })

      return c.json(vacancySchema.parse(toDto(updated)))
    },
  )

  return app
}
