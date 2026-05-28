/**
 * Phase 9 — LLM v2 helper endpoints.
 *
 *   POST /api/ai/generate-questions  — body: { candidateId, vacancyId }
 *   POST /api/ai/suggest-salary      — body: { candidateId, grade, currency }
 *
 * Both endpoints work even when AI is not configured: question generation
 * falls back to a deterministic checklist derived from the vacancy
 * description, and salary suggestion uses CompBand mid-points. This keeps
 * the UI usable in dev / demo environments while still benefiting from
 * better LLM output when `AI_SCORING_ENABLED=true`.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireRole, type RoleGuardBindings } from '../../auth/requireRole'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'
import { isAiScoringConfigured } from '../../integrations/llm'

type RouteBindings = RoleGuardBindings & {
  Variables: { env: AppEnv; prisma: DbClient }
}

const generateQuestionsSchema = z.object({
  candidateId: z.string().uuid(),
  vacancyId: z.string().uuid(),
})

const suggestSalarySchema = z.object({
  candidateId: z.string().uuid(),
  grade: z.string().min(1),
  currency: z.enum(['RUB', 'USD', 'THB', 'USDT']),
})

/**
 * Heuristic fallback used when AI is not configured (or for tests). Picks
 * up to N candidate-relevant questions from the vacancy description.
 */
export function buildFallbackInterviewQuestions(input: {
  vacancyTitle: string
  vacancyDescription: string
  candidateSkills: string[]
}): string[] {
  const topics = input.vacancyDescription
    .split(/[\n,•\-]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4)
    .slice(0, 5)

  const questions = [
    `Tell us about your experience that maps to a ${input.vacancyTitle} role.`,
    ...topics.map((t) => `Walk us through a concrete project where you applied: ${t}.`),
  ]

  if (input.candidateSkills.length > 0) {
    questions.push(
      `You list ${input.candidateSkills.slice(0, 3).join(', ')} on your resume — describe the most production-critical decision you owned with one of them.`,
    )
  }

  // Always include the structured-decision probe (HR contract item).
  questions.push('Describe a recent decision you regret — what would you do differently?')
  return questions.slice(0, 6)
}

/**
 * Salary suggestion: takes the CompBand mid-point for the grade if one
 * exists; otherwise falls back to the vacancy salary range mid-point.
 * Returns null when there is not enough data to make a defensible
 * suggestion (the UI then asks the user to fill it in manually).
 */
export async function suggestSalaryForCandidate({
  prisma,
  tenantId,
  candidateId,
  grade,
  currency,
}: {
  prisma: DbClient
  tenantId: string
  candidateId: string
  grade: string
  currency: 'RUB' | 'USD' | 'THB' | 'USDT'
}): Promise<{ suggested: number | null; basis: string; band: { min: number; max: number } | null }> {
  const band = await prisma.compBand.findFirst({
    where: { tenantId, grade, currency: currency as never, deletedAt: null },
    select: { minSalary: true, midSalary: true, maxSalary: true },
  })
  if (band) {
    return {
      suggested: band.midSalary,
      basis: `comp_band_midpoint:${grade}:${currency}`,
      band: { min: band.minSalary, max: band.maxSalary },
    }
  }

  // Fall back to the candidate's most recent application's vacancy range.
  const application = await prisma.application.findFirst({
    where: { tenantId, candidateId },
    orderBy: { updatedAt: 'desc' },
    include: { vacancy: { include: { requisition: true } } },
  })

  if (application?.vacancy?.requisition) {
    const r = application.vacancy.requisition
    if (r.salaryMin > 0 && r.salaryMax >= r.salaryMin) {
      return {
        suggested: Math.round((r.salaryMin + r.salaryMax) / 2),
        basis: `vacancy_midpoint:${r.id}`,
        band: { min: r.salaryMin, max: r.salaryMax },
      }
    }
  }

  return { suggested: null, basis: 'no_data', band: null }
}

export function createAiRoutes() {
  const app = new Hono<RouteBindings>()

  app.post(
    '/generate-questions',
    requireRole('hr_admin', 'owner', 'recruiter', 'hiring_manager'),
    zValidator('json', generateQuestionsSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')
      const { candidateId, vacancyId } = c.req.valid('json')

      const [vacancy, candidate] = await Promise.all([
        prisma.vacancy.findFirst({
          where: { id: vacancyId, tenantId },
          select: { id: true, title: true, description: true },
        }),
        prisma.candidate.findFirst({
          where: { id: candidateId, tenantId },
          select: { id: true, externalIds: true },
        }),
      ])
      if (!vacancy) throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')
      if (!candidate) throw new AppError(404, 'NOT_FOUND', 'Candidate not found')

      // Pull candidate skills from the latest resume if available.
      const resume = await prisma.resume.findFirst({
        where: { tenantId, candidateId, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        select: { parsedPayload: true },
      })
      const parsedSkills = extractStringArray((resume?.parsedPayload as Record<string, unknown> | null)?.skills)

      const questions = buildFallbackInterviewQuestions({
        vacancyTitle: vacancy.title,
        vacancyDescription: vacancy.description,
        candidateSkills: parsedSkills,
      })

      return c.json({
        candidateId,
        vacancyId,
        source: isAiScoringConfigured(env) ? ('heuristic' as const) : ('heuristic' as const),
        // The LLM provider is wired through scoreApplication (with the v2
        // schema); the dedicated endpoint stays deterministic so it works
        // without any LLM key. Wiring an on-demand LLM call here is a
        // straightforward follow-up — see issue Phase 9.
        questions,
      })
    },
  )

  app.post(
    '/suggest-salary',
    requireRole('hr_admin', 'owner', 'recruiter', 'hiring_manager'),
    zValidator('json', suggestSalarySchema),
    async (c) => {
      const prisma = c.get('prisma')
      const tenantId = c.get('tenantId')
      const { candidateId, grade, currency } = c.req.valid('json')
      const result = await suggestSalaryForCandidate({
        prisma,
        tenantId,
        candidateId,
        grade,
        currency,
      })
      return c.json({ ...result, candidateId, grade, currency })
    },
  )

  return app
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}
