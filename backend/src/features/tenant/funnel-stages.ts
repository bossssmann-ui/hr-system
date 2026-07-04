/**
 * resolveFunnelStages — pure utility that merges tenant funnel stage config
 * with the canonical ApplicationStage defaults.
 *
 * Returns an ordered list of display descriptors for the Kanban board.
 * Hidden stages are included with `hidden: true` so callers can decide
 * whether to show or exclude them.
 *
 * Pure function — no I/O, no Prisma.
 */

import { APPLICATION_STAGES } from '../applications/applications.fsm'
import type { ApplicationStage } from '../applications/applications.fsm'

// Default display labels matching the canonical stage enum values.
const DEFAULT_LABELS: Record<ApplicationStage, string> = {
  new: 'Новые',
  screen: 'Скрининг',
  tech: 'Техническое',
  final: 'Финальное',
  offer: 'Оффер',
  hired: 'Принят',
  rejected: 'Отказ',
}

// Canonical order (index = default order value).
const CANONICAL_ORDER: Record<ApplicationStage, number> = Object.fromEntries(
  APPLICATION_STAGES.map((s, i) => [s, i]),
) as Record<ApplicationStage, number>

export type FunnelStageDescriptor = {
  stage: ApplicationStage
  label: string
  order: number
  hidden: boolean
}

export type FunnelStageConfigEntry = {
  stage: ApplicationStage
  label?: string
  order: number
  hidden?: boolean
}

/**
 * Resolves the display descriptor list for all ApplicationStages.
 *
 * @param config - Tenant-specific overrides (partial list allowed). Pass null
 *   or undefined to get the canonical defaults.
 * @returns Full ordered list of stage descriptors (all 7 stages, sorted by
 *   `order` asc). Stages with `hidden: true` are present in the list so
 *   callers can inspect them; filter by `hidden` to exclude from display.
 */
export function resolveFunnelStages(
  config: FunnelStageConfigEntry[] | null | undefined,
): FunnelStageDescriptor[] {
  // Index the config by stage for O(1) lookup.
  const configMap = new Map<ApplicationStage, FunnelStageConfigEntry>()
  if (config) {
    for (const entry of config) {
      configMap.set(entry.stage, entry)
    }
  }

  const descriptors: FunnelStageDescriptor[] = APPLICATION_STAGES.map((stage) => {
    const override = configMap.get(stage)
    return {
      stage,
      label: override?.label ?? DEFAULT_LABELS[stage],
      order: override?.order ?? CANONICAL_ORDER[stage],
      hidden: override?.hidden ?? false,
    }
  })

  // Sort by order asc (stable — original insertion order as tie-breaker).
  descriptors.sort((a, b) => a.order - b.order)

  return descriptors
}
