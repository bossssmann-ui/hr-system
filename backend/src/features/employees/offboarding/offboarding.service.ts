import type { DbClient } from '../../../db'
import { createNotifier, type Notifier } from '../../../services/notifier'
import type { Prisma } from '../../../generated/prisma/client'
import { canTransition, canTransitionWithOffboardingGate, type EmployeeStatus } from '../employees.fsm'
import type { Role } from '../../requisitions/requisitions.fsm'
import {
  computeOffboardingChecklistAggregate,
  createOffboardingChecklist,
  type OffboardingTaskStatus,
} from './offboarding.engine'

export type StartOffboardingInput = {
  prisma: DbClient
  tenantId: string
  employeeId: string
  actorRoles: ReadonlyArray<Role>
  actorUserId?: string
  notifier?: Notifier
}

export type CompleteOffboardingInput = {
  prisma: DbClient
  tenantId: string
  employeeId: string
  actorRoles: ReadonlyArray<Role>
  actorUserId?: string
  terminationGround?: string
  terminationNote?: string
  notifier?: Notifier
}

export type MarkOffboardingTaskDoneInput = {
  prisma: DbClient
  tenantId: string
  taskId: string
  actorUserId?: string
  status?: 'done' | 'skipped'
}

export type RecordExitInterviewInput = {
  prisma: DbClient
  tenantId: string
  employeeId: string
  conductedByUserId?: string
  conductedAt?: Date
  reasonCategory: string
  notes?: string
  wouldRehire?: boolean
  metadata?: Record<string, unknown>
}

export async function startOffboarding(input: StartOffboardingInput) {
  const { prisma, tenantId, employeeId, actorRoles, actorUserId } = input
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { id: true, status: true, tenantId: true, fullName: true, userId: true },
  })
  if (!employee) throw new Error(`startOffboarding: employee ${employeeId} not found`)

  const from = employee.status as EmployeeStatus
  if (!canTransition(from, 'notice', actorRoles)) {
    throw new Error(`startOffboarding: transition ${from} -> notice is not allowed`)
  }

  const { checklist: checklistDraft, tasks: taskDrafts } = createOffboardingChecklist({ employeeId, templateKey: 'default' })

  const result = await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { status: 'notice' } })
    const checklist = await tx.offboardingChecklist.create({ data: { tenantId, employeeId, title: checklistDraft.title } })
    const tasks = await Promise.all(
      taskDrafts.map((task) =>
        tx.offboardingTask.create({
          data: {
            tenantId,
            checklistId: checklist.id,
            order: task.orderIndex,
            title: task.title,
            assigneeRole: task.assigneeRole,
            status: 'pending',
            description: task.description ?? null,
          },
        }),
      ),
    )
    await tx.employeeLifecycleEvent.create({
      data: { tenantId, employeeId, type: 'notice_started', fromStatus: from, toStatus: 'notice', actorUserId: actorUserId ?? null },
    })
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action: 'employee.begin_notice',
        entityType: 'Employee',
        entityId: employeeId,
        diff: { fromStatus: from, toStatus: 'notice', checklistId: checklist.id },
      },
    })
    return { checklist, tasks }
  })

  const notifier = input.notifier ?? createNotifier(prisma)
  const hrAdmins = await prisma.userRole.findMany({ where: { tenantId, role: 'hr_admin' }, select: { userId: true } })
  await Promise.all(
    hrAdmins.map((member) =>
      notifier.notify({
        channel: 'in_app',
        recipient: { tenantId, userId: member.userId },
        template: 'offboarding.task_assigned',
        payload: { employeeId, checklistId: result.checklist.id },
      }),
    ),
  )
  return result
}

