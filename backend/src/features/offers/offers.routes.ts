/**
 * Offer routes — Phase 3.
 *
 * All routes are mounted under `/api/offers` except where stated. The list
 * endpoint `GET /api/applications/:id/offers` is exposed via
 * `createApplicationOffersListRoute()` and mounted on `/api/applications`.
 */

import {
  createOfferRequestSchema,
  declineOfferRequestSchema,
  listOffersResponseSchema,
  offerSchema,
  rejectOfferRequestSchema,
  updateOfferRequestSchema,
  type Offer,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { parseWebhookEvent, verifyWebhookSignature } from '../../integrations/docuseal/webhook'
import {
  acceptOffer,
  approveOffer,
  declineOffer,
  FsmDenied,
  rejectOffer,
  sendOffer,
  submitOffer,
} from './offers.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

type RawOffer = {
  id: string
  tenantId: string
  applicationId: string
  interviewId: string | null
  salary: number
  currency: string
  startDate: Date
  grade: string | null
  conditions: string[]
  status: string
  docusealSubmissionId: string | null
  docusealDocumentUrl: string | null
  docusealSigningUrl: string | null
  sentAt: Date | null
  expiresAt: Date | null
  acceptedAt: Date | null
  declinedAt: Date | null
  declinedReason: string | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

function toDto(row: RawOffer): Offer {
  return offerSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    interviewId: row.interviewId,
    salary: row.salary,
    currency: row.currency,
    startDate: row.startDate.toISOString().slice(0, 10),
    grade: row.grade,
    conditions: row.conditions ?? [],
    status: row.status,
    docusealSubmissionId: row.docusealSubmissionId,
    docusealDocumentUrl: row.docusealDocumentUrl,
    docusealSigningUrl: row.docusealSigningUrl,
    sentAt: row.sentAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declinedReason: row.declinedReason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

type FsmErrorBody = {
  error: { code: 'FSM_TRANSITION_DENIED'; message: string; details: { from: string; to: string } }
}

function fsmErrorBody(err: InstanceType<typeof FsmDenied>): FsmErrorBody {
  return {
    error: {
      code: 'FSM_TRANSITION_DENIED',
      message: err.message,
      details: { from: err.from, to: err.to },
    },
  }
}

export function createOffersRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── Detail ────────────────────────────────────────────────────────────
  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const row = await prisma.offer.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Offer not found')
      return c.json(toDto(row))
    },
  )

  // ─── Create ────────────────────────────────────────────────────────────
  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createOfferRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const application = await prisma.application.findFirst({
        where: { id: body.applicationId, tenantId },
      })
      if (!application) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      let prefill: {
        salary?: number
        currency?: string
        startDate?: string
        grade?: string | null
        conditions?: string[]
      } = {}
      if (body.interviewId) {
        const interview = await prisma.interview.findFirst({
          where: { id: body.interviewId, tenantId, applicationId: body.applicationId },
        })
        if (!interview) throw new AppError(404, 'NOT_FOUND', 'Interview not found')
        const draft = (interview.offerDraft as Record<string, unknown> | null) ?? null
        if (draft) {
          prefill = {
            salary: typeof draft.salary === 'number' ? draft.salary : undefined,
            currency: typeof draft.currency === 'string' ? draft.currency : undefined,
            startDate: typeof draft.start_date === 'string' ? draft.start_date : undefined,
            grade: typeof draft.grade === 'string' ? draft.grade : null,
            conditions: Array.isArray(draft.conditions)
              ? (draft.conditions.filter((c) => typeof c === 'string') as string[])
              : undefined,
          }
        }
      }

      const salary = body.salary ?? prefill.salary
      const currency = (body.currency ?? prefill.currency) as
        | 'RUB' | 'USD' | 'THB' | 'USDT' | undefined
      const startDateStr = body.startDate ?? prefill.startDate
      if (!salary || !currency || !startDateStr) {
        throw new AppError(400, 'VALIDATION_ERROR', 'salary, currency, and startDate are required')
      }
      const startDate = new Date(startDateStr)
      if (Number.isNaN(startDate.getTime())) {
        throw new AppError(400, 'VALIDATION_ERROR', 'startDate is not a valid date')
      }

      const row = await prisma.offer.create({
        data: {
          tenantId,
          applicationId: body.applicationId,
          interviewId: body.interviewId ?? null,
          salary,
          currency,
          startDate,
          grade: body.grade ?? prefill.grade ?? null,
          conditions: body.conditions ?? prefill.conditions ?? [],
          status: 'draft',
          createdByUserId: userId,
        },
      })

      c.set('auditEntry', {
        action: 'offer.create',
        entityType: 'Offer',
        entityId: row.id,
        diff: {
          applicationId: body.applicationId,
          interviewId: body.interviewId ?? null,
          salary,
          currency,
          startDate: startDateStr,
        },
      })

      return c.json(toDto(row), 201)
    },
  )

  // ─── Update draft ──────────────────────────────────────────────────────
  app.patch(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateOfferRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const row = await prisma.offer.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Offer not found')
      if (row.status !== 'draft') {
        return c.json(
          { error: { code: 'CONFLICT', message: 'Only draft offers can be edited' } },
          409,
        )
      }

      const data: Record<string, unknown> = {}
      if (body.salary !== undefined) data.salary = body.salary
      if (body.currency !== undefined) data.currency = body.currency
      if (body.startDate !== undefined) {
        const d = new Date(body.startDate)
        if (Number.isNaN(d.getTime())) {
          throw new AppError(400, 'VALIDATION_ERROR', 'startDate is not a valid date')
        }
        data.startDate = d
      }
      if (body.grade !== undefined) data.grade = body.grade
      if (body.conditions !== undefined) data.conditions = body.conditions

      const updated = await prisma.offer.update({ where: { id }, data })

      c.set('auditEntry', {
        action: 'offer.update',
        entityType: 'Offer',
        entityId: id,
        diff: body,
      })

      return c.json(toDto(updated))
    },
  )

  // ─── Submit ─────────────────────────────────────────────────────────────
  app.post(
    '/:id/submit',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      try {
        const updated = await submitOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  // ─── Approve ────────────────────────────────────────────────────────────
  app.post(
    '/:id/approve',
    requireRole('owner', 'hr_admin', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      try {
        const updated = await approveOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  // ─── Reject (manager bounces back to draft) ────────────────────────────
  app.post(
    '/:id/reject',
    requireRole('owner', 'hr_admin', 'hiring_manager'),
    zValidator('json', rejectOfferRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')
      try {
        const updated = await rejectOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
          reason: body.reason ?? null,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  // ─── Send (triggers DocuSeal flow) ─────────────────────────────────────
  app.post(
    '/:id/send',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      try {
        const updated = await sendOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  // ─── Decline ───────────────────────────────────────────────────────────
  app.post(
    '/:id/decline',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', declineOfferRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')
      try {
        const updated = await declineOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
          reason: body.reason ?? null,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  // ─── Manual accept (recruiter-recorded acceptance) ─────────────────────
  app.post(
    '/:id/accept',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const roles = c.get('roles')
      const userId = c.get('userId')
      const { id } = c.req.param()
      try {
        const updated = await acceptOffer({
          prisma,
          env,
          tenantId,
          offerId: id,
          actorRoles: roles,
          actorUserId: userId,
        })
        return c.json(toDto(updated))
      } catch (err) {
        if (err instanceof FsmDenied) return c.json(fsmErrorBody(err), 422); throw err
      }
    },
  )

  return app
}

// ─── List by application (mounted on /api/applications) ────────────────────
export function createApplicationOffersListRoute() {
  const app = new Hono<RouteBindings>()
  app.get(
    '/:id/offers',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const rows = await prisma.offer.findMany({
        where: { tenantId, applicationId: id },
        orderBy: { createdAt: 'desc' },
      })
      return c.json(listOffersResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )
  return app
}

// ─── DocuSeal webhook (public, signed) ─────────────────────────────────────
export function createDocusealWebhookRoute() {
  const app = new Hono<RouteBindings>()

  app.post('/webhook', async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')

    if (!env.DOCUSEAL_ENABLED || !env.DOCUSEAL_WEBHOOK_SECRET) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'DocuSeal disabled' } }, 404)
    }

    const rawBody = await c.req.text()
    const signature = c.req.header('X-Docuseal-Signature') ?? c.req.header('x-docuseal-signature')
    if (!verifyWebhookSignature(rawBody, signature ?? null, env.DOCUSEAL_WEBHOOK_SECRET)) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid signature' } }, 401)
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400)
    }

    const event = parseWebhookEvent(payload)
    if (!event) return c.json({ ok: true, ignored: true })

    const offer = await prisma.offer.findFirst({
      where: { docusealSubmissionId: event.submissionId },
    })
    if (!offer) return c.json({ ok: true, unknown_submission: true })

    if (event.documentUrl) {
      await prisma.offer.update({
        where: { id: offer.id },
        data: { docusealDocumentUrl: event.documentUrl },
      })
    }

    try {
      if (event.event === 'submission.completed' && offer.status === 'sent') {
        await acceptOffer({
          prisma,
          env,
          tenantId: offer.tenantId,
          offerId: offer.id,
          actorRoles: ['candidate'],
          actorUserId: null,
        })
      } else if (event.event === 'submission.declined' && offer.status === 'sent') {
        await declineOffer({
          prisma,
          env,
          tenantId: offer.tenantId,
          offerId: offer.id,
          actorRoles: ['candidate'],
          actorUserId: null,
          reason: 'declined via DocuSeal',
        })
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'docuseal.webhook.transition_failed', err: String(err) }))
    }

    return c.json({ ok: true })
  })

  return app
}
