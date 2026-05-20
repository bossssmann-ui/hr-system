/**
 * Notifier abstraction.
 *
 * Phase 0 only implements the `in_app` channel, which writes a row to the
 * `Notification` table. `email` and `telegram` channels are stubs that log
 * "not implemented" at warn level — the call sites must not change when the
 * real transports land in Phase 1+.
 *
 * Design intent (see docs/contracts/00-overview.md):
 *   - Adding new channels is a Notifier-internal change; producers keep
 *     calling `notify(channel, recipient, template, payload)`.
 *   - Future real-time delivery (Valkey Pub/Sub) is layered on top of the
 *     in-app channel without touching producers.
 *   - Failure to write a notification is logged but does NOT roll back the
 *     business transaction (same contract as the audit log).
 */

import { Prisma } from '../generated/prisma/client'
import type { DbClient } from '../db'

export type NotificationChannel = 'email' | 'telegram' | 'in_app'

export type NotifyInput = {
  channel: NotificationChannel
  recipient: { userId: string; tenantId: string }
  template: string
  payload?: Prisma.InputJsonValue
}

export interface Notifier {
  notify(input: NotifyInput): Promise<void>
}

type Logger = {
  warn: (data: Record<string, unknown>, msg: string) => void
  error: (data: Record<string, unknown>, msg: string) => void
}

const defaultLogger: Logger = {
  warn: (data, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...data })),
  error: (data, msg) => console.error(JSON.stringify({ level: 'error', msg, ...data })),
}

export function createNotifier(prisma: DbClient, logger: Logger = defaultLogger): Notifier {
  return {
    async notify(input) {
      const { channel, recipient, template, payload = {} as Prisma.InputJsonValue } = input
      switch (channel) {
        case 'in_app': {
          try {
            await prisma.notification.create({
              data: {
                tenantId: recipient.tenantId,
                recipientUserId: recipient.userId,
                channel: 'in_app',
                template,
                payload,
              },
            })
          } catch (err) {
            logger.error(
              { err, template, recipient },
              'notifier.in_app.write_failed',
            )
          }
          return
        }
        case 'email':
        case 'telegram': {
          logger.warn(
            { channel, template, recipient },
            'notifier.channel_not_implemented',
          )
          return
        }
        default: {
          // Exhaustiveness: TypeScript will error here if a new channel is
          // added to the enum without a switch arm.
          const _exhaustive: never = channel
          void _exhaustive
        }
      }
    },
  }
}
