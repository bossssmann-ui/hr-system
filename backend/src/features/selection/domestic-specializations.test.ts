import { describe, expect, test } from 'bun:test'

import { selectSpecializations } from './domestic-specializations'

describe('selectSpecializations', () => {
  test('всегда включает domestic_core_operations как primary', () => {
    const result = selectSpecializations([])
    const core = result.find((a) => a.packageId === 'domestic_core_operations')
    expect(core).toBeDefined()
    expect(core?.level).toBe('primary')
  })

  test('добавляет domestic_road_ftl_ltl при сигнале "FTL"', () => {
    const result = selectSpecializations(['FTL'])
    expect(result.some((a) => a.packageId === 'domestic_road_ftl_ltl')).toBe(true)
  })

  test('добавляет domestic_road_ftl_ltl при сигнале "ATI"', () => {
    const result = selectSpecializations(['ATI'])
    expect(result.some((a) => a.packageId === 'domestic_road_ftl_ltl')).toBe(true)
  })

  test('добавляет domestic_road_ftl_ltl при сигнале "сборные"', () => {
    const result = selectSpecializations(['сборные'])
    expect(result.some((a) => a.packageId === 'domestic_road_ftl_ltl')).toBe(true)
  })

  test('не добавляет domestic_distribution при сигнале "развозка"', () => {
    const result = selectSpecializations(['развозка'])
    expect(result.some((a) => a.packageId === 'domestic_distribution')).toBe(false)
  })

  test('не добавляет domestic_distribution при сигнале "окна доставки"', () => {
    const result = selectSpecializations(['окна доставки'])
    expect(result.some((a) => a.packageId === 'domestic_distribution')).toBe(false)
  })

  test('добавляет domestic_rail_container при сигнале "ЭТРАН"', () => {
    const result = selectSpecializations(['ЭТРАН'])
    expect(result.some((a) => a.packageId === 'domestic_rail_container')).toBe(true)
  })

  test('добавляет domestic_rail_container при сигнале "контейнер"', () => {
    const result = selectSpecializations(['контейнер'])
    expect(result.some((a) => a.packageId === 'domestic_rail_container')).toBe(true)
  })

  test('добавляет domestic_oversized_heavy при сигнале "негабарит"', () => {
    const result = selectSpecializations(['негабарит'])
    expect(result.some((a) => a.packageId === 'domestic_oversized_heavy')).toBe(true)
  })

  test('добавляет domestic_oversized_heavy при сигнале "трал"', () => {
    const result = selectSpecializations(['трал'])
    expect(result.some((a) => a.packageId === 'domestic_oversized_heavy')).toBe(true)
  })

  test('добавляет domestic_remote_regions при сигнале "Якутия"', () => {
    const result = selectSpecializations(['Якутия'])
    expect(result.some((a) => a.packageId === 'domestic_remote_regions')).toBe(true)
  })

  test('добавляет domestic_remote_regions при сигнале "зимник"', () => {
    const result = selectSpecializations(['зимник'])
    expect(result.some((a) => a.packageId === 'domestic_remote_regions')).toBe(true)
  })

  test('добавляет domestic_cabotage при сигнале "каботаж"', () => {
    const result = selectSpecializations(['каботаж'])
    expect(result.some((a) => a.packageId === 'domestic_cabotage')).toBe(true)
  })

  test('добавляет domestic_cabotage при сигнале "Сахалин"', () => {
    const result = selectSpecializations(['Сахалин'])
    expect(result.some((a) => a.packageId === 'domestic_cabotage')).toBe(true)
  })

  test('при пустых сигналах → core + road_ftl_ltl', () => {
    const result = selectSpecializations([])
    const ids = result.map((a) => a.packageId)
    expect(ids).toContain('domestic_core_operations')
    expect(ids).toContain('domestic_road_ftl_ltl')
    expect(ids).toHaveLength(2)
  })

  test('не дублирует пакет при нескольких триггерах одного пакета', () => {
    const result = selectSpecializations(['FTL', 'LTL', 'фуры'])
    const roadPackages = result.filter((a) => a.packageId === 'domestic_road_ftl_ltl')
    expect(roadPackages).toHaveLength(1)
  })

  test('регистронезависимо ("НЕГАБАРИТ" === "негабарит")', () => {
    const result = selectSpecializations(['НЕГАБАРИТ'])
    expect(result.some((a) => a.packageId === 'domestic_oversized_heavy')).toBe(true)
  })
})
