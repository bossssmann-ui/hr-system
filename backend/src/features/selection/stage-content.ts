/**
 * Phase 14b — Selection assessment question content.
 *
 * Single source of truth for the candidate-facing question content of the
 * 4-stage Onboardix screening (logist + sales_manager). The content is
 * static and lives only here — frontend reads it via the existing
 * `GET /api/selection/sessions/:token` endpoint, and the AI evaluator
 * receives the recorded answers via `selection.queue.ts`.
 *
 * Reference: issues/phase-14-assessment-system.md, docs/assessment-system-design.md
 */

export type Role = 'logist' | 'sales_manager'

export type QuestionType =
  | 'number'
  | 'radio'
  | 'checkbox'
  | 'textarea'
  | 'scale' // 1..5 Likert (Stage 3)

export interface BaseQuestion {
  key: string
  text: string
  type: QuestionType
  options?: string[]
  block?: string
  /** Correct answer key for radio questions in Stage 2 (auto-scoring). */
  correct?: string
  /** Question weight (Stage 2 scoring). */
  weight?: number
}

export interface StageContentBase {
  stage: number
  title: string
  timeLimitMin: number | null
}

export interface QuestionnaireStageContent extends StageContentBase {
  type: 'questionnaire'
  questions: BaseQuestion[]
}

export interface TestStageContent extends StageContentBase {
  type: 'test'
  questions: BaseQuestion[]
  maxScore: number
  passThreshold: number
}

export interface PsychologyStageContent extends StageContentBase {
  type: 'psychology'
  questions: BaseQuestion[]
  scale: { min: number; max: number; labels: string[] }
}

export interface AssignmentStageContent extends StageContentBase {
  type: 'assignment'
  description: string
  timeEstimate: string
  answerKey: string
  traps: Array<{ id: number; description: string }>
}

export type StageContent =
  | QuestionnaireStageContent
  | TestStageContent
  | PsychologyStageContent
  | AssignmentStageContent

// ─── Stage 3 — shared L-scale & scale labels ─────────────────────────────────

const SCALE_LABELS = [
  'Совершенно не согласен',
  'Скорее не согласен',
  'Затрудняюсь ответить',
  'Скорее согласен',
  'Полностью согласен',
]

const L_SCALE_QUESTIONS: BaseQuestion[] = [
  { key: 'q13', text: 'Я всегда выполняю обещания точно в срок', type: 'scale', block: 'L' },
  { key: 'q14', text: 'Я никогда не делал ошибок в документах', type: 'scale', block: 'L' },
  { key: 'q15', text: 'Я всегда полностью доволен своей работой', type: 'scale', block: 'L' },
  { key: 'q16', text: 'Я никогда не испытывал раздражения на коллег', type: 'scale', block: 'L' },
  { key: 'q17', text: 'Я всегда выполняю все задачи идеально с первого раза', type: 'scale', block: 'L' },
  { key: 'q18', text: 'Я никогда не опаздывал ни на одну встречу', type: 'scale', block: 'L' },
  { key: 'q19', text: 'Я никогда не сомневался в правильности своих решений', type: 'scale', block: 'L' },
  { key: 'q20', text: 'Я всегда доволен результатами своей работы без исключений', type: 'scale', block: 'L' },
]

// ─── LOGIST ──────────────────────────────────────────────────────────────────

