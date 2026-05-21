import { afterEach, expect, test } from 'bun:test'

import { ApiClient } from '../src/lib/api'
import { bootstrapAuthSession } from '../src/lib/bootstrap-auth'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('ApiClient refreshes and retries authenticated requests with the new access token', async () => {
  let accessToken: string | null = 'expired-access-token'
  const calls: Array<{ path: string; authorization: string | null }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    calls.push({ path, authorization: headers.get('Authorization') })

    const meCallCount = calls.filter((call) => call.path === '/api/auth/me').length

    if (path === '/api/auth/me' && meCallCount === 1) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    if (path === '/api/auth/refresh') {
      return json({ accessToken: 'fresh-access-token' }, 200)
    }

    if (path === '/api/auth/me') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            createdAt: '2026-05-11T00:00:00.000Z',
          },
        },
        200,
      )
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  const response = await client.me()
  const meCalls = calls.filter((call) => call.path === '/api/auth/me')

  expect(response.user.email).toBe('user@example.com')
  expect(meCalls).toHaveLength(2)
  expect(meCalls[0]?.authorization).toBe('Bearer expired-access-token')
  expect(meCalls[1]?.authorization).toBe('Bearer fresh-access-token')
})

test('ApiClient shares one refresh across concurrent unauthorized requests', async () => {
  let accessToken: string | null = 'expired-access-token'
  const calls: Array<{ path: string; authorization: string | null; credentials: RequestCredentials | undefined }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    const authorization = headers.get('Authorization')
    calls.push({ path, authorization, credentials: init?.credentials })

    if (path === '/api/auth/refresh') {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return json({ accessToken: 'fresh-access-token' }, 200)
    }

    if (path === '/api/auth/me' && authorization === 'Bearer fresh-access-token') {
      return json(
        {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            displayName: null,
            createdAt: '2026-05-11T00:00:00.000Z',
          },
        },
        200,
      )
    }

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
  })

  const [first, second] = await Promise.all([client.me(), client.me()])
  const refreshCalls = calls.filter((call) => call.path === '/api/auth/refresh')
  const meCalls = calls.filter((call) => call.path === '/api/auth/me')

  expect(first.user.email).toBe('user@example.com')
  expect(second.user.email).toBe('user@example.com')
  expect(refreshCalls).toHaveLength(1)
  expect(meCalls).toHaveLength(4)
  expect(meCalls.filter((call) => call.authorization === 'Bearer expired-access-token')).toHaveLength(2)
  expect(meCalls.filter((call) => call.authorization === 'Bearer fresh-access-token')).toHaveLength(2)
  expect(calls.every((call) => call.credentials === 'include')).toBe(true)
})

test('ApiClient clears session when refresh fails during an authenticated request', async () => {
  let accessToken: string | null = 'expired-access-token'
  let authExpiredCalls = 0
  const calls: Array<{ path: string; authorization: string | null }> = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const path = new URL(url).pathname
    const headers = new Headers(init?.headers)
    calls.push({ path, authorization: headers.get('Authorization') })

    if (path === '/api/auth/me') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Expired access token' } }, 401)
    }

    if (path === '/api/auth/refresh') {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } }, 401)
    }

    if (path === '/api/auth/logout') {
      return new Response(null, { status: 204 })
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await expect(client.me()).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHORIZED',
  })

  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
  expect(calls.map((call) => call.path)).toEqual([
    '/api/auth/me',
    '/api/auth/refresh',
    '/api/auth/logout',
  ])
})

test('ApiClient preserves backend error status, code, and message', async () => {
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname

    if (path === '/api/auth/register') {
      return json(
        {
          error: {
            code: 'CONFLICT',
            message: 'User with this email already exists',
          },
        },
        409,
      )
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => null,
    setAccessToken: () => undefined,
  })

  await expect(
    client.register({
      email: 'dupe@example.com',
      password: 'password123',
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: 'CONFLICT',
    message: 'User with this email already exists',
  })
})

test('ApiClient expireSession clears stale web session cookie through logout', async () => {
  let accessToken: string | null = 'stale-access-token'
  let authExpiredCalls = 0
  const calls: Array<{ path: string; method: string | undefined }> = []

  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, method: init?.method })

    if (path === '/api/auth/logout') {
      return new Response(null, { status: 204 })
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => accessToken,
    setAccessToken: (nextAccessToken) => {
      accessToken = nextAccessToken
    },
    onAuthExpired: () => {
      authExpiredCalls += 1
    },
  })

  await client.expireSession()

  expect(accessToken).toBeNull()
  expect(authExpiredCalls).toBe(1)
  expect(calls).toEqual([{ path: '/api/auth/logout', method: 'POST' }])
})

