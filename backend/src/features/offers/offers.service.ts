/**
 * Offers service — Phase 3.
 *
 * Encapsulates Offer FSM transitions with audit + notifier side-effects. The
 * service is callable from HTTP routes, the DocuSeal webhook, and the cron
 * expirer; each entry-point passes a `prisma` client (so it can participate
 * in the caller's transaction) and an actor id (nullable for system actions).
 */

import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import { createDocusealClient, type DocusealClient } from '../../integrations/docuseal/client'
import { createNotifier, type Notifier } from '../../services/notifier'
import { createFromApplication } from '../employees/employees.service'
import type { Role } from '../requisitions/requisitions.fsm'
import { canTransition, type OfferStatus } from './offers.fsm'

export const OFFER_EXPIRY_DAYS = 7

type PrismaLike = Pick<
  DbClient,
  | 'offer'
  | 'application'
  | 'applicationStageEvent'
  | 'candidate'
  | 'user'
  | 'userRole'
  | 'auditEvent'
  | 'notification'
  | '$transaction'
>

export type OfferTransitionContext = {
  prisma: DbClient
  env?: AppEnv
  tenantId: string
  offerId: string
  actorRoles: ReadonlyArray<Role>
  actorUserId: string | null
  notifier?: Notifier
  docuseal?: DocusealClient
  reason?: string | null
  now?: Date
}

class FsmDeniedError extends Error {
  constructor(public from: OfferStatus, public to: OfferStatus) {
    super(`Transition from '${from}' to '${to}' is not allowed`)
    this.name = 'FsmDeniedError'
  }
}

export const FsmDenied = FsmDeniedError

async function loadOffer(prisma: PrismaLike, tenantId: string, offerId: string) {
  return prisma.offer.findFirst({ where: { id: offerId, tenantId } })
}

async function findCandidateUserId(
  prisma: PrismaLike,
  tenantId: string,
  candidateEmail: string | null,
): Promise<string | null> {
  if (!candidateEmail) return null
  const user = await prisma.user.findFirst({
    where: {
      email: candidateEmail,
      roles: { some: { tenantId, role: 'candidate' } },
    },
    select: { id: true },
  })
  return user?.id ?? null
}

async function writeAudit(
  prisma: PrismaLike,
  tenantId: string,
  actorUserId: string | null,
  action: string,
  entityId: string,
  diff: unknown,
) {
  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorUserId: actorUserId ?? null,
      action,
      entityType: 'Offer',
      entityId,
      diff: (diff ?? {}) as Prisma.InputJsonValue,
    },
  })
}

async function notifyBestEffort(
  notifier: Notifier | undefined,
  channels: Array<'in_app' | 'email'>,
  recipient: { userId: string; tenantId: string },
  template: string,
  payload: Record<string, unknown>,
) {
  if (!notifier) return
  for (const channel of channels) {
    try {
      await notifier.notify({
        channel,
        recipient,
        template,
        payload: payload as Prisma.InputJsonValue,
      })
    } catch (err) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'offer.notify.failed', err: String(err), template, channel }))
    }
  }
}

function offerNotificationChannels(env: AppEnv | undefined): Array<'in_app' | 'email'> {
  const channels: Array<'in_app' | 'email'> = ['in_app']
  if (env?.EMAIL_ENABLED) channels.push('email')
  return channels
}

export async function submitOffer(ctx: OfferTransitionContext) {
  return runSimpleTransition(ctx, 'manager_review', 'offer.submit', {})
}

export async function approveOffer(ctx: OfferTransitionContext) {
  return runSimpleTransition(ctx, 'approved', 'offer.approve', {})
}

export async function rejectOffer(ctx: OfferTransitionContext) {
  return runSimpleTransition(ctx, 'draft', 'offer.reject', { reason: ctx.reason ?? null })
}

export async function recallOfferToDraft(ctx: OfferTransitionContext) {
  return runSimpleTransition(ctx, 'draft', 'offer.update', { reason: ctx.reason ?? null })
}

async function runSimpleTransition(
  ctx: OfferTransitionContext,
  to: OfferStatus,
  action: string,
  diff: Record<string, unknown>,
) {
  const { prisma, tenantId, offerId, actorRoles, actorUserId } = ctx
  const offer = await loadOffer(prisma, tenantId, offerId)
  if (!offer) throw new Error(`Offer ${offerId} not found`)
  if (!canTransition(offer.status as OfferStatus, to, actorRoles)) {
    throw new FsmDeniedError(offer.status as OfferStatus, to)
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.offer.update({
      where: { id: offerId },
      data: { status: to },
    })
    await writeAudit(tx as unknown as PrismaLike, tenantId, actorUserId, action, offerId, {
      from: offer.status,
      to,
      ...diff,
    })
    return next
  })
  return updated
}

