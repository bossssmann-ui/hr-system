/**
 * Engagement routes — Horizon 8 eNPS / Engagement Surveys.
 *
 * POST   /surveys              — create survey (hr_admin|owner)
 * PATCH  /surveys/:id          — patch draft survey (hr_admin|owner)
 * POST   /surveys/:id/open     — draft→open (hr_admin|owner)
 * POST   /surveys/:id/close    — open→closed (hr_admin|owner)
 * GET    /surveys              — list surveys, filter by status/kind (hr_admin|owner|hiring_manager)
 * GET    /surveys/:id          — get survey + responded/total (hr_admin|owner|hiring_manager)
 * POST   /surveys/:id/responses — submit response (employee)
 * GET    /surveys/:id/results  — eNPS aggregate (hr_admin|owner|hiring_manager)
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  createEngagementSurveyRequestSchema,
  patchEngagementSurveyRequestSchema,
  submitSurveyResponseRequestSchema,
  listEngagementSurveysQuerySchema,
} from '@web-app-demo/contracts'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  createSurvey,
  patchSurvey,
  openSurvey,
  closeSurvey,
  listSurveys,
  getSurvey,
  submitResponse,
  getSurveyResults,
} from './engagement.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

export function createEngagementRoutes() {
  const app = new Hono<RouteBindings>()

  // ── POST /surveys ─────────────────────────────────────────────────────────
  app.post(
    '/surveys',
    requireRole('hr_admin', 'owner'),
    zValidator('json', createEngagementSurveyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const survey = await createSurvey({
        prisma,
        tenantId,
        actorUserId: userId,
        title: body.title,
        kind: body.kind,
        question: body.question,
        closesAt: body.closesAt,
      })

      c.set('auditEntry', {
        action: 'engagement_survey.created',
        entityType: 'engagement_survey',
        entityId: survey.id,
        diff: { title: survey.title, kind: survey.kind },
      })

      return c.json(survey, 201)
    },
  )

  // ── PATCH /surveys/:id ────────────────────────────────────────────────────
  app.patch(
    '/surveys/:id',
    requireRole('hr_admin', 'owner'),
    zValidator('json', patchEngagementSurveyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const survey = await patchSurvey({
        prisma,
        tenantId,
        id,
        title: body.title,
        question: body.question,
        closesAt: body.closesAt,
      })

      return c.json(survey)
    },
  )

  // ── POST /surveys/:id/open ─────────────────────────────────────────────────
  app.post('/surveys/:id/open', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const survey = await openSurvey({ prisma, tenantId, id })

    c.set('auditEntry', {
      action: 'engagement_survey.opened',
      entityType: 'engagement_survey',
      entityId: survey.id,
      diff: { status: survey.status, openedAt: survey.openedAt },
    })

    return c.json(survey)
  })

  // ── POST /surveys/:id/close ────────────────────────────────────────────────
  app.post('/surveys/:id/close', requireRole('hr_admin', 'owner'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const survey = await closeSurvey({ prisma, tenantId, id })

    c.set('auditEntry', {
      action: 'engagement_survey.closed',
      entityType: 'engagement_survey',
      entityId: survey.id,
      diff: { status: survey.status, closedAt: survey.closedAt },
    })

    return c.json(survey)
  })

  // ── GET /surveys ──────────────────────────────────────────────────────────
  app.get(
    '/surveys',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    zValidator('query', listEngagementSurveysQuerySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { status, kind } = c.req.valid('query')

      const surveys = await listSurveys({ prisma, tenantId, status, kind })
      return c.json(surveys)
    },
  )

  // ── GET /surveys/:id ──────────────────────────────────────────────────────
  app.get('/surveys/:id', requireRole('hr_admin', 'owner', 'hiring_manager'), async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const { id } = c.req.param()

    const survey = await getSurvey({ prisma, tenantId, id })
    return c.json(survey)
  })

  // ── POST /surveys/:id/responses ───────────────────────────────────────────
  app.post(
    '/surveys/:id/responses',
    requireRole('employee', 'hr_admin', 'owner', 'hiring_manager', 'recruiter'),
    zValidator('json', submitSurveyResponseRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id: surveyId } = c.req.param()
      const body = c.req.valid('json')

      // Resolve the employee record for the acting user
      const employee = await prisma.employee.findFirst({ where: { userId, tenantId } })
      if (!employee) {
        throw new AppError(404, 'NOT_FOUND', 'Employee record not found for current user')
      }

      const response = await submitResponse({
        prisma,
        tenantId,
        surveyId,
        respondentEmployeeId: employee.id,
        score: body.score,
        comment: body.comment,
      })

      c.set('auditEntry', {
        action: 'survey_response.submitted',
        entityType: 'survey_response',
        entityId: response.id,
        diff: { surveyId, score: response.score },
      })

      return c.json(response, 201)
    },
  )

  // ── GET /surveys/:id/results ──────────────────────────────────────────────
  app.get(
    '/surveys/:id/results',
    requireRole('hr_admin', 'owner', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const results = await getSurveyResults({ prisma, tenantId, surveyId: id })
      return c.json(results)
    },
  )

  return app
}
