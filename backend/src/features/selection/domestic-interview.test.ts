import { describe, it, expect } from 'bun:test'
import { buildInterviewQuestions, classifyInterviewAnswers } from './domestic-interview'
import type { SpecializationAssignment } from './domestic-specializations'

const coreOnly: SpecializationAssignment[] = [
  { packageId: 'domestic_core_operations', level: 'primary' }
]

const withOversized: SpecializationAssignment[] = [
  { packageId: 'domestic_core_operations', level: 'primary' },
  { packageId: 'domestic_oversized_heavy', level: 'primary' },
]

const withRemote: SpecializationAssignment[] = [
  { packageId: 'domestic_core_operations', level: 'primary' },
  { packageId: 'domestic_remote_regions', level: 'primary' },
]

function mockClassifyFetch(result: { specializations: SpecializationAssignment[], riskFlags: string[] }) {
  return async (_url: string, _init?: RequestInit) => ({
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }]
    })
  }) as unknown as Response
}

describe('buildInterviewQuestions', () => {
  it('включает 6 базовых вопросов для core_operations', () => {
    const qs = buildInterviewQuestions(coreOnly)
    expect(qs.length).toBeGreaterThanOrEqual(6)
  })
  it('добавляет вопросы для oversized', () => {
    const base = buildInterviewQuestions(coreOnly).length
    const withO = buildInterviewQuestions(withOversized).length
    expect(withO).toBeGreaterThan(base)
  })
  it('добавляет вопросы для remote_regions', () => {
    const base = buildInterviewQuestions(coreOnly).length
    const withR = buildInterviewQuestions(withRemote).length
    expect(withR).toBeGreaterThan(base)
  })
  it('все вопросы имеют уникальный key', () => {
    const qs = buildInterviewQuestions(withOversized)
    const keys = qs.map(q => q.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('тип всех вопросов = textarea', () => {
    const qs = buildInterviewQuestions(withOversized)
    expect(qs.every(q => q.type === 'textarea')).toBe(true)
  })
})

describe('classifyInterviewAnswers', () => {
  it('возвращает specializations и riskFlags', async () => {
    const mockResult = { specializations: coreOnly, riskFlags: [] }
    const result = await classifyInterviewAnswers(coreOnly, {}, 'key', mockClassifyFetch(mockResult))
    expect(result.specializations).toBeDefined()
    expect(result.riskFlags).toBeDefined()
  })
  it('при ошибке Gemini возвращает исходные specializations', async () => {
    const errorFetch = async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response
    const result = await classifyInterviewAnswers(coreOnly, {}, 'key', errorFetch)
    expect(result.specializations).toEqual(coreOnly)
    expect(result.riskFlags).toEqual([])
  })
  it('если Gemini вернул невалидный JSON — graceful fallback', async () => {
    const badFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'не json' }] } }] })
    }) as unknown as Response
    const result = await classifyInterviewAnswers(coreOnly, {}, 'key', badFetch)
    expect(result.specializations).toEqual(coreOnly)
  })
})
