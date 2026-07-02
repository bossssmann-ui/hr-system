import type { RoleName } from '../../generated/prisma/enums'
import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'
import { canReviewCycleTransition, canReviewRequestTransition, type ReviewCycleStatus, type ReviewRequestStatus } from './review.fsm'

type PrismaLike = Pick<DbClient, 'reviewCycle' | 'reviewRequest' | 'employee' | 'oneOnOne'>

type ReviewQuestion = {
  id: string
  prompt: string
  type?: 'rating' | 'text'
}

function toReviewQuestionArray(input: unknown): ReviewQuestion[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((question) => {
    if (!question || typeof question !== 'object') return []
    const candidate = question as { id?: unknown; prompt?: unknown; type?: unknown }
    if (typeof candidate.id !== 'string' || typeof candidate.prompt !== 'string') return []
    const type = candidate.type === 'rating' || candidate.type === 'text' ? candidate.type : undefined
    return [{ id: candidate.id, prompt: candidate.prompt, type }]
  })
}

function toReviewCycleDto(row: {
  id: string
  tenantId: string
  title: string
  quarter: string
  status: string
  questions: unknown
  openedAt: Date | null
  closesAt: Date | null
  closedAt: Date | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    quarter: row.quarter,
    status: row.status as ReviewCycleStatus,
    questions: toReviewQuestionArray(row.questions),
    openedAt: row.openedAt?.toISOString() ?? null,
    closesAt: row.closesAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toReviewRequestDto(row: {
  id: string
  tenantId: string
  cycleId: string
  subjectEmployeeId: string
  reviewerUserId: string
  relationship: string
  status: string
  response: unknown
  declineReason: string | null
  submittedAt: Date | null
  declinedAt: Date | null
  reminderSentAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    cycleId: row.cycleId,
    subjectEmployeeId: row.subjectEmployeeId,
    reviewerUserId: row.reviewerUserId,
    relationship: row.relationship,
    status: row.status as ReviewRequestStatus,
    response: row.response ?? null,
    declineReason: row.declineReason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function emptyStats() {
  return { total: 0, pending: 0, submitted: 0, declined: 0 }
}

async function buildCycleStats(prisma: PrismaLike, tenantId: string, cycleIds: string[]) {
  if (cycleIds.length === 0) return new Map<string, ReturnType<typeof emptyStats>>()

  const grouped = await prisma.reviewRequest.groupBy({
    by: ['cycleId', 'status'],
    where: { tenantId, cycleId: { in: cycleIds } },
    _count: { _all: true },
  })

  const result = new Map<string, ReturnType<typeof emptyStats>>()
  for (const cycleId of cycleIds) {
    result.set(cycleId, emptyStats())
  }

  for (const row of grouped) {
    const stats = result.get(row.cycleId)
    if (!stats) continue
    const count = row._count._all
    stats.total += count
    if (row.status === 'pending') stats.pending += count
    if (row.status === 'submitted') stats.submitted += count
    if (row.status === 'declined') stats.declined += count
  }

  return result
}

export async function createReviewCycle({
  prisma,
  tenantId,
  actorUserId,
  title,
  quarter,
  questions,
}: {
  prisma: PrismaLike
  tenantId: string
  actorUserId: string
  title: string
  quarter: string
  questions: unknown[]
}) {
  const row = await prisma.reviewCycle.create({
    data: {
      tenantId,
      title,
      quarter,
      status: 'draft',
      questions: questions as never,
      createdByUserId: actorUserId,
    },
  })

  return { ...toReviewCycleDto(row), stats: emptyStats() }
}

export async function patchReviewCycle({
  prisma,
  tenantId,
  id,
  title,
  quarter,
  questions,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  title?: string
  quarter?: string
  questions?: unknown[]
}) {
  const existing = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')
  if (existing.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', 'Only draft cycles can be updated')
  }

  const row = await prisma.reviewCycle.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(quarter !== undefined ? { quarter } : {}),
      ...(questions !== undefined ? { questions: questions as never } : {}),
    },
  })

  const stats = await buildCycleStats(prisma, tenantId, [id])
  return { ...toReviewCycleDto(row), stats: stats.get(id) ?? emptyStats() }
}

export async function openReviewCycle({
  prisma,
  tenantId,
  id,
  closesAt,
  actorRoles,
  now,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  closesAt: string
  actorRoles: ReadonlyArray<RoleName>
  now?: Date
}) {
  const existing = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')

  const canOpen = canReviewCycleTransition(existing.status as ReviewCycleStatus, 'open', actorRoles)
  if (!canOpen) {
    throw new AppError(409, 'CONFLICT', `Cannot move cycle from ${existing.status} to open`)
  }

  const nowDate = now ?? new Date()
  const closesAtDate = new Date(closesAt)
  if (closesAtDate <= nowDate) {
    throw new AppError(400, 'BAD_REQUEST', 'closesAt must be in the future')
  }

  const row = await prisma.reviewCycle.update({
    where: { id },
    data: {
      status: 'open',
      openedAt: nowDate,
      closesAt: closesAtDate,
      closedAt: null,
    },
  })

  const stats = await buildCycleStats(prisma, tenantId, [id])
  return { ...toReviewCycleDto(row), stats: stats.get(id) ?? emptyStats() }
}

export async function closeReviewCycle({
  prisma,
  tenantId,
  id,
  actorRoles,
  now,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorRoles: ReadonlyArray<RoleName>
  now?: Date
}) {
  const existing = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')

  const canClose = canReviewCycleTransition(existing.status as ReviewCycleStatus, 'closed', actorRoles)
  if (!canClose) {
    throw new AppError(409, 'CONFLICT', `Cannot move cycle from ${existing.status} to closed`)
  }

  const row = await prisma.reviewCycle.update({
    where: { id },
    data: {
      status: 'closed',
      closedAt: now ?? new Date(),
    },
  })

  const stats = await buildCycleStats(prisma, tenantId, [id])
  return { ...toReviewCycleDto(row), stats: stats.get(id) ?? emptyStats() }
}

export async function listReviewCycles({ prisma, tenantId }: { prisma: PrismaLike; tenantId: string }) {
  const rows = await prisma.reviewCycle.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })

  const statsByCycle = await buildCycleStats(
    prisma,
    tenantId,
    rows.map((row) => row.id),
  )

  return {
    items: rows.map((row) => ({
      ...toReviewCycleDto(row),
      stats: statsByCycle.get(row.id) ?? emptyStats(),
    })),
  }
}

