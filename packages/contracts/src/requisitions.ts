import { z } from 'zod'

/**
 * Phase 0 surfaces a single read-only endpoint for hiring requisitions so the
 * `/requisitions` page in the web client has real data to render. Mutating
 * routes (create, submit, approve) land in Phase 0.x alongside the FSM-driven
 * UI.
 */

export const requisitionStatusSchema = z.enum([
  'draft',
  'submitted',
  'manager_approved',
  'hr_approved',
  'approved',
  'in_recruitment',
  'closed',
  'rejected',
])

export type RequisitionStatus = z.infer<typeof requisitionStatusSchema>

export const currencySchema = z.enum(['RUB', 'USD', 'THB', 'USDT'])
export type Currency = z.infer<typeof currencySchema>

export const requisitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  grade: z.string(),
  salaryMin: z.number().int(),
  salaryMax: z.number().int(),
  currency: currencySchema,
  status: requisitionStatusSchema,
  orgUnitId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Requisition = z.infer<typeof requisitionSchema>

export const listRequisitionsResponseSchema = z.object({
  items: z.array(requisitionSchema),
})

export type ListRequisitionsResponse = z.infer<typeof listRequisitionsResponseSchema>
