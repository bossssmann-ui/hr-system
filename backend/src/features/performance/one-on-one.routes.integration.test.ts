import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['one-on-one', 'integration', 'test', 'secret', '32chars', 'pad'].join('-')

const env: AppEnv = {
  PORT: 3021,
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
  TRUST_LOW_THRESHOLD: 60,
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

function authOnly(token: string) {
  return { Authorization: 'Bearer ' + token }
}

maybeDescribe('OneOnOne CRUD + workflow routes', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let ownerToken: string
  let employeeToken: string
  let managerUserId: string
  let employeeId: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `1on1-${randomUUID()}` } })
    tenantId = tenant.id

    const owner = await prisma.user.create({
      data: { email: `owner-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: owner.id, role: 'owner', tenantId } })
    ownerToken = await loginAs(app, `owner-${tenantId}@test.com`, password)
    managerUserId = owner.id

    const empUser = await prisma.user.create({
      data: { email: `emp-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: empUser.id, role: 'employee', tenantId } })
    employeeToken = await loginAs(app, `emp-${tenantId}@test.com`, password)

    const orgUnit = await prisma.orgUnit.create({ data: { tenantId, name: 'Engineering' } })
    const emp = await prisma.employee.create({
      data: {
        tenantId,
        fullName: 'Test Employee',
        email: `emp-${tenantId}@test.com`,
        orgUnitId: orgUnit.id,
        userId: empUser.id,
        hireDate: new Date('2024-01-01'),
      },
    })
    employeeId = emp.id
  })

  afterAll(async () => {
    await prisma.oneOnOne.deleteMany({ where: { tenantId } })
    await prisma.employee.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  const futureDate = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // ── POST / ─────────────────────────────────────────────────────────────────

  test('POST / creates a scheduled 1:1', async () => {
    const res = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        managerUserId,
        scheduledAt: futureDate(),
        agenda: 'Q3 goals',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('scheduled')
    expect(body.employeeId).toBe(employeeId)
    expect(body.managerUserId).toBe(managerUserId)
    expect(body.agenda).toBe('Q3 goals')
  })

  test('POST / created 1:1 is visible via GET with employeeId filter', async () => {
    const listRes = await app.request(`/api/one-on-ones?employeeId=${employeeId}`, {
      headers: authOnly(ownerToken),
    })
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((i: { employeeId: string }) => i.employeeId === employeeId)).toBe(true)
  })

  test('POST / created 1:1 is visible via GET with managerUserId filter', async () => {
    const listRes = await app.request(`/api/one-on-ones?managerUserId=${managerUserId}`, {
      headers: authOnly(ownerToken),
    })
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((i: { managerUserId: string }) => i.managerUserId === managerUserId)).toBe(true)
  })

  test('POST / rejects scheduledAt in the past', async () => {
    const res = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        managerUserId,
        scheduledAt: new Date(Date.now() - 1000).toISOString(),
      }),
    })
    expect(res.status).toBe(400)
  })

  test('POST / returns 403 for employee role', async () => {
    const res = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(employeeToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    expect(res.status).toBe(403)
  })

  // ── GET / ──────────────────────────────────────────────────────────────────

  test('GET / is accessible to employee role', async () => {
    const res = await app.request('/api/one-on-ones', {
      headers: authOnly(employeeToken),
    })
    expect(res.status).toBe(200)
  })

  test('GET / returns 401 for unauthenticated requests', async () => {
    const res = await app.request('/api/one-on-ones')
    expect(res.status).toBe(401)
  })

  // ── full workflow: schedule → complete ─────────────────────────────────────

  let completedMeetingId: string

  test('workflow: complete with notes + actionItems sets status=completed and completedAt', async () => {
    const createRes = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    completedMeetingId = created.id
    expect(created.status).toBe('scheduled')

    const completeRes = await app.request(`/api/one-on-ones/${completedMeetingId}/complete`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        notes: 'Great session',
        actionItems: [{ text: 'Follow up on PR', assigneeUserId: managerUserId }],
      }),
    })
    expect(completeRes.status).toBe(200)
    const completed = await completeRes.json()
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBeTruthy()
    expect(completed.notes).toBe('Great session')
    expect(completed.actionItems[0].text).toBe('Follow up on PR')
  })

  test('complete a completed 1:1 returns 409', async () => {
    const res = await app.request(`/api/one-on-ones/${completedMeetingId}/complete`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
  })

  test('cancel a completed 1:1 returns 409', async () => {
    const res = await app.request(`/api/one-on-ones/${completedMeetingId}/cancel`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(409)
  })

  test('PATCH a completed 1:1 returns 409', async () => {
    const res = await app.request(`/api/one-on-ones/${completedMeetingId}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ agenda: 'new agenda' }),
    })
    expect(res.status).toBe(409)
  })

  // ── cancel workflow ────────────────────────────────────────────────────────

  test('workflow: cancel from scheduled → status=cancelled; repeat → 409', async () => {
    const createRes = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    expect(createRes.status).toBe(201)
    const { id } = await createRes.json()

    const cancelRes = await app.request(`/api/one-on-ones/${id}/cancel`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(cancelRes.status).toBe(200)
    const cancelled = await cancelRes.json()
    expect(cancelled.status).toBe('cancelled')

    const res2 = await app.request(`/api/one-on-ones/${id}/cancel`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(res2.status).toBe(409)
  })

  // ── PATCH ──────────────────────────────────────────────────────────────────

  test('PATCH reschedules a scheduled 1:1', async () => {
    const createRes = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    expect(createRes.status).toBe(201)
    const { id } = await createRes.json()

    const newDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const patchRes = await app.request(`/api/one-on-ones/${id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ scheduledAt: newDate, agenda: 'Updated agenda' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = await patchRes.json()
    expect(patched.agenda).toBe('Updated agenda')
    expect(new Date(patched.scheduledAt).getTime()).toBeGreaterThan(Date.now() + 10 * 24 * 60 * 60 * 1000)
  })

  test('PATCH returns 403 for employee role', async () => {
    const createRes = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    const { id } = await createRes.json()

    const res = await app.request(`/api/one-on-ones/${id}`, {
      method: 'PATCH',
      headers: authHeaders(employeeToken),
      body: JSON.stringify({ agenda: 'nope' }),
    })
    expect(res.status).toBe(403)
  })

  // ── GET /:id ───────────────────────────────────────────────────────────────

  test('GET /:id returns meeting card', async () => {
    const createRes = await app.request('/api/one-on-ones', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, managerUserId, scheduledAt: futureDate() }),
    })
    expect(createRes.status).toBe(201)
    const { id } = await createRes.json()

    const getRes = await app.request(`/api/one-on-ones/${id}`, {
      headers: authOnly(ownerToken),
    })
    expect(getRes.status).toBe(200)
    const body = await getRes.json()
    expect(body.id).toBe(id)
    expect(body.status).toBe('scheduled')
  })

  test('GET /:id returns 404 for unknown id', async () => {
    const res = await app.request(`/api/one-on-ones/${randomUUID()}`, {
      headers: authOnly(ownerToken),
    })
    expect(res.status).toBe(404)
  })
})
