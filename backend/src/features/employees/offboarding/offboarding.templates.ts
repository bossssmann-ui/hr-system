export type OffboardingAssigneeRole = 'hr_admin' | 'hiring_manager' | 'it' | 'employee'

export type OffboardingTaskTemplate = {
  key: string
  title: string
  assigneeRole: OffboardingAssigneeRole
  orderIndex: number
  description?: string
}

export type OffboardingTemplate = {
  templateKey: string
  templateVersion: number
  title: string
  tasks: ReadonlyArray<OffboardingTaskTemplate>
}

export const DEFAULT_OFFBOARDING_TEMPLATE: OffboardingTemplate = {
  templateKey: 'default',
  templateVersion: 1,
  title: 'Offboarding',
  tasks: [
    { key: 'return_equipment', title: 'Return equipment (laptop, phone, access cards)', assigneeRole: 'it', orderIndex: 1 },
    { key: 'project_handoff', title: 'Hand off ongoing projects', assigneeRole: 'hiring_manager', orderIndex: 2 },
    { key: 'close_projects', title: 'Close / archive personal projects', assigneeRole: 'employee', orderIndex: 3 },
    { key: 'exit_interview', title: 'Conduct exit interview', assigneeRole: 'hr_admin', orderIndex: 4 },
    { key: 'revoke_accesses', title: 'Revoke system accesses', assigneeRole: 'it', orderIndex: 5 },
  ],
}

const OFFBOARDING_TEMPLATES: Record<string, OffboardingTemplate> = {
  [DEFAULT_OFFBOARDING_TEMPLATE.templateKey]: DEFAULT_OFFBOARDING_TEMPLATE,
}

export function getOffboardingTemplate(templateKey: string): OffboardingTemplate | null {
  return OFFBOARDING_TEMPLATES[templateKey] ?? null
}
