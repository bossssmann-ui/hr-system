import { describe, expect, test } from 'bun:test'

import {
  calibrateWeightCaps,
  DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS,
  parseDomesticScoringWeightCaps,
} from './retention-calibration'

describe('retention calibration', () => {
  test('fallback to defaults when sample is below threshold', () => {
    const rows = Array.from({ length: 10 }, () => ({
      hardSkillFactology: 7,
      resumeAndInterview: 10,
      coreOperations: 10,
      primarySpec: 10,
      secondarySpec: 10,
      practicalAssignment: 10,
      communication: 2,
      survived90: 1,
    }))
    expect(calibrateWeightCaps(rows)).toEqual(DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS)
  })

  test('calibrates on synthetic data and keeps total cap = 100', () => {
    const rows = Array.from({ length: 60 }, (_, index) => {
      const survived90 = index % 2
      const primarySignal = survived90 ? 24 : 8
      return {
        hardSkillFactology: survived90 ? 9 : 4,
        resumeAndInterview: 10,
        coreOperations: 12,
        primarySpec: primarySignal,
        secondarySpec: 5,
        practicalAssignment: survived90 ? 18 : 9,
        communication: survived90 ? 5 : 2,
        survived90,
      }
    })
    const out = calibrateWeightCaps(rows)
    const total =
      out.hardSkillFactology +
      out.resumeAndInterview +
      out.coreOperations +
      out.primarySpec +
      out.secondarySpec +
      out.practicalAssignment +
      out.communication
    expect(total).toBeCloseTo(100, 4)
    expect(out.primarySpec).toBeGreaterThan(DEFAULT_DOMESTIC_SCORING_WEIGHT_CAPS.primarySpec - 0.0001)
  })

  test('parses stored weight json', () => {
    const parsed = parseDomesticScoringWeightCaps({
      hardSkillFactology: 10,
      resumeAndInterview: 4,
      coreOperations: 21,
      primarySpec: 24,
      secondarySpec: 15,
      practicalAssignment: 21,
      communication: 5,
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.coreOperations).toBe(21)
  })
})
