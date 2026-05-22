import type { AppEnv } from '../../env'
import { AnthropicScoringProvider } from './anthropic.provider'
import { AnthropicAssessmentProvider } from './assessment.provider'
import type { ScoringProvider } from './provider'

export function isAiScoringConfigured(env: AppEnv) {
  return Boolean(env.AI_SCORING_ENABLED && env.LLM_SCORING_API_KEY)
}

export function createScoringProvider(env: AppEnv): ScoringProvider {
  if (env.LLM_SCORING_PROVIDER !== 'anthropic') {
    throw new Error(`Unsupported LLM_SCORING_PROVIDER: ${env.LLM_SCORING_PROVIDER}`)
  }

  if (!env.LLM_SCORING_API_KEY) {
    throw new Error('LLM_SCORING_API_KEY is required for AI scoring')
  }

  return new AnthropicScoringProvider({
    apiKey: env.LLM_SCORING_API_KEY,
    model: env.LLM_SCORING_MODEL,
  })
}

export type { ScoringProvider } from './provider'
export { ScoringProviderMalformedResponseError } from './provider'
export type { ScoringInput, ScoringResult } from './scoring.schemas'
export { scoringInputSchema, scoringResultSchema } from './scoring.schemas'
export type { ProtocolProvider } from './protocol.provider'
export { AnthropicProtocolProvider, ProtocolProviderMalformedResponseError } from './protocol.provider'
export { AnthropicAssessmentProvider, AssessmentProviderMalformedResponseError } from './assessment.provider'

export function createAssessmentProvider(env: AppEnv) {
  if (!env.LLM_SCORING_API_KEY) {
    throw new Error('LLM_SCORING_API_KEY is required for assessment AI features')
  }
  return new AnthropicAssessmentProvider({
    apiKey: env.LLM_SCORING_API_KEY,
    model: env.LLM_SCORING_MODEL,
  })
}
