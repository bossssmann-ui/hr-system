import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'
import { scoreApplication } from '../scoring/scoring.service'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['phase18', 'composite', 'integration', 'test', 'secret', '32chars'].join('-')

const env: AppEnv = {
  PORT: 3011,
  DATABASE_URL: databaseUrl ?? '',
  JWT_SECRET: jwtSecret,
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 3600,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_BASE_URL: undefined,
  LLM_SCORING_API_KEY: 'test-key',
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
  CLARIFICATION_LOOP_ENABLED: false,
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

async function loginAs(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`)
  return (await res.json()).accessToken as string
}

maybeDescribe('composite score integration', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let ownerId: string
  let ownerToken: string
  let vacancyId: string
  let applicationId: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `phase18-${randomUUID()}` } })
    tenantId = tenant.id

    const owner = await prisma.user.create({
      data: {
        email: `owner-${tenantId}@test.com`,
        passwordHash: await hashPassword(password),
      },
    })
    ownerId = owner.id
    await prisma.userRole.create({ data: { userId: owner.id, role: 'owner', tenantId } })
    ownerToken = await loginAs(app, `owner-${tenantId}@test.com`, password)

    const orgUnit = await prisma.orgUnit.create({ data: { tenantId, name: 'Ops' } })
    const requisition = await prisma.hiringRequisition.create({
      data: {
        tenantId,
        orgUnitId: orgUnit.id,
        createdByUserId: owner.id,
        title: 'Logistics Specialist',
        grade: 'M3',
        salaryMin: 100000,
        salaryMax: 140000,
        currency: 'RUB',
        justification: 'Growth',
        status: 'approved',
      },
    })
    const vacancy = await prisma.vacancy.create({
      data: {
        tenantId,
        orgUnitId: orgUnit.id,
        requisitionId: requisition.id,
        title: 'Logistics Specialist',
        description: 'Selection and assessment flow',
      },
    })
    vacancyId = vacancy.id

    const candidate = await prisma.candidate.create({
      data: {
        tenantId,
        fullName: 'Ivan Candidate',
        email: `candidate-${tenantId}@test.com`,
      },
    })
    const application = await prisma.application.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        vacancyId: vacancy.id,
        stage: 'new',
      },
    })
    applicationId = application.id

    await prisma.resume.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        fileUrl: 'https://example.com/resume.pdf',
        parsedPayload: {
          title: 'Logistics manager',
          experience: ['5 years in domestic logistics'],
          skills: ['Logistics', 'Excel'],
        },
      },
    })
  })

  afterAll(async () => {
    await prisma.assessmentAnswer.deleteMany({ where: { session: { tenantId } } })
    await prisma.assessmentSession.deleteMany({ where: { tenantId } })
    await prisma.assessmentQuestion.deleteMany({ where: { template: { tenantId } } })
    await prisma.assessmentTemplate.deleteMany({ where: { tenantId } })
    await prisma.selectionStageResult.deleteMany({ where: { session: { tenantId } } })
    await prisma.selectionVerdict.deleteMany({ where: { session: { tenantId } } })
    await prisma.selectionSession.deleteMany({ where: { tenantId } })
    await prisma.selectionTemplate.deleteMany({ where: { tenantId } })
    await prisma.resume.deleteMany({ where: { tenantId } })
    await prisma.applicationStageEvent.deleteMany({ where: { tenantId } })
    await prisma.application.deleteMany({ where: { tenantId } })
    await prisma.candidate.deleteMany({ where: { tenantId } })
    await prisma.vacancy.deleteMany({ where: { tenantId } })
    await prisma.hiringRequisition.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.tenantSettings.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('recomputes composite score after resume, selection and assessment events', async () => {
    const authHeader = 'Bearer '.concat(ownerToken)
    const scoringResult = await scoreApplication({
      prisma,
      env,
      applicationId,
      actorUserId: ownerId,
      provider: {
        score: async () => ({
          relevance_score: 80,
          summary: 'Good fit',
          strengths: [],
          gaps: [],
          soft_skills_signals: [],
          red_flags: [],
          anti_fraud_signals: [],
          values_fit_hypothesis: 'Strong',
          interview_focus_areas: [],
          model: 'claude-haiku-4-5-20251001',
          scored_at: new Date().toISOString(),
          schema_version: 1,
        }),
      },
    })
    expect(scoringResult).toMatchObject({ skipped: false, status: 'scored' })

    const afterResume = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })
    const resumeComposite = afterResume.compositeScore as Record<string, unknown>
    expect(resumeComposite.overall).toBe(80)

    const createSessionRes = await app.request('/api/selection/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        vacancyId,
        role: 'logist',
        applicationId,
      }),
    })
    expect(createSessionRes.status).toBe(201)
    const createSessionBody = await createSessionRes.json()
    const selectionToken = createSessionBody.token as string

    const openSessionRes = await app.request(`/api/selection/sessions/${selectionToken}`)
    expect(openSessionRes.status).toBe(200)

    const submitStage1Res = await app.request(`/api/selection/sessions/${selectionToken}/stage/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: {
          stop_experience: 'fail',
        },
      }),
    })
    expect(submitStage1Res.status).toBe(200)

    const afterSelection = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })
    const selectionComposite = afterSelection.compositeScore as Record<string, unknown>
    expect(Number(selectionComposite.overall)).toBeCloseTo(30.768, 4)
    expect((selectionComposite.breakdown as Record<string, unknown>).selection).toEqual({
      stage1: null,
      stage2: 0,
      stage3: 0,
      stage4: 0,
      total: 0,
    })

    const template = await prisma.assessmentTemplate.create({
      data: {
        tenantId,
        title: 'Trust template',
        createdBy: ownerId,
        questions: {
          create: [{
            order: 1,
            type: 'open',
            prompt: 'Why this role?',
            rubric: null,
            weight: 1,
          }],
        },
      },
      include: { questions: true },
    })
    const assessmentSession = await prisma.assessmentSession.create({
      data: {
        tenantId,
        templateId: template.id,
        applicationId,
        inviteToken: randomUUID().replaceAll('-', ''),
        status: 'in_progress',
        consentRecorded: true,
        startedAt: new Date(),
      },
    })

    const submitAssessmentRes = await app.request(`/api/public/assessment/${assessmentSession.inviteToken}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ question_id: template.questions[0]!.id, answer: 'I like solving logistics bottlenecks.' }],
        signals: {
          paste_events: { count: 0, sizes: [] },
          focus_loss_events: { count: 0, total_away_ms: 0 },
          keystroke_timing: { anomaly_flags: 0, burst_events: 0 },
        },
      }),
    })
    expect(submitAssessmentRes.status).toBe(200)

    const afterAssessment = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })
    const assessmentComposite = afterAssessment.compositeScore as Record<string, unknown>
    expect(Number(assessmentComposite.overall)).toBeCloseTo(50.004, 4)
    expect((assessmentComposite.breakdown as Record<string, unknown>).assessment).toEqual({
      score: null,
      trust: 100,
    })

    const detailRes = await app.request(`/api/applications/${applicationId}`, {
      headers: { Authorization: authHeader },
    })
    expect(detailRes.status).toBe(200)
    const detailBody = await detailRes.json()
    expect(detailBody.compositeScore).toEqual(afterAssessment.compositeScore)
  })

  test('does not write composite score when the feature flag is disabled', async () => {
    const candidate = await prisma.candidate.create({
      data: {
        tenantId,
        fullName: 'Disabled Feature Candidate',
        email: `flag-off-${tenantId}@test.com`,
      },
    })
    const application = await prisma.application.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        vacancyId,
        stage: 'new',
      },
    })
    await prisma.resume.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        fileUrl: 'https://example.com/resume-2.pdf',
        parsedPayload: { title: 'Analyst' },
      },
    })

    await scoreApplication({
      prisma,
      env: { ...env, COMPOSITE_SCORE_ENABLED: false },
      applicationId: application.id,
      provider: {
        score: async () => ({
          relevance_score: 65,
          summary: 'Reasonable fit',
          strengths: [],
          gaps: [],
          soft_skills_signals: [],
          red_flags: [],
          anti_fraud_signals: [],
          values_fit_hypothesis: 'Neutral',
          interview_focus_areas: [],
          model: 'claude-haiku-4-5-20251001',
          scored_at: new Date().toISOString(),
          schema_version: 1,
        }),
      },
    })

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: application.id } })
    expect(stored.compositeScore).toBeNull()
  })
})
