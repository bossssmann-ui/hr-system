import { describe, it, expect } from 'bun:test'
import { buildStagesForRole, isDomesticRole } from './selection-role-adapter'

describe('isDomesticRole', () => {
  it('logist_domestic → true', () => expect(isDomesticRole('logist_domestic')).toBe(true))
  it('logist → false', () => expect(isDomesticRole('logist')).toBe(false))
  it('sales_manager → false', () => expect(isDomesticRole('sales_manager')).toBe(false))
})

describe('buildStagesForRole', () => {
  it('logist → 4 этапа', () => {
    const stages = buildStagesForRole('logist')
    expect(stages).toHaveLength(4)
  })
  it('sales_manager → 4 этапа', () => {
    const stages = buildStagesForRole('sales_manager')
    expect(stages).toHaveLength(4)
  })
  it('logist_domestic без опций → 4 этапа', () => {
    const stages = buildStagesForRole('logist_domestic')
    expect(stages).toHaveLength(4)
  })
  it('logist_domestic → Stage 2 содержит вопросы', () => {
    const stages = buildStagesForRole('logist_domestic') as any[]
    const stage2 = stages.find((s: any) => s.stage === 2)
    expect(stage2?.questions?.length).toBeGreaterThan(0)
  })
  it('logist_domestic с сигналом "негабарит" → Stage 2 содержит oversized вопросы', () => {
    const stages = buildStagesForRole('logist_domestic', { signals: ['негабарит'] }) as any[]
    const stage2 = stages.find((s: any) => s.stage === 2)
    expect(stage2?.questions?.length).toBeGreaterThan(5)
  })
  it('logist_domestic → Stage 3 psycho присутствует', () => {
    const stages = buildStagesForRole('logist_domestic') as any[]
    const stage3 = stages.find((s: any) => s.stage === 3)
    expect(stage3).toBeDefined()
    expect((stage3 as any)?.type).toBe('psychology')
  })
  it('logist_domestic → Stage 4 assignment присутствует', () => {
    const stages = buildStagesForRole('logist_domestic') as any[]
    const stage4 = stages.find((s: any) => s.stage === 4)
    expect(stage4).toBeDefined()
    expect((stage4 as any)?.type).toBe('assignment')
  })
})
