import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import type { AssessmentProvider, ScoringProvider } from '../../integrations/llm'
import {
  processCandidateQuestionnaireReply,
  sendCandidateQuestionnaire,
} from './candidate-questionnaire.service'

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
  LLM_SCORING_PROVIDER: 'openai_compatible',
  LLM_SCORING_API_KEY: 'test-api-key',
  LLM_SCORING_MODEL: 'deepseek/deepseek-v4-flash',
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
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 465,
  SMTP_USER: 'noreply@example.com',
  SMTP_PASS: 'smtp-password',
  SMTP_FROM: 'HR <noreply@example.com>',
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
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
  CLARIFICATION_LOOP_ENABLED: false,
  CLARIFICATION_MIN_SCORE: 30,
}

describe('candidate questionnaire service', () => {
  test('sends current AI questions to candidate email and records outbound message', async () => {
    const prisma = createPrismaMock()
    const sent: Array<{ to: string; subject: string; text: string }> = []

    const result = await sendCandidateQuestionnaire({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      transport: async (message) => {
        sent.push({ to: message.to, subject: message.subject, text: message.text })
        return { messageId: 'smtp-1' }
      },
    })

    expect(result.ok).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('candidate@example.com')
    expect(sent[0]?.text).toContain('1. Какие маршруты и объемы вы вели?')
    expect(sent[0]?.text).toContain('код отклика: app-1')
    expect(prisma.state.messages[0]?.status).toBe('sent')
    const questionnaire = prisma.state.application.externalIds.candidate_questionnaire as Record<string, unknown>
    expect(questionnaire.status).toBe('sent')
  })

  test('processes candidate reply, enriches resume evidence, and forces re-score', async () => {
    const prisma = createPrismaMock()
    const assessmentProvider: AssessmentProvider = {
      async generateInterviewQuestions() {
        throw new Error('not used')
      },
      async gradeOpenAnswer() {
        throw new Error('not used')
      },
      async extractResumeEnrichment() {
        return {
          summary: 'Кандидат подтвердил FTL Китай и KPI.',
          facts: ['Вёл FTL Китай 20 рейсов в месяц', 'Контролировал SLA 95%'],
          experience: ['Организация FTL перевозок Китай-Россия, 20 рейсов в месяц'],
          skills: ['TMS', 'FTL'],
          contradictions: [],
          confidence: 82,
        }
      },
      async generateClarificationQuestions() {
        return { questions: ['Уточните опыт FTL'] }
      },
    }
    const scoringProvider: ScoringProvider = {
      async score(input) {
        expect(JSON.stringify(input)).toContain('20 рейсов в месяц')
        return {
          relevance_score: 72,
          summary: 'После уточнений есть подтвержденный опыт.',
          strengths: ['FTL Китай', 'KPI'],
          gaps: [],
          soft_skills_signals: [],
          red_flags: [],
          anti_fraud_signals: [],
          values_fit_hypothesis: 'Подходит.',
          interview_focus_areas: [],
          model: 'deepseek/deepseek-v4-flash',
          scored_at: new Date().toISOString(),
          schema_version: 2,
        }
      },
    }

    const result = await processCandidateQuestionnaireReply({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      fromEmail: 'candidate@example.com',
      body: 'Я вёл FTL Китай 20 рейсов в месяц, SLA 95%, работал в TMS.',
      externalId: 'email-reply-1',
      provider: assessmentProvider,
      scoringProvider,
    })

    expect(result.ok).toBe(true)
    const enrichment = prisma.state.candidate.externalIds.ai_questionnaire_enrichment as Record<string, unknown>
    const scoringResult = prisma.state.application.aiScoring.result as Record<string, unknown>
    expect(enrichment.facts).toContain('Вёл FTL Китай 20 рейсов в месяц')
    expect(scoringResult.relevance_score).toBe(72)
    expect(prisma.state.application.stage).toBe('screen')
  })
})

function createPrismaMock() {
  const state = {
    candidate: {
      id: 'candidate-1',
      tenantId: 'tenant-1',
      fullName: 'Иван Петров',
      email: 'candidate@example.com',
      phone: null,
      location: 'Москва',
      source: 'hh_ru',
      externalIds: {
        hh_resume_snapshot: {
          title: 'Логист',
          experience: ['Ведущий логист FTL'],
          education: [],
          skills: [],
          total_experience_months: 80,
          location: 'Москва',
        },
      } as Record<string, unknown>,
      consentContext: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    vacancy: {
      id: 'vacancy-1',
      tenantId: 'tenant-1',
      title: 'Логист',
      description: 'Расширение',
      isPublished: true,
      requisitionId: 'req-1',
      orgUnitId: 'org-1',
      hhVacancyId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      requisition: {
        grade: 'M1',
        salaryMin: 80000,
        salaryMax: 300000,
        currency: 'RUB',
      },
    },
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      vacancyId: 'vacancy-1',
      stage: 'new',
      assignedToUserId: null,
      notes: null,
      aiScoring: {
        status: 'scored',
        input_hash: 'hash-1',
        result: {
          relevance_score: 65,
          summary: 'Нужны уточнения.',
          strengths: [],
          gaps: [],
          soft_skills_signals: [],
          red_flags: [],
          anti_fraud_signals: [],
          values_fit_hypothesis: 'Нужно проверить.',
          interview_focus_areas: [],
          interview_questions: ['Какие маршруты и объемы вы вели?'],
          model: 'deepseek/deepseek-v4-flash',
          scored_at: new Date().toISOString(),
          schema_version: 2,
        },
      } as Record<string, unknown>,
      aiInterviewQuestions: null,
      externalIds: {} as Record<string, unknown>,
      trustFlagged: false,
      candidate: null as unknown,
      vacancy: null as unknown,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    userRoles: [{ tenantId: 'tenant-1', userId: 'user-1', role: 'owner', user: { disabledAt: null } }],
  }
  state.application.candidate = state.candidate
  state.application.vacancy = state.vacancy

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId?: string } }) => {
        if (where.id !== state.application.id) return null
        if (where.tenantId && where.tenantId !== state.application.tenantId) return null
        return state.application
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.application, data)
        return state.application
      },
    },
    candidate: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.candidate, data)
        state.application.candidate = state.candidate
        return state.candidate
      },
    },
    vacancy: {},
    resume: {
      findFirst: async () => null,
    },
    conversation: {
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string; candidateId?: string } }) => {
        return state.conversations.find((row) => {
          if (where.id && row.id !== where.id) return false
          if (where.tenantId && row.tenantId !== where.tenantId) return false
          if (where.candidateId && row.candidateId !== where.candidateId) return false
          return true
        }) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `conv-${state.conversations.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() }
        state.conversations.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.conversations.find((item) => item.id === where.id)
        Object.assign(row ?? {}, data)
        return row
      },
    },
    message: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return state.messages.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `msg-${state.messages.length + 1}`, ...data, createdAt: new Date() }
        state.messages.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.messages.find((item) => item.id === where.id)
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
    applicationStageEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
    userRole: {
      findMany: async () => state.userRoles.map((row) => ({ userId: row.userId, role: row.role })),
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(prisma),
    state,
  }

  return prisma
}
