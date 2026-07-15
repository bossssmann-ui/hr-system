/**
 * Phase 12 — Tenant lifecycle, settings, billing, GDPR endpoints.
 *
 * Auth: registration is intentionally unauthenticated (gated by the
 * TENANT_REGISTRATION_ENABLED flag). Every other route requires `owner`.
 *
 * The HTTP layer is thin: parsing/validation lives in contracts, business
 * logic lives in `tenant.service.ts`. We deliberately reuse the existing
 * AuthService session helpers via `c.get('authService')` for the post-register
 * auto-login so newly registered owners get a session immediately.
 */

import {
  billingStatusResponseSchema,
  candidateDataExportSchema,
  employeeDataExportSchema,
  eraseCandidateResponseSchema,
  registerTenantRequestSchema,
  registerTenantResponseSchema,
  retentionRunResponseSchema,
  tenantSettingsSchema,
  updateTenantSettingsRequestSchema,
} from '@web-app-demo/contracts'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

import type { AuthService } from '../../auth/service'
import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  eraseCandidate,
  exportCandidateData,
  exportEmployeeData,
  getBillingStatus,
  getTenantSettings,
  registerTenant,
  runDataRetention,
  updateTenantSettings,
} from './tenant.service'

type CommonBindings = {
  Variables: {
    env: AppEnv
    prisma: DbClient
    authService: AuthService
    auditEntry?: unknown
  }
}

type OwnerBindings = RoleGuardBindings & CommonBindings

function asKnownError(err: unknown): { code?: string; message: string } | null {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return { code: String((err as { code: unknown }).code), message: String((err as { message: unknown }).message) }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — POST /api/register
// ─────────────────────────────────────────────────────────────────────────────

export function createTenantRegistrationRoutes() {
  const app = new Hono<CommonBindings>()

  app.post('/', zValidator('json', registerTenantRequestSchema), async (c) => {
    const env = c.get('env')
    if (!env.TENANT_REGISTRATION_ENABLED) {
      throw new AppError(403, 'FORBIDDEN', 'Tenant registration is disabled')
    }

    const prisma = c.get('prisma')
    const body = c.req.valid('json')

    let registration
    try {
      registration = await registerTenant(prisma, body)
    } catch (err) {
      const known = asKnownError(err)
      if (known?.code === 'CONFLICT_SLUG') {
        throw new AppError(409, 'CONFLICT', 'Tenant slug already taken')
      }
      if (known?.code === 'CONFLICT_EMAIL') {
        throw new AppError(409, 'CONFLICT', 'User with this email already exists')
      }
      throw err
    }

    // Bootstrap a session for the new owner so they land on the dashboard
    // authenticated. login() uses the just-persisted password; safer than
    // exposing raw issueSession from AuthService.
    const auth = c.get('authService')
    const session = await auth.login(
      { email: body.ownerEmail, password: body.ownerPassword },
      { userAgent: c.req.header('user-agent'), ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() },
    )

    const payload = {
      tenant: registration.tenant,
      user: {
        id: registration.user.id,
        email: registration.user.email,
        displayName: registration.user.displayName,
        roles: registration.user.roles,
        createdAt: registration.user.createdAt.toISOString(),
      },
      accessToken: session.accessToken,
      refreshToken: c.req.header('x-client-platform') === 'mobile' ? session.refreshToken : undefined,
    }

    return c.json(registerTenantResponseSchema.parse(payload), 201)
  })

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner / HR admin — /api/settings/tenant
// ─────────────────────────────────────────────────────────────────────────────

export function createTenantSettingsRoutes() {
  const app = new Hono<OwnerBindings>()

  app.get('/', requireRole('owner', 'hr_admin'), async (c) => {
    const settings = await getTenantSettings(c.get('prisma'), c.get('tenantId'))
    return c.json(tenantSettingsSchema.parse(settings))
  })

  app.patch(
    '/',
    requireRole('owner', 'hr_admin'),
    zValidator('json', updateTenantSettingsRequestSchema),
    async (c) => {
      const settings = await updateTenantSettings(
        c.get('prisma'),
        c.get('tenantId'),
        c.req.valid('json'),
      )
      c.set('auditEntry', {
        action: 'tenant.settings_updated',
        entityType: 'Tenant',
        entityId: c.get('tenantId'),
        diff: c.req.valid('json'),
      })
      return c.json(tenantSettingsSchema.parse(settings))
    },
  )

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner — admin retention + billing routes (mounted under /api/admin)
// ─────────────────────────────────────────────────────────────────────────────

export function createTenantAdminRoutes() {
  const app = new Hono<OwnerBindings>()

  app.post('/retention/run', requireRole('owner'), async (c) => {
    const result = await runDataRetention(c.get('prisma'), { tenantId: c.get('tenantId') })
    return c.json(retentionRunResponseSchema.parse(result))
  })

  app.get('/billing', requireRole('owner'), async (c) => {
    const env = c.get('env')
    const status = await getBillingStatus(c.get('prisma'), {
      tenantId: c.get('tenantId'),
      billingEnabled: env.BILLING_ENABLED,
    })
    return c.json(billingStatusResponseSchema.parse(status))
  })

  return app
}

// ─────────────────────────────────────────────────────────────────────────────
// GDPR — erase + data export bolted onto /api/candidates and /api/employees
// ─────────────────────────────────────────────────────────────────────────────

export function createCandidateComplianceRoutes() {
  const app = new Hono<OwnerBindings>()

  app.post('/:id/erase', requireRole('owner', 'hr_admin'), async (c) => {
    const id = c.req.param('id')
    try {
      await eraseCandidate(c.get('prisma'), {
        tenantId: c.get('tenantId'),
        candidateId: id,
        actorUserId: c.get('userId'),
      })
    } catch (err) {
      const known = asKnownError(err)
      if (known?.code === 'NOT_FOUND') {
        throw new AppError(404, 'NOT_FOUND', 'Candidate not found')
      }
      throw err
    }
    return c.json(eraseCandidateResponseSchema.parse({ id, status: 'erased' }))
  })

  app.get('/:id/data-export', requireRole('owner', 'hr_admin'), async (c) => {
    try {
      const data = await exportCandidateData(c.get('prisma'), {
        tenantId: c.get('tenantId'),
        candidateId: c.req.param('id'),
      })
      return c.json(candidateDataExportSchema.parse(data))
    } catch (err) {
      const known = asKnownError(err)
      if (known?.code === 'NOT_FOUND') {
        throw new AppError(404, 'NOT_FOUND', 'Candidate not found')
      }
      throw err
    }
  })

  return app
}

export function createEmployeeComplianceRoutes() {
  const app = new Hono<OwnerBindings>()

  app.get('/:id/data-export', requireRole('owner', 'hr_admin'), async (c) => {
    try {
      const data = await exportEmployeeData(c.get('prisma'), {
        tenantId: c.get('tenantId'),
        employeeId: c.req.param('id'),
      })
      return c.json(employeeDataExportSchema.parse(data))
    } catch (err) {
      const known = asKnownError(err)
      if (known?.code === 'NOT_FOUND') {
        throw new AppError(404, 'NOT_FOUND', 'Employee not found')
      }
      throw err
    }
  })

  return app
}
