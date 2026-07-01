import { describe, expect, test } from 'bun:test'

import { enqueueHhNegotiationsSyncJob, shouldSyncNegotiation, upsertNegotiationFromHh } from './sync'

type CandidateRow = {
  id: string
  tenantId: string
  fullName: string
  source: 'manual' | 'hh_ru'
  email: string | null
  phone: string | null
  location: string | null
  externalIds: Record<string, unknown>
  consentContext: Record<string, unknown> | null
}

type ApplicationRow = {
  id: string
  tenantId: string
  candidateId: string
  vacancyId: string
  externalIds: Record<string, unknown>
  assignedToUserId?: string | null
}

describe('hh sync mapper', () => {
  test('imports negotiation idempotently and reuses candidate/application', async () => {
    const resumeFixture = await readFixture<any>('resume-501.json')
    const negotiationsFixture = await readFixture<any>('negotiations-response-page-0.json')

    const state = {
      candidateSeq: 0,
      applicationSeq: 0,
      candidates: [] as CandidateRow[],
      applications: [] as ApplicationRow[],
      auditEvents: [] as Array<Record<string, unknown>>,
      notifications: [] as Array<Record<string, unknown>>,
      userRoles: [{ tenantId: 'tenant-1', userId: 'admin-1', role: 'hr_admin' }] as Array<{
        tenantId: string
        userId: string
        role: string
      }>,
    }

    const prisma = createFakePrisma(state)
    const negotiation = negotiationsFixture.items[0]!

    await upsertNegotiationFromHh(prisma as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-1',
      negotiation,
      resume: resumeFixture,
      actorUserId: 'user-1',
      env: {
        RECRUITER_NOTIFICATIONS_ENABLED: true,
        MOBILE_PUSH_ENABLED: false,
      } as never,
    })

    expect(state.candidates).toHaveLength(1)
    expect(state.applications).toHaveLength(1)
    expect(state.candidates[0]?.source).toBe('hh_ru')
    expect(state.candidates[0]?.externalIds.hh_resume_id).toBe('resume-501')
    expect(state.applications[0]?.externalIds.hh_negotiation_id).toBe('neg-1001')

    await upsertNegotiationFromHh(prisma as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-1',
      negotiation,
      resume: resumeFixture,
      actorUserId: 'user-1',
      env: {
        RECRUITER_NOTIFICATIONS_ENABLED: true,
        MOBILE_PUSH_ENABLED: false,
      } as never,
    })

    expect(state.candidates).toHaveLength(1)
    expect(state.applications).toHaveLength(1)
    expect(state.auditEvents).toHaveLength(2)
    expect(state.notifications).toHaveLength(1)
  })

  test('dedups candidates by email/phone when hh id is absent', async () => {
    const resumeFixture = await readFixture<any>('resume-501.json')
    const negotiationsFixture = await readFixture<any>('negotiations-response-page-0.json')

    const state = {
      candidateSeq: 0,
      applicationSeq: 0,
      candidates: [
        {
          id: 'cand-existing',
          tenantId: 'tenant-1',
          fullName: 'Existing Candidate',
          source: 'manual' as const,
          email: 'alice@example.com',
          phone: '+79990001122',
          location: 'Moscow',
          externalIds: {},
          consentContext: null,
        },
      ],
      applications: [] as ApplicationRow[],
      auditEvents: [] as Array<Record<string, unknown>>,
      notifications: [] as Array<Record<string, unknown>>,
      userRoles: [] as Array<{ tenantId: string; userId: string; role: string }>,
    }

    const prisma = createFakePrisma(state)
    const negotiation = { ...negotiationsFixture.items[0]!, id: 'neg-2002' }
    const resume = { ...resumeFixture, id: 'resume-502' }

    await upsertNegotiationFromHh(prisma as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-2',
      negotiation,
      resume,
      actorUserId: 'user-1',
    })

    expect(state.candidates).toHaveLength(1)
    expect(state.candidates[0]?.id).toBe('cand-existing')
    expect((state.candidates[0]?.externalIds as any).hh_resume_id).toBe('resume-502')
    expect(state.applications).toHaveLength(1)
  })

  test('sends application.new to assigned recruiter when feature flag enabled', async () => {
    const resumeFixture = await readFixture<any>('resume-501.json')
    const negotiationsFixture = await readFixture<any>('negotiations-response-page-0.json')

    const state = {
      candidateSeq: 0,
      applicationSeq: 0,
      candidates: [
        {
          id: 'cand-1',
          tenantId: 'tenant-1',
          fullName: 'Existing Candidate',
          source: 'hh_ru' as const,
          email: 'alice@example.com',
          phone: '+79990001122',
          location: 'Moscow',
          externalIds: { hh_resume_id: 'resume-501' },
          consentContext: null,
        },
      ] as CandidateRow[],
      applications: [
        {
          id: 'app-1',
          tenantId: 'tenant-1',
          candidateId: 'cand-1',
          vacancyId: 'vacancy-1',
          assignedToUserId: 'user-assigned',
          externalIds: { hh_negotiation_id: 'neg-legacy' },
        },
      ] as ApplicationRow[],
      auditEvents: [] as Array<Record<string, unknown>>,
      notifications: [] as Array<Record<string, unknown>>,
      userRoles: [] as Array<{ tenantId: string; userId: string; role: string }>,
    }

    await upsertNegotiationFromHh(createFakePrisma(state) as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-1',
      negotiation: negotiationsFixture.items[0]!,
      resume: resumeFixture,
      actorUserId: 'user-1',
      env: {
        RECRUITER_NOTIFICATIONS_ENABLED: true,
        MOBILE_PUSH_ENABLED: false,
      } as never,
    })

    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      template: 'application.new',
      recipientUserId: 'user-assigned',
      payload: expect.objectContaining({
        applicationId: 'app-1',
      }),
    })
  })

  test('falls back to hr_admin recipients when assignee is empty', async () => {
    const resumeFixture = await readFixture<any>('resume-501.json')
    const negotiationsFixture = await readFixture<any>('negotiations-response-page-0.json')

    const state = {
      candidateSeq: 0,
      applicationSeq: 0,
      candidates: [
        {
          id: 'cand-1',
          tenantId: 'tenant-1',
          fullName: 'Existing Candidate',
          source: 'hh_ru' as const,
          email: 'alice@example.com',
          phone: '+79990001122',
          location: 'Moscow',
          externalIds: { hh_resume_id: 'resume-501' },
          consentContext: null,
        },
      ] as CandidateRow[],
      applications: [
        {
          id: 'app-1',
          tenantId: 'tenant-1',
          candidateId: 'cand-1',
          vacancyId: 'vacancy-1',
          assignedToUserId: null,
          externalIds: { hh_negotiation_id: 'neg-legacy' },
        },
      ] as ApplicationRow[],
      auditEvents: [] as Array<Record<string, unknown>>,
      notifications: [] as Array<Record<string, unknown>>,
      userRoles: [
        { tenantId: 'tenant-1', userId: 'admin-1', role: 'hr_admin' },
        { tenantId: 'tenant-1', userId: 'admin-2', role: 'hr_admin' },
        { tenantId: 'tenant-1', userId: 'recruiter-1', role: 'recruiter' },
      ] as Array<{ tenantId: string; userId: string; role: string }>,
    }

    await upsertNegotiationFromHh(createFakePrisma(state) as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-1',
      negotiation: negotiationsFixture.items[0]!,
      resume: resumeFixture,
      actorUserId: 'user-1',
      env: {
        RECRUITER_NOTIFICATIONS_ENABLED: true,
        MOBILE_PUSH_ENABLED: false,
      } as never,
    })

    expect(state.notifications.map((item) => item.recipientUserId).sort()).toEqual(['admin-1', 'admin-2'])
  })

  test('incremental filter accepts only newer negotiations', () => {
    expect(
      shouldSyncNegotiation(
        {
          id: 'neg-2',
          created_at: '2026-05-20T10:00:00+0300',
          updated_at: '2026-05-20T10:10:00+0300',
          has_updates: false,
        },
        new Date('2026-05-20T07:00:00.000Z'),
        'neg-1',
      ),
    ).toBe(true)

    expect(
      shouldSyncNegotiation(
        {
          id: 'neg-1',
          created_at: '2026-05-20T10:00:00+0300',
          updated_at: '2026-05-20T10:00:00+0300',
          has_updates: false,
        },
        new Date('2026-05-20T07:00:00.000Z'),
        'neg-1',
      ),
    ).toBe(false)
  })

  test('rejects and logs when enqueue fails', async () => {
    const queueInsertError = new Error('queue insert failed')
    const logged: string[] = []
    const originalConsoleError = console.error

    try {
      console.error = (message?: unknown) => {
        logged.push(String(message))
      }

      type EnqueueInput = Parameters<typeof enqueueHhNegotiationsSyncJob>[0]
      await expect(
        enqueueHhNegotiationsSyncJob({
          prisma: {
            $executeRaw: async () => {
              throw queueInsertError
            },
            $queryRaw: async () => [],
          } as unknown as EnqueueInput['prisma'],
          env: {} as EnqueueInput['env'],
          tenantId: 'tenant-1',
        }),
      ).rejects.toBe(queueInsertError)
    } finally {
      console.error = originalConsoleError
    }

    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('"level":"error"')
    expect(logged[0]).toContain('"msg":"hh.sync.enqueue_failed"')
    expect(logged[0]).toContain('"tenantId":"tenant-1"')
  })
})

