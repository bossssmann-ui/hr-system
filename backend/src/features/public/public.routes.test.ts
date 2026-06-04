import { describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

const enqueueApplicationScoringJob = mock(async () => ({ queued: true as const }))

mock.module('../scoring/scoring.queue', () => ({
  enqueueApplicationScoringJob,
}))

const { createPublicCareersRoutes } = await import('./public.routes')

describe('public careers apply scoring enqueue', () => {
  test('enqueues durable AI scoring job instead of direct scoring call', async () => {
    const prisma = {
      tenant: {
        findFirst: async () => ({ id: 'tenant-1' }),
      },
      vacancy: {
        findFirst: async () => ({ id: 'vac-1', title: 'Logist' }),
      },
      candidate: {
        findFirst: async () => null,
        create: async () => ({ id: 'cand-1' }),
      },
      application: {
        create: async () => ({ id: '00000000-0000-0000-0000-000000000123' }),
      },
    }

    const env = {
      CAREERS_PAGE_ENABLED: true,
      CAREERS_RATE_LIMIT_PER_HOUR: 20,
      AI_SCORING_ENABLED: true,
    }

    const app = new Hono<{ Variables: { prisma: unknown; env: unknown } }>()
    app.use('*', async (c, next) => {
      c.set('prisma', prisma)
      c.set('env', env)
      await next()
    })
    app.route('/api/public', createPublicCareersRoutes())

    const response = await app.request('/api/public/vacancies/test-slug/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'John Doe',
        email: 'john@example.com',
        consent: true,
      }),
    })

    expect(response.status).toBe(201)
    expect(enqueueApplicationScoringJob).toHaveBeenCalledTimes(1)
    expect(enqueueApplicationScoringJob).toHaveBeenCalledWith({
      prisma,
      env,
      applicationId: '00000000-0000-0000-0000-000000000123',
    })
  })
})
