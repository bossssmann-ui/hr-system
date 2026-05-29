import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['phase1d', 'assessment', 'integration', 'test', 'secret', '32chars'].join('-')

const env: AppEnv = {
  PORT: 3010,
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
  LLM_SCORING_API_KEY: 'test-key',
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
  EMAIL_ENABLED: false,
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
  ASSESSMENTS_ENABLED: true,
  ASSESSMENT_SYSTEM_ENABLED: false,
  PROCTORING_WEBCAM_ENABLED: false,
  TRUST_WEIGHT_PASTE: 0.35,
  TRUST_WEIGHT_FOCUS: 0.4,
  TRUST_WEIGHT_KEYSTROKE: 0.25,
  TRUST_LOW_THRESHOLD: 60,
  QUIET_HOURS_QUIET_START_UTC: 15,
  QUIET_HOURS_QUIET_END_UTC: 23,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
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

maybeDescribe('Phase 1D assessment routes', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let token: string
  let applicationId: string
  let templateId: string
  let inviteToken: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `phase1d-${randomUUID()}` } })
    tenantId = tenant.id

    const owner = await prisma.user.create({
      data: {
        email: `owner-${tenantId}@test.com`,
        passwordHash: await hashPassword(password),
      },
    })
    await prisma.userRole.create({ data: { userId: owner.id, role: 'owner', tenantId } })
    token = await loginAs(app, `owner-${tenantId}@test.com`, password)

    const orgUnit = await prisma.orgUnit.create({ data: { tenantId, name: 'Engineering' } })
    const requisition = await prisma.hiringRequisition.create({
      data: {
        tenantId,
        orgUnitId: orgUnit.id,
        createdByUserId: owner.id,
        title: 'Backend Engineer',
        grade: 'M3',
        salaryMin: 100000,
        salaryMax: 150000,
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
        title: 'Backend Engineer',
        description: 'Build APIs',
      },
    })
    const candidate = await prisma.candidate.create({
      data: {
        tenantId,
        fullName: 'Candidate',
        email: `candidate-${tenantId}@test.com`,
      },
    })
    const application = await prisma.application.create({
      data: {
        tenantId,
        candidateId: candidate.id,
        vacancyId: vacancy.id,
      },
    })
    applicationId = application.id

    const templateRes = await app.request('/api/assessments/templates', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'General test',
        description: 'Phase1D',
        timeLimitMin: 30,
        questions: [
          {
            order: 1,
            type: 'single_choice',
            prompt: 'What is HTTP?',
            options: ['Protocol', 'Database'],
            weight: 1,
          },
        ],
      }),
    })
    expect(templateRes.status).toBe(201)
    templateId = (await templateRes.json()).id as string

    const inviteRes = await app.request(`/api/assessments/${templateId}/invite`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ applicationId }),
    })
    expect(inviteRes.status).toBe(201)
    inviteToken = (await inviteRes.json()).token as string
  })

  afterAll(async () => {
    await prisma.assessmentAnswer.deleteMany({ where: { session: { tenantId } } })
    await prisma.assessmentSession.deleteMany({ where: { tenantId } })
    await prisma.assessmentQuestion.deleteMany({ where: { template: { tenantId } } })
    await prisma.assessmentTemplate.deleteMany({ where: { tenantId } })
    await prisma.application.deleteMany({ where: { tenantId } })
    await prisma.candidate.deleteMany({ where: { tenantId } })
    await prisma.vacancy.deleteMany({ where: { tenantId } })
    await prisma.hiringRequisition.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('consent is required before start', async () => {
    const res = await app.request(`/api/public/assessment/${inviteToken}/start`, { method: 'POST' })
    expect(res.status).toBe(422)
  })

  test('tokenized GET ignores tenant query/body injection and resolves server-side', async () => {
    const res = await app.request(`/api/public/assessment/${inviteToken}?tenantId=evil-tenant`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBeTruthy()
    expect(Array.isArray(body.questions)).toBe(true)
  })

  test('expired session is rejected', async () => {
    const template = await prisma.assessmentTemplate.create({
      data: {
        tenantId,
        title: 'Expired template',
        timeLimitMin: 1,
        createdBy: (await prisma.user.findFirstOrThrow({ where: { email: `owner-${tenantId}@test.com` } })).id,
      },
    })
    const session = await prisma.assessmentSession.create({
      data: {
        tenantId,
        templateId: template.id,
        applicationId,
        inviteToken: randomUUID().replaceAll('-', ''),
        status: 'in_progress',
        consentRecorded: true,
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    })

    const res = await app.request(`/api/public/assessment/${session.inviteToken}`)
    expect(res.status).toBe(410)
  })

  test('submit computes trust score server-side and ignores client trust_score', async () => {
    await app.request(`/api/public/assessment/${inviteToken}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proctoring_consent: true }),
    })
    await app.request(`/api/public/assessment/${inviteToken}/start`, { method: 'POST' })

    const viewRes = await app.request(`/api/public/assessment/${inviteToken}`)
    const viewBody = await viewRes.json()
    const questionId = viewBody.questions[0].id as string

    const submitRes = await app.request(`/api/public/assessment/${inviteToken}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ question_id: questionId, answer: 'Protocol' }],
        trust_score: 100,
        signals: {
          paste_events: { count: 10, sizes: [2000] },
          focus_loss_events: { count: 12, total_away_ms: 300000 },
          keystroke_timing: { anomaly_flags: 4, burst_events: 4 },
        },
      }),
    })
    expect(submitRes.status).toBe(200)
    const submitBody = await submitRes.json()
    expect(submitBody.trustScore).toBeLessThan(100)

    const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { inviteToken: inviteToken } })
    expect(session.trustScore).toBeLessThan(100)
    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })
    expect(application.trustFlagged).toBe(true)
  })

  test('open-answer grading job is enqueued after submit when AI is enabled', async () => {
    const template = await prisma.assessmentTemplate.create({
      data: {
        tenantId,
        title: 'Open answer template',
        createdBy: (await prisma.user.findFirstOrThrow({ where: { email: `owner-${tenantId}@test.com` } })).id,
        questions: {
          create: [{
            order: 1,
            type: 'open',
            prompt: 'Why do you want this role?',
            rubric: null,
            weight: 1,
          }],
        },
      },
      include: { questions: true },
    })
    const session = await prisma.assessmentSession.create({
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

    const res = await app.request(`/api/public/assessment/${session.inviteToken}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ question_id: template.questions[0]!.id, answer: 'I like challenges.' }],
        signals: {
          paste_events: { count: 0, sizes: [] },
          focus_loss_events: { count: 0, total_away_ms: 0 },
          keystroke_timing: { anomaly_flags: 0, burst_events: 0 },
        },
      }),
    })
    expect(res.status).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 50))
    const updated = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(['submitted', 'graded']).toContain(updated.status)
  })
})
