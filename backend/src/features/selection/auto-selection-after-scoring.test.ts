import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import { resolvePipelineThresholds, runAutoSelectionAfterScoring } from './auto-selection-after-scoring'

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: '******localhost:54329/web_app_demo',
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
  TELEGRAM_BOT_TOKEN: undefined,
  EMAIL_ENABLED: true,
  SMTP_HOST: 'localhost',
  SMTP_PORT: 1025,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: 'noreply@example.com',
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
  QUIET_HOURS_QUIET_START_UTC: 15,
  QUIET_HOURS_QUIET_END_UTC: 23,
  ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: true,
  AUTO_SELECTION_ENABLED: true,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
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
  DOCUSEAL_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  DOCUSEAL_API_KEY: undefined,
  DOCUSEAL_TEMPLATE_ID: undefined,
  DOCUSEAL_WEBHOOK_SECRET: undefined,
  SBER_PODBOR_ENABLED: false,
  SBER_PODBOR_API_TOKEN: undefined,
  AVITO_JOBS_ENABLED: false,
  AVITO_JOBS_API_TOKEN: undefined,
  RABOTA_RU_ENABLED: false,
  RABOTA_RU_API_TOKEN: undefined,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  VALKEY_URL: undefined,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
  CLARIFICATION_LOOP_ENABLED: false,
  CLARIFICATION_MIN_SCORE: 30,
  SPACES_REGION: undefined,
  SPACES_BUCKET: undefined,
  SPACES_ENDPOINT: undefined,
  SPACES_CDN_BASE_URL: undefined,
  SPACES_ACCESS_KEY_ID: undefined,
  SPACES_SECRET_ACCESS_KEY: undefined,
  LLM_SCORING_BASE_URL: undefined,
}

describe('runAutoSelectionAfterScoring', () => {
  test('high score creates session and sends invite link', async () => {
    const state = createState()
    const invites: Array<{ channel: string; destination: string; token: string }> = []

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 80,
      sendInvite: async (invite) => {
        invites.push({ channel: invite.channel, destination: invite.destination, token: invite.token })
      },
    })

    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]?.applicationId).toBe('app-1')
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({
      channel: 'email',
      destination: 'candidate@example.com',
      token: 'token-1',
    })
  })

  test('repeat call keeps one active session (idempotent)', async () => {
    const state = createState()

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 80,
      sendInvite: async () => undefined,
    })
    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 80,
      sendInvite: async () => undefined,
    })

    expect(state.sessions).toHaveLength(1)
  })

  test('low score auto-rejects and writes audit', async () => {
    const state = createState()

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: { ...baseEnv, RECRUITER_NOTIFICATIONS_ENABLED: true },
      applicationId: 'app-1',
      relevanceScore: 10,
      sendInvite: async () => undefined,
    })

    expect(state.sessions).toHaveLength(0)
    expect(state.application.stage).toBe('rejected')
    const event = state.auditEvents.find((item) => item.action === 'application.auto_rejected')
    expect(event).toBeDefined()
    expect(event?.diff).toMatchObject({
      reason: 'auto_reject_low_relevance',
      relevance_score: 10,
    })
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      template: 'application.auto_rejected',
      recipientUserId: 'recruiter-1',
      payload: expect.objectContaining({
        applicationId: 'app-1',
      }),
    })
  })

  test('mid score keeps stage new and does not create session', async () => {
    const state = createState()

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 50,
      sendInvite: async () => undefined,
    })

    expect(state.sessions).toHaveLength(0)
    expect(state.application.stage).toBe('new')
  })

  test('disabled flag keeps behavior unchanged', async () => {
    const state = createState()

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: { ...baseEnv, AUTO_SELECTION_ENABLED: false },
      applicationId: 'app-1',
      relevanceScore: 80,
      sendInvite: async () => undefined,
    })

    expect(state.sessions).toHaveLength(0)
    expect(state.application.stage).toBe('new')
    expect(state.auditEvents).toHaveLength(0)
    expect(state.notifications).toHaveLength(0)
  })

  test('delivery failure does not rollback created session', async () => {
    const state = createState()

    await runAutoSelectionAfterScoring({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 80,
      sendInvite: async () => {
        throw new Error('smtp down')
      },
    })

    expect(state.sessions).toHaveLength(1)
    const event = state.auditEvents.find((item) => item.action === 'application.auto_selection_delivery_failed')
    expect(event).toBeDefined()
    expect(event?.diff).toMatchObject({ channel: 'email' })
  })
})

