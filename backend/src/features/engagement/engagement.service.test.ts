import { describe, expect, test } from 'bun:test'

import { computeEnps } from './engagement.service'
import { AppError } from '../../http/errors'
import {
  createSurvey,
  patchSurvey,
  openSurvey,
  closeSurvey,
  listSurveys,
  submitResponse,
  getSurveyResults,
} from './engagement.service'

// ─── computeEnps unit tests ───────────────────────────────────────────────────

describe('computeEnps', () => {
  test('all promoters (score 10) → eNPS +100', () => {
    const result = computeEnps([10, 10, 10, 10])
    expect(result.promoters).toBe(4)
    expect(result.passives).toBe(0)
    expect(result.detractors).toBe(0)
    expect(result.score).toBe(100)
    expect(result.responded).toBe(4)
  })

  test('all detractors (score 0) → eNPS -100', () => {
    const result = computeEnps([0, 0, 0])
    expect(result.promoters).toBe(0)
    expect(result.passives).toBe(0)
    expect(result.detractors).toBe(3)
    expect(result.score).toBe(-100)
  })

  test('all passives → eNPS 0', () => {
    const result = computeEnps([7, 8, 7, 8])
    expect(result.promoters).toBe(0)
    expect(result.passives).toBe(4)
    expect(result.detractors).toBe(0)
    expect(result.score).toBe(0)
  })

  test('mixed: 10, 8, 3 → promoters=1, passives=1, detractors=1, eNPS=0', () => {
    const result = computeEnps([10, 8, 3])
    expect(result.promoters).toBe(1)
    expect(result.passives).toBe(1)
    expect(result.detractors).toBe(1)
    // %promoters = 33.33, %detractors = 33.33 → round(0) = 0
    expect(result.score).toBe(0)
    expect(result.responded).toBe(3)
  })

  test('no responses → eNPS 0, all zeros', () => {
    const result = computeEnps([])
    expect(result.score).toBe(0)
    expect(result.promoters).toBe(0)
    expect(result.passives).toBe(0)
    expect(result.detractors).toBe(0)
    expect(result.responded).toBe(0)
  })

  test('boundary scores: 9 and 6 are promoter and detractor respectively', () => {
    const result = computeEnps([9, 6])
    expect(result.promoters).toBe(1)
    expect(result.detractors).toBe(1)
    expect(result.passives).toBe(0)
    expect(result.score).toBe(0)
  })

  test('distribution contains counts for all scores 0-10', () => {
    const result = computeEnps([10, 10, 7, 3])
    expect(result.distribution['10']).toBe(2)
    expect(result.distribution['7']).toBe(1)
    expect(result.distribution['3']).toBe(1)
    expect(result.distribution['0']).toBe(0)
    // All 11 keys present
    expect(Object.keys(result.distribution)).toHaveLength(11)
  })

  test('total is honoured when passed explicitly', () => {
    const result = computeEnps([10, 8], 10)
    expect(result.total).toBe(10)
    expect(result.responded).toBe(2)
  })

  test('large promoter majority rounds correctly', () => {
    // 3 promoters, 1 detractor out of 4 → %p=75, %d=25, eNPS=50
    const result = computeEnps([10, 9, 10, 2])
    expect(result.score).toBe(50)
  })
})

// ─── Service function tests (mock prisma) ─────────────────────────────────────

function makeId() {
  return crypto.randomUUID()
}

function makeSurveyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: makeId(),
    tenantId: makeId(),
    title: 'Test Survey',
    kind: 'enps',
    status: 'draft',
    question: 'How likely?',
    openedAt: null,
    closesAt: null,
    closedAt: null,
    createdByUserId: makeId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('createSurvey', () => {
  test('creates a survey and returns dto', async () => {
    const row = makeSurveyRow()
    const prisma = {
      engagementSurvey: {
        create: async () => row,
      },
    } as unknown as Parameters<typeof createSurvey>[0]['prisma']

    const result = await createSurvey({
      prisma,
      tenantId: row.tenantId as string,
      actorUserId: row.createdByUserId as string,
      title: row.title as string,
      kind: 'enps',
      question: row.question as string,
    })

    expect(result.id).toBe(row.id)
    expect(result.status).toBe('draft')
    expect(result.kind).toBe('enps')
  })
})

describe('patchSurvey', () => {
  test('patches a draft survey', async () => {
    const row = makeSurveyRow()
    const updated = { ...row, title: 'Updated Title' }
    const prisma = {
      engagementSurvey: {
        findFirst: async () => row,
        update: async () => updated,
      },
    } as unknown as Parameters<typeof patchSurvey>[0]['prisma']

    const result = await patchSurvey({
      prisma,
      tenantId: row.tenantId as string,
      id: row.id as string,
      title: 'Updated Title',
    })

    expect(result.title).toBe('Updated Title')
  })

  test('throws 409 when survey is not draft', async () => {
    const row = makeSurveyRow({ status: 'open' })
    const prisma = {
      engagementSurvey: {
        findFirst: async () => row,
      },
    } as unknown as Parameters<typeof patchSurvey>[0]['prisma']

    await expect(
      patchSurvey({ prisma, tenantId: row.tenantId as string, id: row.id as string, title: 'x' }),
    ).rejects.toThrow(AppError)
  })
})

