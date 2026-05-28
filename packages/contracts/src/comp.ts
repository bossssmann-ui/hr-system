import { z } from 'zod'

import { offerCurrencySchema } from './offers'

export const compBandSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  grade: z.string(),
  currency: offerCurrencySchema,
  minSalary: z.number().int().nonnegative(),
  midSalary: z.number().int().nonnegative(),
  maxSalary: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type CompBand = z.infer<typeof compBandSchema>

export const compBandCreateRequestSchema = z
  .object({
    grade: z.string().min(1),
    currency: offerCurrencySchema,
    minSalary: z.number().int().positive(),
    midSalary: z.number().int().positive(),
    maxSalary: z.number().int().positive(),
  })
  .refine((d) => d.minSalary <= d.midSalary && d.midSalary <= d.maxSalary, {
    message: 'minSalary <= midSalary <= maxSalary required',
  })

export type CompBandCreateRequest = z.infer<typeof compBandCreateRequestSchema>

export const compBandUpdateRequestSchema = z
  .object({
    grade: z.string().min(1).optional(),
    currency: offerCurrencySchema.optional(),
    minSalary: z.number().int().positive().optional(),
    midSalary: z.number().int().positive().optional(),
    maxSalary: z.number().int().positive().optional(),
  })
  .refine(
    (d) => {
      if (d.minSalary === undefined && d.midSalary === undefined && d.maxSalary === undefined) {
        return true
      }
      if (d.minSalary !== undefined && d.midSalary !== undefined && d.minSalary > d.midSalary) return false
      if (d.midSalary !== undefined && d.maxSalary !== undefined && d.midSalary > d.maxSalary) return false
      return true
    },
    { message: 'minSalary <= midSalary <= maxSalary required' },
  )

export type CompBandUpdateRequest = z.infer<typeof compBandUpdateRequestSchema>

export const listCompBandsResponseSchema = z.object({
  items: z.array(compBandSchema),
})

export type ListCompBandsResponse = z.infer<typeof listCompBandsResponseSchema>

export const compZoneSchema = z.enum(['below', 'within', 'above'])
export type CompZone = z.infer<typeof compZoneSchema>

export const compCalculatorQuerySchema = z.object({
  grade: z.string().min(1),
  salary: z.coerce.number().int().positive(),
  currency: offerCurrencySchema,
})

export type CompCalculatorQuery = z.infer<typeof compCalculatorQuerySchema>

export const compCalculatorResponseSchema = z.object({
  band: compBandSchema.nullable(),
  percentile: z.number().int().min(0).max(100).nullable(),
  zone: compZoneSchema.nullable(),
})

export type CompCalculatorResponse = z.infer<typeof compCalculatorResponseSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Compensation planning (raises / promotions cycle)
// ─────────────────────────────────────────────────────────────────────────────

export const compPlanStatusSchema = z.enum(['draft', 'approved', 'applied'])
export type CompPlanStatus = z.infer<typeof compPlanStatusSchema>

const decimalString = z.union([z.number(), z.string()])

export const compPlanItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
  employeeId: z.string().uuid(),
  currentSalary: z.number().int().nonnegative(),
  proposedSalary: z.number().int().nonnegative(),
  currency: offerCurrencySchema,
  changePct: decimalString,
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type CompPlanItem = z.infer<typeof compPlanItemSchema>

export const compPlanSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  effectiveDate: z.string(),
  budgetCurrency: offerCurrencySchema,
  budgetTotal: z.number().int().nonnegative(),
  status: compPlanStatusSchema,
  notes: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  approvedByUserId: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  appliedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  items: z.array(compPlanItemSchema).optional(),
})
export type CompPlan = z.infer<typeof compPlanSchema>

export const compPlanCreateRequestSchema = z.object({
  name: z.string().min(1).max(200),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must be YYYY-MM-DD'),
  budgetCurrency: offerCurrencySchema,
  budgetTotal: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional(),
})
export type CompPlanCreateRequest = z.infer<typeof compPlanCreateRequestSchema>

export const compPlanUpdateRequestSchema = compPlanCreateRequestSchema.partial()
export type CompPlanUpdateRequest = z.infer<typeof compPlanUpdateRequestSchema>

export const compPlanItemCreateRequestSchema = z
  .object({
    employeeId: z.string().uuid(),
    currentSalary: z.number().int().nonnegative(),
    proposedSalary: z.number().int().nonnegative(),
    currency: offerCurrencySchema,
    reason: z.string().max(500).optional(),
  })
  .refine((d) => d.proposedSalary > 0 || d.currentSalary > 0, {
    message: 'proposedSalary or currentSalary must be > 0',
  })
export type CompPlanItemCreateRequest = z.infer<typeof compPlanItemCreateRequestSchema>

export const compPlanItemUpdateRequestSchema = z.object({
  proposedSalary: z.number().int().nonnegative().optional(),
  reason: z.string().max(500).optional(),
})
export type CompPlanItemUpdateRequest = z.infer<typeof compPlanItemUpdateRequestSchema>

export const listCompPlansResponseSchema = z.object({
  items: z.array(compPlanSchema),
})
export type ListCompPlansResponse = z.infer<typeof listCompPlansResponseSchema>
