import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'
import type { Role } from '../requisitions/requisitions.fsm'
import {
  canIdpItemTransition,
  canIdpTransition,
  computeIdpProgress,
  isTerminalIdpStatus,
  type IdpItemStatus,
  type IdpStatus,
} from './idp.fsm'

type PrismaLike = Pick<DbClient, 'idp' | 'idpItem' | 'employee' | 'oneOnOne'>

type IdpRow = {
  id: string
  tenantId: string
  employeeId: string
  quarter: string
  summary: string | null
  status: string
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

type IdpItemRow = {
  id: string
  tenantId: string
  idpId: string
  title: string
  description: string | null
  status: string
  dueDate: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toIdpItemDto(row: IdpItemRow) {
  return {
    id: row.id,
    idpId: row.idpId,
    title: row.title,
    description: row.description,
    status: row.status as IdpItemStatus,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toIdpDto(row: IdpRow & { items?: IdpItemRow[] }) {
  const base = {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    quarter: row.quarter,
    summary: row.summary,
    status: row.status as IdpStatus,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  if (row.items === undefined) return base
  const items = row.items.map(toIdpItemDto)
  return { ...base, items, progress: computeIdpProgress(items) }
}

export async function createIdp({
  prisma,
  tenantId,
  actorUserId,
  employeeId,
  quarter,
  summary,
}: {
  prisma: PrismaLike
  tenantId: string
  actorUserId: string
  employeeId: string
  quarter: string
  summary?: string
}) {
  const existing = await prisma.idp.findFirst({ where: { employeeId, quarter, tenantId } })
  if (existing) {
    throw new AppError(409, 'CONFLICT', `IDP for employee ${employeeId} in ${quarter} already exists`)
  }

  const row = await prisma.idp.create({
    data: {
      tenantId,
      employeeId,
      quarter,
      summary: summary ?? null,
      status: 'draft',
      createdByUserId: actorUserId,
    },
  })
  return toIdpDto(row)
}

export async function patchIdp({
  prisma,
  tenantId,
  id,
  summary,
  status,
  actorRoles,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  summary?: string
  status?: string
  actorRoles: ReadonlyArray<string>
}) {
  const existing = await prisma.idp.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP not found')

  const data: Record<string, unknown> = {}
  if (summary !== undefined) {
    if (isTerminalIdpStatus(existing.status as IdpStatus)) {
      throw new AppError(409, 'CONFLICT', 'Completed IDP cannot be updated')
    }
    data.summary = summary
  }

  if (status !== undefined) {
    if (!canIdpTransition(existing.status as IdpStatus, status as IdpStatus, actorRoles as ReadonlyArray<Role>)) {
      throw new AppError(409, 'CONFLICT', `Cannot move IDP from ${existing.status} to ${status}`)
    }
    data.status = status
  }

  const row = await prisma.idp.update({ where: { id }, data })
  return toIdpDto(row)
}

export async function listIdps({
  prisma,
  tenantId,
  employeeId,
  quarter,
  status,
  scopedEmployeeIds,
}: {
  prisma: PrismaLike
  tenantId: string
  employeeId?: string
  quarter?: string
  status?: string
  scopedEmployeeIds?: string[]
}) {
  const rows = await prisma.idp.findMany({
    where: {
      tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(quarter ? { quarter } : {}),
      ...(status ? { status: status as IdpStatus } : {}),
      ...(scopedEmployeeIds ? { employeeId: { in: scopedEmployeeIds } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
  })
  return { items: rows.map((row) => toIdpDto(row)) }
}

export async function getIdpById({
  prisma,
  tenantId,
  id,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
}) {
  const row = await prisma.idp.findFirst({
    where: { id, tenantId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  })
  if (!row) throw new AppError(404, 'NOT_FOUND', 'IDP not found')
  return toIdpDto(row)
}

export async function createIdpItem({
  prisma,
  tenantId,
  idpId,
  title,
  description,
  dueDate,
}: {
  prisma: PrismaLike
  tenantId: string
  idpId: string
  title: string
  description?: string
  dueDate?: string
}) {
  const row = await prisma.idpItem.create({
    data: {
      tenantId,
      idpId,
      title,
      description: description ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: 'planned',
    },
  })
  return toIdpItemDto(row)
}

export async function patchIdpItem({
  prisma,
  tenantId,
  itemId,
  title,
  description,
  dueDate,
  status,
}: {
  prisma: PrismaLike
  tenantId: string
  itemId: string
  title?: string
  description?: string
  dueDate?: string
  status?: string
}) {
  const existing = await prisma.idpItem.findFirst({ where: { id: itemId, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP item not found')

  const data: Record<string, unknown> = {}
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (dueDate !== undefined) data.dueDate = new Date(dueDate)

  if (status !== undefined) {
    if (!canIdpItemTransition(existing.status as IdpItemStatus, status as IdpItemStatus)) {
      throw new AppError(409, 'CONFLICT', `Cannot move IDP item from ${existing.status} to ${status}`)
    }
    data.status = status
    if (status === 'completed' && !existing.completedAt) {
      data.completedAt = new Date()
    } else if (status !== 'completed') {
      data.completedAt = null
    }
  }

  const row = await prisma.idpItem.update({ where: { id: itemId }, data })
  return toIdpItemDto(row)
}

export async function deleteIdpItem({
  prisma,
  tenantId,
  itemId,
}: {
  prisma: PrismaLike
  tenantId: string
  itemId: string
}) {
  const existing = await prisma.idpItem.findFirst({ where: { id: itemId, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'IDP item not found')
  await prisma.idpItem.delete({ where: { id: itemId } })
  return { deleted: true as const, idpId: existing.idpId }
}
