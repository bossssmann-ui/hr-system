import { z } from 'zod'

import { aiInterviewQuestionSchema } from './assessments'
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
  competencies: z
    .record(
      z.string(),
      z.object({
        score: z.number().int().min(0).max(10),
        reasoning: z.string(),
      }),
    )
    .optional(),
  suggested_grade: z.string().nullable().optional(),
  suggested_salary: z.number().int().nonnegative().nullable().optional(),
  interview_questions: z.array(z.string()).optional(),
  model: z.string(),
  scored_at: z.string().datetime(),
  schema_version: z.number().int(),
  tokens_used: z.number().int().nonnegative().optional(),
  model_version: z.string().optional(),
})

export const aiScoringErrorSchema = z.object({
  error: z.string(),
  model: z.string(),
  scored_at: z.string().datetime(),
})

export const aiScoringHistoryEntrySchema = z.object({
  input_hash: z.string().optional(),
  result: aiScoringResultSchema,
  replaced_at: z.string().datetime(),
  replaced_by_model: z.string().optional(),
})

export const previousAiScoringSchema = z.object({
  status: z.literal('scored'),
  input_hash: z.string().optional(),
  result: aiScoringResultSchema,
  history: z.array(aiScoringHistoryEntrySchema).optional(),
})

export const aiScoringSchema = z.object({
  status: aiScoringStatusSchema,
  input_hash: z.string().optional(),
  result: aiScoringResultSchema.optional(),
  failure: aiScoringErrorSchema.optional(),
  history: z.array(aiScoringHistoryEntrySchema).optional(),
  previous_scoring: previousAiScoringSchema.optional(),
})

export const aiScoreFeedbackSchema = z.object({
  user_id: z.string().uuid(),
  agrees: z.boolean(),
  note: z.string().nullable(),
  created_at: z.string().datetime(),
})

export const unifiedScoreStatusSchema = z.enum(['preliminary', 'final'])

export const compositeScoreBreakdownSchema = z.object({
  resume: z.number().min(0).max(100).nullable(),
  selection: z.object({
    stage1: z.number().nullable(),
    stage2: z.number().nullable(),
    stage3: z.number().nullable(),
    stage4: z.number().nullable(),
    total: z.number().nullable(),
  }).nullable(),
  assessment: z.object({
    score: z.number().nullable(),
    trust: z.number().nullable(),
  }).nullable(),
  retention: z.number().min(0).max(100).nullable(),
})

export const compositeScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  breakdown: compositeScoreBreakdownSchema,
  weights: z.record(z.string(), z.number()),
  updatedAt: z.string().datetime(),
})

export type CompositeScore = z.infer<typeof compositeScoreSchema>

export const aiClarificationStatusSchema = z.enum(['sent', 'answered', 'rescored'])

export const aiClarificationAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
})

export const aiClarificationSchema = z.object({
  status: aiClarificationStatusSchema,
  channel: z.string(),
  questions: z.array(z.string()).min(1),
  answers: z.array(aiClarificationAnswerSchema).optional(),
  sentAt: z.string().datetime(),
  answeredAt: z.string().datetime().optional(),
  roundCount: z.number().int().nonnegative(),
  rescoredAt: z.string().datetime().optional(),
})

export type AiClarification = z.infer<typeof aiClarificationSchema>

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
  aiInterviewQuestions: z.array(aiInterviewQuestionSchema).nullable().optional(),
  aiClarification: aiClarificationSchema.nullable().optional(),
  aiScore: z.number().nullable().optional(),
  aiVerdict: z.string().nullable().optional(),
  aiAssessedAt: z.string().datetime().nullable().optional(),
  aiFlags: z.record(z.string(), z.unknown()).nullable().optional(),
  compositeScore: compositeScoreSchema.nullable().optional(),
  unifiedScore: z.object({
    value: z.number().nullable(),
    status: unifiedScoreStatusSchema.nullable(),
  }).optional(),
  trustScore: z.number().int().min(0).max(100).nullable().optional(),
  retentionPrediction: z.record(z.string(), z.unknown()).nullable().optional(),
  selectionHrNotes: z.string().nullable().optional(),
  selectionPipelineEnabled: z.boolean().optional(),
  trustFlagged: z.boolean().optional().default(false),
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

export const sendCandidateQuestionnaireResponseSchema = z.object({
  sent: z.boolean(),
  reason: z.string().optional(),
  messageId: z.string().optional(),
  questionCount: z.number().int().nonnegative().optional(),
})

export type SendCandidateQuestionnaireResponse = z.infer<typeof sendCandidateQuestionnaireResponseSchema>

export const processCandidateQuestionnaireReplyRequestSchema = z.object({
  fromEmail: z.string().email().optional(),
  body: z.string().min(1).max(20000),
  externalId: z.string().max(500).optional(),
})

export type ProcessCandidateQuestionnaireReplyRequest = z.infer<typeof processCandidateQuestionnaireReplyRequestSchema>

export const processCandidateQuestionnaireReplyResponseSchema = z.object({
  processed: z.boolean(),
  duplicate: z.boolean().optional(),
  reason: z.string().optional(),
  messageId: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
})

export type ProcessCandidateQuestionnaireReplyResponse = z.infer<typeof processCandidateQuestionnaireReplyResponseSchema>

export const rescoreAllApplicationsRequestSchema = z.object({
  vacancyId: z.string().uuid().optional(),
  stage: applicationStageSchema.optional(),
})

export type RescoreAllApplicationsRequest = z.infer<typeof rescoreAllApplicationsRequestSchema>

export const rescoreAllApplicationsResponseSchema = z.object({
  queued: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
})

export type RescoreAllApplicationsResponse = z.infer<typeof rescoreAllApplicationsResponseSchema>

export const sendClarificationResponseSchema = z.object({
  sent: z.boolean(),
  reason: z.string().optional(),
  messageId: z.string().optional(),
  questionCount: z.number().int().nonnegative().optional(),
  channel: z.string().optional(),
})

export type SendClarificationResponse = z.infer<typeof sendClarificationResponseSchema>
