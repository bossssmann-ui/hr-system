import { z } from 'zod'

import { candidateSchema } from './candidates'
import { vacancySchema } from './vacancies'

export const applicationStageSchema = z.enum([
  'new',
  'screen',
  'tech',
  'final',
  'offer',
  'hired',
  'rejected',
])

export type ApplicationStage = z.infer<typeof applicationStageSchema>

export const applicationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  candidateId: z.string(),
  vacancyId: z.string(),
  stage: applicationStageSchema,
  assignedToUserId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Application = z.infer<typeof applicationSchema>

export const applicationDetailSchema = applicationSchema.extend({
  candidate: candidateSchema,
  vacancy: vacancySchema,
})

export type ApplicationDetail = z.infer<typeof applicationDetailSchema>

export const createApplicationRequestSchema = z.object({
  candidateId: z.string().uuid(),
  vacancyId: z.string().uuid(),
})

export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>

export const listApplicationsResponseSchema = z.object({
  items: z.array(applicationSchema),
})

export type ListApplicationsResponse = z.infer<typeof listApplicationsResponseSchema>

export const moveApplicationStageRequestSchema = z.object({
  to: applicationStageSchema,
  comment: z.string().optional(),
})

export type MoveApplicationStageRequest = z.infer<typeof moveApplicationStageRequestSchema>
