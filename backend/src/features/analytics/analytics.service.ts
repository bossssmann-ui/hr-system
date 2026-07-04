/**
 * Phase 7 — HR analytics service.
 *
 * `computeHrSnapshot` aggregates today's KPIs (headcount, hires/terminations
 * MTD, open requisitions, avg time-to-hire, probation pass rate QTD) and
 * upserts a single `HrSnapshot` row for the tenant + date.
 *
 * Intended caller: the daily `analytics.snapshot` job, or the manual
 * `POST /api/analytics/snapshots/compute` route. Idempotent — re-running on
 * the same day overwrites the row.
 */

import type { DbClient } from '../../db'
import { computeEnps } from '../engagement/engagement.service'

export type RecruiterFunnelPeriod = 'today' | 'week' | 'all'

export type RecruiterFunnelCandidate = {
  applicationId: string
  candidateId: string
  unifiedScore: number | null
  scoreStatus: 'preliminary' | 'final'
  verdict: string | null
  trustScore: number | null
  retentionPrediction: Record<string, unknown> | null
  hrNotes: string | null
  createdAt: string
}

export type RecruiterFunnelMetrics = {
  period: RecruiterFunnelPeriod
  newApplications: number
  aiProcessed: number
  passedToRecruiter: number
  aiRejected: number
  manualReview: number
  inProgress: number
  processedCandidates: RecruiterFunnelCandidate[]
}

export type ComputeHrSnapshotInput = {
  prisma: DbClient
  tenantId: string
  /** Defaults to `now`. The snapshot stores the calendar date (UTC). */
  now?: Date
}

export type ComputeHrSnapshotResult = {
  snapshotDate: string
  headcount: number
  headcountByStatus: Record<string, number>
  headcountByOrgUnit: Record<string, number>
  openRequisitions: number
  hiredMtd: number
  terminatedMtd: number
  avgTimeToHireDays: number | null
  probationPassRateQtd: number | null
  enpsScore: number | null
}

const ACTIVE_STATUSES = ['pre_onboarding', 'onboarding', 'probation', 'active', 'notice', 'on_leave'] as const

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfQuarter(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3)
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1))
}

function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function startOfUtcWeek(date: Date): Date {
  const start = toDateOnly(date)
  const day = start.getUTCDay() // 0..6 (Sun..Sat)
  const mondayOffset = day === 0 ? -6 : 1 - day
  start.setUTCDate(start.getUTCDate() + mondayOffset)
  return start
}

