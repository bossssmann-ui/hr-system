import { describe, expect, test } from 'bun:test'

import type { AppEnv } from '../../env'
import { runAutoAssessmentAfterSelection } from './auto-assessment-after-selection'

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
  ASSESSMENTS_ENABLED: true,
  ASSESSMENT_SYSTEM_ENABLED: true,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: true,
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
  SPACES_REGION: undefined,
  SPACES_BUCKET: undefined,
  SPACES_ENDPOINT: undefined,
  SPACES_CDN_BASE_URL: undefined,
  SPACES_ACCESS_KEY_ID: undefined,
  SPACES_SECRET_ACCESS_KEY: undefined,
  LLM_SCORING_BASE_URL: undefined,
}

function createState(templateIds: string[] = ['tmpl-1', 'tmpl-2']) {
  const assessmentSessions: Array<Record<string, unknown>> = []
  const auditEvents: Array<Record<string, unknown>> = []

  const application = {
    id: 'app-1',
    tenantId: 'tenant-1',
    candidateId: 'cand-1',
    vacancyId: 'vac-1',
    externalIds: {},
    candidate: {
      source: 'manual',
      email: 'candidate@example.com',
      externalIds: {},
    },
    vacancy: {
      requiredAssessmentTemplateIds: templateIds,
    },
  }

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return where.id === application.id ? application : null
      },
    },
    tenantSettings: {
      findUnique: async () => null,
    },
    assessmentSession: {
      findFirst: async ({ where }: { where: { applicationId?: string; templateId?: string; status?: { notIn: string[] } } }) => {
        if (!where.applicationId || !where.templateId) return null
        return (
          assessmentSessions.find(
            (s) =>
              s.applicationId === where.applicationId &&
              s.templateId === where.templateId &&
              !where.status?.notIn.includes(s.status as string),
          ) ?? null
        )
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sess-${assessmentSessions.length + 1}`, ...data }
        assessmentSessions.push(row)
        return row
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditEvents.push(data)
        return data
      },
    },
  }

  return { prisma, application, assessmentSessions, auditEvents }
}

describe('runAutoAssessmentAfterSelection', () => {
  test('creates assessment sessions and sends invites for each template', async () => {
    const state = createState(['tmpl-1', 'tmpl-2'])
    const invites: Array<{ channel: string; destination: string; token: string }> = []

    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      sendInvite: async (invite) => {
        invites.push({ channel: invite.channel, destination: invite.destination, token: invite.token })
      },
    })

    expect(state.assessmentSessions).toHaveLength(2)
    expect(state.assessmentSessions[0]?.applicationId).toBe('app-1')
    expect(state.assessmentSessions[0]?.templateId).toBe('tmpl-1')
    expect(state.assessmentSessions[1]?.templateId).toBe('tmpl-2')
    expect(invites).toHaveLength(2)
    expect(invites[0]).toMatchObject({ channel: 'email', destination: 'candidate@example.com' })
    expect(invites[1]).toMatchObject({ channel: 'email', destination: 'candidate@example.com' })
    expect(invites[0]?.token).toBeTruthy()
    expect(invites[1]?.token).toBeTruthy()
    expect(invites[0]?.token).not.toBe(invites[1]?.token)
  })

  test('idempotent: repeat call does not create duplicate sessions', async () => {
    const state = createState(['tmpl-1', 'tmpl-2'])

    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      sendInvite: async () => undefined,
    })
    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      sendInvite: async () => undefined,
    })

    expect(state.assessmentSessions).toHaveLength(2)
  })

  test('vacancy without requiredAssessmentTemplateIds does not create sessions', async () => {
    const state = createState([])

    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      sendInvite: async () => undefined,
    })

    expect(state.assessmentSessions).toHaveLength(0)
  })

  test('AUTO_ASSESSMENT_ENABLED=false skips all logic', async () => {
    const state = createState(['tmpl-1'])

    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: { ...baseEnv, AUTO_ASSESSMENT_ENABLED: false },
      applicationId: 'app-1',
      sendInvite: async () => undefined,
    })

    expect(state.assessmentSessions).toHaveLength(0)
  })

  test('delivery failure does not rollback created sessions', async () => {
    const state = createState(['tmpl-1', 'tmpl-2'])

    await runAutoAssessmentAfterSelection({
      prisma: state.prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      sendInvite: async () => {
        throw new Error('smtp down')
      },
    })

    expect(state.assessmentSessions).toHaveLength(2)
    const failEvents = state.auditEvents.filter(
      (e) => e.action === 'application.auto_assessment_delivery_failed',
    )
    expect(failEvents).toHaveLength(2)
    expect(failEvents[0]?.diff).toMatchObject({ channel: 'email' })
  })

  // Both the domestic path (domestic-stage-scoring.ts → finalizeDomesticStage4 ДОПУСТИТЬ
  // branch) and the non-domestic path (selection.queue.ts → runEvaluation ДОПУСТИТЬ branch)
  // call runAutoAssessmentAfterSelection with the same interface. The shared function is
  // exercised by all tests above; the trigger hook sites are verified by integration tests.
})
