import type {
  Application,
  Candidate,
  CreateApplicationRequest,
  MoveApplicationStageRequest,
  ScoreFeedbackRequest,
  Vacancy,
} from '@web-app-demo/contracts'
import {
  generateInterviewQuestionsResponseSchema,
  applicationDetailSchema,
  aiScoreFeedbackSchema,
  aiScoringSchema,
  applicationSchema,
  applicationStageSchema,
  createApplicationRequestSchema,
  listApplicationsResponseSchema,
  moveApplicationStageRequestSchema,
  scoreFeedbackRequestSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { Prisma } from '../../generated/prisma/client'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { getRealtimeBus } from '../../services/realtime'
import { canTransition } from '../applications/applications.fsm'
import { generateInterviewQuestions } from '../assessments/assessments.service'
import { createFromApplication } from '../employees/employees.service'
import { enqueueApplicationScoringJob } from '../scoring/scoring.queue'
import { withScoringPresentation } from '../scoring/scoring.service'
import { computeUnifiedScore } from './application-score-aggregate'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

type RawApplication = {
  id: string
  tenantId: string
  candidateId: string
  vacancyId: string
  stage: string
  assignedToUserId: string | null
  notes: string | null
  aiScoring: unknown
  aiScoreFeedback: unknown
  aiInterviewQuestions: unknown
  aiScore: Prisma.Decimal | number | null
  aiVerdict: string | null
  aiAssessedAt: Date | null
  aiFlags: unknown
  trustFlagged: boolean
  externalIds: unknown
  createdAt: Date
  updatedAt: Date
}

type SelectionSummary = {
  totalWeightedScore: Prisma.Decimal | number | null
  retentionPrediction: Record<string, unknown> | null
  hrNotes: string | null
}

function toDto(
  row: RawApplication,
  env: AppEnv,
  extra: {
    selectionSummary: SelectionSummary | null
    trustScore: number | null
    selectionPipelineEnabled: boolean
  },
): Application {
  const unifiedScore = computeUnifiedScore({
    finalSelectionScore: extra.selectionSummary?.totalWeightedScore ?? null,
    preliminaryAiScore: row.aiScore,
  })
  const aiFlags = asNullableRecord(row.aiFlags)
  const fallbackRetention =
    aiFlags && typeof aiFlags['retentionPrediction'] === 'object' && aiFlags['retentionPrediction'] !== null
      ? (aiFlags['retentionPrediction'] as Record<string, unknown>)
      : null
  return {
    id: row.id,
    tenantId: row.tenantId,
    candidateId: row.candidateId,
    vacancyId: row.vacancyId,
    stage: row.stage as Application['stage'],
    assignedToUserId: row.assignedToUserId,
    notes: row.notes,
    aiScoring: aiScoringSchema.parse(withScoringPresentation(row.aiScoring, env)),
    aiScoreFeedback: aiScoreFeedbackSchema.nullable().parse(asNullableRecord(row.aiScoreFeedback)),
    aiInterviewQuestions: Array.isArray(row.aiInterviewQuestions) ? row.aiInterviewQuestions : null,
    aiScore: row.aiScore === null || row.aiScore === undefined ? null : Number(row.aiScore),
    aiVerdict: row.aiVerdict ?? null,
    aiAssessedAt: row.aiAssessedAt ? row.aiAssessedAt.toISOString() : null,
    aiFlags,
    unifiedScore,
    trustScore: extra.trustScore,
    retentionPrediction: extra.selectionSummary?.retentionPrediction ?? fallbackRetention,
    selectionHrNotes: extra.selectionSummary?.hrNotes ?? null,
    selectionPipelineEnabled: extra.selectionPipelineEnabled,
    trustFlagged: Boolean(row.trustFlagged),
    externalIds: asRecord(row.externalIds),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  return asRecord(value)
}

async function loadSelectionSummaryByApplicationIds(
  prisma: DbClient,
  tenantId: string,
  applicationIds: string[],
): Promise<Map<string, SelectionSummary>> {
  if (applicationIds.length === 0) return new Map()
  const sessions = await prisma.selectionSession.findMany({
    where: {
      tenantId,
      applicationId: { in: applicationIds },
      verdict: { isNot: null },
    },
    include: { verdict: true },
    orderBy: { createdAt: 'desc' },
  })
  const map = new Map<string, SelectionSummary>()
  for (const session of sessions) {
    if (!session.applicationId || !session.verdict || map.has(session.applicationId)) continue
    map.set(session.applicationId, {
      totalWeightedScore: session.verdict.totalWeightedScore,
      retentionPrediction: asNullableRecord(session.verdict.retentionPrediction),
      hrNotes: session.verdict.hrNotes ?? null,
    })
  }
  return map
}

async function loadTrustScoreByApplicationIds(
  prisma: DbClient,
  tenantId: string,
  applicationIds: string[],
): Promise<Map<string, number | null>> {
  if (applicationIds.length === 0) return new Map()
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      tenantId,
      applicationId: { in: applicationIds },
    },
    select: {
      applicationId: true,
      trustScore: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  const map = new Map<string, number | null>()
  for (const session of sessions) {
    if (!map.has(session.applicationId)) {
      map.set(session.applicationId, session.trustScore)
    }
  }
  return map
}

async function loadSelectionPipelineVacancyIds(
  prisma: DbClient,
  tenantId: string,
  vacancyIds: string[],
): Promise<Set<string>> {
  if (vacancyIds.length === 0) return new Set()
  const templates = await prisma.selectionTemplate.findMany({
    where: {
      tenantId,
      vacancyId: { in: vacancyIds },
    },
    select: { vacancyId: true },
  })
  return new Set(templates.map((item) => item.vacancyId))
}

export function createApplicationsRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── List ──────────────────────────────────────────────────────────────────

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator(
      'query',
      z.object({
        vacancy_id: z.string().optional(),
        stage: applicationStageSchema.optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const { vacancy_id, stage } = c.req.valid('query')

      const rows = await prisma.application.findMany({
        where: {
          tenantId,
          ...(vacancy_id ? { vacancyId: vacancy_id } : {}),
          ...(stage ? { stage } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })

      const applicationIds = rows.map((row) => row.id)
      const vacancyIds = Array.from(new Set(rows.map((row) => row.vacancyId)))
      const [selectionByApplicationId, trustByApplicationId, selectionVacancyIds] = await Promise.all([
        loadSelectionSummaryByApplicationIds(prisma, tenantId, applicationIds),
        loadTrustScoreByApplicationIds(prisma, tenantId, applicationIds),
        loadSelectionPipelineVacancyIds(prisma, tenantId, vacancyIds),
      ])

      return c.json(listApplicationsResponseSchema.parse({
        items: rows.map((row) =>
          toDto(row, env, {
            selectionSummary: selectionByApplicationId.get(row.id) ?? null,
            trustScore: trustByApplicationId.get(row.id) ?? null,
            selectionPipelineEnabled: selectionVacancyIds.has(row.vacancyId),
          })),
      }))
    },
  )

  // ─── Detail ────────────────────────────────────────────────────────────────

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.application.findFirst({
        where: { id, tenantId },
        include: {
          candidate: true,
          vacancy: true,
        },
      })

      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const [selectionByApplicationId, trustByApplicationId, selectionVacancyIds] = await Promise.all([
        loadSelectionSummaryByApplicationIds(prisma, tenantId, [row.id]),
        loadTrustScoreByApplicationIds(prisma, tenantId, [row.id]),
        loadSelectionPipelineVacancyIds(prisma, tenantId, [row.vacancyId]),
      ])

      const candidate: Candidate = {
        id: row.candidate.id,
        tenantId: row.candidate.tenantId,
        fullName: row.candidate.fullName,
        email: row.candidate.email,
        phone: row.candidate.phone,
        location: row.candidate.location,
        source: row.candidate.source as Candidate['source'],
        externalIds: asRecord(row.candidate.externalIds),
        consentContext: asNullableRecord(row.candidate.consentContext),
        createdAt: row.candidate.createdAt.toISOString(),
        updatedAt: row.candidate.updatedAt.toISOString(),
      }

      const vacancy: Vacancy = {
        id: row.vacancy.id,
        tenantId: row.vacancy.tenantId,
        title: row.vacancy.title,
        description: row.vacancy.description,
        isPublished: row.vacancy.isPublished,
        requisitionId: row.vacancy.requisitionId,
        orgUnitId: row.vacancy.orgUnitId,
        hhVacancyId: row.vacancy.hhVacancyId,
        createdAt: row.vacancy.createdAt.toISOString(),
        updatedAt: row.vacancy.updatedAt.toISOString(),
      }

      return c.json(
        applicationDetailSchema.parse({
          ...toDto(row, env, {
            selectionSummary: selectionByApplicationId.get(row.id) ?? null,
            trustScore: trustByApplicationId.get(row.id) ?? null,
            selectionPipelineEnabled: selectionVacancyIds.has(row.vacancyId),
          }),
          candidate,
          vacancy,
        }),
      )
    },
  )

  // ─── Create ────────────────────────────────────────────────────────────────

  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createApplicationRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body: CreateApplicationRequest = c.req.valid('json')

      // Verify candidate and vacancy belong to the tenant.
      const [candidate, vacancy] = await Promise.all([
        prisma.candidate.findFirst({ where: { id: body.candidateId, tenantId } }),
        prisma.vacancy.findFirst({ where: { id: body.vacancyId, tenantId } }),
      ])

      if (!candidate) throw new AppError(404, 'NOT_FOUND', 'Candidate not found')
      if (!vacancy) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')

      // Enforce unique (candidate_id, vacancy_id) constraint — catch at app level.
      const existing = await prisma.application.findFirst({
        where: { candidateId: body.candidateId, vacancyId: body.vacancyId },
      })
      if (existing) {
        return c.json(
          { error: { code: 'CONFLICT', message: 'Application already exists for this candidate and vacancy' } },
          409,
        )
      }

      const row = await prisma.application.create({
        data: {
          tenantId,
          candidateId: body.candidateId,
          vacancyId: body.vacancyId,
          stage: 'new',
        },
      })

      try {
        getRealtimeBus().publishToTenant(tenantId, {
          type: 'application.created',
          payload: {
            applicationId: row.id,
            candidateId: row.candidateId,
            vacancyId: row.vacancyId,
            source: 'manual',
          },
        })
      } catch {
        // realtime is best-effort
      }

      c.set('auditEntry', {
        action: 'application.create',
        entityType: 'Application',
        entityId: row.id,
        diff: body,
      })

      void enqueueApplicationScoringJob({
        prisma,
        env,
        applicationId: row.id,
        actorUserId: userId,
      })

      const [selectionByApplicationId, trustByApplicationId, selectionVacancyIds] = await Promise.all([
        loadSelectionSummaryByApplicationIds(prisma, tenantId, [row.id]),
        loadTrustScoreByApplicationIds(prisma, tenantId, [row.id]),
        loadSelectionPipelineVacancyIds(prisma, tenantId, [row.vacancyId]),
      ])
      return c.json(applicationSchema.parse(toDto(row, env, {
        selectionSummary: selectionByApplicationId.get(row.id) ?? null,
        trustScore: trustByApplicationId.get(row.id) ?? null,
        selectionPipelineEnabled: selectionVacancyIds.has(row.vacancyId),
      })), 201)
    },
  )

  // ─── Move stage ────────────────────────────────────────────────────────────

  app.patch(
    '/:id/stage',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('json', moveApplicationStageRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body: MoveApplicationStageRequest = c.req.valid('json')

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      if (!canTransition(row.stage, body.to, roles)) {
        return c.json(
          {
            error: {
              code: 'FSM_TRANSITION_DENIED',
              message: `Transition from '${row.stage}' to '${body.to}' is not allowed`,
              details: { from: row.stage, to: body.to },
            },
          },
          422,
        )
      }

      const updated = await prisma.$transaction(async (tx) => {
        const app = await tx.application.update({
          where: { id },
          data: { stage: body.to },
        })
        await tx.applicationStageEvent.create({
          data: {
            tenantId,
            applicationId: id,
            fromStage: row.stage,
            toStage: body.to,
            actorUserId: userId,
            comment: body.comment ?? null,
          },
        })
        if (body.to === 'hired') {
          await createFromApplication({
            prisma: tx as unknown as DbClient,
            applicationId: id,
            actorUserId: userId ?? undefined,
            tenantId,
          })
        }
        return app
      })

      c.set('auditEntry', {
        action: 'application.move_stage',
        entityType: 'Application',
        entityId: id,
        diff: { from: row.stage, to: body.to, comment: body.comment, actorUserId: userId },
      })

      // Realtime fan-out so every connected recruiter sees the Kanban update
      // without a manual refresh. Tenant-scoped — RLS already restricts which
      // applications a viewer can hydrate when they refetch the query.
      try {
        getRealtimeBus().publishToTenant(tenantId, {
          type: 'application.stage_changed',
          payload: {
            applicationId: id,
            vacancyId: row.vacancyId,
            from: row.stage,
            to: body.to,
            actorUserId: userId,
          },
        })
      } catch {
        // realtime is best-effort
      }

      const [selectionByApplicationId, trustByApplicationId, selectionVacancyIds] = await Promise.all([
        loadSelectionSummaryByApplicationIds(prisma, tenantId, [updated.id]),
        loadTrustScoreByApplicationIds(prisma, tenantId, [updated.id]),
        loadSelectionPipelineVacancyIds(prisma, tenantId, [updated.vacancyId]),
      ])
      return c.json(applicationSchema.parse(toDto(updated, env, {
        selectionSummary: selectionByApplicationId.get(updated.id) ?? null,
        trustScore: trustByApplicationId.get(updated.id) ?? null,
        selectionPipelineEnabled: selectionVacancyIds.has(updated.vacancyId),
      })))
    },
  )

  // ─── Re-score ───────────────────────────────────────────────────────────────

  app.post(
    '/:id/generate-questions',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const result = await generateInterviewQuestions({
        prisma,
        env,
        applicationId: id,
        actorUserId: userId,
      })
      if (!result.ok) {
        throw new AppError(503, 'INTERNAL_ERROR', 'AI question generation is not configured')
      }

      c.set('auditEntry', {
        action: 'application.questions_generated',
        entityType: 'Application',
        entityId: id,
        diff: { count: result.items.length },
      })

      return c.json(generateInterviewQuestionsResponseSchema.parse({ items: result.items }), 201)
    },
  )

  app.post(
    '/:id/rescore',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const queueResult = await enqueueApplicationScoringJob({
        prisma,
        env,
        applicationId: id,
        actorUserId: userId,
        force: true,
      })

      c.set('auditEntry', {
        action: 'application.rescore_requested',
        entityType: 'Application',
        entityId: id,
        diff: {
          queued: queueResult.queued,
          reason: 'reason' in queueResult ? queueResult.reason : null,
        },
      })

      return c.json(queueResult, 202)
    },
  )

  // ─── Score feedback ─────────────────────────────────────────────────────────

  app.post(
    '/:id/score-feedback',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', scoreFeedbackRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body: ScoreFeedbackRequest = c.req.valid('json')

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const feedback = {
        user_id: userId,
        agrees: body.agrees,
        note: body.note ?? null,
        created_at: new Date().toISOString(),
      }

      const updated = await prisma.application.update({
        where: { id },
        data: {
          aiScoreFeedback: feedback,
        },
      })

      c.set('auditEntry', {
        action: 'application.score_feedback',
        entityType: 'Application',
        entityId: id,
        diff: {
          agrees: feedback.agrees,
          has_note: Boolean(feedback.note),
        },
      })

      const [selectionByApplicationId, trustByApplicationId, selectionVacancyIds] = await Promise.all([
        loadSelectionSummaryByApplicationIds(prisma, tenantId, [updated.id]),
        loadTrustScoreByApplicationIds(prisma, tenantId, [updated.id]),
        loadSelectionPipelineVacancyIds(prisma, tenantId, [updated.vacancyId]),
      ])
      return c.json(applicationSchema.parse(toDto(updated, env, {
        selectionSummary: selectionByApplicationId.get(updated.id) ?? null,
        trustScore: trustByApplicationId.get(updated.id) ?? null,
        selectionPipelineEnabled: selectionVacancyIds.has(updated.vacancyId),
      })))
    },
  )

  return app
}
