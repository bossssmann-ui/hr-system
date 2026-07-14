import type { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import { createNotifier, type Notifier } from '../../services/notifier'
import { findOrCreateConversation } from '../messaging/messaging.service'

type InboundApplicationSource = 'hh_ru' | 'careers_page' | 'manual'

type HandleInboundApplicationInput = {
  prisma: DbClient
  tenantId: string
  applicationId: string
  candidateId: string
  vacancyId: string
  source: InboundApplicationSource
  candidateName?: string | null
  vacancyTitle?: string | null
  notifier?: Notifier
}

const RECIPIENT_ROLES = ['owner', 'hr_admin', 'recruiter'] as const
const DEFAULT_INBOUND_STALE_MS = 5 * 60 * 1000

export function withInboundProcessingPending(
  externalIds: unknown,
  source: InboundApplicationSource,
  now: Date = new Date(),
): Prisma.InputJsonValue {
  return {
    ...asRecord(externalIds),
    inbound_processing: {
      status: 'pending',
      source,
      queued_at: now.toISOString(),
    },
  }
}

export async function markInboundApplicationProcessed(input: {
  prisma: DbClient
  applicationId: string
  source: InboundApplicationSource
  now?: Date
}) {
  const row = await input.prisma.application.findFirst({
    where: { id: input.applicationId },
    select: { id: true, externalIds: true },
  })
  if (!row) return { marked: false as const, reason: 'application_not_found' as const }

  await input.prisma.application.update({
    where: { id: input.applicationId },
    data: {
      externalIds: {
        ...asRecord(row.externalIds),
        inbound_processing: {
          status: 'processed',
          source: input.source,
          processed_at: (input.now ?? new Date()).toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  })

  return { marked: true as const }
}

export async function processInboundApplicationCreated(input: HandleInboundApplicationInput) {
  const result = await handleInboundApplicationCreated(input)
  await markInboundApplicationProcessed({
    prisma: input.prisma,
    applicationId: input.applicationId,
    source: input.source,
  })
  return result
}

export async function recoverPendingInboundApplications(input: {
  prisma: DbClient
  limit?: number
  staleAfterMs?: number
  process?: (job: HandleInboundApplicationInput) => Promise<unknown>
}) {
  const cutoff = Date.now() - (input.staleAfterMs ?? DEFAULT_INBOUND_STALE_MS)
  const rows = await input.prisma.application.findMany({
    where: {
      externalIds: {
        path: ['inbound_processing', 'status'],
        equals: 'pending',
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: input.limit ?? 25,
    include: {
      candidate: { select: { fullName: true } },
      vacancy: { select: { title: true } },
    },
  })

  let recovered = 0
  let skipped = 0
  const process = input.process ?? processInboundApplicationCreated

  for (const row of rows) {
    const marker = asRecord(asRecord(row.externalIds).inbound_processing)
    const queuedAt = typeof marker.queued_at === 'string' ? Date.parse(marker.queued_at) : Number.NaN
    if (Number.isFinite(queuedAt) && queuedAt > cutoff) {
      skipped += 1
      continue
    }

    const source = parseInboundSource(marker.source)
    await process({
      prisma: input.prisma,
      tenantId: row.tenantId,
      applicationId: row.id,
      candidateId: row.candidateId,
      vacancyId: row.vacancyId,
      source,
      candidateName: row.candidate.fullName,
      vacancyTitle: row.vacancy.title,
    })
    recovered += 1
  }

  return { recovered, skipped }
}

export async function handleInboundApplicationCreated(input: HandleInboundApplicationInput) {
  const { prisma, tenantId, applicationId, candidateId, vacancyId, source } = input
  const subject = buildConversationSubject(input)

  const { conversation, created } = await findOrCreateConversation({
    prisma,
    tenantId,
    candidateId,
    applicationId,
    subject,
  })

  const recipients = await findRecruitingRecipients(prisma, tenantId)
  const notifier = input.notifier ?? createNotifier(prisma)
  const payload = buildNotificationPayload({
    applicationId,
    candidateId,
    vacancyId,
    conversationId: conversation.id,
    source,
    candidateName: input.candidateName,
    vacancyTitle: input.vacancyTitle,
  })

  await Promise.all(
    recipients.map((userId) =>
      notifyInboundRecipient({
        prisma,
        notifier,
        tenantId,
        userId,
        applicationId,
        payload,
      }),
    ),
  )

  return {
    conversationId: conversation.id,
    conversationCreated: created,
    notificationsSent: recipients.length,
  }
}

async function notifyInboundRecipient(input: {
  prisma: DbClient
  notifier: Notifier
  tenantId: string
  userId: string
  applicationId: string
  payload: Prisma.InputJsonValue
}) {
  const notificationDelegate = input.prisma.notification as unknown as {
    findFirst?: (args: {
      where: {
        tenantId: string
        recipientUserId: string
        template: string
        payload: { path: string[]; equals: string }
      }
      select: { id: true }
    }) => Promise<{ id: string } | null>
  }
  const existing = await notificationDelegate.findFirst?.({
    where: {
      tenantId: input.tenantId,
      recipientUserId: input.userId,
      template: 'application.new_inbound',
      payload: {
        path: ['applicationId'],
        equals: input.applicationId,
      },
    },
    select: { id: true },
  })
  if (existing) return

  await input.notifier.notify({
    channel: 'in_app',
    recipient: { tenantId: input.tenantId, userId: input.userId },
    template: 'application.new_inbound',
    payload: input.payload,
  })
}

async function findRecruitingRecipients(prisma: DbClient, tenantId: string) {
  const rows = await prisma.userRole.findMany({
    where: {
      tenantId,
      role: { in: [...RECIPIENT_ROLES] },
      user: { disabledAt: null },
    },
    select: { userId: true },
  })

  return [...new Set(rows.map((row) => row.userId))]
}

function buildConversationSubject(input: {
  source: InboundApplicationSource
  candidateName?: string | null
  vacancyTitle?: string | null
}) {
  const sourceLabel = input.source === 'hh_ru' ? 'HH.ru' : input.source === 'careers_page' ? 'career site' : 'manual'
  const parts = [
    input.candidateName?.trim() || 'New candidate',
    input.vacancyTitle?.trim() || 'vacancy',
  ]
  return `${parts.join(' - ')} (${sourceLabel})`
}

function buildNotificationPayload(input: {
  applicationId: string
  candidateId: string
  vacancyId: string
  conversationId: string
  source: InboundApplicationSource
  candidateName?: string | null
  vacancyTitle?: string | null
}): Prisma.InputJsonValue {
  const candidateName = input.candidateName?.trim() || 'New candidate'
  const vacancyTitle = input.vacancyTitle?.trim() || 'the vacancy'
  const sourceLabel = input.source === 'hh_ru' ? 'HH.ru' : input.source === 'careers_page' ? 'career site' : 'manual intake'

  return {
    title: 'New application',
    body: `${candidateName} applied for ${vacancyTitle} via ${sourceLabel}.`,
    applicationId: input.applicationId,
    candidateId: input.candidateId,
    vacancyId: input.vacancyId,
    conversationId: input.conversationId,
    source: input.source,
  }
}

function parseInboundSource(value: unknown): InboundApplicationSource {
  return value === 'hh_ru' || value === 'careers_page' || value === 'manual' ? value : 'manual'
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
