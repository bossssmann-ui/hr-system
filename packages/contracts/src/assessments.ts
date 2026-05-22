import { z } from 'zod'

export const assessmentQuestionTypeSchema = z.enum(['open', 'single_choice', 'multi_choice'])
export type AssessmentQuestionType = z.infer<typeof assessmentQuestionTypeSchema>

export const assessmentSessionStatusSchema = z.enum([
  'invited',
  'consented',
  'in_progress',
  'submitted',
  'graded',
  'expired',
])
export type AssessmentSessionStatus = z.infer<typeof assessmentSessionStatusSchema>

export const trustSignalsSchema = z.object({
  paste_events: z.object({
    count: z.number().int().nonnegative().default(0),
    sizes: z.array(z.number().int().nonnegative()).default([]),
  }),
  focus_loss_events: z.object({
    count: z.number().int().nonnegative().default(0),
    total_away_ms: z.number().int().nonnegative().default(0),
  }),
  keystroke_timing: z.object({
    anomaly_flags: z.number().int().nonnegative().default(0),
    burst_events: z.number().int().nonnegative().default(0),
  }),
})
export type TrustSignals = z.infer<typeof trustSignalsSchema>

export const assessmentQuestionSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  order: z.number().int().nonnegative(),
  type: assessmentQuestionTypeSchema,
  prompt: z.string().min(1),
  options: z.array(z.string()).optional(),
  rubric: z.string().nullable().optional(),
  competency: z.string().nullable().optional(),
  weight: z.number().positive(),
})
export type AssessmentQuestion = z.infer<typeof assessmentQuestionSchema>

export const assessmentTemplateSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  vacancyId: z.string().uuid().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  timeLimitMin: z.number().int().positive().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  questions: z.array(assessmentQuestionSchema).default([]),
})
export type AssessmentTemplate = z.infer<typeof assessmentTemplateSchema>

export const assessmentAnswerSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
  answer: z.unknown(),
  aiGrade: z
    .object({
      score: z.number().min(0).max(100),
      rationale: z.string(),
    })
    .nullable()
    .optional(),
  createdAt: z.string().datetime(),
})
export type AssessmentAnswer = z.infer<typeof assessmentAnswerSchema>

export const assessmentSessionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  templateId: z.string().uuid(),
  applicationId: z.string().uuid(),
  status: assessmentSessionStatusSchema,
  consentRecorded: z.boolean(),
  startedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  trustScore: z.number().int().min(0).max(100).nullable(),
  trustSignals: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  answers: z.array(assessmentAnswerSchema).optional().default([]),
})
export type AssessmentSession = z.infer<typeof assessmentSessionSchema>

export const createAssessmentTemplateRequestSchema = z.object({
  vacancyId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  timeLimitMin: z.number().int().positive().optional(),
  questions: z.array(
    z.object({
      order: z.number().int().nonnegative(),
      type: assessmentQuestionTypeSchema,
      prompt: z.string().min(1),
      options: z.array(z.string()).optional(),
      rubric: z.string().optional(),
      competency: z.string().optional(),
      weight: z.number().positive().default(1),
    }),
  ).min(1),
})
export type CreateAssessmentTemplateRequest = z.infer<typeof createAssessmentTemplateRequestSchema>

export const updateAssessmentTemplateRequestSchema = createAssessmentTemplateRequestSchema.partial()
export type UpdateAssessmentTemplateRequest = z.infer<typeof updateAssessmentTemplateRequestSchema>

export const listAssessmentTemplatesResponseSchema = z.object({
  items: z.array(assessmentTemplateSchema),
})
export type ListAssessmentTemplatesResponse = z.infer<typeof listAssessmentTemplatesResponseSchema>

export const inviteAssessmentRequestSchema = z.object({
  applicationId: z.string().uuid(),
})
export type InviteAssessmentRequest = z.infer<typeof inviteAssessmentRequestSchema>

export const inviteAssessmentResponseSchema = z.object({
  sessionId: z.string().uuid(),
  token: z.string().min(16),
  link: z.string().min(1),
})
export type InviteAssessmentResponse = z.infer<typeof inviteAssessmentResponseSchema>

export const publicAssessmentViewSchema = z.object({
  sessionId: z.string().uuid(),
  status: assessmentSessionStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  timeLimitMin: z.number().int().positive().nullable(),
  startedAt: z.string().datetime().nullable(),
  questions: z.array(
    assessmentQuestionSchema.pick({
      id: true,
      order: true,
      type: true,
      prompt: true,
      options: true,
      competency: true,
      weight: true,
    }),
  ),
})
export type PublicAssessmentView = z.infer<typeof publicAssessmentViewSchema>

export const assessmentConsentRequestSchema = z.object({
  proctoring_consent: z.boolean(),
  webcam_consent: z.boolean().optional(),
  consent_basis: z.string().min(1).optional(),
})
export type AssessmentConsentRequest = z.infer<typeof assessmentConsentRequestSchema>

export const assessmentSubmitRequestSchema = z.object({
  answers: z.array(
    z.object({
      question_id: z.string().uuid(),
      answer: z.unknown(),
    }),
  ),
  signals: trustSignalsSchema,
  trust_score: z.number().optional(),
})
export type AssessmentSubmitRequest = z.infer<typeof assessmentSubmitRequestSchema>

export const assessmentSubmitResponseSchema = z.object({
  submitted: z.boolean(),
  trustScore: z.number().int().min(0).max(100),
  redFlagged: z.boolean(),
})
export type AssessmentSubmitResponse = z.infer<typeof assessmentSubmitResponseSchema>

export const trustPreviewRequestSchema = z.object({
  signals: trustSignalsSchema,
})
export type TrustPreviewRequest = z.infer<typeof trustPreviewRequestSchema>

export const trustPreviewResponseSchema = z.object({
  trustScore: z.number().int().min(0).max(100),
})
export type TrustPreviewResponse = z.infer<typeof trustPreviewResponseSchema>

export const aiInterviewQuestionSchema = z.object({
  question: z.string().min(1),
  rationale: z.string().min(1),
  competency: z.string().min(1),
})
export type AiInterviewQuestion = z.infer<typeof aiInterviewQuestionSchema>

export const generateInterviewQuestionsResponseSchema = z.object({
  items: z.array(aiInterviewQuestionSchema),
})
export type GenerateInterviewQuestionsResponse = z.infer<typeof generateInterviewQuestionsResponseSchema>
