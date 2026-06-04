import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import { enqueueApplicationScoringJob } from '../../features/scoring/scoring.queue'
import { enqueueSelectionBridgeJob } from '../../features/selection/selection-application-bridge'
import { createInMemoryQueue } from '../../queues'
import { createHhClient } from './client'
import { ensureFreshAccessToken } from './sync'
import type { HhClient, HhResume } from './types'

const HH_SOURCING_CANDIDATE_PREFIX = 'Candidate from HH sourcing'

type HhSourcingJob = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  actorUserId?: string
  resolve: (summary: HhResumeSourcingSummary) => void
  reject: (error: unknown) => void
}

export type HhResumeSourcingStatus = 'ok' | 'disabled' | 'not_connected' | 'no_paid_access' | 'rate_limited'

export type HhResumeSourcingSummary = {
  status: HhResumeSourcingStatus
  reason: string | null
  vacanciesProcessed: number
  resumesScanned: number
  candidatesImported: number
  applicationsCreated: number
  dedupedCandidates: number
  contactsInitiated: number
}

const hhSourcingQueue = createInMemoryQueue<HhSourcingJob>('hh.resume.sourcing')
let hhSourcingQueueRegistered = false

function ensureHhSourcingQueueRegistered() {
  if (hhSourcingQueueRegistered) return
  hhSourcingQueueRegistered = true

  hhSourcingQueue.process(async (job) => {
    try {
      const summary = await sourceHhResumesForTenant(job.prisma, job.env, job.tenantId, {
        actorUserId: job.actorUserId,
      })
      job.resolve(summary)
    } catch (error) {
      job.reject(error)
    }
  })
}

export async function enqueueHhResumeSourcingJob(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  actorUserId?: string
}) {
  ensureHhSourcingQueueRegistered()

  return new Promise<HhResumeSourcingSummary>((resolve, reject) => {
    void hhSourcingQueue.enqueue({
      ...input,
      resolve,
      reject,
    })
  })
}

export function mapSourcingCriteriaToSearchParams(criteria: unknown): Record<string, string> {
  const input = asRecord(criteria)
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeCriteriaValue(value)
    if (normalized === null) continue
    result[key] = normalized
  }

  return result
}

export async function sourceHhResumesForTenant(
  prisma: DbClient,
  env: AppEnv,
  tenantId: string,
  opts: {
    actorUserId?: string
    client?: HhClient
  } = {},
): Promise<HhResumeSourcingSummary> {
  const flags = await getTenantFeatureFlags(prisma, tenantId)
  if (flags['sourcing.hh.enabled'] !== true) {
    return buildSummary('disabled', 'sourcing.hh.enabled is disabled')
  }

  if (!env.HH_INTEGRATION_ENABLED) {
    return buildSummary('disabled', 'HH integration is disabled')
  }

  const client = opts.client ?? createHhClient({ env })
  let token: { accessToken: string }

  try {
    token = await ensureFreshAccessToken(prisma, env, tenantId, client)
  } catch (error) {
    if (isConnectionMissing(error)) {
      return buildSummary('not_connected', 'HH integration is not connected for this tenant')
    }
    throw error
  }

  const maxViewsPerRun = toPositiveInt(flags['sourcing.hh.maxViewsPerRun']) ?? 50
  const contactEnabled = flags['sourcing.hh.contact.enabled'] === true

  const vacancies = await prisma.vacancy.findMany({
    where: {
      tenantId,
      hhVacancyId: { not: null },
    },
    select: {
      id: true,
      hhVacancyId: true,
      hhSourcingCriteria: true,
    },
  })

  const summary: HhResumeSourcingSummary = {
    status: 'ok',
    reason: null,
    vacanciesProcessed: 0,
    resumesScanned: 0,
    candidatesImported: 0,
    applicationsCreated: 0,
    dedupedCandidates: 0,
    contactsInitiated: 0,
  }

  for (const vacancy of vacancies) {
    if (!vacancy.hhVacancyId) continue
    summary.vacanciesProcessed += 1

    const params = mapSourcingCriteriaToSearchParams(vacancy.hhSourcingCriteria)
    if (Object.keys(params).length === 0) continue
    const invitationMessage = resolveInvitationMessage(vacancy.hhSourcingCriteria)
    let page = 0
    let pages = 1

    while (page < pages) {
      const pageData = await handleHhRequest(
        () => client.listResumes(token.accessToken, params, page),
        summary,
      )
      if (!pageData) return summary

      pages = Math.max(pageData.pages, 1)
      page += 1

      for (const item of pageData.items) {
        if (summary.resumesScanned >= maxViewsPerRun) {
          summary.status = 'rate_limited'
          summary.reason = `Run resume-view limit reached (${maxViewsPerRun})`
          return summary
        }

        const imported = await importSourcedResume({
          prisma,
          env,
          tenantId,
          actorUserId: opts.actorUserId,
          client,
          accessToken: token.accessToken,
          vacancyId: vacancy.id,
          hhVacancyId: vacancy.hhVacancyId,
          resumeId: item.id,
          contactEnabled,
          invitationMessage,
          summary,
        })
        if (!imported) {
          return summary
        }
      }
    }
  }

  return summary
}