test('bootstrapAuthSession waits for stale-cookie cleanup before completing', async () => {
  const events: string[] = []
  let completed = false
  let finishCleanup!: () => void
  const cleanupFinished = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })

  const bootstrap = bootstrapAuthSession({
    api: {
      refresh: async () => {
        events.push('refresh')
        throw new Error('Invalid refresh token')
      },
      expireSession: async () => {
        events.push('cleanup:start')
        await cleanupFinished
        events.push('cleanup:done')
      },
    },
    shouldApply: () => true,
    setAccessToken: () => {
      events.push('setAccessToken')
    },
  }).then(() => {
    completed = true
  })

  await waitForEvent(events, 'cleanup:start')

  expect(completed).toBe(false)
  expect(events).toEqual(['refresh', 'cleanup:start'])

  finishCleanup()
  await bootstrap

  expect(completed).toBe(true)
  expect(events).toEqual(['refresh', 'cleanup:start', 'cleanup:done'])
})

test('ApiClient HH integration methods hit expected endpoints', async () => {
  const calls: Array<{ pathWithQuery: string; method: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({
      pathWithQuery: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
    })

    if (url.pathname === '/api/integrations/hh/authorize-url') {
      return json({ enabled: true, configured: true, authorizeUrl: 'https://hh.ru/oauth/authorize' }, 200)
    }
    if (url.pathname === '/api/integrations/hh/callback') {
      return json({ connected: true }, 200)
    }
    if (url.pathname === '/api/integrations/hh/status') {
      return json({ enabled: true, configured: true, connected: true, linkedVacancies: [], lastSyncAt: null }, 200)
    }
    if (url.pathname === '/api/integrations/hh/sync') {
      return json({
        ok: true,
        summary: {
          importedCandidates: 0,
          upsertedApplications: 0,
          vacanciesProcessed: 0,
          negotiationsScanned: 0,
          lastSyncedAt: null,
        },
      }, 200)
    }
    if (url.pathname === '/api/integrations/hh/vacancies/v1/link') {
      return json({ vacancy: { id: 'v1', title: 'Backend', hhVacancyId: 'hh-1' } }, 200)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => 'token',
    setAccessToken: () => undefined,
  })

  await client.getHhAuthorizeUrl({ redirectUri: 'http://localhost:5173/admin/integrations/hh' })
  await client.completeHhOAuth({ code: 'abc', redirectUri: 'http://localhost:5173/admin/integrations/hh' })
  await client.getHhIntegrationStatus()
  await client.syncHhNow()
  await client.linkVacancyToHh('v1', { hhVacancyId: 'hh-1' })

  expect(calls.map((call) => `${call.method} ${call.pathWithQuery}`)).toEqual([
    'GET /api/integrations/hh/authorize-url?redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fadmin%2Fintegrations%2Fhh',
    'GET /api/integrations/hh/callback?code=abc&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fadmin%2Fintegrations%2Fhh',
    'GET /api/integrations/hh/status',
    'POST /api/integrations/hh/sync',
    'PATCH /api/integrations/hh/vacancies/v1/link',
  ])
})

test('ApiClient application scoring methods hit expected endpoints', async () => {
  const calls: Array<{ path: string; method: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ path: url.pathname, method: init?.method ?? 'GET' })

    if (url.pathname === '/api/applications/app-1/rescore') {
      return json({ queued: true }, 202)
    }

    if (url.pathname === '/api/applications/app-1/score-feedback') {
      return json({
        id: 'app-1',
        tenantId: 'tenant-1',
        candidateId: 'cand-1',
        vacancyId: 'vac-1',
        stage: 'new',
        assignedToUserId: null,
        notes: null,
        aiScoring: { status: 'pending' },
        aiScoreFeedback: {
          user_id: '11111111-1111-4111-8111-111111111111',
          agrees: true,
          note: 'Looks right',
          created_at: '2026-05-21T00:00:00.000Z',
        },
        externalIds: {},
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      }, 200)
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => 'token',
    setAccessToken: () => undefined,
  })

  const rescore = await client.rescoreApplication('app-1')
  const feedback = await client.submitApplicationScoreFeedback('app-1', { agrees: true, note: 'Looks right' })

  expect(rescore.queued).toBe(true)
  expect(feedback.aiScoreFeedback?.agrees).toBe(true)
  expect(calls).toEqual([
    { path: '/api/applications/app-1/rescore', method: 'POST' },
    { path: '/api/applications/app-1/score-feedback', method: 'POST' },
  ])
})

async function waitForEvent(events: string[], event: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (events.includes(event)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Timed out waiting for event: ${event}`)
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
