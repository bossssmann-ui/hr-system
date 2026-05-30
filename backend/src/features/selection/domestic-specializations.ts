/**
 * Phase 15a — Domestic Logist Dynamic Package Selection
 *
 * Selects specialization packages based on signals from resume / AI interview.
 */

export type SpecializationPackageId =
  | 'domestic_core_operations'
  | 'domestic_road_ftl_ltl'
  | 'domestic_distribution'
  | 'domestic_rail_container'
  | 'domestic_oversized_heavy'
  | 'domestic_remote_regions'
  | 'domestic_cabotage'

export type SpecializationLevel = 'primary' | 'secondary' | 'mentioned_only' | 'contradicted'

export interface SpecializationAssignment {
  packageId: SpecializationPackageId
  level: SpecializationLevel
}

// Trigger patterns (case-insensitive substring match)
const TRIGGERS: Array<{ patterns: string[]; packageId: SpecializationPackageId }> = [
  {
    patterns: ['ftl', 'ltl', 'фуры', 'фура', 'сборные', 'сборный', 'ati', 'генгруз', 'машины по рф'],
    packageId: 'domestic_road_ftl_ltl',
  },
  {
    patterns: ['развозка', 'маршруты', 'точки', 'окна доставки', 'sla'],
    packageId: 'domestic_distribution',
  },
  {
    patterns: ['жд', 'контейнер', 'станция', 'терминал', 'этран'],
    packageId: 'domestic_rail_container',
  },
  {
    patterns: ['негабарит', 'тяжеловес', 'трал', 'разрешение', 'сопровождение'],
    packageId: 'domestic_oversized_heavy',
  },
  {
    patterns: ['север', 'якутия', 'камчатка', 'чукотка', 'зимник', 'переправа'],
    packageId: 'domestic_remote_regions',
  },
  {
    patterns: ['каботаж', 'порт рф', 'магадан', 'сахалин'],
    packageId: 'domestic_cabotage',
  },
]

export function selectSpecializations(signals: string[]): SpecializationAssignment[] {
  const result: SpecializationAssignment[] = [
    { packageId: 'domestic_core_operations', level: 'primary' },
  ]

  const assignedIds = new Set<SpecializationPackageId>(['domestic_core_operations'])

  const normalizedSignals = signals.map((s) => s.toLowerCase())

  let triggered = false

  for (const { patterns, packageId } of TRIGGERS) {
    if (assignedIds.has(packageId)) continue

    const matches = normalizedSignals.some((signal) =>
      patterns.some((pattern) => signal.includes(pattern.toLowerCase())),
    )

    if (matches) {
      result.push({ packageId, level: 'secondary' })
      assignedIds.add(packageId)
      triggered = true
    }
  }

  // Default fallback: if no specializations triggered, add road_ftl_ltl
  if (!triggered) {
    result.push({ packageId: 'domestic_road_ftl_ltl', level: 'secondary' })
  }

  return result
}
