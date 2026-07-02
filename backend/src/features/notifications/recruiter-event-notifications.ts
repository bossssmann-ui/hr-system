import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createNotifier, type NotificationChannel } from '../../services/notifier'

const FALLBACK_RECRUITER_ROLES = ['hr_admin'] as const
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000

type RecruiterRecipient = {
  userId: string
  tenantId: string
}

export async function resolveRecruiterRecipients(prisma: DbClient, input: {
  tenantId: string
  assignedToUserId: string | null
}): Promise<RecruiterRecipient[]> {
  if (input.assignedToUserId) {
    return [{ userId: input.assignedToUserId, tenantId: input.tenantId }]
  }

  const roles = await prisma.userRole.findMany({
    where: {
      tenantId: input.tenantId,
      role: { in: [...FALLBACK_RECRUITER_ROLES] },
    },
    select: { userId: true },
  })
  const uniqueUserIds = Array.from(new Set(roles.map((item) => item.userId)))
  return uniqueUserIds.map((userId) => ({ userId, tenantId: input.tenantId }))
}

export async function notifyRecipientsForEvent(input: {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  applicationId: string
  template: string
  eventKey: string
  payload?: Record<string, unknown>
}) {
  const { prisma, env, tenantId, applicationId, template, eventKey } = input

  try {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, tenantId },
      select: { id: true, assignedToUserId: true },
    })
    if (!application) return

    const recipients = await resolveRecruiterRecipients(prisma, {
      tenantId,
      assignedToUserId: application.assignedToUserId,
    })
    if (recipients.length === 0) return

    const payload = {
      ...(input.payload ?? {}),
      applicationId: application.id,
      eventKey,
    } as Prisma.InputJsonValue

    const notifier = createNotifier(prisma, undefined, { env })
    const channels = buildChannels(env)

    await Promise.all(
      recipients.map(async (recipient) => {
        const duplicate = await hasRecentUnreadDuplicate(prisma, {
          tenantId,
          recipientUserId: recipient.userId,
          template,
          applicationId: application.id,
          eventKey,
        })
        if (duplicate) return

        for (const channel of channels) {
          await notifier.notify({
            channel,
            recipient,
            template,
            payload,
          })
        }
      }),
    )
  } catch (error) {
    await prisma.auditEvent.create({
      data: {
        tenantId,
        actorUserId: null,
        action: 'notification.dispatch_failed',
        entityType: 'Application',
        entityId: applicationId,
        diff: {
          template,
          eventKey,
          error: toErrorMessage(error),
        } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)
  }
}

function buildChannels(env: AppEnv): NotificationChannel[] {
  const channels: NotificationChannel[] = ['in_app']
  if (env.MOBILE_PUSH_ENABLED) channels.push('push')
  return channels
}

async function hasRecentUnreadDuplicate(prisma: DbClient, input: {
  tenantId: string
  recipientUserId: string
  template: string
  applicationId: string
  eventKey: string
}) {
  const rows = await prisma.notification.findMany({
    where: {
      tenantId: input.tenantId,
      recipientUserId: input.recipientUserId,
      channel: 'in_app',
      template: input.template,
      readAt: null,
      createdAt: {
        gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS),
      },
    },
    select: { payload: true },
  })

  return rows.some((row) => {
    if (!isRecord(row.payload)) return false
    return row.payload.applicationId === input.applicationId && row.payload.eventKey === input.eventKey
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error'
}
