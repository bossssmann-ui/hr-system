/**
 * Messaging service — Phase 1E.
 *
 * Core business logic: conversation auto-create/find, send pipeline,
 * template CRUD + variable substitution, AI-draft.
 *
 * All channel adapters are injected; no live network calls here.
 */
import type { Prisma } from '../../generated/prisma/client'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import {
  InAppChannel,
  HhChatChannel,
  TelegramChannel,
  EmailChannel,
} from '../../integrations/messaging'
import type { MessageChannelAdapter } from '../../integrations/messaging'
import { isAiScoringConfigured } from '../../integrations/llm'
import { createDraftProvider } from './messaging.draft'
import type { MessagingDraftProvider } from './messaging.draft'
import { enqueueMessageSend } from './messaging.queue'

// ─── Channel adapter factory ──────────────────────────────────────────────────

/**
 * Returns the appropriate channel adapter for `channel`, or null when the
 * channel is disabled / not configured for this tenant.
 */
export function getChannelAdapter(
  channel: string,
  env: AppEnv,
  hhAccessToken?: string,
): MessageChannelAdapter | null {
  switch (channel) {
    case 'in_app':
      return new InAppChannel()
    case 'hh_chat':
      if (!env.HH_INTEGRATION_ENABLED || !hhAccessToken) return null
      return new HhChatChannel({ accessToken: hhAccessToken })
    case 'telegram':
      if (!env.TELEGRAM_ENABLED || !env.TELEGRAM_BOT_TOKEN) return null
      return new TelegramChannel({ botToken: env.TELEGRAM_BOT_TOKEN })
    case 'email':
      if (!env.EMAIL_ENABLED || !env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_FROM) return null
      return new EmailChannel({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        from: env.SMTP_FROM,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      })
    default:
      return null
  }
}

/**
 * Returns a list of enabled channels for a tenant given the current env.
 */
export function getEnabledChannels(env: AppEnv): Array<{ channel: string; enabled: boolean; reason?: string }> {
  return [
    { channel: 'in_app', enabled: true },
    {
      channel: 'hh_chat',
      enabled: env.HH_INTEGRATION_ENABLED,
      reason: env.HH_INTEGRATION_ENABLED ? undefined : 'HH integration is not enabled',
    },
    {
      channel: 'telegram',
      enabled: env.TELEGRAM_ENABLED && Boolean(env.TELEGRAM_BOT_TOKEN),
      reason: !env.TELEGRAM_ENABLED ? 'Telegram is not enabled' : !env.TELEGRAM_BOT_TOKEN ? 'TELEGRAM_BOT_TOKEN not set' : undefined,
    },
    {
      channel: 'email',
      enabled: env.EMAIL_ENABLED && Boolean(env.SMTP_HOST) && Boolean(env.SMTP_PORT) && Boolean(env.SMTP_FROM),
      reason: !env.EMAIL_ENABLED ? 'Email is not enabled' : 'SMTP not fully configured',
    },
  ]
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

type FindOrCreateConversationInput = {
  prisma: DbClient
  tenantId: string
  candidateId: string
  applicationId?: string
  subject?: string
}

/**
 * Finds the open conversation for a candidate, or creates one.
 * One conversation per candidate per tenant by default.
 */
export async function findOrCreateConversation(input: FindOrCreateConversationInput) {
  const { prisma, tenantId, candidateId, applicationId, subject } = input

  const existing = await prisma.conversation.findFirst({
    where: { tenantId, candidateId },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { conversation: existing, created: false }

  const created = await prisma.conversation.create({
    data: {
      tenantId,
      candidateId,
      applicationId: applicationId ?? null,
      subject: subject ?? null,
      lastMessageAt: null,
    },
  })
  return { conversation: created, created: true }
}

// ─── Send message ─────────────────────────────────────────────────────────────

type SendMessageInput = {
  prisma: DbClient
  env: AppEnv
  tenantId: string
  conversationId: string
  channel: string
  body: string
  senderUserId: string
  automated?: boolean
  /** Override adapter (for testing) */
  adapter?: MessageChannelAdapter
  /** Override clock (for testing quiet hours) */
  now?: () => Date
}

export async function sendMessage(input: SendMessageInput) {
  const { prisma, env, tenantId, conversationId, channel, body, senderUserId, automated = false } = input

  // Verify conversation exists in tenant.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { candidate: true },
  })
  if (!conversation) {
    return { ok: false as const, reason: 'conversation_not_found' as const }
  }

  // Determine destination from candidate external_ids / channel.
  const destination = resolveDestination(conversation.candidate.externalIds, channel, conversation.candidate.email)

  // Create the message row in `queued` status.
  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      channel: channel as never,
      direction: 'outbound',
      body,
      senderUserId,
      status: 'queued',
    },
  })

  // Update conversation lastMessageAt.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  })

  // Resolve adapter (injected for tests, env-resolved for production).
  const adapter = input.adapter ?? getChannelAdapter(channel, env)
  if (!adapter) {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'failed' } })
    return { ok: false as const, reason: 'channel_not_available' as const }
  }

  // Enqueue send.
  await enqueueMessageSend({
    prisma,
    env,
    messageId: message.id,
    channel,
    destination: destination ?? '',
    body,
    automated,
    adapter,
    now: input.now,
  })

  return { ok: true as const, message }
}

