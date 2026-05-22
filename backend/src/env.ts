import { z } from 'zod'
import { isHhEncryptionKeyStrongEnough } from './integrations/hh/crypto'

const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const knownWeakJwtSecrets = new Set(['replace-with-at-least-32-random-characters'])

const optionalStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().min(1).optional())

const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().url().optional())

const stringWithDefault = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }, z.string().min(1).default(defaultValue))

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:8081,http://localhost:19006')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: booleanStringSchema,
  HH_INTEGRATION_ENABLED: booleanStringSchema,
  HH_CLIENT_ID: optionalStringSchema,
  HH_CLIENT_SECRET: optionalStringSchema,
  HH_TOKEN_ENCRYPTION_KEY: optionalStringSchema,
  AI_SCORING_ENABLED: booleanStringSchema,
  LLM_SCORING_PROVIDER: stringWithDefault('anthropic'),
  LLM_SCORING_API_KEY: optionalStringSchema,
  LLM_SCORING_MODEL: stringWithDefault('claude-haiku-4-5-20251001'),
  TRANSCRIPTION_ENABLED: booleanStringSchema,
  ASR_PROVIDER: stringWithDefault('yandex_speechkit'),
  ASR_API_KEY: optionalStringSchema,
  ASR_FOLDER_ID: optionalStringSchema,
  ASR_LANGUAGE: stringWithDefault('ru-RU'),
  INTERVIEW_RECORDING_MAX_BYTES: z.coerce.number().int().positive().default(500 * 1024 * 1024),
  SPACES_REGION: optionalStringSchema,
  SPACES_BUCKET: optionalStringSchema,
  SPACES_ENDPOINT: optionalUrlSchema,
  SPACES_CDN_BASE_URL: optionalUrlSchema,
  SPACES_ACCESS_KEY_ID: optionalStringSchema,
  SPACES_SECRET_ACCESS_KEY: optionalStringSchema,
  SPACES_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  SPACES_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(15 * 60),
  SPACES_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(5 * 60),
  SPACES_PUBLIC_CACHE_CONTROL: stringWithDefault('public, max-age=31536000, immutable'),
  // Phase 1E — Candidate messenger channels
  TELEGRAM_ENABLED: booleanStringSchema,
  TELEGRAM_BOT_TOKEN: optionalStringSchema,
  EMAIL_ENABLED: booleanStringSchema,
  SMTP_HOST: optionalStringSchema,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: optionalStringSchema,
  SMTP_PASS: optionalStringSchema,
  SMTP_FROM: optionalStringSchema,
}).superRefine((env, ctx) => {
  validateJwtSecret(env, ctx)
  validateCorsOrigins(env, ctx)
  validateStorageEnv(env, ctx)
  validateHhIntegrationEnv(env, ctx)
  validateAiScoringEnv(env, ctx)
  validateMessagingEnv(env, ctx)
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source)
}

function validateJwtSecret(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!isProductionLikeRuntime(env)) return

  if (isWeakJwtSecret(env.JWT_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be a non-placeholder random secret in production',
    })
  }
}

function isProductionLikeRuntime(env: z.infer<typeof envSchema>) {
  return env.NODE_ENV === 'production' || env.COOKIE_SECURE
}

function isWeakJwtSecret(secret: string) {
  const normalized = secret.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    knownWeakJwtSecrets.has(normalized) ||
    new Set(normalized).size === 1
  )
}

function validateCorsOrigins(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.CORS_ORIGINS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'CORS_ORIGINS must contain at least one allowed browser origin',
    })
    return
  }

  for (const origin of env.CORS_ORIGINS) {
    if (origin === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must not use wildcard origins when credentials are enabled',
      })
      continue
    }

    let url: URL
    try {
      url = new URL(origin)
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS contains an invalid URL: ${origin}`,
      })
      continue
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use http or https origins: ${origin}`,
      })
    }

    if (url.origin !== origin) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must contain origins only, not paths: ${origin}`,
      })
    }

    if (env.COOKIE_SECURE && url.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use HTTPS when COOKIE_SECURE=true: ${origin}`,
      })
    }
  }
}

function validateStorageEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const requiredStorageKeys = [
    'SPACES_REGION',
    'SPACES_BUCKET',
    'SPACES_ENDPOINT',
    'SPACES_ACCESS_KEY_ID',
    'SPACES_SECRET_ACCESS_KEY',
  ] as const
  const storageConfigured =
    requiredStorageKeys.some((key) => env[key] !== undefined) || env.SPACES_CDN_BASE_URL !== undefined

  if (!storageConfigured) return

  for (const key of requiredStorageKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when DigitalOcean Spaces storage is configured`,
      })
    }
  }
}

function validateHhIntegrationEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!env.HH_INTEGRATION_ENABLED) return

  if (!env.HH_CLIENT_ID) {
    ctx.addIssue({
      code: 'custom',
      path: ['HH_CLIENT_ID'],
      message: 'HH_CLIENT_ID is required when HH integration is enabled',
    })
  }

  if (!env.HH_CLIENT_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['HH_CLIENT_SECRET'],
      message: 'HH_CLIENT_SECRET is required when HH integration is enabled',
    })
  }

  if (!isHhEncryptionKeyStrongEnough(env.HH_TOKEN_ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['HH_TOKEN_ENCRYPTION_KEY'],
      message: 'HH_TOKEN_ENCRYPTION_KEY must be at least 16 characters when HH integration is enabled',
    })
  }
}

function validateAiScoringEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!env.AI_SCORING_ENABLED) return

  if (!env.LLM_SCORING_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_SCORING_API_KEY'],
      message: 'LLM_SCORING_API_KEY is required when AI_SCORING_ENABLED=true',
    })
  }
}

function validateMessagingEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.TELEGRAM_ENABLED && !env.TELEGRAM_BOT_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_BOT_TOKEN'],
      message: 'TELEGRAM_BOT_TOKEN is required when TELEGRAM_ENABLED=true',
    })
  }

  if (env.EMAIL_ENABLED) {
    const requiredSmtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'] as const
    for (const key of requiredSmtpKeys) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when EMAIL_ENABLED=true`,
        })
      }
    }
  }
}
