/**
 * Dump every candidate-facing question and assignment in the Selection
 * subsystem to JSON on stdout. Used by `generate-candidate-questions-pdf.py`
 * to produce a printable PDF of all assessment content.
 *
 * Run with: bun run scripts/dump-candidate-questions.ts
 */

import {
  getAllStagesContent,
  type StageContent,
} from '../backend/src/features/selection/stage-content'
import {
  getDomesticStageContent,
} from '../backend/src/features/selection/domestic-stage-content'

type Role = {
  id: string
  title: string
  stages: StageContent[]
}

const roles: Role[] = [
  {
    id: 'logist',
    title: 'Логист-экспедитор (международные перевозки Китай–Россия)',
    stages: getAllStagesContent('logist'),
  },
  {
    id: 'sales_manager',
    title: 'Менеджер по продажам ТЭУ',
    stages: getAllStagesContent('sales_manager'),
  },
]

const domesticPackages: Array<{ id: string; title: string }> = [
  { id: 'domestic_core_operations', title: 'Внутренний логист — базовые операции (ядро)' },
  { id: 'domestic_road_ftl_ltl', title: 'Внутренний логист — авто FTL/LTL' },
  { id: 'domestic_rail_container', title: 'Внутренний логист — ЖД / контейнер' },
  { id: 'domestic_oversized_heavy', title: 'Внутренний логист — негабарит / тяжеловес' },
  { id: 'domestic_remote_regions', title: 'Внутренний логист — труднодоступные регионы' },
  { id: 'domestic_cabotage', title: 'Внутренний логист — морской каботаж' },
]

const domesticRoles: Role[] = domesticPackages.map((pkg) => {
  const stages: StageContent[] = []
  for (const stage of [1, 2, 3, 4]) {
    const c = getDomesticStageContent(pkg.id as never, stage)
    if (c) stages.push(c)
  }
  return { id: pkg.id, title: pkg.title, stages }
})

const all = [...roles, ...domesticRoles]
process.stdout.write(JSON.stringify(all, null, 2))
