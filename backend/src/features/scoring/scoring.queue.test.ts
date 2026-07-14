import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import type { ScoringProvider } from '../../integrations/llm'
import { markApplicationScoringQueued, recoverPendingApplicationScoring } from './scoring.queue'

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
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: 'gemini-2.0-flash',
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
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

describe('scoring queue recovery', () => {
  test('marks queued scoring persistently and preserves the previous score', async () => {
    const prisma = createPrismaMock()

    const result = await markApplicationScoringQueued({
      prisma: prisma as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      force: true,
    })

    expect(result.marked).toBe(true)
    const queued = prisma.state.application.aiScoring as Record<string, unknown>
    const previous = queued.previous_scoring as Record<string, unknown>
    const previousResult = previous.result as Record<string, unknown>
    expect(queued.status).toBe('pending')
    expect(queued.queue).toBe('application.ai_scoring')
    expect(queued.force).toBe(true)
    expect(previousResult.relevance_score).toBe(82)
  })

  test('recovers stale pending scoring requests and skips fresh ones', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.aiScoring = {
      status: 'pending',
      queue: 'application.ai_scoring',
      queued_at: '2026-07-06T00:00:00.000Z',
      force: true,
      previous_scoring: prisma.state.previousScoring,
    }
    prisma.state.freshApplication.aiScoring = {
      status: 'pending',
      queue: 'application.ai_scoring',
      queued_at: new Date().toISOString(),
      force: false,
    }

    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 64,
        summary: 'Recovered score.',
        strengths: ['Relevant logistics experience'],
        gaps: [],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Needs recruiter review.',
        interview_focus_areas: [],
        model: 'claude-haiku-4-5-20251001',
        scored_at: '2026-07-07T00:00:00.000Z',
        schema_version: 1,
      }),
    }

    const result = await recoverPendingApplicationScoring({
      prisma: prisma as never,
      env: baseEnv,
      staleAfterMs: 60_000,
      limit: 10,
      provider,
    } as never)

    expect(result).toEqual({ recovered: 1, skipped: 1 })
    expect(prisma.state.application.aiScoring.status).toBe('scored')
    expect(prisma.state.freshApplication.aiScoring.status).toBe('pending')
  })
})

function createPrismaMock() {
  const previousScoring = {
    status: 'scored',
    input_hash: 'old-hash',
    result: {
      relevance_score: 82,
      summary: 'Previous score.',
      strengths: [],
      gaps: [],
      soft_skills_signals: [],
      red_flags: [],
      anti_fraud_signals: [],
      values_fit_hypothesis: 'Previous.',
      interview_focus_areas: [],
      model: 'old-model',
      scored_at: '2026-07-05T00:00:00.000Z',
      schema_version: 1,
    },
  }
  const state = {
    previousScoring,
    application: createApplication('app-1', previousScoring),
    freshApplication: createApplication('app-2', null),
    auditEvents: [] as Array<Record<string, unknown>>,
    stageEvents: [] as Array<Record<string, unknown>>,
    userRoles: [{ tenantId: 'tenant-1', userId: 'user-1', role: 'owner', user: { disabledAt: null } }],
  }
  const applications = [state.application, state.freshApplication]

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId?: string } }) => {
        return applications.find((row) => row.id === where.id && (!where.tenantId || row.tenantId === where.tenantId)) ?? null
      },
      findMany: async () => applications.filter((row) => row.aiScoring?.status === 'pending'),
      update: async ({ where, data }: { where: { id: string }; data: { aiScoring?: Record<string, unknown>; stage?: string } }) => {
        const row = applications.find((item) => item.id === where.id)
        if (!row) throw new Error('not found')
        if (data.aiScoring) row.aiScoring = data.aiScoring
        if (data.stage) row.stage = data.stage
        return row
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
    applicationStageEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.stageEvents.push(data)
      },
    },
    userRole: {
      findMany: async ({ where }: { where: { tenantId: string; role: { in: string[] }; user: { disabledAt: null } } }) => {
        return state.userRoles
          .filter((row) => row.tenantId === where.tenantId)
          .filter((row) => where.role.in.includes(row.role))
          .filter((row) => row.user.disabledAt === where.user.disabledAt)
          .map((row) => ({ userId: row.userId, role: row.role }))
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(prisma),
    state,
  }

  return prisma
}

function createApplication(id: string, aiScoring: Record<string, unknown> | null) {
  return {
    id,
    tenantId: 'tenant-1',
    candidateId: 'cand-1',
    stage: 'new',
    updatedAt: new Date('2026-07-06T00:00:00.000Z'),
    aiScoring,
    candidate: {
      location: 'Moscow',
      externalIds: {
        hh_resume_snapshot: {
          title: 'Logist',
          experience: ['Logist @ Acme'],
          education: [],
          skills: ['FTL'],
          total_experience_months: 72,
          location: 'Moscow',
        },
      },
    },
    vacancy: {
      title: 'Logist',
      description: 'FTL, routes, documents',
      requisition: {
        grade: 'M2',
        salaryMin: 100000,
        salaryMax: 150000,
        currency: 'RUB',
      },
    },
  }
}
