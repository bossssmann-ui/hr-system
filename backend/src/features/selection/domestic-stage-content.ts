/**
 * Phase 15b — Domestic Logist Stage Content
 *
 * Question content for the 7 domestic logist specialization packages.
 * Each package provides stage 2 (proftest) content. domestic_core_operations
 * additionally provides stage 1 (questionnaire-screening). All non-core
 * packages provide stage 4 (practical assignment).
 *
 * Reference: docs/selection-logist-domestic-packages.md
 */

import type {
  StageContent,
  TestStageContent,
  QuestionnaireStageContent,
  PsychologyStageContent,
  AssignmentStageContent,
} from './stage-content'
import { getStageContent } from './stage-content'
import type { SpecializationPackageId, SpecializationAssignment } from './domestic-specializations'

// ─── domestic_core_operations ─────────────────────────────────────────────────

const BREAKDOWN_500KM_QUESTION = {
  key: 'q_breakdown_500km',
  text: 'Машина с грузом сломалась в пути в 500 км, водитель недоступен 2 часа — ваши действия?',
  type: 'textarea' as const,
  weight: 5,
}

const CORE_STAGE_1: QuestionnaireStageContent = {
  stage: 1,
  type: 'questionnaire',
  title: 'Анкета-скрининг (Внутренний логист)',
  timeLimitMin: null,
  questions: [
    { key: 'stop_salary', text: 'Ожидаемый уровень дохода (фикс, на руки, руб.)', type: 'number' },
    {
      key: 'stop_experience',
      text: 'Сколько лет в транспортной логистике (внутри РФ)?',
      type: 'radio',
      options: ['Менее 1 года', '1–2 года', '3–5 лет', 'Более 5 лет'],
    },
    {
      key: 'q_transport_types',
      text: 'Виды транспорта, с которыми работали',
      type: 'checkbox',
      options: ['Авто (FTL/LTL)', 'ЖД / контейнер', 'Каботаж / морское плечо', 'Авиа', 'Мультимодаль'],
    },
    {
      key: 'stop_location',
      text: 'Готовность к работе в офисе',
      type: 'radio',
      options: ['5/5 офис', 'Гибрид', 'Только удалённо'],
    },
    {
      key: 'q_regions',
      text: 'Основные направления / регионы в вашем опыте',
      type: 'textarea',
    },
    {
      key: 'q_docs',
      text: 'Транспортные документы, с которыми работали',
      type: 'checkbox',
      options: ['ТН', 'ТТН', 'УПД', 'Доверенность водителя', 'ЭТРАН', 'ЭДО', 'Ни одним'],
    },
    {
      key: 'q_1c_experience',
      text: 'Опыт работы в 1С',
      type: 'radio',
      options: [
        'не работал',
        'базово (просмотр)',
        'уверенно (ТТН, ТрН, путевые листы)',
        'администрирование',
      ],
    },
    {
      key: 'q_counterparty_checks',
      text: 'Чем проверяете нового перевозчика/контрагента',
      type: 'checkbox',
      options: [
        'ati.su (поиск грузов/машин)',
        'АТИ Светофор (рейтинг/риски)',
        'Контур.Фокус / СБИС / аналоги (проверка юрлица)',
        'проверка по ЕГРЮЛ/ФНС',
        'не проверяю',
      ],
    },
    {
      key: 'q_peak_shipments_per_day',
      text: 'Сколько перевозок / заявок в день вели на пике',
      type: 'radio',
      options: ['1–2', '3–5', '6–10', '10+'],
    },
    {
      key: 'q_document_flow',
      text: 'Документооборот: с чем работали',
      type: 'checkbox',
      options: [
        'ТТН/ТрН',
        'договор-заявка',
        'ЭДО',
        'доверенности',
        'акты',
        'счета-фактуры',
        'экспедиторская расписка',
        'поручение экспедитору',
        'отчёт экспедитора',
      ],
    },
    {
      key: 'q_cargo_types',
      text: 'Типы грузов / перевозок, с которыми работали',
      type: 'checkbox',
      options: [
        'тент',
        'рефрижератор/изотерм',
        'негабарит',
        'сборные/догруз',
        'наливные',
        'опасные/ADR',
        'ценные',
      ],
    },
    {
      key: 'q_direction_geography',
      text: 'География направлений',
      type: 'checkbox',
      options: ['внутригород', 'межгород РФ', 'СНГ', 'международные'],
    },
    {
      key: 'q_new_carrier_check',
      text: 'Как вы ищете и проверяете нового перевозчика, которому впервые отдаёте груз?',
      type: 'textarea',
    },
    {
      key: 'q_contract_risk_signs',
      text: 'По каким признакам в заявке/договоре вы видите риск срыва перевозки?',
      type: 'textarea',
    },
    {
      key: 'q_hardest_shipment',
      text: 'Расскажите про самую сложную перевозку в вашей практике и как вы решали проблему',
      type: 'textarea',
    },
  ],
}

