/**
 * RLS integration test — cross-tenant denial.
 *
 * Verifies that `hiring_requisitions` rows belonging to tenant A are
 * invisible to a session whose `app.tenant_id` is tenant B, even though the
 * application code uses the same Prisma client. The check uses a transaction
 * that sets the session variables described in
 * `docs/contracts/30-rls-policies.md`.
 *
 * Phase 0 ships exactly one RLS integration test: cross-tenant denial on
 * `hiring_requisitions`. The full per-table matrix (role-based denial on
 * every business table) lands alongside the per-domain routes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createPrisma } from '../../db'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('hiring_requisitions RLS cross-tenant denial', () => {
  const prisma = createPrisma(databaseUrl!)
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const ownerA = randomUUID()
  const orgUnitA = randomUUID()
  let requisitionId = ''

  beforeAll(async () => {
    // Seed via Prisma client (runs as the migrator role → bypasses RLS).
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Tenant A' },
        { id: tenantB, name: 'Tenant B' },
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
        title: 'Backend engineer',
        grade: 'M2',
        salaryMin: 200_000,
        salaryMax: 300_000,
        currency: 'RUB',
        justification: 'Growth headcount',
      },
    })
    requisitionId = requisition.id
  })

  afterAll(async () => {
    await prisma.hiringRequisition.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.orgUnit.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
    await prisma.$disconnect()
  })

  test('tenant B session cannot see tenant A requisitions', async () => {
    // Open a raw transaction with the tenant-B session variables.
    // `SET LOCAL` cannot use bind parameters; `set_config()` is the
    // parameter-safe equivalent. The SELECT is a tagged template (`$queryRaw`)
    // so the requisition id is bound, not interpolated.
    const rowsForB = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantB}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM hiring_requisitions WHERE id = ${requisitionId}::uuid
      `
    })
    expect(rowsForB).toEqual([])
  })

  test('tenant A session can see tenant A requisitions', async () => {
    const rowsForA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ownerA}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', 'owner', true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM hiring_requisitions WHERE id = ${requisitionId}::uuid
      `
    })
    expect(rowsForA.map((r) => r.id)).toEqual([requisitionId])
  })
})
