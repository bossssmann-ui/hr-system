import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import {
  DEFAULT_SCORING_WEIGHTS,
  computeCompositeScore,
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
} from './composite-score'

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'test-db-url',
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
  LLM_SCORING_BASE_URL: undefined,
  LLM_SCORING_API_KEY: 'test-api-key',
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
  ASSESSMENTS_ENABLED: true,
  ASSESSMENT_SYSTEM_ENABLED: true,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: true,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  AUTO_SELECTION_THRESHOLD: 70,
  AUTO_REJECT_THRESHOLD: 30,
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
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

describe('computeCompositeScore', () => {
  test('computes overall score when all components are present', () => {
    const result = computeCompositeScore({
      resume: 80,
      selection: { stage1: null, stage2: 70, stage3: 80, stage4: 90, total: 75 },
      assessment: { score: 60, trust: 80 },
      retention: 90,
      updatedAt: '2026-07-01T12:00:00.000Z',
    })

    expect(result.overall).toBe(76.5)
    expect(result.breakdown.selection?.total).toBe(75)
    expect(result.breakdown.assessment).toEqual({ score: 60, trust: 80 })
    expect(result.weights).toEqual(DEFAULT_SCORING_WEIGHTS)
  })

  test('renormalizes weights when only part of the components are available', () => {
    const result = computeCompositeScore({
      resume: 80,
      selection: null,
      assessment: { score: null, trust: 60 },
      retention: 90,
      updatedAt: '2026-07-01T12:00:00.000Z',
    })

    expect(result.overall).toBe(73.341)
    expect(result.weights).toEqual({
      resume: 0.4167,
      selection: 0,
      assessment: 0.4167,
      retention: 0.1667,
    })
  })

  test('uses custom tenant scoring weights', () => {
    const result = computeCompositeScore({
      resume: 50,
      selection: { stage1: null, stage2: 90, stage3: null, stage4: null, total: 90 },
      assessment: null,
      retention: 40,
      scoringWeights: { resume: 1, selection: 3, assessment: 2, retention: 0 },
      updatedAt: '2026-07-01T12:00:00.000Z',
    })

    expect(result.overall).toBe(80)
    expect(result.weights).toEqual({
      resume: 0.25,
      selection: 0.75,
      assessment: 0,
      retention: 0,
    })
  })

  test('returns zero overall score when no components are available', () => {
    const result = computeCompositeScore({
      resume: null,
      selection: null,
      assessment: null,
      retention: null,
      updatedAt: '2026-07-01T12:00:00.000Z',
    })

    expect(result.overall).toBe(0)
    expect(result.breakdown).toEqual({
      resume: null,
      selection: null,
      assessment: null,
      retention: null,
    })
    expect(result.weights).toEqual({
      resume: 0,
      selection: 0,
      assessment: 0,
      retention: 0,
    })
  })

  test('handles 0 and 100 boundary values', () => {
    const low = computeCompositeScore({
      resume: 0,
      selection: { stage1: 0, stage2: 0, stage3: 0, stage4: 0, total: 0 },
      assessment: { score: 0, trust: 0 },
      retention: 0,
      updatedAt: '2026-07-01T12:00:00.000Z',
    })
    const high = computeCompositeScore({
      resume: 100,
      selection: { stage1: 100, stage2: 100, stage3: 100, stage4: 100, total: 100 },
      assessment: { score: 100, trust: 100 },
      retention: 100,
      updatedAt: '2026-07-01T12:00:00.000Z',
    })

    expect(low.overall).toBe(0)
    expect(high.overall).toBe(100)
  })
})

describe('recomputeCompositeScoreForApplication', () => {
  test('writes composite score from current resume, selection, assessment and retention state', async () => {
    const prisma = createPrismaMock()

    const result = await recomputeCompositeScoreForApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
    })

    expect(result?.overall).toBe(88.9)
    expect(prisma.state.lastCompositeScore?.breakdown).toEqual({
      resume: 82,
      selection: { stage1: null, stage2: 70, stage3: 80, stage4: 90, total: 88 },
      assessment: { score: null, trust: 95 },
      retention: 77,
    })
    expect(prisma.state.lastCompositeScore?.weights).toEqual({
      resume: 0.2,
      selection: 0.5,
      assessment: 0.3,
      retention: 0,
    })
  })

  test('is a no-op when COMPOSITE_SCORE_ENABLED is false', async () => {
    const prisma = createPrismaMock()

    const result = await recomputeCompositeScoreForApplication({
      prisma: prisma as never,
      env: { ...baseEnv, COMPOSITE_SCORE_ENABLED: false },
      applicationId: 'app-1',
    })

    expect(result).toBeNull()
    expect(prisma.state.lastCompositeScore).toBeNull()
  })
})

describe('recordCompositeScoreRecomputeFailure', () => {
  test('writes an audit event and swallows logging failures', async () => {
    const prisma = createPrismaMock()

    await recordCompositeScoreRecomputeFailure({
      prisma: prisma as never,
      applicationId: 'app-1',
      error: new Error('boom'),
    })

    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('application.composite_score_recompute_failed')
  })
})

function createPrismaMock() {
  const state = {
    lastCompositeScore: null as Record<string, unknown> | null,
    auditEvents: [] as Array<Record<string, unknown>>,
  }

  const prisma = {
    application: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'app-1'
          ? {
              id: 'app-1',
              tenantId: 'tenant-1',
              aiScoring: {
                status: 'scored',
                result: { relevance_score: 82 },
              },
            }
          : null,
      update: async ({ data }: { data: { compositeScore: Record<string, unknown> } }) => {
        state.lastCompositeScore = data.compositeScore
        return { id: 'app-1' }
      },
    },
    tenantSettings: {
      findUnique: async () => ({
        scoringWeights: { resume: 2, selection: 5, assessment: 3, retention: 0 },
      }),
    },
    selectionSession: {
      findFirst: async () => ({
        verdict: {
          stageScores: {
            stage_2_score: 70,
            stage_3_score: 80,
            stage_4_score: 90,
          },
          totalWeightedScore: 88,
          retentionPrediction: { survival90: 0.77 },
        },
      }),
    },
    assessmentSession: {
      findFirst: async () => ({
        trustScore: 95,
      }),
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