const CORE_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: сквозные операции (Внутренний логист)',
  timeLimitMin: 30,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'core_q1',
      text: 'Что нельзя запускать в перевозку без уточнения?',
      type: 'radio',
      options: [
        'Только стоимость перевозки.',
        'Вес, габариты, количество мест, адреса, сроки, требования к погрузке и выгрузке.',
        'Только ФИО водителя.',
        'Только марку автомобиля.',
      ],
      correct: 'Вес, габариты, количество мест, адреса, сроки, требования к погрузке и выгрузке.',
      weight: 2,
    },
    {
      key: 'core_q2',
      text: 'Если груз повреждён на складе до погрузки, логист должен:',
      type: 'radio',
      options: [
        'Всё равно отправить, чтобы не сорвать срок.',
        'Зафиксировать повреждение, уведомить ответственных, согласовать дальнейшие действия.',
        'Попросить водителя решить на месте.',
        'Удалить повреждённое место из документов.',
      ],
      correct: 'Зафиксировать повреждение, уведомить ответственных, согласовать дальнейшие действия.',
      weight: 2,
    },
    {
      key: 'core_q3',
      text: 'Что является плохим признаком в работе логиста?',
      type: 'radio',
      options: [
        'Письменное подтверждение изменения ставки.',
        'Фотофиксация спорной ситуации.',
        'Устная договорённость о доплате без фиксации.',
        'Предупреждение клиента о риске заранее.',
      ],
      correct: 'Устная договорённость о доплате без фиксации.',
      weight: 2,
    },
    BREAKDOWN_500KM_QUESTION,
    {
      key: 'core_q4',
      text: 'Машина прибыла на выгрузку, получатель не принимает груз из-за ошибки в документах. Опишите действия.',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'core_q5',
      text: 'Клиент просит «просто отправить быстрее», но не дал точный вес и габариты. Как отвечаете?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

// ─── domestic_road_ftl_ltl ────────────────────────────────────────────────────

const ROAD_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: авто FTL/LTL',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'road_q1',
      text: 'LTL означает:',
      type: 'radio',
      options: [
        'Полная машина под одного клиента.',
        'Сборная перевозка, где груз занимает часть транспорта.',
        'Только перевозка негабарита.',
        'Только городская доставка.',
      ],
      correct: 'Сборная перевозка, где груз занимает часть транспорта.',
      weight: 2,
    },
    {
      key: 'road_q2',
      text: 'Перевозчик просит доплату за простой. Первое действие логиста:',
      type: 'radio',
      options: [
        'Сразу согласовать оплату.',
        'Проверить заявку, время прибытия, отметки, переписку и причину простоя.',
        'Отказать без проверки.',
        'Переложить решение на водителя.',
      ],
      correct: 'Проверить заявку, время прибытия, отметки, переписку и причину простоя.',
      weight: 2,
    },
    {
      key: 'road_q3',
      text: 'Для выбора машины важнее всего:',
      type: 'radio',
      options: [
        'Только расстояние.',
        'Вес, объём, габариты, тип загрузки, условия перевозки.',
        'Только ставка.',
        'Только город отправления.',
      ],
      correct: 'Вес, объём, габариты, тип загрузки, условия перевозки.',
      weight: 2,
    },
    BREAKDOWN_500KM_QUESTION,
    {
      key: 'road_q5',
      text: 'Клиент хочет отправить сборный груз, но требует доставку как FTL. Как объясните варианты?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const ROAD_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: FTL/LTL — доставка в Екатеринбург',
  timeLimitMin: 40,
  timeEstimate: '30–40 минут',
  description:
    'Клиенту нужно доставить 8 паллет, 3 400 кг, Москва → Екатеринбург. Срок: послезавтра утром. Клиент не знает точные габариты паллет и говорит, что «обычная фура точно подойдёт». Перевозчик найден на бирже, просит предоплату и не готов показать рекомендации.\n\nКандидат должен:\n- запросить недостающие данные;\n- сравнить FTL/LTL;\n- проверить перевозчика;\n- зафиксировать условия в заявке;\n- предупредить о риске срока;\n- предложить резервного перевозчика.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат соглашается без точных габаритов' },
    { id: 2, description: 'Кандидат подтверждает сомнительного перевозчика без проверки' },
    { id: 3, description: 'Кандидат обещает срок без проверки окон погрузки и транзита' },
  ],
}

