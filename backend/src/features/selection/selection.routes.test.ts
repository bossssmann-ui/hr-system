import { describe, expect, test } from 'bun:test'

import {
  buildStagesForSession,
  resolvePublicSelectionProgress,
} from './selection.routes'
import { scoreTestStage, type TestStageContent } from './stage-content'

describe('resolvePublicSelectionProgress', () => {
  test('keeps domestic sessions pending until resume parsing starts', () => {
    expect(resolvePublicSelectionProgress({
      status: 'pending',
      role: 'logist_domestic',
    })).toEqual({
      status: 'pending',
      currentStage: null,
      shouldStartStage: false,
    })
  })

  test('starts stage 1 after domestic packages are assigned', () => {
    expect(resolvePublicSelectionProgress({
      status: 'packages_assigned',
      role: 'logist_domestic',
    })).toEqual({
      status: 'stage_1',
      currentStage: 1,
      shouldStartStage: true,
    })
  })

  test('keeps legacy non-domestic pending flow as auto-start stage 1', () => {
    expect(resolvePublicSelectionProgress({
      status: 'pending',
      role: 'logist',
    })).toEqual({
      status: 'stage_1',
      currentStage: 1,
      shouldStartStage: true,
    })
  })
})

describe('buildStagesForSession', () => {
  test('builds domestic stage 2 from assigned specializations instead of static template stages', () => {
    const stages = buildStagesForSession({
      template: { role: 'logist_domestic', stages: [] },
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_oversized_heavy', level: 'primary' },
      ],
    })

    const stage2 = stages.find((stage): stage is TestStageContent => stage.stage === 2 && stage.type === 'test')
    expect(stage2).toBeDefined()
    expect(stage2?.questions.some((q) => q.key.startsWith('oversized_'))).toBe(true)
  })

  test('scores dynamically built domestic stage 2 by its own question keys', () => {
    const stages = buildStagesForSession({
      template: { role: 'logist_domestic', stages: [] },
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_oversized_heavy', level: 'primary' },
      ],
    })
    const stage2 = stages.find((stage): stage is TestStageContent => stage.stage === 2 && stage.type === 'test')
    if (!stage2) throw new Error('stage 2 missing')

    const result = scoreTestStage(stage2, {
      oversized_q1: 'Получить разрешение, проверить маршрут и сопровождение.',
      oversized_q2: 'Мосты, высоту, ширину, радиусы поворотов, ограничения дорог, сезонность.',
      oversized_q3: 'Подрядчик сам всё решит.',
    })

    expect(result.perQuestion['oversized_q2']).toMatchObject({
      correct: true,
      awarded: 2,
    })
  })
})
