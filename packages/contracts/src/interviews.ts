import { z } from 'zod'

export const interviewStatusSchema = z.enum([
  'created',
  'transcribing',
  'transcribed',
  'protocol_ready',
  'failed',
])

export type InterviewStatus = z.infer<typeof interviewStatusSchema>

export const transcriptSegmentSchema = z.object({
  speaker: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
})

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>

export const transcriptSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
  language: z.string(),
  asr_provider: z.string(),
  asr_model: z.string(),
  created_at: z.string().datetime(),
})

export type Transcript = z.infer<typeof transcriptSchema>

export const termSourceSchema = z.object({
  segment_index: z.number().int().nonnegative(),
  quote: z.string(),
})

export type TermSource = z.infer<typeof termSourceSchema>

export const agreedTermsSchema = z.object({
  salary: z.number().int().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  special_conditions: z.array(z.string()).default([]),
  salary_source: termSourceSchema.nullable().optional(),
  start_date_source: termSourceSchema.nullable().optional(),
  special_conditions_sources: z.array(termSourceSchema).default([]),
})

export type AgreedTerms = z.infer<typeof agreedTermsSchema>

export const qaItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
  segment_indices: z.array(z.number().int().nonnegative()).default([]),
})

export type QaItem = z.infer<typeof qaItemSchema>

export const interviewProtocolSchema = z.object({
  summary: z.string(),
  questions_and_answers: z.array(qaItemSchema).default([]),
  agreed_terms: agreedTermsSchema,
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  model: z.string(),
  generated_at: z.string().datetime(),
  schema_version: z.number().int(),
})

export type InterviewProtocol = z.infer<typeof interviewProtocolSchema>

export const offerDraftSchema = z.object({
  salary: z.number().int().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  conditions: z.array(z.string()).default([]),
  grade: z.string().nullable().optional(),
  status: z.literal('draft'),
})

export type OfferDraft = z.infer<typeof offerDraftSchema>

export const interviewSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  applicationId: z.string(),
  scheduledAt: z.string().datetime().nullable(),
  recordingUrl: z.string().nullable(),
  consentRecorded: z.boolean(),
  status: interviewStatusSchema,
  transcript: transcriptSchema.nullable(),
  protocol: interviewProtocolSchema.nullable(),
  offerDraft: offerDraftSchema.nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Interview = z.infer<typeof interviewSchema>

export const listInterviewsResponseSchema = z.object({
  items: z.array(interviewSchema),
})

export type ListInterviewsResponse = z.infer<typeof listInterviewsResponseSchema>

export const createInterviewRequestSchema = z.object({
  applicationId: z.string().uuid(),
  scheduledAt: z.string().datetime().optional(),
})

export type CreateInterviewRequest = z.infer<typeof createInterviewRequestSchema>

export const updateInterviewConsentRequestSchema = z.object({
  consentRecorded: z.boolean(),
})

export type UpdateInterviewConsentRequest = z.infer<typeof updateInterviewConsentRequestSchema>
