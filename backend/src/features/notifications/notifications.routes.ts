/**
 * Notifications routes — Phase 10.
 *
 * REST surface that backs the in-app notification bell. Pairs with the
 * realtime SSE stream (`/api/realtime/events`): the stream pushes thin
 * `notification.new` events and the client invalidates the React Query that
 * hits these endpoints to repaint the bell + dropdown.
 *
 *   GET    /api/notifications              — paginated list (newest first)
 *   PATCH  /api/notifications/:id/read     — mark a single notification read
 *   POST   /api/notifications/read-all     — mark every unread notification read
 *   DELETE /api/notifications/:id          — delete one notification
 *
 * RLS keeps a user from seeing anyone else's rows, but we still scope the
 * queries by `tenantId` + `recipientUserId` defensively — same convention as
 * the messaging and applications routes.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import {
  listNotificationsResponseSchema,
  markNotificationsReadResponseSchema,
  notificationSchema,
  type Notification as NotificationDto,
} from '@web-app-demo/contracts'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'
import type { NotificationChannel as DbNotificationChannel } from '../../generated/prisma/enums'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    prisma: DbClient
    auditEntry?: unknown
  }
}

type NotificationRow = {
  id: string
  tenantId: string
  recipientUserId: string
  channel: DbNotificationChannel
  template: string
  payload: unknown
  readAt: Date | null
  createdAt: Date
}

function toDto(row: NotificationRow): NotificationDto {
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}
  return notificationSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    recipientUserId: row.recipientUserId,
    channel: row.channel,
    template: row.template,
    payload,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  })
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  unread: z.enum(['true', 'false']).optional(),
})

export function createNotificationsRoutes() {
  const app = new Hono<RouteBindings>()

  // Every authenticated app user can read & manage their own notifications,
  // including candidates (they receive offer.* and assessment.* notifications).
  const guard = requireRole(
    'owner',
    'hr_admin',
    'recruiter',
    'hiring_manager',
    'employee',
    'candidate',
  )

  app.get('/', guard, zValidator('query', listQuerySchema), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { limit, unread } = c.req.valid('query')

    const where = {
      tenantId,
      recipientUserId: userId,
      ...(unread === 'true' ? { readAt: null } : {}),
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit ?? 30,
      }),
      prisma.notification.count({
        where: { tenantId, recipientUserId: userId, readAt: null },
      }),
    ])

    return c.json(
      listNotificationsResponseSchema.parse({
        items: rows.map(toDto),
        unreadCount,
      }),
    )
  })

  app.patch('/:id/read', guard, async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { id } = c.req.param()

    const existing = await prisma.notification.findFirst({
      where: { id, tenantId, recipientUserId: userId },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Notification not found')

    if (existing.readAt) {
      return c.json(notificationSchema.parse(toDto(existing)))
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    })

    c.set('auditEntry', {
      action: 'notification.read',
      entityType: 'Notification',
      entityId: id,
    })

    return c.json(notificationSchema.parse(toDto(updated)))
  })

  app.post('/read-all', guard, async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const result = await prisma.notification.updateMany({
      where: { tenantId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    })

    c.set('auditEntry', {
      action: 'notification.read_all',
      entityType: 'Notification',
      entityId: userId,
    })

    return c.json(
      markNotificationsReadResponseSchema.parse({ updated: result.count }),
    )
  })

  app.delete('/:id', guard, async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { id } = c.req.param()

    const existing = await prisma.notification.findFirst({
      where: { id, tenantId, recipientUserId: userId },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Notification not found')

    await prisma.notification.delete({ where: { id } })

    c.set('auditEntry', {
      action: 'notification.delete',
      entityType: 'Notification',
      entityId: id,
    })

    return c.body(null, 204)
  })

  return app
}
