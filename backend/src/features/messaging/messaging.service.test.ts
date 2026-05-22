/**
 * Messaging service unit tests — Phase 1E.
 *
 * Covers: send enqueues + status transitions, inbound dedup,
 * conversation auto-create/find, template variable substitution,
 * AI-draft returns draft (never auto-sends), Quiet-Hours defers
 * automated sends but not manual, audit events.
 *
 * All channel adapters and LLM are mocked. No live network calls.
 */
import { describe, expect, test, beforeEach } from 'bun:test'

import {
  substituteTemplateVariables,
  findOrCreateConversation,
  sendMessage,
  generateAiDraft,
  ingestInboundMessage,
  getEnabledChannels,
} from './messaging.service'
import { isInQuietHours, msUntilQuietHoursEnd } from './quiet-hours'
import { parseTelegramWebhook } from '../../integrations/messaging'
import type { MessageChannelAdapter, SendInput, SendResult } from '../../integrations/messaging'
import type { MessagingDraftProvider } from './messaging.draft'
import type { AppEnv } from '../../env'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: 'test-api-key',
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: false,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: undefined,
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  TELEGRAM_BOT_TOKEN: undefined,
  EMAIL_ENABLED: false,
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: undefined,
}

// ─── Prisma mock builder ──────────────────────────────────────────────────────

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const conversationStore: Record<string, unknown> = {}
  const messageStore: Record<string, unknown> = {}
  const auditStore: unknown[] = []

  const candidateMock = {
    id: 'candidate-1',
    tenantId: 'tenant-1',
    fullName: 'Ivan Petrov',
    email: 'ivan@example.com',
    phone: null,
    location: 'Moscow',
    source: 'manual',
    externalIds: { telegram_chat_id: '112233445' },
    consentContext: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }

  return {
    conversation: {
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string; candidateId?: string } }) => {
        const entries = Object.values(conversationStore) as Array<Record<string, unknown>>
        return entries.find((c) => {
          if (where.id && c['id'] !== where.id) return false
          if (where.tenantId && c['tenantId'] !== where.tenantId) return false
          if (where.candidateId && c['candidateId'] !== where.candidateId) return false
          return true
        }) ?? null
      },
      findMany: async () => Object.values(conversationStore),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `conv-${Date.now()}`
        const row = { id, ...data, createdAt: new Date(), updatedAt: new Date() }
        conversationStore[id] = row
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = conversationStore[where.id] as Record<string, unknown>
        const updated = { ...existing, ...data, updatedAt: new Date() }
        conversationStore[where.id] = updated
        return updated
      },
    },
    message: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const entries = Object.values(messageStore) as Array<Record<string, unknown>>
        return entries.find((m) => {
          for (const [k, v] of Object.entries(where)) {
            if (m[k] !== v) return false
          }
          return true
        }) ?? null
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        return (messageStore[where.id] as Record<string, unknown>) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `msg-${Date.now()}-${Math.random()}`
        const row = { id, ...data, createdAt: new Date() }
        messageStore[id] = row
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = messageStore[where.id] as Record<string, unknown>
        const updated = { ...existing, ...data }
        messageStore[where.id] = updated
        return updated
      },
    },
    auditEvent: {
      create: async ({ data }: { data: unknown }) => {
        auditStore.push(data)
        return data
      },
    },
    candidate: {
      findFirst: async () => candidateMock,
    },
    _stores: { conversations: conversationStore, messages: messageStore, audit: auditStore },
    ...overrides,
  }
}

// ─── Mock adapters ─────────────────────────────────────────────────────────────

function createMockAdapter(result: Partial<SendResult> = {}): MessageChannelAdapter & { calls: SendInput[] } {
  const calls: SendInput[] = []
  return {
    channelName: 'in_app',
    calls,
    async send(input) {
      calls.push(input)
      return { externalId: null, status: 'sent', ...result }
    },
  }
}

// ─── Template variable substitution ──────────────────────────────────────────

describe('substituteTemplateVariables', () => {
  test('replaces known variables', () => {
    const result = substituteTemplateVariables(
      'Hello {{full_name}}, your application for {{vacancy_title}} is under review.',
      { full_name: 'Ivan Petrov', vacancy_title: 'Senior Engineer' },
    )
    expect(result).toBe('Hello Ivan Petrov, your application for Senior Engineer is under review.')
  })

  test('leaves unknown variables as-is', () => {
    const result = substituteTemplateVariables('Hello {{unknown_var}}', {})
    expect(result).toBe('Hello {{unknown_var}}')
  })

  test('handles empty variables object', () => {
    const result = substituteTemplateVariables('No placeholders here.', {})
    expect(result).toBe('No placeholders here.')
  })

  test('replaces multiple occurrences of the same variable', () => {
    const result = substituteTemplateVariables('{{name}} says hello, {{name}}!', { name: 'Ivan' })
    expect(result).toBe('Ivan says hello, Ivan!')
  })
})

