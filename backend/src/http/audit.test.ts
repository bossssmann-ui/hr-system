import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { createAuditMiddleware, redact } from './audit'

describe('audit.redact', () => {
  test('strips well-known secret keys', () => {
    const result = redact({
      email: 'a@b.com',
      passwordHash: 'argon2id$...',
      password: 'plaintext',
      refreshToken: 'rt',
      accessToken: 'at',
      apiKey: 'k',
      privateKey: 'p',
      otp: '123456',
      Authorization: 'Bearer xyz',
    }) as Record<string, unknown>
    expect(result.email).toBe('a@b.com')
    expect(result.passwordHash).toBe('[redacted]')
    expect(result.password).toBe('[redacted]')
    expect(result.refreshToken).toBe('[redacted]')
    expect(result.accessToken).toBe('[redacted]')
    expect(result.apiKey).toBe('[redacted]')
    expect(result.privateKey).toBe('[redacted]')
    expect(result.otp).toBe('[redacted]')
    expect(result.Authorization).toBe('[redacted]')
  })

  test('strips JWT-like strings even when the key looks innocuous', () => {
    // Split across an array so no single source literal matches the
    // GitGuardian JWT detector. The joined value is identical to a real JWT
    // for the purpose of exercising `redact()`.
    const jwt = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJ1c2VyIn0',
      'signature_part_here',
    ].join('.')
    const result = redact({ note: jwt, other: 'plain' }) as Record<string, unknown>
    expect(result.note).toBe('[redacted]')
    expect(result.other).toBe('plain')
  })

  test('recurses through arrays and nested objects', () => {
    const result = redact({
      events: [
        { password: 'x', name: 'a' },
        { token: 'y', name: 'b' },
      ],
      nested: { deeper: { secret: 'z', ok: 1 } },
    }) as { events: Array<Record<string, unknown>>; nested: { deeper: Record<string, unknown> } }
    expect(result.events[0]!.password).toBe('[redacted]')
    expect(result.events[0]!.name).toBe('a')
    expect(result.events[1]!.token).toBe('[redacted]')
    expect(result.nested.deeper.secret).toBe('[redacted]')
    expect(result.nested.deeper.ok).toBe(1)
  })

  test('returns scalars and null untouched', () => {
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
    expect(redact(42)).toBe(42)
    expect(redact('hello')).toBe('hello')
    expect(redact(true)).toBe(true)
  })
})

describe('createAuditMiddleware', () => {
  test('writes audit rows before the mutating request resolves by default', async () => {
    const writes: unknown[] = []
    const prisma = {
      auditEvent: {
        create: async (input: unknown) => {
          writes.push(input)
        },
      },
    }
    const app = new Hono<{
      Variables: {
        auditEntry?: {
          action: string
          entityType: string
          entityId: string
          diff?: unknown
        }
        tenantId?: string
        userId?: string
      }
    }>()

    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1')
      c.set('userId', 'user-1')
      await next()
    })
    app.use('*', createAuditMiddleware({ prisma: prisma as never }))
    app.post('/resource', (c) => {
      c.set('auditEntry', {
        action: 'resource.create',
        entityType: 'Resource',
        entityId: '019f35e0-9fc0-73fb-b089-b6c7d8242044',
        diff: { token: 'secret-token', public: 'ok' },
      })
      return c.json({ ok: true }, 201)
    })

    const res = await app.request('/resource', { method: 'POST' })

    expect(res.status).toBe(201)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      data: {
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        action: 'resource.create',
        diff: { token: '[redacted]', public: 'ok' },
      },
    })
  })
})
