import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import { ScoringProviderMalformedResponseError, type ScoringProvider } from '../../integrations/llm'
import { buildScoringInput, hashScoringInput, scoreApplication } from './scoring.service'

const baseEnv: AppEnv = {
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
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: 'test-api-key',
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: true,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: 'test-api-key',
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
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
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
}

describe('scoring service', () => {
  test('buildScoringInput strips contact PII fields from scoring payload', async () => {
    const fixture = await Bun.file(new URL('./__fixtures__/candidate-snapshot.json', import.meta.url)).json()
    const input = buildScoringInput(fixture as never, {
      title: 'Resume Title',
      skills: ['Hono'],
      total_experience_months: 80,
      email: 'private@example.com',
      phone: '+70000000000',
      full_name: 'Should Not Be Included',
    })

    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('+70000000000')
    expect(serialized).not.toContain('Should Not Be Included')
  })

  test('stores successful scoring result and audit event', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 77,
        summary: 'Good technical alignment with manageable gaps.',
        strengths: ['TypeScript APIs'],
        gaps: ['No finance domain'],
        soft_skills_signals: ['Ownership language'],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Likely collaborative.',
        interview_focus_areas: ['Domain ramp-up speed'],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(prisma.state.updates.at(-1)?.aiScoring.status).toBe('scored')
    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('application.ai_scored')
  })

  test('writes failed state when provider returns malformed JSON twice', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => {
        throw new ScoringProviderMalformedResponseError('claude-haiku-4-5-20251001')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
    })

    expect(result.status).toBe('failed')
    expect(prisma.state.updates.at(-1)?.aiScoring.status).toBe('failed')
  })

  test('skips re-scoring when input hash is unchanged', async () => {
    const prisma = createPrismaMock()

    const originalInput = buildScoringInput(prisma.state.application as never, null)
    prisma.state.application.aiScoring = {
      status: 'scored',
      input_hash: hashScoringInput(originalInput),
      result: {
        relevance_score: 70,
      },
    }

    const provider: ScoringProvider = {
      score: async () => {
        throw new Error('should not be called')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('unchanged_input')
  })
})

function createPrismaMock() {
  const state = {
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'cand-1',
      aiScoring: null as unknown,
      candidate: {
        location: 'Moscow',
        externalIds: {
          hh_resume_snapshot: {
            title: 'Backend engineer',
            experience: ['Senior Engineer @ Acme'],
            education: ['MIPT · 2018'],
            skills: ['TypeScript'],
            total_experience_months: 72,
            location: 'Moscow',
          },
        },
      },
      vacancy: {
        title: 'Senior Backend Engineer',
        description: 'TypeScript, PostgreSQL, API design',
        requisition: {
          grade: 'M3',
          salaryMin: 200000,
          salaryMax: 300000,
          currency: 'RUB',
        },
      },
    },
    updates: [] as Array<{ aiScoring: Record<string, unknown> }>,
    auditEvents: [] as Array<Record<string, unknown>>,
  }

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return where.id === state.application.id ? state.application : null
      },
      update: async ({ data }: { data: { aiScoring: Record<string, unknown> } }) => {
        state.application.aiScoring = data.aiScoring
        state.updates.push({ aiScoring: data.aiScoring })
        return state.application
      },
    },
    resume: {
      findFirst: async () => null,
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
      },
    },
    state,
  }

  return prisma
}
