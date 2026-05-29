import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — AI & Intelligence: signals, knowledge hub, LLM v2 helpers.
// ─────────────────────────────────────────────────────────────────────────────

export const analyticsSignalTypeSchema = z.enum(['flight_risk', 'burnout'])
export const analyticsSignalStatusSchema = z.enum(['open', 'reviewed', 'dismissed'])

export const analyticsSignalFactorSchema = z.object({
  code: z.string(),
  weight: z.number().int(),
  note: z.string(),
})

export const analyticsSignalSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  employeeId: z.string().uuid(),
  type: analyticsSignalTypeSchema,
  score: z.number().int().min(0).max(100),
  factors: z.array(analyticsSignalFactorSchema),
  status: analyticsSignalStatusSchema,
  computedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  reviewedBy: z.string().uuid().nullable(),
})

export type AnalyticsSignal = z.infer<typeof analyticsSignalSchema>

export const listAnalyticsSignalsResponseSchema = z.object({
  items: z.array(analyticsSignalSchema),
})

export type ListAnalyticsSignalsResponse = z.infer<typeof listAnalyticsSignalsResponseSchema>

export const updateAnalyticsSignalRequestSchema = z.object({
  status: analyticsSignalStatusSchema,
})

// ── Knowledge Hub ─────────────────────────────────────────────────────────

export const knowledgeArticleVisibilitySchema = z.enum(['internal', 'portal'])

export const knowledgeArticleSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  visibility: knowledgeArticleVisibilitySchema,
  createdByUserId: z.string().uuid(),
  updatedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type KnowledgeArticle = z.infer<typeof knowledgeArticleSchema>

export const listKnowledgeArticlesResponseSchema = z.object({
  items: z.array(knowledgeArticleSchema),
})

export type ListKnowledgeArticlesResponse = z.infer<typeof listKnowledgeArticlesResponseSchema>

export const createKnowledgeArticleRequestSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  visibility: knowledgeArticleVisibilitySchema.default('internal'),
})

export type CreateKnowledgeArticleRequest = z.infer<typeof createKnowledgeArticleRequestSchema>

export const updateKnowledgeArticleRequestSchema = createKnowledgeArticleRequestSchema.partial()

export const knowledgeSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  visibility: knowledgeArticleVisibilitySchema.optional(),
})

export const knowledgeSearchHitSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  snippet: z.string(),
  rank: z.number(),
  tags: z.array(z.string()),
  visibility: knowledgeArticleVisibilitySchema,
  updatedAt: z.string().datetime(),
})

export const knowledgeSearchResponseSchema = z.object({
  items: z.array(knowledgeSearchHitSchema),
  /** `text` always available; `semantic` when pgvector is enabled. */
  mode: z.enum(['text', 'semantic']),
})

export type KnowledgeSearchResponse = z.infer<typeof knowledgeSearchResponseSchema>

// ── LLM v2 (Phase 9) ──────────────────────────────────────────────────────

export const generateQuestionsRequestSchema = z.object({
  candidateId: z.string().uuid(),
  vacancyId: z.string().uuid(),
})

export const generateQuestionsResponseSchema = z.object({
  candidateId: z.string().uuid(),
  vacancyId: z.string().uuid(),
  source: z.enum(['heuristic', 'llm']),
  questions: z.array(z.string()),
})

export const suggestSalaryRequestSchema = z.object({
  candidateId: z.string().uuid(),
  grade: z.string().min(1),
  currency: z.enum(['RUB', 'USD', 'THB', 'USDT']),
})

export const suggestSalaryResponseSchema = z.object({
  candidateId: z.string().uuid(),
  grade: z.string(),
  currency: z.enum(['RUB', 'USD', 'THB', 'USDT']),
  suggested: z.number().int().nullable(),
  basis: z.string(),
  band: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
})
