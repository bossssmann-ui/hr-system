import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { signAccessToken } from './access-tokens'
import { requireRole, type RoleGuardBindings } from './requireRole'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: false,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: undefined,
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: false,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: undefined,
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: 'gemini-2.0-flash',
PROCTORING_WEBCAM_ENABLED: false,
TRUST_WEIGHT_PASTE: 0.35,
TRUST_WEIGHT_FOCUS: 0.4,
TRUST_WEIGHT_KEYSTROKE: 0.25,
TRUST_LOW_THRESHOLD: 50,
QUIET_HOURS_QUIET_START_UTC: 15,
QUIET_HOURS_QUIET_END_UTC: 23,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

type PrismaStub = {
  user: {
    findUnique: (args: unknown) => Promise<
      | { disabledAt: Date | null; roles: Array<{ role: string; tenantId: string }> }
      | null
    >
  }
}

function buildApp(
  memberships: Array<{ role: string; tenantId: string }>,
  user:
    | { disabledAt: Date | null; roles?: Array<{ role: string; tenantId: string }> }
    | null = { disabledAt: null },
) {
  type Bindings = RoleGuardBindings & {
    Variables: { env: AppEnv; prisma: PrismaStub }
  }
  const userWithRoles =
    user === null ? null : { disabledAt: user.disabledAt, roles: user.roles ?? memberships }
  const prisma: PrismaStub = {
    user: {
      findUnique: async () => userWithRoles,
    },
  }
  const app = new Hono<Bindings>()
  app.use('*', async (c, next) => {
    c.set('env', env)
    // Hono context is loosely typed for ad-hoc keys; cast through unknown.
    ;(c.set as unknown as (k: string, v: unknown) => void)('prisma', prisma)
    await next()
  })
  app.get('/protected', requireRole('owner', 'hr_admin'), (c) =>
    c.json({ userId: c.get('userId'), tenantId: c.get('tenantId'), roles: c.get('roles') }),
  )
  app.onError((err, c) => {
    const status =
      err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? (err.status as 401 | 403 | 500)
        : 500
    return c.json({ error: { message: err.message } }, status)
  })
  return app
}

async function tokenFor(sub: string) {
  return signAccessToken({ sub, sessionId: 'sess', email: 'u@example.com' }, env)
}

describe('requireRole', () => {
  test('denies requests without a bearer token', async () => {
    const app = buildApp([])
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  test('denies requests with an invalid bearer token', async () => {
    const app = buildApp([])
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })
    expect(res.status).toBe(401)
  })

  test('denies disabled users before role checks', async () => {
    const app = buildApp([{ role: 'owner', tenantId: 'tenant-1' }], {
      disabledAt: new Date('2026-05-30T00:00:00.000Z'),
    })
    const token = await tokenFor('user-1')
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer ' + token },
    })
    expect(res.status).toBe(403)
  })

  test('denies users with no tenant memberships', async () => {
    const app = buildApp([])
    const token = await tokenFor('user-1')
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
  })

  test('denies users whose roles do not intersect the allowed set', async () => {
    const app = buildApp([{ role: 'recruiter', tenantId: 'tenant-1' }])
    const token = await tokenFor('user-1')
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
  })

  test('allows users with an intersecting role and exposes context', async () => {
    const app = buildApp([{ role: 'owner', tenantId: 'tenant-1' }])
    const token = await tokenFor('user-1')
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string; tenantId: string; roles: string[] }
    expect(body).toEqual({ userId: 'user-1', tenantId: 'tenant-1', roles: ['owner'] })
  })
})
