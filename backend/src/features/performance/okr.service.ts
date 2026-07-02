import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'
import type { Role } from '../requisitions/requisitions.fsm'
import {
  canOkrTransition,
  computeKeyResultRatio,
  computeOkrProgressPercent,
  isTerminalOkrStatus,
  keyResultStatusFromRatio,
  type KeyResultStatus,
  type OkrStatus,
} from './okr.fsm'

type PrismaLike = Pick<DbClient, 'okr' | 'keyResult' | 'employee' | 'oneOnOne'>

type OkrRow = {
  id: string
  tenantId: string
  employeeId: string
  parentOkrId: string | null
  quarter: string
  objective: string
  description: string | null
  status: string
  progressPercent: number
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

type KeyResultRow = {
  id: string
  okrId: string
  title: string
  unit: string | null
  startValue: number
  targetValue: number
  currentValue: number
  status: string
  createdAt: Date
  updatedAt: Date
}

function toKeyResultDto(row: KeyResultRow) {
  return {
    id: row.id,
    okrId: row.okrId,
    title: row.title,
    unit: row.unit,
    startValue: row.startValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    status: row.status as KeyResultStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toOkrDto(row: OkrRow & { keyResults?: KeyResultRow[] }) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    employeeId: row.employeeId,
    parentOkrId: row.parentOkrId,
    quarter: row.quarter,
    objective: row.objective,
    description: row.description,
    status: row.status as OkrStatus,
    progressPercent: row.progressPercent,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.keyResults ? { keyResults: row.keyResults.map(toKeyResultDto) } : {}),
  }
}

async function assertOkrCycleIsValid({
  prisma,
  tenantId,
  okrId,
  parentOkrId,
}: {
  prisma: PrismaLike
  tenantId: string
  okrId?: string
  parentOkrId: string | null | undefined
}) {
  if (parentOkrId == null) return
  if (okrId && okrId === parentOkrId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'OKR cannot be parent of itself')
  }

  let cursor: string | null = parentOkrId
  const visited = new Set<string>()

  while (cursor) {
    if (okrId && cursor === okrId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Alignment cycle is not allowed')
    }
    if (visited.has(cursor)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Alignment cycle is not allowed')
    }
    visited.add(cursor)

    const row: { parentOkrId: string | null } | null = await prisma.okr.findFirst({
      where: { id: cursor, tenantId },
      select: { parentOkrId: true },
    })
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Parent OKR not found')
    }
    cursor = row.parentOkrId
  }
}

async function recomputeOkrProgress(prisma: PrismaLike, okrId: string, tenantId: string) {
  const keyResults = await prisma.keyResult.findMany({
    where: { okrId, tenantId },
    select: { currentValue: true, startValue: true, targetValue: true },
  })
  const progressPercent = computeOkrProgressPercent(keyResults)
  await prisma.okr.update({ where: { id: okrId }, data: { progressPercent } })
  return progressPercent
}

export async function createOkr({
  prisma,
  tenantId,
  actorUserId,
  employeeId,
  quarter,
  objective,
  description,
  parentOkrId,
}: {
  prisma: PrismaLike
  tenantId: string
  actorUserId: string
  employeeId: string
  quarter: string
  objective: string
  description?: string
  parentOkrId?: string | null
}) {
  await assertOkrCycleIsValid({ prisma, tenantId, parentOkrId })
  const row = await prisma.okr.create({
    data: {
      tenantId,
      employeeId,
      quarter,
      objective,
      description,
      parentOkrId: parentOkrId ?? null,
      status: 'draft',
      createdByUserId: actorUserId,
    },
  })
  return toOkrDto(row)
}

