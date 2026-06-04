import { describe, expect, test } from 'bun:test'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { createInMemoryQueue, drainDurableQueue } from './index'

type JobRow = {
  id: string
  queue_name: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'done' | 'failed'
  attempts: number
  max_retries: number
  available_at: number
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  last_error: string | null
}

function mkEnv(overrides?: Partial<AppEnv>): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'test-db-url',
    JWT_SECRET: 'x'.repeat(32),
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 900,
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
    SPACES_REGION: undefined,
    SPACES_BUCKET: undefined,
    SPACES_ENDPOINT: undefined,
    SPACES_CDN_BASE_URL: undefined,
    SPACES_ACCESS_KEY_ID: undefined,
    SPACES_SECRET_ACCESS_KEY: undefined,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: undefined,
    EMAIL_ENABLED: false,
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: undefined,
    CAREERS_PAGE_ENABLED: false,
    CAREERS_RATE_LIMIT_PER_HOUR: 20,
    QUIET_HOURS_QUIET_START_UTC: 15,
    QUIET_HOURS_QUIET_END_UTC: 23,
    ASSESSMENTS_ENABLED: false,
    ASSESSMENT_SYSTEM_ENABLED: false,
    GEMINI_API_KEY: undefined,
    GEMINI_MODEL: 'gemini-2.0-flash',
    PROCTORING_WEBCAM_ENABLED: false,
    TRUST_WEIGHT_PASTE: 0.35,
    TRUST_WEIGHT_FOCUS: 0.4,
    TRUST_WEIGHT_KEYSTROKE: 0.25,
    TRUST_LOW_THRESHOLD: 50,
    SBER_PODBOR_ENABLED: false,
    SBER_PODBOR_API_TOKEN: undefined,
    AVITO_JOBS_ENABLED: false,
    AVITO_JOBS_API_TOKEN: undefined,
    RABOTA_RU_ENABLED: false,
    RABOTA_RU_API_TOKEN: undefined,
    DOCUSEAL_ENABLED: false,
    DOCUSEAL_API_URL: 'https://api.docuseal.com',
    DOCUSEAL_API_KEY: undefined,
    DOCUSEAL_TEMPLATE_ID: undefined,
    DOCUSEAL_WEBHOOK_SECRET: undefined,
    KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
    SIGNALS_OPEN_THRESHOLD: 60,
    REALTIME_ENABLED: false,
    VALKEY_URL: undefined,
    MOBILE_PUSH_ENABLED: false,
    EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
    QUEUE_POLL_INTERVAL_MS: 5,
    QUEUE_BATCH_SIZE: 20,
    QUEUE_MAX_RETRIES: 3,
    QUEUE_JOB_TIMEOUT_MS: 1000,
    BILLING_ENABLED: false,
    SUBDOMAIN_ROUTING_ENABLED: false,
    TENANT_REGISTRATION_ENABLED: true,
    ...overrides,
  }
}

