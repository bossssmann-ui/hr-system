import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import type { MessageChannelAdapter } from '../../integrations/messaging'
import {
  buildClarificationQuestionsFromGaps,
  canAutoSendClarification,
  canManualSendClarification,
  handleInboundClarificationReply,
  isClarificationLoopEnabled,
  isScoreInClarificationBand,
  parseAiClarification,
  sendClarification,
} from './clarification.service'

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
  ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  CLARIFICATION_LOOP_ENABLED: true,
  CLARIFICATION_MIN_SCORE: 30,
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
  SPACES_REGION: undefined,
  SPACES_BUCKET: undefined,
  SPACES_ENDPOINT: undefined,
  SPACES_CDN_BASE_URL: undefined,
  SPACES_ACCESS_KEY_ID: undefined,
  SPACES_SECRET_ACCESS_KEY: undefined,
  LLM_SCORING_BASE_URL: undefined,
}

describe('clarification flags and band', () => {
  test('requires both env and tenant clarification flag', () => {
    expect(isClarificationLoopEnabled({ clarification: true }, { ...baseEnv, CLARIFICATION_LOOP_ENABLED: false })).toBe(
      false,
    )
    expect(isClarificationLoopEnabled({}, baseEnv)).toBe(false)
    expect(isClarificationLoopEnabled({ clarification: true }, baseEnv)).toBe(true)
    expect(isClarificationLoopEnabled({ clarification: { enabled: true } }, baseEnv)).toBe(true)
  })

  test('score band uses min env and hard auto-screen threshold', () => {
    expect(isScoreInClarificationBand(29, baseEnv)).toBe(false)
    expect(isScoreInClarificationBand(30, baseEnv)).toBe(true)
    expect(isScoreInClarificationBand(45, baseEnv)).toBe(true)
    expect(isScoreInClarificationBand(59, baseEnv)).toBe(true)
    expect(isScoreInClarificationBand(60, baseEnv)).toBe(false)
  })

  test('auto allows only the first round in band', () => {
    expect(
      canAutoSendClarification({
        stage: 'new',
        score: 45,
        clarification: null,
        featureFlags: { clarification: true },
        env: baseEnv,
        hasChannel: true,
      }).ok,
    ).toBe(true)

    expect(
      canAutoSendClarification({
        stage: 'new',
        score: 45,
        clarification: {
          status: 'rescored',
          channel: 'email',
          questions: ['q'],
          sentAt: '2026-07-15T00:00:00.000Z',
          roundCount: 1,
        },
        featureFlags: { clarification: true },
        env: baseEnv,
        hasChannel: true,
      }).ok,
    ).toBe(false)
  })

  test('manual allows up to 3 rounds and blocks while awaiting answer', () => {
    expect(
      canManualSendClarification({
        stage: 'new',
        clarification: {
          status: 'sent',
          channel: 'email',
          questions: ['q'],
          sentAt: '2026-07-15T00:00:00.000Z',
          roundCount: 1,
        },
        featureFlags: { clarification: true },
        env: baseEnv,
        hasChannel: true,
      }),
    ).toEqual({ ok: false, reason: 'awaiting_answer' })

    expect(
      canManualSendClarification({
        stage: 'new',
        clarification: {
          status: 'rescored',
          channel: 'email',
          questions: ['q'],
          sentAt: '2026-07-15T00:00:00.000Z',
          roundCount: 3,
        },
        featureFlags: { clarification: true },
        env: baseEnv,
        hasChannel: true,
      }),
    ).toEqual({ ok: false, reason: 'max_rounds' })
  })

  test('builds 3-5 gap questions', () => {
    const questions = buildClarificationQuestionsFromGaps([
      'Нет опыта FTL',
      'Не указаны системы',
      'Нет KPI',
      'Нет регионов',
      'Нет подрядчиков',
      'Лишний gap',
    ])
    expect(questions).toHaveLength(5)
    expect(questions[0]).toContain('Нет опыта FTL')
  })
})

