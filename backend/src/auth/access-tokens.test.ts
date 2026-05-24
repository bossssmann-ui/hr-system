import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../env'
import { signAccessToken, verifyAccessToken } from './access-tokens'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: false,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: undefined,
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: false,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: undefined,
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
PROCTORING_WEBCAM_ENABLED: false,
TRUST_WEIGHT_PASTE: 0.35,
TRUST_WEIGHT_FOCUS: 0.4,
TRUST_WEIGHT_KEYSTROKE: 0.25,
TRUST_LOW_THRESHOLD: 50,
QUIET_HOURS_QUIET_START_UTC: 15,
QUIET_HOURS_QUIET_END_UTC: 23,
}

describe('access tokens', () => {
  test('signs and verifies session-scoped JWT payloads', async () => {
    const token = await signAccessToken(
      {
        sub: 'user_1',
        sessionId: 'session_1',
        email: 'user@example.com',
      },
      env,
    )

    await expect(verifyAccessToken(token, env)).resolves.toEqual({
      sub: 'user_1',
      sessionId: 'session_1',
      email: 'user@example.com',
    })
  })
})
