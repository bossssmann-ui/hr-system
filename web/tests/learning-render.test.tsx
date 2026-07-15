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

const course1 = {
  id: 'course-1',
  tenantId: 't1',
  title: 'Introduction to TypeScript',
  description: 'Learn TypeScript fundamentals',
  contentType: 'video' as const,
  contentUrl: 'https://example.com/ts-intro',
  durationMinutes: 60,
  isMandatory: true,
  orgUnitId: null,
  createdByUserId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const course2 = {
  ...course1,
  id: 'course-2',
  title: 'Advanced React',
  description: null,
  contentType: 'article' as const,
  isMandatory: false,
  durationMinutes: null,
}

const path1 = {
  id: 'path-1',
  tenantId: 't1',
  title: 'Frontend Developer Path',
  description: 'Complete frontend learning path',
  roleFamily: 'Engineering',
  autoAssign: true,
  createdByUserId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const assignment1 = {
  id: 'assign-1',
  tenantId: 't1',
  employeeId: 'u1',
  courseId: 'course-1',
  pathId: null,
  status: 'assigned' as const,
  progressPercent: 0,
  score: null,
  dueDate: '2026-12-31',
  startedAt: null,
  completedAt: null,
  assignedByUserId: 'u2',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const assignment2 = {
  ...assignment1,
  id: 'assign-2',
  courseId: null,
  pathId: 'path-1',
  status: 'started' as const,
  progressPercent: 50,
}

// ─── Query mock helpers ───────────────────────────────────────────────────────

function makeQueryMock(overrides?: {
  coursesLoading?: boolean
  coursesEmpty?: boolean
  pathsLoading?: boolean
  pathsEmpty?: boolean
  assignmentsLoading?: boolean
  assignmentsEmpty?: boolean
}) {
  return {
    useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
    useMutation: () => ({ mutate: () => {}, isPending: false }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = queryKey[1]
      if (key === 'courses') {
        if (overrides?.coursesLoading) return { isLoading: true, isError: false, data: undefined }
        if (overrides?.coursesEmpty) return { isLoading: false, isError: false, data: { items: [] } }
        return { isLoading: false, isError: false, data: { items: [course1, course2] } }
      }
      if (key === 'paths') {
        if (overrides?.pathsLoading) return { isLoading: true, isError: false, data: undefined }
        if (overrides?.pathsEmpty) return { isLoading: false, isError: false, data: { items: [] } }
        return { isLoading: false, isError: false, data: { items: [path1] } }
      }
      if (key === 'assignments') {
        if (overrides?.assignmentsLoading) return { isLoading: true, isError: false, data: undefined }
        if (overrides?.assignmentsEmpty) return { isLoading: false, isError: false, data: { items: [] } }
        return { isLoading: false, isError: false, data: { items: [assignment1, assignment2] } }
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
      listCourses: async () => ({ items: [course1, course2] }),
      createCourse: async () => course1,
      updateCourse: async () => course1,
      deleteCourse: async () => {},
      listPaths: async () => ({ items: [path1] }),
      createPath: async () => path1,
      updatePath: async () => path1,
      deletePath: async () => {},
      listAssignments: async () => ({ items: [assignment1, assignment2] }),
      listMyAssignments: async () => ({ items: [assignment1, assignment2] }),
      createAssignment: async () => assignment1,
      updateAssignment: async () => ({ ...assignment1, status: 'started', progressPercent: 10 }),
    },
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LearningPage', () => {
  test('renders tabs: courses, paths, myLearning, assign', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)

    expect(html).toContain('tabs.courses')
    expect(html).toContain('tabs.paths')
    expect(html).toContain('tabs.myLearning')
    expect(html).toContain('tabs.assign')
  })

  test('courses tab renders course list', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)

    expect(html).toContain('Introduction to TypeScript')
    expect(html).toContain('Advanced React')
  })

  test('courses tab shows loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ coursesLoading: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('loading')
  })

  test('courses tab shows empty state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ coursesEmpty: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('courses.empty')
  })

  test('courses tab shows mandatory badge', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('courses.mandatory')
  })

  test('courses tab shows content type badges', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('courses.contentType.video')
    expect(html).toContain('courses.contentType.article')
  })

  test('courses tab shows create button and form', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('courses.create')
    expect(html).toContain('courses.fields.title')
    expect(html).toContain('courses.fields.contentType')
  })

  test('paths tab renders path list', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('Frontend Developer Path')
    expect(html).toContain('Engineering')
  })

  test('paths tab shows loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ pathsLoading: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('loading')
  })

  test('paths tab shows empty state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ pathsEmpty: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('paths.empty')
  })

  test('paths tab shows autoAssign badge', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('paths.autoAssign')
  })

  test('my learning tab renders assignment list', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('myLearning.status.assigned')
    expect(html).toContain('myLearning.status.started')
  })

  test('my learning tab shows loading state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ assignmentsLoading: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('loading')
  })

  test('my learning tab shows empty state', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock({ assignmentsEmpty: true }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('myLearning.empty')
  })

  test('my learning tab shows progress bar', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('myLearning.progress')
  })

  test('assign tab renders form', async () => {
    mock.module('@tanstack/react-query', () => makeQueryMock())
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('assign.title')
    expect(html).toContain('assign.fields.employeeId')
    expect(html).toContain('assign.fields.type')
    expect(html).toContain('actions.assign')
  })

  test('renders unauthenticated state when no user', async () => {
    mock.module('../src/lib/use-auth', () => ({
      useAuth: () => ({ user: null, api: {} }),
    }))
    const { LearningPage } = await import('../src/pages/learning')
    const html = renderToStaticMarkup(<LearningPage />)
    expect(html).toContain('signInPrompt')
  })
})
