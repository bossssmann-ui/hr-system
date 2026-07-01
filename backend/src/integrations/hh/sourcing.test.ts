import { describe, expect, test } from 'bun:test'

import { encryptHhSecret } from './crypto'
import { mapSourcingCriteriaToSearchParams, sourceHhResumesForTenant } from './sourcing'

describe('hh resume sourcing', () => {
  test('maps flexible criteria json to resume search params', () => {
    expect(
      mapSourcingCriteriaToSearchParams({
        area: 113,
        text: 'logist',
        experience: ['between1And3', 'between3And6'],
        only_with_salary: true,
        empty: '  ',
        nested: { ignored: true },
      }),
    ).toEqual({
      area: '113',
      text: 'logist',
      experience: 'between1And3,between3And6',
      only_with_salary: 'true',
    })
  })

  test('returns disabled no-op when sourcing.hh.enabled flag is false', async () => {
    const state = createState({ featureFlags: {} })

    const result = await sourceHhResumesForTenant(state.prisma as never, state.env as never, 'tenant-1', {
      client: state.client,
    })

    expect(result.status).toBe('disabled')
    expect(result.candidatesImported).toBe(0)
    expect(result.applicationsCreated).toBe(0)
  })

  test('gracefully returns no_paid_access on 403 from resume search', async () => {
    const state = createState({
      featureFlags: { 'sourcing.hh.enabled': true },
      listResumesError: new Error('HH request failed: 403'),
    })

    const result = await sourceHhResumesForTenant(state.prisma as never, state.env as never, 'tenant-1', {
      client: state.client,
    })

    expect(result.status).toBe('no_paid_access')
    expect(result.reason).toContain('платного доступа')
  })

  test('gracefully returns rate_limited on 429', async () => {
    const state = createState({
      featureFlags: { 'sourcing.hh.enabled': true },
      listResumesError: new Error('HH request failed: 429'),
    })

    const result = await sourceHhResumesForTenant(state.prisma as never, state.env as never, 'tenant-1', {
      client: state.client,
    })

    expect(result.status).toBe('rate_limited')
  })

  test('deduplicates existing candidates by hh resume id', async () => {
    const state = createState({
      featureFlags: { 'sourcing.hh.enabled': true },
      candidates: [
        {
          id: 'cand-existing',
          tenantId: 'tenant-1',
          externalIds: { hh_resume_id: 'resume-1' },
        },
      ],
      searchResumeIds: ['resume-1'],
    })

    const result = await sourceHhResumesForTenant(state.prisma as never, state.env as never, 'tenant-1', {
      client: state.client,
    })

    expect(result.dedupedCandidates).toBe(1)
    expect(state.rows.candidates).toHaveLength(1)
    expect(state.rows.applications).toHaveLength(0)
  })

  test('creates candidate/application with hh_sourcing source marker', async () => {
    const state = createState({
      featureFlags: { 'sourcing.hh.enabled': true },
      searchResumeIds: ['resume-1'],
    })

    const result = await sourceHhResumesForTenant(state.prisma as never, state.env as never, 'tenant-1', {
      client: state.client,
    })

    expect(result.status).toBe('ok')
    expect(result.candidatesImported).toBe(1)
    expect(result.applicationsCreated).toBe(1)
    expect(state.rows.applications[0]?.externalIds.source).toBe('hh_sourcing')
  })
})

type CandidateRow = {
  id: string
  tenantId: string
  externalIds: Record<string, unknown>
  email?: string | null
  phone?: string | null
  fullName?: string
  source?: string
}

type ApplicationRow = {
  id: string
  tenantId: string
  candidateId: string
  vacancyId: string
  externalIds: Record<string, unknown>
}

