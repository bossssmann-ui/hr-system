import { z } from 'zod'

export const vacancySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  isPublished: z.boolean(),
  tenantId: z.string(),
  requisitionId: z.string(),
  orgUnitId: z.string(),
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

export const linkVacancyToHhRequestSchema = z.object({
  hhVacancyId: z.string().min(1).nullable(),
})

export type LinkVacancyToHhRequest = z.infer<typeof linkVacancyToHhRequestSchema>
