import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import {
  processInboundApplicationCreated,
  withInboundProcessingPending,
} from '../../features/applications/inbound-application.service'
import { enqueueApplicationScoringJob } from '../../features/scoring/scoring.queue'
import { createInMemoryQueue } from '../../queues'
import { createHhClient } from './client'
import { decryptHhSecret, encryptHhSecret } from './crypto'
import type { HhClient, HhNegotiation, HhResume } from './types'

export type HhSyncSummary = {
  importedCandidates: number
  upsertedApplications: number
  vacanciesProcessed: number
  negotiationsScanned: number
  lastSyncedAt: string | null
}

const HH_CANDIDATE_FALLBACK_PREFIX = 'Candidate from HH.ru'

type HhSyncJob = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  actorUserId?: string
  resolve: (summary: HhSyncSummary) => void
  reject: (error: unknown) => void
}

const hhSyncQueue = createInMemoryQueue<HhSyncJob>('hh.negotiations.sync')
let hhSyncQueueRegistered = false

function ensureHhSyncQueueRegistered() {
  if (hhSyncQueueRegistered) return
  hhSyncQueueRegistered = true

  hhSyncQueue.process(async (job) => {
    try {
      const summary = await syncHhNegotiationsForTenant(job.prisma, job.env, job.tenantId, {
        actorUserId: job.actorUserId,
      })
      job.resolve(summary)
    } catch (error) {
      job.reject(error)
    }
  })
}

export async function enqueueHhNegotiationsSyncJob(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  actorUserId?: string
}) {
  ensureHhSyncQueueRegistered()

  return new Promise<HhSyncSummary>((resolve, reject) => {
    void hhSyncQueue.enqueue({
      ...input,
      resolve,
      reject,
    })
  })
}

export async function syncHhNegotiationsForTenant(
  prisma: DbClient,
  env: AppEnv,
  tenantId: string,
  opts: {
    actorUserId?: string
    client?: HhClient
  } = {},
): Promise<HhSyncSummary> {
  const client = opts.client ?? createHhClient({ env })
  const token = await ensureFreshAccessToken(prisma, env, tenantId, client)

  const linkedVacancies = await prisma.vacancy.findMany({
    where: {
      tenantId,
      hhVacancyId: { not: null },
    },
    select: {
      id: true,
      hhVacancyId: true,
    },
  })

  let importedCandidates = 0
  let upsertedApplications = 0
  let negotiationsScanned = 0
  let lastSyncedAt: Date | null = null

  for (const vacancy of linkedVacancies) {
    if (!vacancy.hhVacancyId) continue

    const cursor = await prisma.hhSyncCursor.findFirst({
      where: {
        tenantId,
        vacancyId: vacancy.id,
      },
    })

    const collections = await client.getNegotiationCollections(token.accessToken, vacancy.hhVacancyId)
    const targetCollection =
      collections.find((collection) => {
        const id = collection.id?.toLowerCase() ?? ''
        const type = collection.type?.toLowerCase() ?? ''
        const name = collection.name?.toLowerCase() ?? ''
        return id.includes('response') || type.includes('response') || name.includes('response') || name.includes('отклик')
      }) ?? collections[0]

    if (!targetCollection) continue

    let page = 0
    let pages = 1
    let maxSeenAt = cursor?.lastSyncedAt ?? null
    let maxSeenId = cursor?.lastNegotiationId ?? null

    // TODO(phase-1a+): webhook subscription for incremental HH ingestion.
    while (page < pages) {
      const result = await client.listNegotiations(token.accessToken, targetCollection.url, page)
      pages = Math.max(result.pages, 1)
      page += 1

      const sorted = [...result.items].sort(compareNegotiations)

      for (const negotiation of sorted) {
        negotiationsScanned += 1

        if (!shouldSyncNegotiation(negotiation, cursor?.lastSyncedAt ?? null, cursor?.lastNegotiationId ?? null)) {
          continue
        }

        if (!negotiation.resume?.id) continue

        const resume = await client.getResume(token.accessToken, negotiation.resume.id)
        const outcome = await upsertNegotiationFromHh(prisma, {
          tenantId,
          vacancyId: vacancy.id,
          negotiation,
          resume,
          env,
          actorUserId: opts.actorUserId,
        })

        importedCandidates += outcome.importedCandidate ? 1 : 0
        upsertedApplications += 1

        const changedAt = negotiationUpdatedAt(negotiation)
        if (!maxSeenAt || changedAt > maxSeenAt || (changedAt.getTime() === maxSeenAt.getTime() && negotiation.id > (maxSeenId ?? ''))) {
          maxSeenAt = changedAt
          maxSeenId = negotiation.id
        }
      }
    }

    if (maxSeenAt || maxSeenId) {
      await prisma.hhSyncCursor.upsert({
        where: { vacancyId: vacancy.id },
        update: {
          lastSyncedAt: maxSeenAt,
          lastNegotiationId: maxSeenId,
        },
        create: {
          tenantId,
          vacancyId: vacancy.id,
          lastSyncedAt: maxSeenAt,
          lastNegotiationId: maxSeenId,
        },
      })

      if (!lastSyncedAt || (maxSeenAt && maxSeenAt > lastSyncedAt)) {
        lastSyncedAt = maxSeenAt
      }
    }
  }

  return {
    importedCandidates,
    upsertedApplications,
    vacanciesProcessed: linkedVacancies.length,
    negotiationsScanned,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  }
}

