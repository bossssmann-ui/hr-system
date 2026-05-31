import { describe, it, expect } from 'bun:test'
import { parseResume } from './domestic-resume-parser'

// Mock fetch factory
function mockFetch(signals: string[]) {
  return (async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(signals) }] }
      }]
    })
  })) as unknown as typeof fetch
}

function errorFetch() {
  return (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
}

describe('parseResume', () => {
  it('возвращает сигналы из ответа Gemini', async () => {
    const result = await parseResume('Опыт FTL перевозок', 'key', mockFetch(['FTL']))
    expect(result.signals).toContain('FTL')
  })
  it('возвращает несколько сигналов', async () => {
    const result = await parseResume('негабарит и Якутия', 'key', mockFetch(['негабарит', 'Якутия']))
    expect(result.signals).toHaveLength(2)
  })
  it('возвращает пустой массив для пустого резюме', async () => {
    const result = await parseResume('', 'key', mockFetch([]))
    expect(result.signals).toEqual([])
  })
  it('сохраняет rawText', async () => {
    const result = await parseResume('текст резюме', 'key', mockFetch([]))
    expect(result.rawText).toBe('текст резюме')
  })
  it('при ошибке Gemini выбрасывает ошибку', async () => {
    await expect(parseResume('текст', 'key', errorFetch())).rejects.toThrow()
  })
  it('если Gemini вернул не массив — возвращает пустой signals', async () => {
    const badFetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'не массив' }] } }] })
    })) as unknown as typeof fetch
    const result = await parseResume('текст', 'key', badFetch)
    expect(result.signals).toEqual([])
  })
})
