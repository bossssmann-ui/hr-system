import { describe, expect, test } from 'bun:test'

import { loadEnv } from './env'

describe('loadEnv', () => {
  test('parses defaults and comma-separated origins', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      CORS_ORIGINS: 'http://localhost:5173, http://localhost:8081',
    })

    expect(env.PORT).toBe(3000)
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900)
    expect(env.COOKIE_SECURE).toBe(false)
    expect(env.HH_INTEGRATION_ENABLED).toBe(false)
    expect(env.HH_CLIENT_ID).toBeUndefined()
    expect(env.HH_CLIENT_SECRET).toBeUndefined()
    expect(env.HH_TOKEN_ENCRYPTION_KEY).toBeUndefined()
    expect(env.AI_SCORING_ENABLED).toBe(false)
    expect(env.LLM_SCORING_PROVIDER).toBe('anthropic')
    expect(env.LLM_SCORING_API_KEY).toBeUndefined()
    expect(env.LLM_SCORING_MODEL).toBe('claude-haiku-4-5-20251001')
    expect(env.TRANSCRIPTION_ENABLED).toBe(false)
    expect(env.ASR_PROVIDER).toBe('yandex_speechkit')
    expect(env.ASR_API_KEY).toBeUndefined()
    expect(env.ASR_LANGUAGE).toBe('ru-RU')
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8081'])
    expect(env.SPACES_REGION).toBeUndefined()
    expect(env.SPACES_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(env.SPACES_UPLOAD_URL_TTL_SECONDS).toBe(900)
    expect(env.SPACES_DOWNLOAD_URL_TTL_SECONDS).toBe(300)
    expect(env.SPACES_PUBLIC_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
    expect(env.ASSESSMENTS_ENABLED).toBe(false)
    expect(env.PROCTORING_WEBCAM_ENABLED).toBe(false)
    expect(env.TRUST_WEIGHT_PASTE).toBe(0.35)
    expect(env.TRUST_WEIGHT_FOCUS).toBe(0.4)
    expect(env.TRUST_WEIGHT_KEYSTROKE).toBe(0.25)
    expect(env.TRUST_LOW_THRESHOLD).toBe(50)
  })

  test('requires complete DigitalOcean Spaces configuration when storage is enabled', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        SPACES_BUCKET: 'uploads',
      }),
    ).toThrow()
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        SPACES_CDN_BASE_URL: 'https://images.example.com',
      }),
    ).toThrow()

    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      SPACES_REGION: 'nyc3',
      SPACES_BUCKET: 'uploads',
      SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
      SPACES_CDN_BASE_URL: 'https://images.example.com',
      SPACES_ACCESS_KEY_ID: 'access-key',
      SPACES_SECRET_ACCESS_KEY: 'secret-key',
    })

    expect(env.SPACES_REGION).toBe('nyc3')
    expect(env.SPACES_BUCKET).toBe('uploads')
    expect(env.SPACES_CDN_BASE_URL).toBe('https://images.example.com')
  })

  test('rejects known weak JWT secrets in production-like runtimes', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')
  })

  test('rejects unsafe production CORS origins', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '*',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: 'https://web.example.com/path',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'http://web.example.com',
      }),
    ).toThrow('CORS_ORIGINS')
  })

  test('requires HH credentials and encryption key when HH integration is enabled', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        HH_INTEGRATION_ENABLED: 'true',
      }),
    ).toThrow('HH_CLIENT_ID')

    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      HH_INTEGRATION_ENABLED: 'true',
      HH_CLIENT_ID: 'client-id',
      HH_CLIENT_SECRET: 'client-secret',
      HH_TOKEN_ENCRYPTION_KEY: 'this-is-a-strong-enough-key',
    })

    expect(env.HH_INTEGRATION_ENABLED).toBe(true)
    expect(env.HH_CLIENT_ID).toBe('client-id')
  })

  test('requires LLM scoring API key when AI scoring is enabled', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        AI_SCORING_ENABLED: 'true',
      }),
    ).toThrow('LLM_SCORING_API_KEY')

    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      AI_SCORING_ENABLED: 'true',
      LLM_SCORING_API_KEY: 'test-key',
    })

    expect(env.AI_SCORING_ENABLED).toBe(true)
    expect(env.LLM_SCORING_API_KEY).toBe('test-key')
  })

  test('DocuSeal defaults are disabled and optional', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
    })

    expect(env.DOCUSEAL_ENABLED).toBe(false)
    expect(env.DOCUSEAL_API_URL).toBe('https://api.docuseal.com')
    expect(env.DOCUSEAL_API_KEY).toBeUndefined()
    expect(env.DOCUSEAL_TEMPLATE_ID).toBeUndefined()
    expect(env.DOCUSEAL_WEBHOOK_SECRET).toBeUndefined()
  })

  test('requires DocuSeal credentials when DOCUSEAL_ENABLED=true', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
        JWT_SECRET: '12345678901234567890123456789012',
        DOCUSEAL_ENABLED: 'true',
      }),
    ).toThrow('DOCUSEAL_API_KEY')

    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
      JWT_SECRET: '12345678901234567890123456789012',
      DOCUSEAL_ENABLED: 'true',
      DOCUSEAL_API_KEY: 'ds-key',
      DOCUSEAL_TEMPLATE_ID: 'template-1',
      DOCUSEAL_WEBHOOK_SECRET: 'shhh',
    })

    expect(env.DOCUSEAL_ENABLED).toBe(true)
    expect(env.DOCUSEAL_API_KEY).toBe('ds-key')
    expect(env.DOCUSEAL_TEMPLATE_ID).toBe('template-1')
    expect(env.DOCUSEAL_WEBHOOK_SECRET).toBe('shhh')
  })

  test('Phase 8 job-board flags default to false', () => {
    const env = loadEnv({
      DATABASE_URL: ['postgresql:/', 'superuser:superpassword@localhost:54329/web_app_demo'].join('/'),
      JWT_SECRET: '12345678901234567890123456789012',
    })
    expect(env.SBER_PODBOR_ENABLED).toBe(false)
    expect(env.AVITO_JOBS_ENABLED).toBe(false)
    expect(env.RABOTA_RU_ENABLED).toBe(false)
  })

  test('requires API token when a Phase 8 job board is enabled', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: ['postgresql:/', 'superuser:superpassword@localhost:54329/web_app_demo'].join('/'),
        JWT_SECRET: '12345678901234567890123456789012',
        SBER_PODBOR_ENABLED: 'true',
      }),
    ).toThrow('SBER_PODBOR_API_TOKEN')

    const env = loadEnv({
      DATABASE_URL: ['postgresql:/', 'superuser:superpassword@localhost:54329/web_app_demo'].join('/'),
      JWT_SECRET: '12345678901234567890123456789012',
      SBER_PODBOR_ENABLED: 'true',
      SBER_PODBOR_API_TOKEN: 'sber-tok',
    })
    expect(env.SBER_PODBOR_ENABLED).toBe(true)
    expect(env.SBER_PODBOR_API_TOKEN).toBe('sber-tok')
  })
})
