import { describe, it, expect } from 'bun:test'
import { parseResume, detectAiWriting } from './domestic-resume-parser'

// Mock fetch factory
function mockFetch(signals: string[]) {
  return async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(signals) }] }
      }]
    })
  }) as unknown as Response
}

function errorFetch() {
  return async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response
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
    const badFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'не массив' }] } }] })
    }) as unknown as Response
    const result = await parseResume('текст', 'key', badFetch)
    expect(result.signals).toEqual([])
  })
})

// ─── detectAiWriting ──────────────────────────────────────────────────────────

function mockAiFetch(payload: { score: number; signals: string[]; trapQuestions: string[] }) {
  return async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(payload) }] }
      }]
    })
  }) as unknown as Response
}

function httpErrorFetch(status = 500) {
  return async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response
}

describe('detectAiWriting', () => {
  it('score=85 → detected=true, trapQuestions.length > 0', async () => {
    const fetch = mockAiFetch({
      score: 85,
      signals: ['Нет конкретных дат', 'Шаблонные формулировки'],
      trapQuestions: ['Назовите коллегу по последнему месту работы?', 'Какой груз вёл в последнем рейсе?', 'Назовите точную дату трудоустройства?'],
    })
    const result = await detectAiWriting('текст резюме', 'key', fetch)
    expect(result.detected).toBe(true)
    expect(result.score).toBe(85)
    expect(result.trapQuestions.length).toBeGreaterThan(0)
  })

  it('score=30 → detected=false', async () => {
    const fetch = mockAiFetch({
      score: 30,
      signals: ['Упоминает конкретные даты'],
      trapQuestions: [],
    })
    const result = await detectAiWriting('текст резюме', 'key', fetch)
    expect(result.detected).toBe(false)
    expect(result.score).toBe(30)
  })

  it('невалидный JSON от Gemini → fallback, не бросает', async () => {
    const badFetch = async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'не валидный { json' }] } }]
      })
    }) as unknown as Response
    const result = await detectAiWriting('текст резюме', 'key', badFetch)
    expect(result.score).toBe(0)
    expect(result.detected).toBe(false)
    expect(result.signals).toEqual([])
    expect(result.trapQuestions).toEqual([])
  })

  it('HTTP 500 от Gemini → fallback, не бросает', async () => {
    const result = await detectAiWriting('текст резюме', 'key', httpErrorFetch(500))
    expect(result.score).toBe(0)
    expect(result.detected).toBe(false)
    expect(result.signals).toEqual([])
    expect(result.trapQuestions).toEqual([])
  })

  it('пустой resumeText → немедленный fallback без вызова Gemini', async () => {
    let called = false
    const spy = async () => {
      called = true
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }
    const result = await detectAiWriting('', 'key', spy)
    expect(called).toBe(false)
    expect(result.score).toBe(0)
    expect(result.detected).toBe(false)
  })
})
