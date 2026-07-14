import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { createCapacityGuard, getSharedCapacityGuard, resetSharedCapacityGuardForTests } from './capacity-guard'

describe('capacityGuard', () => {
  test('canStart() = true если active < 3', () => {
    const guard = createCapacityGuard({ maxActive: 3 })
    expect(guard.canStart()).toBe(true)
  })

  test('canStart() = false если active >= 3', () => {
    const guard = createCapacityGuard({ maxActive: 3 })
    guard.register('s1')
    guard.register('s2')
    guard.register('s3')
    expect(guard.canStart()).toBe(false)
  })

  test('register() увеличивает счётчик', () => {
    const guard = createCapacityGuard({ maxActive: 5 })
    expect(guard.getActiveCount()).toBe(0)
    guard.register('s1')
    expect(guard.getActiveCount()).toBe(1)
    guard.register('s2')
    expect(guard.getActiveCount()).toBe(2)
  })

  test('release() уменьшает счётчик', () => {
    const guard = createCapacityGuard({ maxActive: 5 })
    guard.register('s1')
    guard.register('s2')
    guard.release('s1')
    expect(guard.getActiveCount()).toBe(1)
  })

  test('canStart() после release() снова true', () => {
    const guard = createCapacityGuard({ maxActive: 2 })
    guard.register('s1')
    guard.register('s2')
    expect(guard.canStart()).toBe(false)
    guard.release('s1')
    expect(guard.canStart()).toBe(true)
  })

  test('getNextSlot() возвращает время если занято', () => {
    const guard = createCapacityGuard({ maxActive: 1, slotDurationMin: 30, bufferMin: 5 })
    guard.register('s1')
    expect(guard.canStart()).toBe(false)
    const minutes = guard.getNextSlotMinutes()
    expect(minutes).toBeGreaterThan(0)
    expect(minutes).toBe(35) // slotDurationMin + bufferMin
  })

  test('max перекрывается env MAX_ACTIVE_AI_INTERVIEWS', () => {
    const originalEnv = process.env['MAX_ACTIVE_AI_INTERVIEWS']
    process.env['MAX_ACTIVE_AI_INTERVIEWS'] = '1'
    try {
      // createCapacityGuard without explicit maxActive should use env
      const guard = createCapacityGuard()
      guard.register('s1')
      expect(guard.canStart()).toBe(false)
    } finally {
      if (originalEnv === undefined) {
        delete process.env['MAX_ACTIVE_AI_INTERVIEWS']
      } else {
        process.env['MAX_ACTIVE_AI_INTERVIEWS'] = originalEnv
      }
    }
  })

  test('shared guard сохраняет активные сессии между вызовами', () => {
    resetSharedCapacityGuardForTests()
    const first = getSharedCapacityGuard()
    first.register('s1')

    const second = getSharedCapacityGuard()
    expect(second.getActiveCount()).toBe(1)

    second.release('s1')
    resetSharedCapacityGuardForTests()
  })
})
