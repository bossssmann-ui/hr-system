/**
 * Phase 1E — Candidate Messenger contracts.
 *
 * Zod schemas for Conversation, Message, MessageTemplate, and related
 * request/response shapes shared between backend and web.
 */
import { z } from 'zod'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const messageChannelSchema = z.enum(['in_app', 'email', 'telegram', 'hh_chat'])
export type MessageChannel = z.infer<typeof messageChannelSchema>

export const messageDirectionSchema = z.enum(['inbound', 'outbound'])
export type MessageDirection = z.infer<typeof messageDirectionSchema>

export const messageStatusSchema = z.enum(['draft', 'queued', 'sent', 'delivered', 'failed', 'received'])
export type MessageStatus = z.infer<typeof messageStatusSchema>

// ─── Core entities ────────────────────────────────────────────────────────────

export const conversationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  candidateId: z.string().uuid(),
  applicationId: z.string().uuid().nullable(),
  subject: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Conversation = z.infer<typeof conversationSchema>

export const messageSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  channel: messageChannelSchema,
  direction: messageDirectionSchema,
  body: z.string(),
  senderUserId: z.string().uuid().nullable(),
  externalId: z.string().nullable(),
  status: messageStatusSchema,
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type Message = z.infer<typeof messageSchema>

export const messageTemplateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  channel: messageChannelSchema.nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type MessageTemplate = z.infer<typeof messageTemplateSchema>

// ─── Conversation with messages ───────────────────────────────────────────────

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
})
export type ConversationDetail = z.infer<typeof conversationDetailSchema>

// ─── Request schemas ──────────────────────────────────────────────────────────

export const createConversationRequestSchema = z.object({
  candidateId: z.string().uuid(),
  applicationId: z.string().uuid().optional(),
  subject: z.string().max(500).optional(),
})
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>

export const sendMessageRequestSchema = z.object({
  channel: messageChannelSchema,
  body: z.string().min(1).max(10_000),
  /** If true, the message is an automated send (respects Quiet Hours). Manual sends always go through. */
  automated: z.boolean().optional().default(false),
})
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>

export const createMessageTemplateRequestSchema = z.object({
  name: z.string().min(1).max(200),
  channel: messageChannelSchema.optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(10_000),
})
export type CreateMessageTemplateRequest = z.infer<typeof createMessageTemplateRequestSchema>

export const updateMessageTemplateRequestSchema = createMessageTemplateRequestSchema.partial()
export type UpdateMessageTemplateRequest = z.infer<typeof updateMessageTemplateRequestSchema>

export const aiDraftRequestSchema = z.object({
  hint: z.string().max(1_000).optional(),
})
export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>

// ─── Response schemas ─────────────────────────────────────────────────────────

export const listConversationsResponseSchema = z.object({
  items: z.array(conversationSchema),
})
export type ListConversationsResponse = z.infer<typeof listConversationsResponseSchema>

export const listMessageTemplatesResponseSchema = z.object({
  items: z.array(messageTemplateSchema),
})
export type ListMessageTemplatesResponse = z.infer<typeof listMessageTemplatesResponseSchema>

export const sendMessageResponseSchema = z.object({
  message: messageSchema,
  queued: z.boolean(),
})
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>

export const aiDraftResponseSchema = z.object({
  draft: z.string(),
  model: z.string().optional(),
})
export type AiDraftResponse = z.infer<typeof aiDraftResponseSchema>

export const channelStatusSchema = z.object({
  channel: messageChannelSchema,
  enabled: z.boolean(),
  reason: z.string().optional(),
})
export type ChannelStatus = z.infer<typeof channelStatusSchema>

export const channelStatusListSchema = z.object({
  channels: z.array(channelStatusSchema),
})
export type ChannelStatusList = z.infer<typeof channelStatusListSchema>