export async function sendOffer(ctx: OfferTransitionContext) {
  const { prisma, tenantId, offerId, actorRoles, actorUserId, env, now = new Date() } = ctx
  const offer = await loadOffer(prisma, tenantId, offerId)
  if (!offer) throw new Error(`Offer ${offerId} not found`)
  if (!canTransition(offer.status as OfferStatus, 'sent', actorRoles)) {
    throw new FsmDeniedError(offer.status as OfferStatus, 'sent')
  }

  const expiresAt = new Date(now.getTime() + OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  // DocuSeal submission is created outside the transaction so a network
  // failure rolls the offer back via thrown error, but a slow API call
  // doesn't hold a DB transaction open.
  let docusealSubmissionId: string | null = null
  let docusealSigningUrl: string | null = null
  let docusealDocumentUrl: string | null = null

  const docuseal = ctx.docuseal ?? (env ? createDocusealClient(env) : undefined)
  if (docuseal?.enabled && docuseal.templateId) {
    const application = await prisma.application.findFirst({
      where: { id: offer.applicationId, tenantId },
      include: { candidate: true },
    })
    const candidate = application?.candidate
    const submission = await docuseal.createSubmission({
      templateId: docuseal.templateId,
      signerEmail: candidate?.email ?? null,
      signerName: candidate?.fullName ?? null,
      sendEmail: false,
      prefilled: {
        salary: offer.salary,
        currency: offer.currency,
        start_date: offer.startDate.toISOString().slice(0, 10),
        grade: offer.grade ?? '',
      },
    })
    docusealSubmissionId = submission.id
    docusealSigningUrl = submission.signingUrl
    docusealDocumentUrl = submission.documentUrl
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.offer.update({
      where: { id: offerId },
      data: {
        status: 'sent',
        sentAt: now,
        expiresAt,
        docusealSubmissionId,
        docusealSigningUrl,
        docusealDocumentUrl,
      },
    })
    await writeAudit(tx as unknown as PrismaLike, tenantId, actorUserId, 'offer.send', offerId, {
      from: offer.status,
      to: 'sent',
      expiresAt: expiresAt.toISOString(),
      docuseal: docuseal?.enabled ?? false,
    })
    return next
  })

  // Notify candidate (best-effort; outside transaction).
  const application = await prisma.application.findFirst({
    where: { id: offer.applicationId, tenantId },
    include: { candidate: { select: { email: true } } },
  })
  const candidateUserId = await findCandidateUserId(prisma, tenantId, application?.candidate.email ?? null)
  if (candidateUserId) {
    const notifier = ctx.notifier ?? createNotifier(prisma)
    await notifyBestEffort(
      notifier,
      offerNotificationChannels(env),
      { userId: candidateUserId, tenantId },
      'offer.sent',
      {
        offerId,
        signingUrl: docusealSigningUrl,
        expiresAt: expiresAt.toISOString(),
      },
    )
  }

  return updated
}

export async function acceptOffer(ctx: OfferTransitionContext) {
  const { prisma, tenantId, offerId, actorRoles, actorUserId, env, now = new Date() } = ctx
  const offer = await loadOffer(prisma, tenantId, offerId)
  if (!offer) throw new Error(`Offer ${offerId} not found`)
  if (!canTransition(offer.status as OfferStatus, 'accepted', actorRoles)) {
    throw new FsmDeniedError(offer.status as OfferStatus, 'accepted')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.offer.update({
      where: { id: offerId },
      data: { status: 'accepted', acceptedAt: now },
    })
    await writeAudit(tx as unknown as PrismaLike, tenantId, actorUserId, 'offer.accept', offerId, {
      from: offer.status,
      to: 'accepted',
    })

    // Move the Application → hired and run the hired side-effect.
    const application = await tx.application.findFirst({ where: { id: offer.applicationId, tenantId } })
    if (application && application.stage !== 'hired' && application.stage !== 'rejected') {
      const fromStage = application.stage
      const eventActor = actorUserId ?? offer.createdByUserId
      await tx.application.update({ where: { id: application.id }, data: { stage: 'hired' } })
      await tx.applicationStageEvent.create({
        data: {
          tenantId,
          applicationId: application.id,
          fromStage,
          toStage: 'hired',
          actorUserId: eventActor,
          comment: 'offer accepted',
        },
      })
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: actorUserId ?? null,
          action: 'application.move_stage',
          entityType: 'Application',
          entityId: application.id,
          diff: { from: fromStage, to: 'hired', via: 'offer.accept', offerId },
        },
      })
      await createFromApplication({
        prisma: tx as unknown as DbClient,
        applicationId: application.id,
        actorUserId: actorUserId ?? undefined,
        tenantId,
      })
    }
    return next
  })

  // Notify candidate
  const application = await prisma.application.findFirst({
    where: { id: offer.applicationId, tenantId },
    include: { candidate: { select: { email: true } } },
  })
  const candidateUserId = await findCandidateUserId(prisma, tenantId, application?.candidate.email ?? null)
  if (candidateUserId) {
    const notifier = ctx.notifier ?? createNotifier(prisma)
    await notifyBestEffort(
      notifier,
      offerNotificationChannels(env),
      { userId: candidateUserId, tenantId },
      'offer.accepted',
      { offerId },
    )
  }

  return updated
}