function buildMockPrisma() {
  const jobs = new Map<string, JobRow>()

  const mock = {
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')
      const now = Date.now()

      if (sql.includes('INSERT INTO queue_jobs')) {
        const [id, queueName, payload, maxRetries, delayMs] = values as [string, string, Record<string, unknown>, number, number]
        jobs.set(id, {
          id,
          queue_name: queueName,
          payload,
          status: 'pending',
          attempts: 0,
          max_retries: maxRetries,
          available_at: now + delayMs,
          created_at: now,
          updated_at: now,
          started_at: null,
          finished_at: null,
          last_error: null,
        })
        return 1
      }

      if (sql.includes("SET status = 'done'")) {
        const [id] = values as [string]
        const job = jobs.get(id)
        if (!job) return 0
        job.status = 'done'
        job.finished_at = now
        job.updated_at = now
        job.last_error = null
        return 1
      }

      if (sql.includes("SET status = 'failed'")) {
        const [nextAttempts, message, id] = values as [number, string, string]
        const job = jobs.get(id)
        if (!job) return 0
        job.status = 'failed'
        job.attempts = nextAttempts
        job.last_error = message
        job.finished_at = now
        job.updated_at = now
        return 1
      }

      if (sql.includes("SET status = 'pending'")) {
        if (sql.includes('attempts =')) {
          const [nextAttempts, delay, message, id] = values as [number, number, string, string]
          const job = jobs.get(id)
          if (!job) return 0
          job.status = 'pending'
          job.attempts = nextAttempts
          job.available_at = now + delay
          job.last_error = message
          job.started_at = null
          job.updated_at = now
          return 1
        }
        const [delay, id] = values as [number, string]
        const job = jobs.get(id)
        if (!job) return 0
        job.status = 'pending'
        job.available_at = now + delay
        job.started_at = null
        job.updated_at = now
        return 1
      }

      return 0
    },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join(' ')
      if (!sql.includes('WITH picked AS')) return []

      const now = Date.now()
      const hasQueueFilter = sql.includes('queue_name =')
      const queueName = hasQueueFilter ? (values[0] as string) : undefined
      const batchSize = hasQueueFilter ? (values[1] as number) : (values[0] as number)

      const picked = Array.from(jobs.values())
        .filter((job) => job.status === 'pending' && job.available_at <= now)
        .filter((job) => (queueName ? job.queue_name === queueName : true))
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, batchSize)

      for (const job of picked) {
        job.status = 'processing'
        job.started_at = now
        job.updated_at = now
      }

      return picked.map((job) => ({
        id: job.id,
        queue_name: job.queue_name,
        payload: job.payload,
        attempts: job.attempts,
        max_retries: job.max_retries,
      }))
    },
  }

  return { prisma: mock as unknown as DbClient, jobs }
}

describe('durable queue', () => {
  test('survives restart (handler registered later)', async () => {
    const { prisma, jobs } = buildMockPrisma()
    const env = mkEnv()

    const queue = createInMemoryQueue<{ prisma: DbClient; env: AppEnv; value: string }>('restart.queue')
    await queue.enqueue({ prisma, env, value: 'job-1' })

    // simulated restart: no handler during enqueue; register later and drain
    const processed: string[] = []
    queue.process(async (payload) => {
      processed.push(payload.value)
    })

    const result = await drainDurableQueue({ prisma, env, queueName: 'restart.queue' })
    expect(result.claimed).toBe(1)
    expect(processed).toEqual(['job-1'])
    expect(Array.from(jobs.values())[0]?.status).toBe('done')
  })

  test('retries failed jobs with backoff and succeeds on next run', async () => {
    const { prisma, jobs } = buildMockPrisma()
    const env = mkEnv({ QUEUE_MAX_RETRIES: 4, QUEUE_POLL_INTERVAL_MS: 1 })
    const queue = createInMemoryQueue<{ prisma: DbClient; env: AppEnv; id: string }>('retry.queue')

    let attempts = 0
    await queue.enqueue({ prisma, env, id: 'r1' })

    queue.process(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('boom')
    })

    await drainDurableQueue({ prisma, env, queueName: 'retry.queue' })

    const first = Array.from(jobs.values())[0]!
    expect(first.status).toBe('pending')
    expect(first.attempts).toBe(1)

    first.available_at = Date.now() - 1
    await drainDurableQueue({ prisma, env, queueName: 'retry.queue' })

    expect(first.status).toBe('done')
    expect(attempts).toBe(2)
  })

  test('does not process one job twice when drained concurrently', async () => {
    const { prisma, jobs } = buildMockPrisma()
    const env = mkEnv()
    const queue = createInMemoryQueue<{ prisma: DbClient; env: AppEnv; id: string }>('lock.queue')

    let handled = 0
    await queue.enqueue({ prisma, env, id: 'one' })

    queue.process(async () => {
      handled += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    await Promise.all([
      drainDurableQueue({ prisma, env, queueName: 'lock.queue' }),
      drainDurableQueue({ prisma, env, queueName: 'lock.queue' }),
    ])

    expect(handled).toBe(1)
    expect(Array.from(jobs.values())[0]?.status).toBe('done')
  })
})