export function shouldSyncNegotiation(
  negotiation: Pick<HhNegotiation, 'id' | 'created_at' | 'updated_at' | 'has_updates'>,
  lastSyncedAt: Date | null,
  lastNegotiationId: string | null,
) {
  if (!lastSyncedAt) return true

  const changedAt = negotiationUpdatedAt(negotiation)
  if (changedAt > lastSyncedAt) return true
  if (changedAt < lastSyncedAt) return false

  if (!lastNegotiationId) return true
  if (negotiation.id > lastNegotiationId) return true

  return Boolean(negotiation.has_updates)
}

function compareNegotiations(a: HhNegotiation, b: HhNegotiation) {
  const diff = negotiationUpdatedAt(a).getTime() - negotiationUpdatedAt(b).getTime()
  if (diff !== 0) return diff
  return a.id.localeCompare(b.id)
}

function negotiationUpdatedAt(negotiation: Pick<HhNegotiation, 'created_at' | 'updated_at'>) {
  return new Date(negotiation.updated_at ?? negotiation.created_at)
}

export async function upsertNegotiationFromHh(
  prisma: DbClient,
  input: {
    tenantId: string
    vacancyId: string
    negotiation: HhNegotiation
    resume: HhResume
    env?: AppEnv
    actorUserId?: string
  },
) {
  const contacts = extractResumeContacts(input.resume)

  const dedupConditions: Array<Record<string, unknown>> = [
    {
      externalIds: {
        path: ['hh_resume_id'],
        equals: input.resume.id,
      },
    },
  ]

  if (contacts.email) {
    dedupConditions.push({ email: contacts.email })
  }

  if (contacts.phone) {
    dedupConditions.push({ phone: contacts.phone })
  }

  const existingCandidate = await prisma.candidate.findFirst({
    where: {
      tenantId: input.tenantId,
      OR: dedupConditions,
    },
  })

  const fullName =
    [input.resume.first_name, input.resume.last_name].filter(Boolean).join(' ').trim() ||
    input.resume.title ||
    `${HH_CANDIDATE_FALLBACK_PREFIX} (${input.resume.id})`

  const consentContext: Prisma.InputJsonValue = {
    basis: 'hh_negotiation_applicant_initiated',
    imported_at: new Date().toISOString(),
    hh_negotiation_id: input.negotiation.id,
  }

  const resumeSnapshot = buildResumeSnapshot(input.resume)
  const resumeSnapshotRecord = resumeSnapshot as Record<string, unknown>
  const candidateExternalIds = mergeExternalIds(existingCandidate?.externalIds, {
    hh_resume_id: input.resume.id,
    hh_negotiation_id: input.negotiation.id,
    hh_resume_snapshot: resumeSnapshot,
    hh_resume_history: appendResumeHistory(existingCandidate?.externalIds, {
      ...resumeSnapshotRecord,
      hh_resume_id: input.resume.id,
      hh_negotiation_id: input.negotiation.id,
      imported_at: new Date().toISOString(),
    }),
  })

  const candidate = existingCandidate
    ? await prisma.candidate.update({
        where: { id: existingCandidate.id },
        data: {
          fullName,
          source: 'hh_ru',
          email: contacts.email ?? existingCandidate.email,
          phone: contacts.phone ?? existingCandidate.phone,
          location: input.resume.area?.name ?? existingCandidate.location,
          externalIds: candidateExternalIds,
          consentContext,
        },
      })
    : await prisma.candidate.create({
        data: {
          tenantId: input.tenantId,
          fullName,
          source: 'hh_ru',
          email: contacts.email,
          phone: contacts.phone,
          location: input.resume.area?.name ?? null,
          externalIds: candidateExternalIds,
          consentContext,
        },
      })

  const applicationExternalIds = {
    hh_negotiation_id: input.negotiation.id,
    hh_resume_id: input.resume.id,
  }

  const existingApplicationByNegotiation = await prisma.application.findFirst({
    where: {
      tenantId: input.tenantId,
      externalIds: {
        path: ['hh_negotiation_id'],
        equals: input.negotiation.id,
      },
    },
  })

  let applicationIdForScoring: string | null = null
  let createdNewApplication = false

  if (existingApplicationByNegotiation) {
    await prisma.application.update({
      where: { id: existingApplicationByNegotiation.id },
      data: {
        candidateId: candidate.id,
        vacancyId: input.vacancyId,
        externalIds: mergeExternalIds(existingApplicationByNegotiation.externalIds, applicationExternalIds),
      },
    })
    applicationIdForScoring = existingApplicationByNegotiation.id
  } else {
    const existingPair = await prisma.application.findFirst({
      where: {
        tenantId: input.tenantId,
        candidateId: candidate.id,
        vacancyId: input.vacancyId,
      },
    })

    if (existingPair) {
      await prisma.application.update({
        where: { id: existingPair.id },
        data: {
          externalIds: mergeExternalIds(existingPair.externalIds, applicationExternalIds),
        },
      })
      applicationIdForScoring = existingPair.id
    } else {
      const createdApplication = await prisma.application.create({
        data: {
          tenantId: input.tenantId,
          candidateId: candidate.id,
          vacancyId: input.vacancyId,
          stage: 'new',
          externalIds: withInboundProcessingPending(applicationExternalIds, 'hh_ru'),
        },
      })
      applicationIdForScoring = createdApplication.id
      createdNewApplication = true
    }
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: 'hh.sync.candidate_imported',
      entityType: 'Candidate',
      entityId: candidate.id,
      diff: {
        hh_negotiation_id: input.negotiation.id,
        hh_resume_id: input.resume.id,
      },
    },
  })

  if (input.env && applicationIdForScoring) {
    void enqueueApplicationScoringJob({
      prisma,
      env: input.env,
      applicationId: applicationIdForScoring,
      actorUserId: input.actorUserId,
    })
  }

  if (createdNewApplication && applicationIdForScoring) {
    const vacancy = await prisma.vacancy.findFirst({
      where: { id: input.vacancyId, tenantId: input.tenantId },
      select: { title: true },
    })
    await processInboundApplicationCreated({
      prisma,
      tenantId: input.tenantId,
      applicationId: applicationIdForScoring,
      candidateId: candidate.id,
      vacancyId: input.vacancyId,
      source: 'hh_ru',
      candidateName: candidate.fullName,
      vacancyTitle: vacancy?.title ?? null,
    })
  }

  return {
    importedCandidate: !existingCandidate,
  }

  function buildResumeSnapshot(resume: HhResume): Prisma.InputJsonValue {
    return {
      title: resume.title ?? null,
      experience: Array.isArray(resume.experience)
        ? resume.experience
            .map((item) => {
              const company = typeof item?.company?.name === 'string' ? item.company.name : null
              const position = typeof item?.position === 'string' ? item.position : null
              if (!company && !position) return null
              return [position, company].filter(Boolean).join(' @ ')
            })
            .filter((item): item is string => Boolean(item))
        : [],
      education: Array.isArray(resume.education?.primary)
        ? resume.education.primary
            .map((item) => {
              const name = typeof item?.name === 'string' ? item.name : null
              const year = typeof item?.year === 'number' ? String(item.year) : null
              return [name, year].filter(Boolean).join(' · ')
            })
            .filter((item): item is string => Boolean(item))
        : [],
      skills: Array.isArray(resume.skills) ? resume.skills : [],
      total_experience_months: resume.total_experience?.months ?? null,
      location: resume.area?.name ?? null,
    } satisfies Prisma.InputJsonValue
  }
}

