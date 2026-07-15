import { describe, expect, test } from 'bun:test'
import type { AppEnv } from '../../env'
import { resolvePipelineFlag } from './resolve-pipeline-flag'

const baseEnv = {
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
} satisfies Pick<
  AppEnv,
  'AUTO_SELECTION_ENABLED' | 'AUTO_ASSESSMENT_ENABLED' | 'COMPOSITE_SCORE_ENABLED' | 'RECRUITER_NOTIFICATIONS_ENABLED'
>

describe('resolvePipelineFlag', () => {
  test('override=true with env=false → true', () => {
    expect(
      resolvePipelineFlag('autoSelection', { autoSelection: true }, baseEnv),
    ).toBe(true)
  })

  test('override=false with env=true → false', () => {
    expect(
      resolvePipelineFlag(
        'autoSelection',
        { autoSelection: false },
        { ...baseEnv, AUTO_SELECTION_ENABLED: true },
      ),
    ).toBe(false)
  })

  test('absent override → falls back to env (false)', () => {
    expect(resolvePipelineFlag('autoSelection', {}, baseEnv)).toBe(false)
    expect(resolvePipelineFlag('autoSelection', null, baseEnv)).toBe(false)
    expect(resolvePipelineFlag('autoSelection', undefined, baseEnv)).toBe(false)
  })

  test('absent override → falls back to env (true)', () => {
    const envTrue = { ...baseEnv, AUTO_SELECTION_ENABLED: true }
    expect(resolvePipelineFlag('autoSelection', {}, envTrue)).toBe(true)
    expect(resolvePipelineFlag('autoSelection', { otherFlag: true }, envTrue)).toBe(true)
  })

  test('works for all four flag keys', () => {
    const envAllTrue = {
      AUTO_SELECTION_ENABLED: true,
      AUTO_ASSESSMENT_ENABLED: true,
      COMPOSITE_SCORE_ENABLED: true,
      RECRUITER_NOTIFICATIONS_ENABLED: true,
    } satisfies Pick<
      AppEnv,
      'AUTO_SELECTION_ENABLED' | 'AUTO_ASSESSMENT_ENABLED' | 'COMPOSITE_SCORE_ENABLED' | 'RECRUITER_NOTIFICATIONS_ENABLED'
    >

    expect(resolvePipelineFlag('autoSelection', { autoSelection: false }, envAllTrue)).toBe(false)
    expect(resolvePipelineFlag('autoAssessment', { autoAssessment: false }, envAllTrue)).toBe(false)
    expect(resolvePipelineFlag('compositeScore', { compositeScore: false }, envAllTrue)).toBe(false)
    expect(resolvePipelineFlag('recruiterNotifications', { recruiterNotifications: false }, envAllTrue)).toBe(false)
  })

  test('non-boolean value in featureFlags is ignored, falls back to env', () => {
    expect(
      resolvePipelineFlag('autoSelection', { autoSelection: 'yes' }, { ...baseEnv, AUTO_SELECTION_ENABLED: true }),
    ).toBe(true)
    expect(
      resolvePipelineFlag('autoSelection', { autoSelection: 1 }, baseEnv),
    ).toBe(false)
  })

  test('array featureFlags is treated as absent', () => {
    expect(resolvePipelineFlag('autoSelection', [], { ...baseEnv, AUTO_SELECTION_ENABLED: true })).toBe(true)
  })
})
