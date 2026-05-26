import { getOnboardingTemplate, type OnboardingAssigneeRole } from './onboarding.templates'

export type OnboardingTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'blocked'

export type OnboardingChecklistDraft = {
  employeeId: string
  templateKey: string
  templateVersion: number
  title: string
  startedAt: Date
  completedAt: Date | null
}

export type OnboardingTaskDraft = {
  key: string
  title: string
  assigneeRole: OnboardingAssigneeRole
  isAutomated: boolean
  orderIndex: number
  status: OnboardingTaskStatus
  metadata?: Record<string, unknown>
}

export type ChecklistAggregate = {
  total: number
  completed: number
  skipped: number
  blocked: number
  isComplete: boolean
  completedAt: Date | null
}

export function createChecklist(input: {
  employeeId: string
  templateKey: string
  startedAt?: Date
}): { checklist: OnboardingChecklistDraft; tasks: OnboardingTaskDraft[] } {
  const template = getOnboardingTemplate(input.templateKey)
  if (!template) {
    throw new Error(`Unknown onboarding template '${input.templateKey}'`)
  }

  const startedAt = input.startedAt ?? new Date()

  const tasks: OnboardingTaskDraft[] = template.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    assigneeRole: task.assigneeRole,
    isAutomated: task.isAutomated,
    orderIndex: task.orderIndex,
    status: 'pending',
    metadata: task.metadata,
  }))

  return {
    checklist: {
      employeeId: input.employeeId,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      title: template.title,
      startedAt,
      completedAt: null,
    },
    tasks,
  }
}

export function computeChecklistAggregate(tasks: ReadonlyArray<{ status: OnboardingTaskStatus }>, now = new Date()): ChecklistAggregate {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === 'completed').length
  const skipped = tasks.filter((task) => task.status === 'skipped').length
  const blocked = tasks.filter((task) => task.status === 'blocked').length
  const isComplete = total > 0 && blocked === 0 && tasks.every((task) => task.status === 'completed' || task.status === 'skipped')

  return {
    total,
    completed,
    skipped,
    blocked,
    isComplete,
    completedAt: isComplete ? now : null,
  }
}

export function isChecklistComplete(tasks: ReadonlyArray<{ status: OnboardingTaskStatus }>): boolean {
  return computeChecklistAggregate(tasks).isComplete
}
