import { z } from 'zod'

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
  justification: z.string(),
  status: requisitionStatusSchema,
  orgUnitId: z.string(),
  createdByUserId: z.string(),
  deadlineAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Requisition = z.infer<typeof requisitionSchema>

export const listRequisitionsResponseSchema = z.object({
  items: z.array(requisitionSchema),
})

export type ListRequisitionsResponse = z.infer<typeof listRequisitionsResponseSchema>

export const createRequisitionRequestSchema = z.object({
  orgUnitId: z.string().uuid(),
  title: z.string().min(1).max(200),
  grade: z.string().min(1).max(50),
  salaryMin: z.number().int().min(0),
  salaryMax: z.number().int().min(0),
  currency: currencySchema,
  justification: z.string().min(1),
  deadlineAt: z.string().datetime().optional(),
})

export type CreateRequisitionRequest = z.infer<typeof createRequisitionRequestSchema>

export const transitionRequisitionRequestSchema = z.object({
  to: requisitionStatusSchema,
  comment: z.string().optional(),
})

export type TransitionRequisitionRequest = z.infer<typeof transitionRequisitionRequestSchema>