export async function declineOffer(ctx: OfferTransitionContext) {
  const { prisma, tenantId, offerId, actorRoles, actorUserId, env, now = new Date(), reason } = ctx
  const offer = await loadOffer(prisma, tenantId, offerId)
  if (!offer) throw new Error(`Offer ${offerId} not found`)
  if (!canTransition(offer.status as OfferStatus, 'declined', actorRoles)) {
    throw new FsmDeniedError(offer.status as OfferStatus, 'declined')
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.offer.update({
      where: { id: offerId },
      data: { status: 'declined', declinedAt: now, declinedReason: reason ?? null },
    })
    await writeAudit(tx as unknown as PrismaLike, tenantId, actorUserId, 'offer.decline', offerId, {
      from: offer.status,
      to: 'declined',
      reason: reason ?? null,
    })

    const application = await tx.application.findFirst({ where: { id: offer.applicationId, tenantId } })
    if (application && application.stage !== 'rejected' && application.stage !== 'hired') {
      const fromStage = application.stage
      const eventActor = actorUserId ?? offer.createdByUserId
      await tx.application.update({ where: { id: application.id }, data: { stage: 'rejected' } })
      await tx.applicationStageEvent.create({
        data: {
          tenantId,
          applicationId: application.id,
          fromStage,
          toStage: 'rejected',
          actorUserId: eventActor,
          comment: reason ?? 'offer declined',
        },
      })
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: actorUserId ?? null,
          action: 'application.move_stage',
          entityType: 'Application',
          entityId: application.id,
          diff: { from: fromStage, to: 'rejected', via: 'offer.decline', offerId },
        },
      })
    }
    return next
  })

  const application = await prisma.application.findFirst({
    where: { id: offer.applicationId, tenantId },
    include: { candidate: { select: { email: true } } },
  })
  const candidateUserId = await findCandidateUserId(prisma, tenantId, application?.candidate.email ?? null)
  if (candidateUserId) {
    const notifier = ctx.notifier ?? createNotifier(prisma)
    await notifyBestEffort(
      notifier,
      offerNotificationChannels(env),
      { userId: candidateUserId, tenantId },
      'offer.declined',
      { offerId, reason: reason ?? null },
    )
  }

  return updated
}

export async function expireOffer(ctx: OfferTransitionContext) {
  const { prisma, tenantId, offerId, actorRoles, actorUserId } = ctx
  const offer = await loadOffer(prisma, tenantId, offerId)
  if (!offer) throw new Error(`Offer ${offerId} not found`)
  if (!canTransition(offer.status as OfferStatus, 'expired', actorRoles)) {
    throw new FsmDeniedError(offer.status as OfferStatus, 'expired')
  }
  return prisma.$transaction(async (tx) => {
    const next = await tx.offer.update({ where: { id: offerId }, data: { status: 'expired' } })
    await writeAudit(tx as unknown as PrismaLike, tenantId, actorUserId, 'offer.expire', offerId, {
      from: offer.status,
      to: 'expired',
    })
    return next
  })
}

/**
 * Cron entry-point: find every `sent` offer whose `expires_at` has passed
 * and transition it to `expired`. Acts as `hr_admin` (system actor).
 */
export async function expireOverdueOffers(input: { prisma: DbClient; now?: Date }) {
  const { prisma, now = new Date() } = input
  const due = await prisma.offer.findMany({
    where: { status: 'sent', expiresAt: { lt: now } },
    select: { id: true, tenantId: true },
  })
  let expired = 0
  for (const row of due) {
    try {
      await expireOffer({
        prisma,
        tenantId: row.tenantId,
        offerId: row.id,
        actorRoles: ['hr_admin'],
        actorUserId: null,
        now,
      })
      expired += 1
    } catch (err) {
      console.warn(
        JSON.stringify({ level: 'warn', msg: 'offer.expire.failed', offerId: row.id, err: String(err) }),
      )
    }
  }
  return { matched: due.length, expired }
}
