import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['okr', 'integration', 'test', 'secret', '32chars', 'pad'].join('-')

const env: AppEnv = {
  PORT: 3023,
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

maybeDescribe('OKR routes', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let ownerToken: string
  let employeeToken: string
  let outsiderToken: string
  let managerToken: string
  let ownerUserId: string
  let managerUserId: string
  let employeeId: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `okr-${randomUUID()}` } })
    tenantId = tenant.id

    const owner = await prisma.user.create({
      data: { email: `owner-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    ownerUserId = owner.id
    await prisma.userRole.create({ data: { userId: owner.id, role: 'owner', tenantId } })
    ownerToken = await loginAs(app, `owner-${tenantId}@test.com`, password)

    const manager = await prisma.user.create({
      data: { email: `manager-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    managerUserId = manager.id
    await prisma.userRole.createMany({
      data: [
        { userId: manager.id, role: 'employee', tenantId },
        { userId: manager.id, role: 'hiring_manager', tenantId },
      ],
    })
    managerToken = await loginAs(app, `manager-${tenantId}@test.com`, password)

    const employeeUser = await prisma.user.create({
      data: { email: `employee-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: employeeUser.id, role: 'employee', tenantId } })
    employeeToken = await loginAs(app, `employee-${tenantId}@test.com`, password)

    const outsider = await prisma.user.create({
      data: { email: `outsider-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: outsider.id, role: 'employee', tenantId } })
    outsiderToken = await loginAs(app, `outsider-${tenantId}@test.com`, password)

    const orgUnit = await prisma.orgUnit.create({ data: { tenantId, name: 'Engineering' } })
    const employee = await prisma.employee.create({
      data: {
        tenantId,
        orgUnitId: orgUnit.id,
        userId: employeeUser.id,
        fullName: 'Performance Employee',
        email: `employee-${tenantId}@test.com`,
        hireDate: new Date('2024-01-01'),
      },
    })
    employeeId = employee.id

    await prisma.oneOnOne.create({
      data: {
        tenantId,
        employeeId,
        managerUserId,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByUserId: ownerUserId,
      },
    })
  })

  afterAll(async () => {
    await prisma.keyResult.deleteMany({ where: { tenantId } })
    await prisma.okr.deleteMany({ where: { tenantId } })
    await prisma.oneOnOne.deleteMany({ where: { tenantId } })
    await prisma.employee.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('CRUD workflow + KR progress rollup + close rules + parent/children relation + cycle guard', async () => {
    const createParentRes = await app.request('/api/okrs', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        quarter: '2026-Q3',
        objective: 'Ship Horizon 4',
      }),
    })
    expect(createParentRes.status).toBe(201)
    const parent = await createParentRes.json()
    expect(parent.status).toBe('draft')

    const createChildRes = await app.request('/api/okrs', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        quarter: '2026-Q3',
        objective: 'Improve OKR quality',
        parentOkrId: parent.id,
      }),
    })
    expect(createChildRes.status).toBe(201)
    const child = await createChildRes.json()
    expect(child.parentOkrId).toBe(parent.id)

    const cyclePatchRes = await app.request(`/api/okrs/${parent.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ parentOkrId: child.id }),
    })
    expect(cyclePatchRes.status).toBe(400)

    const activateRes = await app.request(`/api/okrs/${parent.id}/activate`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    })
    expect(activateRes.status).toBe(200)
    const active = await activateRes.json()
    expect(active.status).toBe('active')

    const createKr1Res = await app.request(`/api/okrs/${parent.id}/key-results`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        title: 'KR1',
        startValue: 0,
        targetValue: 10,
      }),
    })
    expect(createKr1Res.status).toBe(201)
    const kr1 = await createKr1Res.json()
    expect(kr1.status).toBe('open')

    const createKr2Res = await app.request(`/api/okrs/${parent.id}/key-results`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        title: 'KR2',
        startValue: 0,
        targetValue: 20,
      }),
    })
    expect(createKr2Res.status).toBe(201)
    const kr2 = await createKr2Res.json()

    const updateKr1Res = await app.request(`/api/okrs/key-results/${kr1.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ currentValue: 7 }),
    })
    expect(updateKr1Res.status).toBe(200)
    const updatedKr1 = await updateKr1Res.json()
    expect(updatedKr1.status).toBe('on_track')

    const parentAfterKr1Res = await app.request(`/api/okrs/${parent.id}`, { headers: authOnly(ownerToken) })
    expect(parentAfterKr1Res.status).toBe(200)
    const parentAfterKr1 = await parentAfterKr1Res.json()
    expect(parentAfterKr1.progressPercent).toBe(35)

    const updateKr2Res = await app.request(`/api/okrs/key-results/${kr2.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ currentValue: 20 }),
    })
    expect(updateKr2Res.status).toBe(200)
    const updatedKr2 = await updateKr2Res.json()
    expect(updatedKr2.status).toBe('achieved')

    const finishKr1Res = await app.request(`/api/okrs/key-results/${kr1.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ currentValue: 10 }),
    })
    expect(finishKr1Res.status).toBe(200)
    const finishedKr1 = await finishKr1Res.json()
    expect(finishedKr1.status).toBe('achieved')

    const parentReadyToCloseRes = await app.request(`/api/okrs/${parent.id}`, { headers: authOnly(ownerToken) })
    const parentReadyToClose = await parentReadyToCloseRes.json()
    expect(parentReadyToClose.progressPercent).toBe(100)

    const closeAchievedRes = await app.request(`/api/okrs/${parent.id}/close`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(closeAchievedRes.status).toBe(200)
    const closedAchieved = await closeAchievedRes.json()
    expect(closedAchieved.status).toBe('achieved')

    const repeatCloseRes = await app.request(`/api/okrs/${parent.id}/close`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(repeatCloseRes.status).toBe(409)

    const activateTerminalRes = await app.request(`/api/okrs/${parent.id}/activate`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    })
    expect(activateTerminalRes.status).toBe(409)

    const createMissedRes = await app.request('/api/okrs', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        quarter: '2026-Q4',
        objective: 'Secondary objective',
      }),
    })
    expect(createMissedRes.status).toBe(201)
    const missed = await createMissedRes.json()

    const activateMissedRes = await app.request(`/api/okrs/${missed.id}/activate`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    })
    expect(activateMissedRes.status).toBe(200)

    const createMissedKrRes = await app.request(`/api/okrs/${missed.id}/key-results`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        title: 'Missed KR',
        startValue: 0,
        targetValue: 10,
      }),
    })
    expect(createMissedKrRes.status).toBe(201)

    const updateMissedKrRes = await app.request(`/api/okrs/key-results/${(await createMissedKrRes.json()).id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ currentValue: 2 }),
    })
    expect(updateMissedKrRes.status).toBe(200)

    const closeMissedRes = await app.request(`/api/okrs/${missed.id}/close`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({}),
    })
    expect(closeMissedRes.status).toBe(200)
    expect((await closeMissedRes.json()).status).toBe('missed')

    const listRes = await app.request(`/api/okrs?employeeId=${employeeId}&quarter=2026-Q3`, {
      headers: authOnly(ownerToken),
    })
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    const listParent = listBody.items.find((item: { id: string }) => item.id === parent.id)
    const listChild = listBody.items.find((item: { id: string }) => item.id === child.id)
    expect(listParent).toBeTruthy()
    expect(listChild.parentOkrId).toBe(parent.id)

    const auditActions = await prisma.auditEvent.findMany({
      where: { tenantId, action: { in: ['okr.created', 'okr.activated', 'okr.closed', 'key_result.updated'] } },
      select: { action: true },
    })
    expect(auditActions.some((item) => item.action === 'okr.created')).toBe(true)
    expect(auditActions.some((item) => item.action === 'okr.activated')).toBe(true)
    expect(auditActions.some((item) => item.action === 'okr.closed')).toBe(true)
    expect(auditActions.some((item) => item.action === 'key_result.updated')).toBe(true)
  })

  test("access control: unrelated employee cannot access another employee's OKR; manager can read", async () => {
    const createRes = await app.request('/api/okrs', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        employeeId,
        quarter: '2027-Q1',
        objective: 'Access check objective',
      }),
    })
    const okr = await createRes.json()

    const forbiddenRes = await app.request(`/api/okrs/${okr.id}`, {
      headers: authOnly(outsiderToken),
    })
    expect(forbiddenRes.status).toBe(403)

    const managerReadRes = await app.request(`/api/okrs/${okr.id}`, {
      headers: authOnly(managerToken),
    })
    expect(managerReadRes.status).toBe(200)

    const employeeReadRes = await app.request(`/api/okrs/${okr.id}`, {
      headers: authOnly(employeeToken),
    })
    expect(employeeReadRes.status).toBe(200)
  })
})
