/**
 * Phase 11 — Device tokens for mobile push notifications.
 *
 * Routes:
 *   POST   /api/devices       — register an Expo push token for the caller
 *   GET    /api/devices       — list the caller's active devices
 *   DELETE /api/devices/:id   — unregister (soft-delete) a device token
 *
 * Tokens are scoped to the authenticated user and unique per (user, token);
 * re-registering the same token simply re-activates it (idempotent).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  deviceTokenSchema,
  listDevicesResponseSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  type DeviceToken as DeviceTokenDto,
} from '@web-app-demo/contracts'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    prisma: DbClient
    auditEntry?: unknown
  }
}

type DeviceTokenRow = {
  id: string
  platform: 'ios' | 'android' | 'web'
  token: string
  isActive: boolean
  createdAt: Date
}

function toDto(row: DeviceTokenRow): DeviceTokenDto {
  return deviceTokenSchema.parse({
    id: row.id,
    platform: row.platform,
    token: row.token,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
  })
}

export function createDevicesRoutes() {
  const app = new Hono<RouteBindings>()

  // Anyone with a logged-in app session can manage their own devices:
  // both HR staff and employees use the mobile app.
  const guard = requireRole(
    'owner',
    'hr_admin',
    'recruiter',
    'hiring_manager',
    'employee',
    'candidate',
  )

  app.post('/', guard, zValidator('json', registerDeviceRequestSchema), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { platform, token } = c.req.valid('json')

    // Idempotent upsert keyed on (user_id, token).
    const row = await prisma.deviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { tenantId, userId, platform, token, isActive: true },
      update: { platform, isActive: true, tenantId },
    })

    c.set('auditEntry', {
      action: 'device.register',
      entityType: 'DeviceToken',
      entityId: row.id,
      diff: { platform },
    })

    return c.json(registerDeviceResponseSchema.parse({ device: toDto(row) }), 201)
  })

  app.get('/', guard, async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const rows = await prisma.deviceToken.findMany({
      where: { tenantId, userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return c.json(listDevicesResponseSchema.parse({ items: rows.map(toDto) }))
  })

  app.delete('/:id', guard, async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const { id } = c.req.param()

    const existing = await prisma.deviceToken.findFirst({
      where: { id, tenantId, userId },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Device not found')

    // Soft-delete keeps history + lets the same token be re-registered.
    await prisma.deviceToken.update({
      where: { id },
      data: { isActive: false },
    })

    c.set('auditEntry', {
      action: 'device.unregister',
      entityType: 'DeviceToken',
      entityId: id,
    })

    return c.body(null, 204)
  })

  return app
}
