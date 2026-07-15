import { describe, expect, test } from 'bun:test'

import { ApiRequestError } from '../src/lib/api'
import { createApplicationsBatch } from '../src/lib/create-applications-batch'

describe('createApplicationsBatch', () => {
  test('posts once per selected candidate and counts created', async () => {
    const calls: Array<{ candidateId: string; vacancyId: string }> = []
    const result = await createApplicationsBatch(
      async (input) => {
        calls.push(input)
        return { id: input.candidateId }
      },
      'vac-1',
      ['c1', 'c2', 'c3'],
    )

    expect(calls).toEqual([
      { candidateId: 'c1', vacancyId: 'vac-1' },
      { candidateId: 'c2', vacancyId: 'vac-1' },
      { candidateId: 'c3', vacancyId: 'vac-1' },
    ])
    expect(result).toEqual({ created: 3, skipped: 0 })
  })

  test('treats 409 as skipped and continues', async () => {
    const calls: string[] = []
    const result = await createApplicationsBatch(
      async ({ candidateId }) => {
        calls.push(candidateId)
        if (candidateId === 'c2') {
          throw new ApiRequestError(409, 'CONFLICT', 'Application already exists')
        }
        return { id: candidateId }
      },
      'vac-1',
      ['c1', 'c2', 'c3'],
    )

    expect(calls).toEqual(['c1', 'c2', 'c3'])
    expect(result).toEqual({ created: 2, skipped: 1 })
  })

  test('rethrows non-409 errors and stops', async () => {
    const calls: string[] = []
    await expect(
      createApplicationsBatch(
        async ({ candidateId }) => {
          calls.push(candidateId)
          if (candidateId === 'c2') {
            throw new ApiRequestError(500, 'INTERNAL', 'boom')
          }
          return { id: candidateId }
        },
        'vac-1',
        ['c1', 'c2', 'c3'],
      ),
    ).rejects.toMatchObject({ status: 500 })

    expect(calls).toEqual(['c1', 'c2'])
  })
})