// ─── domestic_distribution ────────────────────────────────────────────────────

const DIST_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: развозка / дистрибуция',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'dist_q1',
      text: 'При развозке с окнами доставки первым нужно учитывать:',
      type: 'radio',
      options: [
        'Только километраж.',
        'Временные окна, приоритеты, ограничения точек и реальный порядок движения.',
        'Только стоимость топлива.',
        'Только пожелания водителя.',
      ],
      correct: 'Временные окна, приоритеты, ограничения точек и реальный порядок движения.',
      weight: 2,
    },
    {
      key: 'dist_q2',
      text: 'Если одна точка не принимает груз и задерживает маршрут, логист должен:',
      type: 'radio',
      options: [
        'Ждать до конца дня без уведомлений.',
        'Оценить влияние на следующие точки, уведомить заинтересованных, согласовать решение.',
        'Отменить все следующие доставки.',
        'Попросить водителя выбрать самому.',
      ],
      correct: 'Оценить влияние на следующие точки, уведомить заинтересованных, согласовать решение.',
      weight: 2,
    },
    {
      key: 'dist_q3',
      text: 'Главный риск при многоадресной доставке:',
      type: 'radio',
      options: [
        'Только пробки.',
        'Срыв окон, потеря документов, частичные отказы, накопление задержек.',
        'Только цена рейса.',
        'Только марка автомобиля.',
      ],
      correct: 'Срыв окон, потеря документов, частичные отказы, накопление задержек.',
      weight: 2,
    },
    {
      key: 'dist_q4',
      text: '15 точек, 2 машины, три клиента принимают только до 12:00, одна машина задержалась на складе. Что делаете?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'dist_q5',
      text: 'Получатель на одной точке принял не весь груз. Какие документы и действия нужны?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const DIST_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: развозка — 18 точек, Владивосток',
  timeLimitMin: 40,
  timeEstimate: '30–40 минут',
  description:
    'Есть 18 точек по Владивостоку и пригородам, 3 машины, два клиента принимают только до 11:30, один клиент требует оригиналы документов, одна машина сломалась после первой точки.\n\nКандидат должен:\n- перестроить маршрут;\n- перенести или разделить точки;\n- уведомить клиентов;\n- зафиксировать отказ или задержку;\n- защитить возврат документов.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат оптимизирует только по расстоянию' },
    { id: 2, description: 'Кандидат игнорирует окна доставки' },
    { id: 3, description: 'Кандидат не отслеживает оригиналы документов' },
  ],
}

