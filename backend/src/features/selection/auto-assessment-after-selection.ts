/**
 * Phase 18 PR 3 — Auto-assign assessment sessions after a selection session passes.
 *
 * Triggered when a selection session completes with a passing verdict (ДОПУСТИТЬ)
 * for both domestic and non-domestic paths.
 *
 * Guarded by `AUTO_ASSESSMENT_ENABLED` (default false).
 */

import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { getChannelAdapter } from '../messaging/messaging.service'
import { resolvePipelineFlag } from '../tenant/resolve-pipeline-flag'
import {
  resolvePreferredChannel,
  resolveDestination,
  resolveHhAccessToken,
} from './auto-selection-after-scoring'

type SendAutoAssessmentInviteInput = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  channel: 'hh_chat' | 'email'
  destination: string
  token: string
}

type RunAutoAssessmentAfterSelectionInput = {
  prisma: DbClient
  env: AppEnv
  applicationId: string | null
  actorUserId?: string
  /** Injected in tests to avoid real channel sends. */
  sendInvite?: (input: SendAutoAssessmentInviteInput) => Promise<void>
}

export async function sendAutoAssessmentInvite(input: SendAutoAssessmentInviteInput) {
  const hhAccessToken = await resolveHhAccessToken(input.prisma, input.env, input.tenantId)
  const adapter = getChannelAdapter(input.channel, input.env, hhAccessToken ?? undefined)
  if (!adapter) throw new Error(`adapter_unavailable:${input.channel}`)

  const link = buildAssessmentLink(input.env, input.token)
  const body = `Здравствуйте! Пройдите оценку по ссылке: ${link}`
  const result = await adapter.send({
    destination: input.destination,
    body,
    subject: 'Ссылка на этап оценки',
  })

  if (result.status !== 'sent') {
    throw new Error(result.failureReason ?? 'delivery_failed')
  }
}

function buildAssessmentLink(env: AppEnv, token: string) {
  const origin = env.CORS_ORIGINS[0]
  if (!origin) return `/assessment/${token}`
  return `${origin.replace(/\/$/, '')}/assessment/${token}`
}

/**
 * After a selection session passes (verdict ДОПУСТИТЬ), idempotently create
 * AssessmentSession records for each template in `vacancy.requiredAssessmentTemplateIds`
 * and send candidate invitation links.
 *
 * This function is best-effort: errors are caught and logged so they never
 * propagate to the caller or rollback the selection completion.
 */
export async function runAutoAssessmentAfterSelection(input: RunAutoAssessmentAfterSelectionInput): Promise<void> {
  const { prisma, env, applicationId, actorUserId } = input

  if (!applicationId) {
    return
  }

  try {
    const application = await prisma.application.findFirst({
      where: { id: applicationId },
      include: {
        candidate: true,
        vacancy: true,
      },
    })
    if (!application) return

    const tenantSettings = await prisma.tenantSettings.findUnique({
      where: { tenantId: application.tenantId },
      select: { featureFlags: true },
    })

    if (!resolvePipelineFlag('autoAssessment', tenantSettings?.featureFlags, env)) {
      return
    }

    const templateIds = application.vacancy.requiredAssessmentTemplateIds
    if (!templateIds || templateIds.length === 0) return

    const channel = resolvePreferredChannel(application.externalIds, application.candidate.externalIds)
    const destination = resolveDestination(channel, application.externalIds, application.candidate.externalIds, application.candidate.email)

    for (const templateId of templateIds) {
      // Idempotent: skip if an active (non-expired) session already exists for (applicationId, templateId)
      const existing = await prisma.assessmentSession.findFirst({
        where: {
          applicationId,
          templateId,
          status: { notIn: ['expired'] },
        },
        select: { id: true },
      })
      if (existing) continue

      const token = randomUUID().replaceAll('-', '')
      await prisma.assessmentSession.create({
        data: {
          tenantId: application.tenantId,
          templateId,
          applicationId,
          inviteToken: token,
          status: 'invited',
        },
      })

      try {
        if (!destination) throw new Error(`destination_unavailable:${channel}`)
        const sendInvite = input.sendInvite ?? sendAutoAssessmentInvite
        await sendInvite({
          prisma,
          env,
          tenantId: application.tenantId,
          channel,
          destination,
          token,
        })
      } catch (deliveryError) {
        await prisma.auditEvent.create({
          data: {
            tenantId: application.tenantId,
            actorUserId: actorUserId ?? null,
            action: 'application.auto_assessment_delivery_failed',
            entityType: 'Application',
            entityId: application.id,
            diff: {
              templateId,
              channel,
              error: toErrorMessage(deliveryError),
            } as Prisma.InputJsonValue,
          },
        })
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'auto_assessment.failed', applicationId, err: String(err) }))
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error'
}
