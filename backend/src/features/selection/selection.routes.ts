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
  type CrossCheckFlag,
} from './selection.queue'

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
  role: z.enum(['logist', 'sales_manager']),
})

const submitStageSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
})

const adminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  vacancyId: z.string().uuid().optional(),
  role: z.enum(['logist', 'sales_manager']).optional(),
})

/**
 * Build the stages content for a given role. The actual question content is
 * static and defined in docs/assessment-system-design.md. At runtime we store
 * the stage metadata here; answers are stored per SelectionStageResult.
 */
function buildStages(role: 'logist' | 'sales_manager') {
  return [
    {
      stage: 1,
      title: role === 'logist' ? 'Анкета-скрининг (Логист-экспедитор)' : 'Анкета-скрининг (Менеджер по продажам ТЭУ)',
      type: 'questionnaire',
      timeLimitMin: null,
    },
    {
      stage: 2,
      title: role === 'logist' ? 'Профессиональный тест (Логист-экспедитор)' : 'Профессиональный тест (Менеджер по продажам ТЭУ)',
      type: 'test',
      timeLimitMin: 30,
    },
    {
      stage: 3,
      title: role === 'logist' ? 'Психологический тест (Логист-экспедитор)' : 'Психологический тест (Менеджер по продажам ТЭУ)',
      type: 'psychology',
      timeLimitMin: null,
    },
    {
      stage: 4,
      title: role === 'logist' ? 'Тестовое задание (Логист-экспедитор)' : 'Тестовое задание (Менеджер по продажам ТЭУ)',
      type: 'assignment',
      timeLimitMin: 45,
    },
  ]
}

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

      // Find or create SelectionTemplate for vacancy+role
      let template = await prisma.selectionTemplate.findFirst({
        where: { tenantId, vacancyId: body.vacancyId, role: body.role },
      })
      if (!template) {
        template = await prisma.selectionTemplate.create({
          data: {
            tenantId,
            vacancyId: body.vacancyId,
            role: body.role,
            stages: buildStages(body.role) as unknown as Prisma.InputJsonValue,
          },
        })
      }

      // Create session
      const session = await prisma.selectionSession.create({
        data: {
          tenantId,
          templateId: template.id,
          applicationId: body.applicationId ?? null,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
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

    // Auto-transition pending → stage_1
    let status = session.status
    let startedAt = session.startedAt
    if (status === 'pending') {
      status = 'stage_1'
      startedAt = new Date()
      await prisma.selectionSession.update({
        where: { id: session.id },
        data: { status, startedAt },
      })
    }

    const stageNum = stageNumberForStatus(status)
    const stages = Array.isArray(session.template.stages) ? session.template.stages : []
    const currentStage = stageNum !== null ? stages[stageNum - 1] ?? null : null

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
        session.template.role as 'logist' | 'sales_manager',
        previousResults.map((r) => ({
          stageNumber: r.stageNumber,
          answers: r.answers as Record<string, unknown>,
          flags: asCrossCheckFlags(r.flags),
        })),
      )

      // Save stage result
      await prisma.selectionStageResult.create({
        data: {
          sessionId: session.id,
          stageNumber: n,
          answers: body.answers as Prisma.InputJsonValue,
          flags: flags as unknown as Prisma.InputJsonValue,
        },
      })

      // Determine next status
      const nextSt = n < 4 ? `stage_${n + 1}` : 'completed'
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

      // After stage 4: enqueue AI evaluation
      if (n === 4) {
        const env = c.get('env')
        void enqueueSelectionEvaluate({ prisma, env, sessionId: session.id })
      }

      return c.json({ submitted: true, nextStatus: nextSt })
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
                createdAt: s.verdict.createdAt.toISOString(),
              }
            : null,
        })),
      })
    },
  )

  return app
}