// ─── domestic_rail_container ──────────────────────────────────────────────────

const RAIL_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: ЖД / контейнер',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'rail_q1',
      text: 'При контейнерной перевозке «дверь-дверь» логист должен учитывать:',
      type: 'radio',
      options: [
        'Только ЖД тариф.',
        'Подачу контейнера, терминал, ЖД плечо, автоплечо, хранение, документы.',
        'Только стоимость авто.',
        'Только расстояние между городами.',
      ],
      correct: 'Подачу контейнера, терминал, ЖД плечо, автоплечо, хранение, документы.',
      weight: 2,
    },
    {
      key: 'rail_q2',
      text: 'Риск терминального хранения возникает, когда:',
      type: 'radio',
      options: [
        'Контейнер забрали сразу.',
        'Груз или контейнер не вывезен в свободный срок.',
        'Перевозка идёт автотранспортом.',
        'Клиент оплатил счёт заранее.',
      ],
      correct: 'Груз или контейнер не вывезен в свободный срок.',
      weight: 2,
    },
    {
      key: 'rail_q3',
      text: 'Автоплечо в мультимодальной перевозке:',
      type: 'radio',
      options: [
        'Можно не планировать заранее.',
        'Нужно учитывать по срокам, стоимости, доступности машины и документам.',
        'Всегда бесплатно.',
        'Не влияет на срок.',
      ],
      correct: 'Нужно учитывать по срокам, стоимости, доступности машины и документам.',
      weight: 2,
    },
    {
      key: 'rail_q4',
      text: 'Клиент выбирает ЖД, потому что дешевле авто, но срок критичный. Как сравните варианты?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'rail_q5',
      text: 'Контейнер пришёл на терминал, но получатель не готов принять груз. Ваши действия?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const RAIL_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: ЖД/контейнер — Новосибирск → Санкт-Петербург',
  timeLimitMin: 40,
  timeEstimate: '30–40 минут',
  description:
    'Груз Новосибирск → Санкт-Петербург, 20 тонн оборудования, клиент хочет дешевле авто и предлагает контейнер. Срок ограничен, терминал назначения перегружен, склад получателя принимает только по будням.\n\nКандидат должен:\n- сравнить авто и ЖД/контейнер;\n- проверить терминал и окна приёмки;\n- учесть автоплечи;\n- назвать риски хранения и задержки;\n- не обещать срок без подтверждения терминала.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат игнорирует перегрузку терминала' },
    { id: 2, description: 'Кандидат забывает автоплечо' },
    { id: 3, description: 'Кандидат сравнивает только базовый тариф' },
  ],
}

// ─── domestic_oversized_heavy ─────────────────────────────────────────────────

