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

export const aiScoringStatusSchema = z.enum([
  'not_configured',
  'not_scored',
  'pending',
  'scored',
  'failed',
])

export const aiScoringResultSchema = z.object({
  relevance_score: z.number().int().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  soft_skills_signals: z.array(z.string()),
  red_flags: z.array(z.string()),
  anti_fraud_signals: z.array(z.string()),
  values_fit_hypothesis: z.string(),
  interview_focus_areas: z.array(z.string()),
  model: z.string(),
  scored_at: z.string().datetime(),
  schema_version: z.number().int(),
})

export const aiScoringErrorSchema = z.object({
  error: z.string(),
  model: z.string(),
  scored_at: z.string().datetime(),
})

export const aiScoringSchema = z.object({
  status: aiScoringStatusSchema,
  input_hash: z.string().optional(),
  result: aiScoringResultSchema.optional(),
  failure: aiScoringErrorSchema.optional(),
})

export const aiScoreFeedbackSchema = z.object({
  user_id: z.string().uuid(),
  agrees: z.boolean(),
  note: z.string().nullable(),
  created_at: z.string().datetime(),
})

export const applicationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  candidateId: z.string(),
  vacancyId: z.string(),
  stage: applicationStageSchema,
  assignedToUserId: z.string().nullable(),
  notes: z.string().nullable(),
  aiScoring: aiScoringSchema.nullable().optional(),
  aiScoreFeedback: aiScoreFeedbackSchema.nullable().optional(),
  externalIds: z.record(z.string(), z.unknown()).optional().default({}),
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

export const scoreFeedbackRequestSchema = z.object({
  agrees: z.boolean(),
  note: z.string().max(2000).optional(),
})

export type ScoreFeedbackRequest = z.infer<typeof scoreFeedbackRequestSchema>
