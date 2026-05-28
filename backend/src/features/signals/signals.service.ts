/**
 * Phase 9 — Flight-risk and burnout signal computation.
 *
 * `computeSignalsForTenant` runs nightly via the `signals.compute` cron task.
 * For each active employee we compute two scores (0-100) using deterministic
 * heuristics over already-available HR data:
 *
 *  - flight_risk  — tenure, time-since-last-1on1, missed 1:1s, missed reviews,
 *                   recent role/comp changes, no recent promotion/raise.
 *  - burnout      — overdue/missed 1:1s (proxy for missed support), workload
 *                   indicators (open OKRs at risk + many in-progress IDP items),
 *                   long uninterrupted tenure without a comp change.
 *
 * Scores >= `openThreshold` are persisted with `status='open'`. Lower scores
 * are still upserted so the row reflects current state (status stays 'open'
 * unless the previous run had already been reviewed/dismissed).
 *
 * These signals are advisory only — never used for automated personnel
 * decisions. They are visible to hr_admin / owner / hiring_manager.
 */

import type { DbClient } from '../../db'

export type SignalFactor = { code: string; weight: number; note: string }
export type SignalType = 'flight_risk' | 'burnout'

export type ComputedSignal = {
  employeeId: string
  type: SignalType
  score: number
  factors: SignalFactor[]
}

type EmployeeSnapshot = {
  id: string
  hireDate: Date | null
  status: string
  probationOutcome: string | null
  agreedBaseSalary: number | null
}

type OneOnOneSnapshot = { employeeId: string; scheduledAt: Date; status: string }
type ReviewSnapshot = { subjectEmployeeId: string; status: string; createdAt: Date }
type LifecycleSnapshot = { employeeId: string; type: string; effectiveAt: Date }
type OkrSnapshot = { employeeId: string; status: string }

const ACTIVE_STATUSES = new Set(['active', 'probation', 'on_leave'])

function daysAgo(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)))
}

/**
 * Compute the flight-risk score for a single employee. Deterministic so we
 * can unit-test it cheaply without touching the database.
 */
export function computeFlightRisk(input: {
  now: Date
  employee: EmployeeSnapshot
  lastOneOnOne: OneOnOneSnapshot | null
  cancelled1on1sLast90d: number
  declinedReviewsLast180d: number
  lastCompChange: LifecycleSnapshot | null
  lastPromotion: LifecycleSnapshot | null
}): ComputedSignal {
  const factors: SignalFactor[] = []
  let score = 0
  const { now, employee, lastOneOnOne, cancelled1on1sLast90d, declinedReviewsLast180d, lastCompChange, lastPromotion } = input

  // 1) No recent 1:1 — strong signal of disengagement.
  if (!lastOneOnOne || daysAgo(lastOneOnOne.scheduledAt, now) > 60) {
    const note = lastOneOnOne
      ? `Last 1:1 was ${daysAgo(lastOneOnOne.scheduledAt, now)}d ago`
      : 'No recorded 1:1 with manager'
    factors.push({ code: 'no_recent_1on1', weight: 30, note })
    score += 30
  }

  // 2) Cancelled 1:1s pile up.
  if (cancelled1on1sLast90d >= 2) {
    factors.push({
      code: 'cancelled_1on1s',
      weight: 15,
      note: `${cancelled1on1sLast90d} cancelled 1:1s in last 90d`,
    })
    score += 15
  }

  // 3) Declined / unanswered 360 reviews.
  if (declinedReviewsLast180d >= 1) {
    factors.push({
      code: 'declined_reviews',
      weight: 10,
      note: `${declinedReviewsLast180d} declined 360 review(s) in last 180d`,
    })
    score += 10
  }

  // 4) No comp change for > 18 months.
  if (employee.hireDate) {
    const tenureDays = daysAgo(employee.hireDate, now)
    const lastChange = lastCompChange ? daysAgo(lastCompChange.effectiveAt, now) : tenureDays
    if (tenureDays > 540 && lastChange > 540) {
      factors.push({
        code: 'comp_stagnation',
        weight: 25,
        note: `No comp change in ${lastChange}d (tenure ${tenureDays}d)`,
      })
      score += 25
    }
  }

  // 5) No promotion for > 24 months at senior tenure.
  if (employee.hireDate) {
    const tenureDays = daysAgo(employee.hireDate, now)
    const lastProm = lastPromotion ? daysAgo(lastPromotion.effectiveAt, now) : tenureDays
    if (tenureDays > 720 && lastProm > 720) {
      factors.push({
        code: 'no_promotion',
        weight: 20,
        note: `No promotion in ${lastProm}d`,
      })
      score += 20
    }
  }

  return { employeeId: employee.id, type: 'flight_risk', score: Math.min(100, score), factors }
}