const OVERSIZED_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: негабарит / тяжеловес',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'oversized_q1',
      text: 'Для негабаритного груза недостаточно:',
      type: 'radio',
      options: [
        'Знать вес и габариты.',
        'Просто найти свободный трал и договориться о цене.',
        'Проверить маршрут.',
        'Учесть разрешения.',
      ],
      correct: 'Просто найти свободный трал и договориться о цене.',
      weight: 2,
    },
    {
      key: 'oversized_q2',
      text: 'Маршрут негабаритной перевозки должен учитывать:',
      type: 'radio',
      options: [
        'Только расстояние.',
        'Мосты, высоту, ширину, радиусы поворотов, ограничения дорог, сезонность.',
        'Только цену топлива.',
        'Только город отправления.',
      ],
      correct: 'Мосты, высоту, ширину, радиусы поворотов, ограничения дорог, сезонность.',
      weight: 2,
    },
    {
      key: 'oversized_q3',
      text: 'Кто отвечает за схему крепления?',
      type: 'radio',
      options: [
        'Это не важно.',
        'Ответственные со стороны перевозчика/погрузки, но логист обязан убедиться, что вопрос закрыт.',
        'Только клиент после доставки.',
        'Только бухгалтерия.',
      ],
      correct: 'Ответственные со стороны перевозчика/погрузки, но логист обязан убедиться, что вопрос закрыт.',
      weight: 2,
    },
    {
      key: 'oversized_q4',
      text: 'Клиент просит перевезти оборудование 4,2 м высотой и говорит «поедет как обычный груз». Ваши действия?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'oversized_q5',
      text: 'Разрешение задерживается, а клиент требует старт завтра. Как отвечаете?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const OVERSIZED_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: негабарит — Челябинск → Красноярск',
  timeLimitMin: 45,
  timeEstimate: '35–45 минут',
  description:
    'Нужно перевезти промышленное оборудование 13 м × 3,8 м × 4,2 м, вес 38 тонн, из Челябинска в Красноярск. Клиент считает, что достаточно «найти трал». Погрузка краном, маршрут проходит через участки с ограничением по высоте.\n\nКандидат должен:\n- определить ограничения негабарита и тяжеловеса;\n- запросить чертёж или схему груза;\n- заложить обследование маршрута и разрешения;\n- учесть погрузку и крепление;\n- предупредить о сроках согласования;\n- отказаться обещать обычный срок FTL.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат относится к негабариту как к обычной фуре' },
    { id: 2, description: 'Кандидат игнорирует разрешения и ограничения по высоте' },
    { id: 3, description: 'Кандидат не говорит про крепление и погрузку' },
  ],
}

// ─── domestic_remote_regions ──────────────────────────────────────────────────

const REMOTE_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: труднодоступные регионы',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'remote_q1',
      text: 'Для доставки в труднодоступный регион опасно:',
      type: 'radio',
      options: [
        'Проверять сезонность.',
        'Обещать срок без проверки окна маршрута и последней мили.',
        'Закладывать запас.',
        'Проверять альтернативный маршрут.',
      ],
      correct: 'Обещать срок без проверки окна маршрута и последней мили.',
      weight: 2,
    },
    {
      key: 'remote_q2',
      text: 'Зимник — это:',
      type: 'radio',
      options: [
        'Обычная федеральная трасса.',
        'Сезонная дорога, доступность которой зависит от погоды и периода.',
        'Морская линия.',
        'Складской терминал.',
      ],
      correct: 'Сезонная дорога, доступность которой зависит от погоды и периода.',
      weight: 2,
    },
    {
      key: 'remote_q3',
      text: 'При доставке в удалённый посёлок важно заранее проверить:',
      type: 'radio',
      options: [
        'Только ставку магистрального плеча.',
        'Последнюю милю, сезонность, перегрузки, хранение, связь, резервный сценарий.',
        'Только наличие водителя.',
        'Только тип упаковки.',
      ],
      correct: 'Последнюю милю, сезонность, перегрузки, хранение, связь, резервный сценарий.',
      weight: 2,
    },
    {
      key: 'remote_q4',
      text: 'Груз нужно доставить в район, куда возможен проезд только по зимнику. Клиент хочет отправить через месяц. Что выясняете?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'remote_q5',
      text: 'Морское или речное плечо задержалось из-за погоды, а объект ждёт материал. Как действуете?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const REMOTE_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: труднодоступные регионы — Якутия',
  timeLimitMin: 40,
  timeEstimate: '30–40 минут',
  description:
    'Груз 12 тонн нужно доставить из Новосибирска в посёлок в Якутии. Последнее плечо возможно по зимнику, сезон скоро закрывается. Клиент говорит, что «в прошлом году туда возили за 10 дней», но точный адрес и условия выгрузки пока не дал.\n\nКандидат должен:\n- не принимать прошлогодний срок как гарантию;\n- проверить сезонное окно;\n- запросить точную локацию и выгрузку;\n- заложить резерв или хранение;\n- ясно объяснить риск клиенту.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат обещает 10 дней по аналогии с прошлым годом' },
    { id: 2, description: 'Кандидат игнорирует сезон зимника' },
    { id: 3, description: 'Кандидат не запрашивает точную конечную точку и условия последней мили' },
  ],
}

