/**
 * Messaging integrations barrel — Phase 1E.
 *
 * Import channel adapters from this index so that call sites don't need to
 * know the individual file layout.
 */
export type { MessageChannelAdapter, SendInput, SendResult } from './channel'
export { InAppChannel } from './in-app.channel'
export { HhChatChannel } from './hh-chat.channel'
export { TelegramChannel, parseTelegramWebhook } from './telegram.channel'
export type { TelegramWebhookUpdate } from './telegram.channel'
export { EmailChannel } from './email.channel'
export type { SmtpTransport, SmtpSendOptions } from './email.channel'
