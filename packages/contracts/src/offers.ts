import { z } from 'zod'

export const offerStatusSchema = z.enum([
  'draft',
  'manager_review',
  'approved',
  'sent',
  'accepted',
  'declined',
  'expired',
])

export type OfferStatus = z.infer<typeof offerStatusSchema>

export const offerCurrencySchema = z.enum(['RUB', 'USD', 'THB', 'USDT'])

export type OfferCurrency = z.infer<typeof offerCurrencySchema>

export const offerSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  applicationId: z.string(),
  interviewId: z.string().nullable(),
  salary: z.number().int().positive(),
  currency: offerCurrencySchema,
  startDate: z.string(),
  grade: z.string().nullable(),
  conditions: z.array(z.string()).default([]),
  status: offerStatusSchema,
  docusealSubmissionId: z.string().nullable(),
  docusealDocumentUrl: z.string().nullable(),
  docusealSigningUrl: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  declinedAt: z.string().datetime().nullable(),
  declinedReason: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Offer = z.infer<typeof offerSchema>

export const createOfferRequestSchema = z.object({
  applicationId: z.string().uuid(),
  interviewId: z.string().uuid().optional(),
  salary: z.number().int().positive().optional(),
  currency: offerCurrencySchema.optional(),
  startDate: z.string().optional(),
  grade: z.string().optional(),
  conditions: z.array(z.string()).optional(),
})

export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>

export const updateOfferRequestSchema = z.object({
  salary: z.number().int().positive().optional(),
  currency: offerCurrencySchema.optional(),
  startDate: z.string().optional(),
  grade: z.string().nullable().optional(),
  conditions: z.array(z.string()).optional(),
})

export type UpdateOfferRequest = z.infer<typeof updateOfferRequestSchema>

export const rejectOfferRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
})

export type RejectOfferRequest = z.infer<typeof rejectOfferRequestSchema>

export const declineOfferRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
})

export type DeclineOfferRequest = z.infer<typeof declineOfferRequestSchema>

export const listOffersResponseSchema = z.object({
  items: z.array(offerSchema),
})

export type ListOffersResponse = z.infer<typeof listOffersResponseSchema>
