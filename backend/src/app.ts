import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import type { DbClient } from './db'
import type { AppEnv } from './env'
import { createAuthRoutes } from './auth/routes'
import { AuthService } from './auth/service'
import { createAdminRoutes } from './features/admin/admin.routes'
import { createAlumniRoutes } from './features/alumni/alumni.routes'
import { createApplicationsRoutes } from './features/applications/applications.routes'
import { createCandidatesRoutes } from './features/candidates/candidates.routes'
import { createEmployeesRoutes } from './features/employees/employees.routes'
import { createLearningRoutes, createOkrsRoutes, createReviewsRoutes } from './features/learning/learning.routes'
import { createOrgUnitsRoutes } from './features/org-units/org-units.routes'
import { createPublicCareersRoutes } from './features/public/public.routes'
import { createPortalRoutes } from './features/portal/portal.routes'
import { createAssessmentRoutes, createPublicAssessmentRoutes } from './features/assessments/assessments.routes'
import { createSelectionRoutes } from './features/selection/selection.routes'
import { createRequisitionsRoutes } from './features/requisitions/requisitions.routes'
import { createVacanciesRoutes } from './features/vacancies/vacancies.routes'
import { createHhIntegrationRoutes } from './integrations/hh/routes'
import { createInterviewRoutes } from './features/interviews/interviews.routes'
import {
  createApplicationOffersListRoute,
  createDocusealWebhookRoute,
  createOffersRoutes,
} from './features/offers/offers.routes'
import { createCompRoutes } from './features/comp/comp.routes'
import {
  createMessagingRoutes,
  createMessageTemplatesRoutes,
  createTelegramWebhookRoute,
} from './features/messaging/messaging.routes'
import { createAuditMiddleware } from './http/audit'
import { errorResponse, handleError } from './http/errors'
import { createStorageServiceFromEnv, type StorageService } from './storage/service'

type AppBindings = {
  Variables: {
    authService: AuthService
    env: AppEnv
    prisma: DbClient
    storageService: StorageService | null
  }
}

type CreateAppOptions = {
  env: AppEnv
  prisma: DbClient
}

export function createApp({ env, prisma }: CreateAppOptions) {
  const authService = new AuthService(prisma, env)
  const storageService = createStorageServiceFromEnv(env)
  const app = new OpenAPIHono<AppBindings>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorResponse('VALIDATION_ERROR', 'Invalid request payload', result.error.issues),
          400,
        )
      }
    },
  })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      allowHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  app.use('*', async (c, next) => {
    c.set('authService', authService)
    c.set('env', env)
    c.set('prisma', prisma)
    c.set('storageService', storageService)
    await next()
  })

  // Audit middleware — runs after every mutating route; writes AuditEvent row.
  app.use('/api/*', createAuditMiddleware({ prisma, async: true }))

  app.get('/', (c) => {
    return c.json({
      name: 'web_app_demo backend',
      status: 'ok',
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.route('/api/auth', createAuthRoutes())
  app.route('/api/org-units', createOrgUnitsRoutes())
  app.route('/api/requisitions', createRequisitionsRoutes())
  app.route('/api/vacancies', createVacanciesRoutes())
  app.route('/api/candidates', createCandidatesRoutes())
  app.route('/api/employees', createEmployeesRoutes())
  app.route('/api/learning', createLearningRoutes())
  app.route('/api/reviews', createReviewsRoutes())
  app.route('/api/okrs', createOkrsRoutes())
  app.route('/api/alumni', createAlumniRoutes())
  app.route('/api/portal', createPortalRoutes())
  app.route('/api/applications', createApplicationsRoutes())
  app.route('/api/applications', createApplicationOffersListRoute())
  app.route('/api/offers', createOffersRoutes())
  app.route('/api/comp', createCompRoutes())
  app.route('/api/integrations/docuseal', createDocusealWebhookRoute())
  app.route('/api/interviews', createInterviewRoutes())
  app.route('/api/admin', createAdminRoutes())
  app.route('/api/integrations/hh', createHhIntegrationRoutes())
  app.route('/api/conversations', createMessagingRoutes())
  app.route('/api/message-templates', createMessageTemplatesRoutes())
  app.route('/api/integrations/telegram', createTelegramWebhookRoute())
  app.route('/api/assessments', createAssessmentRoutes())
  app.route('/api/public/assessment', createPublicAssessmentRoutes())
  app.route('/api/public', createPublicCareersRoutes())
  app.route('/api/selection', createSelectionRoutes())

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'web_app_demo API',
      version: '1.0.0',
    },
  })

  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)

  return app
}

export type AppType = ReturnType<typeof createApp>