// ─── domestic_cabotage ────────────────────────────────────────────────────────

const CABOTAGE_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: морской каботаж',
  timeLimitMin: 20,
  maxScore: 16,
  passThreshold: 10,
  questions: [
    {
      key: 'cab_q1',
      text: 'Морской каботаж — это:',
      type: 'radio',
      options: [
        'Международная перевозка между странами.',
        'Морская перевозка между портами одной страны.',
        'Только речная доставка.',
        'Только авиационная доставка.',
      ],
      correct: 'Морская перевозка между портами одной страны.',
      weight: 2,
    },
    {
      key: 'cab_q2',
      text: 'При каботаже нельзя считать срок только по морскому плечу, потому что:',
      type: 'radio',
      options: [
        'Порт и автоплечо не влияют.',
        'Есть портовая обработка, расписание судна, погодные риски, первое и последнее плечо.',
        'Документы не нужны.',
        'Срок всегда фиксированный.',
      ],
      correct: 'Есть портовая обработка, расписание судна, погодные риски, первое и последнее плечо.',
      weight: 2,
    },
    {
      key: 'cab_q3',
      text: 'Портовое хранение возникает, если:',
      type: 'radio',
      options: [
        'Груз вывезли сразу.',
        'Груз не забран или не обработан в свободный период.',
        'Груз едет только авто.',
        'Клиент попросил скидку.',
      ],
      correct: 'Груз не забран или не обработан в свободный период.',
      weight: 2,
    },
    {
      key: 'cab_q4',
      text: 'Судно задерживается из-за погоды, а клиенту нужен груз к конкретной дате. Что делаете?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'cab_q5',
      text: 'Клиент сравнивает каботаж с автодоставкой только по цене. Как объясните различия?',
      type: 'textarea',
      weight: 5,
    },
  ],
}

const CABOTAGE_STAGE_4: AssignmentStageContent = {
  stage: 4,
  type: 'assignment',
  title: 'Тестовое задание: каботаж — Владивосток → Петропавловск-Камчатский',
  timeLimitMin: 40,
  timeEstimate: '30–40 минут',
  description:
    'Груз нужно отправить Владивосток → Петропавловск-Камчатский. Клиент хочет минимальную цену и просит назвать точный день доставки. Есть морское плечо, портовая обработка и доставка от порта до склада получателя. Прогнозируется непогода.\n\nКандидат должен:\n- разделить морское плечо, порт и последнюю милю;\n- проверить расписание судна;\n- объяснить погодный риск;\n- учесть портовые расходы и хранение;\n- не обещать точную дату без подтверждения.',
  answerKey: 'stage4_answer',
  traps: [
    { id: 1, description: 'Кандидат относится к каботажу как к обычной автодоставке' },
    { id: 2, description: 'Кандидат обещает точную дату при погодном риске' },
    { id: 3, description: 'Кандидат забывает портовую обработку и доставку от порта' },
  ],
}

// ─── Registry ────────────────────────────────────────────────────────────────

type PackageStageMap = Partial<Record<number, StageContent>>

