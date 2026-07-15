import { expect, test } from 'bun:test'

import {
  defaultLng,
  initialLng,
  persistLanguagePreference,
  resources,
  supportedLngs,
} from '../src/i18n'

test('i18n includes RU + EN', () => {
  expect(supportedLngs).toEqual(['ru', 'en'])
  expect(Object.keys(resources)).toEqual(['ru', 'en'])
  expect(defaultLng).toBe('ru')
})

test('initial language defaults to detector unless the user explicitly chose one', () => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
    configurable: true,
  })

  window.localStorage.removeItem('i18nextLng')
  expect(initialLng()).toBeUndefined()

  window.localStorage.setItem('i18nextLng', 'en')
  expect(initialLng()).toBeUndefined()

  persistLanguagePreference('en')
  expect(storage.get('onboardixLanguagePreferenceExplicit')).toBe('true')
  window.localStorage.setItem('i18nextLng', 'en')
  expect(initialLng()).toBe('en')

  persistLanguagePreference('ru')
  expect(initialLng()).toBe('ru')

  window.localStorage.setItem('i18nextLng', 'de')
  expect(initialLng()).toBe('ru')
  window.localStorage.removeItem('i18nextLng')

  Reflect.deleteProperty(globalThis, 'window')
})

test('all RU namespaces exist with matching EN counterparts', () => {
  const ruKeys = Object.keys(resources.ru).sort()
  const enKeys = Object.keys(resources.en).sort()
  expect(enKeys).toEqual(ruKeys)
  expect(ruKeys).toContain('common')
  expect(ruKeys).toContain('navigation')
  expect(ruKeys).toContain('auth')
  expect(ruKeys).toContain('employees')
  expect(ruKeys).toContain('candidates')
  expect(ruKeys).toContain('offers')
  expect(ruKeys).toContain('requisitions')
  expect(ruKeys).toContain('analytics')
  expect(ruKeys).toContain('admin')
  expect(ruKeys).toContain('settings')
})

test('app name is Onboardix in both languages', () => {
  expect(resources.ru.common.appName).toBe('Onboardix')
  expect(resources.en.common.appName).toBe('Onboardix')
})

test('Russian FSM employment statuses match the issue examples', () => {
  expect(resources.ru.employees.employmentStatus.on_probation).toBe('На испытании')
  expect(resources.ru.employees.employmentStatus.active).toBe('Активен')
  expect(resources.ru.employees.employmentStatus.terminated).toBe('Уволен')
})

function collectLeafKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') {
    return [prefix]
  }
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k
    out.push(...collectLeafKeys(v, next))
  }
  return out
}

test('RU and EN bundles have identical key shapes for every namespace', () => {
  for (const ns of Object.keys(resources.ru)) {
    const ruKeys = collectLeafKeys(
      resources.ru[ns as keyof typeof resources.ru],
    ).sort()
    const enKeys = collectLeafKeys(
      resources.en[ns as keyof typeof resources.en],
    ).sort()
    expect(enKeys).toEqual(ruKeys)
  }
})
