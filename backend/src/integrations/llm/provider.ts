import type { ScoringInput, ScoringResult } from './scoring.schemas'

export interface ScoringProvider {
  score(input: ScoringInput): Promise<ScoringResult>
}

export class ScoringProviderMalformedResponseError extends Error {
  readonly model: string

  constructor(model: string, message = 'Malformed JSON response from scoring provider') {
    super(message)
    this.model = model
  }
}
