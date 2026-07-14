import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import type { AppEnv } from '../../env'
import { ScoringProviderMalformedResponseError, type ScoringProvider } from '../../integrations/llm'
import { buildScoringInput, hashScoringInput, scoreApplication } from './scoring.service'

const baseEnv: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
  CORS_ORIGINS: ['http://localhost:5173'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  COOKIE_SECURE: false,
  HH_INTEGRATION_ENABLED: false,
  HH_CLIENT_ID: undefined,
  HH_CLIENT_SECRET: undefined,
  HH_TOKEN_ENCRYPTION_KEY: undefined,
  AI_SCORING_ENABLED: true,
  LLM_SCORING_PROVIDER: 'anthropic',
  LLM_SCORING_API_KEY: 'test-api-key',
  LLM_SCORING_MODEL: 'claude-haiku-4-5-20251001',
  TRANSCRIPTION_ENABLED: true,
  ASR_PROVIDER: 'yandex_speechkit',
  ASR_API_KEY: 'test-api-key',
  ASR_FOLDER_ID: undefined,
  ASR_LANGUAGE: 'ru-RU',
  INTERVIEW_RECORDING_MAX_BYTES: 500 * 1024 * 1024,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  TELEGRAM_ENABLED: false,
  EMAIL_ENABLED: false,
  DOCUSEAL_ENABLED: false,
  SBER_PODBOR_ENABLED: false,
  AVITO_JOBS_ENABLED: false,
  RABOTA_RU_ENABLED: false,
  DOCUSEAL_API_URL: 'https://api.docuseal.com',
  CAREERS_PAGE_ENABLED: false,
  CAREERS_RATE_LIMIT_PER_HOUR: 20,
ASSESSMENTS_ENABLED: false,
  ASSESSMENT_SYSTEM_ENABLED: false,
  GEMINI_API_KEY: undefined,
  GEMINI_MODEL: 'gemini-2.0-flash',
PROCTORING_WEBCAM_ENABLED: false,
TRUST_WEIGHT_PASTE: 0.35,
TRUST_WEIGHT_FOCUS: 0.4,
TRUST_WEIGHT_KEYSTROKE: 0.25,
TRUST_LOW_THRESHOLD: 50,
QUIET_HOURS_QUIET_START_UTC: 15,
QUIET_HOURS_QUIET_END_UTC: 23,
  KNOWLEDGE_HUB_PGVECTOR_ENABLED: false,
  SIGNALS_OPEN_THRESHOLD: 60,
  REALTIME_ENABLED: false,
  MOBILE_PUSH_ENABLED: false,
  EXPO_PUSH_API_URL: 'https://exp.host/--/api/v2/push/send',
  BILLING_ENABLED: false,
  SUBDOMAIN_ROUTING_ENABLED: false,
  TENANT_REGISTRATION_ENABLED: true,
}

