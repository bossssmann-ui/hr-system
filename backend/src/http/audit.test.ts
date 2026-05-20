import { describe, expect, test } from 'bun:test'

import { redact } from './audit'

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
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_part_here'
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
