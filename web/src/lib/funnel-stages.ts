/**
 * resolveFunnelStages — web-side mirror of the backend pure utility.
 *
 * Merges tenant funnelStageConfig with the canonical ApplicationStage
 * defaults to produce an ordered list of display descriptors for the
 * Kanban board. Hidden stages are included with `hidden: true` so the
 * caller decides whether to render them.
 */

import type { ApplicationStage, FunnelStageEntry } from '@web-app-demo/contracts'

export const APPLICATION_STAGES: ApplicationStage[] = [
  'new',
  'screen',
  'tech',
  'final',
  'offer',
  'hired',
  'rejected',
]

const CANONICAL_ORDER: Record<ApplicationStage, number> = Object.fromEntries(
  APPLICATION_STAGES.map((s, i) => [s, i]),
) as Record<ApplicationStage, number>

export type FunnelStageDescriptor = {
  stage: ApplicationStage
  /** Display label — from config override or i18n fallback key */
  label: string | null
  order: number
  hidden: boolean
}

/**
 * Resolves the display descriptor list for all ApplicationStages.
 *
 * @param config - Tenant-specific overrides (partial list allowed). Pass
 *   null or undefined to get the canonical defaults.
 * @returns Full ordered list of stage descriptors, sorted by `order` asc.
 *   `label` is the config override (or null if not set — callers should
 *   fall back to the i18n translation key `applications.stages.<stage>`).
 */
export function resolveFunnelStages(
  config: FunnelStageEntry[] | null | undefined,
): FunnelStageDescriptor[] {
  const configMap = new Map<ApplicationStage, FunnelStageEntry>()
  if (config && config.length > 0) {
    for (const entry of config) {
      configMap.set(entry.stage, entry)
    }
  }

  const descriptors: FunnelStageDescriptor[] = APPLICATION_STAGES.map((stage) => {
    const override = configMap.get(stage)
    return {
      stage,
      label: override?.label ?? null,
      order: override?.order ?? CANONICAL_ORDER[stage],
      hidden: override?.hidden ?? false,
    }
  })

  descriptors.sort((a, b) => a.order - b.order)
  return descriptors
}