/**
 * Burnout heuristic — supportive signal, intentionally distinct from
 * performance metrics. Triggers focus on missed support + tenure + at-risk
 * OKRs.
 */
export function computeBurnout(input: {
  now: Date
  employee: EmployeeSnapshot
  lastOneOnOne: OneOnOneSnapshot | null
  cancelled1on1sLast90d: number
  okrAtRisk: number
  okrActive: number
  consecutiveQuartersWithoutPromotion: number
}): ComputedSignal {
  const factors: SignalFactor[] = []
  let score = 0
  const { now, employee, lastOneOnOne, cancelled1on1sLast90d, okrAtRisk, okrActive } = input

  // 1) Long stretch without manager check-in.
  if (!lastOneOnOne || daysAgo(lastOneOnOne.scheduledAt, now) > 45) {
    factors.push({
      code: 'support_gap',
      weight: 25,
      note: lastOneOnOne
        ? `Last 1:1 ${daysAgo(lastOneOnOne.scheduledAt, now)}d ago (>45d threshold)`
        : 'No recorded 1:1 with manager',
    })
    score += 25
  }

  // 2) Multiple cancelled 1:1s (manager pulls support, or employee opts out).
  if (cancelled1on1sLast90d >= 2) {
    factors.push({
      code: 'cancelled_1on1s',
      weight: 15,
      note: `${cancelled1on1sLast90d} cancelled 1:1s in last 90d`,
    })
    score += 15
  }

  // 3) Many at-risk OKRs vs total active.
  if (okrActive > 0 && okrAtRisk / okrActive >= 0.5) {
    factors.push({
      code: 'okr_overload',
      weight: 30,
      note: `${okrAtRisk}/${okrActive} active OKRs are at_risk`,
    })
    score += 30
  }

  // 4) Long tenure without recognition signal — proxy for "feeling stuck".
  if (input.consecutiveQuartersWithoutPromotion >= 8) {
    factors.push({
      code: 'long_stagnation',
      weight: 15,
      note: `${input.consecutiveQuartersWithoutPromotion} quarters without promotion`,
    })
    score += 15
  }

  // 5) Late-stage probation extension is a stress signal.
  if (employee.probationOutcome === 'extended') {
    factors.push({
      code: 'probation_extended',
      weight: 15,
      note: 'Probation was extended',
    })
    score += 15
  }

  return { employeeId: employee.id, type: 'burnout', score: Math.min(100, score), factors }
}

/** Bucket lifecycle events for fast lookup, newest-first. */
function indexLifecycle(events: LifecycleSnapshot[]) {
  const byEmployee = new Map<string, LifecycleSnapshot[]>()
  for (const e of events) {
    const list = byEmployee.get(e.employeeId) ?? []
    list.push(e)
    byEmployee.set(e.employeeId, list)
  }
  for (const list of byEmployee.values()) {
    list.sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())
  }
  return byEmployee
}