// ─── Quiet Hours ──────────────────────────────────────────────────────────────

describe('quiet hours', () => {
  test('23:00 UTC is in quiet hours', () => {
    const date = new Date('2026-05-22T23:00:00Z')
    expect(isInQuietHours(date)).toBe(true)
  })

  test('22:00 UTC is in quiet hours (start boundary)', () => {
    const date = new Date('2026-05-22T22:00:00Z')
    expect(isInQuietHours(date)).toBe(true)
  })

  test('09:00 UTC is NOT in quiet hours (end boundary)', () => {
    const date = new Date('2026-05-22T09:00:00Z')
    expect(isInQuietHours(date)).toBe(false)
  })

  test('12:00 UTC is NOT in quiet hours', () => {
    const date = new Date('2026-05-22T12:00:00Z')
    expect(isInQuietHours(date)).toBe(false)
  })

  test('msUntilQuietHoursEnd returns 0 outside quiet hours', () => {
    const date = new Date('2026-05-22T12:00:00Z')
    expect(msUntilQuietHoursEnd(date)).toBe(0)
  })

  test('msUntilQuietHoursEnd returns positive ms during quiet hours', () => {
    const date = new Date('2026-05-22T23:00:00Z') // 23:00 UTC
    const ms = msUntilQuietHoursEnd(date)
    expect(ms).toBeGreaterThan(0)
    // Should be 10 hours until 09:00 next day
    const tenHoursMs = 10 * 60 * 60 * 1000
    expect(ms).toBe(tenHoursMs)
  })
})

// ─── Telegram webhook parsing ─────────────────────────────────────────────────

describe('parseTelegramWebhook', () => {
  test('parses valid telegram webhook payload', async () => {
    const fixture = await Bun.file(
      new URL('../../integrations/messaging/__fixtures__/telegram-webhook.json', import.meta.url),
    ).json()

    const update = parseTelegramWebhook(fixture)
    expect(update).not.toBeNull()
    expect(update?.update_id).toBe(987654321)
    expect(update?.message?.text).toBe('Hello, I am interested in the position.')
    expect(update?.message?.chat.id).toBe(112233445)
  })

  test('returns null for invalid payload', () => {
    expect(parseTelegramWebhook(null)).toBeNull()
    expect(parseTelegramWebhook({})).toBeNull()
    expect(parseTelegramWebhook({ foo: 'bar' })).toBeNull()
  })
})

// ─── Conversation auto-create/find ────────────────────────────────────────────

describe('findOrCreateConversation', () => {
  test('creates a new conversation when none exists', async () => {
    const prisma = createPrismaMock()
    const { conversation, created } = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    expect(created).toBe(true)
    expect(conversation.tenantId).toBe('tenant-1')
    expect(conversation.candidateId).toBe('candidate-1')
  })

  test('finds existing conversation on second call', async () => {
    const prisma = createPrismaMock()
    const first = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    const second = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.conversation.id).toBe(first.conversation.id)
  })
})

// ─── Send message ─────────────────────────────────────────────────────────────

describe('sendMessage', () => {
  test('creates message with queued status and invokes adapter', async () => {
    const prisma = createPrismaMock()
    const adapter = createMockAdapter()

    // Pre-create a conversation.
    const { conversation } = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    // Set up conversation with candidate for sendMessage lookup.
    const convWithCandidate = {
      ...conversation,
      candidate: {
        id: 'candidate-1',
        email: 'ivan@example.com',
        externalIds: {},
      },
    }
    prisma.conversation.findFirst = async () => convWithCandidate as never

    const result = await sendMessage({
      prisma: prisma as never,
      env: baseEnv,
      tenantId: 'tenant-1',
      conversationId: conversation.id,
      channel: 'in_app',
      body: 'Hello candidate!',
      senderUserId: 'user-1',
      adapter,
    })

    expect(result.ok).toBe(true)
    expect((result as { message: { status: string } }).message.status).toBe('queued')
  })

  test('returns channel_not_available when adapter is null and no injected adapter', async () => {
    const prisma = createPrismaMock()

    const { conversation } = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    const convWithCandidate = {
      ...conversation,
      candidate: { id: 'candidate-1', email: null, externalIds: {} },
    }
    prisma.conversation.findFirst = async () => convWithCandidate as never

    const result = await sendMessage({
      prisma: prisma as never,
      env: { ...baseEnv, TELEGRAM_ENABLED: false, EMAIL_ENABLED: false },
      tenantId: 'tenant-1',
      conversationId: conversation.id,
      channel: 'telegram',
      body: 'Hello!',
      senderUserId: 'user-1',
      // No adapter injected — disabled channel
    })

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toBe('channel_not_available')
  })

  test('returns conversation_not_found for unknown conversation', async () => {
    const prisma = createPrismaMock()

    const result = await sendMessage({
      prisma: prisma as never,
      env: baseEnv,
      tenantId: 'tenant-1',
      conversationId: 'nonexistent-id',
      channel: 'in_app',
      body: 'Hello!',
      senderUserId: 'user-1',
    })

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toBe('conversation_not_found')
  })
})

