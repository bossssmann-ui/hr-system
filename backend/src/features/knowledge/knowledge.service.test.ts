import { describe, expect, test } from 'bun:test'

import { buildTsQuery } from './knowledge.service'

describe('buildTsQuery', () => {
  test('returns empty string for whitespace-only input', () => {
    expect(buildTsQuery('   ')).toBe('')
    expect(buildTsQuery('!!!')).toBe('')
  })

  test('tokenises ASCII input into prefix OR query', () => {
    expect(buildTsQuery('onboard checklist')).toBe('onboard:* | checklist:*')
  })

  test('handles Cyrillic content (matches Phase 9 RU + EN requirement)', () => {
    expect(buildTsQuery('адаптация сотрудника')).toBe('адаптация:* | сотрудника:*')
  })

  test('drops 1-char noise tokens and punctuation', () => {
    expect(buildTsQuery('a HR! policy.')).toBe('hr:* | policy:*')
  })
})
