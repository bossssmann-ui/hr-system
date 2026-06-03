import { describe, expect, test } from 'bun:test'

import {
  CARGO_LAYOUT_RECRUITER_FLAG,
  admissionToStatus,
  admissionToVerdictLabel,
  computeDomesticVerdict,
  deriveProvisionalComponents,
  evaluateCargoLayoutExperience,
  finalizeDomesticStage4,
  gradeDomesticOpenAnswers,
  scoreDomesticStage2,
} from './domestic-stage-scoring'
import { getDomesticStageContent } from './domestic-stage-content'
import type { SpecializationAssignment } from './domestic-specializations'
import type { TestStageContent } from './stage-content'

function allCorrectAnswersFor(specs: SpecializationAssignment[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const s of specs) {
    const content = getDomesticStageContent(s.packageId, 2) as TestStageContent | null
    if (!content) continue
    for (const q of content.questions) {
      if (q.type === 'radio' && q.correct) answers[q.key] = q.correct
    }
  }
  return answers
}

describe('scoreDomesticStage2', () => {
  test('возвращает один результат на пакет', () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const out = scoreDomesticStage2(specs, {})
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.packageId as string).sort()).toEqual(
      ['domestic_core_operations', 'domestic_road_ftl_ltl'].sort(),
    )
  })

  test('all-correct → rawScore === maxScore > 0', () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const answers = allCorrectAnswersFor(specs)
    const out = scoreDomesticStage2(specs, answers)
    for (const r of out) {
      expect(r.maxScore).toBeGreaterThan(0)
      expect(r.rawScore).toBe(r.maxScore)
    }
  })

  test('неизвестный пакет → пропускается, не бросает', () => {
    const specs = [
      { packageId: 'unknown_pkg', level: 'primary' },
    ] as unknown as SpecializationAssignment[]
    const out = scoreDomesticStage2(specs, {})
    expect(out).toEqual([])
  })

  test('все ответы пустые → rawScore=0, maxScore>0', () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
    ]
    const out = scoreDomesticStage2(specs, {})
    expect(out).toHaveLength(1)
    expect(out[0]?.rawScore).toBe(0)
    expect(out[0]?.maxScore).toBeGreaterThan(0)
  })

  test('добавляет бонус +1 за конкретную раскладку груза для eligible-специализации', () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const out = scoreDomesticStage2(specs, {
      q_cargo_layout_experience:
        'Да, делал самостоятельно в Excel: 24 паллеты стройматериалов и 18 тонн оборудования.',
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.rawScore).toBe(1)
    expect(out[0]?.maxScore).toBeGreaterThan(0)
  })
})

describe('deriveProvisionalComponents', () => {
  test('без депт-риск-флагов и без риск-флагов', () => {
    const c = deriveProvisionalComponents(
      [{ packageId: 'domestic_core_operations', rawScore: 10, maxScore: 20 }],
      [],
      false,
    )
    expect(c.resumeAndInterviewScore).toBe(15)
    expect(c.communicationScore).toBe(5)
    // 25 * 10/20 = 12.5
    expect(c.practicalScore).toBeCloseTo(12.5, 5)
  })

  test('1 depth-risk → resume=11, communication=3 (riskFlags non-empty)', () => {
    const c = deriveProvisionalComponents(
      [{ packageId: 'domestic_core_operations', rawScore: 0, maxScore: 20 }],
      ['oversized_depth_risk'],
      true,
    )
    expect(c.resumeAndInterviewScore).toBe(11)
    expect(c.communicationScore).toBe(3)
    expect(c.practicalScore).toBe(0)
  })

  test('3 depth-risk → resume=max(3,15-12)=3', () => {
    const c = deriveProvisionalComponents(
      [{ packageId: 'domestic_core_operations', rawScore: 5, maxScore: 10 }],
      ['oversized_depth_risk', 'remote_region_depth_risk', 'cabotage_depth_risk'],
      false,
    )
    expect(c.resumeAndInterviewScore).toBe(3)
    expect(c.communicationScore).toBe(3)
    expect(c.practicalScore).toBeCloseTo(12.5, 5)
  })

  test('hasSecondary=true → practicalCap=20', () => {
    const c = deriveProvisionalComponents(
      [{ packageId: 'domestic_core_operations', rawScore: 10, maxScore: 10 }],
      [],
      true,
    )
    expect(c.practicalScore).toBe(20)
  })

  test('пустые модули → practicalScore=0', () => {
    const c = deriveProvisionalComponents([], [], false)
    expect(c.practicalScore).toBe(0)
  })
})

describe('gradeDomesticOpenAnswers', () => {
  test('uses provider.gradeOpenAnswer when provider is supplied', async () => {
    const calls: Array<{ question: string; rubric: string; answer: string }> = []
    const grades = await gradeDomesticOpenAnswers({
      answers: {
        q_new_carrier_check: 'Проверяю через АТИ Светофор и документы.',
        q_contract_risk_signs: 'Смотрю окна, договор-заявку и штрафы.',
      },
      provider: {
        async gradeOpenAnswer(input) {
          calls.push(input)
          return { score: 77, rationale: 'ok' }
        },
      },
    })
    expect(calls).toHaveLength(2)
    expect(grades.map((item) => item.score)).toEqual([77, 77])
  })
})

