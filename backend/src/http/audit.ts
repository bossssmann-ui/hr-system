/**
 * Audit middleware + secret redaction helper.
 *
 * Contract (see `docs/contracts/40-audit.md`):
 *
 *   - Mutating routes (POST / PATCH / PUT / DELETE) declare an audit entry by
 *     calling `c.set('auditEntry', { action, entityType, entityId, diff? })`
 *     somewhere during the handler. After the response is sent with a
 *     successful (`< 400`) status code, this middleware writes one
 *     `AuditEvent` row to the database.
 *   - Failure to write the audit row is logged at error level but never rolls
 *     back the business transaction or fails the response.
 *   - `redact()` strips passwords, tokens, JWT-like strings, and any field
 *     whose name matches a secret pattern before the diff hits the database.
 *     This is the canonical scrubber referenced by `docs/contracts/50-coding-standards.md`.
 *
 * The middleware is wired in `backend/src/app.ts`; per-domain routes that
 * land in Phase 0.x can drop a `c.set('auditEntry', …)` call and inherit
 * audit-log behaviour for free.
 */

import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../db'
import { Prisma } from '../generated/prisma/client'

export type AuditEntry = {
  action: string
  entityType: string
  entityId: string
  diff?: unknown
}

type AuditBindings = {
  Variables: {
    auditEntry?: AuditEntry
    userId?: string
    tenantId?: string
  }
}

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

// Sensitive key names compared case-insensitively after stripping separators.
// Catches both snake_case (`password_hash`) and camelCase (`passwordHash`).
const SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'passwordconfirm',
  'refreshtoken',
  'refreshtokenhash',
  'accesstoken',
  'token',
  'secret',
  'apikey',
  'privatekey',
  'otp',
  '2fa',
  'cookie',
  'authorization',
])

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
}

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

type Logger = {
  error: (data: Record<string, unknown>, msg: string) => void
}

const defaultLogger: Logger = {
  error: (data, msg) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
}

/**
 * Recursively strip secrets from `value`. Sensitive scalars are replaced with
 * `'[redacted]'`; sensitive object keys are removed entirely. The function is
 * pure and never throws — callers can rely on it inside a `catch`-free path.
 */
export function redact(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    return JWT_PATTERN.test(value) ? '[redacted]' : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v))

  const result: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      result[key] = '[redacted]'
      continue
    }
    result[key] = redact(v)
  }
  return result
}

export type CreateAuditMiddlewareOptions = {
  prisma: DbClient
  logger?: Logger
  /**
   * When true, audit writes happen asynchronously after the response is built.
   * Production defaults to false so successful mutating requests do not depend
   * on a microtask that can be lost during process shutdown.
   */
  async?: boolean
}

export function createAuditMiddleware({
  prisma,
  logger = defaultLogger,
  async: isAsync = false,
}: CreateAuditMiddlewareOptions): MiddlewareHandler<AuditBindings> {
  return async (c, next) => {
    await next()

    if (!MUTATING_METHODS.has(c.req.method)) return
    if (c.res.status >= 400) return

    const entry = c.get('auditEntry')
    if (!entry) return

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null
    const userAgent = c.req.header('user-agent') ?? null
    const actorUserId = c.get('userId') ?? null
    const tenantId = c.get('tenantId') ?? null

    const row = {
      tenantId: tenantId ?? '',
      actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      diff: redact(entry.diff ?? {}) as Prisma.InputJsonValue,
      ip,
      userAgent,
    }

    const write = async () => {
      if (!row.tenantId) {
        logger.error({ entry }, 'audit.write_skipped_no_tenant')
        return
      }
      try {
        await prisma.auditEvent.create({
          data: {
            tenantId: row.tenantId,
            actorUserId: row.actorUserId,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            diff: row.diff,
            ip: row.ip,
            userAgent: row.userAgent,
          },
        })
      } catch (err) {
        logger.error({ err, entry }, 'audit.write_failed')
      }
    }

    if (isAsync) {
      queueMicrotask(() => {
        void write()
      })
    } else {
      await write()
    }
  }
}
