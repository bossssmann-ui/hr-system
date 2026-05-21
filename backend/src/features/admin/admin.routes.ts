import {
  listAuditEventsResponseSchema,
  listUsersResponseSchema,
} from '@web-app-demo/contracts'
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
  }
}

export function createAdminRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── Users ─────────────────────────────────────────────────────────────────

  app.get('/users', requireRole('owner', 'hr_admin'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')

    const roles = await prisma.userRole.findMany({
      where: { tenantId },
      include: { user: true },
      orderBy: { user: { createdAt: 'asc' } },
    })

    // Group by userId.
    const map = new Map<
      string,
      { id: string; email: string; displayName: string | null; roles: string[]; createdAt: string }
    >()
    for (const r of roles) {
      const existing = map.get(r.userId)
      if (existing) {
        existing.roles.push(r.role)
      } else {
        map.set(r.userId, {
          id: r.user.id,
          email: r.user.email,
          displayName: r.user.displayName,
          roles: [r.role],
          createdAt: r.user.createdAt.toISOString(),
        })
      }
    }

    return c.json(
      listUsersResponseSchema.parse({ items: Array.from(map.values()) }),
    )
  })

  // ─── Audit events ──────────────────────────────────────────────────────────

  app.get(
    '/audit-events',
    requireRole('owner', 'hr_admin'),
    zValidator(
      'query',
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        actorUserId: z.string().optional(),
        entityType: z.string().optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { cursor, limit, actorUserId, entityType } = c.req.valid('query')

      const rows = await prisma.auditEvent.findMany({
        where: {
          tenantId,
          ...(actorUserId ? { actorUserId } : {}),
          ...(entityType ? { entityType } : {}),
          ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null

      return c.json(
        listAuditEventsResponseSchema.parse({
          items: items.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            actorUserId: r.actorUserId,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            diff: r.diff,
            ip: r.ip,
            userAgent: r.userAgent,
            createdAt: r.createdAt.toISOString(),
          })),
          nextCursor,
        }),
      )
    },
  )

  return app
}