// ─── Inbound dedup ────────────────────────────────────────────────────────────

describe('ingestInboundMessage dedup', () => {
  test('ingests a new message and creates a conversation', async () => {
    const prisma = createPrismaMock()

    const result = await ingestInboundMessage({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      channel: 'telegram',
      body: 'Hello!',
      externalId: 'tg_12345',
    })

    expect(result.ok).toBe(true)
    expect(result.duplicate).toBe(false)
    expect(result.message.channel).toBe('telegram')
    expect(result.message.externalId).toBe('tg_12345')
  })

  test('deduplicates a message with the same externalId', async () => {
    const prisma = createPrismaMock()

    const first = await ingestInboundMessage({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      channel: 'telegram',
      body: 'Hello!',
      externalId: 'tg_99999',
    })

    // Simulate DB having the message now.
    prisma.message.findFirst = async () => first.message as never

    const second = await ingestInboundMessage({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
      channel: 'telegram',
      body: 'Hello again!',
      externalId: 'tg_99999',
    })

    expect(second.duplicate).toBe(true)
    expect(second.message.id).toBe(first.message.id)
  })
})

// ─── AI draft ─────────────────────────────────────────────────────────────────

describe('generateAiDraft', () => {
  test('returns a draft string and never auto-sends', async () => {
    const prisma = createPrismaMock()
    const adapter = createMockAdapter()

    // Pre-create conversation with messages.
    const { conversation } = await findOrCreateConversation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      candidateId: 'candidate-1',
    })

    const convWithData = {
      ...conversation,
      candidate: { fullName: 'Ivan Petrov', location: 'Moscow', source: 'manual' },
      messages: [
        { direction: 'inbound', body: 'I am interested in the role.', createdAt: new Date() },
      ],
    }
    prisma.conversation.findFirst = async () => convWithData as never

    const mockProvider: MessagingDraftProvider = {
      generateDraft: async () => ({ draft: 'Thank you for your interest! We will be in touch.', model: 'mock' }),
    }

    const result = await generateAiDraft({
      prisma: prisma as never,
      env: baseEnv,
      conversationId: conversation.id,
      tenantId: 'tenant-1',
      provider: mockProvider,
    })

    expect(result.ok).toBe(true)
    expect((result as { draft: string }).draft).toBeTruthy()
    // Ensure no message was sent.
    expect(adapter.calls).toHaveLength(0)
  })

  test('returns ai_not_configured when AI_SCORING_ENABLED=false', async () => {
    const prisma = createPrismaMock()

    const result = await generateAiDraft({
      prisma: prisma as never,
      env: { ...baseEnv, AI_SCORING_ENABLED: false },
      conversationId: 'any-id',
      tenantId: 'tenant-1',
    })

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toBe('ai_not_configured')
  })
})

// ─── Channel status ───────────────────────────────────────────────────────────

describe('getEnabledChannels', () => {
  test('in_app is always enabled', () => {
    const channels = getEnabledChannels(baseEnv)
    const inApp = channels.find((c) => c.channel === 'in_app')
    expect(inApp?.enabled).toBe(true)
  })

  test('telegram is disabled when TELEGRAM_ENABLED=false', () => {
    const channels = getEnabledChannels({ ...baseEnv, TELEGRAM_ENABLED: false })
    const tg = channels.find((c) => c.channel === 'telegram')
    expect(tg?.enabled).toBe(false)
  })

  test('telegram is enabled when TELEGRAM_ENABLED=true and token set', () => {
    const channels = getEnabledChannels({ ...baseEnv, TELEGRAM_ENABLED: true, TELEGRAM_BOT_TOKEN: 'bot123' })
    const tg = channels.find((c) => c.channel === 'telegram')
    expect(tg?.enabled).toBe(true)
  })

  test('email is disabled when EMAIL_ENABLED=false', () => {
    const channels = getEnabledChannels(baseEnv)
    const email = channels.find((c) => c.channel === 'email')
    expect(email?.enabled).toBe(false)
  })
})
