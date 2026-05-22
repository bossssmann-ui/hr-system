/**
 * Yandex SpeechKit ASR provider.
 *
 * Uses the Yandex SpeechKit async recognition API (supports long audio files,
 * speaker diarization). Audio stays in RF infrastructure — 152-ФЗ compatible.
 *
 * Config: ASR_API_KEY, ASR_FOLDER_ID (Yandex IAM / API key + folder id).
 * Language: ASR_LANGUAGE (default "ru-RU").
 *
 * The HTTP client is injectable so CI tests can mock without network.
 *
 * Docs: https://cloud.yandex.ru/docs/speechkit/stt/api/transcribation
 * TODO(phase-1f+): add WhisperProvider as an alternative provider.
 */

import type { TranscriptionInput, TranscriptionProvider, TranscriptResult } from './provider'
import { TranscriptionProviderError } from './provider'

export const YANDEX_SPEECHKIT_PROVIDER_NAME = 'yandex_speechkit'
export const YANDEX_SPEECHKIT_ASR_MODEL = 'general'

type HttpClient = {
  post(url: string, body: unknown, headers: Record<string, string>): Promise<{ data: unknown }>
  get(url: string, headers: Record<string, string>): Promise<{ data: unknown }>
}

type YandexSpeechKitOptions = {
  apiKey: string
  folderId: string
  language?: string
  /** Injectable HTTP client; defaults to fetch-based implementation. */
  httpClient?: HttpClient
}

// Yandex SpeechKit async recognition response shape (simplified).
type YandexAsyncRecognitionResponse = {
  id?: string
  error?: { message?: string }
}

type YandexOperationResponse = {
  done?: boolean
  error?: { message?: string }
  response?: {
    chunks?: Array<{
      channelTag?: string
      alternatives?: Array<{
        words?: Array<{ word?: string; startTime?: string; endTime?: string }>
        text?: string
      }>
    }>
  }
}

const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 150 // 5 minutes maximum

export class YandexSpeechKitProvider implements TranscriptionProvider {
  private readonly apiKey: string
  private readonly folderId: string
  private readonly language: string
  private readonly http: HttpClient

  constructor(options: YandexSpeechKitOptions) {
    this.apiKey = options.apiKey
    this.folderId = options.folderId
    this.language = options.language ?? 'ru-RU'
    this.http = options.httpClient ?? createFetchHttpClient()
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptResult> {
    // Step 1: Submit async recognition job.
    const submitResponse = await this.http
      .post(
        'https://transcribe.api.cloud.yandex.net/speech/stt/v2/longRunningRecognize',
        {
          config: {
            specification: {
              languageCode: input.language || this.language,
              model: YANDEX_SPEECHKIT_ASR_MODEL,
              audioEncoding: 'OGG_OPUS',
              enableWordTimeOffsets: true,
              enableSpeakerLabels: true,
              literature_text: false,
            },
            folderId: this.folderId,
          },
          audio: {
            uri: input.audioRef,
          },
        },
        {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      )
      .catch((err: unknown) => {
        throw new TranscriptionProviderError(
          YANDEX_SPEECHKIT_PROVIDER_NAME,
          `Failed to submit ASR job: ${err instanceof Error ? err.message : String(err)}`,
        )
      })

    const submitData = submitResponse.data as YandexAsyncRecognitionResponse
    if (submitData.error) {
      throw new TranscriptionProviderError(
        YANDEX_SPEECHKIT_PROVIDER_NAME,
        `ASR submission error: ${submitData.error.message ?? 'unknown'}`,
      )
    }

    const operationId = submitData.id
    if (!operationId) {
      throw new TranscriptionProviderError(YANDEX_SPEECHKIT_PROVIDER_NAME, 'No operation ID returned')
    }

    // Step 2: Poll until done.
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS)

      const pollResponse = await this.http
        .get(`https://operation.api.cloud.yandex.net/operations/${operationId}`, {
          Authorization: `Api-Key ${this.apiKey}`,
        })
        .catch((err: unknown) => {
          throw new TranscriptionProviderError(
            YANDEX_SPEECHKIT_PROVIDER_NAME,
            `Failed to poll ASR operation: ${err instanceof Error ? err.message : String(err)}`,
          )
        })

      const operation = pollResponse.data as YandexOperationResponse

      if (operation.error) {
        throw new TranscriptionProviderError(
          YANDEX_SPEECHKIT_PROVIDER_NAME,
          `ASR operation failed: ${operation.error.message ?? 'unknown'}`,
        )
      }

      if (!operation.done) continue

      return parseYandexResponse(operation, input.language || this.language)
    }

    throw new TranscriptionProviderError(
      YANDEX_SPEECHKIT_PROVIDER_NAME,
      'ASR recognition timed out after maximum poll attempts',
    )
  }
}

function parseYandexResponse(operation: YandexOperationResponse, language: string): TranscriptResult {
  const chunks = operation.response?.chunks ?? []
  const segments = chunks.flatMap((chunk, chunkIdx) => {
    const speaker = chunk.channelTag ?? `speaker_${chunkIdx}`
    const alternatives = chunk.alternatives ?? []
    const alt = alternatives[0]
    if (!alt) return []

    const words = alt.words ?? []
    if (words.length === 0) {
      // Chunk without word timing: emit as a single segment.
      return [
        {
          speaker,
          start_ms: 0,
          end_ms: 0,
          text: alt.text ?? '',
        },
      ]
    }

    const startMs = parseTimeSecs(words[0]?.startTime ?? '0s') * 1000
    const endMs = parseTimeSecs(words[words.length - 1]?.endTime ?? '0s') * 1000
    return [
      {
        speaker,
        start_ms: Math.round(startMs),
        end_ms: Math.round(endMs),
        text: alt.text ?? words.map((w) => w.word ?? '').join(' '),
      },
    ]
  })

  return {
    segments,
    language,
    asr_provider: YANDEX_SPEECHKIT_PROVIDER_NAME,
    asr_model: YANDEX_SPEECHKIT_ASR_MODEL,
  }
}

function parseTimeSecs(value: string): number {
  // Yandex returns time as "1.234s"
  const num = parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function createFetchHttpClient(): HttpClient {
  return {
    async post(url, body, headers) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      return { data }
    },
    async get(url, headers) {
      const res = await fetch(url, { headers })
      const data = await res.json()
      return { data }
    },
  }
}
