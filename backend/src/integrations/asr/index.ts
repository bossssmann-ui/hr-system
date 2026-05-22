import type { AppEnv } from '../../env'
import type { TranscriptionProvider } from './provider'
import { YandexSpeechKitProvider } from './yandex-speechkit.provider'

export function isTranscriptionConfigured(env: AppEnv): boolean {
  return Boolean(env.TRANSCRIPTION_ENABLED && env.ASR_API_KEY)
}

export function createTranscriptionProvider(env: AppEnv): TranscriptionProvider {
  if (env.ASR_PROVIDER !== 'yandex_speechkit') {
    throw new Error(`Unsupported ASR_PROVIDER: ${env.ASR_PROVIDER}`)
  }

  if (!env.ASR_API_KEY) {
    throw new Error('ASR_API_KEY is required for transcription')
  }

  return new YandexSpeechKitProvider({
    apiKey: env.ASR_API_KEY,
    folderId: env.ASR_FOLDER_ID ?? '',
    language: env.ASR_LANGUAGE,
  })
}

export type { TranscriptionProvider, TranscriptResult, TranscriptSegment, TranscriptionInput } from './provider'
export { TranscriptionProviderError } from './provider'
export { YandexSpeechKitProvider } from './yandex-speechkit.provider'
