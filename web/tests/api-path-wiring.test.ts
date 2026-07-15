import { afterEach, expect, test } from 'bun:test'

import { ApiClient } from '../src/lib/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const assignment = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  employeeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  courseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  pathId: null,
  status: 'assigned',
  progressPercent: 0,
  score: null,
  dueDate: null,
  startedAt: null,
  completedAt: null,
  assignedByUserId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const keyResult = {
  id: '11111111-1111-4111-8111-111111111111',
  okrId: '22222222-2222-4222-8222-222222222222',
  title: 'Ship it',
  unit: '%',
  startValue: 0,
  targetValue: 100,
  currentValue: 40,
  status: 'on_track',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const idpItem = {
  id: '33333333-3333-4333-8333-333333333333',
  idpId: '44444444-4444-4444-8444-444444444444',
  title: 'Grow',
  description: null,
  status: 'in_progress',
  dueDate: null,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

test('ApiClient uses real backend paths for learning/OKR/IDP mutations', async () => {
  const calls: Array<{ method: string; path: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname + url.search })

    if (url.pathname === `/api/employees/${assignment.employeeId}/learning`) {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') return json(assignment, 201)
      return json({ items: [assignment] }, 200)
    }
    if (url.pathname === `/api/employees/${assignment.employeeId}/learning/${assignment.id}`) {
      return json({ ...assignment, status: 'started', progressPercent: 10 }, 200)
    }
    if (url.pathname === '/api/learning/my-assignments') {
      return json({ items: [assignment] }, 200)
    }
    if (url.pathname === `/api/okrs/key-results/${keyResult.id}`) {
      return json({ ...keyResult, currentValue: 55 }, 200)
    }
    if (url.pathname === `/api/idps/items/${idpItem.id}`) {
      return json({ ...idpItem, status: 'completed' }, 200)
    }

    return json({ error: { code: 'NOT_FOUND', message: url.pathname } }, 404)
  }

  const client = new ApiClient({
    getAccessToken: () => 'token',
    setAccessToken: () => undefined,
  })

  await client.listAssignments({ employeeId: assignment.employeeId })
  await client.listMyAssignments()
  await client.createAssignment(assignment.employeeId, { courseId: assignment.courseId! })
  await client.updateAssignment(assignment.employeeId, assignment.id, {
    status: 'started',
    progressPercent: 10,
  })
  await client.patchOkrKeyResult(keyResult.okrId, keyResult.id, { currentValue: 55 })
  await client.patchIdpItem(idpItem.idpId, idpItem.id, { status: 'completed' })

  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
    `GET /api/employees/${assignment.employeeId}/learning`,
    'GET /api/learning/my-assignments',
    `POST /api/employees/${assignment.employeeId}/learning`,
    `PATCH /api/employees/${assignment.employeeId}/learning/${assignment.id}`,
    `PATCH /api/okrs/key-results/${keyResult.id}`,
    `PATCH /api/idps/items/${idpItem.id}`,
  ])
})

test('ApiClient downloads payroll CSV with Authorization header', async () => {
  const calls: Array<{ authorization: string | null; accept: string | null; path: string }> = []

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    calls.push({
      authorization: headers.get('Authorization'),
      accept: headers.get('Accept'),
      path: url.pathname + url.search,
    })
    return new Response('month,name\n2026-01,Ada', {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    })
  }

  const client = new ApiClient({
    getAccessToken: () => 'secret-token',
    setAccessToken: () => undefined,
  })

  const csv = await client.downloadPayrollCsv({ month: '2026-01' })
  expect(csv).toBe('month,name\n2026-01,Ada')
  expect(calls).toHaveLength(1)
  expect(calls[0]?.authorization).toBe('Bearer secret-token')
  expect(calls[0]?.path).toBe('/api/payroll/export?month=2026-01&format=csv')
})