const PACKAGE_CONTENT: Record<SpecializationPackageId, PackageStageMap> = {
  domestic_core_operations: {
    1: CORE_STAGE_1,
    2: CORE_STAGE_2,
  },
  domestic_road_ftl_ltl: {
    2: ROAD_STAGE_2,
    4: ROAD_STAGE_4,
  },
  domestic_distribution: {
    2: DIST_STAGE_2,
    4: DIST_STAGE_4,
  },
  domestic_rail_container: {
    2: RAIL_STAGE_2,
    4: RAIL_STAGE_4,
  },
  domestic_oversized_heavy: {
    2: OVERSIZED_STAGE_2,
    4: OVERSIZED_STAGE_4,
  },
  domestic_remote_regions: {
    2: REMOTE_STAGE_2,
    4: REMOTE_STAGE_4,
  },
  domestic_cabotage: {
    2: CABOTAGE_STAGE_2,
    4: CABOTAGE_STAGE_4,
  },
}

/**
 * Return stage content for a specific package and stage number.
 * Returns null if the packageId is unknown or the stage does not exist for
 * that package.
 */
export function getDomesticStageContent(
  packageId: SpecializationPackageId,
  stage: number,
): StageContent | null {
  const packageMap = PACKAGE_CONTENT[packageId]
  if (!packageMap) return null
  const content = packageMap[stage]
  if (!content) return null
  return structuredClone(content)
}

/**
 * Build the full 4-stage assessment for a domestic logist candidate based on
 * their specialization assignments.
 *
 * Stage 1 — questionnaire-screening from domestic_core_operations
 * Stage 2 — merged proftest from all primary packages (core first, then others)
 * Stage 3 — psychology test (re-used from existing logist role)
 * Stage 4 — practical assignment from first non-core primary specialization,
 *            with fallback to domestic_road_ftl_ltl
 */
export function buildDomesticStages(
  specializations: SpecializationAssignment[],
): StageContent[] {
  // ── Stage 1: always core questionnaire
  const stage1 = getDomesticStageContent('domestic_core_operations', 1)!

  // ── Stage 2: merge questions from all primary packages
  const primaryPackages = specializations
    .filter((s) => s.level === 'primary')
    .map((s) => s.packageId)

  // Ensure core_operations is always included
  if (!primaryPackages.includes('domestic_core_operations')) {
    primaryPackages.unshift('domestic_core_operations')
  } else {
    // Move core to front
    const idx = primaryPackages.indexOf('domestic_core_operations')
    primaryPackages.splice(idx, 1)
    primaryPackages.unshift('domestic_core_operations')
  }

  const seenKeys = new Set<string>()
  const mergedQuestions: (typeof CORE_STAGE_2)['questions'] = []
  let totalMaxScore = 0

  for (const pkgId of primaryPackages) {
    const s2 = getDomesticStageContent(pkgId, 2) as TestStageContent | null
    if (!s2) continue
    for (const q of s2.questions) {
      if (!seenKeys.has(q.key)) {
        seenKeys.add(q.key)
        mergedQuestions.push(q)
        totalMaxScore += q.weight ?? 0
      }
    }
  }

  const stage2: TestStageContent = {
    stage: 2,
    type: 'test',
    title: 'Профессиональный тест (Внутренний логист)',
    timeLimitMin: 30,
    maxScore: totalMaxScore,
    passThreshold: Math.round(totalMaxScore * 0.6),
    questions: mergedQuestions,
  }

  // ── Stage 3: psychology from existing logist role
  const stage3 = getStageContent('logist', 3) as PsychologyStageContent

  // ── Stage 4: practical assignment from first non-core primary pkg
  const nonCorePrimary = specializations
    .filter((s) => s.level === 'primary' && s.packageId !== 'domestic_core_operations')
    .map((s) => s.packageId)

  const practicalPkgId: SpecializationPackageId =
    nonCorePrimary[0] ?? 'domestic_road_ftl_ltl'

  const stage4Raw = getDomesticStageContent(practicalPkgId, 4) as AssignmentStageContent | null
  const stage4: AssignmentStageContent = stage4Raw
    ? { ...stage4Raw, stage: 4 }
    : (getDomesticStageContent('domestic_road_ftl_ltl', 4) as AssignmentStageContent)

  return [stage1, stage2, stage3, stage4]
}