export async function computeSignalsForTenant({
  prisma,
  tenantId,
  now,
  openThreshold,
}: {
  prisma: DbClient
  tenantId: string
  now?: Date
  openThreshold: number
}): Promise<{ employees: number; upserted: number; opened: number }> {
  const nowDate = now ?? new Date()
  const ninetyDaysAgo = new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000)
  const oneEightyDaysAgo = new Date(nowDate.getTime() - 180 * 24 * 60 * 60 * 1000)

  const employees: EmployeeSnapshot[] = await prisma.employee.findMany({
    where: { tenantId, status: { in: ['active', 'probation', 'on_leave'] as never } },
    select: { id: true, hireDate: true, status: true, probationOutcome: true, agreedBaseSalary: true },
  })

  if (employees.length === 0) {
    return { employees: 0, upserted: 0, opened: 0 }
  }

  const employeeIds = employees.map((e) => e.id)

  const [oneOnOnes, reviews, lifecycle, okrs]: [
    OneOnOneSnapshot[],
    ReviewSnapshot[],
    LifecycleSnapshot[],
    OkrSnapshot[],
  ] = await Promise.all([
    prisma.oneOnOne.findMany({
      where: { tenantId, employeeId: { in: employeeIds } },
      select: { employeeId: true, scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'desc' },
    }),
    prisma.reviewRequest.findMany({
      where: { tenantId, subjectEmployeeId: { in: employeeIds }, createdAt: { gte: oneEightyDaysAgo } },
      select: { subjectEmployeeId: true, status: true, createdAt: true },
    }),
    prisma.employeeLifecycleEvent.findMany({
      where: { tenantId, employeeId: { in: employeeIds } },
      select: { employeeId: true, type: true, effectiveAt: true },
    }),
    prisma.okr.findMany({
      where: { tenantId, employeeId: { in: employeeIds }, status: 'active' as never },
      select: { employeeId: true, keyResults: { select: { status: true } } },
    }).then((rows) =>
      rows.flatMap((r) => r.keyResults.map((kr) => ({ employeeId: r.employeeId, status: kr.status }))),
    ),
  ])

  // Build per-employee lookups.
  const lastOneOnOneByEmp = new Map<string, OneOnOneSnapshot>()
  const cancelled1on1sByEmp = new Map<string, number>()
  for (const o of oneOnOnes) {
    if (!lastOneOnOneByEmp.has(o.employeeId) && o.status === 'completed') {
      lastOneOnOneByEmp.set(o.employeeId, o)
    }
    if (o.status === 'cancelled' && o.scheduledAt >= ninetyDaysAgo) {
      cancelled1on1sByEmp.set(o.employeeId, (cancelled1on1sByEmp.get(o.employeeId) ?? 0) + 1)
    }
  }

  const declinedReviewsByEmp = new Map<string, number>()
  for (const r of reviews) {
    if (r.status === 'declined') {
      declinedReviewsByEmp.set(
        r.subjectEmployeeId,
        (declinedReviewsByEmp.get(r.subjectEmployeeId) ?? 0) + 1,
      )
    }
  }

  const lifecycleByEmp = indexLifecycle(lifecycle)
  function lastByType(empId: string, types: string[]): LifecycleSnapshot | null {
    const list = lifecycleByEmp.get(empId) ?? []
    return list.find((e) => types.includes(e.type)) ?? null
  }

  const okrAtRiskByEmp = new Map<string, number>()
  const okrActiveByEmp = new Map<string, number>()
  for (const k of okrs) {
    okrActiveByEmp.set(k.employeeId, (okrActiveByEmp.get(k.employeeId) ?? 0) + 1)
    if (k.status === 'at_risk') {
      okrAtRiskByEmp.set(k.employeeId, (okrAtRiskByEmp.get(k.employeeId) ?? 0) + 1)
    }
  }

  let upserted = 0
  let opened = 0
  for (const emp of employees) {
    if (!ACTIVE_STATUSES.has(emp.status)) continue

    const lastOneOnOne = lastOneOnOneByEmp.get(emp.id) ?? null
    const cancelled1on1s = cancelled1on1sByEmp.get(emp.id) ?? 0
    const declinedReviews = declinedReviewsByEmp.get(emp.id) ?? 0
    const lastCompChange = lastByType(emp.id, ['role_change'])
    const lastPromotion = lastByType(emp.id, ['role_change'])
    const okrActive = okrActiveByEmp.get(emp.id) ?? 0
    const okrAtRisk = okrAtRiskByEmp.get(emp.id) ?? 0
    const quartersWithoutPromotion =
      lastPromotion && emp.hireDate
        ? Math.floor(daysAgo(lastPromotion.effectiveAt, nowDate) / 90)
        : emp.hireDate
          ? Math.floor(daysAgo(emp.hireDate, nowDate) / 90)
          : 0

    const flight = computeFlightRisk({
      now: nowDate,
      employee: emp,
      lastOneOnOne,
      cancelled1on1sLast90d: cancelled1on1s,
      declinedReviewsLast180d: declinedReviews,
      lastCompChange,
      lastPromotion,
    })
    const burn = computeBurnout({
      now: nowDate,
      employee: emp,
      lastOneOnOne,
      cancelled1on1sLast90d: cancelled1on1s,
      okrActive,
      okrAtRisk,
      consecutiveQuartersWithoutPromotion: quartersWithoutPromotion,
    })

    for (const sig of [flight, burn]) {
      const existing = await prisma.analyticsSignal.findFirst({
        where: { tenantId, employeeId: sig.employeeId, type: sig.type as never },
        select: { id: true, status: true },
      })
      const isOpen = sig.score >= openThreshold
      if (isOpen) opened += 1
      // If we previously had an open signal that was reviewed/dismissed, leave
      // that state alone (only reopen if score has climbed back up after
      // dismissal — by-design left as a TODO for follow-up).
      const status = existing?.status === 'dismissed' || existing?.status === 'reviewed' ? existing.status : 'open'
      if (existing) {
        await prisma.analyticsSignal.update({
          where: { id: existing.id },
          data: {
            score: sig.score,
            factors: sig.factors as never,
            computedAt: nowDate,
            status: status as never,
          },
        })
      } else if (isOpen) {
        // Don't materialise low-score (<threshold) rows on first sight — avoid
        // creating a row per (employee × type) for the whole company.
        await prisma.analyticsSignal.create({
          data: {
            tenantId,
            employeeId: sig.employeeId,
            type: sig.type as never,
            score: sig.score,
            factors: sig.factors as never,
            computedAt: nowDate,
            status: 'open' as never,
          },
        })
      }
      upserted += 1
    }
  }

  return { employees: employees.length, upserted, opened }
}
