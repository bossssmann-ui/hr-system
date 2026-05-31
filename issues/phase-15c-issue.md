> **Phase:** 15c — Domestic Logist AI Interview + Resume Parsing
> **Approach:** TDD-first
> **Depends on:** Phase 15b (selection-role-adapter.ts, domestic-stage-content.ts)
> **Full spec:** `docs/selection-logist-domestic-packages.md`

---

## 1. Цель

Добавить два подготовительных шага перед основным тестированием для роли `logist_domestic`:

1. **Разбор резюме** — кандидат вставляет текст резюме, Gemini извлекает сигналы (виды транспорта, тип груза, география, системы), система назначает пакеты специализаций.
2. **AI-собеседование** — кандидат отвечает на 6–10 динамических вопросов (async форма, не live-chat). Gemini классифицирует глубину опыта, обновляет специализации и ставит флаги риска.

После этих двух шагов `buildStagesForRole('logist_domestic', { specializations })` получает финальный список специализаций и собирает персонализированный тест.

---

## 2. Новые FSM-статусы

```
pending
  └─→ resume_parsed       (резюме разобрано, черновые специализации назначены)
        └─→ ai_interview   (AI-собеседование начато)
              └─→ packages_assigned  (специализации финализированы)
                    └─→ stage_1 → stage_2 → stage_3 → stage_4 → completed
```

Существующий поток `logist` / `sales_manager` не меняется (сразу `pending → stage_1`).

---

## 3. Новые API-эндпоинты

```
POST /api/selection/sessions/:token/resume
  body: { resumeText: string }
  → извлекает сигналы через Gemini, назначает специализации,
    переводит сессию в resume_parsed, возвращает { signals, specializations }

GET  /api/selection/sessions/:token/interview
  → возвращает список вопросов AI-собеседования для текущих специализаций

POST /api/selection/sessions/:token/interview
  body: { answers: Record<string, string> }
  → Gemini классифицирует ответы, обновляет специализации и riskFlags,
    переводит сессию в packages_assigned, возвращает { specializations, riskFlags }
```

---

## 4. TypeScript-интерфейсы

```typescript
// domestic-resume-parser.ts
export interface ResumeParseResult {
  signals: string[]
  rawText: string
  geminiRaw?: unknown
}

export async function parseResume(
  resumeText: string,
  apiKey: string,
  fetchImpl?: typeof fetch
): Promise<ResumeParseResult>

// domestic-interview.ts
export interface InterviewQuestion {
  key: string
  text: string
  type: 'textarea'
  hint?: string
}

export interface InterviewClassification {
  specializations: SpecializationAssignment[]
  riskFlags: string[]
  geminiRaw?: unknown
}

export function buildInterviewQuestions(
  specializations: SpecializationAssignment[]
): InterviewQuestion[]

export async function classifyInterviewAnswers(
  specializations: SpecializationAssignment[],
  answers: Record<string, string>,
  apiKey: string,
  fetchImpl?: typeof fetch
): Promise<InterviewClassification>
```

---

## 5. TDD-контракты

### 5.1 `parseResume`

```
describe('parseResume', () => {
  it('извлекает сигнал "FTL" из текста с "FTL-перевозки"')
  it('извлекает сигнал "негабарит" из текста с "негабаритных грузов"')
  it('извлекает сигнал "Якутия" из текста с "Якутия"')
  it('извлекает сигнал "ЖД" из текста с "железнодорожные перевозки"')
  it('возвращает пустой массив signals для пустого резюме')
  it('вызывает Gemini API с ключом apiKey')
  it('использует переданный fetchImpl (mock) вместо глобального fetch')
  it('при ошибке Gemini выбрасывает GeminiApiError')
})
```

### 5.2 `buildInterviewQuestions`

```
describe('buildInterviewQuestions', () => {
  it('всегда включает 6 базовых вопросов domestic_core_operations')
  it('добавляет вопросы по oversized при наличии этого пакета')
  it('добавляет вопросы по remote_regions при наличии этого пакета')
  it('добавляет вопросы по cabotage при наличии этого пакета')
  it('не дублирует вопросы при нескольких пакетах')
  it('все вопросы имеют уникальный key')
  it('тип всех вопросов = textarea')
})
```

### 5.3 `classifyInterviewAnswers`

```
describe('classifyInterviewAnswers', () => {
  it('возвращает specializations и riskFlags')
  it('ставит oversized_depth_risk если ответ на oversized-вопрос пустой')
  it('повышает уровень до primary если ответ детальный (mock Gemini)')
  it('использует переданный fetchImpl (mock)')
  it('при ошибке Gemini возвращает исходные specializations без изменений')
})
```

---

## 6. Реализация `parseResume` — Gemini промпт

Системная инструкция:
```
Ты — парсер резюме логиста. Извлеки сигналы специализации из текста резюме.
Верни JSON-массив строк — только ключевые термины из этого списка:
FTL, LTL, сборные, ATI, генгруз, развозка, маршруты, "окна доставки", SLA,
ЖД, контейнер, станция, терминал, ЭТРАН, негабарит, тяжеловес, трал,
Север, Якутия, Камчатка, Чукотка, зимник, переправа, каботаж, Сахалин, Магадан.
Только термины которые ЯВНО упомянуты в резюме. Формат: ["сигнал1", "сигнал2"].
```

### Реализация `classifyInterviewAnswers` — Gemini промпт

Системная инструкция:
```
Ты — оценщик глубины опыта логиста. Проанализируй ответы кандидата на вопросы AI-собеседования.
Для каждой специализации определи уровень: primary / secondary / mentioned_only / contradicted.
Поставь флаги риска: oversized_depth_risk, remote_region_depth_risk, cabotage_depth_risk —
если кандидат заявил специализацию но не смог объяснить базовую последовательность действий.
Верни JSON: { "specializations": [...], "riskFlags": [...] }
```

---

## 7. Файлы к созданию

```
backend/src/features/selection/
  domestic-resume-parser.ts
  domestic-resume-parser.test.ts
  domestic-interview.ts
  domestic-interview.test.ts

# Изменить:
  selection.routes.ts  — добавить 3 новых эндпоинта, FSM-переходы
```

---

## 8. Definition of Done

- [ ] `parseResume` — тесты с mock fetch зелёные
- [ ] `buildInterviewQuestions` — все тесты зелёные
- [ ] `classifyInterviewAnswers` — тесты с mock fetch зелёные
- [ ] Эндпоинт `POST /resume` переводит сессию в `resume_parsed`
- [ ] Эндпоинт `GET/POST /interview` работает только для `logist_domestic`
- [ ] Для `logist` / `sales_manager` новые эндпоинты возвращают 404
- [ ] `capacityGuard.register()` вызывается перед AI-собеседованием
- [ ] `capacityGuard.release()` вызывается после завершения
- [ ] `bun test` — все тесты зелёные
- [ ] `tsc -b` без новых ошибок

---

## 9. Технические требования

- [ ] `parseResume` и `classifyInterviewAnswers` принимают `fetchImpl` для тестирования без реального Gemini
- [ ] При ошибке Gemini в `classifyInterviewAnswers` — graceful fallback (исходные специализации), не сломать сессию
- [ ] AI-собеседование работает как async форма (не live-chat): кандидат отвечает на все вопросы сразу
- [ ] Вопросы AI-собеседования не хранятся в БД отдельно — генерируются на лету из специализаций
- [ ] Phase 15d (UI кандидата для domestic flow) — отдельный PR