const LOGIST_STAGE_1: QuestionnaireStageContent = {
  stage: 1,
  type: 'questionnaire',
  title: 'Анкета-скрининг (Логист-экспедитор)',
  timeLimitMin: null,
  questions: [
    {
      key: 'stop_experience',
      text: 'Сколько лет в транспортной логистике?',
      type: 'radio',
      options: ['Менее 1 года', '1–2 года', '3–5 лет', 'Более 5 лет'],
    },
    {
      key: 'q_formats',
      text: 'Форматы перевозок с практическим опытом',
      type: 'checkbox',
      options: [
        'Авто (FTL/LTL) Китай–Россия',
        'Ж/д (контейнер, погранпереходы)',
        'Море (FCL/LCL) из портов Китая',
        'Мультимодаль (море+ж/д+авто)',
        'Таможенное оформление (импорт ЕАЭС)',
        'Транзит через Казахстан (Достык–Алашанькоу)',
        'Транзит через Монголию (Наушки–Эрлянь)',
      ],
    },
    {
      key: 'q_customs',
      text: 'Опыт таможенного оформления',
      type: 'radio',
      options: ['Самостоятельно оформлял', 'Координировал брокера', 'Не работал'],
    },
    {
      key: 'q_docs',
      text: 'Транспортные документы, с которыми работали',
      type: 'checkbox',
      options: [
        'Накладная СМГС',
        'Коносамент (B/L)',
        'Авианакладная AWB',
        'CMR (доставка по РФ/ЕАЭС)',
        'TIR Carnet (МДП)',
        'Декларация на товары (ДТ)',
        'Ни с одним',
      ],
    },
    {
      // Guidance for AI/HR review:
      // - Сильный ответ взвешивает маршрут через Монголию и Сибирь (короче, но сложнее дороги/граница),
      //   через Казахстан (стабильнее инфраструктура, но обычно +3–5 дней), через Владивосток с
      //   перегрузкой на ж/д (+7–10 дней, но ниже риск повреждения) и через порты Южной Кореи с
      //   паромом до Владивостока (самый долгий, но самый безопасный вариант).
      // - Дополнительный плюс, если кандидат проговаривает санкционные и пограничные риски:
      //   попытка ускорить маршрут через Казахстан может, наоборот, затянуть сроки, поэтому такие
      //   компромиссы нужно отдельно согласовывать с клиентом.
      key: 'q_route_choice',
      text:
        'Выбор оптимального маршрута\n\nКакой маршрут вы предпочтёте для перевозки негабаритного груза из Шанхая в Москву автотранспортом, если приоритет — минимизация сроков при сохранении разумной стоимости?',
      type: 'textarea',
    },
    {
      key: 'q_emergency',
      text: 'Опишите нештатную ситуацию и как её решили',
      type: 'textarea',
    },
    {
      key: 'q_salary_bonus',
      text: 'Желаемая структура дохода',
      type: 'radio',
      options: ['Только оклад', 'Оклад + KPI', 'Оклад + %', 'Любой'],
    },
  ],
}

