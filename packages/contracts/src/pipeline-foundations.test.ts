import { describe, expect, test } from 'bun:test'

import { applicationSchema, vacancySchema } from './index'

describe('phase 18 pipeline foundations contracts', () => {
  test('application schema accepts missing or nullable compositeScore', () => {
    const base = {
      id: 'app_1',
      tenantId: 'tenant_1',
      candidateId: 'candidate_1',
      vacancyId: 'vacancy_1',
      stage: 'new' as const,
      assignedToUserId: null,
      notes: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }

    expect(applicationSchema.parse(base).compositeScore).toBeUndefined()
    expect(applicationSchema.parse({ ...base, compositeScore: null }).compositeScore).toBeNull()
  })

  test('vacancy schema defaults requiredAssessmentTemplateIds to []', () => {
    const vacancy = vacancySchema.parse({
      id: 'vacancy_1',
      title: 'Backend Developer',
      description: 'Build APIs',
      role: null,
      isPublished: false,
      tenantId: 'tenant_1',
      requisitionId: 'req_1',
      orgUnitId: 'org_1',
      slug: null,
      hhVacancyId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    })

    expect(vacancy.requiredAssessmentTemplateIds).toEqual([])
  })
})
