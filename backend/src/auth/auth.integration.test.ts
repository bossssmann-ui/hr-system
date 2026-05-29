import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../app'
import { createPrisma } from '../db'
import type { AppEnv } from '../env'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('auth API integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
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
PROCTORING_WEBCAM_ENABLED: false,
TRUST_WEIGHT_PASTE: 0.35,
TRUST_WEIGHT_FOCUS: 0.4,
TRUST_WEIGHT_KEYSTROKE: 0.25,
TRUST_LOW_THRESHOLD: 50,
QUIET_HOURS_QUIET_START_UTC: 15,
QUIET_HOURS_QUIET_END_UTC: 23,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  }
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('registers, reads me, refreshes, and logs out', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'password123',
        displayName: 'User',
      }),
    })
    const registerBody = await register.json()

    expect(register.status).toBe(201)
    expect(registerBody.user.email).toBe('user@example.com')
    expect(registerBody.accessToken).toBeString()
    expect(registerBody.refreshToken).toBeString()

    const me = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(me.status).toBe(200)

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const refreshBody = await refresh.json()
    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeString()
    expect(refreshBody.refreshToken).not.toBe(registerBody.refreshToken)

    const staleRefresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    expect(staleRefresh.status).toBe(401)

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: refreshBody.refreshToken }),
    })
    expect(logout.status).toBe(204)

    const revokedRefresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({ refreshToken: refreshBody.refreshToken }),
    })
    expect(revokedRefresh.status).toBe(401)
  })

  test('allows only one concurrent refresh rotation for the same token', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        email: 'race@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()

    const refreshRequests = await Promise.all([
      app.request('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Platform': 'mobile',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Platform': 'mobile',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
    ])

    const statuses = refreshRequests.map((response) => response.status).sort((left, right) => left - right)
    expect(statuses).toEqual([200, 401])

    const activeSessions = await prisma.authSession.count({
      where: {
        user: {
          email: 'race@example.com',
        },
        revokedAt: null,
      },
    })
    expect(activeSessions).toBe(1)
  })

  test('web auth uses an HttpOnly refresh cookie instead of response body refresh token', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({
        email: 'web-cookie@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('web_app_demo_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setCookie!.split(';')[0],
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({}),
    })
    const refreshBody = await refresh.json()

    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeUndefined()
  })

  test('production web auth allows exact CORS origin and cross-site refresh cookie', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({
        email: 'production-cookie@example.com',
        password: 'password123',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(register.headers.get('access-control-allow-origin')).toBe('https://web.example.com')
    expect(register.headers.get('access-control-allow-credentials')).toBe('true')
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('web_app_demo_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=None')
  })

  test('production cookie auth rejects untrusted refresh and logout origins', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({
        email: 'csrf-cookie@example.com',
        password: 'password123',
      }),
    })
    const cookie = register.headers.get('set-cookie')!.split(';')[0]

    const noOriginRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({}),
    })
    const noOriginBody = await noOriginRefresh.json()
    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await productionApp.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://attacker.example',
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()
    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')

    const allowedRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://web.example.com',
        'X-Client-Platform': 'web',
      },
      body: JSON.stringify({}),
    })
    expect(allowedRefresh.status).toBe(200)
  })

  test('guards me and returns stable validation errors', async () => {
    const unauthorizedMe = await app.request('/api/auth/me')
    expect(unauthorizedMe.status).toBe(401)

    const invalidRegister = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'not-an-email',
        password: 'short',
      }),
    })
    const body = await invalidRegister.json()

    expect(invalidRegister.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Invalid request payload')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('rejects duplicate email and invalid login', async () => {
    const payload = {
      email: 'dupe@example.com',
      password: 'password123',
    }

    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const duplicate = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(duplicate.status).toBe(409)

    const invalidLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: 'wrong-password',
      }),
    })
    expect(invalidLogin.status).toBe(401)
  })

  test('returns one created user and one conflict for concurrent duplicate registration', async () => {
    const payload = {
      email: 'register-race@example.com',
      password: 'password123',
    }

    const [first, second] = await Promise.all([
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([201, 409])

    const users = await prisma.user.count({
      where: {
        email: payload.email,
      },
    })
    expect(users).toBe(1)
  })
})