const LOGIST_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест (Логист-экспедитор)',
  timeLimitMin: 30,
  maxScore: 37,
  passThreshold: 23,
  questions: [
    {
      key: 'q1',
      text: 'Инкотермс 2020: при условии EXW ответственность покупателя начинается...',
      type: 'radio',
      options: [
        'С момента передачи товара перевозчику',
        'С момента прохождения таможни',
        'С момента получения на складе продавца',
        'С момента выгрузки в порту назначения',
      ],
      correct: 'С момента получения на складе продавца',
      weight: 3,
    },
    {
      key: 'q2',
      text: 'CMR-накладная используется для...',
      type: 'radio',
      options: [
        'Авиаперевозок',
        'Автомобильных международных перевозок',
        'Морских контейнерных перевозок',
        'Внутрироссийских перевозок',
      ],
      correct: 'Автомобильных международных перевозок',
      weight: 2,
    },
    {
      key: 'q3',
      text: 'Что верно для ж/д маршрутов Китай→Россия (включая Достык–Алашанькоу)?',
      type: 'radio',
      options: [
        'Колея единая, перегруз не требуется',
        'Из-за разной колеи (1435/1520) на стыке обычно требуется перегруз/смена тележек',
        'Перегруз нужен только для опасных грузов',
        'На границе всегда оформляется только коносамент',
      ],
      correct: 'Из-за разной колеи (1435/1520) на стыке обычно требуется перегруз/смена тележек',
      weight: 3,
    },
    {
      key: 'q4',
      text: 'LTL означает...',
      type: 'radio',
      options: [
        'Полная загрузка фуры',
        'Сборная загрузка',
        'Морской контейнер',
        'Авиагрузовой терминал',
      ],
      correct: 'Сборная загрузка',
      weight: 1,
    },
    {
      key: 'q5',
      text: 'При перевозке опасного груза класса 3 (легковоспламеняющиеся жидкости) обязателен...',
      type: 'radio',
      options: [
        'Сертификат ISO',
        'Разрешение ДОПОГ/ADR',
        'Карнет TIR',
        'Сертификат EUR.1',
      ],
      correct: 'Разрешение ДОПОГ/ADR',
      weight: 3,
    },
    {
      key: 'q6',
      text: 'Открытый вопрос: груз из Китая остановлен на импортном оформлении из-за ошибки в коде ТН ВЭД ЕАЭС. Ваши действия?',
      type: 'textarea',
      weight: 4,
    },
    {
      key: 'q7',
      text: 'Базовый документ для расчёта ЖД-тарифов по РФ — это:',
      type: 'radio',
      options: [
        'Прейскурант 10-01 РЖД',
        'Только тарифы морских линий',
        'CMR-тарифы',
        'Единый тариф ICC по Инкотермс',
      ],
      correct: 'Прейскурант 10-01 РЖД',
      weight: 3,
    },
    {
      key: 'q8',
      text: 'TIR-карнет применяется при...',
      type: 'radio',
      options: [
        'Авиаперевозках',
        'Международных автоперевозках через страны-участницы конвенции TIR',
        'Морских перевозках',
        'Ж/д перевозках внутри СНГ',
      ],
      correct: 'Международных автоперевозках через страны-участницы конвенции TIR',
      weight: 2,
    },
    {
      key: 'q9',
      text: 'Ставка таможенной пошлины применяется к...',
      type: 'radio',
      options: [
        'Весу брутто',
        'Таможенной стоимости (CIF)',
        'Весу нетто',
        'Стоимости FOB',
      ],
      correct: 'Таможенной стоимости (CIF)',
      weight: 2,
    },
    {
      key: 'q10',
      text: 'Для контейнерных поставок из Китая корректнее использовать условия:',
      type: 'radio',
      options: [
        'FOB/CIF во всех случаях',
        'Только EXW',
        'FCA/CPT/CIP (в зависимости от распределения рисков и плеч)',
        'Только DDP',
      ],
      correct: 'FCA/CPT/CIP (в зависимости от распределения рисков и плеч)',
      weight: 1,
    },
    {
      key: 'q11',
      text: 'Открытый вопрос: опишите процесс организации импорта Китай→РФ через погранпереход (например, Забайкальск–Маньчжурия) с выпуском ДТ.',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'q12',
      text: 'Коносамент (B/L) — это документ для...',
      type: 'radio',
      options: ['Авиаперевозок', 'Морских перевозок', 'Автоперевозок', 'Ж/д перевозок'],
      correct: 'Морских перевозок',
      weight: 1,
    },
    {
      key: 'q13',
      text: 'Демередж — это...',
      type: 'radio',
      options: [
        'Штраф за простой контейнера сверх нормы',
        'Страховка груза',
        'Таможенная пошлина',
        'Стоимость фрахта',
      ],
      correct: 'Штраф за простой контейнера сверх нормы',
      weight: 2,
    },
    {
      key: 'q14',
      text: 'Открытый вопрос: при импорте из Китая выяснилось, что для товара требуется сертификация/декларация соответствия ЕАЭС, а документы не готовы. Ваши действия?',
      type: 'textarea',
      weight: 4,
    },
    {
      key: 'q15',
      text: 'При импорте из Китая в ЕАЭС сертификат/декларация соответствия обычно нужны для:',
      type: 'radio',
      options: [
        'Подтверждения выполнения обязательных требований техрегламентов для ввоза/обращения',
        'Оформления авианакладной AWB',
        'Получения TIR Carnet',
        'Замены инвойса',
      ],
      correct: 'Подтверждения выполнения обязательных требований техрегламентов для ввоза/обращения',
      weight: 1,
    },
  ],
}

