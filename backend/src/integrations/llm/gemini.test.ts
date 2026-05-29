import { describe, expect, test } from 'bun:test'

import { callGeminiGenerateContent, GeminiApiError } from './gemini'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('callGeminiGenerateContent', () => {
  test('posts to the correct generateContent endpoint with system + user parts', async () => {
    let capturedUrl: string = ''
    let capturedBody: Record<string, unknown> | null = null
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"verdict":"ДОПУСТИТЬ"}' }] } }],
      })
    }) as unknown as typeof fetch

    const result = await callGeminiGenerateContent({
      apiKey: 'abc123',
      model: 'gemini-2.0-flash',
      systemInstruction: 'sys-prompt',
      userText: 'user-prompt',
      fetchImpl: fakeFetch,
    })

    expect(capturedUrl).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    )
    expect(capturedUrl).toContain('key=abc123')
    expect(capturedBody).toMatchObject({
      system_instruction: { parts: [{ text: 'sys-prompt' }] },
      contents: [{ role: 'user', parts: [{ text: 'user-prompt' }] }],
    })
    expect(result.text).toBe('{"verdict":"ДОПУСТИТЬ"}')
  })

  test('throws GeminiApiError with status code on non-2xx responses', async () => {
    const fakeFetch = (async () =>
      new Response('boom', { status: 503 })) as unknown as typeof fetch
    await expect(
      callGeminiGenerateContent({
        apiKey: 'k',
        model: 'gemini-2.0-flash',
        systemInstruction: 's',
        userText: 'u',
        fetchImpl: fakeFetch,
      }),
    ).rejects.toMatchObject({ name: 'GeminiApiError', status: 503 })
  })

  test('rejects when API key is missing', async () => {
    await expect(
      callGeminiGenerateContent({
        apiKey: '',
        model: 'gemini-2.0-flash',
        systemInstruction: 's',
        userText: 'u',
      }),
    ).rejects.toBeInstanceOf(GeminiApiError)
  })
})