export async function getReviewCycleById({
  prisma,
  tenantId,
  id,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
}) {
  const row = await prisma.reviewCycle.findFirst({ where: { id, tenantId } })
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')

  const stats = await buildCycleStats(prisma, tenantId, [id])
  return { ...toReviewCycleDto(row), stats: stats.get(id) ?? emptyStats() }
}

export async function fanOutReviewRequests({
  prisma,
  tenantId,
  cycleId,
  subjectEmployeeId,
  reviewers,
}: {
  prisma: PrismaLike
  tenantId: string
  cycleId: string
  subjectEmployeeId: string
  reviewers: Array<{ reviewerUserId: string; relationship: string }>
}) {
  const [cycle, employee] = await Promise.all([
    prisma.reviewCycle.findFirst({ where: { id: cycleId, tenantId } }),
    prisma.employee.findFirst({ where: { id: subjectEmployeeId, tenantId }, select: { id: true } }),
  ])

  if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')
  if (!employee) throw new AppError(404, 'NOT_FOUND', 'Subject employee not found')
  if (cycle.status !== 'open') {
    throw new AppError(409, 'CONFLICT', 'Review requests can only be created for open cycles')
  }

  const created = await prisma.reviewRequest.createMany({
    data: reviewers.map((reviewer) => ({
      tenantId,
      cycleId,
      subjectEmployeeId,
      reviewerUserId: reviewer.reviewerUserId,
      relationship: reviewer.relationship,
    })),
    skipDuplicates: true,
  })

  const total = await prisma.reviewRequest.count({
    where: { tenantId, cycleId, subjectEmployeeId },
  })

  return { created: created.count, total }
}

