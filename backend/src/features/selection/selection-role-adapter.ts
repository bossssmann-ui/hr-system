import { getAllStagesContent } from './stage-content'
import { buildDomesticStages } from './domestic-stage-content'
import { selectSpecializations, type SpecializationAssignment } from './domestic-specializations'

export type SupportedRole = 'logist' | 'sales_manager' | 'logist_domestic'
const SUPPORTED_ROLES = ['logist', 'sales_manager', 'logist_domestic'] as const

export function parseSupportedRole(value: unknown): SupportedRole | null {
  if (typeof value !== 'string') return null
  if ((SUPPORTED_ROLES as readonly string[]).includes(value)) return value as SupportedRole
  return null
}

export function isDomesticRole(role: string): role is 'logist_domestic' {
  return role === 'logist_domestic'
}

export function buildStagesForRole(
  role: SupportedRole,
  options?: {
    signals?: string[]
    specializations?: SpecializationAssignment[]
  }
) {
  if (role === 'logist_domestic') {
    // If specializations are provided explicitly, use them as-is.
    // Otherwise derive from signals and promote all non-core results to 'primary'
    // so their questions are merged into Stage 2.
    const specs: SpecializationAssignment[] = options?.specializations
      ? options.specializations
      : selectSpecializations(options?.signals ?? []).map((s) => ({
          ...s,
          level: 'primary' as const,
        }))
    return buildDomesticStages(specs)
  }
  return getAllStagesContent(role)
}
