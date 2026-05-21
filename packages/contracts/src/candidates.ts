import { z } from 'zod'

export const candidateSourceSchema = z.enum([
  'manual',
  'hh_ru',
  'sberpodbor',
  'avito',
  'rabota_ru',
  'referral',
  'careers_page',
])

export type CandidateSource = z.infer<typeof candidateSourceSchema>

export const candidateSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  source: candidateSourceSchema,
  externalIds: z.record(z.string(), z.unknown()).optional().default({}),
  consentContext: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Candidate = z.infer<typeof candidateSchema>

export const createCandidateRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(50).optional(),
  location: z.string().max(200).optional(),
})

export type CreateCandidateRequest = z.infer<typeof createCandidateRequestSchema>

export const createCandidateResponseSchema = z.object({
  candidate: candidateSchema,
  deduped: z.boolean(),
})

export type CreateCandidateResponse = z.infer<typeof createCandidateResponseSchema>

export const listCandidatesResponseSchema = z.object({
  items: z.array(candidateSchema),
})

export type ListCandidatesResponse = z.infer<typeof listCandidatesResponseSchema>