export async function listReviewRequestsForReviewer({
  prisma,
  tenantId,
  reviewerUserId,
  status,
}: {
  prisma: PrismaLike
  tenantId: string
  reviewerUserId: string
  status?: ReviewRequestStatus
}) {
  const rows = await prisma.reviewRequest.findMany({
    where: {
      tenantId,
      reviewerUserId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return { items: rows.map(toReviewRequestDto) }
}

export async function listReviewRequestsForSubject({
  prisma,
  tenantId,
  cycleId,
  subjectEmployeeId,
}: {
  prisma: PrismaLike
  tenantId: string
  cycleId: string
  subjectEmployeeId: string
}) {
  const rows = await prisma.reviewRequest.findMany({
    where: { tenantId, cycleId, subjectEmployeeId },
    orderBy: { createdAt: 'asc' },
  })

  return { items: rows.map(toReviewRequestDto) }
}

export async function submitReviewRequest({
  prisma,
  tenantId,
  id,
  actorUserId,
  response,
  now,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorUserId: string
  response: Record<string, string | number | null>
  now?: Date
}) {
  const existing = await prisma.reviewRequest.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review request not found')
  if (existing.reviewerUserId !== actorUserId) {
    throw new AppError(403, 'FORBIDDEN', 'Only assigned reviewer can submit this review')
  }

  const canSubmit = canReviewRequestTransition(existing.status as ReviewRequestStatus, 'submitted')
  if (!canSubmit) {
    throw new AppError(409, 'CONFLICT', 'Request already resolved')
  }

  const updated = await prisma.reviewRequest.update({
    where: { id },
    data: {
      status: 'submitted',
      response: response as never,
      submittedAt: now ?? new Date(),
      declineReason: null,
      declinedAt: null,
    },
  })

  return toReviewRequestDto(updated)
}

export async function declineReviewRequest({
  prisma,
  tenantId,
  id,
  actorUserId,
  reason,
  now,
}: {
  prisma: PrismaLike
  tenantId: string
  id: string
  actorUserId: string
  reason: string
  now?: Date
}) {
  const existing = await prisma.reviewRequest.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Review request not found')
  if (existing.reviewerUserId !== actorUserId) {
    throw new AppError(403, 'FORBIDDEN', 'Only assigned reviewer can decline this review')
  }

  const canDecline = canReviewRequestTransition(existing.status as ReviewRequestStatus, 'declined')
  if (!canDecline) {
    throw new AppError(409, 'CONFLICT', 'Request already resolved')
  }

  const updated = await prisma.reviewRequest.update({
    where: { id },
    data: {
      status: 'declined',
      declineReason: reason,
      declinedAt: now ?? new Date(),
    },
  })

  return toReviewRequestDto(updated)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function assertCanReadSubjectResults({
  prisma,
  tenantId,
  subjectEmployeeId,
  actorUserId,
  actorRoles,
}: {
  prisma: PrismaLike
  tenantId: string
  subjectEmployeeId: string
  actorUserId: string
  actorRoles: ReadonlyArray<RoleName>
}) {
  if (actorRoles.includes('hr_admin') || actorRoles.includes('owner')) {
    return
  }

  const managerMapping = await prisma.oneOnOne.findFirst({
    where: {
      tenantId,
      employeeId: subjectEmployeeId,
      managerUserId: actorUserId,
    },
    select: { id: true },
  })

  if (!managerMapping) {
    throw new AppError(403, 'FORBIDDEN', 'Not allowed to read aggregated review results')
  }
}

export async function getReviewSubjectResults({
  prisma,
  tenantId,
  cycleId,
  subjectEmployeeId,
  actorUserId,
  actorRoles,
}: {
  prisma: PrismaLike
  tenantId: string
  cycleId: string
  subjectEmployeeId: string
  actorUserId: string
  actorRoles: ReadonlyArray<RoleName>
}) {
  await assertCanReadSubjectResults({ prisma, tenantId, subjectEmployeeId, actorUserId, actorRoles })

  const [cycle, subject] = await Promise.all([
    prisma.reviewCycle.findFirst({ where: { id: cycleId, tenantId } }),
    prisma.employee.findFirst({ where: { id: subjectEmployeeId, tenantId }, select: { id: true } }),
  ])

  if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Review cycle not found')
  if (!subject) throw new AppError(404, 'NOT_FOUND', 'Subject employee not found')

  const requests = await prisma.reviewRequest.findMany({
    where: { tenantId, cycleId, subjectEmployeeId },
    orderBy: { createdAt: 'asc' },
  })

  const submitted = requests.filter((request) => request.status === 'submitted')
  const total = requests.length

  const byRelationshipMap = new Map<string, { submitted: number; total: number }>()
  for (const request of requests) {
    const current = byRelationshipMap.get(request.relationship) ?? { submitted: 0, total: 0 }
    current.total += 1
    if (request.status === 'submitted') current.submitted += 1
    byRelationshipMap.set(request.relationship, current)
  }

  const questions = toReviewQuestionArray(cycle.questions)
  const questionAggregates = questions.map((question) => {
    const values = submitted
      .map((request) => asRecord(request.response)?.[question.id])
      .filter((value) => value !== undefined)

    const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const textResponses = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    const numericAverage =
      numericValues.length > 0
        ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
        : null

    const type =
      numericValues.length > 0 && textResponses.length > 0
        ? 'mixed'
        : question.type === 'text' || textResponses.length > 0
          ? 'text'
          : 'rating'

    return {
      questionId: question.id,
      prompt: question.prompt,
      type,
      numericAverage,
      textResponses,
    }
  })

  return {
    cycleId,
    subjectEmployeeId,
    completion: {
      submitted: submitted.length,
      total,
      ratio: total === 0 ? 0 : submitted.length / total,
    },
    byRelationship: Array.from(byRelationshipMap.entries()).map(([relationship, stats]) => ({
      relationship,
      submitted: stats.submitted,
      total: stats.total,
    })),
    submissions: submitted.map((request) => ({
      requestId: request.id,
      reviewerUserId: request.reviewerUserId,
      relationship: request.relationship,
      response: request.response ?? {},
      submittedAt: request.submittedAt?.toISOString() ?? new Date(0).toISOString(),
    })),
    questionAggregates,
  }
}
