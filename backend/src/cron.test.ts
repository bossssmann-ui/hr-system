import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runCronTask } from './cron'

describe('runCronTask', () => {
  test('runs the noop task', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()
  })

  test('writes tenant-scoped audit events for successful cron runs', async () => {
    const auditEvents: Array<Record<string, unknown>> = []
    const runtime = {
      prisma: {
        tenant: {
          findMany: async () => [{ id: 'tenant-1' }],
        },
        auditEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            auditEvents.push(data)
            return data
          },
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()

    expect(auditEvents.map((event) => event.action)).toEqual(['cron.job_started', 'cron.job_succeeded'])
    expect(auditEvents.every((event) => event.tenantId === 'tenant-1')).toBe(true)
    expect(auditEvents.every((event) => event.entityType === 'CronJob')).toBe(true)
  })

  test('writes failed audit events and rethrows cron errors', async () => {
    const auditEvents: Array<Record<string, unknown>> = []
    const runtime = {
      prisma: {
        tenant: {
          findMany: async () => [{ id: 'tenant-1' }],
        },
        auditEvent: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            auditEvents.push(data)
            return data
          },
        },
        $queryRaw: async () => {
          throw new Error('database timeout password=supersecret')
        },
      },
    } as unknown as BackendRuntime

    await expect(runCronTask('db:ping', runtime)).rejects.toThrow('database timeout')

    expect(auditEvents.map((event) => event.action)).toEqual(['cron.job_started', 'cron.job_failed'])
    const failedDiff = auditEvents[1]?.diff as Record<string, unknown>
    expect(failedDiff.status).toBe('failed')
    expect(failedDiff.error).toBe('database timeout password=<redacted>')
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

  test('rejects unknown tasks', async () => {
    const runtime = {} as BackendRuntime
    await expect(runCronTask('missing', runtime)).rejects.toThrow('Unknown cron task')
  })
})
