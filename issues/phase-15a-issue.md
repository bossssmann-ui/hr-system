> **Phase:** 15a — Domestic Logist Dynamic Packages (Business Logic)
> **Approach:** TDD-first (failing tests → minimal implementation → green)
> **Depends on:** Phase 14b (stage-content.ts, selection.routes.ts, selection.queue.ts)
> **Full spec:** `docs/selection-logist-domestic-packages.md`

---

## 1. Цель

Расширить систему отбора кандидатов для роли `logist_domestic` (логисты внутренней/российской логистики). В отличие от `logist` (фиксированный набор этапов для международной экспедиции), `logist_domestic` получает **индивидуальный пакет тестов**, собранный на основе заявленного опыта кандидата. Phase 15a реализует только бизнес-логику (типы, алгоритмы, тесты) — без UI и AI-собеседования.

---

## 2. Пакеты специализации

| Пакет | Триггеры (из резюме / ответов кандидата) |
|-------|------------------------------------------|
| `domestic_core_operations` | **Обязателен для всех** |
| `domestic_road_ftl_ltl` | FTL, LTL, фуры, сборные, ATI, генгруз, машины по РФ |
| `domestic_distribution` | развозка, маршруты, точки, окна доставки, SLA |
| `domestic_rail_container` | ЖД, контейнер, станция, терминал, ЭТРАН |
| `domestic_oversized_heavy` | негабарит, тяжеловес, трал, разрешение, сопровождение |
| `domestic_remote_regions` | Север, Якутия, Камчатка, Чукотка, зимник, переправа |
| `domestic_cabotage` | каботаж, порт РФ, морская линия, Магадан, Сахалин |

Если кандидат не заявляет узкую специализацию — назначается `domestic_core_operations` + `domestic_road_ftl_ltl`.

---

## 3. Схема данных

```sql
-- Добавить в assessment_sessions
ALTER TABLE assessment_sessions
  ADD COLUMN assessment_profile JSONB,
  ADD COLUMN specializations   JSONB;

-- Новая таблица результатов по модулям
CREATE TABLE specialization_module_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID REFERENCES assessment_sessions(id),
  package_id     TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('primary','secondary','mentioned_only','contradicted')),
  raw_score      NUMERIC(5,2),
  max_score      NUMERIC(5,2),
  weighted_score NUMERIC(5,2),
  flags          JSONB,
  submitted_at   TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. TypeScript-интерфейсы

```typescript
export type SpecializationPackageId =
  | 'domestic_core_operations'
  | 'domestic_road_ftl_ltl'
  | 'domestic_distribution'
  | 'domestic_rail_container'
  | 'domestic_oversized_heavy'
  | 'domestic_remote_regions'
  | 'domestic_cabotage'

export type SpecializationLevel =
  | 'primary'
  | 'secondary'
  | 'mentioned_only'
  | 'contradicted'

export interface SpecializationAssignment {
  packageId: SpecializationPackageId
  level: SpecializationLevel
}

export interface DomesticAssessmentProfile {
  candidateId: string
  signals: string[]
  specializations: SpecializationAssignment[]
  riskFlags: string[]
}

export interface ModuleScore {
  packageId: SpecializationPackageId
  level: SpecializationLevel
  rawScore: number
  maxScore: number
  weightedScore: number
}

export interface DomesticScoringResult {
  resumeAndInterviewScore: number   // макс 15
  coreOperationsScore: number       // макс 20
  primarySpecScore: number          // макс 25 (или 35 без вторичных)
  secondarySpecScore: number        // макс 15 (или 0, перераспределяется)
  practicalAssignmentScore: number  // макс 20 (или 25 без вторичных)
  communicationScore: number        // макс 5
  totalScore: number                // 0-100
  moduleScores: ModuleScore[]
  admission: DomesticAdmissionVerdict
}

export type DomesticAdmissionVerdict =
  | 'STRONG_CANDIDATE'
  | 'ADMIT_TO_INTERVIEW'
  | 'MANUAL_EXCEPTION_ONLY'
  | 'REJECT'
  | 'MANUAL_REVIEW_HR'
  | 'AUTO_REJECT'

export interface DomesticCrossCheckFlag {
  id: number
  type: 'RED' | 'ORANGE'
  packageId?: SpecializationPackageId
  description: string
  impact: string
}
```

---

## 5. Новые FSM-статусы

```
pending
  └─→ resume_parsed
        └─→ ai_interview
              └─→ packages_assigned
                    └─→ stage_1
                          └─→ stage_1_rejected
                          └─→ stage_2
                                └─→ stage_2_failed
                                └─→ stage_3
                                      └─→ stage_4
                                            └─→ completed → [AI verdict]
