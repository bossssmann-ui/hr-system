import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// HR snapshot — Phase 7 daily KPI rollup
// ─────────────────────────────────────────────────────────────────────────────

const numericString = z.union([z.number(), z.string()])

export const hrSnapshotSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  snapshotDate: z.string(),
  headcount: z.number().int().nonnegative(),
  headcountByStatus: z.record(z.string(), z.number().int().nonnegative()),
  headcountByOrgUnit: z.record(z.string(), z.number().int().nonnegative()),
  openRequisitions: z.number().int().nonnegative(),
  hiredMtd: z.number().int().nonnegative(),
  terminatedMtd: z.number().int().nonnegative(),
  avgTimeToHireDays: numericString.nullable(),
  probationPassRateQtd: numericString.nullable(),
  createdAt: z.string().datetime(),
})

export type HrSnapshot = z.infer<typeof hrSnapshotSchema>

export const listHrSnapshotsResponseSchema = z.object({
  items: z.array(hrSnapshotSchema),
})

export type ListHrSnapshotsResponse = z.infer<typeof listHrSnapshotsResponseSchema>

export const hrDashboardSchema = z.object({
  snapshotDate: z.string(),
  headcount: z.number().int().nonnegative(),
  headcountByStatus: z.record(z.string(), z.number().int().nonnegative()),
  headcountByOrgUnit: z.record(z.string(), z.number().int().nonnegative()),
  openRequisitions: z.number().int().nonnegative(),
  hiredMtd: z.number().int().nonnegative(),
  terminatedMtd: z.number().int().nonnegative(),
  avgTimeToHireDays: z.number().nullable(),
  probationPassRateQtd: z.number().nullable(),
})

export type HrDashboard = z.infer<typeof hrDashboardSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Payroll export — Phase 7
// ─────────────────────────────────────────────────────────────────────────────

export const payrollExportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  format: z.enum(['csv', 'json']).default('json'),
})

export type PayrollExportQuery = z.infer<typeof payrollExportQuerySchema>

export const payrollExportRowSchema = z.object({
  employeeId: z.string().uuid(),
  fullName: z.string(),
  email: z.string().nullable(),
  jobTitle: z.string().nullable(),
  orgUnitId: z.string().uuid().nullable(),
  status: z.string(),
  grade: z.string().nullable(),
  currency: z.string().nullable(),
  baseSalary: z.number().int().nullable(),
  hireDate: z.string().nullable(),
  terminatedAt: z.string().nullable(),
})

export type PayrollExportRow = z.infer<typeof payrollExportRowSchema>

export const payrollExportResponseSchema = z.object({
  month: z.string(),
  rows: z.array(payrollExportRowSchema),
})

export type PayrollExportResponse = z.infer<typeof payrollExportResponseSchema>