describe('scoring service', () => {
  test('buildScoringInput strips contact PII fields from scoring payload', async () => {
    const fixture = await Bun.file(new URL('./__fixtures__/candidate-snapshot.json', import.meta.url)).json()
    const input = buildScoringInput(fixture as never, {
      title: 'Resume Title',
      skills: ['Hono'],
      total_experience_months: 80,
      email: 'private@example.com',
      phone: '+70000000000',
      full_name: 'Should Not Be Included',
    })

    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain('private@example.com')
    expect(serialized).not.toContain('+70000000000')
    expect(serialized).not.toContain('Should Not Be Included')
  })

  test('stores successful scoring result and audit event', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 77,
        summary: 'Good technical alignment with manageable gaps.',
        strengths: ['TypeScript APIs'],
        gaps: ['No finance domain'],
        soft_skills_signals: ['Ownership language'],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Likely collaborative.',
        interview_focus_areas: ['Domain ramp-up speed'],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.skipped).toBe(false)
    expect(prisma.state.updates.find((update) => update.aiScoring?.status === 'scored')?.aiScoring?.status).toBe('scored')
    expect(prisma.state.application.stage).toBe('screen')
    expect(prisma.state.stageEvents).toHaveLength(1)
    expect(prisma.state.stageEvents[0]?.comment).toContain('AI relevance score 77 >= 60')
    expect(result.autoStage?.advanced).toBe(true)
    expect(prisma.state.auditEvents.map((event: Record<string, unknown>) => event.action)).toEqual([
      'application.ai_scored',
      'application.auto_screened',
    ])
  })

  test('auto-advances attention-zone applications with 60-69 score to screening', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 65,
        summary: 'Moderate match that needs recruiter review.',
        strengths: ['Some relevant logistics experience'],
        gaps: ['Needs verification against vacancy requirements'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Requires screening.',
        interview_focus_areas: ['Verify route ownership'],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.status).toBe('scored')
    expect(result.autoStage?.advanced).toBe(true)
    expect(prisma.state.application.stage).toBe('screen')
    expect(prisma.state.stageEvents[0]?.comment).toContain('AI relevance score 65 >= 60')
    expect(prisma.state.auditEvents.map((event: Record<string, unknown>) => event.action)).toEqual([
      'application.ai_scored',
      'application.auto_screened',
    ])
  })

  test('caps sparse same-domain scoring below auto-screening until facts are verified', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.candidate.externalIds = {
      hh_resume_snapshot: {
        title: 'Менеджер по транспортной логистике',
        experience: ['Заместитель директора по логистике', 'Клиентский менеджер'],
        education: [],
        skills: [],
        total_experience_months: 318,
        location: 'Москва',
      },
    }
    prisma.state.application.vacancy = {
      title: 'Логист',
      description: 'Расширение',
      requisition: {
        grade: 'M1',
        salaryMin: 80000,
        salaryMax: 300000,
        currency: 'RUB',
      },
    }
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 65,
        summary: 'Похожий логистический опыт, но детали нужно проверить.',
        strengths: ['Есть логистический домен'],
        gaps: ['Нет обязанностей и KPI'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: ['Мало проверяемого контекста'],
        values_fit_hypothesis: 'Нужно проверить фактами.',
        interview_focus_areas: ['Проверить маршруты и объемы'],
        interview_questions: ['Какие маршруты и объемы вы вели?'],
        model: 'deepseek/deepseek-v4-flash',
        scored_at: new Date().toISOString(),
        schema_version: 2,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    const scoredUpdate = prisma.state.updates.find((update) => update.aiScoring?.status === 'scored')
    const scoredResult = scoredUpdate?.aiScoring?.result as Record<string, unknown> | undefined

    expect(result.status).toBe('scored')
    expect(result.result?.relevance_score).toBe(59)
    expect(scoredResult?.relevance_score).toBe(59)
    expect(prisma.state.application.stage).toBe('new')
    expect(result.autoStage?.advanced).toBe(false)
    expect(result.autoStage?.reason).toBe('below_threshold')
  })

  test('caps role-list resumes without detailed proof to attention zone', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.candidate.externalIds = {
      hh_resume_snapshot: {
        title: 'Менеджер по транспортной логистике / Клиентский менеджер (KAM)',
        experience: [
          'Руководитель отдела перевозок генеральных грузов',
          'Ведущий логист отдела экспедирования FTL (Китай, ЕС, СНГ)',
          'Руководитель отдела логистики',
          'Менеджер отдела международных перевозок',
        ],
        education: ['ХИСП · 1997'],
        skills: [],
        total_experience_months: 318,
        location: 'Москва',
      },
    }
    prisma.state.application.vacancy = {
      title: 'Логист',
      description: 'Расширение',
      requisition: {
        grade: 'M1',
        salaryMin: 80000,
        salaryMax: 300000,
        currency: 'RUB',
      },
    }
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 75,
        summary: 'Сильный доменный опыт, но мало подтверждающих деталей.',
        strengths: ['FTL и международные перевозки'],
        gaps: ['Нет KPI и объемов'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: ['Мало проверяемого контекста'],
        values_fit_hypothesis: 'Нужно проверить.',
        interview_focus_areas: ['Проверить обязанности'],
        interview_questions: ['Какие KPI и объемы были в зоне ответственности?'],
        model: 'deepseek/deepseek-v4-flash',
        scored_at: new Date().toISOString(),
        schema_version: 2,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.status).toBe('scored')
    expect(result.result?.relevance_score).toBe(69)
    expect(prisma.state.application.stage).toBe('screen')
    expect(result.autoStage?.advanced).toBe(true)
    expect(prisma.state.stageEvents[0]?.comment).toContain('AI relevance score 69 >= 60')
  })

  test('does not auto-advance low-scoring applications', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 55,
        summary: 'Some match but not enough for automatic screening.',
        strengths: ['Basic logistics exposure'],
        gaps: ['No oversized cargo evidence'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Unknown.',
        interview_focus_areas: ['Cargo examples'],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
    })

    expect(result.status).toBe('scored')
    expect(result.autoStage?.advanced).toBe(false)
    expect(result.autoStage?.reason).toBe('below_threshold')
    expect(prisma.state.application.stage).toBe('new')
    expect(prisma.state.stageEvents).toHaveLength(0)
    expect(prisma.state.auditEvents).toHaveLength(1)
    expect(prisma.state.auditEvents[0]?.action).toBe('application.ai_scored')
  })

  test('preserves previous successful scoring result in history on forced re-score', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.aiScoring = {
      status: 'scored',
      input_hash: 'old-input-hash',
      result: {
        relevance_score: 82,
        summary: 'Previous model result.',
        strengths: ['Previous strength'],
        gaps: [],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Previous hypothesis.',
        interview_focus_areas: [],
        model: 'old-model',
        scored_at: '2026-07-05T15:00:00.000Z',
        schema_version: 1,
      },
    }
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 55,
        summary: 'New stricter model result.',
        strengths: ['Current strength'],
        gaps: ['Current gap'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: ['Generic resume language'],
        values_fit_hypothesis: 'Needs review.',
        interview_focus_areas: ['Verify claims'],
        model: 'deepseek/deepseek-v4-flash',
        scored_at: '2026-07-06T05:00:00.000Z',
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
      force: true,
    })

    const scoredUpdate = prisma.state.updates.find((update) => update.aiScoring?.status === 'scored')
    const history = scoredUpdate?.aiScoring?.history as Array<Record<string, unknown>> | undefined

    expect(result.status).toBe('scored')
    expect(history).toHaveLength(1)
    expect(history?.[0]?.input_hash).toBe('old-input-hash')
    expect((history?.[0]?.result as Record<string, unknown>).relevance_score).toBe(82)
    expect((history?.[0]?.result as Record<string, unknown>).model).toBe('old-model')
    expect(history?.[0]?.replaced_by_model).toBe('deepseek/deepseek-v4-flash')
  })

  test('returns automatically screened applications to new when rescored below 60', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.stage = 'screen'
    prisma.state.stageEvents.push({
      applicationId: 'app-1',
      fromStage: 'new',
      toStage: 'screen',
      comment: 'Auto-moved to screening after AI relevance score 80 >= 70',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    })
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 59,
        summary: 'Not enough evidence for screening.',
        strengths: ['Some logistics terms'],
        gaps: ['No matching route ownership evidence'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: ['Слишком общие формулировки без проверяемых деталей'],
        values_fit_hypothesis: 'Недостаточно данных.',
        interview_focus_areas: ['Проверить реальный опыт'],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
      force: true,
    })

    expect(result.status).toBe('scored')
    expect(result.autoReturn?.moved).toBe(true)
    expect(prisma.state.application.stage).toBe('new')
    expect(prisma.state.stageEvents.at(-1)?.comment).toContain('AI relevance score 59 <= 59')
    expect(prisma.state.auditEvents.map((event: Record<string, unknown>) => event.action)).toEqual([
      'application.ai_scored',
      'application.auto_returned_to_new',
    ])
  })

  test('does not return manually screened low-scoring applications to new', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.stage = 'screen'
    prisma.state.stageEvents.push({
      applicationId: 'app-1',
      fromStage: 'new',
      toStage: 'screen',
      comment: 'Manual recruiter move',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    })
    const provider: ScoringProvider = {
      score: async () => ({
        relevance_score: 59,
        summary: 'Low score.',
        strengths: [],
        gaps: ['Недостаточно данных'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Недостаточно данных.',
        interview_focus_areas: [],
        model: 'claude-haiku-4-5-20251001',
        scored_at: new Date().toISOString(),
        schema_version: 1,
      }),
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      actorUserId: 'user-1',
      provider,
      force: true,
    })

    expect(result.autoReturn?.moved).toBe(false)
    expect(result.autoReturn?.reason).toBe('not_auto_screened')
    expect(prisma.state.application.stage).toBe('screen')
  })

  test('writes failed state when provider returns malformed JSON twice', async () => {
    const prisma = createPrismaMock()
    const provider: ScoringProvider = {
      score: async () => {
        throw new ScoringProviderMalformedResponseError('claude-haiku-4-5-20251001')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
    })

    expect(result.status).toBe('failed')
    expect(prisma.state.updates.at(-1)?.aiScoring?.status).toBe('failed')
  })

  test('preserves previous successful scoring when a forced re-score fails', async () => {
    const prisma = createPrismaMock()
    prisma.state.application.aiScoring = {
      status: 'scored',
      input_hash: 'old-input-hash',
      result: {
        relevance_score: 65,
        summary: 'Previous usable result.',
        strengths: ['Relevant route ownership'],
        gaps: ['Needs verification'],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Manual review.',
        interview_focus_areas: ['Verify claims'],
        model: 'deepseek/deepseek-v4-flash',
        scored_at: '2026-07-06T05:03:12.824Z',
        schema_version: 2,
      },
    }
    const provider: ScoringProvider = {
      score: async () => {
        throw new Error('OpenAI-compatible scoring request failed: 403')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
      force: true,
    })

    const failedUpdate = prisma.state.updates.at(-1)?.aiScoring
    const previousScoring = failedUpdate?.previous_scoring as Record<string, unknown> | undefined
    const previousResult = previousScoring?.result as Record<string, unknown> | undefined

    expect(result.status).toBe('failed')
    expect(failedUpdate?.status).toBe('failed')
    expect(failedUpdate?.failure).toMatchObject({
      error: 'OpenAI-compatible scoring request failed: 403',
      model: baseEnv.LLM_SCORING_MODEL,
    })
    expect(previousScoring?.status).toBe('scored')
    expect(previousScoring?.input_hash).toBe('old-input-hash')
    expect(previousResult?.relevance_score).toBe(65)
  })

  test('skips re-scoring when input hash is unchanged', async () => {
    const prisma = createPrismaMock()

    const originalInput = buildScoringInput(prisma.state.application as never, null)
    prisma.state.application.aiScoring = {
      status: 'scored',
      input_hash: hashScoringInput(originalInput),
      result: {
        relevance_score: 70,
      },
    }

    const provider: ScoringProvider = {
      score: async () => {
        throw new Error('should not be called')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('unchanged_input')
  })

  test('scoring hash changes when scoring ruleset changes', () => {
    const input = buildScoringInput(createPrismaMock().state.application as never, null)

    expect(hashScoringInput(input)).not.toBe(createHashWithoutRuleset(input))
  })

  test('skips queued forced re-score when previous scoring has the same input hash', async () => {
    const prisma = createPrismaMock()

    const originalInput = buildScoringInput(prisma.state.application as never, null)
    const previousScoring = {
      status: 'scored',
      input_hash: hashScoringInput(originalInput),
      result: {
        relevance_score: 0,
        summary: 'Previous stable result.',
        strengths: [],
        gaps: [],
        soft_skills_signals: [],
        red_flags: [],
        anti_fraud_signals: [],
        values_fit_hypothesis: 'Previous.',
        interview_focus_areas: [],
        model: 'deepseek-v4-flash',
        scored_at: '2026-07-07T00:00:00.000Z',
        schema_version: 2,
      },
    }
    prisma.state.application.aiScoring = {
      status: 'pending',
      input_hash: hashScoringInput(originalInput),
      force: true,
      previous_scoring: previousScoring,
    }

    const provider: ScoringProvider = {
      score: async () => {
        throw new Error('should not be called')
      },
    }

    const result = await scoreApplication({
      prisma: prisma as never,
      env: baseEnv,
      applicationId: 'app-1',
      provider,
      force: true,
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('unchanged_input')
    expect(prisma.state.updates).toHaveLength(1)
    expect(prisma.state.application.aiScoring).toEqual(previousScoring)
  })

  test('buildScoringInput includes previous HH resume versions for contradiction checks', () => {
    const snapshot = {
      ...createPrismaMock().state.application,
      candidate: {
        location: 'Moscow',
        externalIds: {
          hh_resume_snapshot: {
            title: 'Senior logist',
            experience: ['Head of logistics @ CurrentCo'],
            education: ['MSU · 2020'],
            skills: ['FTL'],
            total_experience_months: 72,
            location: 'Moscow',
          },
          hh_resume_history: [
            {
              title: 'Junior logist',
              experience: ['Assistant @ OldCo'],
              education: ['College · 2019'],
              skills: ['LTL'],
              total_experience_months: 24,
              location: 'Kazan',
              imported_at: '2026-07-01T00:00:00.000Z',
            },
            {
              title: 'Senior logist',
              experience: ['Head of logistics @ CurrentCo'],
              education: ['MSU · 2020'],
              skills: ['FTL'],
              total_experience_months: 72,
              location: 'Moscow',
              imported_at: '2026-07-02T00:00:00.000Z',
            },
          ],
        },
      },
    }

    const input = buildScoringInput(snapshot as never, null)

    expect(input.candidate_resume.previous_versions).toEqual([
      {
        title: 'Junior logist',
        experience: ['Assistant @ OldCo'],
        education: ['College · 2019'],
        skills: ['LTL'],
        total_experience_months: 24,
        location: 'Kazan',
      },
    ])
  })
})

function createHashWithoutRuleset(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function createPrismaMock() {
  const state = {
    application: {
      id: 'app-1',
      tenantId: 'tenant-1',
      candidateId: 'cand-1',
      stage: 'new',
      aiScoring: null as unknown,
      candidate: {
        location: 'Moscow',
        externalIds: {
          hh_resume_snapshot: {
            title: 'Backend engineer',
            experience: ['Senior Engineer @ Acme'],
            education: ['MIPT · 2018'],
            skills: ['TypeScript'],
            total_experience_months: 72,
            location: 'Moscow',
          },
        },
      },
      vacancy: {
        title: 'Senior Backend Engineer',
        description: 'TypeScript, PostgreSQL, API design',
        requisition: {
          grade: 'M3',
          salaryMin: 200000,
          salaryMax: 300000,
          currency: 'RUB',
        },
      },
    },
    updates: [] as Array<{ aiScoring?: Record<string, unknown>; stage?: string }>,
    stageEvents: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    userRoles: [{ tenantId: 'tenant-1', userId: 'user-1', role: 'owner', user: { disabledAt: null } }],
  }

  const prisma = {
    application: {
      findFirst: async ({ where }: { where: { id: string; tenantId?: string } }) => {
        if (where.id !== state.application.id) return null
        if (where.tenantId && where.tenantId !== state.application.tenantId) return null
        return state.application
      },
      update: async ({ data }: { data: { aiScoring?: Record<string, unknown>; stage?: string } }) => {
        if (data.aiScoring) state.application.aiScoring = data.aiScoring
        if (data.stage) state.application.stage = data.stage
        state.updates.push(data)
        return state.application
      },
    },
    resume: {
      findFirst: async () => null,
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data)
      },
    },
    applicationStageEvent: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          [...state.stageEvents]
            .reverse()
            .find((event) => {
              if (where.applicationId && event.applicationId !== where.applicationId) return false
              if (where.fromStage && event.fromStage !== where.fromStage) return false
              if (where.toStage && event.toStage !== where.toStage) return false
              return true
            }) ?? null
        )
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.stageEvents.push(data)
      },
    },
    userRole: {
      findMany: async ({ where }: { where: { tenantId: string; role: { in: string[] }; user: { disabledAt: null } } }) => {
        return state.userRoles
          .filter((row) => row.tenantId === where.tenantId)
          .filter((row) => where.role.in.includes(row.role))
          .filter((row) => row.user.disabledAt === where.user.disabledAt)
          .map((row) => ({ userId: row.userId, role: row.role }))
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(prisma),
    state,
  }

  return prisma
}
