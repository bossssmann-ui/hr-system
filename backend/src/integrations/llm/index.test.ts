import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import { createAssessmentProvider, createScoringProvider } from './index'
import { OpenAiCompatibleScoringProvider } from './openai-compatible.provider'
import { OpenAiCompatibleAssessmentProvider } from './assessment.provider'

const env = {
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'openai_compatible',
  LLM_SCORING_API_KEY: 'test-key',
  LLM_SCORING_MODEL: 'deepseek/deepseek-v4-flash',
  LLM_SCORING_BASE_URL: 'https://llm.example.test/v1',
} as AppEnv

describe('createScoringProvider', () => {
  test('supports openai_compatible scoring provider', () => {
    expect(createScoringProvider(env)).toBeInstanceOf(OpenAiCompatibleScoringProvider)
  })
})

describe('createAssessmentProvider', () => {
  test('supports openai_compatible assessment provider', () => {
    expect(createAssessmentProvider(env)).toBeInstanceOf(OpenAiCompatibleAssessmentProvider)
  })
})