describe('evaluateCargoLayoutExperience', () => {
  test('распознаёт конкретный положительный ответ', () => {
    const res = evaluateCargoLayoutExperience(
      'Да, сам делал в Excel, раскладывал 32 паллеты металла и 20 тонн оборудования.',
    )
    expect(res.claimedSelfLayout).toBe(true)
    expect(res.hasConcreteEvidence).toBe(true)
  })

  test('пустой/неконкретный ответ не даёт concrete-evidence', () => {
    const res = evaluateCargoLayoutExperience('Иногда участвовал, без деталей.')
    expect(res.hasConcreteEvidence).toBe(false)
  })
})

describe('admissionToStatus / admissionToVerdictLabel', () => {
  test('STRONG_CANDIDATE / ADMIT_TO_INTERVIEW → completed / ДОПУСТИТЬ', () => {
    expect(admissionToStatus('STRONG_CANDIDATE')).toBe('completed')
    expect(admissionToStatus('ADMIT_TO_INTERVIEW')).toBe('completed')
    expect(admissionToVerdictLabel('STRONG_CANDIDATE')).toBe('ДОПУСТИТЬ')
    expect(admissionToVerdictLabel('ADMIT_TO_INTERVIEW')).toBe('ДОПУСТИТЬ')
  })
  test('MANUAL_* → manual_review / НА РУЧНУЮ ПРОВЕРКУ HR', () => {
    expect(admissionToStatus('MANUAL_REVIEW_HR')).toBe('manual_review')
    expect(admissionToStatus('MANUAL_EXCEPTION_ONLY')).toBe('manual_review')
    expect(admissionToVerdictLabel('MANUAL_REVIEW_HR')).toBe('НА РУЧНУЮ ПРОВЕРКУ HR')
  })
  test('REJECT / AUTO_REJECT → rejected / ОТКЛОНИТЬ', () => {
    expect(admissionToStatus('REJECT')).toBe('rejected')
    expect(admissionToStatus('AUTO_REJECT')).toBe('rejected')
    expect(admissionToVerdictLabel('AUTO_REJECT')).toBe('ОТКЛОНИТЬ')
  })
})

describe('computeDomesticVerdict', () => {
  const specs: SpecializationAssignment[] = [
    { packageId: 'domestic_core_operations', level: 'primary' },
    { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
  ]

  test('100% объективных + 0 рисков → completed / ДОПУСТИТЬ', () => {
    const moduleResults = scoreDomesticStage2(specs, allCorrectAnswersFor(specs))
    // Verify our test setup actually yields full-credit modules.
    for (const r of moduleResults) expect(r.rawScore).toBe(r.maxScore)

    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: [],
      moduleResults,
      mergedAnswers: {},
    })
    expect(c.totalScore).toBeGreaterThanOrEqual(85)
    expect(c.status).toBe('completed')
    expect(c.verdictLabel).toBe('ДОПУСТИТЬ')
  })

  test('0 ответов → totalScore низкий, статус rejected', () => {
    const moduleResults = scoreDomesticStage2(specs, {})
    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: ['oversized_depth_risk', 'remote_region_depth_risk', 'cabotage_depth_risk'],
      moduleResults,
      mergedAnswers: {},
    })
    expect(c.totalScore).toBeLessThan(60)
    expect(c.status).toBe('rejected')
    expect(c.verdictLabel).toBe('ОТКЛОНИТЬ')
  })

  test('1 RED trap при сильных ответах → manual_review', () => {
    const moduleResults = scoreDomesticStage2(specs, allCorrectAnswersFor(specs))
    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: [],
      moduleResults,
      // trap_answer_1 contains a known fake TMS → triggers RED id=1
      mergedAnswers: { trap_answer_1: 'LogiTrack PRO X7' },
    })
    expect(c.flags.some((f) => f.type === 'RED')).toBe(true)
    expect(c.status).toBe('manual_review')
    expect(c.verdictLabel).toBe('НА РУЧНУЮ ПРОВЕРКУ HR')
  })

  test('2 RED traps → rejected', () => {
    const moduleResults = scoreDomesticStage2(specs, allCorrectAnswersFor(specs))
    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: ['oversized_depth_risk'],
      moduleResults,
      mergedAnswers: {
        trap_answer_1: 'LogiTrack PRO X7',
      },
    })
    // Two REDs: id=1 (fake TMS) + id=2 (oversized_depth_risk)
    expect(c.flags.filter((f) => f.type === 'RED').length).toBeGreaterThanOrEqual(2)
    expect(c.status).toBe('rejected')
    expect(c.verdictLabel).toBe('ОТКЛОНИТЬ')
  })

  test('строит retention prediction с монотонными вероятностями 30/60/90', () => {
    const moduleResults = scoreDomesticStage2(specs, allCorrectAnswersFor(specs))
    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: [],
      moduleResults,
      mergedAnswers: {},
    })
    expect(c.retentionPrediction.survival30).toBeGreaterThanOrEqual(c.retentionPrediction.survival60)
    expect(c.retentionPrediction.survival60).toBeGreaterThanOrEqual(c.retentionPrediction.survival90)
    expect(c.retentionPrediction.modelVersion).toBe('retention-v1')
  })

  test('ставит recruiter checklist flag при заявленной раскладке и допуске', () => {
    const moduleResults = scoreDomesticStage2(specs, allCorrectAnswersFor(specs))
    const c = computeDomesticVerdict({
      specializations: specs,
      riskFlags: [],
      moduleResults,
      mergedAnswers: {
        q_cargo_layout_experience:
          'Да, делал самостоятельно в Excel: 24 паллеты стройматериалов и 18 тонн оборудования.',
      },
    })
    expect(c.recruiterChecklistFlags).toContain(CARGO_LAYOUT_RECRUITER_FLAG)
  })
})

