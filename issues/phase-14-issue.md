> **AI Evaluator:** Gemini 2.0 Flash via `generativelanguage.googleapis.com`
> **Feature flag:** `ASSESSMENT_SYSTEM_ENABLED` (default: `false`)
> **Full question content:** [`issues/phase-14-assessment-system.md`](./phase-14-assessment-system.md) and `docs/assessment-system-design.md`

---

## 1. Цель

Реализовать систему автоматического отбора кандидатов **до первого живого интервью** для двух ролей: `logist` (Логист-экспедитор) и `sales_manager` (Менеджер по продажам ТЭУ). Кандидат проходит 4 этапа строго последовательно. После завершения BullMQ-очередь запускает AI-оценщик на базе **Gemini 2.0 Flash**, который выносит вердикт: **ДОПУСТИТЬ / ОТКЛОНИТЬ / НА РУЧНУЮ ПРОВЕРКУ HR**.

---

## 2. Архитектура

- **AI-оценщик:** Gemini 2.0 Flash via `fetch` → `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`, ключ из env `GEMINI_API_KEY`
- **Queue:** BullMQ job `assessment:evaluate` — после успешной отправки Этапа 4
- **Публичная страница кандидата:** token-based URL (без авторизации), серверный таймер Этапа 2 (`submitted_at - started_at <= 30min`)
- **Feature flag:** `ASSESSMENT_SYSTEM_ENABLED` (default `false`)

---

## 3. Схема данных

```sql
CREATE TABLE assessment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id UUID REFERENCES vacancies(id),
  role TEXT NOT NULL CHECK (role IN ('logist', 'sales_manager')),
  stages JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id),
  template_id UUID REFERENCES assessment_templates(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','stage_1','stage_2','stage_3','stage_4','completed','rejected','expired')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_stage_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES assessment_sessions(id),
  stage_number INT NOT NULL CHECK (stage_number IN (1,2,3,4)),
  answers JSONB NOT NULL,
  scores JSONB,
  flags JSONB,
  ai_evaluation JSONB,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assessment_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES assessment_sessions(id) UNIQUE,
  verdict TEXT NOT NULL CHECK (verdict IN ('ДОПУСТИТЬ','ОТКЛОНИТЬ','НА РУЧНУЮ ПРОВЕРКУ HR')),
  total_weighted_score NUMERIC(5,2),
  stage_scores JSONB,
  cross_check_flags JSONB,
  lie_scale_result JSONB,
  verdict_reason TEXT,
  hr_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**RLS:** кандидат — только своя сессия по токену; HR — все сессии своих вакансий; AI — service_role.

---

## 4. FSM сессии

```
pending
  └─→ stage_1
        └─→ stage_1_rejected (стоп-критерий) → КОНЕЦ
        └─→ stage_2
              └─→ stage_2_failed (< порога) → КОНЕЦ
              └─→ stage_3
                    └─→ stage_4
                          └─→ completed → [AI verdict]
```

Переход между этапами — максимум **24 часа**. Просрочка → `expired`.

---

## 5. Этапы

| Этап | Название | Время | Оценка |
|------|----------|-------|--------|
| 1 | Анкета-скрининг | Без лимита | Авто (стоп-критерии) |
| 2 | Профессиональный тест | **30 мин строго** | AI + автопроверка |
| 3 | Психологический тест | Без лимита | AI |
| 4 | Тестовое задание | 35–45 мин | AI (рубрика) |

---

## 6. Механизм антилжи (cross-check)

| # | Тип | Что проверяем |
|---|-----|---------------|
| 1 | 🔴 RED | Несуществующая TMS / методология — автоотказ |
| 2 | 🔴 RED | Несуществующий конкурент в анкете — автоотказ |
| 3 | 🔴 RED | Заявленный опыт не подтверждается тестом |
| 4 | 🔴 RED | Нет документов при заявленном международном опыте |
| 5 | 🟠 ORANGE | L-шкала психотеста: 3+ ответа «5» |
| 6 | 🟠 ORANGE | Устаревший Инкотермс FOR заявлен как рабочий |
| 7 | 🟠 ORANGE | Нештатка в анкете детальная, в тесте — примитивная |
| 8 | 🟠 ORANGE | Неравномерность частей тестового задания |

**Правило:** 2+ RED = автоотказ. 1 RED или 1–3 ORANGE = НА РУЧНУЮ ПРОВЕРКУ HR.

---

## 7. Весовая формула

`score = (E2/35)*40 + (E3/64)*20 + (E4/role_max)*40`

`role_max` = 25 (логист), 23 (менеджер продаж).

```typescript
interface AssessmentVerdict {
  candidate_id: string;
  role: string;
  verdict: 'ДОПУСТИТЬ' | 'ОТКЛОНИТЬ' | 'НА РУЧНУЮ ПРОВЕРКУ HR';
  total_weighted_score: number;
  stage_scores: { stage_2_score: number; stage_3_score: number; stage_4_score: number };
  cross_check_flags: { flag_id: number; type: 'RED' | 'ORANGE'; description: string; impact: string }[];
  lie_scale_result: { score_5_count: number; reliability: 'RELIABLE' | 'MODERATE_RISK' | 'UNRELIABLE' };
  verdict_reason: string;
  hr_notes: string;
}
```

---

## 8. API эндпоинты

```
POST   /api/assessments/sessions                 — создать сессию
GET    /api/assessments/sessions/:token          — текущий этап (кандидат)
POST   /api/assessments/sessions/:token/stage/:n — сдать этап
GET    /api/assessments/sessions/:id/verdict     — вердикт (HR)
GET    /api/assessments/admin                    — список сессий (HR dashboard)
```

---

## 9. AI-промпт оценщика

Вызов:
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}
```

