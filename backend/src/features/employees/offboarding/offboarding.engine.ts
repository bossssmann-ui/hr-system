import { getOffboardingTemplate } from './offboarding.templates'

export type OffboardingTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'completed'
  | 'blocked'

export type OffboardingChecklistDraft = {
  employeeId: string
  templateKey: string
  templateVersion: number
  title: string
  createdAt: Date
  completedAt: Date | null
}

export type OffboardingTaskDraft = {
  key: string
  title: string
  assigneeRole: string
  orderIndex: number
  status: OffboardingTaskStatus
  description?: string
}

export type ChecklistAggregate = {
  total: number
  completed: number
  skipped: number
  blocked: number
  isComplete: boolean
  completedAt: Date | null
}

export function createOffboardingChecklist(input: {
  employeeId: string
  templateKey: string
  createdAt?: Date
}): { checklist: OffboardingChecklistDraft; tasks: OffboardingTaskDraft[] } {
  const template = getOffboardingTemplate(input.templateKey)
  if (!template) throw new Error(`Unknown offboarding template '${input.templateKey}'`)

  const createdAt = input.createdAt ?? new Date()
  const tasks: OffboardingTaskDraft[] = template.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    assigneeRole: task.assigneeRole,
    orderIndex: task.orderIndex,
    status: 'pending',
    description: task.description,
  }))

  return {
    checklist: {
      employeeId: input.employeeId,
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      title: template.title,
      createdAt,
      completedAt: null,
    },
    tasks,
  }
}

export function computeOffboardingChecklistAggregate(
  tasks: ReadonlyArray<{ status: OffboardingTaskStatus }>,
  now = new Date(),
): ChecklistAggregate {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === 'done' || task.status === 'completed').length
  const skipped = tasks.filter((task) => task.status === 'skipped').length
  const blocked = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length
  const isComplete =
    total > 0 &&
    blocked === 0 &&
    tasks.every((task) => task.status === 'done' || task.status === 'completed' || task.status === 'skipped')

  return { total, completed, skipped, blocked, isComplete, completedAt: isComplete ? now : null }
}

export function isOffboardingChecklistComplete(tasks: ReadonlyArray<{ status: OffboardingTaskStatus }>): boolean {
  return computeOffboardingChecklistAggregate(tasks).isComplete
}
