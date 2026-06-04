# Phase 18 — Авто-конвейер кандидата от HH до найма: ИИ-интервью, тесты, сводный балл, нотификации

## Контекст

Сегодня поток «отклик с HH → решение по кандидату» работает только до точки `Application(stage='new') + aiScoring.result` на карточке. Всё, что есть в системе для последующих шагов (selection-сессии с ИИ-интервью, assessment-тесты, trust-score, retention-prediction), **существует автономно и запускается только вручную рекрутером**. Это противоречит ожидаемому поведению «ИИ ведёт кандидата по этапам сам, рекрутер подключается к финальному решению».

Цель фазы — **склеить уже существующие куски в единый конвейер**, не переписывая их, и закрыть четыре конкретные недоделки.

## Текущее состояние (что уже работает и можно переиспользовать)

- HH ingest: `backend/src/integrations/hh/sync.ts` (`syncHhNegotiationsForTenant`, `upsertNegotiationFromHh`), вебхук `backend/src/integrations/status/routes.ts`.
- ИИ-скоринг резюме: `backend/src/features/scoring/{scoring.queue.ts,scoring.service.ts}` — пишет `Application.aiScoring`.
- Selection-сессии (4 стадии, ловушки, кросс-чек, авто-скоринг, retention): `backend/src/features/selection/*` — создаются только через `POST /api/selection/sessions` (`selection.routes.ts:105`).
- Assessments (тесты + trust-score + авто-оценка открытых ответов): `backend/src/features/assessments/*`.
- Канал доставки ссылок кандидату: `backend/src/integrations/messaging/{hh-chat,email,telegram}.channel.ts`, сервис `messaging.service.ts`.
- Уведомления внутри системы: `prisma.notification` + SSE (Phase 10).

## Недоделки, которые закрываем в этой фазе

### 1. Авто-создание selection-сессии после ИИ-скоринга резюме

**Сейчас:** `scoreApplication` пишет `aiScoring={status:'scored', result}` и на этом останавливается. Selection-сессия не создаётся.

**Надо:**
- После успешного скоринга, если `result.relevance_score >= AUTO_SELECTION_THRESHOLD` и у вакансии задана `role` (`logist | sales_manager | logist_domestic`), идемпотентно создать `SelectionSession` с привязкой `applicationId` и шаблоном на (vacancyId, role) — переиспользовать логику `selection.routes.ts:115-143`, вынеся её в `selection.service.ts#createSelectionSessionForApplication`.
- Идемпотентность: если для `applicationId` уже есть `SelectionSession.status != 'rejected'`, повторно не создавать.
- Если `relevance_score < AUTO_REJECT_THRESHOLD` — не создавать сессию, перевести `Application.stage = 'rejected'` с причиной `auto_reject_low_relevance` и записать `AuditEvent('application.auto_rejected')`.
- Между порогами — оставить карточку в `new`, дать рекрутеру решить вручную.
- Конфигурация порогов через env (`AUTO_SELECTION_THRESHOLD`, `AUTO_REJECT_THRESHOLD`, дефолты — задизейблить фичу: `AUTO_SELECTION_ENABLED=false`).
- Ссылку `/selection/<token>` отправить кандидату через первый доступный канал (HH-chat для откликов с HH, иначе email из `Candidate.email`) — переиспользовать `messaging.service.ts#sendOutboundMessage`.

**Acceptance:**
- Интеграционный тест: создаём Application с `vacancy.role='logist_domestic'`, скоринг возвращает `relevance_score=80` → появляется `SelectionSession.applicationId == application.id`, в `Message` есть исходящее сообщение с ссылкой на сессию.
- Повторный вызов скоринга не создаёт вторую сессию.
- При `AUTO_SELECTION_ENABLED=false` поведение не меняется (текущий ручной флоу остаётся).

---

### 2. Авто-назначение assessment после прохождения selection-сессии (или в параллель — по типу вакансии)

**Сейчас:** assessment-сессии создаются только вручную из админки.

**Надо:**
- Описать в `Vacancy` (или в `SelectionTemplate`) поле `requiredAssessmentTemplateIds: string[]`.
- На событии `selection_session.completed` со статусом «прошёл» — идемпотентно создать `AssessmentSession` для каждого из требуемых шаблонов и отправить кандидату ссылку через тот же канал, что и selection.
- Если у роли нет `requiredAssessmentTemplateIds` — шаг пропускается, не блокирует.
- В админке вакансии добавить поле выбора assessment-шаблонов (web).

**Acceptance:**
- Интеграционный тест: завершаем selection-сессию с verdict='pass' для вакансии с двумя assessment-шаблонами → создаются ровно 2 `AssessmentSession`, отправлено ровно 2 ссылки кандидату.
- Повторный вызов не дублирует.

---

### 3. Сводный балл кандидата на карточке отклика («единое досье»)

**Сейчас:** баллы разбросаны:
- `Application.aiScoring.result.relevance_score` (резюме),
- `SelectionSession.<stage>Score` (стадии selection),
- `AssessmentSession.score` + `trustScore` (тесты),
- `retentionPrediction` (прогноз удержания).

