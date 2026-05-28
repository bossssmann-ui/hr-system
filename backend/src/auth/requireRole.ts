/**
 * Shared role guard middleware.
 *
 * Verifies the bearer access token, loads the user's roles + tenant
 * memberships from `UserRole`, and attaches `userId`, `tenantId`, and `roles`
 * to the Hono context. Routes call `requireRole(...)` with the set of roles
 * allowed to reach the handler. Used everywhere instead of copy-pasting role
 * checks (see `docs/contracts/50-coding-standards.md`).
 *
 * Phase 0 assumption: a user has exactly one tenant in `UserRole`. When
 * multi-tenant memberships land we will switch to an explicit
 * `X-Tenant-Id` header (validated against the user's memberships) plus
 * `SET LOCAL app.tenant_id` per request.
 */

import type { Context, MiddlewareHandler } from 'hono'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { AppError } from '../http/errors'
import { verifyAccessToken } from './access-tokens'
import type { RoleName } from '../generated/prisma/enums'

export type RoleGuardBindings = {
  Variables: {
    userId: string
    tenantId: string
    roles: RoleName[]
  }
}

type DepsBindings = {
  Variables: {
    env: AppEnv
  }
}

function getPrisma(c: Context): DbClient {
  const prisma = (c.get as unknown as (k: string) => DbClient | undefined)('prisma')
  if (!prisma) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Prisma client missing on context')
  }
  return prisma
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

export function requireRole(...allowed: RoleName[]): MiddlewareHandler<RoleGuardBindings & DepsBindings> {
  return async (c, next) => {
    const env = c.get('env')
    const token = extractBearerToken(c.req.header('Authorization'))
    if (!token) {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is required')
    }

    const payload = await verifyAccessToken(token, env).catch(() => {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is invalid or expired')
    })

    const prisma = getPrisma(c)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { disabledAt: true },
    })

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Access token is invalid or expired')
    }
    if (user.disabledAt) {
      throw new AppError(403, 'FORBIDDEN', 'Account disabled')
    }

    const memberships = await prisma.userRole.findMany({
      where: { userId: payload.sub },
      select: { role: true, tenantId: true },
    })

    if (memberships.length === 0) {
      throw new AppError(403, 'FORBIDDEN', 'User has no tenant memberships')
    }

    // Phase 0: single tenant per user — take the first membership's tenant.
    const tenantId = memberships[0]!.tenantId
    const roles = memberships
      .filter((m) => m.tenantId === tenantId)
      .map((m) => m.role)

    if (allowed.length > 0 && !roles.some((r) => allowed.includes(r))) {
      throw new AppError(403, 'FORBIDDEN', 'Caller does not have the required role')
    }

    c.set('userId', payload.sub)
    c.set('tenantId', tenantId)
    c.set('roles', roles)
    await next()
  }
}
