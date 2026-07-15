import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) {
        return Object.entries(opts).reduce(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          key,
        )
      }
      return key
    },
  }),
}))

mock.module('sonner', () => ({
  toast: { success: () => {}, error: () => {} },
}))

// Stub Radix-backed UI components to avoid duplicate-React issues in SSR tests
mock.module('../src/components/ui/tabs', () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'tabs' }, children),
  TabsList: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'tabs-list' }, children),
  TabsTrigger: ({ value, children }: { value?: string; children?: React.ReactNode }) =>
    React.createElement('button', { 'data-slot': 'tabs-trigger', 'data-value': value }, children),
  TabsContent: ({ value, children }: { value?: string; children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'tabs-content', 'data-value': value }, children),
}))

mock.module('../src/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog' }, children),
  DialogTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) => children,
  DialogPortal: ({ children }: { children?: React.ReactNode }) => children,
  DialogOverlay: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-overlay' }, children),
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-content' }, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-header' }, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-footer' }, children),
  DialogTitle: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement(
      'div',
      { 'data-slot': 'dialog-title', className: ['font-heading text-base', className].filter(Boolean).join(' ') },
      children,
    ),
  DialogDescription: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement(
      'p',
      { 'data-slot': 'dialog-description', className: ['text-muted-foreground text-sm', className].filter(Boolean).join(' ') },
      children,
    ),
  DialogClose: ({ children }: { children?: React.ReactNode }) => children,
}))

// ─── Stable mock data ─────────────────────────────────────────────────────────

const draftSurvey = {
  id: 'survey-draft-1',
  tenantId: 't1',
  title: 'Q2 2026 eNPS',
  kind: 'enps' as const,
  status: 'draft' as const,
  question: 'How likely are you to recommend us?',
  openedAt: null,
  closesAt: null,
  closedAt: null,
  createdByUserId: 'u1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const openSurvey = {
  ...draftSurvey,
  id: 'survey-open-1',
  title: 'Q3 2026 eNPS Open',
  status: 'open' as const,
  openedAt: '2026-07-01T00:00:00.000Z',
}

const closedSurvey = {
  ...draftSurvey,
  id: 'survey-closed-1',
  title: 'Q1 2026 eNPS Closed',
  status: 'closed' as const,
  openedAt: '2026-04-01T00:00:00.000Z',
  closedAt: '2026-06-30T00:00:00.000Z',
}

const enpsResults = {
  score: 42,
  promoters: 21,
  passives: 5,
  detractors: 4,
  responded: 30,
  total: 50,
  distribution: { '0': 1, '1': 0, '2': 1, '3': 1, '4': 1, '5': 0, '6': 0, '7': 2, '8': 3, '9': 10, '10': 11 },
  comments: ['Great place to work!', 'Good culture but room for improvement'],
}

// ─── Query mock helpers ───────────────────────────────────────────────────────

function makeQueryMock(overrides?: {
  surveysLoading?: boolean
  surveysEmpty?: boolean
  resultsLoading?: boolean
  selectedSurveyId?: string
}) {
  return {
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
    useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[1]
      if (key === 'surveys') {
        if (overrides?.surveysLoading) return { isLoading: true, isError: false, data: undefined }
        if (overrides?.surveysEmpty) return { isLoading: false, isError: false, data: { items: [] } }
        return {
          isLoading: false,
          isError: false,
          data: { items: [draftSurvey, openSurvey, closedSurvey] },
        }
      }
      if (key === 'results') {
        if (overrides?.resultsLoading) return { isLoading: true, isError: false, data: undefined, enabled: true }
        return {
          isLoading: false,
          isError: false,
          data: enpsResults,
          enabled: !!overrides?.selectedSurveyId,
        }
      }
      return { isLoading: false, isError: false, data: null }
    },
  }
}

mock.module('@tanstack/react-query', () => makeQueryMock())

