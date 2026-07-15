import { describe, expect, test } from 'bun:test'

import { computeUnifiedScore } from './application-score-aggregate'

describe('application score aggregate', () => {
  test('returns final score when selection verdict score exists', () => {
    expect(computeUnifiedScore({
      finalSelectionScore: 82.4,
      preliminaryAiScore: 61.2,
    })).toEqual({ value: 82.4, status: 'final' })
  })

  test('returns preliminary score when final score is missing', () => {
    expect(computeUnifiedScore({
      finalSelectionScore: null,
      preliminaryAiScore: 61.2,
    })).toEqual({ value: 61.2, status: 'preliminary' })
  })

  test('returns null status when no score exists', () => {
    expect(computeUnifiedScore({
      finalSelectionScore: null,
      preliminaryAiScore: null,
    })).toEqual({ value: null, status: null })
  })
})
