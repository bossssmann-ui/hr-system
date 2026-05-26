/**
 * RLS integration tests for the Phase 4 lifecycle tables.
 *
 * Spec: docs/employee-lifecycle-design.md §7 (+ §7.5 test obligations).
 *
 * Covers:
 *   - Cross-tenant denial on `employees`, `employee_lifecycle_events`,
 *     `onboarding_checklists`, `onboarding_tasks`, `employment_documents`.
 *   - Role `employee` self-service: sees only own Employee row, own
 *     employee-assigned tasks, own documents; does NOT see another
 *     employee's row even within the same tenant.
 *   - `employee_lifecycle_events` is append-only: an INSERT whose
 *     `actor_user_id` does not match `app.current_user_id()` is rejected;
 *     UPDATE / DELETE raise `permission denied`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createPrisma } from '../../db'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Phase 4 lifecycle RLS', () => {
  const prisma = createPrisma(databaseUrl!)

  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const ownerA = randomUUID()
  const employeeAUserId = randomUUID()
  const employeeA2UserId = randomUUID()

  let employeeAId = ''
  let employeeA2Id = ''
  let employeeBId = ''
  let lifecycleEventAId = ''
  let checklistAId = ''
  let ownTaskId = ''
  let otherTaskId = ''
  let documentAId = ''

  beforeAll(async () => {
    await prisma.tenant.createMany({
      data: [
        { id: tenantA, name: 'Phase4-RLS-A' },
        { id: tenantB, name: 'Phase4-RLS-B' },
      ],
      skipDuplicates: true,
    })

    await prisma.user.createMany({
      data: [
        { id: employeeAUserId, email: `${employeeAUserId}@rls.test`, passwordHash: 'x' },
        { id: employeeA2UserId, email: `${employeeA2UserId}@rls.test`, passwordHash: 'x' },
      ],
    })

    const employeeA = await prisma.employee.create({
      data: {
        tenantId: tenantA,
        userId: employeeAUserId,
        fullName: 'Alice (A)',
        status: 'active',
      },
    })
    employeeAId = employeeA.id

    const employeeA2 = await prisma.employee.create({
      data: {
        tenantId: tenantA,
        userId: employeeA2UserId,
        fullName: 'Bob (A)',
        status: 'active',
      },
    })
    employeeA2Id = employeeA2.id

    const employeeB = await prisma.employee.create({
      data: {
        tenantId: tenantB,
        fullName: 'Carol (B)',
        status: 'active',
      },
    })
    employeeBId = employeeB.id

    const lifecycleEvent = await prisma.employeeLifecycleEvent.create({
      data: {
        tenantId: tenantA,
        employeeId: employeeAId,
        type: 'hired',
        toStatus: 'pre_onboarding',
        actorUserId: ownerA,
      },
    })
    lifecycleEventAId = lifecycleEvent.id

    const checklist = await prisma.onboardingChecklist.create({
      data: {
        tenantId: tenantA,
        employeeId: employeeAId,
        title: 'Day 1',
      },
    })
    checklistAId = checklist.id

    const ownTask = await prisma.onboardingTask.create({
      data: {
        tenantId: tenantA,
        checklistId: checklistAId,
        order: 1,
        title: 'Sign NDA',
        assigneeUserId: employeeAUserId,
      },
    })
    ownTaskId = ownTask.id

    const otherTask = await prisma.onboardingTask.create({
      data: {
        tenantId: tenantA,
        checklistId: checklistAId,
        order: 2,
        title: 'Provision laptop',
        assigneeUserId: randomUUID(), // assigned to IT, not the employee
      },
    })
    otherTaskId = otherTask.id

    const document = await prisma.employmentDocument.create({
      data: {
        tenantId: tenantA,
        employeeId: employeeAId,
        type: 'employment_contract',
        title: 'TD',
        createdByUserId: ownerA,
      },
    })
    documentAId = document.id
  })

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] }
    await prisma.employmentDocument.deleteMany({ where: { tenantId: tenants } })
    await prisma.onboardingTask.deleteMany({ where: { tenantId: tenants } })
    await prisma.onboardingChecklist.deleteMany({ where: { tenantId: tenants } })
    await prisma.employeeLifecycleEvent.deleteMany({ where: { tenantId: tenants } })
    await prisma.employee.deleteMany({ where: { tenantId: tenants } })
    await prisma.user.deleteMany({ where: { id: { in: [employeeAUserId, employeeA2UserId] } } })
    await prisma.tenant.deleteMany({ where: { id: tenants } })
    await prisma.$disconnect()
  })

  async function withSession<T>(
    opts: { userId: string; roles: string; tenantId: string },
    fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE app_user`
      await tx.$queryRaw`SELECT set_config('app.user_id', ${opts.userId}, true)`
      await tx.$queryRaw`SELECT set_config('app.user_roles', ${opts.roles}, true)`
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${opts.tenantId}, true)`
      return fn(tx)
    })
  }

  // ── Cross-tenant denial (§7.5) ────────────────────────────────────────────

  test('tenant B cannot see tenant A employees', async () => {
    const rows = await withSession(
      { userId: ownerA, roles: 'owner', tenantId: tenantB },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM employees WHERE id = ${employeeAId}::uuid
      `,
    )
    expect(rows).toEqual([])
  })

  test('tenant B cannot see tenant A lifecycle events', async () => {
    const rows = await withSession(
      { userId: ownerA, roles: 'owner', tenantId: tenantB },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM employee_lifecycle_events WHERE id = ${lifecycleEventAId}::uuid
      `,
    )
    expect(rows).toEqual([])
  })

  test('tenant B cannot see tenant A onboarding checklists/tasks/documents', async () => {
    const result = await withSession(
      { userId: ownerA, roles: 'owner', tenantId: tenantB },
      async (tx) => ({
        checklists: await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM onboarding_checklists WHERE id = ${checklistAId}::uuid
        `,
        tasks: await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM onboarding_tasks WHERE id = ${ownTaskId}::uuid
        `,
        documents: await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM employment_documents WHERE id = ${documentAId}::uuid
        `,
      }),
    )
    expect(result.checklists).toEqual([])
    expect(result.tasks).toEqual([])
    expect(result.documents).toEqual([])
  })

  // ── Employee self-service read (§7.1 / §7.3 / §7.4) ──────────────────────

  test('employee sees only their own Employee row', async () => {
    const rows = await withSession(
      { userId: employeeAUserId, roles: 'employee', tenantId: tenantA },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM employees WHERE id IN (${employeeAId}::uuid, ${employeeA2Id}::uuid, ${employeeBId}::uuid)
      `,
    )
    expect(rows.map((r) => r.id)).toEqual([employeeAId])
  })

  test('employee sees only own lifecycle events', async () => {
    const otherEvent = await prisma.employeeLifecycleEvent.create({
      data: {
        tenantId: tenantA,
        employeeId: employeeA2Id,
        type: 'hired',
        toStatus: 'pre_onboarding',
        actorUserId: ownerA,
      },
    })

    try {
      const rows = await withSession(
        { userId: employeeAUserId, roles: 'employee', tenantId: tenantA },
        (tx) => tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM employee_lifecycle_events
          WHERE id IN (${lifecycleEventAId}::uuid, ${otherEvent.id}::uuid)
        `,
      )
      expect(rows.map((r) => r.id)).toEqual([lifecycleEventAId])
    } finally {
      await prisma.employeeLifecycleEvent.delete({ where: { id: otherEvent.id } })
    }
  })

  test('employee sees only tasks assigned to them, not the whole checklist', async () => {
    const rows = await withSession(
      { userId: employeeAUserId, roles: 'employee', tenantId: tenantA },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM onboarding_tasks
        WHERE id IN (${ownTaskId}::uuid, ${otherTaskId}::uuid)
      `,
    )
    expect(rows.map((r) => r.id)).toEqual([ownTaskId])
  })

  test('employee sees only their own employment documents', async () => {
    const otherDoc = await prisma.employmentDocument.create({
      data: {
        tenantId: tenantA,
        employeeId: employeeA2Id,
        type: 'employment_contract',
        title: 'TD2',
        createdByUserId: ownerA,
      },
    })
    try {
      const rows = await withSession(
        { userId: employeeAUserId, roles: 'employee', tenantId: tenantA },
        (tx) => tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM employment_documents
          WHERE id IN (${documentAId}::uuid, ${otherDoc.id}::uuid)
        `,
      )
      expect(rows.map((r) => r.id)).toEqual([documentAId])
    } finally {
      await prisma.employmentDocument.delete({ where: { id: otherDoc.id } })
    }
  })

  // ── Append-only lifecycle events (§7.2) ──────────────────────────────────

  test('lifecycle event INSERT with mismatched actor_user_id is rejected', async () => {
    const forgedActor = randomUUID()
    await expect(
      withSession(
        { userId: ownerA, roles: 'owner', tenantId: tenantA },
        (tx) => tx.$executeRaw`
          INSERT INTO employee_lifecycle_events (tenant_id, employee_id, type, actor_user_id)
          VALUES (${tenantA}::uuid, ${employeeAId}::uuid, 'hired'::lifecycle_event_type, ${forgedActor}::uuid)
        `,
      ),
    ).rejects.toThrow(/row-level security|violates|new row/i)
  })

  test('lifecycle event INSERT with NULL actor_user_id from a human session is rejected', async () => {
    await expect(
      withSession(
        { userId: ownerA, roles: 'owner', tenantId: tenantA },
        (tx) => tx.$executeRaw`
          INSERT INTO employee_lifecycle_events (tenant_id, employee_id, type, actor_user_id)
          VALUES (${tenantA}::uuid, ${employeeAId}::uuid, 'hired'::lifecycle_event_type, NULL)
        `,
      ),
    ).rejects.toThrow(/row-level security|violates|new row/i)
  })

  test('lifecycle event INSERT succeeds when actor_user_id = current_user_id', async () => {
    const rows = await withSession(
      { userId: ownerA, roles: 'owner', tenantId: tenantA },
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO employee_lifecycle_events (tenant_id, employee_id, type, actor_user_id)
          VALUES (${tenantA}::uuid, ${employeeAId}::uuid, 'hired'::lifecycle_event_type, ${ownerA}::uuid)
        `
        return tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM employee_lifecycle_events
          WHERE employee_id = ${employeeAId}::uuid AND actor_user_id = ${ownerA}::uuid
        `
      },
    )
    expect(rows.length).toBeGreaterThanOrEqual(2) // seeded + new
  })

  test('lifecycle event INSERT with NULL actor_user_id from a system session succeeds', async () => {
    await withSession(
      { userId: ownerA, roles: 'system', tenantId: tenantA },
      (tx) => tx.$executeRaw`
        INSERT INTO employee_lifecycle_events (tenant_id, employee_id, type, actor_user_id)
        VALUES (${tenantA}::uuid, ${employeeAId}::uuid, 'hired'::lifecycle_event_type, NULL)
      `,
    )
    // cleanup: count not asserted, just no throw
  })

  test('lifecycle event UPDATE is rejected (append-only)', async () => {
    await expect(
      withSession(
        { userId: ownerA, roles: 'owner', tenantId: tenantA },
        (tx) => tx.$executeRaw`
          UPDATE employee_lifecycle_events SET note = 'tampered' WHERE id = ${lifecycleEventAId}::uuid
        `,
      ),
    ).rejects.toThrow(/permission denied|policy/i)
  })

  test('lifecycle event DELETE is rejected (append-only)', async () => {
    await expect(
      withSession(
        { userId: ownerA, roles: 'owner', tenantId: tenantA },
        (tx) => tx.$executeRaw`
          DELETE FROM employee_lifecycle_events WHERE id = ${lifecycleEventAId}::uuid
        `,
      ),
    ).rejects.toThrow(/permission denied|policy/i)
  })
})
