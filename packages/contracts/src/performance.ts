/**
 * Contracts for Horizon 4 — Performance module.
 *
 * Standalone 1:1 (OneOnOne) endpoint schemas.
 * The employee-scoped variants live in `learning.ts` and remain unchanged.
 */

import { z } from 'zod'

// ─── OneOnOne status ─────────────────────────────────────────────────────────

export const performanceOneOnOneStatusSchema = z.enum(['scheduled', 'completed', 'cancelled'])
export type PerformanceOneOnOneStatus = z.infer<typeof performanceOneOnOneStatusSchema>

// ─── Action item (complete-request shape) ────────────────────────────────────

export const performanceActionItemSchema = z.object({
  text: z.string().min(1),
  assigneeUserId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
})
export type PerformanceActionItem = z.infer<typeof performanceActionItemSchema>

// ─── Create request ──────────────────────────────────────────────────────────

export const createOneOnOneRequestSchema = z.object({
  employeeId: z.string().uuid(),
  managerUserId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  agenda: z.string().optional(),
})
export type CreateOneOnOneRequest = z.infer<typeof createOneOnOneRequestSchema>

// ─── Patch request (reschedule / edit agenda / durationMinutes) ──────────────

export const patchOneOnOneRequestSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  agenda: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
})
export type PatchOneOnOneRequest = z.infer<typeof patchOneOnOneRequestSchema>

// ─── Complete request ────────────────────────────────────────────────────────

export const completeOneOnOneRequestSchema = z.object({
  notes: z.string().optional(),
  actionItems: z.array(performanceActionItemSchema).optional(),
})
export type CompleteOneOnOneRequest = z.infer<typeof completeOneOnOneRequestSchema>

// ─── Response DTO ────────────────────────────────────────────────────────────

export const oneOnOneResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  managerUserId: z.string(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().nullable(),
  status: performanceOneOnOneStatusSchema,
  agenda: z.string().nullable(),
  notes: z.string().nullable(),
  actionItems: z.array(performanceActionItemSchema),
  reminderSentAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type OneOnOneResponse = z.infer<typeof oneOnOneResponseSchema>

// ─── List response ───────────────────────────────────────────────────────────

export const listOneOnOnesResponseSchema = z.object({
  items: z.array(oneOnOneResponseSchema),
  total: z.number().int(),
})
export type ListOneOnOnesResponse = z.infer<typeof listOneOnOnesResponseSchema>

// ─── 360 Reviews ──────────────────────────────────────────────────────────────

export const performanceReviewCycleStatusSchema = z.enum(['draft', 'open', 'closed'])
export type PerformanceReviewCycleStatus = z.infer<typeof performanceReviewCycleStatusSchema>

export const performanceReviewRequestStatusSchema = z.enum(['pending', 'submitted', 'declined'])
export type PerformanceReviewRequestStatus = z.infer<typeof performanceReviewRequestStatusSchema>

export const performanceReviewRelationshipSchema = z.enum(['self', 'manager', 'peer', 'report'])
export type PerformanceReviewRelationship = z.infer<typeof performanceReviewRelationshipSchema>

export const performanceReviewQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(['rating', 'text']).optional(),
})
export type PerformanceReviewQuestion = z.infer<typeof performanceReviewQuestionSchema>

export const createReviewCycleRequestSchema = z.object({
  title: z.string().min(1),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q1'),
  questions: z.array(performanceReviewQuestionSchema).default([]),
})
export type CreateReviewCycleRequest = z.infer<typeof createReviewCycleRequestSchema>

export const patchReviewCycleRequestSchema = z.object({
  title: z.string().min(1).optional(),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q1').optional(),
  questions: z.array(performanceReviewQuestionSchema).optional(),
})
export type PatchReviewCycleRequest = z.infer<typeof patchReviewCycleRequestSchema>

export const openReviewCycleRequestSchema = z.object({
  closesAt: z.string().datetime(),
})
export type OpenReviewCycleRequest = z.infer<typeof openReviewCycleRequestSchema>

export const createReviewRequestsRequestSchema = z.object({
  subjectEmployeeId: z.string().uuid(),
  reviewers: z
    .array(
      z.object({
        reviewerUserId: z.string().uuid(),
        relationship: performanceReviewRelationshipSchema,
      }),
    )
    .min(1),
})
export type CreateReviewRequestsRequest = z.infer<typeof createReviewRequestsRequestSchema>

export const submitReviewRequestSchema = z.object({
  response: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
})
export type SubmitReviewRequest = z.infer<typeof submitReviewRequestSchema>

export const declineReviewRequestSchema = z.object({
  reason: z.string().min(1).max(500),
})
export type DeclineReviewRequest = z.infer<typeof declineReviewRequestSchema>

export const reviewCycleResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  quarter: z.string(),
  status: performanceReviewCycleStatusSchema,
  questions: z.array(performanceReviewQuestionSchema),
  openedAt: z.string().datetime().nullable(),
  closesAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ReviewCycleResponse = z.infer<typeof reviewCycleResponseSchema>

export const reviewRequestResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  cycleId: z.string(),
  subjectEmployeeId: z.string(),
  reviewerUserId: z.string(),
  relationship: performanceReviewRelationshipSchema.or(z.string()),
  status: performanceReviewRequestStatusSchema,
  response: z.unknown().nullable(),
  declineReason: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  declinedAt: z.string().datetime().nullable(),
  reminderSentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ReviewRequestResponse = z.infer<typeof reviewRequestResponseSchema>

export const reviewCycleStatsSchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  submitted: z.number().int(),
  declined: z.number().int(),
})
export type ReviewCycleStats = z.infer<typeof reviewCycleStatsSchema>

export const reviewCycleWithStatsResponseSchema = reviewCycleResponseSchema.extend({
  stats: reviewCycleStatsSchema,
})
export type ReviewCycleWithStatsResponse = z.infer<typeof reviewCycleWithStatsResponseSchema>

export const reviewSubjectRelationshipBreakdownSchema = z.object({
  relationship: performanceReviewRelationshipSchema.or(z.string()),
  submitted: z.number().int(),
  total: z.number().int(),
})
export type ReviewSubjectRelationshipBreakdown = z.infer<typeof reviewSubjectRelationshipBreakdownSchema>

export const reviewSubjectQuestionAggregateSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  type: z.enum(['rating', 'text', 'mixed']),
  numericAverage: z.number().nullable(),
  textResponses: z.array(z.string()),
})
export type ReviewSubjectQuestionAggregate = z.infer<typeof reviewSubjectQuestionAggregateSchema>

export const reviewSubjectSubmissionSchema = z.object({
  requestId: z.string(),
  reviewerUserId: z.string(),
  relationship: performanceReviewRelationshipSchema.or(z.string()),
  response: z.unknown(),
  submittedAt: z.string().datetime(),
})
export type ReviewSubjectSubmission = z.infer<typeof reviewSubjectSubmissionSchema>

export const reviewSubjectResultsResponseSchema = z.object({
  cycleId: z.string(),
  subjectEmployeeId: z.string(),
  completion: z.object({
    submitted: z.number().int(),
    total: z.number().int(),
    ratio: z.number().min(0).max(1),
  }),
  byRelationship: z.array(reviewSubjectRelationshipBreakdownSchema),
  submissions: z.array(reviewSubjectSubmissionSchema),
  questionAggregates: z.array(reviewSubjectQuestionAggregateSchema),
})
export type ReviewSubjectResultsResponse = z.infer<typeof reviewSubjectResultsResponseSchema>