export async function patchOkr({
  prisma,
  tenantId,
  id,
  objective,
  description,
  parentOkrId,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  objective?: string
  description?: string
  parentOkrId?: string | null
}) {
  const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')
  if (isTerminalOkrStatus(existing.status as OkrStatus)) {
    throw new AppError(409, 'CONFLICT', 'Terminal OKR cannot be updated')
  }

  if (parentOkrId !== undefined) {
    await assertOkrCycleIsValid({ prisma, tenantId, okrId: id, parentOkrId })
  }

  const row = await prisma.okr.update({
    where: { id },
    data: {
      ...(objective !== undefined ? { objective } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(parentOkrId !== undefined ? { parentOkrId } : {}),
    },
  })
  return toOkrDto(row)
}

export async function activateOkr({
  prisma,
  tenantId,
  id,
  actorRoles,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorRoles: ReadonlyArray<string>
}) {
  const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')
  if (!canOkrTransition(existing.status as OkrStatus, 'active', actorRoles as ReadonlyArray<Role>)) {
    throw new AppError(409, 'CONFLICT', `Cannot move OKR from ${existing.status} to active`)
  }

  const row = await prisma.okr.update({
    where: { id },
    data: { status: 'active' },
  })
  return toOkrDto(row)
}

export async function closeOkr({
  prisma,
  tenantId,
  id,
  actorRoles,
  finalStatus,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorRoles: ReadonlyArray<string>
  finalStatus?: 'achieved' | 'missed'
}) {
  const existing = await prisma.okr.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'OKR not found')

  const inferredStatus: 'achieved' | 'missed' = existing.progressPercent >= 100 ? 'achieved' : 'missed'
  const targetStatus = finalStatus ?? inferredStatus
  if (!canOkrTransition(existing.status as OkrStatus, targetStatus, actorRoles as ReadonlyArray<Role>)) {
    throw new AppError(409, 'CONFLICT', `Cannot move OKR from ${existing.status} to ${targetStatus}`)
  }

  const row = await prisma.okr.update({
    where: { id },
    data: { status: targetStatus },
  })
  return toOkrDto(row)
}

export async function listOkrs({
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
  status?: OkrStatus
  scopedEmployeeIds?: string[]
}) {
  const rows = await prisma.okr.findMany({
    where: {
      tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(quarter ? { quarter } : {}),
      ...(status ? { status } : {}),
      ...(scopedEmployeeIds ? { employeeId: { in: scopedEmployeeIds } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
  })
  return { items: rows.map((row) => toOkrDto(row)) }
}

export async function getOkrById({
  prisma,
  tenantId,
  id,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
}) {
  const row = await prisma.okr.findFirst({
    where: { id, tenantId },
    include: { keyResults: { orderBy: { createdAt: 'asc' } } },
  })
  if (!row) throw new AppError(404, 'NOT_FOUND', 'OKR not found')
  return toOkrDto(row)
}

export async function createKeyResult({
  prisma,
  tenantId,
  okrId,
  title,
  unit,
  startValue,
  targetValue,
}: {
  prisma: PrismaLike
  tenantId: string
  okrId: string
  title: string
  unit?: string
  startValue?: number
  targetValue: number
}) {
  const initialStartValue = startValue ?? 0
  const initialCurrentValue = initialStartValue
  const ratio = computeKeyResultRatio({
    startValue: initialStartValue,
    targetValue,
    currentValue: initialCurrentValue,
  })

  const row = await prisma.keyResult.create({
    data: {
      tenantId,
      okrId,
      title,
      unit,
      startValue: initialStartValue,
      targetValue,
      currentValue: initialCurrentValue,
      status: keyResultStatusFromRatio(ratio),
    },
  })
  await recomputeOkrProgress(prisma, okrId, tenantId)
  return toKeyResultDto(row)
}

export async function patchKeyResult({
  prisma,
  tenantId,
  krId,
  title,
  unit,
  targetValue,
  currentValue,
}: {
  prisma: PrismaLike
  tenantId: string
  krId: string
  title?: string
  unit?: string
  targetValue?: number
  currentValue?: number
}) {
  const existing = await prisma.keyResult.findFirst({
    where: { id: krId, tenantId },
    include: { okr: true },
  })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Key result not found')

  const nextStartValue = existing.startValue
  const nextTargetValue = targetValue ?? existing.targetValue
  const nextCurrentValue = currentValue ?? existing.currentValue
  const ratio = computeKeyResultRatio({
    startValue: nextStartValue,
    targetValue: nextTargetValue,
    currentValue: nextCurrentValue,
  })

  const row = await prisma.keyResult.update({
    where: { id: krId },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(targetValue !== undefined ? { targetValue } : {}),
      ...(currentValue !== undefined ? { currentValue } : {}),
      status: keyResultStatusFromRatio(ratio),
    },
  })

  const progressPercent = await recomputeOkrProgress(prisma, existing.okrId, tenantId)
  return { keyResult: toKeyResultDto(row), okrId: existing.okrId, progressPercent }
}

export async function deleteKeyResult({
  prisma,
  tenantId,
  krId,
}: {
  prisma: PrismaLike
  tenantId: string
  krId: string
}) {
  const existing = await prisma.keyResult.findFirst({
    where: { id: krId, tenantId },
    include: { okr: true },
  })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Key result not found')

  await prisma.keyResult.delete({ where: { id: krId } })
  await recomputeOkrProgress(prisma, existing.okrId, tenantId)
  return { deleted: true as const, okrId: existing.okrId }
}
