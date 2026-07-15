/**
 * Tests for multi-candidate selection in the "New application" form.
 */
import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ApiRequestError } from '../src/lib/api'

// ─── i18n mock ────────────────────────────────────────────────────────────────

mock.module('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return Object.entries(opts).reduce(
          (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
          key,
        )
      }
      return key
    },
  }),
}))

// ─── router / react-query / auth mocks (minimal) ─────────────────────────────

mock.module('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => React.createElement('a', {}, children),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
  useMutation: ({ mutationFn }: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutate: mutationFn,
    isPending: false,
  }),
  useQuery: () => ({ isPending: false, isError: false, data: { items: [] } }),
}))

mock.module('../src/lib/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'owner' },
    api: {},
  }),
}))

mock.module('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))

// ─── Stable test data ─────────────────────────────────────────────────────────

const vacancies = [
  { id: 'v1', title: 'Frontend Developer' },
  { id: 'v2', title: 'Backend Developer' },
]

const candidates = [
  { id: 'c1', fullName: 'Alice Smith' },
  { id: 'c2', fullName: 'Bob Jones' },
  { id: 'c3', fullName: 'Charlie Brown' },
]

// ─── NewApplicationForm rendering tests ───────────────────────────────────────

describe('NewApplicationForm multi-select rendering', () => {
  test('renders select-all checkbox with correct data-testid', async () => {
    const { NewApplicationForm } = await import('../src/pages/recruiting')
    const html = renderToStaticMarkup(
      React.createElement(NewApplicationForm, {
        vacancies,
        candidates,
        onSubmit: () => {},
        isLoading: false,
        error: null,
      }),
    )
    expect(html).toContain('data-testid="applications.create.select-all"')
  })

  test('renders a candidate-checkbox for each candidate', async () => {
    const { NewApplicationForm } = await import('../src/pages/recruiting')
    const html = renderToStaticMarkup(
      React.createElement(NewApplicationForm, {
        vacancies,
        candidates,
        onSubmit: () => {},
        isLoading: false,
        error: null,
      }),
    )
    const matches = html.match(/data-testid="applications\.create\.candidate-checkbox"/g) ?? []
    expect(matches).toHaveLength(candidates.length)
  })

  test('renders submit button with correct data-testid', async () => {
    const { NewApplicationForm } = await import('../src/pages/recruiting')
    const html = renderToStaticMarkup(
      React.createElement(NewApplicationForm, {
        vacancies,
        candidates,
        onSubmit: () => {},
        isLoading: false,
        error: null,
      }),
    )
    expect(html).toContain('data-testid="applications.create.submit"')
  })

  test('renders candidate names in the list', async () => {
    const { NewApplicationForm } = await import('../src/pages/recruiting')
    const html = renderToStaticMarkup(
      React.createElement(NewApplicationForm, {
        vacancies,
        candidates,
        onSubmit: () => {},
        isLoading: false,
        error: null,
      }),
    )
    expect(html).toContain('Alice Smith')
    expect(html).toContain('Bob Jones')
    expect(html).toContain('Charlie Brown')
  })

  test('renders error alert when error prop is set', async () => {
    const { NewApplicationForm } = await import('../src/pages/recruiting')
    const html = renderToStaticMarkup(
      React.createElement(NewApplicationForm, {
        vacancies,
        candidates,
        onSubmit: () => {},
        isLoading: false,
        error: 'Something went wrong',
      }),
    )
    expect(html).toContain('Something went wrong')
  })
})

// ─── Batch create logic tests ─────────────────────────────────────────────────

/**
 * Mirrors the sequential creation logic used in KanbanBoard.handleCreateApplications.
 * The spec explicitly requires sequential execution (not parallel), so this helper
 * intentionally duplicates that pattern to test it in isolation without React.
 */
async function runBatch(
  candidateIds: string[],
  vacancyId: string,
  createApplication: (data: { candidateId: string; vacancyId: string }) => Promise<unknown>,
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0
  for (const candidateId of candidateIds) {
    try {
      await createApplication({ candidateId, vacancyId })
      created++
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        skipped++
      } else {
        throw err
      }
    }
  }
  return { created, skipped }
}

describe('application batch creation logic', () => {
  test('makes one POST per selected candidate', async () => {
    const calls: Array<{ candidateId: string; vacancyId: string }> = []
    const createApplication = async (data: { candidateId: string; vacancyId: string }) => {
      calls.push(data)
    }

    const result = await runBatch(['c1', 'c2', 'c3'], 'v1', createApplication)

    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.candidateId)).toEqual(['c1', 'c2', 'c3'])
    expect(calls.every((c) => c.vacancyId === 'v1')).toBe(true)
    expect(result).toEqual({ created: 3, skipped: 0 })
  })

  test('counts 409 responses as skipped, not as errors', async () => {
    const createApplication = async ({ candidateId }: { candidateId: string; vacancyId: string }) => {
      if (candidateId === 'c2') {
        throw new ApiRequestError(409, 'CONFLICT', 'Application already exists')
      }
    }

    const result = await runBatch(['c1', 'c2', 'c3'], 'v1', createApplication)

    expect(result).toEqual({ created: 2, skipped: 1 })
  })

  test('all 409 responses → created=0, skipped=N', async () => {
    const createApplication = async () => {
      throw new ApiRequestError(409, 'CONFLICT', 'Application already exists')
    }

    const result = await runBatch(['c1', 'c2'], 'v1', createApplication)

    expect(result).toEqual({ created: 0, skipped: 2 })
  })

  test('non-409 error is rethrown', async () => {
    const createApplication = async ({ candidateId }: { candidateId: string; vacancyId: string }) => {
      if (candidateId === 'c2') {
        throw new ApiRequestError(500, 'INTERNAL_ERROR', 'Server error')
      }
    }

    await expect(runBatch(['c1', 'c2', 'c3'], 'v1', createApplication)).rejects.toThrow('Server error')
  })
})