async function importSourcedResume(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  actorUserId?: string
  client: HhClient
  accessToken: string
  vacancyId: string
  hhVacancyId: string
  resumeId: string
  contactEnabled: boolean
  invitationMessage: string
  summary: HhResumeSourcingSummary
}) {
  input.summary.resumesScanned += 1

  const existingCandidate = await input.prisma.candidate.findFirst({
    where: {
      tenantId: input.tenantId,
      externalIds: {
        path: ['hh_resume_id'],
        equals: input.resumeId,
      },
    },
    select: {
      id: true,
    },
  })

  if (existingCandidate) {
    input.summary.dedupedCandidates += 1
    return true
  }

  const resume = await handleHhRequest(
    () => input.client.getResume(input.accessToken, input.resumeId),
    input.summary,
  )
  if (!resume) return false

  const contacts = extractResumeContacts(resume)
  const candidate = await input.prisma.candidate.create({
    data: {
      tenantId: input.tenantId,
      fullName:
        [resume.first_name, resume.last_name].filter(Boolean).join(' ').trim() ||
        resume.title ||
        `${HH_SOURCING_CANDIDATE_PREFIX} (${resume.area?.name ?? 'unknown location'}, ${resume.id})`,
      source: 'hh_ru',
      email: contacts.email,
      phone: contacts.phone,
      location: resume.area?.name ?? null,
      consentContext: {
        basis: 'hh_resume_sourcing',
        imported_at: new Date().toISOString(),
      } as Prisma.InputJsonValue,
      externalIds: {
        hh_resume_id: resume.id,
        hh_sourcing: true,
      } as Prisma.InputJsonValue,
    },
  })
  input.summary.candidatesImported += 1

  const existingApplication = await input.prisma.application.findFirst({
    where: {
      tenantId: input.tenantId,
      candidateId: candidate.id,
      vacancyId: input.vacancyId,
    },
    select: { id: true },
  })

  const application = existingApplication
    ? await input.prisma.application.update({
        where: { id: existingApplication.id },
        data: {
          externalIds: {
            hh_resume_id: resume.id,
            source: 'hh_sourcing',
          } as Prisma.InputJsonValue,
        },
      })
    : await input.prisma.application.create({
        data: {
          tenantId: input.tenantId,
          candidateId: candidate.id,
          vacancyId: input.vacancyId,
          stage: 'new',
          externalIds: {
            hh_resume_id: resume.id,
            source: 'hh_sourcing',
          } as Prisma.InputJsonValue,
        },
      })

  if (!existingApplication) {
    input.summary.applicationsCreated += 1
  }

  void enqueueApplicationScoringJob({
    prisma: input.prisma,
    env: input.env,
    applicationId: application.id,
    actorUserId: input.actorUserId,
  })

  void enqueueSelectionBridgeJob({
    prisma: input.prisma,
    env: input.env,
    tenantId: input.tenantId,
    applicationId: application.id,
    source: 'hh_sourcing',
  })

  if (input.contactEnabled) {
    const invite = await handleHhRequest(
      () =>
        input.client.createNegotiationInvite({
          accessToken: input.accessToken,
          resumeId: resume.id,
          vacancyId: input.hhVacancyId,
          message: input.invitationMessage,
        }),
      input.summary,
    )
    if (!invite) return false

    input.summary.contactsInitiated += 1
    await input.prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        externalIds: {
          hh_resume_id: resume.id,
          hh_sourcing: true,
          ...(invite.messagesUrl ? { hh_messages_url: invite.messagesUrl } : {}),
          ...(invite.id ? { hh_negotiation_id: invite.id } : {}),
        } as Prisma.InputJsonValue,
      },
    })
  }

  return true
}

async function handleHhRequest<T>(
  run: () => Promise<T>,
  summary: HhResumeSourcingSummary,
): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (isHhStatus(error, 403)) {
      summary.status = 'no_paid_access'
      summary.reason = 'Нет платного доступа к базе резюме HH.ru'
      return null
    }
    if (isHhStatus(error, 429)) {
      summary.status = 'rate_limited'
      summary.reason = 'HH.ru rate limit reached (429)'
      return null
    }
    throw error
  }
}

function isConnectionMissing(error: unknown) {
  return error instanceof Error && error.message.includes('HH integration is not connected')
}

function isHhStatus(error: unknown, status: number) {
  return error instanceof Error && error.message.includes(`HH request failed: ${status}`)
}

async function getTenantFeatureFlags(prisma: DbClient, tenantId: string): Promise<Record<string, unknown>> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { featureFlags: true },
  })
  return asRecord(settings?.featureFlags)
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function normalizeCriteriaValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const serialized = value
      .map((entry) => normalizeCriteriaValue(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(',')
    return serialized.length > 0 ? serialized : null
  }
  return null
}

function extractResumeContacts(resume: HhResume) {
  let email: string | null = null
  let phone: string | null = null

  for (const contact of resume.contact ?? []) {
    const type = contact.type?.id?.toLowerCase() ?? ''
    const value = contact.value?.trim()
    if (!value) continue

    if (!email && (type === 'email' || value.includes('@'))) {
      email = value.toLowerCase()
      continue
    }

    if (!phone && (type === 'cell' || type === 'phone')) {
      phone = value
      continue
    }
  }

  return { email, phone }
}

function resolveInvitationMessage(criteria: unknown): string {
  const source = asRecord(criteria)
  const value = source['invitationMessage']
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return 'Здравствуйте! Приглашаем вас на вакансию и готовы продолжить общение.'
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function buildSummary(status: HhResumeSourcingStatus, reason: string): HhResumeSourcingSummary {
  return {
    status,
    reason,
    vacanciesProcessed: 0,
    resumesScanned: 0,
    candidatesImported: 0,
    applicationsCreated: 0,
    dedupedCandidates: 0,
    contactsInitiated: 0,
  }
}
