/**
 * Messaging queue — Phase 1E.
 *
 * Handles async delivery of outbound messages via channel adapters.
 * Status transitions: queued → sent | failed.
 * Automated sends respect Quiet Hours (configurable; default 15:00–23:00 UTC); manual sends bypass.
 *
 * TODO(phase-N): replace createInMemoryQueue with BullMQ + Valkey.
 */
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { createInMemoryQueue } from '../../queues'
import type { MessageChannelAdapter } from '../../integrations/messaging'
import { msUntilQuietHoursEnd, quietHoursConfigFromEnv } from './quiet-hours'

export type MessageSendJob = {
  prisma: DbClient
  env: AppEnv
  messageId: string
  channel: string
  destination: string
  body: string
  subject?: string
  /** When true, Quiet Hours deferral applies. */
  automated: boolean
  /** Injected adapter — undefined means use the runtime adapter from env. */
  adapter?: MessageChannelAdapter
  /** Injected clock for testing. */
  now?: () => Date
}

const messageQueue = createInMemoryQueue<MessageSendJob>('messaging.send')
let messageQueueRegistered = false

function ensureMessageQueueRegistered() {
  if (messageQueueRegistered) return
  messageQueueRegistered = true

  messageQueue.process(async (job) => {
    await dispatchMessage(job)
  })
}

export async function dispatchMessage(job: MessageSendJob): Promise<void> {
  const { prisma, env, messageId, channel, destination, body, subject, automated, adapter } = job
  const now = (job.now ?? (() => new Date))()

  if (automated) {
    const delayMs = msUntilQuietHoursEnd(now, quietHoursConfigFromEnv(env))
    if (delayMs > 0) {
      // Re-enqueue after quiet hours end.
      ensureMessageQueueRegistered()
      await messageQueue.enqueue({ ...job, automated: true }, { delayMs })
      return
    }
  }

  if (!adapter) {
    // No adapter provided; mark as failed.
    await prisma.message.update({
      where: { id: messageId },
      data: { status: 'failed' },
    })
    return
  }

  try {
    const result = await adapter.send({ destination, body, subject })

    await prisma.message.update({
      where: { id: messageId },
      data: {
        status: result.status === 'sent' ? 'sent' : 'failed',
        externalId: result.externalId ?? undefined,
        sentAt: result.status === 'sent' ? new Date() : undefined,
      },
    })

    // Emit audit event for sent messages.
    if (result.status === 'sent') {
      const message = await prisma.message.findUnique({ where: { id: messageId } })
      if (message) {
        await prisma.auditEvent.create({
          data: {
            tenantId: message.tenantId,
            actorUserId: message.senderUserId ?? null,
            action: 'message.sent',
            entityType: 'Message',
            entityId: message.id,
            diff: { channel, direction: 'outbound', status: 'sent' },
          },
        })
      }
    }
  } catch {
    await prisma.message.update({
      where: { id: messageId },
      data: { status: 'failed' },
    }).catch(() => {
      // Best-effort — don't crash the queue worker.
    })
  }
}

export async function enqueueMessageSend(
  job: MessageSendJob,
  opts?: { delayMs?: number },
): Promise<void> {
  ensureMessageQueueRegistered()
  await messageQueue.enqueue(job, opts)
}

ensureMessageQueueRegistered()
