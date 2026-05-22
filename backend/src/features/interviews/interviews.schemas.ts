import { z } from 'zod'

// ─── Transcript ───────────────────────────────────────────────────────────────

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

// ─── Interview Protocol ───────────────────────────────────────────────────────

export const PROTOCOL_SCHEMA_VERSION = 1

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

export const interviewProtocolCoreSchema = z.object({
  summary: z.string().min(1),
  questions_and_answers: z.array(qaItemSchema).default([]),
  agreed_terms: agreedTermsSchema,
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
})

export const interviewProtocolSchema = interviewProtocolCoreSchema.extend({
  model: z.string().min(1),
  generated_at: z.string().datetime(),
  schema_version: z.number().int().default(PROTOCOL_SCHEMA_VERSION),
})

export type InterviewProtocol = z.infer<typeof interviewProtocolSchema>

// ─── Offer Draft ─────────────────────────────────────────────────────────────

/**
 * OfferDraft is a deterministic mapping from protocol.agreed_terms.
 * No LLM involved — straight mapping for auditability.
 * Full offer + DocuSeal e-signing is Phase 3. See TODO below.
 * TODO(phase-3): replace draft with full Offer + approval chain + DocuSeal signing.
 */
export const offerDraftSchema = z.object({
  salary: z.number().int().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  conditions: z.array(z.string()).default([]),
  grade: z.string().nullable().optional(),
  status: z.literal('draft'),
})

export type OfferDraft = z.infer<typeof offerDraftSchema>

// ─── Interview status ─────────────────────────────────────────────────────────

export const interviewStatusSchema = z.enum([
  'created',
  'transcribing',
  'transcribed',
  'protocol_ready',
  'failed',
])

export type InterviewStatus = z.infer<typeof interviewStatusSchema>