function resolveDestination(
  externalIds: unknown,
  channel: string,
  email: string | null,
): string | null {
  const ids = typeof externalIds === 'object' && externalIds !== null
    ? (externalIds as Record<string, string>)
    : {}

  switch (channel) {
    case 'in_app':
      return 'in_app' // Unused; in-app is DB-only
    case 'telegram':
      return ids['telegram_chat_id'] ?? null
    case 'hh_chat':
      return ids['hh_messages_url'] ?? null
    case 'email':
      return email
    default:
      return null
  }
}

// ─── Template variable substitution ──────────────────────────────────────────

type TemplateVariables = Record<string, string>

/**
 * Replaces `{{variable}}` placeholders in a template body/subject.
 * Unknown variables are left as-is.
 */
export function substituteTemplateVariables(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? (variables[key] ?? _match) : _match
  })
}

// ─── AI draft ─────────────────────────────────────────────────────────────────

type AiDraftInput = {
  prisma: DbClient
  env: AppEnv
  conversationId: string
  tenantId: string
  hint?: string
  /** Injected provider for testing */
  provider?: MessagingDraftProvider
}

/**
 * Generates an AI draft reply using the LLM seam (Phase 1C / Anthropic).
 * Returns a draft string — NEVER auto-sends.
 * Feature-flagged with AI_SCORING_ENABLED.
 *
 * The prompt includes: conversation history + role context only.
 * Contact PII (email, phone) is NOT sent to the LLM.
 */
export async function generateAiDraft(input: AiDraftInput) {
  const { prisma, env, conversationId, tenantId, hint } = input

  if (!isAiScoringConfigured(env)) {
    return { ok: false as const, reason: 'ai_not_configured' as const }
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      candidate: {
        select: { fullName: true, location: true, source: true },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20, // Last 20 messages for context
      },
    },
  })

  if (!conversation) {
    return { ok: false as const, reason: 'conversation_not_found' as const }
  }

  const provider = input.provider ?? createDraftProvider(env)

  // Build context — NO contact PII (no email, phone, full_name).
  const contextText = [
    `Candidate source: ${conversation.candidate.source}`,
    conversation.candidate.location ? `Location: ${conversation.candidate.location}` : '',
    conversation.subject ? `Subject: ${conversation.subject}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const historyText = conversation.messages
    .map((m) => `[${m.direction === 'outbound' ? 'Recruiter' : 'Candidate'}]: ${m.body}`)
    .join('\n')

  try {
    const result = await provider.generateDraft({
      conversationHistory: historyText,
      context: contextText,
      hint,
    })

    return { ok: true as const, draft: result.draft, model: result.model }
  } catch {
    return { ok: false as const, reason: 'llm_error' as const }
  }
}

// ─── Inbound message ingestion ────────────────────────────────────────────────

type IngestMessageInput = {
  prisma: DbClient
  env?: AppEnv
  tenantId: string
  candidateId: string
  channel: string
  body: string
  externalId: string
  direction?: 'inbound' | 'outbound'
}

/**
 * Ingests an inbound message from a channel webhook.
 * Deduplicates by (channel, external_id).
 * Auto-creates/finds the conversation.
 * Emits audit event `message.received`.
 * If the conversation is linked to an application with a pending clarification,
 * triggers the clarification answer handler (force re-score).
 */
export async function ingestInboundMessage(input: IngestMessageInput) {
  const { prisma, env, tenantId, candidateId, channel, body, externalId, direction = 'inbound' } = input

  // Dedup: check if we already have this external message.
  const existing = await prisma.message.findFirst({
    where: { tenantId, channel: channel as never, externalId },
  })
  if (existing) {
    return { ok: true as const, message: existing, duplicate: true }
  }

  // Find or create conversation.
  const { conversation } = await findOrCreateConversation({
    prisma,
    tenantId,
    candidateId,
  })

  // Insert the message.
  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      channel: channel as never,
      direction: direction as never,
      body,
      externalId,
      status: 'received',
      sentAt: new Date(),
    },
  })

  // Update conversation lastMessageAt.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  })

  // Emit audit event.
  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorUserId: null,
      action: 'message.received',
      entityType: 'Message',
      entityId: message.id,
      diff: { channel, direction, externalId } as Prisma.InputJsonValue,
    },
  })

  // If the conversation is linked to an application with a pending clarification
  // and env is provided, process the answer (best-effort, non-blocking).
  if (env && conversation.applicationId && direction !== 'outbound') {
    try {
      const { handleClarificationAnswer } = await import('../applications/clarification.service')
      await handleClarificationAnswer({
        prisma,
        env,
        applicationId: conversation.applicationId,
        answer: body,
      })
    } catch {
      // Non-blocking — do not fail message ingestion.
    }
  }

  return { ok: true as const, message, duplicate: false }
}