describe('resolvePipelineThresholds', () => {
  test('uses tenant pipeline thresholds when they are valid', () => {
    const thresholds = resolvePipelineThresholds(
      { pipelineThresholds: { autoSelection: 90, autoReject: 20 } },
      baseEnv,
    )
    expect(thresholds).toEqual({ autoSelection: 90, autoReject: 20 })
  })

  test('falls back to env defaults when tenant thresholds are missing or null', () => {
    expect(resolvePipelineThresholds(null, baseEnv)).toEqual({
      autoSelection: baseEnv.AUTO_SELECTION_THRESHOLD,
      autoReject: baseEnv.AUTO_REJECT_THRESHOLD,
    })
    expect(resolvePipelineThresholds({ pipelineThresholds: null }, baseEnv)).toEqual({
      autoSelection: baseEnv.AUTO_SELECTION_THRESHOLD,
      autoReject: baseEnv.AUTO_REJECT_THRESHOLD,
    })
  })

  test('falls back to env defaults when tenant thresholds are out of bounds', () => {
    expect(
      resolvePipelineThresholds(
        { pipelineThresholds: { autoSelection: 101, autoReject: 20 } },
        baseEnv,
      ),
    ).toEqual({
      autoSelection: baseEnv.AUTO_SELECTION_THRESHOLD,
      autoReject: baseEnv.AUTO_REJECT_THRESHOLD,
    })
    expect(
      resolvePipelineThresholds(
        { pipelineThresholds: { autoSelection: 80, autoReject: -1 } },
        baseEnv,
      ),
    ).toEqual({
      autoSelection: baseEnv.AUTO_SELECTION_THRESHOLD,
      autoReject: baseEnv.AUTO_REJECT_THRESHOLD,
    })
    expect(
      resolvePipelineThresholds(
        { pipelineThresholds: { autoSelection: 20, autoReject: 90 } },
        baseEnv,
      ),
    ).toEqual({
      autoSelection: baseEnv.AUTO_SELECTION_THRESHOLD,
      autoReject: baseEnv.AUTO_REJECT_THRESHOLD,
    })
  })
})

function createState() {
  const sessions: Array<Record<string, unknown>> = []
  const templates: Array<Record<string, unknown>> = []
  const auditEvents: Array<Record<string, unknown>> = []
  const notifications: Array<Record<string, unknown>> = []

  const application = {
    id: 'app-1',
    tenantId: 'tenant-1',
    candidateId: 'cand-1',
    vacancyId: 'vac-1',
    assignedToUserId: 'recruiter-1',
    stage: 'new',
    externalIds: {},
    candidate: {
      source: 'manual',
      email: 'candidate@example.com',
      externalIds: {},
    },
    vacancy: {
      role: 'logist_domestic',
    },
  }

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return where.id === application.id ? application : null
      },
      update: async ({ where, data }: { where: { id: string }; data: { stage?: string } }) => {
        if (where.id === application.id && data.stage) {
          application.stage = data.stage
        }
        return application
      },
    },
    selectionSession: {
      findFirst: async ({ where }: { where: { applicationId?: string } }) => {
        if (!where.applicationId) return null
        return sessions.find((session) => session.applicationId === where.applicationId) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sess-${sessions.length + 1}`, token: `token-${sessions.length + 1}`, ...data }
        sessions.push(row)
        return row
      },
    },
    selectionTemplate: {
      findFirst: async ({ where }: { where: { vacancyId: string; role: string } }) => {
        return templates.find((t) => t.vacancyId === where.vacancyId && t.role === where.role) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `tpl-${templates.length + 1}`, ...data }
        templates.push(row)
        return row
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data)
      },
    },
    hhConnection: {
      findUnique: async () => null,
    },
    tenantSettings: {
      findUnique: async () => null,
    },
    userRole: {
      findMany: async () => [{ userId: 'admin-1' }],
    },
    notification: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        notifications
          .filter((row) => {
            if (row.tenantId !== where.tenantId) return false
            if (row.recipientUserId !== where.recipientUserId) return false
            if (row.channel !== where.channel) return false
            if (row.template !== where.template) return false
            if (where.readAt === null && row.readAt !== null) return false
            const createdAtGte = (where.createdAt as { gte?: Date } | undefined)?.gte
            if (createdAtGte && row.createdAt instanceof Date && row.createdAt < createdAtGte) return false
            return true
          })
          .map((row) => ({ payload: row.payload })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `notification-${notifications.length + 1}`,
          ...data,
          readAt: null,
          createdAt: new Date(),
        }
        notifications.push(row)
        return row
      },
    },
    deviceToken: {
      findMany: async () => [],
    },
  }

  return { prisma, sessions, templates, auditEvents, application, notifications }
}