describe('openSurvey / closeSurvey FSM', () => {
  test('draft → open succeeds', async () => {
    const row = makeSurveyRow()
    const opened = { ...row, status: 'open', openedAt: new Date() }
    const prisma = {
      engagementSurvey: {
        findFirst: async () => row,
        update: async () => opened,
      },
    } as unknown as Parameters<typeof openSurvey>[0]['prisma']

    const result = await openSurvey({ prisma, tenantId: row.tenantId as string, id: row.id as string })
    expect(result.status).toBe('open')
    expect(result.openedAt).not.toBeNull()
  })

  test('open → closed succeeds', async () => {
    const row = makeSurveyRow({ status: 'open', openedAt: new Date() })
    const closed = { ...row, status: 'closed', closedAt: new Date() }
    const prisma = {
      engagementSurvey: {
        findFirst: async () => row,
        update: async () => closed,
      },
    } as unknown as Parameters<typeof closeSurvey>[0]['prisma']

    const result = await closeSurvey({ prisma, tenantId: row.tenantId as string, id: row.id as string })
    expect(result.status).toBe('closed')
    expect(result.closedAt).not.toBeNull()
  })

  test('draft → closed throws 409', async () => {
    const row = makeSurveyRow({ status: 'draft' })
    const prisma = {
      engagementSurvey: { findFirst: async () => row },
    } as unknown as Parameters<typeof closeSurvey>[0]['prisma']

    await expect(
      closeSurvey({ prisma, tenantId: row.tenantId as string, id: row.id as string }),
    ).rejects.toThrow(AppError)
  })

  test('closed → open throws 409', async () => {
    const row = makeSurveyRow({ status: 'closed' })
    const prisma = {
      engagementSurvey: { findFirst: async () => row },
    } as unknown as Parameters<typeof openSurvey>[0]['prisma']

    await expect(
      openSurvey({ prisma, tenantId: row.tenantId as string, id: row.id as string }),
    ).rejects.toThrow(AppError)
  })
})

describe('submitResponse', () => {
  test('submits a response for an open survey', async () => {
    const survey = makeSurveyRow({ status: 'open' })
    const responseRow = {
      id: makeId(),
      tenantId: survey.tenantId,
      surveyId: survey.id,
      respondentEmployeeId: makeId(),
      score: 9,
      comment: null,
      submittedAt: new Date(),
    }
    const prisma = {
      engagementSurvey: { findFirst: async () => survey },
      surveyResponse: {
        findFirst: async () => null,
        create: async () => responseRow,
      },
    } as unknown as Parameters<typeof submitResponse>[0]['prisma']

    const result = await submitResponse({
      prisma,
      tenantId: survey.tenantId as string,
      surveyId: survey.id as string,
      respondentEmployeeId: responseRow.respondentEmployeeId as string,
      score: 9,
    })

    expect(result.score).toBe(9)
    expect(result.surveyId).toBe(survey.id)
  })

  test('throws 409 for duplicate response', async () => {
    const survey = makeSurveyRow({ status: 'open' })
    const existing = { id: makeId() }
    const prisma = {
      engagementSurvey: { findFirst: async () => survey },
      surveyResponse: { findFirst: async () => existing },
    } as unknown as Parameters<typeof submitResponse>[0]['prisma']

    await expect(
      submitResponse({
        prisma,
        tenantId: survey.tenantId as string,
        surveyId: survey.id as string,
        respondentEmployeeId: makeId(),
        score: 8,
      }),
    ).rejects.toThrow(AppError)
  })

  test('throws 409 when survey is draft', async () => {
    const survey = makeSurveyRow({ status: 'draft' })
    const prisma = {
      engagementSurvey: { findFirst: async () => survey },
      surveyResponse: { findFirst: async () => null },
    } as unknown as Parameters<typeof submitResponse>[0]['prisma']

    await expect(
      submitResponse({
        prisma,
        tenantId: survey.tenantId as string,
        surveyId: survey.id as string,
        respondentEmployeeId: makeId(),
        score: 5,
      }),
    ).rejects.toThrow(AppError)
  })

  test('throws 409 when survey is closed', async () => {
    const survey = makeSurveyRow({ status: 'closed' })
    const prisma = {
      engagementSurvey: { findFirst: async () => survey },
      surveyResponse: { findFirst: async () => null },
    } as unknown as Parameters<typeof submitResponse>[0]['prisma']

    await expect(
      submitResponse({
        prisma,
        tenantId: survey.tenantId as string,
        surveyId: survey.id as string,
        respondentEmployeeId: makeId(),
        score: 5,
      }),
    ).rejects.toThrow(AppError)
  })
})

describe('getSurveyResults', () => {
  test('3 responses: score 10, 8, 3 → promoters=1, passives=1, detractors=1, eNPS=0, responded=3', async () => {
    const survey = makeSurveyRow({ status: 'open' })
    const prisma = {
      engagementSurvey: { findFirst: async () => survey },
      surveyResponse: {
        findMany: async () => [
          { score: 10, comment: null },
          { score: 8, comment: 'good' },
          { score: 3, comment: null },
        ],
      },
      employee: { count: async () => 10 },
    } as unknown as Parameters<typeof getSurveyResults>[0]['prisma']

    const result = await getSurveyResults({
      prisma,
      tenantId: survey.tenantId as string,
      surveyId: survey.id as string,
    })

    expect(result.promoters).toBe(1)
    expect(result.passives).toBe(1)
    expect(result.detractors).toBe(1)
    expect(result.score).toBe(0)
    expect(result.responded).toBe(3)
    expect(result.total).toBe(10)
    // Comments included without employee attribution
    expect(result.comments).toEqual(['good'])
  })
})

describe('listSurveys', () => {
  test('returns surveys filtered by status', async () => {
    const surveys = [makeSurveyRow({ status: 'open' }), makeSurveyRow({ status: 'open' })]
    const prisma = {
      engagementSurvey: { findMany: async () => surveys },
    } as unknown as Parameters<typeof listSurveys>[0]['prisma']

    const result = await listSurveys({
      prisma,
      tenantId: surveys[0]!.tenantId as string,
      status: 'open',
    })

    expect(result).toHaveLength(2)
    expect(result[0]!.status).toBe('open')
  })
})
