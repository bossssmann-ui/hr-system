import {
  assessmentConsentRequestSchema,
  assessmentSessionSchema,
  assessmentSessionStatusSchema,
  assessmentSubmitRequestSchema,
  assessmentSubmitResponseSchema,
  assessmentTemplateSchema,
  createAssessmentTemplateRequestSchema,
  inviteAssessmentRequestSchema,
  inviteAssessmentResponseSchema,
  listAssessmentTemplatesResponseSchema,
  publicAssessmentViewSchema,
  trustPreviewRequestSchema,
  trustPreviewResponseSchema,
  updateAssessmentTemplateRequestSchema,
  type AssessmentQuestionType,
  type AssessmentSessionStatus,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
} from '../applications/composite-score'
import { notifyRecipientsForEvent } from '../notifications/recruiter-event-notifications'
import { resolvePipelineFlag } from '../tenant/resolve-pipeline-flag'
import { enqueueAssessmentOpenAnswerGrading } from './assessments.queue'
import { computeTrustScore } from './trust-score'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    tenantId?: string
    auditEntry?: unknown
  }
}

export function createAssessmentRoutes() {
  const app = new Hono<RouteBindings>()

  app.use('*', async (c, next) => {
    const env = c.get('env')
    if (!env.ASSESSMENTS_ENABLED) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Assessments are not enabled' } }, 404)
    }
    await next()
  })

  app.get(
    '/templates',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')

      const rows = await prisma.assessmentTemplate.findMany({
        where: { tenantId },
        include: { questions: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })

      return c.json(listAssessmentTemplatesResponseSchema.parse({ items: rows.map(toTemplateDto) }))
    },
  )

  app.post(
    '/templates',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createAssessmentTemplateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const template = await prisma.assessmentTemplate.create({
        data: {
          tenantId,
          vacancyId: body.vacancyId ?? null,
          title: body.title,
          description: body.description ?? null,
          timeLimitMin: body.timeLimitMin ?? null,
          createdBy: userId,
          questions: {
            create: body.questions.map((question) => ({
              order: question.order,
              type: question.type,
              prompt: question.prompt,
              options: question.options ? (question.options as Prisma.InputJsonValue) : undefined,
              rubric: question.rubric ?? null,
              competency: question.competency ?? null,
              weight: question.weight,
            })),
          },
        },
        include: { questions: { orderBy: { order: 'asc' } } },
      })

      c.set('auditEntry', {
        action: 'assessment_template.create',
        entityType: 'AssessmentTemplate',
        entityId: template.id,
        diff: { title: template.title, question_count: template.questions.length },
      })

      return c.json(assessmentTemplateSchema.parse(toTemplateDto(template)), 201)
    },
  )

  app.patch(
    '/templates/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateAssessmentTemplateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.assessmentTemplate.findFirst({
        where: { id, tenantId },
        include: { questions: true },
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Assessment template not found')

      await prisma.$transaction(async (tx) => {
        await tx.assessmentTemplate.update({
          where: { id },
          data: {
            title: body.title ?? undefined,
            description: body.description ?? undefined,
            vacancyId: body.vacancyId ?? undefined,
            timeLimitMin: body.timeLimitMin ?? undefined,
          },
        })

        if (body.questions) {
          await tx.assessmentQuestion.deleteMany({ where: { templateId: id } })
          if (body.questions.length > 0) {
            await tx.assessmentQuestion.createMany({
              data: body.questions.map((question) => ({
                templateId: id,
                order: question.order,
                type: question.type,
                prompt: question.prompt,
                options: question.options ? (question.options as Prisma.InputJsonValue) : undefined,
                rubric: question.rubric ?? null,
                competency: question.competency ?? null,
                weight: question.weight ?? 1,
              })),
            })
          }
        }
      })

      const updated = await prisma.assessmentTemplate.findFirstOrThrow({
        where: { id, tenantId },
        include: { questions: { orderBy: { order: 'asc' } } },
      })

      c.set('auditEntry', {
        action: 'assessment_template.update',
        entityType: 'AssessmentTemplate',
        entityId: id,
        diff: { updated: true },
      })

      return c.json(assessmentTemplateSchema.parse(toTemplateDto(updated)))
    },
  )

  app.post(
    '/:templateId/invite',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', inviteAssessmentRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { templateId } = c.req.param()
      const body = c.req.valid('json')

      const [template, application] = await Promise.all([
        prisma.assessmentTemplate.findFirst({ where: { id: templateId, tenantId } }),
        prisma.application.findFirst({ where: { id: body.applicationId, tenantId } }),
      ])
      if (!template) throw new AppError(404, 'NOT_FOUND', 'Assessment template not found')
      if (!application) throw new AppError(404, 'NOT_FOUND', 'Application not found')
      const hasSelectionTemplate = await prisma.selectionTemplate.findFirst({
        where: {
          tenantId,
          vacancyId: application.vacancyId,
        },
        select: { id: true },
      })
      if (hasSelectionTemplate) {
        throw new AppError(
          409,
          'CONFLICT',
          'Selection pipeline is enabled for this vacancy; use the selection session instead of assessments',
        )
      }

      const token = randomUUID().replaceAll('-', '')
      const session = await prisma.assessmentSession.create({
        data: {
          tenantId,
          templateId,
          applicationId: body.applicationId,
          inviteToken: token,
          status: 'invited',
        },
      })

      const response = inviteAssessmentResponseSchema.parse({
        sessionId: session.id,
        token,
        link: `/assessment/${token}`,
      })

      c.set('auditEntry', {
        action: 'assessment_session.invited',
        entityType: 'AssessmentSession',
        entityId: session.id,
        diff: { templateId, applicationId: body.applicationId },
      })

      return c.json(response, 201)
    },
  )

  app.post(
    '/trust-preview',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', trustPreviewRequestSchema),
    async (c) => {
      const env = c.get('env')
      const body = c.req.valid('json')
      const score = computeTrustScore(body.signals, resolveTrustWeights(env))
      return c.json(trustPreviewResponseSchema.parse({ trustScore: score }))
    },
  )

  app.get(
    '/sessions/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const session = await prisma.assessmentSession.findFirst({
        where: { id, tenantId },
        include: { answers: true },
      })
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Assessment session not found')
      c.set('tenantId', session.tenantId)
      return c.json(assessmentSessionSchema.parse(toSessionDto(session)))
    },
  )

  app.get(
    '/sessions',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', inviteAssessmentRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { applicationId } = c.req.valid('query')
      const sessions = await prisma.assessmentSession.findMany({
        where: { tenantId, applicationId },
        include: { answers: true },
        orderBy: { createdAt: 'desc' },
      })
      return c.json({ items: sessions.map(toSessionDto) })
    },
  )

  return app
}

