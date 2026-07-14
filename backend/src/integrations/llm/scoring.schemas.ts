import { z } from 'zod'

export const SCORING_SCHEMA_VERSION = 2

const resumeSnapshotSchema = z.object({
  title: z.string().nullable(),
  experience: z.array(z.string()),
  education: z.array(z.string()),
  skills: z.array(z.string()),
  total_experience_months: z.number().int().nonnegative().nullable(),
  location: z.string().nullable(),
  questionnaire_enrichment: z
    .object({
      summary: z.string().optional(),
      facts: z.array(z.string()).optional(),
      experience: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
      contradictions: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(100).optional(),
    })
    .optional(),
})

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
  candidate_resume: resumeSnapshotSchema.extend({
    previous_versions: z.array(resumeSnapshotSchema).optional(),
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

export function isScoringResultInternallyInconsistent(
  result: Pick<ScoringResult, 'relevance_score' | 'strengths'> & {
    competencies?: Record<string, CompetencyAssessment>
  },
  input: ScoringInput,
) {
  if (result.relevance_score > 10) return false
  if (!hasDomainOverlap(input)) return false

  const hasPositiveEvidence =
    result.strengths.length > 0 ||
    Object.values(result.competencies ?? {}).some((competency) => competency.score >= 4)

  return hasPositiveEvidence
}

function hasDomainOverlap(input: ScoringInput) {
  const jobRoots = roots([
    input.job_profile.title,
    input.job_profile.description,
    ...input.job_profile.required_skills,
  ])
  if (jobRoots.size === 0) return false

  const resumeRoots = roots([
    input.candidate_resume.title ?? '',
    ...input.candidate_resume.experience,
    ...input.candidate_resume.skills,
  ])

  return [...jobRoots].some((root) => resumeRoots.has(root))
}

function roots(values: string[]) {
  const stopWords = new Set([
    'and',
    'the',
    'for',
    'with',
    'отдел',
    'отдела',
    'работа',
    'работы',
    'менеджер',
    'специалист',
    'ведущий',
  ])

  const result = new Set<string>()
  for (const value of values) {
    for (const token of value.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (token.length < 5 || stopWords.has(token)) continue
      result.add(token.slice(0, 5))
    }
  }

  return result
}
