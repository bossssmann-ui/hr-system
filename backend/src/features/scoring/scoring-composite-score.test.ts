import { describe, expect, mock, test } from 'bun:test'

const recomputeCompositeScoreForApplication = mock(async () => {
  throw new Error('recompute failed')
})
const recordCompositeScoreRecomputeFailure = mock(async () => undefined)

mock.module('../applications/composite-score', () => ({
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
}))

const { scoreApplication } = await import('./scoring.service')

describe('scoreApplication composite score isolation', () => {
  test('does not fail scoring when composite score recomputation throws', async () => {
    const prisma = createPrismaMock()
    const provider = {
      score: async () => ({
        relevance_score: 77,
        summary: 'Good fit',
        strengths: [],
        gaps: [],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Strong',
        interview_focus_areas: [],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: {
        AI_SCORING_ENABLED: true,
        LLM_SCORING_API_KEY: 'test-key',
        LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
      } as never,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result).toMatchObject({ skipped: false, status: 'scored' })
    expect(recordCompositeScoreRecomputeFailure).toHaveBeenCalledTimes(1)
  })
})

function createPrismaMock() {
  const state = {
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'cand-1',
      stage: 'new',
      aiScoring: null,
      candidate: { location: 'Moscow', externalIds: {} },
      vacancy: {
        title: 'Backend Engineer',
        description: 'TypeScript',
        requisition: { grade: 'M3', salaryMin: 100000, salaryMax: 150000, currency: 'RUB' },
      },
    },
  }

  return {
    application: {
      findFirst: async () => state.application,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.application, data)
        return state.application
      },
    },
    resume: {
      findFirst: async () => null,
    },
    applicationStageEvent: {
      create: async () => undefined,
    },
    auditEvent: {
      create: async () => undefined,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      application: {
        findFirst: async () => ({ stage: state.application.stage }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.application, data)
          return state.application
        },
      },
      applicationStageEvent: {
        create: async () => undefined,
      },
      auditEvent: {
        create: async () => undefined,
      },
    }),
  }
}