function createState(input: {
  featureFlags: Record<string, unknown>
  listResumesError?: Error
  searchResumeIds?: string[]
  candidates?: CandidateRow[]
}) {
  const encryptionKey = '1234567890123456'
  const nowPlusHour = new Date(Date.now() + 60 * 60 * 1000)
  const rows = {
    candidates: [...(input.candidates ?? [])],
    applications: [] as ApplicationRow[],
  }

  let candidateSeq = 0
  let applicationSeq = 0

  const prisma = {
    tenantSettings: {
      findUnique: async () => ({ featureFlags: input.featureFlags }),
    },
    hhConnection: {
      findUnique: async () => ({
        accessToken: encryptHhSecret('access-1', encryptionKey),
        refreshToken: encryptHhSecret('refresh-1', encryptionKey),
        tokenExpiresAt: nowPlusHour,
      }),
      update: async () => ({}),
    },
    vacancy: {
      findMany: async () => [
        {
          id: 'vacancy-1',
          hhVacancyId: 'hh-vacancy-1',
          hhSourcingCriteria: { area: 113, text: 'logist' },
        },
      ],
    },
    candidate: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const externalId = (((where.externalIds as any)?.equals) as string | undefined) ?? null
        return rows.candidates.find((candidate) => candidate.externalIds.hh_resume_id === externalId) ?? null
      },
      create: async ({ data }: { data: Record<string, any> }) => {
        const row: CandidateRow = {
          id: `cand-${++candidateSeq}`,
          tenantId: data.tenantId,
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          source: data.source,
          externalIds: data.externalIds,
        }
        rows.candidates.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.candidates.find((candidate) => candidate.id === where.id)
        if (!row) throw new Error('candidate not found')
        Object.assign(row, data)
        return row
      },
    },
    application: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          rows.applications.find((application) => {
            if (where.candidateId && application.candidateId !== where.candidateId) return false
            if (where.vacancyId && application.vacancyId !== where.vacancyId) return false
            return true
          }) ?? null
        )
      },
      create: async ({ data }: { data: Record<string, any> }) => {
        const row: ApplicationRow = {
          id: `app-${++applicationSeq}`,
          tenantId: data.tenantId,
          candidateId: data.candidateId,
          vacancyId: data.vacancyId,
          externalIds: data.externalIds,
        }
        rows.applications.push(row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = rows.applications.find((application) => application.id === where.id)
        if (!row) throw new Error('application not found')
        Object.assign(row, data)
        return row
      },
    },
  }

  const searchResumeIds = input.searchResumeIds ?? ['resume-1']
  const client = {
    listResumes: async () => {
      if (input.listResumesError) throw input.listResumesError
      return {
        found: searchResumeIds.length,
        pages: 1,
        page: 0,
        per_page: 20,
        items: searchResumeIds.map((id) => ({ id })),
      }
    },
    getResume: async (_accessToken: string, resumeId: string) => ({
      id: resumeId,
      first_name: 'Ivan',
      last_name: 'Petrov',
      area: { name: 'Moscow' },
      contact: [{ type: { id: 'email' }, value: 'ivan@example.com' }],
    }),
    createNegotiationInvite: async () => ({ id: 'neg-1', messagesUrl: 'https://api.hh.ru/negotiations/1/messages' }),
    getMe: async () => ({}),
    exchangeAuthorizationCode: async () => ({ accessToken: '', refreshToken: '', expiresInSeconds: 3600 }),
    refreshAccessToken: async () => ({ accessToken: '', refreshToken: '', expiresInSeconds: 3600 }),
    listEmployerVacancies: async () => [],
    getNegotiationCollections: async () => [],
    listNegotiations: async () => ({ found: 0, pages: 0, page: 0, per_page: 20, items: [] }),
  }

  const env = {
    HH_INTEGRATION_ENABLED: true,
    HH_CLIENT_ID: 'cid',
    HH_CLIENT_SECRET: 'secret',
    HH_TOKEN_ENCRYPTION_KEY: encryptionKey,
    AI_SCORING_ENABLED: false,
    ASSESSMENT_SYSTEM_ENABLED: false,
  AUTO_SELECTION_ENABLED: false,
  AUTO_ASSESSMENT_ENABLED: false,
  COMPOSITE_SCORE_ENABLED: false,
  RECRUITER_NOTIFICATIONS_ENABLED: false,
  AUTO_SELECTION_THRESHOLD: 70,
  AUTO_REJECT_THRESHOLD: 30,
    CORS_ORIGINS: ['https://example.com'],
  }

  return { prisma, env, client, rows }
}