const LOGIST_STAGE_3: PsychologyStageContent = {
  stage: 3,
  type: 'psychology',
  title: 'Психологический тест (Логист-экспедитор)',
  timeLimitMin: null,
  scale: { min: 1, max: 5, labels: SCALE_LABELS },
  questions: [
    { key: 'q1', text: 'Я всегда нахожу выход, даже в условиях жёсткого дедлайна', type: 'scale', block: 'A' },
    { key: 'q2', text: 'Когда что-то идёт не по плану, я сразу ищу решение, а не виноватых', type: 'scale', block: 'A' },
    { key: 'q3', text: 'Я легко переключаюсь между задачами без потери качества', type: 'scale', block: 'A' },
    { key: 'q4', text: 'Я предпочитаю сначала разобраться в деталях, а потом действовать', type: 'scale', block: 'B' },
    { key: 'q5', text: 'Я всегда документирую договорённости письменно', type: 'scale', block: 'B' },
    { key: 'q6', text: 'Я замечаю ошибки в документах, которые другие пропускают', type: 'scale', block: 'B' },
    { key: 'q7', text: 'Мне комфортно работать с множеством поставщиков одновременно', type: 'scale', block: 'C' },
    { key: 'q8', text: 'Я умею отстаивать интересы компании, не разрушая отношения с партнёром', type: 'scale', block: 'C' },
    { key: 'q9', text: 'Я легко нахожу общий язык с людьми разных культур', type: 'scale', block: 'C' },
    { key: 'q10', text: 'Ответственность за результат — это прежде всего моя ответственность', type: 'scale', block: 'D' },
    { key: 'q11', text: 'Я готов сообщить о проблеме руководителю раньше, чем она станет критической', type: 'scale', block: 'D' },
    { key: 'q12', text: 'Я никогда не перекладываю вину за свои ошибки на обстоятельства', type: 'scale', block: 'D' },
    ...L_SCALE_QUESTIONS,
  ],
}

const LOGIST_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: организация срочной отгрузки',
  timeLimitMin: 45,
  timeEstimate: '35–45 минут',
  description:
    'Вы — логист-экспедитор. Клиенту нужен регулярный импорт из Китая (Гуанчжоу/Шэньчжэнь → РФ): сравнить два маршрута и дать обоснованное КП по цене/срокам.\n\nМаршруты:\n1) Ж/д через погранпереход (например, Забайкальск–Маньчжурия);\n2) Море из порта Китая + ж/д/авто до склада в РФ.\n\nЗадание: предложите оптимальный вариант(ы), ориентир по стоимости и срокам, перечень документов и рисков. Отдельно опишите, как будете действовать при задержках на границе/терминале.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат учитывает разрыв колеи 1435/1520 и влияние перегруза на срок' },
    { id: 2, description: 'Кандидат указывает необходимость сертификата/декларации соответствия ЕАЭС для ввоза' },
    { id: 3, description: 'Кандидат учитывает необходимость перевода инвойса с китайского для оформления' },
  ],
}

// ─── SALES MANAGER ───────────────────────────────────────────────────────────

