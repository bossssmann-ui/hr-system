/**
 * Contracts for Horizon 8 — eNPS / Engagement Surveys module.
 */

import { z } from 'zod'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const engagementSurveyKindSchema = z.enum(['enps', 'pulse'])
export type EngagementSurveyKind = z.infer<typeof engagementSurveyKindSchema>

export const engagementSurveyStatusSchema = z.enum(['draft', 'open', 'closed'])
export type EngagementSurveyStatus = z.infer<typeof engagementSurveyStatusSchema>

// ─── EngagementSurvey DTO ────────────────────────────────────────────────────

export const engagementSurveySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string(),
  kind: engagementSurveyKindSchema,
  status: engagementSurveyStatusSchema,
  question: z.string(),
  openedAt: z.string().datetime().nullable(),
  closesAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type EngagementSurvey = z.infer<typeof engagementSurveySchema>

// ─── SurveyResponse DTO ──────────────────────────────────────────────────────

export const surveyResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  surveyId: z.string().uuid(),
  respondentEmployeeId: z.string().uuid(),
  score: z.number().int().min(0).max(10),
  comment: z.string().nullable(),
  submittedAt: z.string().datetime(),
})
export type SurveyResponse = z.infer<typeof surveyResponseSchema>

// ─── eNPS aggregate ──────────────────────────────────────────────────────────

export const enpsResultSchema = z.object({
  /** eNPS score: round(%promoters − %detractors), range −100..+100 */
  score: z.number().int(),
  promoters: z.number().int(),
  passives: z.number().int(),
  detractors: z.number().int(),
  responded: z.number().int(),
  total: z.number().int(),
  /** Number of responses per score (0–10). */
  distribution: z.record(z.string(), z.number().int()),
})
export type EnpsResult = z.infer<typeof enpsResultSchema>

// ─── Request schemas ─────────────────────────────────────────────────────────

export const createEngagementSurveyRequestSchema = z.object({
  title: z.string().min(1),
  kind: engagementSurveyKindSchema,
  question: z.string().min(1),
  closesAt: z.string().datetime().optional(),
})
export type CreateEngagementSurveyRequest = z.infer<typeof createEngagementSurveyRequestSchema>

export const patchEngagementSurveyRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    closesAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' })
export type PatchEngagementSurveyRequest = z.infer<typeof patchEngagementSurveyRequestSchema>

export const submitSurveyResponseRequestSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().optional(),
})
export type SubmitSurveyResponseRequest = z.infer<typeof submitSurveyResponseRequestSchema>

export const listEngagementSurveysQuerySchema = z.object({
  status: engagementSurveyStatusSchema.optional(),
  kind: engagementSurveyKindSchema.optional(),
})
export type ListEngagementSurveysQuery = z.infer<typeof listEngagementSurveysQuerySchema>
