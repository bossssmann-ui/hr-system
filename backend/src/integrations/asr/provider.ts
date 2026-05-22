/**
 * TranscriptionProvider interface.
 *
 * Current reference implementation: YandexSpeechKitProvider (cloud ASR,
 * 152-ФЗ-friendly — audio stays in RF infrastructure).
 *
 * Future: WhisperProvider (self-hosted antony66/whisper-large-v3-russian +
 * WhisperX/pyannote diarization) can be added without touching call sites —
 * the owner decides cloud vs self-hosted based on budget.
 * See docs/YANDEX_CLOUD.md for ASR infrastructure notes.
 *
 * TODO(phase-1f+): add WhisperProvider for self-hosted inference.
 */

export type TranscriptSegment = {
  speaker: string
  start_ms: number
  end_ms: number
  text: string
}

export type TranscriptResult = {
  segments: TranscriptSegment[]
  language: string
  asr_provider: string
  asr_model: string
}

export type TranscriptionInput = {
  /** Path or URL to the audio file; provider interprets this. */
  audioRef: string
  language: string
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptResult>
}

export class TranscriptionProviderError extends Error {
  readonly provider: string

  constructor(provider: string, message = 'Transcription provider error') {
    super(message)
    this.provider = provider
  }
}