const SALES_STAGE_1: QuestionnaireStageContent = {
  stage: 1,
  type: 'questionnaire',
  title: 'Анкета-скрининг (Менеджер по продажам ТЭУ)',
  timeLimitMin: null,
  questions: [
    {
      key: 'stop_experience',
      text: 'Опыт активных продаж в транспортной логистике',
      type: 'radio',
      options: ['Нет опыта', 'До 1 года', '1–3 года', 'Более 3 лет'],
    },
    {
      key: 'q_segments',
      text: 'С какими сегментами клиентов работали?',
      type: 'checkbox',
      options: ['Производители', 'Ритейл', 'FMCG', 'Сырьё/металлы', 'Стройматериалы', 'Другое'],
    },
    {
      key: 'q_remote_ready',
      text: 'Готовность работать полностью удалённо (без обязательных командировок)',
      type: 'radio',
      options: ['Да, комфортно работать удалённо', 'Требуется офис/гибрид'],
    },
    {
      key: 'q_cycle',
      text: 'Средняя длина цикла сделки в вашем опыте',
      type: 'radio',
      options: ['До 1 недели', '1–4 недели', '1–3 месяца', 'Более 3 месяцев'],
    },
    {
      key: 'trap_answer_1',
      text: 'При контейнерных поставках из Китая всегда корректно работать на FOB — верно?',
      type: 'radio',
      options: [
        'Да, FOB универсален для контейнеров',
        'Нет: для контейнеров обычно используют FCA/CPT/CIP; FOB/CIF — в основном для неконтейнерных морских грузов',
      ],
      correct:
        'Нет: для контейнеров обычно используют FCA/CPT/CIP; FOB/CIF — в основном для неконтейнерных морских грузов',
    },
    {
      key: 'q_deal_size',
      text: 'Типичный размер сделки в вашем опыте',
      type: 'radio',
      options: ['До 100 тыс. руб.', '100–500 тыс.', '500 тыс. – 2 млн', 'Более 2 млн'],
    },
    {
      key: 'q_competitors',
      text: 'Назовите 2–3 основных конкурента в сегменте ТЭУ',
      type: 'textarea',
    },
    {
      key: 'q_achievement',
      text: 'Ваше главное достижение в продажах (цифры)',
      type: 'textarea',
    },
  ],
}

const SALES_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест (Менеджер по продажам ТЭУ)',
  timeLimitMin: 30,
  maxScore: 40,
  passThreshold: 25,
  questions: [
    {
      key: 'q1',
      text: 'TCO (Total Cost of Ownership) при выборе перевозчика включает...',
      type: 'radio',
      options: [
        'Только фрахт',
        'Фрахт + страховка + таможня + хранение',
        'Только прямые затраты',
        'Фрахт + НДС',
      ],
      correct: 'Фрахт + страховка + таможня + хранение',
      weight: 3,
    },
    {
      key: 'q2',
      text: 'Возражение клиента «у вас дорого» — лучший ответ:',
      type: 'radio',
      options: [
        'Дадим скидку 10%',
        'Давайте сравним по TCO и срокам',
        'Наши цены рыночные',
        'Подумайте ещё',
      ],
      correct: 'Давайте сравним по TCO и срокам',
      weight: 3,
    },
    {
      key: 'q3',
      text: 'SLA в логистическом контракте — это...',
      type: 'radio',
      options: [
        'Стандартный логистический акт',
        'Соглашение об уровне обслуживания',
        'Страховой лимит ответственности',
        'Список разрешённых активов',
      ],
      correct: 'Соглашение об уровне обслуживания',
      weight: 2,
    },
    {
      key: 'q4',
      text: 'Какая группа состоит из реальных операторов маршрутов Китай–Россия?',
      type: 'radio',
      options: [
        'ТрансКонтейнер, FESCO, РЖД Логистика, ОТЛК ЕРА, Рускон',
        'ТрансЛогик Северо-Запад, SinoCargo Express, Рускон',
        'Только DHL, Maersk и FedEx',
        'Яндекс.Доставка, Ozon, Wildberries Logistics',
      ],
      correct: 'ТрансКонтейнер, FESCO, РЖД Логистика, ОТЛК ЕРА, Рускон',
      weight: 2,
    },
    {
      key: 'q5',
      text: 'Открытый вопрос: клиент говорит «ваш конкурент дешевле на 15%». Как отвечаете?',
      type: 'textarea',
      weight: 4,
    },
    {
      key: 'q6',
      text: 'При продаже мультимодальных перевозок ключевое УТП обычно...',
      type: 'radio',
      options: [
        'Самая низкая цена',
        'Оптимальный баланс скорость/цена/надёжность',
        'Только авиадоставка',
        'Только ж/д',
      ],
      correct: 'Оптимальный баланс скорость/цена/надёжность',
      weight: 2,
    },
    {
      key: 'q7',
      text: 'Что такое spot-ставка в логистике?',
      type: 'radio',
      options: [
        'Долгосрочный контракт',
        'Разовая рыночная ставка на текущий момент',
        'Ставка для VIP-клиентов',
        'Субсидированная государством ставка',
      ],
      correct: 'Разовая рыночная ставка на текущий момент',
      weight: 2,
    },
    {
      key: 'q8',
      text: 'EBITDA клиента — зачем логистическому менеджеру по продажам это знать?',
      type: 'radio',
      options: [
        'Не нужно знать',
        'Чтобы предложить оптимизацию логистических затрат в контексте маржи',
        'Для таможенного оформления',
        'Для расчёта фрахта',
      ],
      correct: 'Чтобы предложить оптимизацию логистических затрат в контексте маржи',
      weight: 3,
    },
    {
      key: 'q9',
      text: 'Открытый вопрос: опишите вашу воронку продаж от холодного контакта до подписания договора',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'q10',
      text: 'Предоплата 100% в логистике — типичная реакция клиента и ваш аргумент:',
      type: 'radio',
      options: [
        'Клиент согласится, если объяснить',
        'Предложить постоплату',
        'Предложить частичную предоплату + гарантийное письмо',
        'Настаивать на 100%',
      ],
      correct: 'Предложить частичную предоплату + гарантийное письмо',
      weight: 3,
    },
    {
      key: 'q11',
      text: 'NPS клиента в 8–9 баллов означает...',
      type: 'radio',
      options: ['Критик', 'Нейтральный клиент', 'Промоутер', 'Потерянный клиент'],
      correct: 'Нейтральный клиент',
      weight: 1,
    },
    {
      key: 'q12',
      text: 'Открытый вопрос: как вы работаете с клиентом, который уходит к конкуренту?',
      type: 'textarea',
      weight: 4,
    },
    {
      key: 'q13',
      text: 'Правило Парето (80/20) в продажах логистики означает...',
      type: 'radio',
      options: [
        '80% клиентов дают 20% выручки',
        '20% клиентов дают 80% выручки',
        '80% сделок закрываются за 20% времени',
        'Все варианты верны',
      ],
      correct: '20% клиентов дают 80% выручки',
      weight: 1,
    },
    {
      key: 'q14',
      text: 'При работе с возражением «нам не нужна логистика, у нас есть свой отдел» — ответ:',
      type: 'radio',
      options: [
        'Извините, тогда до свидания',
        'Предложить аудит текущих затрат и сравнение',
        'Сразу дать максимальную скидку',
        'Переключиться на другой отдел',
      ],
      correct: 'Предложить аудит текущих затрат и сравнение',
      weight: 3,
    },
    {
      key: 'q15',
      text: 'Что такое churn rate и почему он важен в продажах ТЭУ?',
      type: 'textarea',
      weight: 2,
    },
  ],
}

