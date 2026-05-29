/**
 * Phase 9 — Knowledge Hub CRUD + search routes.
 *
 *   GET    /api/knowledge          — list articles
 *   POST   /api/knowledge          — create (admin)
 *   PATCH  /api/knowledge/:id      — update (admin)
 *   DELETE /api/knowledge/:id      — soft-delete (admin)
 *   POST   /api/knowledge/search   — text/semantic search
 *
 * Visibility:
 *   - `internal` (default) — hr_admin / owner / hiring_manager / recruiter
 *   - `portal`             — additionally visible to `employee` via /api/portal
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { searchKnowledge } from './knowledge.service'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient; auditEntry?: unknown }
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  visibility: z.enum(['internal', 'portal']).default('internal'),
})

const updateSchema = createSchema.partial()

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  visibility: z.enum(['internal', 'portal']).optional(),
})

function articleToDto(row: {
  id: string
  title: string
  body: string
  tags: string[]
  visibility: string
  createdByUserId: string
  updatedByUserId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createKnowledgeRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'recruiter'),
    zValidator(
      'query',
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        tag: z.string().optional(),
        visibility: z.enum(['internal', 'portal']).optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { limit, tag, visibility } = c.req.valid('query')
      const rows = await prisma.knowledgeArticle.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(tag ? { tags: { has: tag } } : {}),
          ...(visibility ? { visibility } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      })
      return c.json({ items: rows.map(articleToDto) })
    },
  )

  app.post(
    '/',
    requireRole('hr_admin', 'owner'),
    zValidator('json', createSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const created = await prisma.knowledgeArticle.create({
        data: {
          tenantId,
          title: body.title,
          body: body.body,
          tags: body.tags,
          visibility: body.visibility,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
      })
      c.set('auditEntry', {
        action: 'knowledge.article_created',
        entityType: 'KnowledgeArticle',
        entityId: created.id,
        diff: { title: created.title, visibility: created.visibility },
      })
      return c.json(articleToDto(created), 201)
    },
  )

  app.patch(
    '/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', updateSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const patch = c.req.valid('json')

      const existing = await prisma.knowledgeArticle.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Article not found')

      const updated = await prisma.knowledgeArticle.update({
        where: { id },
        data: {
          ...(patch.title != null ? { title: patch.title } : {}),
          ...(patch.body != null ? { body: patch.body } : {}),
          ...(patch.tags != null ? { tags: patch.tags } : {}),
          ...(patch.visibility != null ? { visibility: patch.visibility } : {}),
          updatedByUserId: userId,
        },
      })
      c.set('auditEntry', {
        action: 'knowledge.article_updated',
        entityType: 'KnowledgeArticle',
        entityId: id,
        diff: { fields: Object.keys(patch) },
      })
      return c.json(articleToDto(updated))
    },
  )

  app.delete(
    '/:id',
    requireRole('hr_admin', 'owner'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const existing = await prisma.knowledgeArticle.findFirst({ where: { id, tenantId, deletedAt: null } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Article not found')

      await prisma.knowledgeArticle.update({
        where: { id },
        data: { deletedAt: new Date(), updatedByUserId: userId },
      })
      c.set('auditEntry', {
        action: 'knowledge.article_deleted',
        entityType: 'KnowledgeArticle',
        entityId: id,
        diff: { actor: userId },
      })
      return c.json({ ok: true })
    },
  )

  app.post(
    '/search',
    requireRole('hr_admin', 'owner', 'hiring_manager', 'recruiter', 'employee'),
    zValidator('json', searchSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const { query, limit, visibility } = c.req.valid('json')

      // Employees may only search portal-visible content.
      const isEmployeeOnly = roles.length === 1 && roles[0] === 'employee'
      const effectiveVisibility = isEmployeeOnly ? 'portal' : visibility

      const hits = await searchKnowledge({
        prisma,
        tenantId,
        query,
        limit,
        visibility: effectiveVisibility,
      })
      return c.json({ items: hits, mode: 'text' as const })
    },
  )

  return app
}
