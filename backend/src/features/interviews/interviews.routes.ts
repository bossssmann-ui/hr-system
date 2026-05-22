/**
 * Interview routes — Phase 1F.
 *
 * POST   /api/interviews                         — create interview for an application
 * GET    /api/interviews/:id                     — get interview details
 * PATCH  /api/interviews/:id/consent             — mark consent_recorded = true
 * POST   /api/interviews/:id/recording           — upload recording (multipart, stub local storage)
 * POST   /api/interviews/:id/transcribe          — manual re-run transcription
 * POST   /api/interviews/:id/build-protocol      — manual re-run protocol building
 *
 * Recording upload accepts audio/video files up to INTERVIEW_RECORDING_MAX_BYTES (default 500 MB).
 * Stub storage: saves to local Docker volume path (same pattern as resume files).
 * TODO(phase-1f+): wire DigitalOcean Spaces / real cloud storage for recordings.
 * TODO(phase-1f+): meeting-platform integration (Telemost / Zoom / Google Meet) — file upload only for now.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { enqueueBuildProtocolJob, enqueueTranscribeJob } from './interviews.queue'
import { interviewStatusSchema } from './interviews.schemas'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/wave',
  'video/mp4',
  'application/octet-stream', // fallback for generic uploads
])

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.m4a', '.wav'])

const STUB_UPLOAD_DIR = '/tmp/hr-system-recordings'

type RawInterview = {
  id: string
  tenantId: string
  applicationId: string
  scheduledAt: Date | null
  recordingUrl: string | null
  consentRecorded: boolean
  status: string
  transcript: unknown
  protocol: unknown
  offerDraft: unknown
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

function toDto(row: RawInterview) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    applicationId: row.applicationId,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    recordingUrl: row.recordingUrl,
    consentRecorded: row.consentRecorded,
    status: interviewStatusSchema.parse(row.status),
    transcript: row.transcript ?? null,
    protocol: row.protocol ?? null,
    offerDraft: row.offerDraft ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createInterviewRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── List by application ───────────────────────────────────────────────────

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    zValidator('query', z.object({ application_id: z.string().uuid() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { application_id } = c.req.valid('query')

      const rows = await prisma.interview.findMany({
        where: { tenantId, applicationId: application_id },
        orderBy: { createdAt: 'asc' },
      })

      return c.json({ items: rows.map(toDto) })
    },
  )

  // ─── Get one ───────────────────────────────────────────────────────────────

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter', 'hiring_manager'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.interview.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Interview not found')

      return c.json(toDto(row))
    },
  )

  // ─── Create ────────────────────────────────────────────────────────────────

  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator(
      'json',
      z.object({
        applicationId: z.string().uuid(),
        scheduledAt: z.string().datetime().optional(),
      }),
    ),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      // Verify application belongs to tenant.
      const application = await prisma.application.findFirst({
        where: { id: body.applicationId, tenantId },
      })
      if (!application) throw new AppError(404, 'NOT_FOUND', 'Application not found')

      const row = await prisma.interview.create({
        data: {
          tenantId,
          applicationId: body.applicationId,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
          createdByUserId: userId,
        },
      })

      c.set('auditEntry', {
        action: 'interview.create',
        entityType: 'Interview',
        entityId: row.id,
        diff: { applicationId: body.applicationId },
      })

      return c.json(toDto(row), 201)
    },
  )

  // ─── Consent gate ──────────────────────────────────────────────────────────

  app.patch(
    '/:id/consent',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', z.object({ consentRecorded: z.boolean() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const row = await prisma.interview.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Interview not found')

      const updated = await prisma.interview.update({
        where: { id },
        data: { consentRecorded: body.consentRecorded },
      })

      c.set('auditEntry', {
        action: 'interview.consent_updated',
        entityType: 'Interview',
        entityId: id,
        diff: { consentRecorded: body.consentRecorded },
      })

      return c.json(toDto(updated))
    },
  )

  // ─── Recording upload ──────────────────────────────────────────────────────
  // Stub storage: saves to local Docker volume /tmp/hr-system-recordings.
  // TODO(phase-1f+): wire DigitalOcean Spaces for real cloud storage.

  app.post(
    '/:id/recording',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.interview.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Interview not found')

      const contentType = c.req.header('content-type') ?? ''
      const maxBytes = env.INTERVIEW_RECORDING_MAX_BYTES

      let fileBuffer: ArrayBuffer
      let filename: string
      let mimeType: string

      if (contentType.includes('multipart/form-data')) {
        // Multipart upload.
        const formData = await c.req.formData()
        const file = formData.get('file')
        if (!file || typeof file === 'string') {
          throw new AppError(400, 'VALIDATION_ERROR', 'Missing file in multipart form data')
        }
        filename = file.name
        mimeType = file.type || 'application/octet-stream'
        fileBuffer = await file.arrayBuffer()
      } else if (contentType.includes('application/octet-stream') || ALLOWED_AUDIO_TYPES.has(contentType.split(';')[0]?.trim() ?? '')) {
        // Raw binary upload.
        filename = c.req.header('x-filename') ?? `recording-${randomUUID()}.mp3`
        mimeType = contentType.split(';')[0]?.trim() ?? 'audio/mpeg'
        fileBuffer = await c.req.arrayBuffer()
      } else {
        throw new AppError(400, 'VALIDATION_ERROR', `Unsupported content type: ${contentType}`)
      }

      if (fileBuffer.byteLength > maxBytes) {
        throw new AppError(400, 'VALIDATION_ERROR', `Recording exceeds maximum size of ${maxBytes} bytes`)
      }

      // Validate file extension.
      const ext = extname(filename).toLowerCase()
      if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Unsupported file extension: ${ext}. Allowed: ${Array.from(ALLOWED_EXTENSIONS).map((e) => e.slice(1)).join(', ')}`,
        )
      }

      // Stub storage: write to local volume.
      const fileId = randomUUID()
      const safeExt = ext || '.mp3'
      const storedFilename = `${fileId}${safeExt}`
      const storagePath = join(STUB_UPLOAD_DIR, tenantId, id)

      await mkdir(storagePath, { recursive: true })
      await writeFile(join(storagePath, storedFilename), Buffer.from(fileBuffer))

      const recordingUrl = `local://recordings/${tenantId}/${id}/${storedFilename}`

      const updated = await prisma.interview.update({
        where: { id },
        data: { recordingUrl },
      })

      c.set('auditEntry', {
        action: 'interview.recording_uploaded',
        entityType: 'Interview',
        entityId: id,
        diff: {
          recording_url: recordingUrl,
          mime_type: mimeType,
          byte_size: fileBuffer.byteLength,
          actor_user_id: userId,
        },
      })

      // Auto-start transcription if consent is already recorded.
      if (updated.consentRecorded) {
        void enqueueTranscribeJob({ prisma, env, interviewId: id, actorUserId: userId })
      }

      return c.json(toDto(updated))
    },
  )

  // ─── Manual re-run transcription ───────────────────────────────────────────

  app.post(
    '/:id/transcribe',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.interview.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Interview not found')

      if (!row.consentRecorded) {
        throw new AppError(422, 'CONSENT_REQUIRED', 'Transcription requires consent_recorded = true')
      }

      if (!row.recordingUrl) {
        throw new AppError(422, 'NO_RECORDING', 'No recording URL; upload a recording first')
      }

      const queueResult = await enqueueTranscribeJob({
        prisma,
        env,
        interviewId: id,
        actorUserId: userId,
      })

      c.set('auditEntry', {
        action: 'interview.transcribe_requested',
        entityType: 'Interview',
        entityId: id,
        diff: { queued: queueResult.queued },
      })

      return c.json(queueResult, 202)
    },
  )

  // ─── Manual re-run protocol building ──────────────────────────────────────

  app.post(
    '/:id/build-protocol',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()

      const row = await prisma.interview.findFirst({ where: { id, tenantId } })
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Interview not found')

      if (!row.transcript) {
        throw new AppError(422, 'NO_TRANSCRIPT', 'No transcript yet; run transcription first')
      }

      const queueResult = await enqueueBuildProtocolJob({
        prisma,
        env,
        interviewId: id,
        actorUserId: userId,
      })

      c.set('auditEntry', {
        action: 'interview.build_protocol_requested',
        entityType: 'Interview',
        entityId: id,
        diff: { queued: queueResult.queued },
      })

      return c.json(queueResult, 202)
    },
  )

  return app
}