const SALES_STAGE_3: PsychologyStageContent = {
  stage: 3,
  type: 'psychology',
  title: 'Психологический тест (Менеджер по продажам ТЭУ)',
  timeLimitMin: null,
  scale: { min: 1, max: 5, labels: SCALE_LABELS },
  questions: [
    { key: 'q1', text: 'Я не сдаюсь, если клиент отказал в первый раз', type: 'scale', block: 'A' },
    { key: 'q2', text: 'Я нахожу нужного человека даже в крупных корпорациях', type: 'scale', block: 'A' },
    { key: 'q3', text: 'Провальные переговоры мотивируют меня больше, чем успешные', type: 'scale', block: 'A' },
    { key: 'q4', text: 'Я всегда стараюсь понять бизнес клиента глубже, чем он ожидает', type: 'scale', block: 'B' },
    { key: 'q5', text: 'Я готов отказаться от сделки, если она невыгодна клиенту долгосрочно', type: 'scale', block: 'B' },
    { key: 'q6', text: 'Я слежу за новостями клиентов, с которыми работаю', type: 'scale', block: 'B' },
    { key: 'q7', text: 'Я чувствую, когда клиент доволен, даже если он не говорит об этом', type: 'scale', block: 'C' },
    { key: 'q8', text: 'Мне легко выстраивать долгосрочные отношения с разными людьми', type: 'scale', block: 'C' },
    { key: 'q9', text: 'Я умею слушать клиента и не перебивать, даже если уже знаю решение', type: 'scale', block: 'C' },
    { key: 'q10', text: 'Результат — моя ответственность, даже если подвёл перевозчик', type: 'scale', block: 'D' },
    { key: 'q11', text: 'Я всегда выполняю обещания, данные клиенту, или заранее предупреждаю', type: 'scale', block: 'D' },
    { key: 'q12', text: 'Я не ищу оправданий, когда план не выполнен', type: 'scale', block: 'D' },
    ...L_SCALE_QUESTIONS,
  ],
}

