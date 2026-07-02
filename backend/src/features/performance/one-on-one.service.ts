/**
 * OneOnOne service — Horizon 4 Performance module.
 *
 * Encapsulates CRUD + FSM transitions with audit side-effects.
 * The `send1on1Reminders` cron helper in `learning.service.ts` is unchanged.
 */

import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'
import type { Role } from '../requisitions/requisitions.fsm'
import { canTransition, isTerminalStatus, type OneOnOneStatus } from './one-on-one.fsm'

type PrismaLike = Pick<
  DbClient,
  'oneOnOne' | 'employee' | 'auditEvent'
>

// ─── toDto ────────────────────────────────────────────────────────────────────

function toDto(row: {
  id: string
  tenantId: string
  employeeId: string
  managerUserId: string
  scheduledAt: Date
  durationMinutes: number | null
  status: string
  agenda: string | null
  notes: string | null
  actionItems: unknown
  reminderSentAt: Date | null
  completedAt: Date | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    managerUserId: row.managerUserId,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: row.status as OneOnOneStatus,
    agenda: row.agenda,
    notes: row.notes,
    actionItems: Array.isArray(row.actionItems) ? row.actionItems : [],
    reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ─── create ───────────────────────────────────────────────────────────────────

export type CreateOneOnOneInput = {
  prisma: PrismaLike
  tenantId: string
  actorUserId: string
  employeeId: string
  managerUserId: string
  scheduledAt: string
  durationMinutes?: number
  agenda?: string
  now?: Date
}

export async function createOneOnOne(input: CreateOneOnOneInput) {
  const { prisma, tenantId, actorUserId, employeeId, managerUserId, scheduledAt, durationMinutes, agenda, now } = input

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId } })
  if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

  const nowDate = now ?? new Date()
  if (new Date(scheduledAt) <= nowDate) {
    throw new AppError(400, 'BAD_REQUEST', 'scheduledAt must be in the future')
  }

  const meeting = await prisma.oneOnOne.create({
    data: {
      tenantId,
      employeeId,
      managerUserId,
      scheduledAt: new Date(scheduledAt),
      durationMinutes: durationMinutes ?? null,
      agenda: agenda ?? null,
      createdByUserId: actorUserId,
    },
  })

  return toDto(meeting)
}

// ─── list ─────────────────────────────────────────────────────────────────────

export type ListOneOnOnesInput = {
  prisma: PrismaLike
  tenantId: string
  employeeId?: string
  managerUserId?: string
  status?: OneOnOneStatus
  page?: number
  pageSize?: number
}

export async function listOneOnOnes(input: ListOneOnOnesInput) {
  const { prisma, tenantId, employeeId, managerUserId, status, page = 1, pageSize = 20 } = input

  const where = {
    tenantId,
    ...(employeeId ? { employeeId } : {}),
    ...(managerUserId ? { managerUserId } : {}),
    ...(status ? { status } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.oneOnOne.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.oneOnOne.count({ where }),
  ])

  return { items: items.map(toDto), total }
}

// ─── getById ──────────────────────────────────────────────────────────────────

export async function getOneOnOneById(prisma: PrismaLike, tenantId: string, id: string) {
  const meeting = await prisma.oneOnOne.findFirst({ where: { id, tenantId } })
  if (!meeting) throw new AppError(404, 'NOT_FOUND', '1:1 not found')
  return toDto(meeting)
}

// ─── patch ────────────────────────────────────────────────────────────────────

export type PatchOneOnOneInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  scheduledAt?: string
  agenda?: string
  durationMinutes?: number
  now?: Date
}

export async function patchOneOnOne(input: PatchOneOnOneInput) {
  const { prisma, tenantId, id, scheduledAt, agenda, durationMinutes, now } = input

  const existing = await prisma.oneOnOne.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', '1:1 not found')

  if (isTerminalStatus(existing.status as OneOnOneStatus)) {
    throw new AppError(409, 'CONFLICT', 'Cannot patch a completed or cancelled 1:1')
  }

  if (scheduledAt !== undefined) {
    const nowDate = now ?? new Date()
    if (new Date(scheduledAt) <= nowDate) {
      throw new AppError(400, 'BAD_REQUEST', 'scheduledAt must be in the future')
    }
  }

  const data: Record<string, unknown> = {}
  if (scheduledAt !== undefined) data.scheduledAt = new Date(scheduledAt)
  if (agenda !== undefined) data.agenda = agenda
  if (durationMinutes !== undefined) data.durationMinutes = durationMinutes

  const updated = await prisma.oneOnOne.update({ where: { id }, data })
  return toDto(updated)
}

// ─── complete ─────────────────────────────────────────────────────────────────

export type CompleteOneOnOneInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorRoles: ReadonlyArray<Role>
  notes?: string
  actionItems?: unknown[]
  now?: Date
}

export async function completeOneOnOne(input: CompleteOneOnOneInput) {
  const { prisma, tenantId, id, actorRoles, notes, actionItems, now } = input

  const existing = await prisma.oneOnOne.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', '1:1 not found')

  if (isTerminalStatus(existing.status as OneOnOneStatus)) {
    throw new AppError(409, 'CONFLICT', 'Cannot complete a completed or cancelled 1:1')
  }

  if (!canTransition(existing.status as OneOnOneStatus, 'completed', actorRoles)) {
    throw new AppError(403, 'FORBIDDEN', 'Role not allowed to complete this 1:1')
  }

  const nowDate = now ?? new Date()
  const updated = await prisma.oneOnOne.update({
    where: { id },
    data: {
      status: 'completed',
      completedAt: nowDate,
      ...(notes !== undefined ? { notes } : {}),
      ...(actionItems !== undefined ? { actionItems: actionItems as never } : {}),
    },
  })
  return toDto(updated)
}

// ─── cancel ───────────────────────────────────────────────────────────────────

export type CancelOneOnOneInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorRoles: ReadonlyArray<Role>
}

export async function cancelOneOnOne(input: CancelOneOnOneInput) {
  const { prisma, tenantId, id, actorRoles } = input

  const existing = await prisma.oneOnOne.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', '1:1 not found')

  if (isTerminalStatus(existing.status as OneOnOneStatus)) {
    throw new AppError(409, 'CONFLICT', 'Cannot cancel a completed or cancelled 1:1')
  }

  if (!canTransition(existing.status as OneOnOneStatus, 'cancelled', actorRoles)) {
    throw new AppError(403, 'FORBIDDEN', 'Role not allowed to cancel this 1:1')
  }

  const updated = await prisma.oneOnOne.update({
    where: { id },
    data: { status: 'cancelled' },
  })
  return toDto(updated)
}
