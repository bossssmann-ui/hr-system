import { getOnboardingTemplate, type OnboardingAssigneeRole } from './onboarding.templates'
import type { ItProvisioningDispatcher } from './provisioning.dispatcher'

export type OnboardingTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'skipped'
  // Backward-compatible aliases kept while DB enum still uses legacy names.
  | 'completed'
  | 'blocked'

export type OnboardingChecklistDraft = {
  employeeId: string
  templateKey: string
  templateVersion: number
  title: string
  startedAt: Date
  completedAt: Date | null
}

export type OnboardingTaskDraft = {
  id?: string
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

export async function createChecklistWithAutomation(input: {
  tenantId: string
  employeeId: string
  templateKey: string
  employeeSnapshot: Record<string, unknown>
  provisioningDispatcher: ItProvisioningDispatcher
  startedAt?: Date
}): Promise<{ checklist: OnboardingChecklistDraft; tasks: OnboardingTaskDraft[] }> {
  const checklist = createChecklist({
    employeeId: input.employeeId,
    templateKey: input.templateKey,
    startedAt: input.startedAt,
  })

  const tasks = await dispatchAutomatedTasks({
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    employeeSnapshot: input.employeeSnapshot,
    tasks: checklist.tasks,
    provisioningDispatcher: input.provisioningDispatcher,
  })

  return {
    checklist: checklist.checklist,
    tasks,
  }
}

export async function dispatchAutomatedTasks(input: {
  tenantId: string
  employeeId: string
  employeeSnapshot: Record<string, unknown>
  tasks: ReadonlyArray<OnboardingTaskDraft>
  provisioningDispatcher: ItProvisioningDispatcher
}): Promise<OnboardingTaskDraft[]> {
  const nextTasks = input.tasks.map((task) => ({ ...task }))
  await Promise.all(
    nextTasks.map(async (task) => {
      if (!task.isAutomated) return

      const result = await input.provisioningDispatcher.dispatch({
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        // On checklist draft creation, DB ids do not exist yet.
        // Use stable task key as temporary task_id fallback.
        taskId: task.id ?? task.key,
        taskKey: task.key,
        employeeSnapshot: input.employeeSnapshot,
        metadata: task.metadata,
      })

      task.status = result
    }),
  )

  return nextTasks
}

export function computeChecklistAggregate(tasks: ReadonlyArray<{ status: OnboardingTaskStatus }>, now = new Date()): ChecklistAggregate {
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === 'done' || task.status === 'completed').length
  const skipped = tasks.filter((task) => task.status === 'skipped').length
  const blocked = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length
  const isComplete =
    total > 0 &&
    blocked === 0 &&
    tasks.every((task) => task.status === 'done' || task.status === 'completed' || task.status === 'skipped')

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