describe('finalizeDomesticStage4', () => {
  function makeFakePrisma(session: Record<string, unknown> | null) {
    const upsertCalls: Array<Record<string, unknown>> = []
    const updateCalls: Array<Record<string, unknown>> = []
    const prisma = {
      selectionSession: {
        findUnique: async () => session,
        update: async (args: Record<string, unknown>) => {
          updateCalls.push(args)
          return session
        },
      },
      selectionScoringWeights: {
        findFirst: async () => null,
      },
      selectionVerdict: {
        upsert: async (args: Record<string, unknown>) => {
          upsertCalls.push(args)
          return { id: 'verdict-1' }
        },
      },
    }
    return { prisma, upsertCalls, updateCalls }
  }

  test('не-domestic → null, без записи вердикта', async () => {
    const { prisma, upsertCalls, updateCalls } = makeFakePrisma({
      id: 'sess-1',
      template: { role: 'logist' },
      stageResults: [],
      specializations: null,
      assessmentProfile: null,
      applicationId: null,
    })
    const result = await finalizeDomesticStage4(
      prisma as unknown as Parameters<typeof finalizeDomesticStage4>[0],
      'sess-1',
    )
    expect(result).toBeNull()
    expect(upsertCalls).toHaveLength(0)
  })

  test('domestic, идеальные ответы → upsert ДОПУСТИТЬ/completed', async () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const stage2Answers = allCorrectAnswersFor(specs)
    const { prisma, upsertCalls, updateCalls } = makeFakePrisma({
      id: 'sess-2',
      template: { role: 'logist_domestic' },
      stageResults: [
        { stageNumber: 1, answers: {}, scores: null },
        { stageNumber: 2, answers: stage2Answers, scores: null },
        { stageNumber: 3, answers: {}, scores: null },
        { stageNumber: 4, answers: { practical: 'ok' }, scores: null },
      ],
      specializations: specs,
      assessmentProfile: { signals: [], riskFlags: [] },
      applicationId: 'app-1',
    })
    const result = await finalizeDomesticStage4(
      prisma as unknown as Parameters<typeof finalizeDomesticStage4>[0],
      'sess-2',
    )
    expect(result).not.toBeNull()
    expect(result?.status).toBe('completed')
    expect(result?.verdictLabel).toBe('ДОПУСТИТЬ')
    expect(upsertCalls).toHaveLength(1)
    const call = upsertCalls[0] as { create: { verdict: string }; where: { sessionId: string } }
    expect(call.where.sessionId).toBe('sess-2')
    expect(call.create.verdict).toBe('ДОПУСТИТЬ')
    expect(call.create).toHaveProperty('retentionPrediction')
    expect(updateCalls).toHaveLength(1)
  })

  test('domestic, использует уже сохранённые scores.moduleResults Stage-2', async () => {
    const specs: SpecializationAssignment[] = [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ]
    const persistedModuleResults = [
      { packageId: 'domestic_core_operations' as const, rawScore: 6, maxScore: 6 },
      { packageId: 'domestic_road_ftl_ltl' as const, rawScore: 30, maxScore: 30 },
    ]
    const { prisma, upsertCalls } = makeFakePrisma({
      id: 'sess-3',
      template: { role: 'logist_domestic' },
      stageResults: [
        { stageNumber: 2, answers: {}, scores: { moduleResults: persistedModuleResults } },
        { stageNumber: 4, answers: {}, scores: null },
      ],
      specializations: specs,
      assessmentProfile: { signals: [], riskFlags: [] },
      applicationId: null,
    })
    const result = await finalizeDomesticStage4(
      prisma as unknown as Parameters<typeof finalizeDomesticStage4>[0],
      'sess-3',
    )
    expect(result?.moduleResults).toEqual(persistedModuleResults)
    expect(upsertCalls).toHaveLength(1)
  })
})