Системный промпт (передавать как `system_instruction.parts[0].text`):

```
Ты — AI-оценщик системы подбора персонала Onboardix. Твоя задача: принять данные кандидата по всем 4 этапам отбора и выдать ЕДИНЫЙ ВЕРДИКТ: ДОПУСТИТЬ / ОТКЛОНИТЬ / НА РУЧНУЮ ПРОВЕРКУ HR.

## ВХОДНЫЕ ДАННЫЕ (JSON)
- candidate_id, role: "logist" | "sales_manager"
- stage_1: ответы анкеты, флаги стоп-критериев и ловушек
- stage_2: баллы профтеста, открытые ответы
- stage_3: баллы психотеста по блокам, L-шкала
- stage_4: текст тестового задания
- cross_check_flags: массив флагов несоответствий

## ВЕСА ЭТАПОВ
- Этап 1: бинарный фильтр
- Этап 2: 40%
- Этап 3: 20%
- Этап 4: 40%
Итоговый балл = (E2/E2_макс)*40 + (E3/E3_макс)*20 + (E4/E4_макс)*40

## ПРАВИЛА ВЕРДИКТА

ОТКЛОНИТЬ — если ХОТЯ БЫ ОДНО:
1. Стоп-критерий на Этапе 1 (зарплата, локация, опыт, формат).
2. Подтверждено знание несуществующего продукта/компании (RED ловушка).
3. Этап 2 < 22/35.
4. Этап 4 < 16/25 (логист) или < 15/23 (менеджер).
5. Взвешенный балл < 50%.
6. 2+ RED флага cross-check.

ДОПУСТИТЬ — если ВСЕ:
1. Нет стоп-критериев на Этапе 1.
2. Нет RED флагов.
3. Этап 2 ≥ 22.
4. Этап 4 ≥ порог роли.
5. Взвешенный балл ≥ 65%.
6. L-шкала: ≤ 1 ответа «5».

НА РУЧНУЮ ПРОВЕРКУ HR — все остальные случаи:
- 1 RED флаг без автоотказа.
- 1–3 ORANGE флага.
- Балл 50–64%.
- L-шкала: 2 ответа «5».
- Неравномерность результатов.

## АНАЛИЗ ОТКРЫТЫХ ОТВЕТОВ
1. Конкретность: цифры, названия, последовательность действий.
2. Профессиональная логика: соответствует ли отраслевой практике.
3. Соответствие заявленному опыту: 5 лет → нетривиальный ответ.
4. Работа с ловушками: заметил ли противоречия в задании.
5. Честность: признаёт ли ограничения или делает вид что всё понял.

## CROSS-CHECK ФЛАГИ
- RED: упомянуть в вердикте, применить правила автоотказа.
- ORANGE: описать несоответствие, снизить доверие на 20%, передать HR.
- Нет флагов: зафиксировать «Профиль без выявленных несоответствий».

## ФОРМАТ ВЫВОДА (строго JSON, без markdown)
{
  "candidate_id": "...",
  "role": "...",
  "verdict": "ДОПУСТИТЬ" | "ОТКЛОНИТЬ" | "НА РУЧНУЮ ПРОВЕРКУ HR",
  "total_weighted_score": 0-100,
  "stage_scores": {
    "stage_2_score": X, "stage_2_max": 35,
    "stage_3_score": X, "stage_3_max": 64,
    "stage_4_score": X, "stage_4_max": 25
  },
  "cross_check_flags": [{"flag_id": 1, "type": "RED"|"ORANGE", "description": "...", "impact": "..."}],
  "lie_scale_result": {"score_5_count": N, "reliability": "RELIABLE"|"MODERATE_RISK"|"UNRELIABLE"},
  "verdict_reason": "3–5 предложений: какие этапы прошёл/не прошёл, какие флаги сработали.",
  "hr_notes": "Что проверить на интервью или финальный комментарий."
}

## ОГРАНИЧЕНИЯ
- Вердикт всегда один из трёх. Никаких расплывчатых ответов.
- Не снижай стандарты из-за «дефицита кандидатов». Планка фиксирована.
- RED флаг = RED флаг. Не интерпретируй в пользу кандидата.
- При любом сомнении — НА РУЧНУЮ ПРОВЕРКУ HR, не ДОПУСТИТЬ.
- Фиксируй ВСЕ несоответствия, даже не повлиявшие на вердикт.
```

