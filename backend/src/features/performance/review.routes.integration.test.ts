import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { hashPassword } from '../../auth/passwords'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const jwtSecret = ['review', 'integration', 'test', 'secret', '32chars', 'pad'].join('-')

const env: AppEnv = {
  PORT: 3022,
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

function authOnly(token: string) {
  return { Authorization: 'Bearer ' + token }
}

maybeDescribe('ReviewCycle + ReviewRequest routes', () => {
  const prisma = createPrisma(databaseUrl!)
  const app = createApp({ env, prisma })
  const password = 'TestPass123!'

  let tenantId: string
  let ownerToken: string
  let managerToken: string
  let employeeToken: string
  let peerToken: string
  let outsiderToken: string

  let subjectEmployeeId: string
  let cycleId: string

  let subjectUserId: string
  let managerUserId: string
  let peerUserId: string
  let peerTwoUserId: string

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `reviews-${randomUUID()}` } })
    tenantId = tenant.id

    const owner = await prisma.user.create({
      data: { email: `owner-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: owner.id, role: 'owner', tenantId } })
    ownerToken = await loginAs(app, `owner-${tenantId}@test.com`, password)

    const manager = await prisma.user.create({
      data: { email: `manager-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.createMany({
      data: [
        { userId: manager.id, role: 'hiring_manager', tenantId },
        { userId: manager.id, role: 'employee', tenantId },
      ],
    })
    managerUserId = manager.id
    managerToken = await loginAs(app, `manager-${tenantId}@test.com`, password)

    const subject = await prisma.user.create({
      data: { email: `subject-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: subject.id, role: 'employee', tenantId } })
    subjectUserId = subject.id
    employeeToken = await loginAs(app, `subject-${tenantId}@test.com`, password)

    const peer = await prisma.user.create({
      data: { email: `peer-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: peer.id, role: 'employee', tenantId } })
    peerUserId = peer.id
    peerToken = await loginAs(app, `peer-${tenantId}@test.com`, password)

    const peer2 = await prisma.user.create({
      data: { email: `peer2-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: peer2.id, role: 'employee', tenantId } })
    peerTwoUserId = peer2.id

    const outsider = await prisma.user.create({
      data: { email: `outsider-${tenantId}@test.com`, passwordHash: await hashPassword(password) },
    })
    await prisma.userRole.create({ data: { userId: outsider.id, role: 'employee', tenantId } })
    outsiderToken = await loginAs(app, `outsider-${tenantId}@test.com`, password)

    const orgUnit = await prisma.orgUnit.create({ data: { tenantId, name: 'Engineering' } })
    const subjectEmployee = await prisma.employee.create({
      data: {
        tenantId,
        fullName: 'Subject Employee',
        email: `subject-${tenantId}@test.com`,
        orgUnitId: orgUnit.id,
        userId: subject.id,
        hireDate: new Date('2024-01-01'),
      },
    })
    subjectEmployeeId = subjectEmployee.id

    await prisma.oneOnOne.create({
      data: {
        tenantId,
        employeeId: subjectEmployeeId,
        managerUserId,
        scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByUserId: owner.id,
      },
    })
  })

  afterAll(async () => {
    await prisma.reviewRequest.deleteMany({ where: { tenantId } })
    await prisma.reviewCycle.deleteMany({ where: { tenantId } })
    await prisma.oneOnOne.deleteMany({ where: { tenantId } })
    await prisma.employee.deleteMany({ where: { tenantId } })
    await prisma.orgUnit.deleteMany({ where: { tenantId } })
    await prisma.auditEvent.deleteMany({ where: { tenantId } })
    await prisma.userRole.deleteMany({ where: { tenantId } })
    await prisma.user.deleteMany({ where: { email: { endsWith: `${tenantId}@test.com` } } })
    await prisma.tenant.delete({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  test('cycle lifecycle + 360 fan-out is idempotent and role-restricted', async () => {
    const createCycleRes = await app.request('/api/reviews/cycles', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        title: 'Q3 360',
        quarter: '2026-Q3',
        questions: [
          { id: 'q1', prompt: 'Rate collaboration', type: 'rating' },
          { id: 'q2', prompt: 'What can improve?', type: 'text' },
        ],
      }),
    })
    expect(createCycleRes.status).toBe(201)
    const createdCycle = await createCycleRes.json()
    cycleId = createdCycle.id
    expect(createdCycle.status).toBe('draft')

    const fanOutDraftRes = await app.request(`/api/reviews/cycles/${cycleId}/requests`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        subjectEmployeeId,
        reviewers: [{ reviewerUserId: subjectUserId, relationship: 'self' }],
      }),
    })
    expect(fanOutDraftRes.status).toBe(409)

    const openByEmployeeRes = await app.request(`/api/reviews/cycles/${cycleId}/open`, {
      method: 'POST',
      headers: authHeaders(employeeToken),
      body: JSON.stringify({ closesAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() }),
    })
    expect(openByEmployeeRes.status).toBe(403)

    const openRes = await app.request(`/api/reviews/cycles/${cycleId}/open`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ closesAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() }),
    })
    expect(openRes.status).toBe(200)

    const fanOutRes = await app.request(`/api/reviews/cycles/${cycleId}/requests`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        subjectEmployeeId,
        reviewers: [
          { reviewerUserId: subjectUserId, relationship: 'self' },
          { reviewerUserId: managerUserId, relationship: 'manager' },
          { reviewerUserId: peerUserId, relationship: 'peer' },
          { reviewerUserId: peerTwoUserId, relationship: 'peer' },
        ],
      }),
    })
    expect(fanOutRes.status).toBe(201)
    const fanOutBody = await fanOutRes.json()
    expect(fanOutBody.created).toBe(4)
    expect(fanOutBody.total).toBe(4)

    const fanOutRepeatRes = await app.request(`/api/reviews/cycles/${cycleId}/requests`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        subjectEmployeeId,
        reviewers: [
          { reviewerUserId: subjectUserId, relationship: 'self' },
          { reviewerUserId: managerUserId, relationship: 'manager' },
          { reviewerUserId: peerUserId, relationship: 'peer' },
          { reviewerUserId: peerTwoUserId, relationship: 'peer' },
        ],
      }),
    })
    expect(fanOutRepeatRes.status).toBe(201)
    const repeated = await fanOutRepeatRes.json()
    expect(repeated.created).toBe(0)
    expect(repeated.total).toBe(4)

    const closeByEmployeeRes = await app.request(`/api/reviews/cycles/${cycleId}/close`, {
      method: 'POST',
      headers: authHeaders(employeeToken),
    })
    expect(closeByEmployeeRes.status).toBe(403)
  })

  test('submit/decline permissions, terminal 409, and subject aggregation', async () => {
    const myRequestsRes = await app.request(
      `/api/reviews/requests?reviewerUserId=${peerUserId}&status=pending`,
      { headers: authOnly(peerToken) },
    )
    expect(myRequestsRes.status).toBe(200)
    const myRequests = await myRequestsRes.json()
    expect(myRequests.items.length).toBe(1)

    const allBySubjectRes = await app.request(
      `/api/reviews/requests?cycleId=${cycleId}&subjectEmployeeId=${subjectEmployeeId}`,
      { headers: authOnly(ownerToken) },
    )
    expect(allBySubjectRes.status).toBe(200)
    const allBySubject = await allBySubjectRes.json()
    expect(allBySubject.items.length).toBe(4)

    const peerRequest = allBySubject.items.find((item: { reviewerUserId: string }) => item.reviewerUserId === peerUserId)
    const managerRequest = allBySubject.items.find((item: { reviewerUserId: string }) => item.reviewerUserId === managerUserId)
    expect(peerRequest).toBeTruthy()
    expect(managerRequest).toBeTruthy()

    const foreignSubmitRes = await app.request(`/api/reviews/requests/${peerRequest.id}/submit`, {
      method: 'POST',
      headers: authHeaders(outsiderToken),
      body: JSON.stringify({ response: { q1: 5, q2: 'Great' } }),
    })
    expect(foreignSubmitRes.status).toBe(403)

    const submitRes = await app.request(`/api/reviews/requests/${peerRequest.id}/submit`, {
      method: 'POST',
      headers: authHeaders(peerToken),
      body: JSON.stringify({ response: { q1: 4, q2: 'Strong collaboration' } }),
    })
    expect(submitRes.status).toBe(200)
    const submitted = await submitRes.json()
    expect(submitted.status).toBe('submitted')
    expect(submitted.response.q1).toBe(4)

    const repeatSubmitRes = await app.request(`/api/reviews/requests/${peerRequest.id}/submit`, {
      method: 'POST',
      headers: authHeaders(peerToken),
      body: JSON.stringify({ response: { q1: 3, q2: 'Retry' } }),
    })
    expect(repeatSubmitRes.status).toBe(409)

    const repeatDeclineRes = await app.request(`/api/reviews/requests/${peerRequest.id}/decline`, {
      method: 'POST',
      headers: authHeaders(peerToken),
      body: JSON.stringify({ reason: 'Too late' }),
    })
    expect(repeatDeclineRes.status).toBe(409)

    const declineRes = await app.request(`/api/reviews/requests/${managerRequest.id}/decline`, {
      method: 'POST',
      headers: authHeaders(managerToken),
      body: JSON.stringify({ reason: 'Conflict of interest' }),
    })
    expect(declineRes.status).toBe(200)
    const declined = await declineRes.json()
    expect(declined.status).toBe('declined')
    expect(declined.declineReason).toBe('Conflict of interest')

    const aggregateRes = await app.request(`/api/reviews/cycles/${cycleId}/subjects/${subjectEmployeeId}/results`, {
      headers: authOnly(managerToken),
    })
    expect(aggregateRes.status).toBe(200)
    const aggregate = await aggregateRes.json()
    expect(aggregate.completion).toEqual({ submitted: 1, total: 4, ratio: 0.25 })

    const peerBreakdown = aggregate.byRelationship.find((item: { relationship: string }) => item.relationship === 'peer')
    expect(peerBreakdown).toEqual({ relationship: 'peer', submitted: 1, total: 2 })

    const q1Aggregate = aggregate.questionAggregates.find((item: { questionId: string }) => item.questionId === 'q1')
    expect(q1Aggregate.numericAverage).toBe(4)

    const q2Aggregate = aggregate.questionAggregates.find((item: { questionId: string }) => item.questionId === 'q2')
    expect(q2Aggregate.textResponses).toEqual(['Strong collaboration'])

    const unauthorizedAggregateRes = await app.request(
      `/api/reviews/cycles/${cycleId}/subjects/${subjectEmployeeId}/results`,
      { headers: authOnly(peerToken) },
    )
    expect(unauthorizedAggregateRes.status).toBe(403)

    const closeRes = await app.request(`/api/reviews/cycles/${cycleId}/close`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    })
    expect(closeRes.status).toBe(200)
    const closed = await closeRes.json()
    expect(closed.status).toBe('closed')
  })
})
