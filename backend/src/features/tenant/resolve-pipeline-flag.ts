import type { AppEnv } from '../../env'

export type PipelineFlagKey = 'autoSelection' | 'autoAssessment' | 'compositeScore' | 'recruiterNotifications'

type PipelineFlagEnv = Pick<
  AppEnv,
  'AUTO_SELECTION_ENABLED' | 'AUTO_ASSESSMENT_ENABLED' | 'COMPOSITE_SCORE_ENABLED' | 'RECRUITER_NOTIFICATIONS_ENABLED'
>

/**
 * Resolves a pipeline feature flag with per-tenant override support.
 *
 * If the tenant's `featureFlags` JSON field explicitly contains the flag as a
 * boolean, that value takes precedence. Otherwise falls back to the global env
 * variable — preserving the existing behaviour when no override is set.
 */
export function resolvePipelineFlag(
  flag: PipelineFlagKey,
  featureFlags: unknown,
  env: PipelineFlagEnv,
): boolean {
  if (featureFlags !== null && typeof featureFlags === 'object' && !Array.isArray(featureFlags)) {
    const record = featureFlags as Record<string, unknown>
    if (typeof record[flag] === 'boolean') {
      return record[flag] as boolean
    }
  }
  const envMap: Record<PipelineFlagKey, boolean> = {
    autoSelection: env.AUTO_SELECTION_ENABLED,
    autoAssessment: env.AUTO_ASSESSMENT_ENABLED,
    compositeScore: env.COMPOSITE_SCORE_ENABLED,
    recruiterNotifications: env.RECRUITER_NOTIFICATIONS_ENABLED,
  }
  return envMap[flag]
}
