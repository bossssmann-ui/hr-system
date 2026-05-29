import { z } from 'zod'

export const SCORING_SCHEMA_VERSION = 2

export const scoringInputSchema = z.object({
  job_profile: z.object({
    title: z.string(),
    grade: z.string().nullable(),
    description: z.string(),
    required_skills: z.array(z.string()),
    salary_range: z.object({
      min: z.number().int().nullable(),
      max: z.number().int().nullable(),
      currency: z.string().nullable(),
    }),
  }),
  candidate_resume: z.object({
    title: z.string().nullable(),
    experience: z.array(z.string()),
    education: z.array(z.string()),
    skills: z.array(z.string()),
    total_experience_months: z.number().int().nonnegative().nullable(),
    location: z.string().nullable(),
  }),
})

export type ScoringInput = z.infer<typeof scoringInputSchema>

// Phase 9 — LLM Scoring v2 fields (all optional, so v1 providers keep working).
export const competencyAssessmentSchema = z.object({
  score: z.number().int().min(0).max(10),
  reasoning: z.string().min(1),
})

export type CompetencyAssessment = z.infer<typeof competencyAssessmentSchema>

export const scoringResultCoreSchema = z.object({
  relevance_score: z.number().int().min(0).max(100),
  summary: z.string().min(1),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  soft_skills_signals: z.array(z.string()),
  red_flags: z.array(z.string()),
  anti_fraud_signals: z.array(z.string()),
  values_fit_hypothesis: z.string(),
  interview_focus_areas: z.array(z.string()),
  // ── v2 (Phase 9) ─────────────────────────────────────────────────────────
  competencies: z.record(z.string(), competencyAssessmentSchema).optional(),
  suggested_grade: z.string().nullable().optional(),
  suggested_salary: z.number().int().nonnegative().nullable().optional(),
  interview_questions: z.array(z.string()).optional(),
})

export const scoringResultSchema = scoringResultCoreSchema.extend({
  model: z.string().min(1),
  scored_at: z.string().datetime(),
  schema_version: z.number().int().default(SCORING_SCHEMA_VERSION),
  // Cost-tracking metadata (best-effort; provider may not report tokens).
  tokens_used: z.number().int().nonnegative().optional(),
  model_version: z.string().optional(),
})

export type ScoringResult = z.infer<typeof scoringResultSchema>
