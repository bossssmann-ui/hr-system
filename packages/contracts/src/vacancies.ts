import { z } from 'zod'

export const vacancySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  isPublished: z.boolean(),
  tenantId: z.string(),
  requisitionId: z.string(),
  orgUnitId: z.string(),
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
