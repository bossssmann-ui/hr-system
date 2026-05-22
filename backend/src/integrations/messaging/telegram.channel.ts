/**
 * TelegramChannel — outbound via Telegram Bot API.
 *
 * Inbound: webhook endpoint `POST /api/integrations/telegram/webhook`.
 * The webhook is registered once per deployment with:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_BACKEND>/api/integrations/telegram/webhook
 *
 * Candidate ↔ chat mapping: store `telegram_chat_id` in `Candidate.externalIds`
 * as `{ "telegram_chat_id": "<id>" }`.
 *
 * Gated by `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN` env vars.
 */
import type { MessageChannelAdapter, SendInput, SendResult } from './channel'

type TelegramTransport = (url: string, body: unknown) => Promise<{ ok: boolean; result?: { message_id?: number } }>

const DEFAULT_TIMEOUT_MS = 10_000

function createFetchTransport(botToken: string): TelegramTransport {
  const baseUrl = `https://api.telegram.org/bot${botToken}`
  return async (method, body) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const response = await fetch(`${baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      return response.json() as Promise<{ ok: boolean; result?: { message_id?: number } }>
    } finally {
      clearTimeout(timeout)
    }
  }
}

type TelegramChannelOptions = {
  botToken: string
  transport?: TelegramTransport
}

export class TelegramChannel implements MessageChannelAdapter {
  readonly channelName = 'telegram'
  private readonly transport: TelegramTransport

  constructor(options: TelegramChannelOptions) {
    this.transport = options.transport ?? createFetchTransport(options.botToken)
  }

  async send(input: SendInput): Promise<SendResult> {
    const chatId = input.destination
    if (!chatId) {
      return { externalId: null, status: 'failed', failureReason: 'No telegram_chat_id on candidate' }
    }

    try {
      const response = await this.transport('sendMessage', {
        chat_id: chatId,
        text: input.body,
        parse_mode: 'Markdown',
      })

      if (!response.ok) {
        return { externalId: null, status: 'failed', failureReason: 'Telegram API returned ok=false' }
      }

      return {
        externalId: response.result?.message_id?.toString() ?? null,
        status: 'sent',
      }
    } catch (err) {
      return {
        externalId: null,
        status: 'failed',
        failureReason: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }
}

// ─── Inbound webhook payload schema ─────────────────────────────────────────

export type TelegramWebhookUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; first_name?: string; last_name?: string; username?: string }
    text?: string
    date: number
  }
}

export function parseTelegramWebhook(body: unknown): TelegramWebhookUpdate | null {
  if (
    typeof body !== 'object' || body === null ||
    typeof (body as Record<string, unknown>).update_id !== 'number'
  ) {
    return null
  }
  return body as TelegramWebhookUpdate
}
