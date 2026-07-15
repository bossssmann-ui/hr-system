import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

const enqueueApplicationScoringJob = mock(
  async (input: { applicationId: string }) => {
    if (input.applicationId === 'fail-enqueue') {
      throw new Error('enqueue failed')
    }
    if (input.applicationId === 'skip-app') {
      return { queued: false as const, reason: 'not_configured' as const }
    }
    return { queued: true as const }
  },
)

let mockRoles: string[] = ['owner']

mock.module('../../auth/requireRole', () => ({
  requireRole:
    (...allowed: string[]) =>
    async (
      c: {
        set: (key: string, value: unknown) => void
        json: (body: unknown, status?: number) => Response
      },
      next: () => Promise<void>,
    ) => {
      if (allowed.length > 0 && !mockRoles.some((role) => allowed.includes(role))) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Caller does not have the required role' } }, 403)
      }
      c.set('userId', 'user-1')
      c.set('tenantId', 'tenant-1')
      c.set('roles', mockRoles)
      await next()
    },
}))

mock.module('../scoring/scoring.queue', () => ({
  enqueueApplicationScoringJob,
}))

const { createApplicationsRoutes } = await import('./applications.routes')

type AppRow = { id: string; stage: string; vacancyId: string }

function createPrisma(rows: AppRow[]) {
  return {
    application: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          tenantId: string
          vacancyId?: string
          AND?: Array<Record<string, unknown>>
          stage?: string | { notIn: string[] }
        }
        take?: number
      }) => {
        let filtered = rows.filter(() => where.tenantId === 'tenant-1')

        const and = where.AND ?? []
        for (const clause of and) {
          if (typeof clause.vacancyId === 'string') {
            filtered = filtered.filter((row) => row.vacancyId === clause.vacancyId)
          }
          if (typeof clause.stage === 'string') {
            filtered = filtered.filter((row) => row.stage === clause.stage)
          }
          if (
            clause.stage &&
            typeof clause.stage === 'object' &&
            Array.isArray((clause.stage as { notIn?: string[] }).notIn)
          ) {
            const notIn = (clause.stage as { notIn: string[] }).notIn
            filtered = filtered.filter((row) => !notIn.includes(row.stage))
          }
        }

        if (typeof where.vacancyId === 'string') {
          filtered = filtered.filter((row) => row.vacancyId === where.vacancyId)
        }
        if (typeof where.stage === 'string') {
          filtered = filtered.filter((row) => row.stage === where.stage)
        }
        if (where.stage && typeof where.stage === 'object' && Array.isArray(where.stage.notIn)) {
          const notIn = where.stage.notIn
          filtered = filtered.filter((row) => !notIn.includes(row.stage))
        }

        return filtered.slice(0, take ?? filtered.length).map((row) => ({ id: row.id }))
      },
    },
  }
}

function mountApp(prisma: ReturnType<typeof createPrisma>) {
  const env = { AI_SCORING_ENABLED: true }
  const app = new Hono<{
    Variables: {
      prisma: unknown
      env: unknown
      userId: string
      tenantId: string
      roles: string[]
      auditEntry?: unknown
    }
  }>()
  app.onError((err, c) => {
    if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
      const appErr = err as unknown as { status: number; code: string; message: string }
      return c.json({ error: { code: appErr.code, message: appErr.message } }, appErr.status as 403)
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: String(err) } }, 500)
  })
  app.use('*', async (c, next) => {
    c.set('prisma', prisma)
    c.set('env', env)
    await next()
  })
  app.route('/api/applications', createApplicationsRoutes())
  return app
}

describe('POST /api/applications/rescore-all', () => {
  beforeEach(() => {
    enqueueApplicationScoringJob.mockClear()
    mockRoles = ['owner']
  })

  test('returns 403 for recruiter', async () => {
    mockRoles = ['recruiter']
    const app = mountApp(createPrisma([{ id: 'app-1', stage: 'new', vacancyId: '11111111-1111-4111-8111-111111111111' }]))
    const res = await app.request('/api/applications/rescore-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
    expect(enqueueApplicationScoringJob).not.toHaveBeenCalled()
  })

  test('returns 403 for hiring_manager', async () => {
    mockRoles = ['hiring_manager']
    const app = mountApp(createPrisma([{ id: 'app-1', stage: 'new', vacancyId: '11111111-1111-4111-8111-111111111111' }]))
    const res = await app.request('/api/applications/rescore-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  test('owner queues non-terminal applications and skips terminal stages', async () => {
    const vacancyId = '11111111-1111-4111-8111-111111111111'
    const rows: AppRow[] = [
      { id: 'app-new', stage: 'new', vacancyId },
      { id: 'app-screen', stage: 'screen', vacancyId },
      { id: 'app-hired', stage: 'hired', vacancyId },
      { id: 'app-rejected', stage: 'rejected', vacancyId },
      { id: 'skip-app', stage: 'tech', vacancyId },
      { id: 'fail-enqueue', stage: 'final', vacancyId },
    ]
    const app = mountApp(createPrisma(rows))
    const res = await app.request('/api/applications/rescore-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ queued: 2, skipped: 2 })
    expect(enqueueApplicationScoringJob).toHaveBeenCalledTimes(4)
    const calledIds = enqueueApplicationScoringJob.mock.calls.map(
      (call) => (call[0] as { applicationId: string }).applicationId,
    )
    expect(calledIds).toEqual(['app-new', 'app-screen', 'skip-app', 'fail-enqueue'])
    for (const call of enqueueApplicationScoringJob.mock.calls) {
      expect(call[0]).toMatchObject({
        applicationId: expect.any(String),
        actorUserId: 'user-1',
        force: true,
      })
    }
  })

  test('filters by vacancyId and stage', async () => {
    const vacancyA = '11111111-1111-4111-8111-111111111111'
    const vacancyB = '22222222-2222-4222-8222-222222222222'
    const rows: AppRow[] = [
      { id: 'a-new', stage: 'new', vacancyId: vacancyA },
      { id: 'a-screen', stage: 'screen', vacancyId: vacancyA },
      { id: 'b-new', stage: 'new', vacancyId: vacancyB },
    ]
    const app = mountApp(createPrisma(rows))
    const res = await app.request('/api/applications/rescore-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vacancyId: vacancyA, stage: 'screen' }),
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: 1, skipped: 0 })
    expect(enqueueApplicationScoringJob).toHaveBeenCalledTimes(1)
    expect(enqueueApplicationScoringJob.mock.calls[0]?.[0]).toMatchObject({
      applicationId: 'a-screen',
      force: true,
    })
  })

  test('hr_admin can rescore all', async () => {
    mockRoles = ['hr_admin']
    const vacancyId = '11111111-1111-4111-8111-111111111111'
    const app = mountApp(createPrisma([{ id: 'app-1', stage: 'offer', vacancyId }]))
    const res = await app.request('/api/applications/rescore-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: 1, skipped: 0 })
  })
})
