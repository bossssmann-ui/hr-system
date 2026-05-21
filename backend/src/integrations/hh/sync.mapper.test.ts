import { describe, expect, test } from 'bun:test'

import { shouldSyncNegotiation, upsertNegotiationFromHh } from './sync'

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
    }

    const prisma = createFakePrisma(state)
    const negotiation = negotiationsFixture.items[0]!

    await upsertNegotiationFromHh(prisma as never, {
      tenantId: 'tenant-1',
      vacancyId: 'vacancy-1',
      negotiation,
      resume: resumeFixture,
      actorUserId: 'user-1',
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
    })

    expect(state.candidates).toHaveLength(1)
    expect(state.applications).toHaveLength(1)
    expect(state.auditEvents).toHaveLength(2)
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
  }
}