export function createPublicAssessmentRoutes() {
  const app = new Hono<RouteBindings>()

  app.use('*', async (c, next) => {
    const env = c.get('env')
    if (!env.ASSESSMENTS_ENABLED) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Assessments are not enabled' } }, 404)
    }
    await next()
  })

  app.get('/:token', async (c) => {
    const prisma = c.get('prisma')
    const { token } = c.req.param()
    const session = await prisma.assessmentSession.findUnique({
      where: { inviteToken: token },
      include: { template: { include: { questions: { orderBy: { order: 'asc' } } } } },
    })
    if (!session) throw new AppError(404, 'NOT_FOUND', 'Assessment session not found')
    if (isSessionExpired(session)) {
      await prisma.assessmentSession.update({ where: { id: session.id }, data: { status: 'expired' } })
      throw new AppError(410, 'BAD_REQUEST', 'Assessment session expired')
    }
    if (!['invited', 'consented', 'in_progress'].includes(session.status)) {
      throw new AppError(409, 'CONFLICT', 'Assessment session is no longer available')
    }

    return c.json(publicAssessmentViewSchema.parse(toPublicView(session)))
  })

  app.post(
    '/:token/consent',
    zValidator('json', assessmentConsentRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const { token } = c.req.param()
      const body = c.req.valid('json')
      const session = await prisma.assessmentSession.findUnique({ where: { inviteToken: token } })
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Assessment session not found')
      c.set('tenantId', session.tenantId)
      if (!body.proctoring_consent) {
        throw new AppError(422, 'CONSENT_REQUIRED', 'Proctoring consent is required')
      }
      if (body.webcam_consent && !env.PROCTORING_WEBCAM_ENABLED) {
        throw new AppError(422, 'BAD_REQUEST', 'Webcam proctoring is disabled')
      }

      await prisma.assessmentSession.update({
        where: { id: session.id },
        data: {
          consentRecorded: true,
          status: 'consented',
          trustSignals: {
            ...(asRecord(session.trustSignals) ?? {}),
            consent: {
              proctoring: true,
              webcam: Boolean(body.webcam_consent),
              basis: body.consent_basis ?? 'assessment_proctoring',
              recorded_at: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      })

      c.set('auditEntry', {
        action: 'assessment_session.consented',
        entityType: 'AssessmentSession',
        entityId: session.id,
        diff: { proctoring_consent: true, webcam_consent: Boolean(body.webcam_consent) },
      })

      return c.json({ consented: true })
    },
  )

  app.post('/:token/start', async (c) => {
    const prisma = c.get('prisma')
    const { token } = c.req.param()
    const session = await prisma.assessmentSession.findUnique({ where: { inviteToken: token } })
    if (!session) throw new AppError(404, 'NOT_FOUND', 'Assessment session not found')
    c.set('tenantId', session.tenantId)
    if (!session.consentRecorded) throw new AppError(422, 'CONSENT_REQUIRED', 'Consent is required before start')
    if (session.status === 'expired') throw new AppError(410, 'BAD_REQUEST', 'Assessment session expired')

    const updated = await prisma.assessmentSession.update({
      where: { id: session.id },
      data: {
        status: 'in_progress',
        startedAt: session.startedAt ?? new Date(),
      },
    })

    return c.json({ status: assessmentSessionStatusSchema.parse(updated.status) })
  })

  app.post(
    '/:token/submit',
    zValidator('json', assessmentSubmitRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const { token } = c.req.param()
      const body = c.req.valid('json')

      const session = await prisma.assessmentSession.findUnique({
        where: { inviteToken: token },
        include: { template: { include: { questions: true } } },
      })
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Assessment session not found')
      c.set('tenantId', session.tenantId)
      if (!session.consentRecorded) throw new AppError(422, 'CONSENT_REQUIRED', 'Consent is required')
      if (isSessionExpired(session)) {
        await prisma.assessmentSession.update({ where: { id: session.id }, data: { status: 'expired' } })
        throw new AppError(410, 'BAD_REQUEST', 'Assessment session expired')
      }

      const trustScore = computeTrustScore(body.signals, resolveTrustWeights(env))
      const redFlagged = trustScore < env.TRUST_LOW_THRESHOLD

      await prisma.$transaction(async (tx) => {
        await tx.assessmentAnswer.deleteMany({ where: { sessionId: session.id } })
        await tx.assessmentAnswer.createMany({
          data: body.answers.map((answer) => ({
            sessionId: session.id,
            questionId: answer.question_id,
            answer: answer.answer as Prisma.InputJsonValue,
          })),
        })

        await tx.assessmentSession.update({
          where: { id: session.id },
          data: {
            status: 'submitted',
            submittedAt: new Date(),
            startedAt: session.startedAt ?? new Date(),
            trustScore,
            trustSignals: body.signals as Prisma.InputJsonValue,
          },
        })

        await tx.application.update({
          where: { id: session.applicationId },
          data: { trustFlagged: redFlagged },
        })
      })

      try {
        await recomputeCompositeScoreForApplication({
          prisma,
          env,
          applicationId: session.applicationId,
        })
      } catch (error) {
        await recordCompositeScoreRecomputeFailure({
          prisma,
          applicationId: session.applicationId,
          error,
        })
      }

      if (env.AI_SCORING_ENABLED) {
        void enqueueAssessmentOpenAnswerGrading({
          prisma,
          env,
          sessionId: session.id,
        })
      }

      {
        const tenantFeatureFlags = await prisma.tenantSettings.findUnique({
          where: { tenantId: session.tenantId },
          select: { featureFlags: true },
        }).then((s) => s?.featureFlags)
        if (resolvePipelineFlag('recruiterNotifications', tenantFeatureFlags, env)) {
          await notifyRecipientsForEvent({
            prisma,
            env,
            tenantId: session.tenantId,
            applicationId: session.applicationId,
            template: 'assessment.completed',
            eventKey: `assessment_session.completed:${session.id}`,
            payload: {
              trust: trustScore,
              score: null,
              redFlagged,
            },
          })
        }
      }

      c.set('auditEntry', {
        action: 'assessment_session.submitted',
        entityType: 'AssessmentSession',
        entityId: session.id,
        diff: {
          trust_score: trustScore,
          red_flagged: redFlagged,
        },
      })

      return c.json(assessmentSubmitResponseSchema.parse({
        submitted: true,
        trustScore,
        redFlagged,
      }))
    },
  )

  return app
}

function toTemplateDto(
  template: {
    id: string
    tenantId: string
    vacancyId: string | null
    title: string
    description: string | null
    timeLimitMin: number | null
    createdBy: string
    createdAt: Date
    updatedAt: Date
    questions: Array<{
      id: string
      templateId: string
      order: number
      type: AssessmentQuestionType
      prompt: string
      options: unknown
      rubric: string | null
      competency: string | null
      weight: number
    }>
  },
) {
  return {
    id: template.id,
    tenantId: template.tenantId,
    vacancyId: template.vacancyId,
    title: template.title,
    description: template.description,
    timeLimitMin: template.timeLimitMin,
    createdBy: template.createdBy,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    questions: template.questions.map((question) => ({
      id: question.id,
      templateId: question.templateId,
      order: question.order,
      type: question.type,
      prompt: question.prompt,
      options: Array.isArray(question.options) ? question.options : undefined,
      rubric: question.rubric,
      competency: question.competency,
      weight: question.weight,
    })),
  }
}

function toSessionDto(session: {
  id: string
  tenantId: string
  templateId: string
  applicationId: string
  status: AssessmentSessionStatus
  consentRecorded: boolean
  startedAt: Date | null
  submittedAt: Date | null
  trustScore: number | null
  trustSignals: unknown
  createdAt: Date
  answers: Array<{
    id: string
    sessionId: string
    questionId: string
    answer: unknown
    aiGrade: unknown
    createdAt: Date
  }>
}) {
  return {
    id: session.id,
    tenantId: session.tenantId,
    templateId: session.templateId,
    applicationId: session.applicationId,
    status: session.status,
    consentRecorded: session.consentRecorded,
    startedAt: session.startedAt?.toISOString() ?? null,
    submittedAt: session.submittedAt?.toISOString() ?? null,
    trustScore: session.trustScore,
    trustSignals: asRecord(session.trustSignals),
    createdAt: session.createdAt.toISOString(),
    answers: session.answers.map((answer) => ({
      id: answer.id,
      sessionId: answer.sessionId,
      questionId: answer.questionId,
      answer: answer.answer,
      aiGrade: asRecord(answer.aiGrade),
      createdAt: answer.createdAt.toISOString(),
    })),
  }
}

function toPublicView(session: {
  id: string
  status: AssessmentSessionStatus
  startedAt: Date | null
  template: {
    title: string
    description: string | null
    timeLimitMin: number | null
    questions: Array<{
      id: string
      templateId: string
      order: number
      type: AssessmentQuestionType
      prompt: string
      options: unknown
      competency: string | null
      weight: number
    }>
  }
}) {
  return {
    sessionId: session.id,
    status: session.status,
    title: session.template.title,
    description: session.template.description,
    timeLimitMin: session.template.timeLimitMin,
    startedAt: session.startedAt?.toISOString() ?? null,
    questions: session.template.questions.map((question) => ({
      id: question.id,
      order: question.order,
      type: question.type,
      prompt: question.prompt,
      options: Array.isArray(question.options) ? question.options : undefined,
      competency: question.competency,
      weight: question.weight,
    })),
  }
}

function resolveTrustWeights(env: AppEnv) {
  return {
    paste: env.TRUST_WEIGHT_PASTE,
    focus: env.TRUST_WEIGHT_FOCUS,
    keystroke: env.TRUST_WEIGHT_KEYSTROKE,
  }
}

function isSessionExpired(session: {
  status: AssessmentSessionStatus
  startedAt: Date | null
  createdAt: Date
  template?: { timeLimitMin: number | null }
}) {
  if (session.status === 'expired') return true
  const limitMin = session.template?.timeLimitMin ?? null
  if (!limitMin || !session.startedAt) return false
  return Date.now() > session.startedAt.getTime() + limitMin * 60 * 1000
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
