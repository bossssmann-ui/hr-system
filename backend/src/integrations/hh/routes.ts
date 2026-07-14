import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { createHhClient, HhRequestError } from './client'
import { encryptHhSecret } from './crypto'
import { enqueueHhNegotiationsSyncJob } from './sync'

type RouteBindings = RoleGuardBindings & {
  Variables: {
    env: AppEnv
    prisma: DbClient
  }
}

const authorizeUrlQuerySchema = z.object({
  redirect_uri: z.string().url().optional(),
})

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().url().optional(),
})

const vacancyLinkSchema = z.object({
  hhVacancyId: z.string().min(1).nullable(),
})

export function createHhIntegrationRoutes() {
  const app = new Hono<RouteBindings>()

  app.get(
    '/authorize-url',
    requireRole('owner', 'hr_admin'),
    zValidator('query', authorizeUrlQuerySchema),
    async (c) => {
      const env = c.get('env')
      const config = getIntegrationConfig(env)
      if (!config.enabled) {
        return c.json({
          enabled: false,
          configured: config.configured,
          reason: config.reason,
        })
      }

      const { redirect_uri } = c.req.valid('query')
      const redirectUri = redirect_uri ?? defaultRedirectUri(c.req.url)

      const authorizeUrl = new URL('https://hh.ru/oauth/authorize')
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', env.HH_CLIENT_ID ?? '')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)

      return c.json({
        enabled: true,
        configured: true,
        authorizeUrl: authorizeUrl.toString(),
      })
    },
  )

  app.get(
    '/callback',
    requireRole('owner', 'hr_admin'),
    zValidator('query', callbackQuerySchema),
    async (c) => {
      const env = c.get('env')
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const config = getIntegrationConfig(env)

      if (!config.enabled) {
        throw new AppError(400, 'BAD_REQUEST', config.reason ?? 'HH integration is not configured')
      }

      const { code, redirect_uri } = c.req.valid('query')
      const redirectUri = redirect_uri ?? defaultRedirectUri(c.req.url)
      const client = createHhClient({ env })

      const tokens = await client.exchangeAuthorizationCode({
        code,
        redirectUri,
      })
      const me = await client.getMe(tokens.accessToken)

      await prisma.hhConnection.upsert({
        where: { tenantId },
        update: {
          accessToken: encryptHhSecret(tokens.accessToken, env.HH_TOKEN_ENCRYPTION_KEY!),
          refreshToken: encryptHhSecret(tokens.refreshToken, env.HH_TOKEN_ENCRYPTION_KEY!),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
          connectedEmployerId: me.employer?.id ?? null,
        },
        create: {
          tenantId,
          accessToken: encryptHhSecret(tokens.accessToken, env.HH_TOKEN_ENCRYPTION_KEY!),
          refreshToken: encryptHhSecret(tokens.refreshToken, env.HH_TOKEN_ENCRYPTION_KEY!),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
          connectedEmployerId: me.employer?.id ?? null,
        },
      })

      return c.json({ connected: true })
    },
  )

  app.get('/status', requireRole('owner', 'hr_admin'), async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')

    const config = getIntegrationConfig(env)
    if (!config.enabled) {
      return c.json({
        enabled: false,
        configured: config.configured,
        reason: config.reason,
        connected: false,
      })
    }

    const [connection, linkedVacancies, latestCursor] = await Promise.all([
      prisma.hhConnection.findUnique({
        where: { tenantId },
      }),
      prisma.vacancy.findMany({
        where: {
          tenantId,
          hhVacancyId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          hhVacancyId: true,
        },
      }),
      prisma.hhSyncCursor.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    return c.json({
      enabled: true,
      configured: true,
      connected: Boolean(connection),
      connection: connection
        ? {
            tokenExpiresAt: connection.tokenExpiresAt.toISOString(),
            connectedEmployerId: connection.connectedEmployerId,
          }
        : null,
      linkedVacancies: linkedVacancies.map((vacancy) => ({
        id: vacancy.id,
        title: vacancy.title,
        hhVacancyId: vacancy.hhVacancyId,
      })),
      lastSyncAt: latestCursor?.updatedAt.toISOString() ?? null,
    })
  })

  app.patch(
    '/vacancies/:id/link',
    requireRole('owner', 'hr_admin'),
    zValidator('json', vacancyLinkSchema),
    async (c) => {
      const env = c.get('env')
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { id } = c.req.param()
      const body = c.req.valid('json')
      const config = getIntegrationConfig(env)

      if (!config.enabled) {
        throw new AppError(400, 'BAD_REQUEST', config.reason ?? 'HH integration is not configured')
      }

      const existing = await prisma.vacancy.findFirst({ where: { id, tenantId } })
      if (!existing) {
        throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')
      }

      const updated = await prisma.vacancy.update({
        where: { id },
        data: {
          hhVacancyId: body.hhVacancyId,
        },
      })

      return c.json({
        vacancy: {
          id: updated.id,
          title: updated.title,
          hhVacancyId: updated.hhVacancyId,
        },
      })
    },
  )

  app.post('/sync', requireRole('owner', 'hr_admin', 'recruiter'), async (c) => {
    const env = c.get('env')
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')

    const config = getIntegrationConfig(env)
    if (!config.enabled) {
      throw new AppError(400, 'BAD_REQUEST', config.reason ?? 'HH integration is not configured')
    }

    const summary = await enqueueHhNegotiationsSyncJob({
      prisma,
      env,
      tenantId,
      actorUserId: userId,
    }).catch((error: unknown) => {
      if (error instanceof HhRequestError && error.status === 403) {
        throw new AppError(
          502,
          'BAD_REQUEST',
          'HH.ru refused access to vacancy responses. Reconnect HH.ru with an employer account that can manage the linked vacancy.',
        )
      }
      if (error instanceof HhRequestError) {
        throw new AppError(502, 'BAD_REQUEST', `HH.ru request failed with status ${error.status}`)
      }
      throw error
    })

    return c.json({
      ok: true,
      summary,
    })
  })

  return app
}

function defaultRedirectUri(requestUrl: string) {
  const url = new URL(requestUrl)
  return `${url.origin}/admin/integrations/hh`
}

function getIntegrationConfig(env: AppEnv) {
  if (!env.HH_INTEGRATION_ENABLED) {
    return {
      enabled: false,
      configured: false,
      reason: 'HH integration is disabled by HH_INTEGRATION_ENABLED=false',
    }
  }

  if (!env.HH_CLIENT_ID || !env.HH_CLIENT_SECRET || !env.HH_TOKEN_ENCRYPTION_KEY) {
    return {
      enabled: false,
      configured: false,
      reason: 'HH credentials or HH_TOKEN_ENCRYPTION_KEY are not configured',
    }
  }

  return {
    enabled: true,
    configured: true,
    reason: null,
  }
}
