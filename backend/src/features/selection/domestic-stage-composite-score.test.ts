import { describe, expect, mock, test } from 'bun:test'

const recomputeCompositeScoreForApplication = mock(async () => {
  throw new Error('recompute failed')
})
const recordCompositeScoreRecomputeFailure = mock(async () => undefined)
const notifyRecruitersAboutSelectionReady = mock(async () => undefined)
const notifyRecipientsForEvent = mock(async () => undefined)
const runAutoAssessmentAfterSelection = mock(async () => undefined)

mock.module('../applications/composite-score', () => ({
  recomputeCompositeScoreForApplication,
  recordCompositeScoreRecomputeFailure,
}))

mock.module('../applications/application-notifications', () => ({
  notifyRecruitersAboutSelectionReady,
}))

mock.module('../notifications/recruiter-event-notifications', () => ({
  notifyRecipientsForEvent,
}))

mock.module('./auto-assessment-after-selection', () => ({
  runAutoAssessmentAfterSelection,
}))

const { finalizeDomesticStage4 } = await import('./domestic-stage-scoring')

describe('finalizeDomesticStage4 composite score isolation', () => {
  test('does not fail domestic finalization when composite score recomputation throws', async () => {
    const persistedModuleResults = [
      { packageId: 'domestic_core_operations', rawScore: 6, maxScore: 6 },
      { packageId: 'domestic_road_ftl_ltl', rawScore: 30, maxScore: 30 },
    ]
    const prisma = createPrismaMock({
      id: 'sess-1',
      tenantId: 'tenant-1',
      template: { role: 'logist_domestic' },
      stageResults: [
        { stageNumber: 2, answers: {}, scores: { moduleResults: persistedModuleResults } },
        { stageNumber: 4, answers: { practical: 'ok' }, scores: null },
      ],
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
      ],
      assessmentProfile: { signals: [], riskFlags: [] },
      applicationId: 'app-1',
    })

    const result = await finalizeDomesticStage4(
      prisma as never,
      'sess-1',
      { COMPOSITE_SCORE_ENABLED: true, RECRUITER_NOTIFICATIONS_ENABLED: true } as never,
    )

    expect(result).not.toBeNull()
    expect(recordCompositeScoreRecomputeFailure).toHaveBeenCalledTimes(1)
    expect(notifyRecipientsForEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'selection.completed',
      }),
    )
  })
})

function createPrismaMock(session: Record<string, unknown>) {
  const prisma = {
    selectionSession: {
      findUnique: async () => session,
      update: async () => session,
    },
    selectionScoringWeights: {
      findFirst: async () => null,
    },
    selectionVerdict: {
      upsert: async () => ({ id: 'verdict-1' }),
    },
    application: {
      findFirst: async () => ({
        id: 'app-1',
        tenantId: 'tenant-1',
        stage: 'new',
        assignedToUserId: 'user-1',
      }),
      update: async () => ({ id: 'app-1' }),
    },
    tenantSettings: {
      findUnique: async () => ({ featureFlags: {} }),
    },
    userRole: {
      findFirst: async () => ({ userId: 'user-1' }),
    },
    applicationStageEvent: {
      create: async () => undefined,
    },
    auditEvent: {
      create: async () => undefined,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }

  return prisma
}