function appendResumeHistory(existingExternalIds: unknown, snapshot: Record<string, unknown>) {
  const existing = isRecord(existingExternalIds) ? existingExternalIds : null
  const current = Array.isArray(existing?.hh_resume_history)
    ? existing.hh_resume_history.filter((item): item is Record<string, unknown> => isRecord(item))
    : []

  const last = current.at(-1)
  if (last && resumeComparableFingerprint(last) === resumeComparableFingerprint(snapshot)) {
    return current
  }

  return [...current, snapshot].slice(-5)
}

function resumeComparableFingerprint(snapshot: Record<string, unknown>) {
  return JSON.stringify({
    title: snapshot.title ?? null,
    experience: normalizeStringArray(snapshot.experience),
    education: normalizeStringArray(snapshot.education),
    skills: normalizeStringArray(snapshot.skills),
    total_experience_months: typeof snapshot.total_experience_months === 'number' ? snapshot.total_experience_months : null,
    location: typeof snapshot.location === 'string' ? snapshot.location : null,
  })
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function extractResumeContacts(resume: HhResume) {
  let email: string | null = null
  let phone: string | null = null

  for (const contact of resume.contact ?? []) {
    const type = contact.type?.id?.toLowerCase() ?? ''
    const value = normalizeContactValue(contact.value)
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

function normalizeContactValue(value: NonNullable<HhResume['contact']>[number]['value']) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return null

  const formatted = value.formatted?.trim()
  if (formatted) return formatted

  const parts = [value.country, value.city, value.number]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join('') : null
}

function mergeExternalIds(existing: unknown, next: Record<string, unknown>): Prisma.InputJsonValue {
  const base = isRecord(existing) ? existing : {}
  return {
    ...base,
    ...next,
  } as Prisma.InputJsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function ensureFreshAccessToken(prisma: DbClient, env: AppEnv, tenantId: string, client: HhClient) {
  if (!env.HH_TOKEN_ENCRYPTION_KEY) {
    throw new Error('HH_TOKEN_ENCRYPTION_KEY is not configured')
  }

  const connection = await prisma.hhConnection.findUnique({
    where: { tenantId },
  })

  if (!connection) {
    throw new Error('HH integration is not connected for this tenant')
  }

  const accessToken = decryptHhSecret(connection.accessToken, env.HH_TOKEN_ENCRYPTION_KEY)
  const refreshToken = decryptHhSecret(connection.refreshToken, env.HH_TOKEN_ENCRYPTION_KEY)

  const now = Date.now()
  const expiresAtMs = connection.tokenExpiresAt.getTime()
  const refreshThresholdMs = 60_000

  if (expiresAtMs - now > refreshThresholdMs) {
    return { accessToken }
  }

  const refreshed = await client.refreshAccessToken({ refreshToken })
  const nextExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000)

  await prisma.hhConnection.update({
    where: { tenantId },
    data: {
      accessToken: encryptHhSecret(refreshed.accessToken, env.HH_TOKEN_ENCRYPTION_KEY),
      refreshToken: encryptHhSecret(refreshed.refreshToken, env.HH_TOKEN_ENCRYPTION_KEY),
      tokenExpiresAt: nextExpiresAt,
    },
  })

  return { accessToken: refreshed.accessToken }
}