const SALES_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: коммерческое предложение и работа с возражениями',
  timeLimitMin: 45,
  timeEstimate: '35–45 минут',
  description:
    'Клиент делает регулярный импорт из Китая (например, Шэньчжэнь → Челябинск), 2–3 поставки в месяц. Сейчас покупает перевозку разово и жалуется на скачки ставок/сроков.\n\nЗадание:\n1. Составьте структуру КП под регулярные поставки (маршрут, SLA, риски, KPI, формат отчётности).\n2. Предложите модель контракта с фиксированными ставками/коридорами, а не разовую spot-цену.\n3. Отработайте возражения клиента по предоплате и предложите безопасную альтернативу.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат выделяет таможню и сертификацию ЕАЭС отдельной строкой в КП' },
    { id: 2, description: 'Кандидат предлагает страхование груза и аргументирует ценность' },
    { id: 3, description: 'Кандидат предлагает альтернативу предоплате (аккредитив/частичная предоплата)' },
  ],
}

// ─── Registry ────────────────────────────────────────────────────────────────

const CONTENT: Record<Role, StageContent[]> = {
  logist: [LOGIST_STAGE_1, LOGIST_STAGE_2, LOGIST_STAGE_3, LOGIST_STAGE_4],
  sales_manager: [SALES_STAGE_1, SALES_STAGE_2, SALES_STAGE_3, SALES_STAGE_4],
}

/**
 * Return a fresh (cloned) copy of the static stage content for the given
 * role/stage. Callers may mutate the result freely (e.g. to inject the
 * per-session trap option) without affecting other sessions.
 */
export function getStageContent(role: Role, stage: number): StageContent {
  const list = CONTENT[role]
  const found = list[stage - 1]
  if (!found) {
    throw new Error(`No stage content for role=${role} stage=${stage}`)
  }
  return structuredClone(found)
}

export function getAllStagesContent(role: Role): StageContent[] {
  return CONTENT[role].map((s) => structuredClone(s))
}

// ─── Stage 2 server-side auto-scoring ────────────────────────────────────────

export interface Stage2ScoreResult {
  /** Auto-scored points from radio questions. */
  autoScore: number
  /** Maximum auto-scorable points (sum of weights of radio questions). */
  autoMax: number
  /** Maximum total stage score (auto + AI-evaluated open questions). */
  stageMax: number
  /** Per-question correctness map for radio questions only. */
  perQuestion: Record<string, { correct: boolean; weight: number; awarded: number }>
}

/**
 * Auto-score the radio questions of Stage 2 for the given role. Open
 * (textarea) questions are not scored here — they're evaluated by the AI
 * downstream and added to `autoScore` in the verdict step.
 */
export function scoreStage2(
  role: Role,
  answers: Record<string, unknown>,
): Stage2ScoreResult {
  const stage2 = getStageContent(role, 2) as TestStageContent
  let autoScore = 0
  let autoMax = 0
  const perQuestion: Stage2ScoreResult['perQuestion'] = {}
  for (const q of stage2.questions) {
    if (q.type !== 'radio' || !q.correct) continue
    const weight = q.weight ?? 0
    autoMax += weight
    const given = answers[q.key]
    const correct = typeof given === 'string' && given === q.correct
    const awarded = correct ? weight : 0
    autoScore += awarded
    perQuestion[q.key] = { correct, weight, awarded }
  }
  return { autoScore, autoMax, stageMax: stage2.maxScore, perQuestion }
}
