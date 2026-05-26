/**
 * Employee lifecycle service — Phase 4.3 handoff.
 *
 * Implements `createFromApplication`: the side-effect triggered by the
 * `Application.offer → hired` transition that creates an `Employee` row
 * and writes an `employee.created` audit event.
 *
 * Spec: docs/employee-lifecycle-design.md §1.2.
 */

import type { DbClient } from '../../db'
import { offerDraftSchema } from '../interviews/interviews.schemas'

export type CreateFromApplicationInput = {
  prisma: DbClient
  applicationId: string
  actorUserId?: string
  tenantId: string
}

/**
 * Create an `Employee(pre_onboarding)` from a hired `Application`.
 *
 * - Idempotent: if an `Employee` already exists for the given `applicationId`
 *   (invariant: UNIQUE), the existing row is returned without creating a
 *   duplicate (satisfies the "re-run after rollback" requirement).
 * - Snapshots candidate, org-unit, requisition, position, grade, currency,
 *   agreed salary, and agreed start date at the moment of hire so the
 *   `Employee` record is decoupled from later edits to `Application` /
 *   `HiringRequisition`.
 * - Writes an `AuditEvent` with `action = 'employee.created'` and
 *   `diff.via = 'hired_application'`.
 *
 * Call this inside the same `prisma.$transaction` callback as the stage
 * update so the employee is created atomically with the `hired` stage.
 */
export async function createFromApplication(input: CreateFromApplicationInput) {
  const { prisma, applicationId, actorUserId, tenantId } = input

  // ── Idempotency check ────────────────────────────────────────────────────
  const existing = await prisma.employee.findUnique({
    where: { applicationId },
  })
  if (existing) return existing

  // ── Load application data ────────────────────────────────────────────────
  const application = await prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    include: {
      candidate: true,
      vacancy: {
        include: {
          requisition: true,
        },
      },
    },
  })

  if (!application) {
    throw new Error(`createFromApplication: application ${applicationId} not found`)
  }

  const { candidate, vacancy } = application
  const { requisition } = vacancy

  // ── Resolve agreed terms from the latest offer draft ────────────────────
  // The offer draft is stored as JSONB on the latest Interview for the
  // application. Terms are optional — the employee is created regardless.
  const interview = await prisma.interview.findFirst({
    where: { applicationId, tenantId },
    orderBy: { createdAt: 'desc' },
    select: { offerDraft: true },
  })

  const offerDraft =
    interview?.offerDraft != null
      ? offerDraftSchema.safeParse(interview.offerDraft).data
      : undefined

  // ── Create employee ──────────────────────────────────────────────────────
  const employee = await prisma.employee.create({
    data: {
      tenantId,
      applicationId,
      candidateId: candidate.id,
      requisitionId: requisition.id,
      orgUnitId: vacancy.orgUnitId,
      fullName: candidate.fullName,
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      jobTitle: vacancy.title,
      grade: offerDraft?.grade ?? requisition.grade,
      currency: offerDraft?.currency ?? requisition.currency,
      agreedBaseSalary: offerDraft?.salary ?? null,
      agreedStartDate:
        offerDraft?.start_date != null ? new Date(offerDraft.start_date) : null,
      status: 'pre_onboarding',
    },
  })

  // ── Audit event ──────────────────────────────────────────────────────────
  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorUserId: actorUserId ?? null,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      diff: {
        via: 'hired_application',
        applicationId,
        candidateId: candidate.id,
      },
    },
  })

  return employee
}