describe('clarification send and ingest', () => {
  test('sends clarification message and stores aiClarification', async () => {
    const prisma = createPrismaMock()
    const sent: Array<{ destination: string; body: string }> = []
    const adapter: MessageChannelAdapter = {
      channelName: 'email',
      async send(message) {
        sent.push({ destination: message.destination, body: message.body })
        return { status: 'sent', externalId: 'msg-1' }
      },
    }

    const result = await sendClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      mode: 'manual',
      adapter,
      now: () => new Date('2026-07-15T10:00:00.000Z'),
      generateQuestions: async () => ['Вопрос про FTL?', 'Вопрос про TMS?'],
    })

    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(1)
    expect(sent[0]?.destination).toBe('candidate@example.com')
    expect(sent[0]?.body).toContain('1. Вопрос про FTL?')
    const clarification = parseAiClarification(prisma.state.application.aiClarification)
    expect(clarification?.status).toBe('sent')
    expect(clarification?.roundCount).toBe(1)
    expect(clarification?.questions).toEqual(['Вопрос про FTL?', 'Вопрос про TMS?'])
  })

  test('inbound reply marks answered and force-rescores', async () => {
    const prisma = createPrismaMock({
      aiClarification: {
        status: 'sent',
        channel: 'email',
        questions: ['Какие объёмы FTL вы вели?'],
        sentAt: '2026-07-15T10:00:00.000Z',
        roundCount: 1,
      },
    })
    const scoreJobs: Array<{ applicationId: string; force?: boolean }> = []

    const result = await handleInboundClarificationReply({
      prisma: prisma as never,
      env: baseEnv,
      tenantId: 'tenant-1',
      candidateId: 'cand-1',
      conversationApplicationId: 'app-1',
      body: 'Вёл 20 рейсов FTL в месяц через TMS.',
      enqueueRescore: async (job) => {
        scoreJobs.push({ applicationId: job.applicationId, force: job.force })
        return { queued: true as const }
      },
    })

    expect(result.handled).toBe(true)
    const clarification = parseAiClarification(prisma.state.application.aiClarification)
    expect(clarification?.status).toBe('answered')
    expect(clarification?.answers?.[0]?.answer).toContain('20 рейсов')
    expect(scoreJobs).toEqual([{ applicationId: 'app-1', force: true }])
  })
})

function createPrismaMock(overrides?: { aiClarification?: unknown }) {
  const state = {
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'cand-1',
      vacancyId: 'vac-1',
      stage: 'new',
      externalIds: {},
      aiScoring: {
        status: 'scored',
        result: {
          relevance_score: 45,
          gaps: ['Нет конкретных объёмов', 'Не указаны системы'],
        },
      },
      aiClarification: overrides?.aiClarification ?? null,
      candidate: {
        id: 'cand-1',
        fullName: 'Иван Тестов',
        email: 'candidate@example.com',
        externalIds: {},
      },
      vacancy: {
        id: 'vac-1',
        title: 'Логист',
      },
    },
    conversation: null as null | {
      id: string
      tenantId: string
      candidateId: string
      applicationId: string | null
    },
    messages: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    featureFlags: { clarification: true } as Record<string, unknown>,
  }

  const prisma = {
    state,
    application: {
      async findFirst() {
        return state.application
      },
      async findMany() {
        return [state.application]
      },
      async update(_args: { data: Record<string, unknown> }) {
        Object.assign(state.application, _args.data)
        return state.application
      },
    },
    tenantSettings: {
      async findUnique() {
        return { featureFlags: state.featureFlags }
      },
    },
    conversation: {
      async findFirst() {
        return state.conversation
      },
      async create(args: { data: Record<string, unknown> }) {
        state.conversation = {
          id: 'conv-1',
          tenantId: String(args.data.tenantId),
          candidateId: String(args.data.candidateId),
          applicationId: (args.data.applicationId as string | null | undefined) ?? null,
        }
        return state.conversation
      },
      async update(args: { data: Record<string, unknown> }) {
        if (!state.conversation) throw new Error('missing conversation')
        Object.assign(state.conversation, args.data)
        return state.conversation
      },
    },
    message: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `msg-${state.messages.length + 1}`, ...args.data }
        state.messages.push(row)
        return row
      },
      async update(args: { where: { id: string }; data: Record<string, unknown> }) {
        const row = state.messages.find((item) => item.id === args.where.id)
        if (!row) throw new Error('missing message')
        Object.assign(row, args.data)
        return row
      },
    },
    auditEvent: {
      async create(args: { data: Record<string, unknown> }) {
        state.audits.push(args.data)
        return args.data
      },
    },
    user: {
      async findFirst() {
        return { id: 'user-1' }
      },
    },
    userRole: {
      async findMany() {
        return [{ userId: 'user-1', role: 'owner' }]
      },
      async findFirst() {
        return { userId: 'user-1' }
      },
    },
    hhConnection: {
      async findUnique() {
        return null
      },
    },
  }

  return prisma
}
