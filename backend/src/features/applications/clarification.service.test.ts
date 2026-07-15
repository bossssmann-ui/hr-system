import { describe, expect, mock, test } from 'bun:test'

import type { AppEnv } from '../../env'
import type { AssessmentProvider } from '../../integrations/llm'
import type { MessageChannelAdapter } from '../../integrations/messaging'

// ─── Stub queue so no real scoring runs ──────────────────────────────────────
const enqueueApplicationScoringJob = mock(async () => ({ queued: true as const }))
mock.module('../scoring/scoring.queue', () => ({ enqueueApplicationScoringJob }))

const {
  sendAiClarification,
  handleClarificationAnswer,
  maybeTriggerClarificationAfterScoring,
} = await import('./clarification.service')

// ─── Env ─────────────────────────────────────────────────────────────────────

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
  LLM_SCORING_PROVIDER: 'openai_compatible',
  LLM_SCORING_API_KEY: 'test-api-key',
  LLM_SCORING_MODEL: 'deepseek/deepseek-v4-flash',
  LLM_SCORING_BASE_URL: undefined,
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
  EMAIL_ENABLED: true,
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: 'hr@example.com',
  DOCUSEAL_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  DOCUSEAL_API_KEY: undefined,
  DOCUSEAL_TEMPLATE_ID: undefined,
  SBER_PODBOR_ENABLED: false,
  SBER_PODBOR_API_TOKEN: undefined,
  AVITO_JOBS_ENABLED: false,
  AVITO_JOBS_API_TOKEN: undefined,
  RABOTA_RU_ENABLED: false,
  RABOTA_RU_API_TOKEN: undefined,
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
  ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  AUTO_SELECTION_THRESHOLD: 70,
  AUTO_REJECT_THRESHOLD: 30,
  CLARIFICATION_LOOP_ENABLED: true,
  CLARIFICATION_MIN_SCORE: 30,
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
  VALKEY_URL: undefined,
}

// ─── Prisma mock ─────────────────────────────────────────────────────────────

function buildState(overrides: Partial<{
  stage: string
  aiScoring: unknown
  aiClarification: unknown
  externalIds: Record<string, unknown>
  candidateEmail: string | null
  candidateExternalIds: Record<string, unknown>
}> = {}) {
  const {
    stage = 'new',
    aiScoring = {
      status: 'scored',
      result: {
        relevance_score: 45,
        gaps: ['Не указан опыт FTL перевозок', 'Нет информации о TMS системах'],
      },
    },
    aiClarification = null,
    externalIds = {},
    candidateEmail = 'candidate@example.com',
    candidateExternalIds = {},
  } = overrides

  return {
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      vacancyId: 'vacancy-1',
      stage,
      aiScoring,
      aiClarification,
      aiInterviewQuestions: null,
      externalIds,
      trustFlagged: false,
      candidate: {
        id: 'candidate-1',
        tenantId: 'tenant-1',
        fullName: 'Иван Петров',
        email: candidateEmail,
        phone: null,
        location: 'Москва',
        externalIds: candidateExternalIds,
      },
      vacancy: {
        id: 'vacancy-1',
        title: 'Логист',
        description: 'Организация FTL перевозок.',
        requisition: { grade: 'M1', salaryMin: 80000, salaryMax: 300000, currency: 'RUB' },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tenantSettings: {
      tenantId: 'tenant-1',
      featureFlags: { clarification: true },
      pipelineThresholds: null,
    },
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    users: [{ id: 'user-owner', tenantId: 'tenant-1', role: 'owner', createdAt: new Date() }],
  }
}

function createPrismaMock(overrides?: Parameters<typeof buildState>[0]) {
  const state = buildState(overrides)

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: Record<string, unknown>; select?: unknown; include?: unknown }) => {
        if (where.id !== state.application.id) return null
        return state.application
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.application, data)
        return state.application
      },
    },
    conversation: {
      findFirst: async () => state.conversations[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'conv-1', ...data, createdAt: new Date() }
        state.conversations.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.conversations.find((r) => r.id === where.id)
        Object.assign(row ?? {}, data)
        return row
      },
    },
    message: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.messages.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `msg-${state.messages.length + 1}`, ...data, createdAt: new Date() }
        state.messages.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.messages.find((r) => r.id === where.id)
        Object.assign(row ?? {}, data)
        return row
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
        return data
      },
    },
    tenantSettings: {
      findUnique: async () => state.tenantSettings,
    },
    user: {
      findFirst: async () => state.users[0] ?? null,
    },
    hhConnection: {
      findUnique: async () => null,
    },
    state,
  }

  return prisma
}

