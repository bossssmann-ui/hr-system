/**
 * Phase 8 — aggregate integrations status + Telegram deep-link binding.
 *
 *   GET  /api/integrations/status                 — owner / hr_admin
 *   GET  /api/integrations/telegram/link?token=…  — owner / hr_admin
 *   POST /api/integrations/hh/webhook             — public (no auth, push from HH)
 *
 * The status route returns a single document summarising every external
 * channel — Telegram, Email, HH.ru, plus each job-board adapter — so the
 * `/settings/integrations` UI can render in one round-trip.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { jobBoardConfigs } from '../job-boards'
import { enqueueHhNegotiationsSyncJob } from '../hh/sync'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
  }
}

export function createIntegrationsStatusRoutes() {
  const app = new Hono<RouteBindings>()

  app.get('/status', requireRole('owner', 'hr_admin'), async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')

    const [hhConnection, lastCursor, externalPosts, telegramLinkCount] = await Promise.all([
      prisma.hhConnection.findUnique({ where: { tenantId } }),
      prisma.hhSyncCursor.findFirst({ where: { tenantId }, orderBy: { updatedAt: 'desc' } }),
      prisma.externalVacancyPost.groupBy({
        by: ['board'],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.telegramLink.count({ where: { tenantId, isActive: true } }),
    ])

    const boards = jobBoardConfigs(env)
    const externalPostCounts = Object.fromEntries(
      externalPosts.map((row) => [row.board, row._count._all]),
    )

    return c.json({
      telegram: {
        enabled: env.TELEGRAM_ENABLED,
        configured: env.TELEGRAM_ENABLED && Boolean(env.TELEGRAM_BOT_TOKEN),
        activeLinks: telegramLinkCount,
      },
      email: {
        enabled: env.EMAIL_ENABLED,
        configured:
          env.EMAIL_ENABLED &&
          Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM),
        from: env.SMTP_FROM ?? null,
      },
      hh: {
        enabled: env.HH_INTEGRATION_ENABLED,
        configured: env.HH_INTEGRATION_ENABLED && Boolean(env.HH_CLIENT_ID && env.HH_CLIENT_SECRET),
        connected: Boolean(hhConnection),
        lastSyncAt: lastCursor?.updatedAt.toISOString() ?? null,
      },
      jobBoards: boards.map((board) => ({
        board: board.board,
        enabled: board.enabled,
        configured: board.configured,
        reason: board.reason,
        publishedVacancies: externalPostCounts[board.board] ?? 0,
      })),
    })
  })

  return app
}

const telegramLinkQuerySchema = z.object({
  token: z.string().min(1),
  chat_id: z.string().min(1),
})

export function createTelegramLinkRoute() {
  const app = new Hono<RouteBindings>()

  /**
   * Deep-link binding for the Telegram bot.
   *
   * The bot opens this URL with `?token=…&chat_id=…` after a candidate
   * sends `/start <token>`. The token is the candidate id; in a follow-up
   * it can be replaced with a signed short-lived token.
   */
  app.get(
    '/link',
    requireRole('owner', 'hr_admin'),
    zValidator('query', telegramLinkQuerySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const env = c.get('env')
      const { token, chat_id } = c.req.valid('query')

      if (!env.TELEGRAM_ENABLED) {
        throw new AppError(400, 'BAD_REQUEST', 'Telegram integration is disabled')
      }

      const candidate = await prisma.candidate.findFirst({
        where: { id: token, tenantId },
        select: { id: true },
      })
      if (!candidate) {
        throw new AppError(404, 'NOT_FOUND', 'Candidate not found for the supplied token')
      }

      const link = await prisma.telegramLink.upsert({
        where: { chatId: chat_id },
        update: { tenantId, candidateId: candidate.id, isActive: true, linkedAt: new Date() },
        create: { tenantId, candidateId: candidate.id, chatId: chat_id },
      })

      return c.json({
        ok: true,
        link: {
          id: link.id,
          candidateId: link.candidateId,
          chatId: link.chatId,
          isActive: link.isActive,
        },
      })
    },
  )

  return app
}

const hhWebhookSchema = z
  .object({
    event: z.string().min(1),
    // HH push notifications include `topic_id` / `negotiation_id`; we ignore
    // the body content and trigger a fresh sync so the cursor-based pipeline
    // stays the single source of truth for negotiation reconciliation.
  })
  .passthrough()

export function createHhWebhookRoute() {
  const app = new Hono<{
    Variables: { env: AppEnv; prisma: DbClient }
  }>()

  app.post('/webhook', zValidator('json', hhWebhookSchema), async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')

    if (!env.HH_INTEGRATION_ENABLED) {
      return c.json({ ok: false, reason: 'hh_disabled' }, 404)
    }

    // HH.ru does not bind webhooks to a tenant, so we enqueue a sync for
    // every connected tenant. Each call is idempotent (cursor-based) and
    // safe to retry.
    const connectedTenants = await prisma.hhConnection.findMany({ select: { tenantId: true } })
    for (const { tenantId } of connectedTenants) {
      await enqueueHhNegotiationsSyncJob({ prisma, env, tenantId }).catch((err: unknown) => {
        // Webhooks must always 200 so HH does not back off; surface failures via logs.
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'hh.webhook.sync_failed',
            tenantId,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      })
    }

    return c.json({ ok: true, tenants: connectedTenants.length })
  })

  return app
}