---

## 10. Контент вопросов

Полный контент (вопросы, варианты, правильные ответы, веса, рубрики, ловушки) для обеих ролей — в репозитории:

- **`issues/phase-14-assessment-system.md`** — полный issue (1556 строк)
- **`docs/assessment-system-design.md`** — оригинальный дизайн-документ (1381 строка)

Роли: `logist`, `sales_manager`
Структура: Этап 1 (10 вопросов + 3 ловушки), Этап 2 (15 вопросов с весами), Этап 3 (20 утверждений + L-шкала), Этап 4 (практическое задание + рубрика).

---

## 11. UI

**Кандидат (публичная страница по токену):**
- Без авторизации, одноразовая ссылка из email
- Прогресс-бар: ●●○○
- Этап 2: countdown таймер, нельзя вернуться к предыдущему вопросу
- Финал: «Спасибо, ваши ответы переданы на рассмотрение»

**HR-панель:**
- Список: вердикт + балл + флаги
- Детальный просмотр: все ответы + hr_notes от AI
- Кнопки: «→ Интервью» / «Отклонить» / «Запросить доп. информацию»
- Фильтры: по вердикту, роли, вакансии

---

## 12. Definition of Done

- [ ] Миграции применены, RLS настроен
- [ ] FSM: кандидат проходит 4 этапа строго последовательно
- [ ] Ловушки рандомизируются из пула 5–7 вариантов, выбор хранится в `assessment_stage_results.flags`
- [ ] Таймер Этапа 2 валидируется на сервере (`submitted_at - started_at <= 30min`)
- [ ] AI-оценщик вызывается после Этапа 4, вердикт в `assessment_verdicts`
- [ ] Cross-check флаги вычисляются и передаются AI
- [ ] HR-дашборд: список с вердиктами и флагами
- [ ] Feature flag отключает систему в prod
- [ ] E2E тест: полный прогон → вердикт ДОПУСТИТЬ
- [ ] E2E тест: RED ловушка → автоотказ без вызова AI
- [ ] Gemini 2.0 Flash вызывается через `fetch` на `generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- [ ] `GEMINI_API_KEY` добавлен в `.env.example` и `docker-compose.prod.yml`
- [ ] HH.ru callback: `/api/hh/callback` — OAuth2 code exchange → store access_token per tenant

---

## 13. Технические требования

- [ ] Таймер Этапа 2 на сервере: `submitted_at - started_at <= 30min`
- [ ] Кандидат не может вернуться к предыдущему вопросу в Этапе 2
- [ ] Ответы Этапа 1 передаются AI при оценке Этапов 2–4 для cross-check
- [ ] Feature flag: `ASSESSMENT_SYSTEM_ENABLED` (default `false`)
- [ ] Просрочка 24h между этапами → `expired`
- [ ] Первые 50 кандидатов — параллельная оценка с HR для калибровки весов
- [ ] Ловушки обновлять каждые 6 месяцев
