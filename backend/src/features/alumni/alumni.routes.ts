import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'

const alumniStatusSchema = z.enum(['active', 'do_not_rehire', 'archived'])

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient }
}

export function createAlumniRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('hr_admin', 'owner'),
    zValidator(
      'query',
      z.object({
        status: alumniStatusSchema.optional(),
        tags: z.string().optional(),
        orgUnitId: z.string().uuid().optional(),
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { status, tags, orgUnitId, page, limit } = c.req.valid('query')

      const where = {
        tenantId,
        ...(status ? { status } : {}),
        ...(tags ? { tags: { hasSome: tags.split(',').map((tag) => tag.trim()).filter(Boolean) } } : {}),
        ...(orgUnitId ? { employee: { orgUnitId } } : {}),
      }

      const [items, total] = await Promise.all([
        prisma.alumniProfile.findMany({
          where,
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                jobTitle: true,
                terminatedAt: true,
                orgUnit: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.alumniProfile.count({ where }),
      ])

      return c.json({ items, total, page, limit })
    },
  )

  app.get('/:id', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const profile = await prisma.alumniProfile.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            jobTitle: true,
            grade: true,
            terminatedAt: true,
            terminationGround: true,
            hireDate: true,
            orgUnit: { select: { id: true, name: true } },
          },
        },
        candidate: { select: { id: true, fullName: true, email: true } },
      },
    })

    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Alumni profile not found')
    return c.json(profile)
  })

  app.patch(
    '/:id',
    requireRole('hr_admin', 'owner'),
    zValidator(
      'json',
      z.object({
        status: alumniStatusSchema.optional(),
        wouldRehire: z.boolean().optional(),
        departureReason: z.string().optional(),
        rehireEligibleFrom: z.string().date().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.alumniProfile.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Alumni profile not found')

      const updated = await prisma.alumniProfile.update({
        where: { id },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.wouldRehire !== undefined ? { wouldRehire: body.wouldRehire } : {}),
          ...(body.departureReason !== undefined ? { departureReason: body.departureReason } : {}),
          ...(body.rehireEligibleFrom !== undefined ? { rehireEligibleFrom: new Date(body.rehireEligibleFrom) } : {}),
          ...(body.tags !== undefined ? { tags: body.tags } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      })

      return c.json(updated)
    },
  )

  return app
}
