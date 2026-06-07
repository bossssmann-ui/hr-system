/**
 * Phase 2 — Automated Selection System (Onboardix 4-stage screening).
 *
 * Routes:
 *   POST   /api/selection/sessions               — create session (HR auth)
 *   GET    /api/selection/sessions/:token        — get current stage (public)
 *   POST   /api/selection/sessions/:token/stage/:n — submit stage (public)
 *   GET    /api/selection/sessions/:id/verdict   — get verdict (HR auth)
 *   GET    /api/selection/admin                  — list all sessions (HR auth)
 *
 * Feature flag: ASSESSMENT_SYSTEM_ENABLED (default: false)
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '../../generated/prisma/client'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  enqueueSelectionEvaluate,
  computeCrossCheckFlags,
  shouldAutoRejectAfterStage1,
  type CrossCheckFlag,
} from './selection.queue'
import {
  getAllStagesContent,
  scoreStage2,
  type Role,
  type StageContent,
} from './stage-content'
import { isDomesticRole, type SupportedRole } from './selection-role-adapter'
import { finalizeDomesticStage4, scoreDomesticStage2 } from './domestic-stage-scoring'
import type { SpecializationAssignment } from './domestic-specializations'
import { createSelectionSession } from './selection-session.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    tenantId: string
    auditEntry?: unknown
  }
}

const createSessionSchema = z.object({
  vacancyId: z.string().uuid(),
  applicationId: z.string().uuid().optional(),
  role: z.enum(['logist', 'sales_manager', 'logist_domestic']),
})

const submitStageSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
})

const adminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  vacancyId: z.string().uuid().optional(),
  role: z.enum(['logist', 'sales_manager', 'logist_domestic']).optional(),
})

function stageNumberForStatus(status: string): number | null {
  const map: Record<string, number> = {
    stage_1: 1,
    stage_2: 2,
    stage_3: 3,
    stage_4: 4,
  }
  return map[status] ?? null
}

function asCrossCheckFlags(raw: unknown): CrossCheckFlag[] {
  if (!Array.isArray(raw)) return []
  return raw as CrossCheckFlag[]
}

export function createSelectionRoutes() {
  const app = new Hono<RouteBindings>()

  // Feature flag guard — single check for all routes in this router
  app.use('*', async (c, next) => {
    const env = c.get('env')
    if (!env.ASSESSMENT_SYSTEM_ENABLED) {
      return c.json({ error: 'Not found' }, 404)
    }
    await next()
  })

  // ─── POST /api/selection/sessions — create session (HR) ───────────────────
  app.post(
    '/sessions',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createSessionSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const body = c.req.valid('json')

      const { session } = await createSelectionSession({
        prisma,
        tenantId,
        vacancyId: body.vacancyId,
        role: body.role as SupportedRole,
        applicationId: body.applicationId ?? null,
      })

      c.set('auditEntry', {
        action: 'selection_session.create',
        entityType: 'SelectionSession',
        entityId: session.id,
        diff: { vacancyId: body.vacancyId, role: body.role, applicationId: body.applicationId },
      })

      return c.json(
        {
          sessionId: session.id,
          token: session.token,
          assessmentUrl: `/selection/${session.token}`,
        },
        201,
      )
    },
  )

  // ─── GET /api/selection/sessions/:token — current stage (public) ──────────
  app.get('/sessions/:token', async (c) => {
    const prisma = c.get('prisma')
    const { token } = c.req.param()

    const session = await prisma.selectionSession.findUnique({
      where: { token },
      include: { template: true },
    })

    if (!session) throw new AppError(404, 'NOT_FOUND', 'Selection session not found')

    // Check expiry
    if (session.expiresAt && session.expiresAt < new Date()) {
      await prisma.selectionSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      })
      throw new AppError(410, 'BAD_REQUEST', 'Session has expired')
    }

    if (['completed', 'rejected', 'expired'].includes(session.status)) {
      return c.json({ status: session.status, message: 'Session is no longer active' })
    }

    // Auto-transition pending → stage_1 (non-domestic only).
    // Domestic logist flow is pending → (POST /resume) → resume_parsed → … ,
    // so the candidate page renders ResumeStep while status is still 'pending'.
    // Auto-promoting domestic sessions here would skip ResumeStep entirely
    // (no specializations yet → empty stages → "Selection complete").
    let status = session.status
    let startedAt = session.startedAt
    if (status === 'pending' && !isDomesticRole(session.template.role ?? '')) {
      status = 'stage_1'
      startedAt = new Date()
      await prisma.selectionSession.update({
        where: { id: session.id },
        data: { status, startedAt },
      })
    }

    // Auto-transition packages_assigned → stage_1 (domestic logist: specializations assigned)
    if (status === 'packages_assigned' && isDomesticRole(session.template.role ?? '')) {
      status = 'stage_1'
      startedAt = startedAt ?? new Date()
      await prisma.selectionSession.update({
        where: { id: session.id },
        data: { status, startedAt },
      })
    }

    const stageNum = stageNumberForStatus(status)

    // For domestic role: build stages dynamically from assigned specializations
    // instead of the static template stages.
    let stages: StageContent[]
    if (isDomesticRole(session.template.role ?? '') && Array.isArray(session.specializations) && (session.specializations as unknown[]).length > 0) {
      const { buildDomesticStages } = await import('./domestic-stage-content')
      stages = buildDomesticStages(
        session.specializations as unknown as import('./domestic-specializations').SpecializationAssignment[],
      )
    } else {
      stages = Array.isArray(session.template.stages)
        ? (session.template.stages as unknown as StageContent[])
        : []
    }
    let currentStage: StageContent | null =
      stageNum !== null ? stages[stageNum - 1] ?? null : null

    return c.json({
      sessionId: session.id,
      status,
      role: session.template.role,
      currentStage: stageNum,
      stageData: currentStage,
      startedAt: startedAt?.toISOString() ?? null,
    })
  })

  // ─── POST /api/selection/sessions/:token/stage/:n — submit stage (public) ─
  app.post(
    '/sessions/:token/stage/:n',
    zValidator('json', submitStageSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const { token } = c.req.param()
      const n = Number(c.req.param('n'))
      const body = c.req.valid('json')

      if (![1, 2, 3, 4].includes(n)) {
        throw new AppError(400, 'BAD_REQUEST', 'Stage number must be 1, 2, 3, or 4')
      }

      const session = await prisma.selectionSession.findUnique({
        where: { token },
        include: { template: true, stageResults: true },
      })

      if (!session) throw new AppError(404, 'NOT_FOUND', 'Selection session not found')

      if (session.expiresAt && session.expiresAt < new Date()) {
        await prisma.selectionSession.update({
          where: { id: session.id },
          data: { status: 'expired' },
        })
        throw new AppError(410, 'BAD_REQUEST', 'Session has expired')
      }

      const expectedStatus = `stage_${n}`
      if (session.status !== expectedStatus) {
        throw new AppError(
          409,
          'CONFLICT',
          `Cannot submit stage ${n}: session is in status '${session.status}'`,
        )
      }

      // Stage 2 time validation (≤ 30 minutes)
      if (n === 2 && session.startedAt) {
        const elapsedMs = Date.now() - session.startedAt.getTime()
        if (elapsedMs > 30 * 60 * 1000) {
          await prisma.selectionSession.update({
            where: { id: session.id },
            data: { status: 'expired' },
          })
          throw new AppError(422, 'BAD_REQUEST', 'Stage 2 time limit of 30 minutes exceeded')
        }
      }

      // Compute cross-check flags from answers
      const previousResults = session.stageResults
      const flags: CrossCheckFlag[] = computeCrossCheckFlags(
        n,
        body.answers as Record<string, unknown>,
        session.template.role as 'logist' | 'sales_manager' | 'logist_domestic',
        previousResults.map((r) => ({
          stageNumber: r.stageNumber,
          answers: r.answers as Record<string, unknown>,
          flags: asCrossCheckFlags(r.flags),
        })),
      )

      // Save stage result. For Stage 2 we auto-score radio questions
      // server-side so the AI evaluator and HR dashboard always have a
      // deterministic baseline score for the test (open questions are
      // scored by the AI downstream).
      let scoresJson: Prisma.InputJsonValue | undefined
      if (n === 2) {
        if (isDomesticRole(session.template.role ?? '')) {
          const specs = Array.isArray(session.specializations)
            ? (session.specializations as unknown as SpecializationAssignment[])
            : []
          const moduleResults = scoreDomesticStage2(
            specs,
            body.answers as Record<string, unknown>,
          )
          scoresJson = { moduleResults } as unknown as Prisma.InputJsonValue
        } else {
          const result = scoreStage2(
            session.template.role as Role,
            body.answers as Record<string, unknown>,
          )
          scoresJson = {
            autoScore: result.autoScore,
            autoMax: result.autoMax,
            stageMax: result.stageMax,
            perQuestion: result.perQuestion,
          } as Prisma.InputJsonValue
        }
      }

      await prisma.selectionStageResult.create({
        data: {
          sessionId: session.id,
          stageNumber: n,
          answers: body.answers as Prisma.InputJsonValue,
          flags: flags as unknown as Prisma.InputJsonValue,
          ...(scoresJson !== undefined ? { scores: scoresJson } : {}),
        },
      })

      // Stage 1 auto-rejection (Phase 14 §6 / §11): 2+ RED flags or any
      // stop-criterion cause an immediate rejection WITHOUT calling the AI
      // evaluator. We persist a deterministic verdict so HR still sees why.
      if (n === 1 && shouldAutoRejectAfterStage1(flags)) {
        const verdictReason =
          'Автоматический отказ на Этапе 1: сработал стоп-критерий или 2+ КРАСНЫХ флага cross-check. AI-оценщик не вызывался.'
        const hrNotes = 'Решение вынесено детерминированно без обращения к AI-оценщику.'
        const stageScores = { stage_2_score: 0, stage_3_score: 0, stage_4_score: 0 } as Prisma.InputJsonValue
        await prisma.selectionSession.update({
          where: { id: session.id },
          data: { status: 'rejected', completedAt: new Date() },
        })
        await prisma.selectionVerdict.upsert({
          where: { sessionId: session.id },
          update: {
            verdict: 'ОТКЛОНИТЬ',
            totalWeightedScore: new Prisma.Decimal(0),
            stageScores,
            crossCheckFlags: flags as unknown as Prisma.InputJsonValue,
            retentionPrediction: Prisma.JsonNull,
            lieScaleResult: Prisma.JsonNull,
            verdictReason,
            hrNotes,
          },
          create: {
            sessionId: session.id,
            verdict: 'ОТКЛОНИТЬ',
            totalWeightedScore: new Prisma.Decimal(0),
            stageScores,
            crossCheckFlags: flags as unknown as Prisma.InputJsonValue,
            retentionPrediction: Prisma.JsonNull,
            lieScaleResult: Prisma.JsonNull,
            verdictReason,
            hrNotes,
          },
        })
        return c.json({ submitted: true, nextStatus: 'rejected', autoRejected: true })
      }

      // Determine next status
      let nextSt = n < 4 ? `stage_${n + 1}` : 'completed'
      const updateData: Prisma.SelectionSessionUpdateInput = { status: nextSt }
      if (n === 4) {
        updateData.completedAt = new Date()
      }
      // Reset startedAt for each new stage to track per-stage timing
      if (n < 4) {
        updateData.startedAt = new Date()
      }

      await prisma.selectionSession.update({
        where: { id: session.id },
        data: updateData,
      })

      // After Stage 4 for `logist_domestic`: deterministic auto-scoring &
      // verdict (Phase 17). The AI evaluator still runs afterwards but only
      // appends a second opinion; it does not overwrite the deterministic
      // numbers/verdict.
      let autoScored = false
      if (n === 4 && isDomesticRole(session.template.role ?? '')) {
        const computation = await finalizeDomesticStage4(prisma, session.id, c.get('env'))
        if (computation) {
          autoScored = true
          nextSt = computation.status
          await prisma.selectionSession.update({
            where: { id: session.id },
            data: { status: nextSt },
          })
        }
      }

      // After stage 4: enqueue AI evaluation
      if (n === 4) {
        const env = c.get('env')
        void enqueueSelectionEvaluate({ prisma, env, sessionId: session.id })
      }

      return c.json({
        submitted: true,
        nextStatus: nextSt,
        ...(autoScored ? { autoScored: true } : {}),
      })
    },
  )

  // ─── GET /api/selection/sessions/:id/verdict — verdict (HR) ───────────────
  app.get(
    '/sessions/:id/verdict',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const session = await prisma.selectionSession.findFirst({
        where: { id, tenantId },
        include: { verdict: true, template: true },
      })

      if (!session) throw new AppError(404, 'NOT_FOUND', 'Selection session not found')

      if (!session.verdict) {
        return c.json({ status: session.status, verdict: null }, 200)
      }

      return c.json({
        sessionId: session.id,
        status: session.status,
        role: session.template.role,
        verdict: session.verdict.verdict,
        totalWeightedScore: session.verdict.totalWeightedScore?.toString() ?? null,
        stageScores: session.verdict.stageScores,
        crossCheckFlags: session.verdict.crossCheckFlags,
        retentionPrediction: session.verdict.retentionPrediction,
        lieScaleResult: session.verdict.lieScaleResult,
        verdictReason: session.verdict.verdictReason,
        hrNotes: session.verdict.hrNotes,
        createdAt: session.verdict.createdAt.toISOString(),
      })
    },
  )

  // ─── GET /api/selection/admin — list all sessions (HR) ────────────────────
  app.get(
    '/admin',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', adminQuerySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const query = c.req.valid('query')

      const templateFilter: Prisma.SelectionTemplateWhereInput = {}
      if (query.vacancyId) {
        templateFilter.vacancyId = query.vacancyId
      }
      if (query.role) {
        templateFilter.role = query.role
      }

      const where: Prisma.SelectionSessionWhereInput = { tenantId }
      if (query.vacancyId || query.role) {
        where.template = templateFilter
      }

      const [total, sessions] = await Promise.all([
        prisma.selectionSession.count({ where }),
        prisma.selectionSession.findMany({
          where,
          include: {
            template: true,
            verdict: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ])

      return c.json({
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: sessions.map((s) => ({
          id: s.id,
          token: s.token,
          status: s.status,
          role: s.template.role,
          vacancyId: s.template.vacancyId,
          applicationId: s.applicationId,
          startedAt: s.startedAt?.toISOString() ?? null,
          completedAt: s.completedAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          verdict: s.verdict
            ? {
                verdict: s.verdict.verdict,
                totalWeightedScore: s.verdict.totalWeightedScore?.toString() ?? null,
                crossCheckFlags: s.verdict.crossCheckFlags,
                retentionPrediction: s.verdict.retentionPrediction,
                createdAt: s.verdict.createdAt.toISOString(),
              }
            : null,
          specializations: s.specializations ?? null,
          assessmentProfile: s.assessmentProfile ?? null,
        })),
      })
    },
  )


  // ─── POST /api/selection/sessions/:token/resume — parse resume (domestic only) ──
  app.post('/sessions/:token/resume', async (c) => {
    const env = c.env as AppEnv
    if (!env.ASSESSMENT_SYSTEM_ENABLED) return c.json({ error: 'Not found' }, 404)

    const prisma = c.get('prisma')
    const { token } = c.req.param()
    const body = await c.req.json().catch(() => null)
    if (!body?.resumeText || typeof body.resumeText !== 'string') {
      return c.json({ error: 'resumeText required' }, 400)
    }

    const session = await prisma.selectionSession.findUnique({
      where: { token },
      include: { template: true },
    })
    if (!session) return c.json({ error: 'Not found' }, 404)
    if (session.template?.role !== 'logist_domestic') {
      return c.json({ error: 'Not applicable for this role' }, 400)
    }
    if (session.status !== 'pending') {
      return c.json({ error: 'Resume already submitted' }, 400)
    }

    if (!env.GEMINI_API_KEY) return c.json({ error: 'AI unavailable' }, 503)

    const { parseResume } = await import('./domestic-resume-parser')
    const { selectSpecializations } = await import('./domestic-specializations')

    const parsed = await parseResume(body.resumeText, env.GEMINI_API_KEY)
    const specializations = selectSpecializations(parsed.signals)

    await prisma.selectionSession.update({
      where: { id: session.id },
      data: {
        status: 'resume_parsed',
        specializations: specializations as unknown as Prisma.InputJsonValue,
        assessmentProfile: {
          signals: parsed.signals,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    return c.json({ signals: parsed.signals, specializations })
  })

  // ─── GET /api/selection/sessions/:token/interview — get interview questions ──
  app.get('/sessions/:token/interview', async (c) => {
    const env = c.env as AppEnv
    if (!env.ASSESSMENT_SYSTEM_ENABLED) return c.json({ error: 'Not found' }, 404)

    const prisma = c.get('prisma')
    const { token } = c.req.param()
    const session = await prisma.selectionSession.findUnique({ where: { token }, include: { template: true } })
    if (!session) return c.json({ error: 'Not found' }, 404)
    if (session.template?.role !== 'logist_domestic') {
      return c.json({ error: 'Not applicable for this role' }, 400)
    }
    if (session.status !== 'resume_parsed') {
      return c.json({ error: 'Resume must be submitted first' }, 400)
    }

    const { buildInterviewQuestions } = await import('./domestic-interview')
    const specs = Array.isArray(session.specializations)
      ? (session.specializations as unknown as import('./domestic-specializations').SpecializationAssignment[])
      : []

    const questions = buildInterviewQuestions(specs)
    return c.json({ questions })
  })

  // ─── POST /api/selection/sessions/:token/interview — submit interview answers ──
  app.post('/sessions/:token/interview', async (c) => {
    const env = c.env as AppEnv
    if (!env.ASSESSMENT_SYSTEM_ENABLED) return c.json({ error: 'Not found' }, 404)

    const prisma = c.get('prisma')
    const { token } = c.req.param()
    const body = await c.req.json().catch(() => null)
    if (!body?.answers || typeof body.answers !== 'object') {
      return c.json({ error: 'answers required' }, 400)
    }

    const session = await prisma.selectionSession.findUnique({ where: { token }, include: { template: true } })
    if (!session) return c.json({ error: 'Not found' }, 404)
    if (session.template?.role !== 'logist_domestic') {
      return c.json({ error: 'Not applicable for this role' }, 400)
    }
    if (session.status !== 'resume_parsed') {
      return c.json({ error: 'Resume must be submitted first' }, 400)
    }

    if (!env.GEMINI_API_KEY) return c.json({ error: 'AI unavailable' }, 503)

    const { classifyInterviewAnswers } = await import('./domestic-interview')
    const { createCapacityGuard } = await import('./capacity-guard')
    const guard = createCapacityGuard()

    if (!guard.canStart()) {
      return c.json({
        error: 'AI interview capacity reached',
        retryAfterMinutes: guard.getNextSlotMinutes(),
      }, 503)
    }

    const specs = Array.isArray(session.specializations)
      ? (session.specializations as unknown as import('./domestic-specializations').SpecializationAssignment[])
      : []

    guard.register(session.id)
    let classification
    try {
      classification = await classifyInterviewAnswers(specs, body.answers, env.GEMINI_API_KEY)
    } finally {
      guard.release(session.id)
    }

    await prisma.selectionSession.update({
      where: { id: session.id },
      data: {
        status: 'packages_assigned',
        specializations: classification.specializations as unknown as Prisma.InputJsonValue,
        assessmentProfile: {
          ...(session.assessmentProfile as object ?? {}),
          riskFlags: classification.riskFlags,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    return c.json({
      specializations: classification.specializations,
      riskFlags: classification.riskFlags,
    })
  })

  return app
}
