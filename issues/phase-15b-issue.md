> **Phase:** 15b — Domestic Logist Stage Content + Routes Integration
> **Approach:** TDD-first
> **Depends on:** Phase 15a (domestic-specializations.ts, domestic-scoring.ts)
> **Full spec:** docs/selection-logist-domestic-packages.md

## 1. Цель
Реализовать контент вопросов для 7 пакетов domestic logist и подключить их к существующим routes. После Phase 15b кандидат с ролью `logist_domestic` получает персонализированный набор вопросов на основе своих специализаций.

## 2. Файлы к созданию
- `backend/src/features/selection/domestic-stage-content.ts` — контент вопросов по 7 пакетам
- `backend/src/features/selection/domestic-stage-content.test.ts` — TDD тесты

## 3. TDD-контракты

### getDomesticStageContent(packageId, stage): StageContent | null
- возвращает контент для stage=2 каждого из 7 пакетов
- для domestic_core_operations stage=1 возвращает анкету-скрининг
- для неизвестного packageId возвращает null
- каждый пакет stage=2 содержит > 0 вопросов
- у каждого radio-вопроса есть поле correct

### buildDomesticStages(specializations): StageContent[]
- принимает SpecializationAssignment[]
- возвращает массив этапов с объединёнными вопросами из primary пакетов
- всегда включает domestic_core_operations
- не дублирует вопросы при нескольких пакетах
- Stage 4 всегда присутствует (практическое задание из primary специализации)

## 4. Definition of Done
- [ ] domestic-stage-content.ts создан, все 7 пакетов покрыты
- [ ] bun test domestic-stage-content.test.ts: 0 ошибок
- [ ] tsc -b без ошибок
- [ ] Существующие тесты не сломаны