```

Переход между этапами — максимум 24 часа. Просрочка → `expired`.

---

## 6. TDD-контракты

### 6.1 `selectSpecializations(signals: string[]): SpecializationAssignment[]`

```
describe('selectSpecializations', () => {
  it('всегда включает domestic_core_operations как primary')
  it('добавляет domestic_road_ftl_ltl при сигнале "FTL"')
  it('добавляет domestic_road_ftl_ltl при сигнале "ATI"')
  it('добавляет domestic_road_ftl_ltl при сигнале "сборные"')
  it('добавляет domestic_distribution при сигнале "развозка"')
  it('добавляет domestic_distribution при сигнале "окна доставки"')
  it('добавляет domestic_rail_container при сигнале "ЭТРАН"')
  it('добавляет domestic_rail_container при сигнале "контейнер"')
  it('добавляет domestic_oversized_heavy при сигнале "негабарит"')
  it('добавляет domestic_oversized_heavy при сигнале "трал"')
  it('добавляет domestic_remote_regions при сигнале "Якутия"')
  it('добавляет domestic_remote_regions при сигнале "зимник"')
  it('добавляет domestic_cabotage при сигнале "каботаж"')
  it('добавляет domestic_cabotage при сигнале "Сахалин"')
  it('при пустых сигналах → core + road_ftl_ltl')
  it('не дублирует пакет при нескольких триггерах одного пакета')
  it('регистронезависимо ("НЕГАБАРИТ" === "негабарит")')
})
```

### 6.2 `scoreDomesticAssessment(profile, moduleResults): DomesticScoringResult`

```
describe('scoreDomesticAssessment', () => {
  it('без вторичных: primarySpec макс=35, practicalAssignment макс=25')
  it('с вторичными: primarySpec макс=25, practicalAssignment макс=20')
  it('итоговый балл = сумма всех компонентов ≤ 100')
  it('все компоненты 100% → totalScore = 100')
  it('все компоненты 0% → totalScore = 0')
  it('totalScore 85+ без RED ≤1 ORANGE → STRONG_CANDIDATE')
  it('totalScore 70-84 без RED ≤2 ORANGE → ADMIT_TO_INTERVIEW')
  it('totalScore 60-69 → MANUAL_EXCEPTION_ONLY')
  it('totalScore < 60 → REJECT')
  it('totalScore 70+ с RED → MANUAL_REVIEW_HR')
})
```

### 6.3 `computeDomesticCrossCheckFlags(profile, stageResults): DomesticCrossCheckFlag[]`

```
describe('computeDomesticCrossCheckFlags', () => {
  it('RED: подтвердил несуществующую TMS из ловушки')
  it('RED: заявил негабарит, не может назвать габариты → oversized_depth_risk')
  it('RED: заявил полный цикл рейса, не понимает документы')
  it('RED: принял невозможные условия задания без уточнений')
  it('ORANGE: ответы общие без маршрутов/цифр/документов')
  it('ORANGE: резюме сильное, тест по той же теме слабый')
  it('ORANGE: L-шкала ≥ 3 ответов "5"')
  it('ORANGE: remote_region_depth_risk — ответил только "искал машину"')
  it('ORANGE: cabotage_depth_risk — не назвал порт и процесс')
  it('нет флагов → пустой массив')
  it('2+ RED → impact содержит AUTO_REJECT')
})
```

### 6.4 `shouldAdmitToLiveInterview(score, flags): DomesticAdmissionVerdict`

```
describe('shouldAdmitToLiveInterview', () => {
  it('score=90, нет флагов → STRONG_CANDIDATE')
  it('score=75, нет флагов → ADMIT_TO_INTERVIEW')
  it('score=65 → MANUAL_EXCEPTION_ONLY')
  it('score=50 → REJECT')
  it('score=75, один RED → MANUAL_REVIEW_HR')
  it('score=75, два RED → AUTO_REJECT')
  it('score=90, три ORANGE → ADMIT_TO_INTERVIEW (не STRONG)')
  it('стоп-критерий → AUTO_REJECT независимо от балла')
})
```

### 6.5 `capacityGuard`

```
describe('capacityGuard', () => {
  it('canStart() = true если active < 3')
  it('canStart() = false если active >= 3')
  it('register() увеличивает счётчик')
  it('release() уменьшает счётчик')
  it('canStart() после release() снова true')
  it('getNextSlot() возвращает время если занято')
  it('max перекрывается env MAX_ACTIVE_AI_INTERVIEWS')
})
```

---

## 7. Файлы к созданию

```
backend/src/features/selection/
  domestic-specializations.ts       # типы + selectSpecializations
  domestic-scoring.ts               # scoreDomesticAssessment + shouldAdmitToLiveInterview
  domestic-cross-check.ts           # computeDomesticCrossCheckFlags
  capacity-guard.ts                 # capacityGuard
  domestic-specializations.test.ts
  domestic-scoring.test.ts
  domestic-cross-check.test.ts
  capacity-guard.test.ts

backend/prisma/migrations/YYYYMMDD_phase15a_domestic_profile/migration.sql
```

---

## 8. Definition of Done

- [ ] `selectSpecializations` — все тесты зелёные
- [ ] `scoreDomesticAssessment` — все тесты зелёные, включая перераспределение
- [ ] `computeDomesticCrossCheckFlags` — RED/ORANGE по всем сценариям
- [ ] `shouldAdmitToLiveInterview` — все пороговые случаи покрыты
- [ ] `capacityGuard` — лимиты и конфигурация через env
- [ ] Миграция применена, поля `assessment_profile` и `specializations` добавлены
- [ ] `bun test` на новых файлах: 0 ошибок
- [ ] `tsc -b` без ошибок
- [ ] Существующие тесты `logist` / `sales_manager` не сломаны

---

## 9. Технические требования

- [ ] `selectSpecializations` — регистронезависимо, без дублирования пакетов
- [ ] `scoreDomesticAssessment` — перераспределение весов при отсутствии вторичных специализаций
- [ ] `capacityGuard` — `MAX_ACTIVE_AI_INTERVIEWS`, `MAX_LLM_RPM`, `AI_RESPONSE_TIMEOUT_SEC` из env
- [ ] In-memory реализация `capacityGuard` достаточна для Phase 15a
- [ ] Phase 15b (AI-собеседование, UI, контент) — отдельный PR
