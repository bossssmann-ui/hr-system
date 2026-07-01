import { describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

const recomputeCompositeScoreForApplication = mock(async () => {
  throw new Error('recompute failed')
})
const recordCompositeScoreRecomputeFailure = mock(async () => undefined)

mock.module('../applications/composite-score', () => ({
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
}))

const { createPublicAssessmentRoutes } = await import('./assessments.routes')

describe('public assessment composite score isolation', () => {
  test('does not fail assessment submit when composite score recomputation throws', async () => {
    const prisma = createPrismaMock()
    const app = new Hono<{ Variables: { prisma: unknown; env: unknown } }>()
    app.use('*', async (c, next) => {
      c.set('prisma', prisma)
      c.set('env', {
        ASSESSMENTS_ENABLED: true,
        AI_SCORING_ENABLED: false,
        TRUST_WEIGHT_PASTE: 0.35,
        TRUST_WEIGHT_FOCUS: 0.4,
        TRUST_WEIGHT_KEYSTROKE: 0.25,
        TRUST_LOW_THRESHOLD: 50,
      })
      await next()
    })
    app.route('/api/public/assessment', createPublicAssessmentRoutes())

    const response = await app.request('/api/public/assessment/token-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ question_id: '11111111-1111-4111-8111-111111111111', answer: 'Protocol' }],
        signals: {
          paste_events: { count: 0, sizes: [] },
          focus_loss_events: { count: 0, total_away_ms: 0 },
          keystroke_timing: { anomaly_flags: 0, burst_events: 0 },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(recordCompositeScoreRecomputeFailure).toHaveBeenCalledTimes(1)
  })
})

function createPrismaMock() {
  const session = {
    id: 'session-1',
    tenantId: 'tenant-1',
    applicationId: 'app-1',
    inviteToken: 'token-1',
    consentRecorded: true,
    status: 'in_progress',
    startedAt: new Date(),
    submittedAt: null,
    trustScore: null,
    template: {
      id: 'template-1',
      timeLimitMin: 30,
      questions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          type: 'open',
          prompt: 'Why?',
          rubric: null,
          weight: 1,
        },
      ],
    },
  }

  const tx = {
    assessmentAnswer: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    assessmentSession: {
      update: async () => session,
    },
    application: {
      update: async () => undefined,
    },
  }

  return {
    assessmentSession: {
      findUnique: async () => session,
    },
    $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx),
  }
}
