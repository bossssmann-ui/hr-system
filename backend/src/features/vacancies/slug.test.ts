import { describe, expect, test } from 'bun:test'
import { titleToSlug } from './slug'

describe('titleToSlug', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(titleToSlug('Frontend Engineer')).toBe('frontend-engineer')
  })

  test('removes special characters', () => {
    expect(titleToSlug('C++ Developer (Senior)')).toBe('c-developer-senior')
  })

  test('collapses multiple hyphens', () => {
    expect(titleToSlug('Lead  --  Engineer')).toBe('lead-engineer')
  })

  test('trims leading and trailing hyphens', () => {
    expect(titleToSlug('  --My Title--  ')).toBe('my-title')
  })

  test('handles empty string', () => {
    expect(titleToSlug('')).toBe('')
  })

  test('truncates long titles at 80 characters', () => {
    const long = 'a'.repeat(200)
    expect(titleToSlug(long).length).toBeLessThanOrEqual(80)
  })

  test('preserves unicode letters (Cyrillic)', () => {
    const result = titleToSlug('Фронтенд разработчик')
    expect(result).toBe('фронтенд-разработчик')
  })
})
