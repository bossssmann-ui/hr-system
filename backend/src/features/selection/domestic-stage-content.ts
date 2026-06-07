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

const CARGO_LAYOUT_BONUS_QUESTION = {
  key: 'q_cargo_layout_experience',
  text: 'Делали ли вы самостоятельно раскладку груза на машине? Если да — чем именно (программа/Excel), какие объёмы и типы грузов раскладывали?',
  type: 'textarea' as const,
  // Информативный бонусный вопрос: без pass/fail влияния.
  weight: 0,
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
  maxScore: 21,
  passThreshold: 13,
  questions: [
    {
      key: 'core_q1',
      text: 'Что логист обязан уточнить перед запуском перевозки?',
      type: 'radio',
      options: [
        'Вес, габариты, количество мест.',
        'Адреса, окна, сроки и требования к погрузке/выгрузке.',
        'Документы, ограничения и условия ответственности.',
        'Всё перечисленное.',
      ],
      correct: 'Всё перечисленное.',
      weight: 2,
    },
    {
      key: 'core_q2',
      text: 'Груз повреждён на складе до погрузки. Опишите ваши действия.',
      type: 'textarea',
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
      text: 'Перевозчик просит доплату за простой. Какие проверки и действия выполняете в первую очередь?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'road_q3',
      text: 'Как подбираете тип машины под рейс и какие данные обязательны для решения?',
      type: 'textarea',
      weight: 2,
    },
    BREAKDOWN_500KM_QUESTION,
    {
      key: 'road_q5',
      text: 'Клиент хочет отправить сборный груз, но требует доставку как FTL. Как объясните варианты?',
      type: 'textarea',
      weight: 5,
    },
    CARGO_LAYOUT_BONUS_QUESTION,
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

// ─── domestic_rail_container ──────────────────────────────────────────────────

const RAIL_STAGE_2: TestStageContent = {
  stage: 2,
  type: 'test',
  title: 'Профессиональный тест: ЖД / контейнер',
  timeLimitMin: 20,
  maxScore: 41,
  passThreshold: 25,
  questions: [
    {
      key: 'rail_q_etran',
      text: 'Что такое ЭТРАН в ЖД-логистике и как вы используете его в работе?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q_gu12',
      text: 'Для чего нужна заявка ГУ-12 и какие данные в ней критичны?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q_etsng',
      text: 'Что такое код ЕТСНГ и зачем он нужен в расчёте и оформлении перевозки?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q1',
      text: 'Что обязательно учитывать при контейнерной перевозке «дверь-дверь»?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q2',
      text: 'Когда возникает риск терминального хранения и как вы им управляете?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q3',
      text: 'Как планируете автоплечо в мультимодальной схеме и какие риски контролируете?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q_container_types',
      text: 'Какие бывают типы контейнеров?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'rail_q_demurrage_detention_storage',
      text: 'Объясните разницу между demurrage, detention и terminal storage на практике.',
      type: 'textarea',
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
    {
      key: 'rail_q_operators_open',
      text: 'С какими операторами/экспедиторами и контейнерными линиями вы реально работали?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'rail_q_tariffs_open',
      text: 'Откуда брали ставки ЖД-тарифов и как часто обновляли у поставщиков?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'rail_q_benefits_open',
      text: 'Что знаете о льготных категориях груза и понижающих коэффициентах по ЖД?',
      type: 'textarea',
      weight: 5,
    },
    CARGO_LAYOUT_BONUS_QUESTION,
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
  maxScore: 39,
  passThreshold: 23,
  questions: [
    {
      key: 'oversized_q_dimensions',
      text: 'По каким параметрам определяете, что груз относится к негабаритному/тяжеловесному?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q_train_length',
      text: 'Какие базовые ограничения по длине/габаритам автопоезда вы учитываете до запроса спецразрешения?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q_permit_authority',
      text: 'Кто и как оформляет спецразрешения на КТГ по вашему маршруту?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q_axle_load',
      text: 'Почему осевые нагрузки критичны и как вы проверяете их на этапе планирования?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q1',
      text: 'Почему для негабаритной перевозки недостаточно просто подобрать трал и цену?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q2',
      text: 'Какие параметры маршрута обязательно анализируете для негабарита?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'oversized_q3',
      text: 'Кто отвечает за схему крепления и как логист контролирует, что требования выполнены?',
      type: 'textarea',
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
    {
      key: 'oversized_q_project_permits_open',
      text: 'Что такое проектные разрешения и при каких габаритах/массе они нужны? Расскажите по практике.',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'oversized_q_liability_open',
      text: 'Когда ответственность за перевес/негабарит на экспедиторе, а когда на перевозчике?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'oversized_q_escort_open',
      text: 'Когда обязательно сопровождение (машины прикрытия/ГИБДД) и от чего это зависит?',
      type: 'textarea',
      weight: 5,
    },
    CARGO_LAYOUT_BONUS_QUESTION,
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
  maxScore: 26,
  passThreshold: 16,
  questions: [
    {
      key: 'remote_q1',
      text: 'Какие главные риски и ошибки при планировании доставки в труднодоступный регион?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'remote_q2',
      text: 'Что такое зимник и как его сезонность влияет на планирование маршрута?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'remote_q3',
      text: 'Что обязательно проверяете заранее при доставке в удалённый посёлок?',
      type: 'textarea',
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
    {
      key: 'remote_q_regions_open',
      text: 'Какие населённые пункты/районы РФ относите к труднодоступным и почему?',
      type: 'textarea',
      weight: 5,
    },
    {
      key: 'remote_q_north_delivery_open',
      text: 'Как северный завоз и навигационные окна влияют на планирование сроков и запасов?',
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
  maxScore: 27,
  passThreshold: 16,
  questions: [
    {
      key: 'cab_q1',
      text: 'Что такое морской каботаж и где в вашей практике он применялся?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'cab_q2',
      text: 'Почему при каботаже нельзя считать срок только по морскому плечу?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'cab_q3',
      text: 'Когда возникает портовое хранение и как предотвращаете лишние расходы?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'cab_q_document',
      text: 'Какие базовые документы используете на морском плече в каботаже?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'cab_q_svh',
      text: 'Нужен ли СВХ при каботаже между портами РФ и почему?',
      type: 'textarea',
      weight: 2,
    },
    {
      key: 'cab_q_free_period',
      text: 'Как работает free-time в порту и когда начинается платное хранение?',
      type: 'textarea',
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
    {
      key: 'cab_q_ports_lines_open',
      text: 'С какими портами и линиями работали и какие портовые расходы кроме фрахта учитывали?',
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

const PACKAGE_CONTENT: Partial<Record<SpecializationPackageId, PackageStageMap>> = {
  domestic_core_operations: {
    1: CORE_STAGE_1,
    2: CORE_STAGE_2,
  },
  domestic_road_ftl_ltl: {
    2: ROAD_STAGE_2,
    4: ROAD_STAGE_4,
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
