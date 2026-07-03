/**
 * Engagement service — Horizon 8 eNPS / Engagement Surveys.
 *
 * Encapsulates:
 *  - CRUD for EngagementSurvey (create, patch, list, get)
 *  - FSM transitions: draft → open → closed
 *  - Response submission with idempotency guard
 *  - eNPS / pulse aggregate calculation (promoters 9–10, passives 7–8, detractors 0–6)
 */

import type { DbClient } from '../../db'
import { AppError } from '../../http/errors'

// ─── Types ────────────────────────────────────────────────────────────────────

type PrismaLike = Pick<DbClient, 'engagementSurvey' | 'surveyResponse' | 'employee'>

export type EngagementSurveyStatus = 'draft' | 'open' | 'closed'
export type EngagementSurveyKind = 'enps' | 'pulse'

// ─── eNPS calculation ────────────────────────────────────────────────────────

export type EnpsAggregate = {
  score: number
  promoters: number
  passives: number
  detractors: number
  responded: number
  total: number
  distribution: Record<string, number>
}

/**
 * Pure function — compute eNPS aggregate from a list of scores (0–10).
 * Promoters: 9–10, Passives: 7–8, Detractors: 0–6.
 * eNPS = round(%promoters − %detractors). Range −100..+100.
 */
export function computeEnps(scores: number[], total?: number): EnpsAggregate {
  const responded = scores.length
  const resolvedTotal = total ?? responded

  const distribution: Record<string, number> = {}
  for (let i = 0; i <= 10; i++) {
    distribution[String(i)] = 0
  }

  let promoters = 0
  let passives = 0
  let detractors = 0

  for (const s of scores) {
    distribution[String(s)] = (distribution[String(s)] ?? 0) + 1
    if (s >= 9) promoters++
    else if (s >= 7) passives++
    else detractors++
  }

  let enpsScore = 0
  if (responded > 0) {
    const pctPromoters = (promoters / responded) * 100
    const pctDetractors = (detractors / responded) * 100
    enpsScore = Math.round(pctPromoters - pctDetractors)
  }

  return { score: enpsScore, promoters, passives, detractors, responded, total: resolvedTotal, distribution }
}

// ─── toDto ────────────────────────────────────────────────────────────────────

function toSurveyDto(row: {
  id: string
  tenantId: string
  title: string
  kind: string
  status: string
  question: string
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
    kind: row.kind as EngagementSurveyKind,
    status: row.status as EngagementSurveyStatus,
    question: row.question,
    openedAt: row.openedAt?.toISOString() ?? null,
    closesAt: row.closesAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ─── createSurvey ─────────────────────────────────────────────────────────────

export type CreateSurveyInput = {
  prisma: PrismaLike
  tenantId: string
  actorUserId: string
  title: string
  kind: EngagementSurveyKind
  question: string
  closesAt?: string
}

export async function createSurvey(input: CreateSurveyInput) {
  const { prisma, tenantId, actorUserId, title, kind, question, closesAt } = input

  const survey = await prisma.engagementSurvey.create({
    data: {
      tenantId,
      title,
      kind,
      question,
      closesAt: closesAt ? new Date(closesAt) : null,
      createdByUserId: actorUserId,
    },
  })

  return toSurveyDto(survey)
}

// ─── patchSurvey ──────────────────────────────────────────────────────────────

export type PatchSurveyInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  title?: string
  question?: string
  closesAt?: string | null
}

export async function patchSurvey(input: PatchSurveyInput) {
  const { prisma, tenantId, id, title, question, closesAt } = input

  const existing = await prisma.engagementSurvey.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Survey not found')
  if (existing.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', 'Only draft surveys can be updated')
  }

  const survey = await prisma.engagementSurvey.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(question !== undefined ? { question } : {}),
      ...(closesAt !== undefined ? { closesAt: closesAt ? new Date(closesAt) : null } : {}),
    },
  })

  return toSurveyDto(survey)
}

// ─── openSurvey ───────────────────────────────────────────────────────────────

export type OpenSurveyInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  now?: Date
}

export async function openSurvey(input: OpenSurveyInput) {
  const { prisma, tenantId, id, now } = input

  const existing = await prisma.engagementSurvey.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Survey not found')
  if (existing.status !== 'draft') {
    throw new AppError(409, 'CONFLICT', `Cannot move survey from ${existing.status} to open`)
  }

  const survey = await prisma.engagementSurvey.update({
    where: { id },
    data: { status: 'open', openedAt: now ?? new Date() },
  })

  return toSurveyDto(survey)
}

