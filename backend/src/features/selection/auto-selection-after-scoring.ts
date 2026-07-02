import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { decryptHhSecret } from '../../integrations/hh/crypto'
import { getChannelAdapter } from '../messaging/messaging.service'
import { createSelectionSession } from './selection-session.service'
import { parseSupportedRole } from './selection-role-adapter'
import { notifyRecipientsForEvent } from '../notifications/recruiter-event-notifications'

type SendAutoSelectionInviteInput = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  channel: 'hh_chat' | 'email'
  destination: string
  token: string
}

type RunAutoSelectionAfterScoringInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string
  actorUserId?: string
  relevanceScore: number
  sendInvite?: (input: SendAutoSelectionInviteInput) => Promise<void>
}

export async function runAutoSelectionAfterScoring(input: RunAutoSelectionAfterScoringInput) {
  const { prisma, env, applicationId, actorUserId, relevanceScore } = input

  if (!env.AUTO_SELECTION_ENABLED) {
    return { applied: false as const, reason: 'disabled' as const }
  }

  const application = await prisma.application.findFirst({
    where: { id: applicationId },
    include: {
      candidate: true,
      vacancy: true,
    },
  })
  if (!application) {
    return { applied: false as const, reason: 'application_not_found' as const }
  }

  const role = parseSupportedRole(application.vacancy.role)
  if (!role) {
    return { applied: false as const, reason: 'unsupported_role' as const }
  }

  try {
    if (relevanceScore >= env.AUTO_SELECTION_THRESHOLD) {
      const { session, created } = await createSelectionSession({
        prisma,
        tenantId: application.tenantId,
        vacancyId: application.vacancyId,
        role,
        applicationId: application.id,
      })

      if (!created) {
        return { applied: true as const, action: 'session_reused' as const }
      }

      const channel = resolvePreferredChannel(application.externalIds, application.candidate.externalIds)
      const destination = resolveDestination(channel, application.externalIds, application.candidate.externalIds, application.candidate.email)

      try {
        if (!destination) throw new Error(`destination_unavailable:${channel}`)
        const sendInvite = input.sendInvite ?? sendAutoSelectionInvite
        await sendInvite({
          prisma,
          env,
          tenantId: application.tenantId,
          channel,
          destination,
          token: session.token,
        })
      } catch (deliveryError) {
        await prisma.auditEvent.create({
          data: {
            tenantId: application.tenantId,
            actorUserId: actorUserId ?? null,
            action: 'application.auto_selection_delivery_failed',
            entityType: 'Application',
            entityId: application.id,
            diff: {
              relevance_score: relevanceScore,
              channel,
              error: toErrorMessage(deliveryError),
            } as Prisma.InputJsonValue,
          },
        })
      }

      return { applied: true as const, action: 'session_created' as const }
    }

    if (relevanceScore < env.AUTO_REJECT_THRESHOLD) {
      if (application.stage !== 'rejected') {
        await prisma.application.update({
          where: { id: application.id },
          data: { stage: 'rejected' },
        })
      }

      await prisma.auditEvent.create({
        data: {
          tenantId: application.tenantId,
          actorUserId: actorUserId ?? null,
          action: 'application.auto_rejected',
          entityType: 'Application',
          entityId: application.id,
          diff: {
            reason: 'auto_reject_low_relevance',
            relevance_score: relevanceScore,
          } as Prisma.InputJsonValue,
        },
      })

      if (env.RECRUITER_NOTIFICATIONS_ENABLED) {
        await notifyRecipientsForEvent({
          prisma,
          env,
          tenantId: application.tenantId,
          applicationId: application.id,
          template: 'application.auto_rejected',
          eventKey: `application.auto_rejected:${application.id}`,
          payload: {
            reason: 'auto_reject_low_relevance',
            relevanceScore,
          },
        })
      }

      return { applied: true as const, action: 'auto_rejected' as const }
    }

    return { applied: false as const, reason: 'manual_review_range' as const }
  } catch (error) {
    await prisma.auditEvent.create({
      data: {
        tenantId: application.tenantId,
        actorUserId: actorUserId ?? null,
        action: 'application.auto_selection_failed',
        entityType: 'Application',
        entityId: application.id,
        diff: {
          relevance_score: relevanceScore,
          error: toErrorMessage(error),
        } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined)

    return { applied: false as const, reason: 'pipeline_failed' as const }
  }
}

export async function sendAutoSelectionInvite(input: SendAutoSelectionInviteInput) {
  const hhAccessToken = await resolveHhAccessToken(input.prisma, input.env, input.tenantId)
  const adapter = getChannelAdapter(input.channel, input.env, hhAccessToken ?? undefined)
  if (!adapter) throw new Error(`adapter_unavailable:${input.channel}`)

  const link = buildSelectionLink(input.env, input.token)
  const body = `Здравствуйте! Продолжите отбор по ссылке: ${link}`
  const result = await adapter.send({
    destination: input.destination,
    body,
    subject: 'Ссылка на этап отбора',
  })

  if (result.status !== 'sent') {
    throw new Error(result.failureReason ?? 'delivery_failed')
  }
}

export function resolvePreferredChannel(applicationExternalIds: unknown, candidateExternalIds: unknown): 'hh_chat' | 'email' {
  const appIds = asRecord(applicationExternalIds)
  if (typeof appIds.hh_negotiation_id === 'string' && appIds.hh_negotiation_id.length > 0) {
    return 'hh_chat'
  }

  const candidateIds = asRecord(candidateExternalIds)
  for (const [key, value] of Object.entries(candidateIds)) {
    if (key.startsWith('hh_') && typeof value === 'string' && value.length > 0) {
      return 'hh_chat'
    }
  }

  return 'email'
}

export function resolveDestination(
  channel: 'hh_chat' | 'email',
  applicationExternalIds: unknown,
  candidateExternalIds: unknown,
  candidateEmail: string | null,
) {
  if (channel === 'email') return candidateEmail
  const appIds = asRecord(applicationExternalIds)
  const candidateIds = asRecord(candidateExternalIds)
  return firstString(candidateIds.hh_messages_url, appIds.hh_messages_url)
}

export function buildSelectionLink(env: AppEnv, token: string) {
  const origin = env.CORS_ORIGINS[0]
  if (!origin) return `/selection/${token}`
  return `${origin.replace(/\/$/, '')}/selection/${token}`
}

export async function resolveHhAccessToken(prisma: DbClient, env: AppEnv, tenantId: string): Promise<string | null> {
  if (!env.HH_TOKEN_ENCRYPTION_KEY) return null
  const connection = await prisma.hhConnection.findUnique({
    where: { tenantId },
    select: { accessToken: true },
  })
  if (!connection) return null
  try {
    return decryptHhSecret(connection.accessToken, env.HH_TOKEN_ENCRYPTION_KEY)
  } catch {
    return null
  }
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error'
}
