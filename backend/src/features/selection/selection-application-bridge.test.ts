import { describe, expect, test } from 'bun:test'

import { handleApplicationCreatedForSelection } from './selection-application-bridge'

const baseEnv = {
  ASSESSMENT_SYSTEM_ENABLED: true,
  HH_INTEGRATION_ENABLED: false,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
} as const

describe('selection application bridge', () => {
  test('creates a session for supported role and is idempotent', async () => {
    const state = makeState({
      application: {
        id: 'app-1',
        tenantId: 'tenant-1',
        vacancyId: 'vac-1',
        candidate: { source: 'manual', email: 'candidate@example.com', externalIds: {} },
        vacancy: {
          title: 'Logist Specialist',
          description: 'Operations role',
          requisition: { title: 'Logist' },
        },
      },
      featureFlags: {},
    })

    const first = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      source: 'manual',
    })
    const second = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-1',
      source: 'manual',
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(state.sessions).toHaveLength(1)
  })

  test('skips creation when role is not supported', async () => {
    const state = makeState({
      application: {
        id: 'app-2',
        tenantId: 'tenant-1',
        vacancyId: 'vac-2',
        candidate: { source: 'manual', email: null, externalIds: {} },
        vacancy: {
          title: 'Frontend Engineer',
          description: 'UI role',
          requisition: { title: 'Frontend' },
        },
      },
      featureFlags: {},
    })

    const result = await handleApplicationCreatedForSelection({
      prisma: state.prisma as never,
      env: baseEnv as never,
      tenantId: 'tenant-1',
      applicationId: 'app-2',
      source: 'manual',
    })

    expect(result).toEqual({ created: false, reason: 'role_not_supported' })
    expect(state.sessions).toHaveLength(0)
  })
})

function makeState(input: {
  application: {
    id: string
    tenantId: string
    vacancyId: string
    candidate: { source: string; email: string | null; externalIds: Record<string, unknown> }
    vacancy: { title: string; description: string; requisition: { title: string } | null }
  }
  featureFlags: Record<string, boolean>
}) {
  const sessions: Array<Record<string, unknown>> = []
  const templates: Array<Record<string, unknown>> = []
  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        if (where.id !== input.application.id || where.tenantId !== input.application.tenantId) return null
        return input.application
      },
    },
    selectionSession: {
      findFirst: async ({ where }: { where: { applicationId?: string } }) => {
        if (!where.applicationId) return null
        return sessions.find((s) => s.applicationId === where.applicationId) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sess-${sessions.length + 1}`, token: `token-${sessions.length + 1}`, ...data }
        sessions.push(row)
        return row
      },
    },
    selectionTemplate: {
      findFirst: async ({ where }: { where: { vacancyId: string; role: string } }) => {
        return templates.find((t) => t.vacancyId === where.vacancyId && t.role === where.role) ?? null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `tpl-${templates.length + 1}`, ...data }
        templates.push(row)
        return row
      },
    },
    tenantSettings: {
      findUnique: async () => ({ featureFlags: input.featureFlags }),
    },
    hhConnection: {
      findUnique: async () => null,
    },
  }
  return { prisma, sessions }
}