function periodStart(period: RecruiterFunnelPeriod, now: Date): Date | null {
  if (period === 'all') return null
  if (period === 'today') return toDateOnly(now)
  return startOfUtcWeek(now)
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return ms / (1000 * 60 * 60 * 24)
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function verdictBucket(verdict: string | null | undefined): 'passed' | 'rejected' | 'manual' | 'other' {
  if (!verdict) return 'other'
  if (verdict === 'ДОПУСТИТЬ' || verdict === 'STRONG_CANDIDATE' || verdict === 'ADMIT_TO_INTERVIEW') return 'passed'
  if (verdict === 'ОТКЛОНИТЬ' || verdict === 'REJECT' || verdict === 'AUTO_REJECT') return 'rejected'
  if (verdict === 'НА РУЧНУЮ ПРОВЕРКУ HR' || verdict === 'MANUAL_REVIEW_HR' || verdict === 'MANUAL_EXCEPTION_ONLY') {
    return 'manual'
  }
  return 'other'
}

export async function computeRecruiterFunnel({
  prisma,
  tenantId,
  period,
  now,
}: {
  prisma: DbClient
  tenantId: string
  period: RecruiterFunnelPeriod
  now?: Date
}): Promise<RecruiterFunnelMetrics> {
  const nowDate = now ?? new Date()
  const from = periodStart(period, nowDate)
  const appWhere = {
    tenantId,
    ...(from ? { createdAt: { gte: from } } : {}),
  }

  const [newApplications, sessions] = await Promise.all([
    prisma.application.count({ where: appWhere }),
    prisma.selectionSession.findMany({
      where: {
        tenantId,
        ...(from ? { createdAt: { gte: from } } : {}),
      },
      include: { verdict: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const aiProcessed = sessions.filter((session) => session.verdict != null).length
  const inProgress = sessions.filter((session) => session.verdict == null).length

  let passedToRecruiter = 0
  let aiRejected = 0
  let manualReview = 0
  for (const session of sessions) {
    const bucket = verdictBucket(session.verdict?.verdict)
    if (bucket === 'passed') passedToRecruiter += 1
    if (bucket === 'rejected') aiRejected += 1
    if (bucket === 'manual') manualReview += 1
  }

  const appIds = Array.from(new Set(sessions.map((session) => session.applicationId).filter((id): id is string => Boolean(id))))
  const [apps, trustRows] = await Promise.all([
    appIds.length > 0
      ? prisma.application.findMany({
          where: {
            tenantId,
            id: { in: appIds },
            ...(from ? { createdAt: { gte: from } } : {}),
          },
          select: { id: true, candidateId: true, aiScore: true, createdAt: true },
        })
      : Promise.resolve([]),
    appIds.length > 0
      ? prisma.assessmentSession.findMany({
          where: { tenantId, applicationId: { in: appIds } },
          select: { applicationId: true, trustScore: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
  ])

  const appById = new Map(apps.map((app) => [app.id, app]))
  const trustByApp = new Map<string, number | null>()
  for (const row of trustRows) {
    if (!trustByApp.has(row.applicationId)) {
      trustByApp.set(row.applicationId, row.trustScore)
    }
  }

  const processedCandidates = sessions
    .filter((session) => session.applicationId && session.verdict)
    .map((session) => {
      const app = appById.get(session.applicationId!)
      const finalScore = session.verdict?.totalWeightedScore != null ? Number(session.verdict.totalWeightedScore) : null
      const fallbackScore = app?.aiScore != null ? Number(app.aiScore) : null
      return {
        applicationId: session.applicationId!,
        candidateId: app?.candidateId ?? session.applicationId!,
        unifiedScore: finalScore ?? fallbackScore,
        scoreStatus: finalScore != null ? 'final' as const : 'preliminary' as const,
        verdict: session.verdict?.verdict ?? null,
        trustScore: trustByApp.get(session.applicationId!) ?? null,
        retentionPrediction:
          session.verdict?.retentionPrediction && typeof session.verdict.retentionPrediction === 'object'
            ? (session.verdict.retentionPrediction as Record<string, unknown>)
            : null,
        hrNotes: session.verdict?.hrNotes ?? null,
        createdAt: session.createdAt.toISOString(),
      }
    })

  return {
    period,
    newApplications,
    aiProcessed,
    passedToRecruiter,
    aiRejected,
    manualReview,
    inProgress,
    processedCandidates,
  }
}

export async function computeHrSnapshot({
  prisma,
  tenantId,
  now,
}: ComputeHrSnapshotInput): Promise<ComputeHrSnapshotResult> {
  const nowDate = now ?? new Date()
  const monthStart = startOfMonth(nowDate)
  const quarterStart = startOfQuarter(nowDate)
  const snapshotDate = toDateOnly(nowDate)

  // ── Headcount + breakdowns ──────────────────────────────────────────────
  const employees = await prisma.employee.findMany({
    where: { tenantId },
    select: { id: true, status: true, orgUnitId: true, hireDate: true, terminatedAt: true, probationOutcome: true },
  })

  const headcountByStatus: Record<string, number> = {}
  const headcountByOrgUnit: Record<string, number> = {}
  let headcount = 0
  for (const emp of employees) {
    if ((ACTIVE_STATUSES as readonly string[]).includes(emp.status)) {
      headcount += 1
      headcountByStatus[emp.status] = (headcountByStatus[emp.status] ?? 0) + 1
      const key = emp.orgUnitId ?? 'unassigned'
      headcountByOrgUnit[key] = (headcountByOrgUnit[key] ?? 0) + 1
    }
  }

  // ── Open requisitions ───────────────────────────────────────────────────
  const openRequisitions = await prisma.hiringRequisition.count({
    where: { tenantId, status: { in: ['approved', 'in_recruitment'] as never } },
  })

  // ── Hired / terminated MTD ──────────────────────────────────────────────
  let hiredMtd = 0
  let terminatedMtd = 0
  for (const emp of employees) {
    if (emp.hireDate && emp.hireDate >= monthStart) hiredMtd += 1
    if (emp.terminatedAt && emp.terminatedAt >= monthStart) terminatedMtd += 1
  }

  // ── Avg time-to-hire (days) for applications hired this month ──────────
  const hiredApps = await prisma.application.findMany({
    where: { tenantId, stage: 'hired' as never, updatedAt: { gte: monthStart } },
    select: { createdAt: true, updatedAt: true },
  })
  let avgTimeToHireDays: number | null = null
  if (hiredApps.length > 0) {
    const total = hiredApps.reduce((sum, app) => sum + daysBetween(app.createdAt, app.updatedAt), 0)
    avgTimeToHireDays = roundTo(total / hiredApps.length, 2)
  }

  // ── Probation pass rate QTD ─────────────────────────────────────────────
  // Pool: employees whose probation reached a terminal decision (passed or
  // failed) AND who were hired in the current quarter. `extended` is
  // intentionally excluded since the outcome is still pending.
  let probationPassRateQtd: number | null = null
  const decidedThisQuarter = employees.filter(
    (e) =>
      (e.probationOutcome === 'passed' || e.probationOutcome === 'failed') &&
      e.hireDate != null && e.hireDate >= quarterStart,
  )
  if (decidedThisQuarter.length > 0) {
    const passed = decidedThisQuarter.filter((e) => e.probationOutcome === 'passed').length
    probationPassRateQtd = roundTo((passed / decidedThisQuarter.length) * 100, 2)
  }

  // ── eNPS — last closed eNPS survey for the tenant ──────────────────────
  let enpsScore: number | null = null
  const lastEnpsSurvey = await prisma.engagementSurvey.findFirst({
    where: { tenantId, kind: 'enps', status: 'closed' },
    orderBy: { closedAt: 'desc' },
    select: { id: true },
  })
  if (lastEnpsSurvey) {
    const responses = await prisma.surveyResponse.findMany({
      where: { surveyId: lastEnpsSurvey.id, tenantId },
      select: { score: true },
    })
    const scores = responses.map((r) => r.score)
    if (scores.length > 0) {
      enpsScore = computeEnps(scores).score
    }
  }

  await prisma.hrSnapshot.upsert({
    where: { tenantId_snapshotDate: { tenantId, snapshotDate } },
    update: {
      headcount,
      headcountByStatus,
      headcountByOrgUnit,
      openRequisitions,
      hiredMtd,
      terminatedMtd,
      avgTimeToHireDays,
      probationPassRateQtd,
      enpsScore,
    },
    create: {
      tenantId,
      snapshotDate,
      headcount,
      headcountByStatus,
      headcountByOrgUnit,
      openRequisitions,
      hiredMtd,
      terminatedMtd,
      avgTimeToHireDays,
      probationPassRateQtd,
      enpsScore,
    },
  })

  return {
    snapshotDate: snapshotDate.toISOString().slice(0, 10),
    headcount,
    headcountByStatus,
    headcountByOrgUnit,
    openRequisitions,
    hiredMtd,
    terminatedMtd,
    avgTimeToHireDays,
    probationPassRateQtd,
    enpsScore,
  }
}

/**
 * Build a payroll export for the given month. Rows are HR-approved comp
 * data for every employee that was on the books at any point in the month.
 *
 * Returns plain rows (the route serialises to CSV); kept testable in
 * isolation so the format never depends on Hono / request context.
 */

export type PayrollExportRow = {
  employeeId: string
  fullName: string
  email: string | null
  jobTitle: string | null
  orgUnitId: string | null
  status: string
  grade: string | null
  currency: string | null
  baseSalary: number | null
  hireDate: string | null
  terminatedAt: string | null
}

export async function buildPayrollExport({
  prisma,
  tenantId,
  month,
}: {
  prisma: DbClient
  tenantId: string
  /** Format: YYYY-MM. */
  month: string
}): Promise<{ month: string; rows: PayrollExportRow[] }> {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new Error('month must be YYYY-MM')
  const year = Number(match[1])
  const m = Number(match[2])
  const periodStart = new Date(Date.UTC(year, m - 1, 1))
  const periodEnd = new Date(Date.UTC(year, m, 1))

  const employees = await prisma.employee.findMany({
    where: {
      tenantId,
      OR: [
        // Hired before or in this period
        { hireDate: { lt: periodEnd } },
        // Or never had hireDate (pre_onboarding only counts if not terminated)
        { hireDate: null },
      ],
      AND: [
        {
          OR: [
            { terminatedAt: null },
            { terminatedAt: { gte: periodStart } },
          ],
        },
      ],
    },
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      email: true,
      jobTitle: true,
      orgUnitId: true,
      status: true,
      grade: true,
      currency: true,
      agreedBaseSalary: true,
      hireDate: true,
      terminatedAt: true,
    },
  })

  const rows: PayrollExportRow[] = employees.map((e) => ({
    employeeId: e.id,
    fullName: e.fullName,
    email: e.email ?? null,
    jobTitle: e.jobTitle ?? null,
    orgUnitId: e.orgUnitId ?? null,
    status: e.status,
    grade: e.grade ?? null,
    currency: e.currency ?? null,
    baseSalary: e.agreedBaseSalary ?? null,
    hireDate: e.hireDate ? e.hireDate.toISOString().slice(0, 10) : null,
    terminatedAt: e.terminatedAt ? e.terminatedAt.toISOString().slice(0, 10) : null,
  }))

  return { month, rows }
}

/** CSV serialisation for payroll export rows. RFC 4180 minimal quoting. */
export function payrollRowsToCsv(rows: PayrollExportRow[]): string {
  const header = [
    'employee_id',
    'full_name',
    'email',
    'job_title',
    'org_unit_id',
    'status',
    'grade',
    'currency',
    'base_salary',
    'hire_date',
    'terminated_at',
  ]
  const escape = (v: string | number | null): string => {
    if (v == null) return ''
    const s = String(v)
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.employeeId,
        r.fullName,
        r.email,
        r.jobTitle,
        r.orgUnitId,
        r.status,
        r.grade,
        r.currency,
        r.baseSalary,
        r.hireDate,
        r.terminatedAt,
      ]
        .map(escape)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}
