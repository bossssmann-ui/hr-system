import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}))

mock.module('sonner', () => ({
  toast: { success: () => {}, error: () => {} },
}))

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'selection-funnel') {
      return {
        isPending: false,
        isError: false,
        data: {
          period: 'today',
          newApplications: 5,
          aiProcessed: 4,
          passedToRecruiter: 2,
          aiRejected: 1,
          manualReview: 1,
          inProgress: 1,
          processedCandidates: [
            {
              applicationId: 'app-1',
              candidateId: 'cand-1',
              unifiedScore: 92,
              scoreStatus: 'final',
              verdict: 'ДОПУСТИТЬ',
              trustScore: 88,
              retentionPrediction: { survival30: 0.9, survival60: 0.8, survival90: 0.7, confidence: 0.8, modelVersion: 'm1' },
              hrNotes: 'Strong',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      }
    }
    return {
      isPending: false,
      isError: false,
      data: { total: 0, page: 1, pageSize: 20, items: [] },
    }
  },
}))

mock.module('../src/lib/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    api: {
      listSelectionSessions: async () => ({ total: 0, page: 1, pageSize: 20, items: [] }),
      getRecruiterFunnel: async () => ({
        period: 'today',
        newApplications: 0,
        aiProcessed: 0,
        passedToRecruiter: 0,
        aiRejected: 0,
        manualReview: 0,
        inProgress: 0,
        processedCandidates: [],
      }),
      moveApplicationStage: async () => ({}),
      getApplication: async () => ({ id: 'app-1', stage: 'new' }),
      getSelectionVerdict: async () => null,
    },
  }),
}))

describe('SelectionDashboardPage', () => {
  test('renders funnel cards and processed candidates table', async () => {
    const { SelectionDashboardPage } = await import('../src/pages/selection-dashboard')
    const html = renderToStaticMarkup(<SelectionDashboardPage />)

    expect(html).toContain('dashboard.funnel.new')
    expect(html).toContain('dashboard.processed.columns.score')
    expect(html).toContain('92/100')
  })
})
