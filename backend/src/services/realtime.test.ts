import { beforeEach, describe, expect, test } from 'bun:test'

import {
  __setRealtimeBusForTesting,
  getRealtimeBus,
  type RealtimeEvent,
} from './realtime'

describe('realtime bus (in-process)', () => {
  beforeEach(() => {
    __setRealtimeBusForTesting(null)
  })

  test('publishToUser delivers only to the matching (tenant, user)', () => {
    const bus = getRealtimeBus()
    const got: Array<{ user: string; event: RealtimeEvent }> = []

    const stopA = bus.subscribe('t1', 'userA', (e) => got.push({ user: 'A', event: e }))
    const stopB = bus.subscribe('t1', 'userB', (e) => got.push({ user: 'B', event: e }))
    const stopOther = bus.subscribe('t2', 'userA', (e) => got.push({ user: 'other', event: e }))

    bus.publishToUser('t1', 'userA', { type: 'notification.new', payload: { id: '1' } })

    expect(got).toEqual([
      { user: 'A', event: { type: 'notification.new', payload: { id: '1' } } },
    ])

    stopA()
    stopB()
    stopOther()
  })

  test('publishToTenant fans out to every subscriber on the tenant', () => {
    const bus = getRealtimeBus()
    const received: string[] = []

    bus.subscribe('t1', 'userA', () => received.push('A'))
    bus.subscribe('t1', 'userB', () => received.push('B'))
    bus.subscribe('t2', 'userA', () => received.push('t2-A'))

    bus.publishToTenant('t1', {
      type: 'application.stage_changed',
      payload: { applicationId: 'app1', from: 'new', to: 'screen' },
    })

    expect(received.sort()).toEqual(['A', 'B'])
  })

  test('unsubscribe stops delivery', () => {
    const bus = getRealtimeBus()
    const received: RealtimeEvent[] = []
    const stop = bus.subscribe('t1', 'u', (e) => received.push(e))

    bus.publishToUser('t1', 'u', { type: 'notification.new', payload: { id: '1' } })
    stop()
    bus.publishToUser('t1', 'u', { type: 'notification.new', payload: { id: '2' } })

    expect(received).toHaveLength(1)
    expect(received[0]!.payload).toEqual({ id: '1' })
  })

  test('subscriber errors do not affect other subscribers', () => {
    const bus = getRealtimeBus()
    let bGotIt = false
    bus.subscribe('t1', 'u', () => {
      throw new Error('boom')
    })
    bus.subscribe('t1', 'u', () => {
      bGotIt = true
    })

    bus.publishToUser('t1', 'u', { type: 'notification.new', payload: {} })
    expect(bGotIt).toBe(true)
  })
})
