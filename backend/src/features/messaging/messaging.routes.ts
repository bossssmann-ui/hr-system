/**
 * Messaging routes — Phase 1E: unified candidate messenger.
 *
 * GET  /api/conversations                       — list conversations (optionally filter by candidate_id)
 * POST /api/conversations                       — create conversation (find-or-create)
 * GET  /api/conversations/:id                   — get conversation with messages
 * POST /api/conversations/:id/messages          — send a message (async via queue)
 * POST /api/conversations/:id/ai-draft          — AI draft reply (never auto-sends)
 * GET  /api/conversations/channels              — list enabled channels
 *
 * GET  /api/message-templates                   — list templates
 * POST /api/message-templates                   — create template
 * PATCH /api/message-templates/:id             — update template
 * DELETE /api/message-templates/:id            — delete template
 *
 * POST /api/integrations/telegram/webhook      — Telegram inbound webhook
 *
 * TODO(phase-1e+): WebSocket real-time push for the recruiter UI.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import {
  sendMessageRequestSchema,
  createConversationRequestSchema,
  createMessageTemplateRequestSchema,
  updateMessageTemplateRequestSchema,
  aiDraftRequestSchema,
} from '@web-app-demo/contracts'
import {
  findOrCreateConversation,
  sendMessage,
  generateAiDraft,
  getEnabledChannels,
  substituteTemplateVariables,
} from './messaging.service'
import {
  parseTelegramWebhook,
} from '../../integrations/messaging'
import { ingestInboundMessage } from './messaging.service'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
    auditEntry?: unknown
  }
}

function toConversationDto(row: {
  id: string
  tenantId: string
  candidateId: string
  applicationId: string | null
  subject: string | null
  lastMessageAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    candidateId: row.candidateId,
    applicationId: row.applicationId,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toMessageDto(row: {
  id: string
  tenantId: string
  conversationId: string
  channel: string
  direction: string
  body: string
  senderUserId: string | null
  externalId: string | null
  status: string
  sentAt: Date | null
  createdAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    channel: row.channel,
    direction: row.direction,
    body: row.body,
    senderUserId: row.senderUserId,
    externalId: row.externalId,
    status: row.status,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toTemplateDto(row: {
  id: string
  tenantId: string
  name: string
  channel: string | null
  subject: string | null
  body: string
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createMessagingRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── Channel status ───────────────────────────────────────────────────────

  app.get(
    '/channels',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const env = c.get('env')
      const channels = getEnabledChannels(env)
      return c.json({ channels })
    },
  )

  // ─── Conversations list ───────────────────────────────────────────────────

  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('query', z.object({ candidate_id: z.string().uuid().optional() })),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { candidate_id } = c.req.valid('query')

      const rows = await prisma.conversation.findMany({
        where: {
          tenantId,
          ...(candidate_id ? { candidateId: candidate_id } : {}),
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      })

      return c.json({ items: rows.map(toConversationDto) })
    },
  )

  // ─── Create / find conversation ───────────────────────────────────────────

  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createConversationRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const body = c.req.valid('json')

      const { conversation, created } = await findOrCreateConversation({
        prisma,
        tenantId,
        candidateId: body.candidateId,
        applicationId: body.applicationId,
        subject: body.subject,
      })

      c.set('auditEntry', {
        action: 'conversation.create',
        entityType: 'Conversation',
        entityId: conversation.id,
        diff: [{ op: 'add', path: '', value: { candidateId: body.candidateId, created } }],
      })

      return c.json({ conversation: toConversationDto(conversation), created }, created ? 201 : 200)
    },
  )

  // ─── Conversation detail with messages ────────────────────────────────────

  app.get(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const row = await prisma.conversation.findFirst({
        where: { id, tenantId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      })

      if (!row) throw new AppError(404, 'NOT_FOUND', 'Conversation not found')

      return c.json({
        ...toConversationDto(row),
        messages: row.messages.map(toMessageDto),
      })
    },
  )

  // ─── Send message ─────────────────────────────────────────────────────────

  app.post(
    '/:id/messages',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', sendMessageRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const result = await sendMessage({
        prisma,
        env,
        tenantId,
        conversationId: id,
        channel: body.channel,
        body: body.body,
        senderUserId: userId,
        automated: body.automated,
      })

      if (!result.ok) {
        if (result.reason === 'conversation_not_found') {
          throw new AppError(404, 'NOT_FOUND', 'Conversation not found')
        }
        if (result.reason === 'channel_not_available') {
          throw new AppError(400, 'BAD_REQUEST', `Channel '${body.channel}' is not available`)
        }
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to send message')
      }

      c.set('auditEntry', {
        action: 'message.sent',
        entityType: 'Message',
        entityId: result.message.id,
        diff: [{ op: 'add', path: '', value: { channel: body.channel, direction: 'outbound' } }],
      })

      return c.json({
        message: toMessageDto(result.message),
        queued: true,
      }, 201)
    },
  )

  // ─── AI draft ─────────────────────────────────────────────────────────────

  app.post(
    '/:id/ai-draft',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', aiDraftRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const result = await generateAiDraft({
        prisma,
        env,
        conversationId: id,
        tenantId,
        hint: body.hint,
      })

      if (!result.ok) {
        if (result.reason === 'conversation_not_found') {
          throw new AppError(404, 'NOT_FOUND', 'Conversation not found')
        }
        if (result.reason === 'ai_not_configured') {
          throw new AppError(400, 'BAD_REQUEST', 'AI features are not enabled')
        }
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to generate AI draft')
      }

      return c.json({ draft: result.draft, model: result.model })
    },
  )

  return app
}

// ─── Message templates routes ─────────────────────────────────────────────────

export function createMessageTemplatesRoutes() {
  const app = new Hono<RouteBindings>()

  // List
  app.get(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')

      const rows = await prisma.messageTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })

      return c.json({ items: rows.map(toTemplateDto) })
    },
  )

  // Create
  app.post(
    '/',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', createMessageTemplateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const userId = c.get('userId')
      const body = c.req.valid('json')

      const row = await prisma.messageTemplate.create({
        data: {
          tenantId,
          name: body.name,
          channel: body.channel ?? null,
          subject: body.subject ?? null,
          body: body.body,
          createdByUserId: userId,
        },
      })

      c.set('auditEntry', {
        action: 'message_template.create',
        entityType: 'MessageTemplate',
        entityId: row.id,
        diff: [{ op: 'add', path: '', value: { name: body.name } }],
      })

      return c.json(toTemplateDto(row), 201)
    },
  )

  // Update
  app.patch(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    zValidator('json', updateMessageTemplateRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')

      const existing = await prisma.messageTemplate.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Template not found')

      const row = await prisma.messageTemplate.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.channel !== undefined ? { channel: body.channel ?? null } : {}),
          ...(body.subject !== undefined ? { subject: body.subject ?? null } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
        },
      })

      c.set('auditEntry', {
        action: 'message_template.update',
        entityType: 'MessageTemplate',
        entityId: row.id,
        diff: [{ op: 'replace', path: '', value: body }],
      })

      return c.json(toTemplateDto(row))
    },
  )

  // Delete
  app.delete(
    '/:id',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()

      const existing = await prisma.messageTemplate.findFirst({ where: { id, tenantId } })
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Template not found')

      await prisma.messageTemplate.delete({ where: { id } })

      c.set('auditEntry', {
        action: 'message_template.delete',
        entityType: 'MessageTemplate',
        entityId: id,
        diff: [{ op: 'remove', path: '' }],
      })

      return c.json({ ok: true })
    },
  )

  // Template variable substitution preview
  app.post(
    '/:id/preview',
    requireRole('owner', 'hr_admin', 'recruiter'),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const rawBody = await c.req.json().catch(() => null)
      const variables = (rawBody?.variables ?? {}) as Record<string, string>

      const template = await prisma.messageTemplate.findFirst({ where: { id, tenantId } })
      if (!template) throw new AppError(404, 'NOT_FOUND', 'Template not found')

      return c.json({
        body: substituteTemplateVariables(template.body, variables),
        subject: template.subject ? substituteTemplateVariables(template.subject, variables) : null,
      })
    },
  )

  return app
}

// ─── Telegram webhook route ───────────────────────────────────────────────────

export function createTelegramWebhookRoute() {
  const app = new Hono<{
    Variables: {
      env: AppEnv
      prisma: DbClient
    }
  }>()

  /**
   * POST /api/integrations/telegram/webhook
   *
   * Receives inbound Telegram messages. Matches the chat to a candidate via
   * `Candidate.externalIds.telegram_chat_id`. Creates a conversation if needed.
   *
   * Setup: register this URL as the Telegram bot webhook:
   *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/integrations/telegram/webhook"
   */
  app.post('/webhook', async (c) => {
    const prisma = c.get('prisma')
    const env = c.get('env')

    if (!env.TELEGRAM_ENABLED) {
      return c.json({ ok: false, reason: 'telegram_disabled' }, 404)
    }

    const body = await c.req.json().catch(() => null)
    const update = parseTelegramWebhook(body)

    if (!update?.message?.text || !update.message.chat.id) {
      return c.json({ ok: true }) // Acknowledge non-message updates silently
    }

    const chatId = String(update.message.chat.id)
    const text = update.message.text
    const externalId = `tg_${update.update_id}`

    // Look up candidate by telegram_chat_id in externalIds.
    // Note: Prisma jsonb path filtering — use raw query for the JSON path.
    const candidateRow = await prisma.$queryRaw<Array<{ id: string; tenant_id: string }>>`
      SELECT id, tenant_id FROM candidates
      WHERE external_ids->>'telegram_chat_id' = ${chatId}
      LIMIT 1
    `

    if (!candidateRow[0]) {
      // Unknown sender — acknowledge but don't ingest (no candidate mapping).
      return c.json({ ok: true })
    }

    const { id: candidateId, tenant_id: tenantId } = candidateRow[0]

    await ingestInboundMessage({
      prisma,
      env,
      tenantId,
      candidateId,
      channel: 'telegram',
      body: text,
      externalId,
    })

    return c.json({ ok: true })
  })

  return app
}
