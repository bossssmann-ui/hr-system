import type { Vacancy } from '@web-app-demo/contracts'

const SUPPORTED_ROLES = ['logist_domestic', 'logist', 'sales_manager'] as const

export function parseVacancyRole(value: string | null): Vacancy['role'] {
  if (!value) return null
  if ((SUPPORTED_ROLES as readonly string[]).includes(value)) {
    return value as Vacancy['role']
  }
  return null
}
