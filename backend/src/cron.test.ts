import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runCronTask } from './cron'

describe('runCronTask', () => {
  test('runs the noop task', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()
  })

  test('runs the probation.reminder task', async () => {
    const notifications: unknown[] = []
    const runtime = {
      prisma: {
        employee: {
          findMany: async () => [
            {
              id: 'emp-1',
              tenantId: 'tenant-1',
              fullName: 'Иван Иванов',
              probationEndsAt: new Date('2026-06-08T00:00:00.000Z'),
            },
          ],
        },
        userRole: {
          findMany: async () => [{ tenantId: 'tenant-1', userId: 'manager-user' }],
        },
        notification: {
          create: async ({ data }: { data: unknown }) => {
            notifications.push(data)
            return data
          },
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('probation.reminder', runtime)).resolves.toBeUndefined()
    expect(notifications).toHaveLength(1)
  })

  test('runs the selection.retention_outcomes task', async () => {
    const upserts: unknown[] = []
    const runtime = {
      prisma: {
        employee: {
          findMany: async () => [
            {
              tenantId: 'tenant-1',
              applicationId: 'app-1',
              hireDate: new Date('2026-01-01T00:00:00.000Z'),
              terminatedAt: null,
              terminationGround: null,
            },
          ],
        },
        selectionSession: {
          findMany: async () => [
            {
              id: 'sess-1',
              tenantId: 'tenant-1',
              applicationId: 'app-1',
              createdAt: new Date('2026-01-02T00:00:00.000Z'),
            },
          ],
        },
        selectionRetentionOutcome: {
          upsert: async (args: unknown) => {
            upserts.push(args)
            return { id: 'out-1' }
          },
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('selection.retention_outcomes', runtime)).resolves.toBeUndefined()
    expect(upserts).toHaveLength(1)
  })

  test('runs the selection.retention_calibration task', async () => {
    const runtime = {
      prisma: {
        tenant: {
          findMany: async () => [],
        },
      },
    } as unknown as BackendRuntime
    await expect(runCronTask('selection.retention_calibration', runtime)).resolves.toBeUndefined()
  })

  test('rejects unknown tasks', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('missing', runtime)).rejects.toThrow('Unknown cron task')
  })
})