async function readFixture<T>(name: string): Promise<T> {
  const path = new URL(`./__fixtures__/${name}`, import.meta.url)
  return Bun.file(path).json() as Promise<T>
}

function createFakePrisma(state: {
  candidateSeq: number
  applicationSeq: number
  candidates: CandidateRow[]
  applications: ApplicationRow[]
  auditEvents: Array<Record<string, unknown>>
  notifications: Array<Record<string, unknown>>
  userRoles: Array<{ tenantId: string; userId: string; role: string }>
}) {
  return {
    candidate: {
      findFirst: async ({ where }: { where: { tenantId: string; OR: Array<Record<string, unknown>> } }) => {
        return (
          state.candidates.find((candidate) => {
            if (candidate.tenantId !== where.tenantId) return false
            return where.OR.some((condition) => {
              if ('email' in condition) return candidate.email === condition.email
              if ('phone' in condition) return candidate.phone === condition.phone
              if ('externalIds' in condition) {
                const expected = (condition.externalIds as { equals: string }).equals
                return candidate.externalIds.hh_resume_id === expected
              }
              return false
            })
          }) ?? null
        )
      },
      create: async ({ data }: { data: Omit<CandidateRow, 'id'> }) => {
        const row: CandidateRow = {
          ...data,
          id: `cand-${++state.candidateSeq}`,
        }
        state.candidates.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CandidateRow> }) => {
        const row = state.candidates.find((candidate) => candidate.id === where.id)
        if (!row) throw new Error('candidate not found')
        Object.assign(row, data)
        return row
      },
    },
    application: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.applications.find((application) => {
            if (application.tenantId !== where.tenantId) return false
            if (where.candidateId && application.candidateId !== where.candidateId) return false
            if (where.vacancyId && application.vacancyId !== where.vacancyId) return false
            if (where.externalIds) {
              const expected = ((where.externalIds as { equals: string }).equals)
              return application.externalIds.hh_negotiation_id === expected
            }
            return true
          }) ?? null
        )
      },
      create: async ({ data }: { data: Omit<ApplicationRow, 'id'> }) => {
        const row: ApplicationRow = {
          assignedToUserId: null,
          ...data,
          id: `app-${++state.applicationSeq}`,
        }
        state.applications.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ApplicationRow> }) => {
        const row = state.applications.find((application) => application.id === where.id)
        if (!row) throw new Error('application not found')
        Object.assign(row, data)
        return row
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
        return data
      },
    },
    userRole: {
      findMany: async ({ where }: { where: { tenantId: string; role: { in: string[] } } }) =>
        state.userRoles
          .filter((row) => row.tenantId === where.tenantId && where.role.in.includes(row.role))
          .map((row) => ({ userId: row.userId })),
    },
    notification: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.notifications.filter((row) => {
          if (row.tenantId !== where.tenantId) return false
          if (row.recipientUserId !== where.recipientUserId) return false
          if (row.channel !== where.channel) return false
          if (row.template !== where.template) return false
          if (where.readAt === null && row.readAt !== null) return false
          const createdAtGte = (where.createdAt as { gte?: Date } | undefined)?.gte
          if (createdAtGte && row.createdAt instanceof Date && row.createdAt < createdAtGte) return false
          return true
        }).map((row) => ({ payload: row.payload })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `notification-${state.notifications.length + 1}`,
          ...data,
          readAt: null,
          createdAt: new Date(),
        }
        state.notifications.push(row)
        return row
      },
    },
    deviceToken: {
      findMany: async () => [],
    },
  }
}
