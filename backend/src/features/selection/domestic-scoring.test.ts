import { describe, expect, test } from 'bun:test'

import {
  scoreDomesticHardSkillFactology,
  scoreDomesticAssessment,
  shouldAdmitToLiveInterview,
} from './domestic-scoring'
import type {
  DomesticAssessmentProfile,
  RawModuleResult,
  DomesticCrossCheckFlag,
} from './domestic-scoring'

function makeProfile(overrides: Partial<DomesticAssessmentProfile> = {}): DomesticAssessmentProfile {
  return {
    candidateId: 'cand-1',
    signals: [],
    specializations: [
      { packageId: 'domestic_core_operations', level: 'primary' },
      { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
    ],
    riskFlags: [],
    ...overrides,
  }
}

function makeModuleResults(overrides: Partial<RawModuleResult>[] = []): RawModuleResult[] {
  return overrides.map((o) => ({
    packageId: 'domestic_core_operations' as const,
    rawScore: 0,
    maxScore: 100,
    ...o,
  }))
}

describe('scoreDomesticAssessment', () => {
  test('scoreDomesticHardSkillFactology: 1С threshold requires уверенно+ / администрирование', () => {
    expect(scoreDomesticHardSkillFactology({ q_1c_experience: 'базово (просмотр)' }).passed1CThreshold).toBe(false)
    expect(
      scoreDomesticHardSkillFactology({
        q_1c_experience: 'уверенно (ТТН, ТрН, путевые листы)',
      }).passed1CThreshold,
    ).toBe(true)
    expect(scoreDomesticHardSkillFactology({ q_1c_experience: 'администрирование' }).passed1CThreshold).toBe(true)
  })

  test('scoreDomesticHardSkillFactology: контрагент проходит порог только с risk-check инструментом', () => {
    expect(
      scoreDomesticHardSkillFactology({
        q_counterparty_checks: ['ati.su (поиск грузов/машин)'],
      }).passedCounterpartyThreshold,
    ).toBe(false)
    expect(
      scoreDomesticHardSkillFactology({
        q_counterparty_checks: ['АТИ Светофор (рейтинг/риски)'],
      }).passedCounterpartyThreshold,
    ).toBe(true)
    expect(
      scoreDomesticHardSkillFactology({
        q_counterparty_checks: ['Контур.Фокус / СБИС / аналоги (проверка юрлица)'],
      }).passedCounterpartyThreshold,
    ).toBe(true)
  })

  test('без вторичных: primarySpec макс=35, practicalAssignment макс=25', () => {
    const profile = makeProfile({
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
      ],
    })
    const result = scoreDomesticAssessment(profile, [])
    expect(result.hardSkillFactologyScore).toBeLessThanOrEqual(10)
    // No secondary specializations → maxes should be 35/25
    expect(result.primarySpecScore).toBeLessThanOrEqual(35)
    expect(result.practicalAssignmentScore).toBeLessThanOrEqual(25)
    expect(result.secondarySpecScore).toBe(0)
  })

  test('с вторичными: primarySpec макс=25, practicalAssignment макс=20', () => {
    const profile = makeProfile({
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
        { packageId: 'domestic_distribution', level: 'secondary' },
      ],
    })
    const result = scoreDomesticAssessment(profile, [])
    expect(result.hardSkillFactologyScore).toBeLessThanOrEqual(10)
    expect(result.primarySpecScore).toBeLessThanOrEqual(25)
    expect(result.practicalAssignmentScore).toBeLessThanOrEqual(20)
    // secondary slot exists
    expect(result.secondarySpecScore).toBeLessThanOrEqual(15)
  })

  test('итоговый балл = сумма всех компонентов ≤ 100', () => {
    const profile = makeProfile()
    const result = scoreDomesticAssessment(profile, [])
    const sum =
      result.hardSkillFactologyScore +
      result.resumeAndInterviewScore +
      result.coreOperationsScore +
      result.primarySpecScore +
      result.secondarySpecScore +
      result.practicalAssignmentScore +
      result.communicationScore
    expect(Math.abs(result.totalScore - sum)).toBeLessThanOrEqual(0.01)
    expect(result.totalScore).toBeLessThanOrEqual(100)
  })

  test('все компоненты 100% → totalScore = 100', () => {
    const profile = makeProfile({
      specializations: [
        { packageId: 'domestic_core_operations', level: 'primary' },
        { packageId: 'domestic_road_ftl_ltl', level: 'primary' },
      ],
    })
    // Provide full scores for all modules
    const moduleResults: RawModuleResult[] = [
      { packageId: 'domestic_core_operations', rawScore: 20, maxScore: 20 },
      { packageId: 'domestic_road_ftl_ltl', rawScore: 35, maxScore: 35 },
    ]
    const result = scoreDomesticAssessment(
      {
        ...profile,
        hardSkillFactologyScore: 10,
        resumeAndInterviewScore: 5,
        communicationScore: 5,
        practicalScore: 25,
      },
      moduleResults,
    )
    expect(result.totalScore).toBe(100)
  })

  test('все компоненты 0% → totalScore = 0', () => {
    const profile = makeProfile()
    const moduleResults: RawModuleResult[] = [
      { packageId: 'domestic_core_operations', rawScore: 0, maxScore: 20 },
      { packageId: 'domestic_road_ftl_ltl', rawScore: 0, maxScore: 35 },
    ]
    const result = scoreDomesticAssessment(
      {
        ...profile,
        hardSkillFactologyScore: 0,
        resumeAndInterviewScore: 0,
        communicationScore: 0,
        practicalScore: 0,
      },
      moduleResults,
    )
    expect(result.totalScore).toBe(0)
  })

  test('без калибровки использует дефолтные веса', () => {
    const profile = makeProfile({
      hardSkillFactologyScore: 10,
      resumeAndInterviewScore: 5,
      communicationScore: 5,
      practicalScore: 25,
    })
    const moduleResults: RawModuleResult[] = [
      { packageId: 'domestic_core_operations', rawScore: 20, maxScore: 20 },
      { packageId: 'domestic_road_ftl_ltl', rawScore: 35, maxScore: 35 },
    ]
    const result = scoreDomesticAssessment(profile, moduleResults)
    expect(result.totalScore).toBe(100)
  })

  test('калиброванные веса влияют на компонентные капы', () => {
    const profile = makeProfile({
      hardSkillFactologyScore: 10,
      resumeAndInterviewScore: 5,
      communicationScore: 5,
      practicalScore: 25,
    })
    const moduleResults: RawModuleResult[] = [
      { packageId: 'domestic_core_operations', rawScore: 20, maxScore: 20 },
      { packageId: 'domestic_road_ftl_ltl', rawScore: 35, maxScore: 35 },
    ]
    const result = scoreDomesticAssessment(profile, moduleResults, {
      hardSkillFactology: 8,
      resumeAndInterview: 7,
      coreOperations: 30,
      primarySpec: 20,
      secondarySpec: 10,
      practicalAssignment: 25,
      communication: 5,
    })
    expect(result.hardSkillFactologyScore).toBe(8)
    expect(result.coreOperationsScore).toBe(30)
    expect(result.totalScore).toBeCloseTo(99.6667, 3)
  })

  test('totalScore 85+ без RED ≤1 ORANGE → STRONG_CANDIDATE', () => {
    const profile = makeProfile()
    const flags: DomesticCrossCheckFlag[] = []
    const verdict = shouldAdmitToLiveInterview(90, flags)
    expect(verdict).toBe('STRONG_CANDIDATE')
  })

  test('totalScore 70-84 без RED ≤2 ORANGE → ADMIT_TO_INTERVIEW', () => {
    const profile = makeProfile()
    const flags: DomesticCrossCheckFlag[] = []
    const verdict = shouldAdmitToLiveInterview(75, flags)
    expect(verdict).toBe('ADMIT_TO_INTERVIEW')
  })

  test('totalScore 60-69 → MANUAL_EXCEPTION_ONLY', () => {
    const verdict = shouldAdmitToLiveInterview(65, [])
    expect(verdict).toBe('MANUAL_EXCEPTION_ONLY')
  })

  test('totalScore < 60 → REJECT', () => {
    const verdict = shouldAdmitToLiveInterview(55, [])
    expect(verdict).toBe('REJECT')
  })

  test('totalScore 70+ с RED → MANUAL_REVIEW_HR', () => {
    const flags: DomesticCrossCheckFlag[] = [
      { id: 1, type: 'RED', description: 'trap', impact: 'bad' },
    ]
    const verdict = shouldAdmitToLiveInterview(75, flags)
    expect(verdict).toBe('MANUAL_REVIEW_HR')
  })
})

