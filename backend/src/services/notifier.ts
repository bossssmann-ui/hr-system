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
import type { AppEnv } from '../env'
import { createExpoPushClient, type ExpoPushClient, type ExpoPushMessage } from '../integrations/expo/push-client'
import { getRealtimeBus } from './realtime'

export type NotificationChannel = 'email' | 'telegram' | 'in_app' | 'push'

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

export type CreateNotifierOptions = {
  env?: AppEnv
  pushClient?: ExpoPushClient
}

export function createNotifier(
  prisma: DbClient,
  logger: Logger = defaultLogger,
  options: CreateNotifierOptions = {},
): Notifier {
  const pushClient =
    options.pushClient ??
    (options.env && options.env.MOBILE_PUSH_ENABLED
      ? createExpoPushClient({ apiUrl: options.env.EXPO_PUSH_API_URL })
      : null)
  const pushEnabled = options.env?.MOBILE_PUSH_ENABLED ?? Boolean(options.pushClient)

  return {
    async notify(input) {
      const { channel, recipient, template, payload = {} as Prisma.InputJsonValue } = input
      switch (channel) {
        case 'in_app': {
          try {
            const row = await prisma.notification.create({
              data: {
                tenantId: recipient.tenantId,
                recipientUserId: recipient.userId,
                channel: 'in_app',
                template,
                payload,
              },
            })
            // Realtime fan-out: best-effort, never blocks the business call.
            try {
              const createdAt =
                row.createdAt instanceof Date
                  ? row.createdAt.toISOString()
                  : typeof row.createdAt === 'string'
                    ? row.createdAt
                    : new Date().toISOString()
              getRealtimeBus().publishToUser(recipient.tenantId, recipient.userId, {
                type: 'notification.new',
                payload: {
                  id: row.id,
                  template: row.template,
                  payload: row.payload,
                  createdAt,
                },
              })
            } catch (err) {
              logger.warn({ err, template, recipient }, 'notifier.in_app.realtime_publish_failed')
            }
          } catch (err) {
            logger.error(
              { err, template, recipient },
              'notifier.in_app.write_failed',
            )
          }
          return
        }
        case 'push': {
          // Mobile push channel (Expo). Gated by MOBILE_PUSH_ENABLED.
          // Always best-effort: a delivery failure never throws into the
          // business transaction (same contract as in_app / email).
          if (!pushEnabled || !pushClient) {
            logger.warn(
              { channel, template, recipient },
              'notifier.push.disabled',
            )
            return
          }
          try {
            const devices = await prisma.deviceToken.findMany({
              where: {
                tenantId: recipient.tenantId,
                userId: recipient.userId,
                isActive: true,
              },
              select: { token: true },
            })
            if (devices.length === 0) {
              return
            }
            const { title, body, data } = derivePushContent(template, payload)
            const messages: ExpoPushMessage[] = devices.map((d) => ({
              to: d.token,
              title,
              body,
              data,
            }))
            const result = await pushClient.send(messages)
            if (result.invalidTokens.length > 0) {
              await prisma.deviceToken.updateMany({
                where: {
                  tenantId: recipient.tenantId,
                  userId: recipient.userId,
                  token: { in: result.invalidTokens },
                },
                data: { isActive: false },
              })
            }
            if (!result.ok) {
              logger.warn(
                { template, recipient, invalid: result.invalidTokens.length },
                'notifier.push.partial_delivery',
              )
            }
          } catch (err) {
            logger.error(
              { err, template, recipient },
              'notifier.push.send_failed',
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

/**
 * Turn a notification template + payload into an Expo push message.
 *
 * Falls back to a generic title/body so unmapped templates still deliver a
 * notification rather than an empty one. Producers can override title/body
 * via `payload.title` / `payload.body`.
 */
function derivePushContent(template: string, payload: Prisma.InputJsonValue) {
  const obj =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  const title =
    typeof obj.title === 'string' && obj.title.trim() !== ''
      ? obj.title
      : prettifyTemplate(template)
  const body =
    typeof obj.body === 'string' && obj.body.trim() !== ''
      ? obj.body
      : 'Open the app for details.'
  const data: Record<string, unknown> = { template, ...obj }
  return { title, body, data }
}

function prettifyTemplate(template: string) {
  return template
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || 'Notification'
}
