/**
 * RLS integration tests — extended for Phase 1B tables.
 *
 * Verifies that candidates, applications, vacancies, and application_stage_events
 * rows belonging to tenant A are invisible to a session whose `app.tenant_id`
 * is tenant B. Extends the Phase 0 hiring_requisitions test from
 * `requisitions.rls.integration.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createPrisma } from '../db'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Phase 1B RLS cross-tenant isolation', () => {
  const prisma = createPrisma(databaseUrl!)
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const ownerA = randomUUID()
  const orgUnitA = randomUUID()

  let candidateId = ''
  let vacancyId = ''
  let applicationId = ''
  let stageEventId = ''

  beforeAll(async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'RLS-Tenant-A' },
        { id: tenantB, name: 'RLS-Tenant-B' },
      ],
      skipDuplicates: true,
    })

    await prisma.orgUnit.create({
      data: { id: orgUnitA, tenantId: tenantA, name: 'Engineering' },
    })

    const requisition = await prisma.hiringRequisition.create({
      data: {
        tenantId: tenantA,
        orgUnitId: orgUnitA,
        createdByUserId: ownerA,
        title: 'RLS Test Role',
        grade: 'M1',
        salaryMin: 100_000,
        salaryMax: 200_000,
        currency: 'RUB',
        justification: 'RLS test',
        status: 'approved',
      },
    })

    const vacancy = await prisma.vacancy.create({
      data: {
        tenantId: tenantA,
        requisitionId: requisition.id,
        orgUnitId: orgUnitA,
        title: 'RLS Test Vacancy',
        description: 'rls test',
      },
    })
    vacancyId = vacancy.id

    const candidate = await prisma.candidate.create({
      data: { tenantId: tenantA, fullName: 'RLS Candidate', source: 'manual' },
    })
    candidateId = candidate.id

    const application = await prisma.application.create({
      data: {
        tenantId: tenantA,
        candidateId: candidate.id,
        vacancyId: vacancy.id,
        stage: 'new',
      },
    })
    applicationId = application.id

    const stageEvent = await prisma.applicationStageEvent.create({
      data: {
        tenantId: tenantA,
        applicationId: application.id,
        fromStage: 'new',
        toStage: 'screen',
        actorUserId: ownerA,
      },
    })
    stageEventId = stageEvent.id
  })

  afterAll(async () => {
    await prisma.applicationStageEvent.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.application.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.candidate.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.vacancy.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.hiringRequisition.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.orgUnit.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
    await prisma.$disconnect()
  })

  test('tenant B session cannot see tenant A candidates', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM candidates WHERE id = ${candidateId}::uuid
      `
    })
    expect(rows).toEqual([])
  })

  test('tenant A session can see tenant A candidates', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM candidates WHERE id = ${candidateId}::uuid
      `
    })
    expect(rows.map((r) => r.id)).toEqual([candidateId])
  })

  test('tenant B session cannot see tenant A vacancies', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM vacancies WHERE id = ${vacancyId}::uuid
      `
    })
    expect(rows).toEqual([])
  })

  test('tenant B session cannot see tenant A applications', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM applications WHERE id = ${applicationId}::uuid
      `
    })
    expect(rows).toEqual([])
  })

  test('tenant B session cannot see tenant A application_stage_events', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM application_stage_events WHERE id = ${stageEventId}::uuid
      `
    })
    expect(rows).toEqual([])
  })

  test('recruiter (without hiring_manager role) cannot see another tenant application', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${randomUUID()}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'recruiter', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM applications WHERE id = ${applicationId}::uuid
      `
    })
    expect(rows).toEqual([])
  })
})
