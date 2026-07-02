import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['idp', 'integration', 'test', 'secret', '32chars', 'pad'].join('-')

const env: AppEnv = {
  PORT: 3024,
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

maybeDescribe('IDP routes', () => {
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
    const tenant = await prisma.tenant.create({ data: { name: `idp-${randomUUID()}` } })
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
        fullName: 'IDP Employee',
        email: `employee-${tenantId}@test.com`,
        hireDate: new Date('2024-01-01'),
      },
    })
    employeeId = employee.id

    // Link manager to employee via 1:1 so hiring_manager access works
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
    await prisma.idpItem.deleteMany({ where: { tenantId } })
    await prisma.idp.deleteMany({ where: { tenantId } })
    await prisma.oneOnOne.deleteMany({ where: { tenantId } })
    await prisma.employee.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('full workflow: create draft → activate → add 3 items → 2 completed + 1 dropped → progress=100%', async () => {
    // Create IDP in draft
    const createRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2026-Q3', summary: 'Grow as a tech lead' }),
    })
    expect(createRes.status).toBe(201)
    const idp = await createRes.json()
    expect(idp.status).toBe('draft')
    expect(idp.employeeId).toBe(employeeId)
    expect(idp.quarter).toBe('2026-Q3')

    // Activate
    const activateRes = await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'active' }),
    })
    expect(activateRes.status).toBe(200)
    const active = await activateRes.json()
    expect(active.status).toBe('active')

    // Add 3 items
    const item1Res = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ title: 'Read Clean Architecture', dueDate: '2026-09-30' }),
    })
    expect(item1Res.status).toBe(201)
    const item1 = await item1Res.json()
    expect(item1.status).toBe('planned')

    const item2Res = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ title: 'Lead a design review' }),
    })
    expect(item2Res.status).toBe(201)
    const item2 = await item2Res.json()

    const item3Res = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ title: 'Mentor a junior' }),
    })
    expect(item3Res.status).toBe(201)
    const item3 = await item3Res.json()

    // Complete item1 — completedAt should be set
    const completeItem1Res = await app.request(`/api/idps/items/${item1.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'completed' }),
    })
    expect(completeItem1Res.status).toBe(200)
    const completedItem1 = await completeItem1Res.json()
    expect(completedItem1.status).toBe('completed')
    expect(completedItem1.completedAt).not.toBeNull()

    // Complete item2
    const completeItem2Res = await app.request(`/api/idps/items/${item2.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'completed' }),
    })
    expect(completeItem2Res.status).toBe(200)

    // Drop item3 — should be excluded from denominator
    const dropItem3Res = await app.request(`/api/idps/items/${item3.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'dropped' }),
    })
    expect(dropItem3Res.status).toBe(200)
    const droppedItem3 = await dropItem3Res.json()
    expect(droppedItem3.status).toBe('dropped')

    // GET /:id — verify progress = 100% (2 completed / 2 countable, dropped excluded)
    const getRes = await app.request(`/api/idps/${idp.id}`, {
      headers: authHeaders(ownerToken),
    })
    expect(getRes.status).toBe(200)
    const full = await getRes.json()
    expect(full.items).toHaveLength(3)
    expect(full.progress).toBe(100)
  })

  test('duplicate (employeeId, quarter) → 409', async () => {
    const res1 = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2026-Q4' }),
    })
    expect(res1.status).toBe(201)

    const res2 = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2026-Q4' }),
    })
    expect(res2.status).toBe(409)
    const body = await res2.json()
    expect(body.code).toBe('CONFLICT')
  })

  test('IDP status only forward: completed is terminal', async () => {
    const createRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2025-Q1' }),
    })
    expect(createRes.status).toBe(201)
    const idp = await createRes.json()

    // draft → active
    await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'active' }),
    })

    // active → completed
    const completeRes = await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'completed' }),
    })
    expect(completeRes.status).toBe(200)

    // completed → active (should fail — terminal)
    const backRes = await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'active' }),
    })
    expect(backRes.status).toBe(409)

    // completed → draft (should fail — terminal)
    const backDraftRes = await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'draft' }),
    })
    expect(backDraftRes.status).toBe(409)
  })

  test('backward status transition draft←active is rejected', async () => {
    const createRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2025-Q2' }),
    })
    expect(createRes.status).toBe(201)
    const idp = await createRes.json()

    await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'active' }),
    })

    const backRes = await app.request(`/api/idps/${idp.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'draft' }),
    })
    expect(backRes.status).toBe(409)
  })

  test('item completedAt set on →completed and cleared on reverse', async () => {
    const createIdpRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2025-Q3' }),
    })
    expect(createIdpRes.status).toBe(201)
    const idp = await createIdpRes.json()

    const createItemRes = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ title: 'Complete a course' }),
    })
    expect(createItemRes.status).toBe(201)
    const item = await createItemRes.json()
    expect(item.completedAt).toBeNull()

    // planned → completed sets completedAt
    const completeRes = await app.request(`/api/idps/items/${item.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'completed' }),
    })
    expect(completeRes.status).toBe(200)
    const completed = await completeRes.json()
    expect(completed.completedAt).not.toBeNull()

    // completed → in_progress clears completedAt
    const reverseRes = await app.request(`/api/idps/items/${item.id}`, {
      method: 'PATCH',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ status: 'in_progress' }),
    })
    expect(reverseRes.status).toBe(200)
    const reversed = await reverseRes.json()
    expect(reversed.completedAt).toBeNull()
  })

  test('access control: outsider without employee link gets 403', async () => {
    const createRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2025-Q4' }),
    })
    expect(createRes.status).toBe(201)
    const idp = await createRes.json()

    // outsider cannot GET
    const getRes = await app.request(`/api/idps/${idp.id}`, {
      headers: { Authorization: 'Bearer ' + outsiderToken },
    })
    expect(getRes.status).toBe(403)

    // outsider cannot create item
    const itemRes = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(outsiderToken),
      body: JSON.stringify({ title: 'Sneaky item' }),
    })
    expect(itemRes.status).toBe(403)
  })

  test('manager with 1:1 link can access employee IDP', async () => {
    const createRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2024-Q1' }),
    })
    expect(createRes.status).toBe(201)
    const idp = await createRes.json()

    const getRes = await app.request(`/api/idps/${idp.id}`, {
      headers: { Authorization: 'Bearer ' + managerToken },
    })
    expect(getRes.status).toBe(200)
  })

  test('employee can access their own IDP', async () => {
    const listRes = await app.request(`/api/idps?employeeId=${employeeId}`, {
      headers: { Authorization: 'Bearer ' + employeeToken },
    })
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(Array.isArray(body.items)).toBe(true)
  })

  test('DELETE /items/:itemId removes item', async () => {
    const createIdpRes = await app.request('/api/idps', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ employeeId, quarter: '2024-Q2' }),
    })
    expect(createIdpRes.status).toBe(201)
    const idp = await createIdpRes.json()

    const createItemRes = await app.request(`/api/idps/${idp.id}/items`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ title: 'To be deleted' }),
    })
    expect(createItemRes.status).toBe(201)
    const item = await createItemRes.json()

    const deleteRes = await app.request(`/api/idps/items/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + ownerToken },
    })
    expect(deleteRes.status).toBe(204)

    // Verify item is gone
    const getRes = await app.request(`/api/idps/${idp.id}`, {
      headers: authHeaders(ownerToken),
    })
    const full = await getRes.json()
    expect(full.items.find((i: { id: string }) => i.id === item.id)).toBeUndefined()
  })

  test('GET / with filters returns matching IDPs', async () => {
    const listRes = await app.request(`/api/idps?employeeId=${employeeId}&quarter=2026-Q3`, {
      headers: authHeaders(ownerToken),
    })
    expect(listRes.status).toBe(200)
    const body = await listRes.json()
    expect(Array.isArray(body.items)).toBe(true)
    for (const item of body.items) {
      expect(item.employeeId).toBe(employeeId)
      expect(item.quarter).toBe('2026-Q3')
    }
  })
})
