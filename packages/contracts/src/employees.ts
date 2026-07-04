import { z } from 'zod'

export const probationReviewDecisionSchema = z.enum(['passed', 'failed', 'extended'])

export type ProbationReviewDecision = z.infer<typeof probationReviewDecisionSchema>

export const recordProbationReviewRequestSchema = z.object({
  decision: probationReviewDecisionSchema,
  extendedProbationEndsAt: z.string().date().optional(),
  note: z.string().optional(),
})

export type RecordProbationReviewRequest = z.infer<typeof recordProbationReviewRequestSchema>

export const recordProbationReviewResponseSchema = z.object({
  employeeId: z.string(),
  status: z.string(),
  probationOutcome: z.string().nullable(),
  probationEndsAt: z.string().nullable(),
})

export type RecordProbationReviewResponse = z.infer<typeof recordProbationReviewResponseSchema>
