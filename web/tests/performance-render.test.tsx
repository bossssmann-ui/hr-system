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
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-content' }, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-header' }, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-slot': 'dialog-title' }, children),
  DialogClose: ({ children }: { children?: React.ReactNode }) => children,
}))

// Stable mock data
const oneOnOneItems = [
  {
    id: '11111111-0000-0000-0000-000000000001',
    tenantId: 't1',
    employeeId: 'e1',
    managerUserId: 'u1',
    scheduledAt: '2026-07-01T10:00:00.000Z',
    durationMinutes: null,
    status: 'scheduled',
    agenda: 'Q3 planning',
    notes: null,
    actionItems: [],
    reminderSentAt: null,
    completedAt: null,
    createdByUserId: 'u1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
]

const reviewCycleItems = [
  {
    id: 'c1',
    tenantId: 't1',
    title: 'Q2 2026 Review',
    quarter: '2026-Q2',
    status: 'open',
    questions: [],
    openedAt: '2026-06-01T00:00:00.000Z',
    closesAt: '2026-07-15T00:00:00.000Z',
    closedAt: null,
    createdByUserId: 'u1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    stats: { total: 10, pending: 3, submitted: 7, declined: 0 },
  },
]

const okrItems = [
  {
    id: 'okr1',
    tenantId: 't1',
    employeeId: 'e1',
    parentOkrId: null,
    quarter: '2026-Q2',
    objective: 'Grow platform engagement',
    description: null,
    status: 'active',
    progressPercent: 60,
    createdByUserId: 'u1',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    keyResults: [
      {
        id: 'kr1',
        okrId: 'okr1',
        title: 'DAU +20%',
        unit: '%',
        startValue: 0,
        targetValue: 20,
        currentValue: 12,
        status: 'on_track',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
  },
]

const idpItems = [
  {
    id: 'idp1',
    tenantId: 't1',
    employeeId: 'e1',
    quarter: '2026-Q2',
    summary: 'Leadership skills',
    status: 'active',
    createdByUserId: 'u1',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    items: [
      {
        id: 'item1',
        idpId: 'idp1',
        title: 'Complete leadership course',
        description: null,
        status: 'in_progress',
        dueDate: '2026-09-30',
        completedAt: null,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    progress: 30,
  },
]

function makeQueryMock(oneOnOneData: typeof oneOnOneItems | [] = oneOnOneItems, loadingKey?: string) {
  return {
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
    useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[1]
      if (key === 'one-on-ones') {
        if (loadingKey === 'one-on-ones') return { isLoading: true, isError: false, data: undefined }
        return { isLoading: false, isError: false, data: { items: oneOnOneData, total: oneOnOneData.length } }
      }
      if (key === 'review-cycles') {
        return { isLoading: false, isError: false, data: { items: reviewCycleItems } }
      }
      if (key === 'review-requests') {
        return { isLoading: false, isError: false, data: { items: [] } }
      }
      if (key === 'okrs') {
        return { isLoading: false, isError: false, data: { items: okrItems } }
      }
      if (key === 'idps') {
        return { isLoading: false, isError: false, data: { items: idpItems } }
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
      listOneOnOnes: async () => ({ items: oneOnOneItems, total: 1 }),
      createOneOnOne: async () => oneOnOneItems[0],
      completeOneOnOne: async () => ({ ...oneOnOneItems[0], status: 'completed' }),
      listReviewCycles: async () => ({ items: reviewCycleItems }),
      openReviewCycle: async () => reviewCycleItems[0],
      closeReviewCycle: async () => ({ ...reviewCycleItems[0], status: 'closed' }),
      listMyReviewRequests: async () => ({ items: [] }),
      submitReviewRequest: async () => ({}),
      listOkrs: async () => ({ items: okrItems }),
      patchOkrKeyResult: async () => okrItems[0].keyResults[0],
      listIdps: async () => ({ items: idpItems }),
      patchIdpItem: async () => idpItems[0].items[0],
    },
  }),
}))

describe('ReviewsPage (Performance)', () => {
  test('renders the performance page with all four tabs', async () => {
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    expect(html).toContain('tabs.oneOnOne')
    expect(html).toContain('tabs.reviews')
    expect(html).toContain('tabs.okr')
    expect(html).toContain('tabs.idp')
  })

  test('1:1 tab renders meeting list and Schedule button', async () => {
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    // Schedule button present
    expect(html).toContain('actions.schedule')
    // Meeting card shows agenda text
    expect(html).toContain('Q3 planning')
    // Status badge key rendered
    expect(html).toContain('oneOnOne.status.scheduled')
  })

  test('1:1 tab shows loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock(oneOnOneItems, 'one-on-ones'))
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)
    expect(html).toContain('loading')
  })

  test('1:1 tab shows empty state when no items', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock([]))
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)
    expect(html).toContain('oneOnOne.empty')
  })

  test('reviews tab renders cycle list with completion stats', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    expect(html).toContain('Q2 2026 Review')
    expect(html).toContain('reviews.cycleStatus.open')
    // Completion stat numbers appear
    expect(html).toContain('7')
    expect(html).toContain('10')
  })

  test('OKR tab renders OKR with progress bar', async () => {
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    expect(html).toContain('Grow platform engagement')
    expect(html).toContain('okr.status.active')
    expect(html).toContain('60%')
  })

  test('IDP tab renders IDP with progress', async () => {
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    expect(html).toContain('Leadership skills')
    expect(html).toContain('idp.status.active')
    expect(html).toContain('30%')
  })

  test('Schedule 1:1 dialog contains form fields', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { ReviewsPage } = await import('../src/pages/reviews')
    const html = renderToStaticMarkup(<ReviewsPage />)

    // Dialog title for scheduling
    expect(html).toContain('oneOnOne.schedule')
    // Form field labels
    expect(html).toContain('oneOnOne.employeeId')
    expect(html).toContain('oneOnOne.managerUserId')
    expect(html).toContain('oneOnOne.scheduledAt')
  })
})