mock.module('../src/lib/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    api: {
      listSurveys: async () => ({ items: [draftSurvey, openSurvey, closedSurvey] }),
      listOpenSurveys: async () => ({ items: [openSurvey] }),
      createSurvey: async () => draftSurvey,
      openSurvey: async () => ({ ...draftSurvey, status: 'open' }),
      closeSurvey: async () => ({ ...openSurvey, status: 'closed' }),
      submitSurveyResponse: async () => ({
        id: 'resp-1',
        tenantId: 't1',
        surveyId: openSurvey.id,
        respondentEmployeeId: 'e1',
        score: 9,
        comment: null,
        submittedAt: '2026-07-01T00:00:00.000Z',
      }),
      getSurveyResults: async () => enpsResults,
    },
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EngagementPage', () => {
  test('renders tabs: surveys, results, respond', async () => {
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('tabs.surveys')
    expect(html).toContain('tabs.results')
    expect(html).toContain('tabs.respond')
  })

  test('surveys tab renders survey list', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('Q2 2026 eNPS')
    expect(html).toContain('Q3 2026 eNPS Open')
    expect(html).toContain('Q1 2026 eNPS Closed')
  })

  test('surveys tab shows loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ surveysLoading: true }))
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)
    expect(html).toContain('loading')
  })

  test('surveys tab shows empty state when no surveys', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ surveysEmpty: true }))
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)
    expect(html).toContain('surveys.empty')
  })

  test('surveys tab shows status badges', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('surveys.status.draft')
    expect(html).toContain('surveys.status.open')
    expect(html).toContain('surveys.status.closed')
  })

  test('surveys tab shows Create survey button', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('actions.create')
    expect(html).toContain('create.title')
  })

  test('create survey dialog has form fields', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('create.titleLabel')
    expect(html).toContain('create.kindLabel')
    expect(html).toContain('create.questionLabel')
    expect(html).toContain('create.closesAtLabel')
  })

  test('results tab shows survey selector', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('actions.selectSurvey')
    expect(html).toContain('results.noSurveySelected')
  })

  test('results tab renders eNPS score when survey selected', async () => {
    const { EnpsResultsDisplay } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(
      React.createElement(EnpsResultsDisplay, { data: enpsResults }),
    )

    // eNPS score display
    expect(html).toContain('+42')
    expect(html).toContain('results.score')
    // Group labels
    expect(html).toContain('results.promoters')
    expect(html).toContain('results.passives')
    expect(html).toContain('results.detractors')
    // Group counts
    expect(html).toContain('21')
    expect(html).toContain('4')
  })

  test('results tab renders comments', async () => {
    const { EnpsResultsDisplay } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(
      React.createElement(EnpsResultsDisplay, { data: enpsResults }),
    )

    expect(html).toContain('Great place to work!')
    expect(html).toContain('Good culture but room for improvement')
  })

  test('respond tab shows no open survey message when none available', async () => {
    mock.module('@tanstack/react-query', () => ({
      useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
      useMutation: () => ({ mutate: () => {}, isPending: false }),
      useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
        const key = queryKey[1]
        if (key === 'surveys') {
          return {
            isLoading: false,
            isError: false,
            data: { items: [] },
          }
        }
        return { isLoading: false, isError: false, data: null }
      },
    }))
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)
    expect(html).toContain('respond.noOpenSurvey')
  })

  test('respond tab renders response form when open survey exists', async () => {
    mock.module('@tanstack/react-query', () => ({
      useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
      useMutation: () => ({ mutate: () => {}, isPending: false }),
      useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
        const key = queryKey[1]
        if (key === 'surveys') {
          return {
            isLoading: false,
            isError: false,
            data: { items: [openSurvey] },
          }
        }
        return { isLoading: false, isError: false, data: null }
      },
    }))
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)

    expect(html).toContain('respond.title')
    expect(html).toContain('respond.scoreLabel')
    expect(html).toContain('How likely are you to recommend us?')
    expect(html).toContain('actions.submit')
  })

  test('renders unauthenticated state when no user', async () => {
    mock.module('../src/lib/use-auth', () => ({
      useAuth: () => ({ user: null, api: {} }),
    }))
    const { EngagementPage } = await import('../src/pages/engagement')
    const html = renderToStaticMarkup(<EngagementPage />)
    expect(html).toContain('signInPrompt')
  })
})