// ─── Mock assessment provider ─────────────────────────────────────────────────

function createMockProvider(questions = ['Уточните опыт FTL', 'Какие TMS системы использовали?']): AssessmentProvider {
  return {
    async generateInterviewQuestions() {
      return { items: [] }
    },
    async gradeOpenAnswer() {
      return { score: 80, rationale: 'ok' }
    },
    async extractResumeEnrichment() {
      return { summary: 'ok', facts: [], experience: [], skills: [], contradictions: [], confidence: 70 }
    },
    async generateClarificationQuestions() {
      return { questions }
    },
  }
}

function createMockAdapter(status: 'sent' | 'failed' = 'sent'): MessageChannelAdapter {
  return {
    channelName: 'email',
    async send() {
      return { status, externalId: status === 'sent' ? 'ext-123' : null }
    },
  }
}

// ─── Tests: sendAiClarification ───────────────────────────────────────────────

describe('sendAiClarification', () => {
  test('sends questions via email channel and persists aiClarification with status sent', async () => {
    const prisma = createPrismaMock()

    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.channel).toBe('email')
    expect(result.questionCount).toBe(2)

    const clarification = prisma.state.application.aiClarification as Record<string, unknown>
    expect(clarification.status).toBe('sent')
    expect(clarification.channel).toBe('email')
    expect(Array.isArray(clarification.questions)).toBe(true)
    expect((clarification.questions as string[]).length).toBe(2)
    expect(clarification.rounds).toBe(1)

    const auditActions = prisma.state.auditEvents.map((e) => (e as Record<string, unknown>).action)
    expect(auditActions).toContain('application.clarification_sent')
  })

  test('returns terminal_stage when application is hired', async () => {
    const prisma = createPrismaMock({ stage: 'hired' })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('terminal_stage')
  })

  test('returns terminal_stage when application is rejected', async () => {
    const prisma = createPrismaMock({ stage: 'rejected' })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('terminal_stage')
  })

  test('returns no_gaps_in_scoring when scoring result has no gaps', async () => {
    const prisma = createPrismaMock({
      aiScoring: { status: 'scored', result: { relevance_score: 45, gaps: [] } },
    })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_gaps_in_scoring')
  })

  test('returns max_rounds_reached after 3 manual rounds', async () => {
    const prisma = createPrismaMock({
      aiClarification: {
        status: 'answered',
        channel: 'email',
        questions: ['Q1'],
        sentAt: new Date().toISOString(),
        rounds: 3,
      },
    })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('max_rounds_reached')
  })

  test('returns auto_round_already_sent when non-manual and round already exists', async () => {
    const prisma = createPrismaMock({
      aiClarification: {
        status: 'sent',
        channel: 'email',
        questions: ['Q1'],
        sentAt: new Date().toISOString(),
        rounds: 1,
      },
    })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: false, // automated trigger
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('auto_round_already_sent')
  })

  test('returns channel_unavailable when email is not configured', async () => {
    const noEmailEnv: AppEnv = { ...baseEnv, EMAIL_ENABLED: false, SMTP_FROM: undefined }
    const prisma = createPrismaMock()
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: noEmailEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      // No channelAdapter injected — let it try to resolve from env (should fail)
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('channel_unavailable')
  })

  test('returns destination_unavailable when candidate has no email', async () => {
    const prisma = createPrismaMock({ candidateEmail: null })
    const result = await sendAiClarification({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      manual: true,
      provider: createMockProvider(),
      channelAdapter: createMockAdapter(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('destination_unavailable')
  })
})

// ─── Tests: handleClarificationAnswer ────────────────────────────────────────

describe('handleClarificationAnswer', () => {
  test('updates aiClarification to answered and enqueues force re-score', async () => {
    enqueueApplicationScoringJob.mockClear()

    const prisma = createPrismaMock({
      aiClarification: {
        status: 'sent',
        channel: 'email',
        questions: ['Уточните опыт FTL'],
        sentAt: new Date().toISOString(),
        rounds: 1,
      },
    })

    const result = await handleClarificationAnswer({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      answer: 'Вёл FTL 20 рейсов в месяц Китай-Россия',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.queued).toBe(true)

    const clarification = prisma.state.application.aiClarification as Record<string, unknown>
    expect(clarification.status).toBe('answered')
    expect(clarification.answeredAt).toBeTruthy()
    const answers = clarification.answers as string[]
    expect(answers).toContain('Вёл FTL 20 рейсов в месяц Китай-Россия')

    const auditActions = prisma.state.auditEvents.map((e) => (e as Record<string, unknown>).action)
    expect(auditActions).toContain('application.clarification_answered')

    expect(enqueueApplicationScoringJob).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'app-1', force: true }),
    )
  })

  test('returns no_pending_clarification when status is not sent', async () => {
    const prisma = createPrismaMock({
      aiClarification: {
        status: 'answered',
        channel: 'email',
        questions: ['Q1'],
        sentAt: new Date().toISOString(),
      },
    })

    const result = await handleClarificationAnswer({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      answer: 'Ответ',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_pending_clarification')
  })

  test('returns no_pending_clarification when aiClarification is null', async () => {
    const prisma = createPrismaMock({ aiClarification: null })

    const result = await handleClarificationAnswer({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      answer: 'Ответ',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_pending_clarification')
  })
})

// ─── Tests: maybeTriggerClarificationAfterScoring ────────────────────────────

describe('maybeTriggerClarificationAfterScoring', () => {
  test('returns env_disabled when CLARIFICATION_LOOP_ENABLED is false', async () => {
    const prisma = createPrismaMock()
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: { ...baseEnv, CLARIFICATION_LOOP_ENABLED: false },
      applicationId: 'app-1',
      relevanceScore: 45,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('env_disabled')
  })

  test('returns score_out_of_band when score is below minimum (< 30)', async () => {
    const prisma = createPrismaMock()
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 29,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('score_out_of_band')
  })

  test('returns score_out_of_band when score is at or above AUTO_SCREEN_THRESHOLD (>= 60)', async () => {
    const prisma = createPrismaMock()
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 60,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('score_out_of_band')
  })

  test('returns tenant_flag_disabled when tenant flag is off', async () => {
    const prisma = createPrismaMock()
    // Override tenant settings to disable clarification flag.
    prisma.state.tenantSettings.featureFlags = { clarification: false }
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 45,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('tenant_flag_disabled')
  })

  test('returns auto_round_already_sent when a round was already sent', async () => {
    const prisma = createPrismaMock({
      aiClarification: {
        status: 'answered',
        channel: 'email',
        questions: ['Q1'],
        sentAt: new Date().toISOString(),
        rounds: 1,
      },
    })
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 45,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('auto_round_already_sent')
  })

  test('returns terminal_stage for hired applications', async () => {
    const prisma = createPrismaMock({ stage: 'hired' })
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 45,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('terminal_stage')
  })

  test('returns no_channel when candidate has no email and HH chat not available', async () => {
    const prisma = createPrismaMock({ candidateEmail: null })
    const result = await maybeTriggerClarificationAfterScoring({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      relevanceScore: 45,
    })
    expect(result.triggered).toBe(false)
    if (!result.triggered) expect(result.reason).toBe('no_channel')
  })
})
