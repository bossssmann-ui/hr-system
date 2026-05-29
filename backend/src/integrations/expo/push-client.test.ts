/**
 * Unit tests for the Expo Push API client.
 *
 * The Expo HTTP API is stubbed via an injected `fetch` so these tests run
 * fully offline.
 */
import { describe, expect, test } from 'bun:test'

import { createExpoPushClient, type FetchLike } from './push-client'

const API_URL = 'https://exp.host/--/api/v2/push/send'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createExpoPushClient', () => {
  test('returns ok when Expo accepts every ticket', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '[]')) })
      return jsonResponse({ data: [{ status: 'ok' }] })
    }
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const result = await client.send([{ to: 'ExponentPushToken[a]', title: 't', body: 'b' }])

    expect(result.ok).toBe(true)
    expect(result.invalidTokens).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(API_URL)
    expect(calls[0]!.body).toEqual([{ to: 'ExponentPushToken[a]', title: 't', body: 'b' }])
  })

  test('returns invalid tokens for DeviceNotRegistered errors', async () => {
    const fakeFetch: FetchLike = async () =>
      jsonResponse({
        data: [
          { status: 'ok' },
          { status: 'error', message: 'bad', details: { error: 'DeviceNotRegistered' } },
        ],
      })
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const result = await client.send([
      { to: 'ExponentPushToken[good]' },
      { to: 'ExponentPushToken[stale]' },
    ])

    expect(result.ok).toBe(false)
    expect(result.invalidTokens).toEqual(['ExponentPushToken[stale]'])
  })

  test('reports non-2xx HTTP responses as non-ok without throwing', async () => {
    const fakeFetch: FetchLike = async () =>
      new Response('Bad gateway', { status: 502 })
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const result = await client.send([{ to: 'ExponentPushToken[x]' }])

    expect(result.ok).toBe(false)
    expect(result.invalidTokens).toEqual([])
  })

  test('absorbs transport errors instead of throwing', async () => {
    const fakeFetch: FetchLike = async () => {
      throw new Error('connection reset')
    }
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const result = await client.send([{ to: 'ExponentPushToken[x]' }])

    expect(result.ok).toBe(false)
    expect(result.invalidTokens).toEqual([])
  })

  test('short-circuits when given no messages', async () => {
    let called = false
    const fakeFetch: FetchLike = async () => {
      called = true
      return jsonResponse({ data: [] })
    }
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const result = await client.send([])

    expect(result.ok).toBe(true)
    expect(called).toBe(false)
  })

  test('splits payloads larger than 100 messages into batches', async () => {
    let batchCount = 0
    const fakeFetch: FetchLike = async (_url, init) => {
      batchCount += 1
      const batch = JSON.parse(String(init?.body ?? '[]')) as unknown[]
      return jsonResponse({ data: batch.map(() => ({ status: 'ok' })) })
    }
    const client = createExpoPushClient({ apiUrl: API_URL, fetchImpl: fakeFetch })

    const messages = Array.from({ length: 250 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
    }))
    const result = await client.send(messages)

    expect(result.ok).toBe(true)
    expect(batchCount).toBe(3) // 100 + 100 + 50
  })
})
