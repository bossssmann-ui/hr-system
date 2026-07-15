/**
 * Unit tests for resolveFunnelStages utility.
 *
 * Pure function — no DB, no Prisma.
 */
import { describe, expect, test } from 'bun:test'

import { APPLICATION_STAGES } from '../applications/applications.fsm'
import { resolveFunnelStages } from './funnel-stages'

describe('resolveFunnelStages', () => {
  test('no config → canonical order of all 7 stages with default labels', () => {
    const result = resolveFunnelStages(null)
    expect(result).toHaveLength(APPLICATION_STAGES.length)
    // All stages present
    const resultStages = result.map((d) => d.stage)
    for (const stage of APPLICATION_STAGES) {
      expect(resultStages).toContain(stage)
    }
    // Canonical order: new, screen, tech, final, offer, hired, rejected
    expect(resultStages).toEqual([...APPLICATION_STAGES])
    // None hidden by default
    for (const d of result) {
      expect(d.hidden).toBe(false)
    }
    // Labels are non-empty strings
    for (const d of result) {
      expect(typeof d.label).toBe('string')
      expect(d.label.length).toBeGreaterThan(0)
    }
  })

  test('undefined config → same as null (canonical defaults)', () => {
    const result = resolveFunnelStages(undefined)
    expect(result).toHaveLength(APPLICATION_STAGES.length)
    expect(result.map((d) => d.stage)).toEqual([...APPLICATION_STAGES])
  })

  test('empty array config → canonical defaults', () => {
    const result = resolveFunnelStages([])
    expect(result).toHaveLength(APPLICATION_STAGES.length)
    expect(result.map((d) => d.stage)).toEqual([...APPLICATION_STAGES])
  })

  test('partial config: rename tech, hide final, reorder screen', () => {
    const config = [
      { stage: 'tech' as const, label: 'Техническое интервью', order: 2 },
      { stage: 'final' as const, order: 3, hidden: true },
      { stage: 'screen' as const, label: 'Первичный скрининг', order: 1 },
    ]

    const result = resolveFunnelStages(config)
    expect(result).toHaveLength(APPLICATION_STAGES.length)

    const tech = result.find((d) => d.stage === 'tech')!
    expect(tech.label).toBe('Техническое интервью')
    expect(tech.hidden).toBe(false)

    const final = result.find((d) => d.stage === 'final')!
    expect(final.hidden).toBe(true)

    const screen = result.find((d) => d.stage === 'screen')!
    expect(screen.label).toBe('Первичный скрининг')

    // Stages not in config keep canonical defaults
    const newStage = result.find((d) => d.stage === 'new')!
    expect(newStage.hidden).toBe(false)
    expect(newStage.order).toBe(0)
  })

  test('result is sorted by order asc', () => {
    const config = [
      { stage: 'offer' as const, order: 0 },
      { stage: 'new' as const, order: 10 },
    ]
    const result = resolveFunnelStages(config)
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.order).toBeLessThanOrEqual(result[i + 1]!.order)
    }
    // offer moved to front (order 0), new moved toward end (order 10)
    expect(result[0]!.stage).toBe('offer')
  })

  test('hidden: true stages are present in the list (callers decide to exclude)', () => {
    const config = [
      { stage: 'rejected' as const, order: 6, hidden: true },
      { stage: 'hired' as const, order: 5, hidden: true },
    ]
    const result = resolveFunnelStages(config)
    const hidden = result.filter((d) => d.hidden)
    expect(hidden).toHaveLength(2)
    expect(hidden.map((d) => d.stage)).toContain('rejected')
    expect(hidden.map((d) => d.stage)).toContain('hired')
  })

  test('visible stages after filtering hidden ones', () => {
    const config = [{ stage: 'final' as const, order: 3, hidden: true }]
    const result = resolveFunnelStages(config)
    const visible = result.filter((d) => !d.hidden)
    expect(visible).toHaveLength(APPLICATION_STAGES.length - 1)
    expect(visible.find((d) => d.stage === 'final')).toBeUndefined()
  })
})