export async function completeOffboarding(input: CompleteOffboardingInput) {
  const { prisma, tenantId, employeeId, actorRoles, actorUserId } = input
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    include: {
      offboardingChecklists: { include: { tasks: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      preStartPortalEntry: true,
      exitInterview: true,
    },
  })
  if (!employee) throw new Error(`completeOffboarding: employee ${employeeId} not found`)
  if (employee.status !== 'notice') throw new Error('completeOffboarding: employee must be in notice status')

  const checklist = employee.offboardingChecklists[0] ?? null
  const offboardingChecklistCompletedAt = checklist?.completedAt ?? null
  if (!canTransitionWithOffboardingGate('notice', 'terminated', actorRoles, { offboardingChecklistCompletedAt })) {
    throw new Error('completeOffboarding: offboarding checklist must be completed before termination')
  }

  const terminatedAt = new Date()
  const terminationGround = input.terminationGround ?? 'voluntary_resignation'

  const result = await prisma.$transaction(async (tx) => {
    const updatedEmployee = await tx.employee.update({
      where: { id: employeeId },
      data: {
        status: 'terminated',
        terminatedAt,
        terminationGround: terminationGround as never,
        terminationNote: input.terminationNote ?? null,
      },
    })

    if (employee.userId) {
      await tx.user.update({ where: { id: employee.userId }, data: { disabledAt: terminatedAt } })
      await tx.authSession.deleteMany({ where: { userId: employee.userId } })
    }

    if (employee.preStartPortalEntry && employee.preStartPortalEntry.status !== 'closed') {
      await tx.preStartPortalEntry.update({ where: { id: employee.preStartPortalEntry.id }, data: { status: 'closed', closedAt: terminatedAt } })
    }

    const alumniProfile = await tx.alumniProfile.upsert({
      where: { employeeId },
      create: {
        tenantId,
        employeeId,
        candidateId: employee.candidateId ?? null,
        status: 'active',
        wouldRehire: employee.exitInterview?.wouldRehire ?? null,
        departureReason: employee.exitInterview?.reasonCategory ?? null,
      },
      update: {},
    })

    await tx.employeeLifecycleEvent.create({
      data: {
        tenantId,
        employeeId,
        type: 'terminated',
        fromStatus: 'notice',
        toStatus: 'terminated',
        actorUserId: actorUserId ?? null,
        effectiveAt: terminatedAt,
      },
    })
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action: 'employee.terminated',
        entityType: 'Employee',
        entityId: employeeId,
        diff: { fromStatus: 'notice', toStatus: 'terminated', terminatedAt: terminatedAt.toISOString(), alumniProfileId: alumniProfile.id },
      },
    })
    await tx.auditEvent.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        action: 'alumni.created',
        entityType: 'AlumniProfile',
        entityId: alumniProfile.id,
        diff: { employeeId, via: 'termination' },
      },
    })
    return { employee: updatedEmployee, alumniProfile }
  })

  const notifier = input.notifier ?? createNotifier(prisma)
  const hrAdmins = await prisma.userRole.findMany({ where: { tenantId, role: 'hr_admin' }, select: { userId: true } })
  await Promise.all(
    hrAdmins.map((member) =>
      notifier.notify({
        channel: 'in_app',
        recipient: { tenantId, userId: member.userId },
        template: 'employee.terminated',
        payload: { employeeId, alumniProfileId: result.alumniProfile.id },
      }),
    ),
  )
  return result
}

export async function markOffboardingTaskDone(input: MarkOffboardingTaskDoneInput) {
  const { prisma, tenantId, taskId, actorUserId, status = 'done' } = input
  const task = await prisma.offboardingTask.findFirst({
    where: { id: taskId, tenantId },
    include: { checklist: { include: { tasks: true } } },
  })
  if (!task) throw new Error(`markOffboardingTaskDone: task ${taskId} not found`)

  const completedAt = new Date()
  const persistedStatus: OffboardingTaskStatus = status === 'done' ? 'completed' : 'skipped'
  const updatedTask = await prisma.offboardingTask.update({
    where: { id: taskId },
    data: { status: persistedStatus, completedAt, completedByUserId: actorUserId ?? null },
  })

  const allTasks = task.checklist.tasks.map((item) => (item.id === taskId ? { ...item, status: persistedStatus } : item))
  const aggregate = computeOffboardingChecklistAggregate(allTasks, completedAt)
  if (aggregate.isComplete && !task.checklist.completedAt) {
    await prisma.offboardingChecklist.update({ where: { id: task.checklistId }, data: { completedAt: aggregate.completedAt } })
  }

  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorUserId: actorUserId ?? null,
      action: 'offboarding.task.completed',
      entityType: 'OffboardingTask',
      entityId: taskId,
      diff: { taskId, checklistId: task.checklistId, status: persistedStatus },
    },
  })
  return updatedTask
}

export async function recordExitInterview(input: RecordExitInterviewInput) {
  const { prisma, tenantId, employeeId } = input
  return prisma.exitInterview.upsert({
    where: { employeeId },
    create: {
      tenantId,
      employeeId,
      conductedByUserId: input.conductedByUserId ?? null,
      conductedAt: input.conductedAt ?? null,
      reasonCategory: input.reasonCategory as never,
      notes: input.notes ?? null,
      wouldRehire: input.wouldRehire ?? null,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? null,
    },
    update: {
      conductedByUserId: input.conductedByUserId ?? undefined,
      conductedAt: input.conductedAt ?? undefined,
      reasonCategory: input.reasonCategory as never,
      notes: input.notes ?? undefined,
      wouldRehire: input.wouldRehire ?? undefined,
      metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  })
}
