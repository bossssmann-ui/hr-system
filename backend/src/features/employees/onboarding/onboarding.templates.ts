export type OnboardingAssigneeRole = 'hr_admin' | 'hiring_manager' | 'it' | 'employee'
export type EmploymentFormOption = 'td' | 'gph' | 'self_employed' | 'ip'

export type OnboardingTaskTemplate = {
  key: string
  title: string
  assigneeRole: OnboardingAssigneeRole
  isAutomated: boolean
  orderIndex: number
  metadata?: Record<string, unknown>
}

export type OnboardingTemplate = {
  templateKey: string
  templateVersion: number
  title: string
  tasks: ReadonlyArray<OnboardingTaskTemplate>
}

const EMPLOYMENT_FORM_OPTIONS: ReadonlyArray<EmploymentFormOption> = [
  'td',
  'gph',
  'self_employed',
  'ip',
]

export const LOGIST_ONBOARDING_TEMPLATE: OnboardingTemplate = {
  templateKey: 'logist',
  templateVersion: 1,
  title: 'Онбординг логиста',
  tasks: [
    {
      key: 'provision_ati',
      title: 'Регистрация и доступ ATI (ati.su)',
      assigneeRole: 'it',
      isAutomated: true,
      orderIndex: 1,
    },
    {
      key: 'provision_corp_email',
      title: 'Корпоративная почта',
      assigneeRole: 'it',
      isAutomated: true,
      orderIndex: 2,
    },
    {
      key: 'provision_corp_phone',
      title: 'Корпоративный телефон / SIM',
      assigneeRole: 'it',
      isAutomated: true,
      orderIndex: 3,
    },
    {
      key: 'provision_yougile',
      title: 'Аккаунт YouGile (CRM)',
      assigneeRole: 'it',
      isAutomated: true,
      orderIndex: 4,
    },
    {
      key: 'provision_smart_logistics',
      title: 'Аккаунт «Умная Логистика» (TMS, used instead of 1C)',
      assigneeRole: 'it',
      isAutomated: true,
      orderIndex: 5,
    },
    {
      key: 'agree_employment_type',
      title: 'Выбрать форму трудоустройства (ТД / ГПХ / самозанятый / ИП) по кандидату',
      assigneeRole: 'hr_admin',
      isAutomated: false,
      orderIndex: 6,
      metadata: {
        default: null,
        options: EMPLOYMENT_FORM_OPTIONS,
      },
    },
    {
      key: 'training_regulations',
      title: 'Изучение внутренних регламентов',
      assigneeRole: 'hiring_manager',
      isAutomated: false,
      orderIndex: 7,
    },
    {
      key: 'training_sales_scripts',
      title: 'Скрипты продаж и работы с клиентом',
      assigneeRole: 'hiring_manager',
      isAutomated: false,
      orderIndex: 8,
    },
    {
      key: 'training_smart_logistics',
      title: 'Работа в «Умной Логистике»',
      assigneeRole: 'hiring_manager',
      isAutomated: false,
      orderIndex: 9,
    },
    {
      key: 'training_yougile_regulations',
      title: 'Регламенты работы в YouGile',
      assigneeRole: 'hiring_manager',
      isAutomated: false,
      orderIndex: 10,
    },
  ],
}

const ONBOARDING_TEMPLATES: Record<string, OnboardingTemplate> = {
  [LOGIST_ONBOARDING_TEMPLATE.templateKey]: LOGIST_ONBOARDING_TEMPLATE,
}

export function getOnboardingTemplate(templateKey: string): OnboardingTemplate | null {
  return ONBOARDING_TEMPLATES[templateKey] ?? null
}
