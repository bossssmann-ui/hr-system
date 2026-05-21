import { z } from 'zod'

export const SCORING_SCHEMA_VERSION = 1

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
})

export const scoringResultSchema = scoringResultCoreSchema.extend({
  model: z.string().min(1),
  scored_at: z.string().datetime(),
  schema_version: z.number().int().default(SCORING_SCHEMA_VERSION),
})

export type ScoringResult = z.infer<typeof scoringResultSchema>
