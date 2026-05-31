> **Phase:** 16 — HR Dashboard для logist_domestic
> **Depends on:** Phase 15 (domestic scoring, specializations, AI interview)

## 1. Цель
Расширить HR-дашборд для корректного отображения кандидатов с ролью `logist_domestic`:
специализации, разбивка баллов по модулям, domestic-вердикт, индивидуальный лист вопросов для рекрутера.

## 2. Что добавить в `SelectionItem`
- `specializations?: SpecializationAssignment[]` — из `assessment_sessions.specializations`
- `assessmentProfile?: { signals: string[], riskFlags: string[] }` — из `assessment_sessions.assessment_profile`

## 3. Что добавить в детальный просмотр VerdictDetail

### Для logist_domestic:
- Блок «Специализации» — список пакетов с уровнями (primary/secondary/mentioned_only)
- Блок «Разбивка баллов» — вместо `stageScores` показывать `resumeAndInterview`, `coreOperations`, `primarySpec`, `secondarySpec`, `practicalAssignment`, `communication`
- Блок «Domestic вердикт» — STRONG_CANDIDATE / ADMIT_TO_INTERVIEW / MANUAL_EXCEPTION_ONLY / REJECT / MANUAL_REVIEW_HR / AUTO_REJECT
- Блок «Вопросы для рекрутера» — генерировать на основе специализаций и флагов риска

### Вопросы для рекрутера (generateRecruiterQuestions):
Всегда включать:
1. «Назовите последний рейс который вы вели от заявки до закрывающих документов.»
2. «Что именно было вашей зоной ответственности?»

При наличии `oversized_depth_risk`:
3. «Назовите реальные габариты и вес негабаритного груза который вы перевозили.»
4. «Кто оформлял разрешения и как вы контролировали готовность?»

При наличии `remote_region_depth_risk`:
3. «Какие труднодоступные направления вы реально вели?»
4. «Как проверяли сезонность и доступность маршрута?»

При наличии `cabotage_depth_risk`:
3. «С какими портами и линиями вы реально работали?»
4. «Как организовывали вывоз из порта?»

## 4. Фильтр по роли
Добавить `logist_domestic` в фильтр ролей на дашборде.

## 5. Definition of Done
- [ ] `logist_domestic` кандидаты отображаются на дашборде
- [ ] Детальный просмотр показывает специализации и их уровни
- [ ] Разбивка баллов по модулям для domestic
- [ ] Блок вопросов для рекрутера генерируется на основе riskFlags
- [ ] TypeScript без новых ошибок
