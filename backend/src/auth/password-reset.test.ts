import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { AuthService } from './service'
import { verifyPassword } from './passwords'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: 'test-route-secret-at-least-thirty-two-chars-123',
  CORS_ORIGINS: ['https://web.example.com'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: true,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: false,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: undefined,
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: false,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: undefined,
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_REGION: undefined,
  SPACES_BUCKET: undefined,
  SPACES_ENDPOINT: undefined,
  SPACES_CDN_BASE_URL: undefined,
  SPACES_ACCESS_KEY_ID: undefined,
  SPACES_SECRET_ACCESS_KEY: undefined,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  TELEGRAM_BOT_TOKEN: undefined,
  EMAIL_ENABLED: false,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: undefined,
  DOCUSEAL_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  DOCUSEAL_API_KEY: undefined,
  DOCUSEAL_TEMPLATE_ID: undefined,
  DOCUSEAL_WEBHOOK_SECRET: undefined,
  SBER_PODBOR_ENABLED: false,
  SBER_PODBOR_API_TOKEN: undefined,
  AVITO_JOBS_ENABLED: false,
  AVITO_JOBS_API_TOKEN: undefined,
  RABOTA_RU_ENABLED: false,
  RABOTA_RU_API_TOKEN: undefined,
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
  QUIET_HOURS_QUIET_START_UTC: 15,
  QUIET_HOURS_QUIET_END_UTC: 23,
  ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  CLARIFICATION_LOOP_ENABLED: false,
  CLARIFICATION_MIN_SCORE: 30,
  AUTO_SELECTION_THRESHOLD: 70,
  AUTO_REJECT_THRESHOLD: 30,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: 'gemini-2.0-flash',
  PROCTORING_WEBCAM_ENABLED: false,
  TRUST_WEIGHT_PASTE: 0.35,
  TRUST_WEIGHT_FOCUS: 0.4,
  TRUST_WEIGHT_KEYSTROKE: 0.25,
  TRUST_LOW_THRESHOLD: 50,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  VALKEY_URL: undefined,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

type UserRow = {
  id: string
  email: string
  passwordHash: string
  disabledAt: Date | null
}

type ResetTokenRow = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  userAgent?: string
  ipAddress?: string
}

type SessionRow = {
  id: string
  userId: string
  revokedAt: Date | null
}

afterEach(() => {
  spyOn(console, 'info').mockRestore()
})

describe('password reset service', () => {
  test('does not reveal whether the requested email exists', async () => {
    const store = createAuthStore()
    const auth = new AuthService(store.db, env)

    await expect(
      auth.requestPasswordReset({ email: 'missing@example.com' }, {}),
    ).resolves.toEqual({ ok: true })

    expect(store.resetTokens).toHaveLength(0)
  })

  test('creates a one-time reset link, updates the password, and revokes sessions', async () => {
    const store = createAuthStore({
      users: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'owner@example.com',
          passwordHash: 'old-hash',
          disabledAt: null,
        },
      ],
      sessions: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          userId: '00000000-0000-0000-0000-000000000001',
          revokedAt: null,
        },
      ],
    })
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    const auth = new AuthService(store.db, env)

    await auth.requestPasswordReset(
      { email: 'owner@example.com' },
      { userAgent: 'test-agent', ipAddress: '127.0.0.1' },
    )

    expect(store.resetTokens).toHaveLength(1)
    expect(store.resetTokens[0]?.userAgent).toBe('test-agent')
    const payload = JSON.parse(String(info.mock.calls[0]?.[0])) as { resetUrl: string }
    const token = new URL(payload.resetUrl).searchParams.get('token')

    expect(token).toBeTruthy()

    await auth.resetPassword({ token: token ?? '', password: 'new-password-123' })

    expect(await verifyPassword('new-password-123', store.users[0]?.passwordHash ?? '')).toBe(true)
    expect(store.resetTokens[0]?.usedAt).toBeInstanceOf(Date)
    expect(store.sessions[0]?.revokedAt).toBeInstanceOf(Date)
  })

  test('sends reset link through SMTP transport when email is enabled', async () => {
    const store = createAuthStore({
      users: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'owner@example.com',
          passwordHash: 'old-hash',
          disabledAt: null,
        },
      ],
    })
    const sentMessages: Array<{ from: string; to: string; subject: string; text: string }> = []
    const info = spyOn(console, 'info').mockImplementation(() => undefined)
    const auth = new AuthService(
      store.db,
      {
        ...env,
        EMAIL_ENABLED: true,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_FROM: 'Onboardix <noreply@pacificstar.ru>',
        SMTP_USER: 'noreply@pacificstar.ru',
        SMTP_PASS: 'smtp-password',
      },
      {
        passwordResetEmailTransport: async (message) => {
          sentMessages.push(message)
          return { messageId: 'smtp-message-1' }
        },
      },
    )

    await auth.requestPasswordReset({ email: 'owner@example.com' }, {})

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]?.from).toBe('Onboardix <noreply@pacificstar.ru>')
    expect(sentMessages[0]?.to).toBe('owner@example.com')
    expect(sentMessages[0]?.subject).toBe('Восстановление пароля Onboardix')
    expect(sentMessages[0]?.text).toContain('/reset-password?token=')

    const payload = JSON.parse(String(info.mock.calls[0]?.[0])) as {
      delivery: { status: string; messageId?: string }
    }
    expect(payload.delivery).toEqual({ status: 'email', messageId: 'smtp-message-1' })
  })
})

function createAuthStore(input?: { users?: UserRow[]; resetTokens?: ResetTokenRow[]; sessions?: SessionRow[] }) {
  const users = input?.users ?? []
  const resetTokens = input?.resetTokens ?? []
  const sessions = input?.sessions ?? []
  let nextTokenId = 1

  const db = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        return users.find((user) => user.email === where.email || user.id === where.id) ?? null
      },
      update: async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
        const user = users.find((row) => row.id === where.id)
        if (!user) throw new Error('missing user')
        user.passwordHash = data.passwordHash
        return user
      },
    },
    passwordResetToken: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; userId?: string; usedAt?: null; expiresAt?: { gt: Date } }
        data: { usedAt: Date }
      }) => {
        let count = 0
        for (const row of resetTokens) {
          if (where.id && row.id !== where.id) continue
          if (where.userId && row.userId !== where.userId) continue
          if (where.usedAt === null && row.usedAt !== null) continue
          if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) continue
          row.usedAt = data.usedAt
          count += 1
        }
        return { count }
      },
      create: async ({ data }: { data: Omit<ResetTokenRow, 'id' | 'usedAt'> }) => {
        const row = {
          id: `00000000-0000-0000-0000-${String(nextTokenId++).padStart(12, '0')}`,
          usedAt: null,
          ...data,
        }
        resetTokens.push(row)
        return row
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = resetTokens.find((token) => token.tokenHash === where.tokenHash)
        if (!row) return null
        const user = users.find((candidate) => candidate.id === row.userId)
        if (!user) return null
        return { ...row, user }
      },
    },
    authSession: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; revokedAt: null }
        data: { revokedAt: Date }
      }) => {
        let count = 0
        for (const session of sessions) {
          if (session.userId !== where.userId) continue
          if (where.revokedAt === null && session.revokedAt !== null) continue
          session.revokedAt = data.revokedAt
          count += 1
        }
        return { count }
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(db),
  }

  return {
    db: db as unknown as DbClient,
    users,
    resetTokens,
    sessions,
  }
}
