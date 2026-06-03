import { describe, expect, test } from 'bun:test'

import { createHhClient, type HhHttpTransport } from './client'

describe('hh client', () => {
  test('refreshAccessToken exchanges refresh token via oauth endpoint', async () => {
    let capturedBody = ''
    let capturedUrl = ''

    const transport: HhHttpTransport = async (request) => {
      capturedBody = request.body ?? ''
      capturedUrl = request.url
      return {
        status: 200,
        headers: {},
        body: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        },
      }
    }

    const client = createHhClient({
      env: {
        HH_CLIENT_ID: 'cid',
        HH_CLIENT_SECRET: 'csecret',
      },
      http: transport,
      now: () => 0,
      sleep: async () => {},
    })

    const token = await client.refreshAccessToken({ refreshToken: 'old-refresh-token' })

    expect(token.accessToken).toBe('new-access-token')
    expect(token.refreshToken).toBe('new-refresh-token')
    expect(token.expiresInSeconds).toBe(3600)
    expect(capturedBody).toContain('grant_type=refresh_token')
    expect(capturedBody).toContain('refresh_token=old-refresh-token')
    expect(capturedUrl).toBe('https://api.hh.ru/token')
  })

  test('sends a User-Agent header on the OAuth token request', async () => {
    let capturedHeaders: Record<string, string> = {}

    const transport: HhHttpTransport = async (request) => {
      capturedHeaders = request.headers ?? {}
      return {
        status: 200,
        headers: {},
        body: {
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
        },
      }
    }

    const client = createHhClient({
      env: { HH_CLIENT_ID: 'cid', HH_CLIENT_SECRET: 'csecret' },
      http: transport,
      now: () => 0,
      sleep: async () => {},
    })

    await client.exchangeAuthorizationCode({ code: 'c', redirectUri: 'https://career.pacificstar.ru/admin/integrations/hh' })

    expect(capturedHeaders['User-Agent']).toBeDefined()
    expect(capturedHeaders['User-Agent']?.length ?? 0).toBeGreaterThan(0)
  })

  test('retries 429 responses using exponential backoff', async () => {
    const statuses = [429, 429, 200]
    const delays: number[] = []

    const transport: HhHttpTransport = async () => {
      const status = statuses.shift() ?? 200
      return {
        status,
        headers: {},
        body: status === 200 ? { collections: [] } : {},
      }
    }

    const client = createHhClient({
      env: {
        HH_CLIENT_ID: 'cid',
        HH_CLIENT_SECRET: 'csecret',
      },
      http: transport,
      now: () => 0,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    const collections = await client.getNegotiationCollections('access', 'vacancy-1')

    expect(collections).toEqual([])
    expect(delays).toEqual([250, 500])
  })

  test('supports paginated negotiation collection requests', async () => {
    const requestedUrls: string[] = []

    const transport: HhHttpTransport = async (request) => {
      requestedUrls.push(request.url)
      const page = new URL(request.url).searchParams.get('page') ?? '0'
      return {
        status: 200,
        headers: {},
        body: {
          found: 2,
          pages: 2,
          page: Number(page),
          per_page: 1,
          items: [
            {
              id: `neg-${page}`,
              created_at: '2026-05-20T10:00:00+0300',
              updated_at: '2026-05-20T10:00:00+0300',
              resume: { id: `resume-${page}` },
            },
          ],
        },
      }
    }

    const client = createHhClient({
      env: {
        HH_CLIENT_ID: 'cid',
        HH_CLIENT_SECRET: 'csecret',
      },
      http: transport,
      now: () => 0,
      sleep: async () => {},
    })

    const page0 = await client.listNegotiations('access', '/negotiations/response?vacancy_id=100', 0)
    const page1 = await client.listNegotiations('access', '/negotiations/response?vacancy_id=100', 1)

    expect(page0.items[0]?.id).toBe('neg-0')
    expect(page1.items[0]?.id).toBe('neg-1')
    expect(requestedUrls[0]).toContain('page=0')
    expect(requestedUrls[1]).toContain('page=1')
  })
})
