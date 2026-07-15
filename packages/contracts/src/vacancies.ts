import { z } from 'zod'

export const vacancyRoleSchema = z.enum(['logist_domestic', 'logist', 'sales_manager'])
export type VacancyRole = z.infer<typeof vacancyRoleSchema>

export const vacancySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  role: vacancyRoleSchema.nullable().optional(),
  requiredAssessmentTemplateIds: z.array(z.string()).default([]),
  isPublished: z.boolean(),
  tenantId: z.string(),
  requisitionId: z.string(),
  orgUnitId: z.string(),
  slug: z.string().nullable().optional(),
  hhVacancyId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Vacancy = z.infer<typeof vacancySchema>

export const listVacanciesResponseSchema = z.object({
  items: z.array(vacancySchema),
})

export type ListVacanciesResponse = z.infer<typeof listVacanciesResponseSchema>

export const publishVacancyRequestSchema = z.object({
  isPublished: z.boolean(),
})

export type PublishVacancyRequest = z.infer<typeof publishVacancyRequestSchema>

export const updateVacancyRoleRequestSchema = z.object({
  role: vacancyRoleSchema.nullable(),
})

export type UpdateVacancyRoleRequest = z.infer<typeof updateVacancyRoleRequestSchema>

export const linkVacancyToHhRequestSchema = z.object({
  hhVacancyId: z.string().min(1).nullable(),
})

export type LinkVacancyToHhRequest = z.infer<typeof linkVacancyToHhRequestSchema>

export const updateVacancyAssessmentTemplatesRequestSchema = z.object({
  requiredAssessmentTemplateIds: z.array(z.string()).optional(),
})

export type UpdateVacancyAssessmentTemplatesRequest = z.infer<typeof updateVacancyAssessmentTemplatesRequestSchema>

// ─── Public careers API contracts ────────────────────────────────────────────

/** Public-safe vacancy fields — no internal ids, no salary, no requisition details. */
export const publicVacancySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
})

export type PublicVacancy = z.infer<typeof publicVacancySchema>

export const listPublicVacanciesResponseSchema = z.object({
  items: z.array(publicVacancySchema),
})

export type ListPublicVacanciesResponse = z.infer<typeof listPublicVacanciesResponseSchema>

export const publicApplyRequestSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().min(1).max(50).optional(),
  cover_note: z.string().max(5000).optional(),
  resume_link: z.string().url().optional(),
  resume_text: z.string().max(20000).optional(),
  consent: z.boolean(),
  /** Honeypot — must be absent or empty string; filled submissions are rejected. */
  website: z.string().optional(),
})

export type PublicApplyRequest = z.infer<typeof publicApplyRequestSchema>

export const publicApplyResponseSchema = z.object({
  reference: z.string(),
  message: z.string(),
})

export type PublicApplyResponse = z.infer<typeof publicApplyResponseSchema>
