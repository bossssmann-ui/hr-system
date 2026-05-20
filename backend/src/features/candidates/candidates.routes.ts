import type { Candidate, CreateCandidateRequest } from '@web-app-demo/contracts'
import {
  candidateSchema,
  createCandidateRequestSchema,
  createCandidateResponseSchema,
  listCandidatesResponseSchema,
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
  tenantId: string
  fullName: string
  email: string | null
  phone: string | null
  location: string | null
  source: string
  createdAt: Date
  updatedAt: Date
}): Candidate {
  return {
    id: row.id,
    tenantId: row.tenantId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    location: row.location,
    source: row.source as Candidate['source'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createCandidatesRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', z.object({ q: z.string().optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { q } = c.req.valid('query')

      const rows = await prisma.candidate.findMany({
        where: {
          tenantId,
          ...(q
            ? {
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                  { phone: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })

      return c.json(listCandidatesResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.candidate.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Candidate not found')

      return c.json(candidateSchema.parse(toDto(row)))
    },
  )

  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createCandidateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const body: CreateCandidateRequest = c.req.valid('json')

      // Dedup: look for existing candidate with same non-null email or phone.
      let existing: Awaited<ReturnType<typeof prisma.candidate.findFirst>> | null = null
      if (body.email || body.phone) {
        const conditions: Array<{ tenantId: string; email?: string; phone?: string }> = []
        if (body.email) conditions.push({ tenantId, email: body.email })
        if (body.phone) conditions.push({ tenantId, phone: body.phone })
        existing = await prisma.candidate.findFirst({
          where: { OR: conditions },
        })
      }

      if (existing) {
        return c.json(
          createCandidateResponseSchema.parse({ candidate: toDto(existing), deduped: true }),
          200,
        )
      }

      const row = await prisma.candidate.create({
        data: {
          tenantId,
          fullName: body.fullName,
          email: body.email ?? null,
          phone: body.phone ?? null,
          location: body.location ?? null,
          source: 'manual',
        },
      })

      c.set('auditEntry', {
        action: 'candidate.create',
        entityType: 'Candidate',
        entityId: row.id,
        diff: body,
      })

      return c.json(
        createCandidateResponseSchema.parse({ candidate: toDto(row), deduped: false }),
        201,
      )
    },
  )

  return app
}
