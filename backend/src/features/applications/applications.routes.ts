import type {
  Application,
  Candidate,
  CreateApplicationRequest,
  MoveApplicationStageRequest,
  ProcessCandidateQuestionnaireReplyRequest,
  RescoreAllApplicationsRequest,
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
  processCandidateQuestionnaireReplyRequestSchema,
  processCandidateQuestionnaireReplyResponseSchema,
  rescoreAllApplicationsRequestSchema,
  rescoreAllApplicationsResponseSchema,
  scoreFeedbackRequestSchema,
  sendCandidateQuestionnaireResponseSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

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
import {
  processCandidateQuestionnaireReply,
  sendCandidateQuestionnaire,
} from './candidate-questionnaire.service'

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
  trustFlagged: boolean
  externalIds: unknown
  createdAt: Date
  updatedAt: Date
}

function toDto(row: RawApplication, env: AppEnv): Application {
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

      return c.json(listApplicationsResponseSchema.parse({ items: rows.map((row) => toDto(row, env)) }))
    },
  )

  // ─── Mass re-score (must be registered before /:id routes) ─────────────────

  app.post(
    '/rescore-all',
    requireRole('owner', 'hr_admin'),
    zValidator('json', rescoreAllApplicationsRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body: RescoreAllApplicationsRequest = c.req.valid('json')

      const rows = await prisma.application.findMany({
        where: {
          tenantId,
          AND: [
            ...(body.vacancyId ? [{ vacancyId: body.vacancyId }] : []),
            ...(body.stage ? [{ stage: body.stage }] : []),
            { stage: { notIn: ['hired', 'rejected'] } },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      })

      let queued = 0
      let skipped = 0
      for (const row of rows) {
        try {
          const queueResult = await enqueueApplicationScoringJob({
            prisma,
            env,
            applicationId: row.id,
            actorUserId: userId,
            force: true,
          })
          if (queueResult.queued) queued += 1
          else skipped += 1
        } catch {
          skipped += 1
        }
      }

      c.set('auditEntry', {
        action: 'application.rescore_all_requested',
        entityType: 'Application',
        entityId: tenantId,
        diff: {
          queued,
          vacancyId: body.vacancyId ?? null,
          stage: body.stage ?? null,
        },
      })

      return c.json(rescoreAllApplicationsResponseSchema.parse({ queued, skipped }), 202)
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
          ...toDto(row, env),
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

      c.set('auditEntry', {
        action: 'application.create',
        entityType: 'Application',
        entityId: row.id,
        diff: body,
      })

      await enqueueApplicationScoringJob({
        prisma,
        env,
        applicationId: row.id,
        actorUserId: userId,
      })

      return c.json(applicationSchema.parse(toDto(row, env)), 201)
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

      return c.json(applicationSchema.parse(toDto(updated, env)))
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

  app.post(
    '/:id/send-questionnaire',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const result = await sendCandidateQuestionnaire({
        prisma,
        env,
        applicationId: id,
        actorUserId: userId,
      })

      c.set('auditEntry', {
        action: 'application.questionnaire_send_requested',
        entityType: 'Application',
        entityId: id,
        diff: { ok: result.ok, reason: result.ok ? undefined : result.reason },
      })

      return c.json(
        sendCandidateQuestionnaireResponseSchema.parse({
          sent: result.ok,
          reason: result.ok ? undefined : result.reason,
          messageId: result.messageId,
          questionCount: result.ok ? result.questionCount : undefined,
        }),
        result.ok ? 200 : 422,
      )
    },
  )

  app.post(
    '/:id/questionnaire-reply',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', processCandidateQuestionnaireReplyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body: ProcessCandidateQuestionnaireReplyRequest = c.req.valid('json')

      const row = await prisma.application.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const result = await processCandidateQuestionnaireReply({
        prisma,
        env,
        applicationId: id,
        fromEmail: body.fromEmail,
        body: body.body,
        externalId: body.externalId,
      })

      c.set('auditEntry', {
        action: 'application.questionnaire_reply_imported',
        entityType: 'Application',
        entityId: id,
        diff: { ok: result.ok, reason: result.ok ? undefined : result.reason },
      })

      const score = result.ok && 'scoring' in result && result.scoring?.status === 'scored' && result.scoring.result
        ? result.scoring.result.relevance_score
        : undefined

      return c.json(
        processCandidateQuestionnaireReplyResponseSchema.parse({
          processed: result.ok,
          duplicate: result.ok && 'duplicate' in result ? result.duplicate : undefined,
          reason: result.ok ? undefined : result.reason,
          messageId: result.ok ? result.messageId : undefined,
          score,
        }),
        result.ok ? 200 : 422,
      )
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

      return c.json(applicationSchema.parse(toDto(updated, env)))
    },
  )

  return app
}
