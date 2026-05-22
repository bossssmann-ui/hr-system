/**
 * MessageChannel interface — Phase 1E candidate messenger.
 *
 * Each channel implements `send()` for outbound messages. Channels that
 * support inbound also expose an `ingest()` path (called from their
 * webhook/pull route). All implementations are injectable and mockable so
 * CI never makes live network calls.
 *
 * Feature-flag check: routes call `getChannelStatus()` before attempting
 * to send; disabled channels return an error instead of hitting the adapter.
 */

export type SendInput = {
  body: string
  /** Channel-specific destination (telegram_chat_id, email address, hh messages_url, etc.) */
  destination: string
  /** Optional subject (email only) */
  subject?: string
}

export type SendResult = {
  externalId: string | null
  status: 'sent' | 'failed'
  failureReason?: string
}

export interface MessageChannelAdapter {
  readonly channelName: string
  send(input: SendInput): Promise<SendResult>
}
