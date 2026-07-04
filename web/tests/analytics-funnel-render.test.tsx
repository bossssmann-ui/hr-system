import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RecruiterFunnelMetrics } from '@web-app-demo/contracts'

mock.module('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// ─── Stable mock data ─────────────────────────────────────────────────────────

const funnelData: RecruiterFunnelMetrics = {
  period: 'today',
  newApplications: 10,
  aiProcessed: 8,
  passedToRecruiter: 5,
  aiRejected: 2,
  manualReview: 1,
  inProgress: 2,
  processedCandidates: [
    {
      applicationId: 'app-1',
      candidateId: 'cand-1111-1111-1111',
      unifiedScore: 87.5,
      scoreStatus: 'final',
      verdict: 'passed',
      trustScore: 0.9,
      retentionPrediction: null,
      hrNotes: null,
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      applicationId: 'app-2',
      candidateId: 'cand-2222-2222-2222',
      unifiedScore: null,
      scoreStatus: 'preliminary',
      verdict: null,
      trustScore: null,
      retentionPrediction: null,
      hrNotes: null,
      createdAt: '2026-07-01T11:00:00.000Z',
    },
  ],
}

const emptyFunnelData: RecruiterFunnelMetrics = {
  period: 'today',
  newApplications: 0,
  aiProcessed: 0,
  passedToRecruiter: 0,
  aiRejected: 0,
  manualReview: 0,
  inProgress: 0,
  processedCandidates: [],
}

// ─── Query mock helpers ───────────────────────────────────────────────────────

function makeQueryMock(overrides?: {
  funnelLoading?: boolean
  funnelError?: boolean
  funnelEmpty?: boolean
  funnelPeriod?: string
}) {
  return {
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
    useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[1]

      if (key === 'recruiter-funnel') {
        if (overrides?.funnelLoading) return { isLoading: true, isError: false, data: undefined }
        if (overrides?.funnelError) return { isLoading: false, isError: true, data: undefined }
        if (overrides?.funnelEmpty) return { isLoading: false, isError: false, data: emptyFunnelData }
        return { isLoading: false, isError: false, data: funnelData }
      }

      // default: return empty loading state for all other queries
      return { isLoading: false, isError: false, data: null }
    },
  }
}

mock.module('@tanstack/react-query', () => makeQueryMock())

mock.module('../src/lib/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    api: {
      getRecruiterFunnel: async () => funnelData,
      getHrDashboard: async () => null,
      listHrSnapshots: async () => ({ items: [] }),
      computeHrSnapshot: async () => null,
      payrollExportCsvUrl: () => '/export',
      listAnalyticsSignals: async () => ({ items: [] }),
      updateAnalyticsSignal: async () => null,
      computeAnalyticsSignals: async () => null,
    },
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RecruiterFunnelDisplay', () => {
  test('renders funnel stage KPIs', async () => {
    const { RecruiterFunnelDisplay } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(
      React.createElement(RecruiterFunnelDisplay, { data: funnelData }),
    )

    expect(html).toContain('funnel.newApplications')
    expect(html).toContain('funnel.aiProcessed')
    expect(html).toContain('funnel.passedToRecruiter')
    expect(html).toContain('funnel.aiRejected')
    expect(html).toContain('funnel.manualReview')
    expect(html).toContain('funnel.inProgress')
  })

  test('renders conversion percentages', async () => {
    const { RecruiterFunnelDisplay } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(
      React.createElement(RecruiterFunnelDisplay, { data: funnelData }),
    )

    // 8/10 = 80%
    expect(html).toContain('80%')
    // 5/8 = 62.5% → rounds to 63%
    expect(html).toContain('63%')
    expect(html).toContain('funnel.conversionAiProcessed')
    expect(html).toContain('funnel.conversionPassed')
  })

  test('renders processed candidates table', async () => {
    const { RecruiterFunnelDisplay } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(
      React.createElement(RecruiterFunnelDisplay, { data: funnelData }),
    )

    expect(html).toContain('funnel.tableTitle')
    expect(html).toContain('funnel.colCandidate')
    expect(html).toContain('funnel.colScore')
    expect(html).toContain('funnel.colVerdict')
    expect(html).toContain('funnel.colTrust')
    // candidate id prefix
    expect(html).toContain('cand-111')
    // score value
    expect(html).toContain('87.5')
    // verdict
    expect(html).toContain('passed')
  })

  test('renders empty state when newApplications is 0', async () => {
    const { RecruiterFunnelDisplay } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(
      React.createElement(RecruiterFunnelDisplay, { data: emptyFunnelData }),
    )

    expect(html).toContain('funnel.empty')
    expect(html).not.toContain('funnel.tableTitle')
  })
})

describe('AnalyticsPage funnel section', () => {
  test('renders funnel section title', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { AnalyticsPage } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(React.createElement(AnalyticsPage))
    expect(html).toContain('funnel.title')
  })

  test('renders funnel loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ funnelLoading: true }))
    const { AnalyticsPage } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(React.createElement(AnalyticsPage))
    expect(html).toContain('loading')
  })

  test('renders funnel error state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ funnelError: true }))
    const { AnalyticsPage } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(React.createElement(AnalyticsPage))
    expect(html).toContain('loadFailed')
  })

  test('renders funnel empty state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ funnelEmpty: true }))
    const { AnalyticsPage } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(React.createElement(AnalyticsPage))
    expect(html).toContain('funnel.empty')
  })

  test('renders period selector', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { AnalyticsPage } = await import('../src/pages/analytics')
    const html = renderToStaticMarkup(React.createElement(AnalyticsPage))
    expect(html).toContain('funnel.period')
    expect(html).toContain('funnel.periodToday')
    expect(html).toContain('funnel.periodWeek')
    expect(html).toContain('funnel.periodAll')
  })
})
