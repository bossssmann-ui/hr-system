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
