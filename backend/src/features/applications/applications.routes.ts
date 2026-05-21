import type {
  Application,
  Candidate,
  CreateApplicationRequest,
  MoveApplicationStageRequest,
  Vacancy,
} from '@web-app-demo/contracts'
import {
  applicationDetailSchema,
  applicationSchema,
  applicationStageSchema,
  createApplicationRequestSchema,
  listApplicationsResponseSchema,
  moveApplicationStageRequestSchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { canTransition } from '../applications/applications.fsm'

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
  externalIds: unknown
  createdAt: Date
  updatedAt: Date
}

function toDto(row: RawApplication): Application {
  return {
    id: row.id,
    tenantId: row.tenantId,
    candidateId: row.candidateId,
    vacancyId: row.vacancyId,
    stage: row.stage as Application['stage'],
    assignedToUserId: row.assignedToUserId,
    notes: row.notes,
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

      return c.json(listApplicationsResponseSchema.parse({ items: rows.map(toDto) }))
    },
  )

  // ─── Detail ────────────────────────────────────────────────────────────────

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
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
          ...toDto(row),
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
      const tenantId = c.get('tenantId')
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

      return c.json(applicationSchema.parse(toDto(row)), 201)
    },
  )

  // ─── Move stage ────────────────────────────────────────────────────────────

  app.patch(
    '/:id/stage',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('json', moveApplicationStageRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
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

      const [updated] = await prisma.$transaction([
        prisma.application.update({
          where: { id },
          data: { stage: body.to },
        }),
        prisma.applicationStageEvent.create({
          data: {
            tenantId,
            applicationId: id,
            fromStage: row.stage,
            toStage: body.to,
            actorUserId: userId,
            comment: body.comment ?? null,
          },
        }),
      ])

      c.set('auditEntry', {
        action: 'application.move_stage',
        entityType: 'Application',
        entityId: id,
        diff: { from: row.stage, to: body.to, comment: body.comment, actorUserId: userId },
      })

      return c.json(applicationSchema.parse(toDto(updated)))
    },
  )

  return app
}