// ─── closeSurvey ──────────────────────────────────────────────────────────────

export type CloseSurveyInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
  now?: Date
}

export async function closeSurvey(input: CloseSurveyInput) {
  const { prisma, tenantId, id, now } = input

  const existing = await prisma.engagementSurvey.findFirst({ where: { id, tenantId } })
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Survey not found')
  if (existing.status !== 'open') {
    throw new AppError(409, 'CONFLICT', `Cannot move survey from ${existing.status} to closed`)
  }

  const survey = await prisma.engagementSurvey.update({
    where: { id },
    data: { status: 'closed', closedAt: now ?? new Date() },
  })

  return toSurveyDto(survey)
}

// ─── listSurveys ──────────────────────────────────────────────────────────────

export type ListSurveysInput = {
  prisma: PrismaLike
  tenantId: string
  status?: EngagementSurveyStatus
  kind?: EngagementSurveyKind
}

export async function listSurveys(input: ListSurveysInput) {
  const { prisma, tenantId, status, kind } = input

  const rows = await prisma.engagementSurvey.findMany({
    where: {
      tenantId,
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return rows.map(toSurveyDto)
}

// ─── getSurvey ────────────────────────────────────────────────────────────────

export type GetSurveyInput = {
  prisma: PrismaLike
  tenantId: string
  id: string
}

export async function getSurvey(input: GetSurveyInput) {
  const { prisma, tenantId, id } = input

  const survey = await prisma.engagementSurvey.findFirst({ where: { id, tenantId } })
  if (!survey) throw new AppError(404, 'NOT_FOUND', 'Survey not found')

  const responded = await prisma.surveyResponse.count({ where: { surveyId: id, tenantId } })
  const total = await prisma.employee.count({ where: { tenantId, status: { in: ['active', 'probation'] } } })

  return { ...toSurveyDto(survey), responded, total }
}

// ─── submitResponse ───────────────────────────────────────────────────────────

export type SubmitResponseInput = {
  prisma: PrismaLike
  tenantId: string
  surveyId: string
  respondentEmployeeId: string
  score: number
  comment?: string
}

export async function submitResponse(input: SubmitResponseInput) {
  const { prisma, tenantId, surveyId, respondentEmployeeId, score, comment } = input

  const survey = await prisma.engagementSurvey.findFirst({ where: { id: surveyId, tenantId } })
  if (!survey) throw new AppError(404, 'NOT_FOUND', 'Survey not found')
  if (survey.status !== 'open') {
    throw new AppError(409, 'CONFLICT', 'Responses can only be submitted for open surveys')
  }

  const existing = await prisma.surveyResponse.findFirst({
    where: { surveyId, respondentEmployeeId },
  })
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Employee has already submitted a response for this survey')
  }

  const response = await prisma.surveyResponse.create({
    data: {
      tenantId,
      surveyId,
      respondentEmployeeId,
      score,
      comment: comment ?? null,
    },
  })

  return {
    id: response.id,
    tenantId: response.tenantId,
    surveyId: response.surveyId,
    respondentEmployeeId: response.respondentEmployeeId,
    score: response.score,
    comment: response.comment,
    submittedAt: response.submittedAt.toISOString(),
  }
}

// ─── getSurveyResults ─────────────────────────────────────────────────────────

export type GetSurveyResultsInput = {
  prisma: PrismaLike
  tenantId: string
  surveyId: string
}

export async function getSurveyResults(input: GetSurveyResultsInput) {
  const { prisma, tenantId, surveyId } = input

  const survey = await prisma.engagementSurvey.findFirst({ where: { id: surveyId, tenantId } })
  if (!survey) throw new AppError(404, 'NOT_FOUND', 'Survey not found')

  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId, tenantId },
    select: { score: true, comment: true },
  })

  const total = await prisma.employee.count({ where: { tenantId, status: { in: ['active', 'probation'] } } })
  const scores = responses.map((r) => r.score)
  const aggregate = computeEnps(scores, total)

  // Comments without employee attribution (privacy requirement)
  const comments = responses.filter((r) => r.comment).map((r) => r.comment as string)

  return { ...aggregate, comments }
}