describe('shouldAdmitToLiveInterview', () => {
  test('score=90, нет флагов → STRONG_CANDIDATE', () => {
    expect(shouldAdmitToLiveInterview(90, [])).toBe('STRONG_CANDIDATE')
  })

  test('score=75, нет флагов → ADMIT_TO_INTERVIEW', () => {
    expect(shouldAdmitToLiveInterview(75, [])).toBe('ADMIT_TO_INTERVIEW')
  })

  test('score=65 → MANUAL_EXCEPTION_ONLY', () => {
    expect(shouldAdmitToLiveInterview(65, [])).toBe('MANUAL_EXCEPTION_ONLY')
  })

  test('score=50 → REJECT', () => {
    expect(shouldAdmitToLiveInterview(50, [])).toBe('REJECT')
  })

  test('score=75, один RED → MANUAL_REVIEW_HR', () => {
    const flags: DomesticCrossCheckFlag[] = [
      { id: 1, type: 'RED', description: 'x', impact: 'y' },
    ]
    expect(shouldAdmitToLiveInterview(75, flags)).toBe('MANUAL_REVIEW_HR')
  })

  test('score=75, два RED → AUTO_REJECT', () => {
    const flags: DomesticCrossCheckFlag[] = [
      { id: 1, type: 'RED', description: 'x', impact: 'y' },
      { id: 2, type: 'RED', description: 'z', impact: 'w' },
    ]
    expect(shouldAdmitToLiveInterview(75, flags)).toBe('AUTO_REJECT')
  })

  test('score=90, три ORANGE → ADMIT_TO_INTERVIEW (не STRONG)', () => {
    const flags: DomesticCrossCheckFlag[] = [
      { id: 101, type: 'ORANGE', description: 'a', impact: 'b' },
      { id: 102, type: 'ORANGE', description: 'c', impact: 'd' },
      { id: 103, type: 'ORANGE', description: 'e', impact: 'f' },
    ]
    expect(shouldAdmitToLiveInterview(90, flags)).toBe('ADMIT_TO_INTERVIEW')
  })

  test('стоп-критерий → AUTO_REJECT независимо от балла', () => {
    const flags: DomesticCrossCheckFlag[] = [
      { id: 100, type: 'RED', description: 'stop criterion', impact: 'AUTO_REJECT' },
    ]
    expect(shouldAdmitToLiveInterview(95, flags)).toBe('AUTO_REJECT')
  })
})