**Надо:**
- Добавить view-модель/derived-поле `Application.compositeScore` со структурой:
  ```
  {
    overall: number,            // взвешенная сумма, 0..100
    breakdown: {
      resume: number | null,
      selection: { stage1, stage2, stage3, stage4, total } | null,
      assessment: { score, trust } | null,
      retention: number | null
    },
    weights: {...},             // фактические веса, использованные при расчёте
    updatedAt
  }
  ```
- Веса — конфигурируемые на тенант (`TenantSettings.scoringWeights`), с разумными дефолтами.
- Пересчёт композита — на каждом из событий: `application.ai_scored`, `selection_session.stage_completed`, `selection_session.completed`, `assessment_session.completed`. Идемпотентно, в той же транзакции, что и событие.
- Композит выводить на карточке в Kanban (`web/src/pages/recruiting.tsx`) и в детальной карточке кандидата: одна цифра + раскрывающийся breakdown.
- Контракты в `packages/contracts/src/applications.ts`.

**Acceptance:**
- Unit-тесты на `computeCompositeScore` (граничные значения, отсутствующие компоненты, разные веса).
- Интеграционный тест: проходим путь резюме → selection → assessment, на каждом шаге `compositeScore.overall` пересчитан.
- В UI на карточке отклика виден композитный балл и breakdown.

---

### 4. Активные нотификации рекрутеру

**Сейчас:** `upsertNegotiationFromHh` пишет аудит, но `prisma.notification` не создаёт. Рекрутер узнаёт о новых откликах только если сам зашёл на доску.

**Надо:**
- На событиях:
  - `hh.sync.candidate_imported` — создать `Notification(type='application.new', recipientUserId=<assignee рекрутер вакансии или fallback hr_admin тенанта>)`;
  - `application.auto_rejected` — `type='application.auto_rejected'` (тихая, для аудита);
  - `selection_session.completed` (pass/fail) — `type='selection.completed'`;
  - `assessment_session.completed` — `type='assessment.completed'`.
- Доставка: внутренний инбокс (Phase 10 SSE уже есть), плюс push (Phase 11 device tokens) для рекрутера, если включён `PUSH_NOTIFICATIONS_ENABLED`.
- Ссылка из нотификации — на карточку отклика.

**Acceptance:**
- Интеграционный тест: импортируем 1 отклик с HH → у рекрутера, назначенного на вакансию, появляется ровно 1 `Notification(type='application.new')`. Если рекрутер не назначен — нотификация уходит всем `hr_admin` тенанта.
- E2E (web): рекрутер видит badge на иконке инбокса в реальном времени.

---

## Не входит в эту фазу (out of scope)

- Авто-продвижение кандидата по канбану дальше `screen` после assessment — решение по-прежнему за рекрутером.
- Изменения в самих ИИ-промптах селекшна / скоринга.
- Новые роли selection (только `logist`, `sales_manager`, `logist_domestic`).
- Изменение HH-ingest: pull-модель и вебхук остаются как есть.

## Feature flags

Все четыре пункта — за флагами, чтобы можно было катать постадийно:
- `AUTO_SELECTION_ENABLED` (default `false`)
- `AUTO_ASSESSMENT_ENABLED` (default `false`)
- `COMPOSITE_SCORE_ENABLED` (default `false`)
- `RECRUITER_NOTIFICATIONS_ENABLED` (default `false`)

Включение в проде — после интеграционных тестов и ручной проверки на staging тенанте.

## Контракты и миграции

- `packages/contracts/src/applications.ts`: добавить `compositeScore` в DTO.
- `packages/contracts/src/vacancies.ts`: `requiredAssessmentTemplateIds`.
- Prisma миграция: `Application.compositeScore Json?`, `Vacancy.requiredAssessmentTemplateIds String[]`, `TenantSettings.scoringWeights Json?`.

## Тесты

- `bun run typecheck` (все пакеты) — green.
- `bun run --filter '@web-app-demo/backend' test` — все интеграционные кейсы из Acceptance выше.
- `web` Playwright: один happy-path E2E на новом тенанте: HH-импорт mock → авто-selection → авто-assessment → нотификация → карточка с композитным баллом.

## Документация

Обновить `docs/contracts/00-overview.md` (карта потоков) и `docs/contracts/10-data-model.md` (новые поля) в **этом же** PR — это требование `docs/contracts/50-coding-standards.md`.

## Чек-лист PR (можно резать на отдельные PR в указанном порядке)

- [ ] PR 1: feature flags + контракты + миграции (без логики).
- [ ] PR 2: `selection.service.ts#createSelectionSessionForApplication` + хук в `scoreApplication`.
- [ ] PR 3: авто-assessment по завершению selection-сессии.
- [ ] PR 4: `compositeScore` + UI на карточке.
- [ ] PR 5: нотификации рекрутеру + SSE/push.
- [ ] PR 6: docs + E2E happy-path.
