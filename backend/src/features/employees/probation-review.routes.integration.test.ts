/**
 * Integration tests for POST /:id/probation-review endpoint.
 *
 * Requires a running PostgreSQL with the migrations applied (TEST_DATABASE_URL env var).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['probation', 'review', 'integration', 'test', '32chars', 'pad'].join('-')

const env: AppEnv = {
  PORT: 3025,
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
  AI_SCORING_ENABLED: false,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: undefined,
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
  ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
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

async function loginAs(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`)
  return (await res.json()).accessToken as string
}

function authHeaders(token: string) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
}

maybeDescribe('POST /:id/probation-review', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let hrAdminToken: string
  let managerToken: string
  let employeeToken: string

  let hrAdminUserId: string
  let probationEmployeeId: string
  let activeEmployeeId: string

  const futureDate = '2099-12-31'
  const pastDate = '2020-01-01'

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `probation-review-${randomUUID()}` } })
    tenantId = tenant.id

    const hrAdmin = await prisma.user.create({
      data: { email: `hr-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    hrAdminUserId = hrAdmin.id
    await prisma.userRole.create({ data: { userId: hrAdmin.id, role: 'hr_admin', tenantId } })
    hrAdminToken = await loginAs(app, `hr-${tenantId}@test.com`, password)

    const manager = await prisma.user.create({
      data: { email: `manager-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.createMany({
      data: [
        { userId: manager.id, role: 'hiring_manager', tenantId },
      ],
    })
    managerToken = await loginAs(app, `manager-${tenantId}@test.com`, password)

    const empUser = await prisma.user.create({
      data: { email: `emp-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: empUser.id, role: 'employee', tenantId } })
    employeeToken = await loginAs(app, `emp-${tenantId}@test.com`, password)

    const probationEmp = await prisma.employee.create({
      data: {
        tenantId,
        fullName: 'Probation Employee',
        status: 'probation',
        probationEndsAt: new Date('2026-06-30T00:00:00.000Z'),
      },
    })
    probationEmployeeId = probationEmp.id

    const activeEmp = await prisma.employee.create({
      data: {
        tenantId,
        fullName: 'Active Employee',
        status: 'active',
      },
    })
    activeEmployeeId = activeEmp.id
  })

  afterAll(async () => {
    await prisma.employeeLifecycleEvent.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.employee.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@test.com`, contains: tenantId.slice(0, 8) } },
    })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('decision=passed transitions probation → active, returns 200', async () => {
    const emp = await prisma.employee.create({
      data: { tenantId, fullName: 'Pass Employee', status: 'probation', probationEndsAt: new Date('2026-06-30T00:00:00.000Z') },
    })

    const res = await app.request(`/api/employees/${emp.id}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'passed', note: 'Great work' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('active')
    expect(body.probationOutcome).toBe('passed')
    expect(body.employeeId).toBe(emp.id)
  })

  test('decision=failed transitions probation → notice, returns 200', async () => {
    const emp = await prisma.employee.create({
      data: { tenantId, fullName: 'Fail Employee', status: 'probation', probationEndsAt: new Date('2026-06-30T00:00:00.000Z') },
    })

    const res = await app.request(`/api/employees/${emp.id}/probation-review`, {
      method: 'POST',
      headers: authHeaders(managerToken),
      body: JSON.stringify({ decision: 'failed', note: 'Не подошёл' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('notice')
    expect(body.probationOutcome).toBe('failed')
  })

  test('decision=extended with future date extends probation, returns 200', async () => {
    const emp = await prisma.employee.create({
      data: { tenantId, fullName: 'Extend Employee', status: 'probation', probationEndsAt: new Date('2026-06-30T00:00:00.000Z') },
    })

    const res = await app.request(`/api/employees/${emp.id}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'extended', extendedProbationEndsAt: futureDate }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('probation')
    expect(body.probationOutcome).toBe('extended')
    expect(body.probationEndsAt).toContain(futureDate)
  })

  test('decision=extended without extendedProbationEndsAt returns 400', async () => {
    const emp = await prisma.employee.create({
      data: { tenantId, fullName: 'Extend No Date', status: 'probation', probationEndsAt: new Date('2026-06-30T00:00:00.000Z') },
    })

    const res = await app.request(`/api/employees/${emp.id}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'extended' }),
    })

    expect(res.status).toBe(400)
  })

  test('decision=extended with past/non-forward date returns 422', async () => {
    const emp = await prisma.employee.create({
      data: { tenantId, fullName: 'Extend Past', status: 'probation', probationEndsAt: new Date('2099-01-01T00:00:00.000Z') },
    })

    const res = await app.request(`/api/employees/${emp.id}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'extended', extendedProbationEndsAt: pastDate }),
    })

    expect(res.status).toBe(422)
  })

  test('employee not in probation status returns 422', async () => {
    const res = await app.request(`/api/employees/${activeEmployeeId}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'passed' }),
    })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('FSM_TRANSITION_DENIED')
  })

  test('employee not found returns 404', async () => {
    const res = await app.request(`/api/employees/${randomUUID()}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'passed' }),
    })

    expect(res.status).toBe(404)
  })

  test('role=employee (no allowed role) returns 403', async () => {
    const res = await app.request(`/api/employees/${probationEmployeeId}/probation-review`, {
      method: 'POST',
      headers: authHeaders(employeeToken),
      body: JSON.stringify({ decision: 'passed' }),
    })

    expect(res.status).toBe(403)
  })

  test('unauthenticated request returns 401', async () => {
    const res = await app.request(`/api/employees/${probationEmployeeId}/probation-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'passed' }),
    })

    expect(res.status).toBe(401)
  })

  test('invalid decision value returns 400', async () => {
    const res = await app.request(`/api/employees/${probationEmployeeId}/probation-review`, {
      method: 'POST',
      headers: authHeaders(hrAdminToken),
      body: JSON.stringify({ decision: 'invalid_value' }),
    })

    expect(res.status).toBe(400)
  })
})
