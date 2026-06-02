import { SelectionRetentionOutcomeStatus, type TerminationGround } from '../../generated/prisma/client'
import type { DbClient } from '../../db'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function diffDaysUtc(start: Date, end: Date) {
  return Math.max(0, Math.floor((startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime()) / DAY_MS))
}

export function computeRetentionOutcome(input: {
  hireDate: Date
  terminatedAt?: Date | null
  terminationGround?: TerminationGround | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const endDate = input.terminatedAt && input.terminatedAt < now ? input.terminatedAt : now
  const observedDays = diffDaysUtc(input.hireDate, endDate)
  const survived30 = observedDays >= 30
  const survived60 = observedDays >= 60
  const survived90 = observedDays >= 90

  const outcomeStatus =
    input.terminatedAt != null
      ? SelectionRetentionOutcomeStatus.resolved_terminated
      : survived90
        ? SelectionRetentionOutcomeStatus.resolved_survived_90
        : SelectionRetentionOutcomeStatus.in_progress

  return {
    hireDate: startOfUtcDay(input.hireDate),
    observedDays,
    survived30,
    survived60,
    survived90,
    terminationGround: input.terminationGround ?? null,
    outcomeStatus,
  }
}

export async function collectSelectionRetentionOutcomes(input: {
  prisma: DbClient
  now?: Date
  tenantId?: string
}) {
  const { prisma, now = new Date(), tenantId } = input

  const employees = await prisma.employee.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      applicationId: { not: null },
      hireDate: { not: null },
    },
    select: {
      tenantId: true,
      applicationId: true,
      hireDate: true,
      terminatedAt: true,
      terminationGround: true,
    },
  })

  if (employees.length === 0) {
    return { employeesMatched: 0, outcomesUpserted: 0 }
  }

  const applicationIds = [...new Set(employees.map((employee) => employee.applicationId).filter((id): id is string => Boolean(id)))]

  const sessions = await prisma.selectionSession.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      applicationId: { in: applicationIds },
      template: { role: 'logist_domestic' },
    },
    select: {
      id: true,
      tenantId: true,
      applicationId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const sessionByTenantApplication = new Map<string, { id: string }>()
  for (const session of sessions) {
    if (!session.applicationId) continue
    const key = `${session.tenantId}:${session.applicationId}`
    if (!sessionByTenantApplication.has(key)) {
      sessionByTenantApplication.set(key, { id: session.id })
    }
  }

  let outcomesUpserted = 0
  for (const employee of employees) {
    if (!employee.applicationId || !employee.hireDate) continue
    const key = `${employee.tenantId}:${employee.applicationId}`
    const session = sessionByTenantApplication.get(key)
    if (!session) continue
    const outcome = computeRetentionOutcome({
      hireDate: employee.hireDate,
      terminatedAt: employee.terminatedAt,
      terminationGround: employee.terminationGround ?? null,
      now,
    })

    await prisma.selectionRetentionOutcome.upsert({
      where: { sessionId: session.id },
      update: {
        hireDate: outcome.hireDate,
        observedDays: outcome.observedDays,
        survived30: outcome.survived30,
        survived60: outcome.survived60,
        survived90: outcome.survived90,
        terminationGround: outcome.terminationGround,
        outcomeStatus: outcome.outcomeStatus,
        computedAt: now,
      },
      create: {
        tenantId: employee.tenantId,
        sessionId: session.id,
        hireDate: outcome.hireDate,
        observedDays: outcome.observedDays,
        survived30: outcome.survived30,
        survived60: outcome.survived60,
        survived90: outcome.survived90,
        terminationGround: outcome.terminationGround,
        outcomeStatus: outcome.outcomeStatus,
        computedAt: now,
      },
    })
    outcomesUpserted += 1
  }

  return { employeesMatched: employees.length, outcomesUpserted }
}
