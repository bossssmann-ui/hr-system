/**
 * Phase 1G — Public careers API (unauthenticated).
 *
 * These endpoints are mounted at `/api/public/` and require NO authentication.
 * They expose only published, public-safe vacancy data and accept applications.
 *
 * Security notes:
 *  - Tenant is resolved server-side from the bootstrap tenant (never from request).
 *  - Only `is_published = true` vacancies are exposed.
 *  - Internal fields (requisitionId, orgUnitId, tenantId, salary, etc.) are NOT returned.
 *  - Honeypot field rejects bots.
 *  - Per-IP rate limiting on the apply endpoint.
 *  - Consent (152-ФЗ) is required to submit.
 *
 * TODO(phase-1g+): multi-tenant — map careers domain/subdomain → tenant.
 * TODO(phase-1g+): stronger anti-spam (CAPTCHA, etc.).
 */

import type {
  ListPublicVacanciesResponse,
  PublicApplyRequest,
  PublicApplyResponse,
  PublicVacancy,
} from '@web-app-demo/contracts'
import {
  listPublicVacanciesResponseSchema,
  publicApplyRequestSchema,
  publicApplyResponseSchema,
  publicVacancySchema,
} from '@web-app-demo/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import { AppError } from '../../http/errors'

type RouteBindings = {
  Variables: {
    env: AppEnv
    prisma: DbClient
    tenantId?: string
    auditEntry?: unknown
  }
}

/**
 * Simple in-memory per-IP rate limiter.
 * Counts POST /apply submissions per IP per sliding hour window.
 * Resets automatically when the hour window expires.
 *
 * This is intentionally lightweight — no persistence, resets on restart.
 * TODO(phase-1g+): replace with Redis-backed rate limiter for production.
 */
const rateLimitStore = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(ip: string, limitPerHour: number): boolean {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000
  const entry = rateLimitStore.get(ip)

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitStore.set(ip, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= limitPerHour) return false

  entry.count += 1
  return true
}

function toPublicDto(row: {
  slug: string | null
  title: string
  description: string
}): PublicVacancy {
  return publicVacancySchema.parse({
    slug: row.slug!,
    title: row.title,
    description: row.description,
  })
}

/**
 * Resolve the single bootstrap tenant from the database.
 * In Phase 0/1 there is exactly one tenant. Returns null if none found.
 *
 * TODO(phase-1g+): multi-tenant — map careers domain/subdomain → tenant.
 */
async function resolveBootstrapTenant(prisma: DbClient): Promise<string | null> {
  const tenant = await prisma.tenant.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  return tenant?.id ?? null
}

export function createPublicCareersRoutes() {
  const app = new Hono<RouteBindings>()

  // ─── Feature-flag guard ────────────────────────────────────────────────────

  app.use('*', async (c, next) => {
    const env = c.get('env')
    if (!env.CAREERS_PAGE_ENABLED) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Careers page is not enabled' } }, 404)
    }
    await next()
  })

  // ─── Tenant resolution ─────────────────────────────────────────────────────

  app.use('*', async (c, next) => {
    const prisma = c.get('prisma')
    const tenantId = await resolveBootstrapTenant(prisma)
    if (!tenantId) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'No tenant configured' } }, 404)
    }
    c.set('tenantId', tenantId)
    await next()
  })

  // ─── GET /api/public/vacancies ─────────────────────────────────────────────

  app.get('/vacancies', async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')!

    const rows = await prisma.vacancy.findMany({
      where: { tenantId, isPublished: true, slug: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { slug: true, title: true, description: true },
    })

    const response: ListPublicVacanciesResponse = listPublicVacanciesResponseSchema.parse({
      items: rows.map(toPublicDto),
    })
    return c.json(response)
  })

  // ─── GET /api/public/vacancies/:slug ──────────────────────────────────────

  app.get('/vacancies/:slug', async (c) => {
    const prisma = c.get('prisma')
    const tenantId = c.get('tenantId')!
    const { slug } = c.req.param()

    const row = await prisma.vacancy.findFirst({
      where: { tenantId, slug, isPublished: true },
      select: { slug: true, title: true, description: true },
    })

    if (!row || !row.slug) {
      throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')
    }

    return c.json(toPublicDto(row))
  })

  // ─── POST /api/public/vacancies/:slug/apply ───────────────────────────────

  app.post(
    '/vacancies/:slug/apply',
    zValidator('json', publicApplyRequestSchema),
    async (c) => {
      const prisma = c.get('prisma')
      const env = c.get('env')
      const tenantId = c.get('tenantId')!
      const { slug } = c.req.param()
      const body: PublicApplyRequest = c.req.valid('json')

      // ── Honeypot check ──
      if (body.website) {
        // Silently reject bot submissions that fill the honeypot field.
        const response: PublicApplyResponse = publicApplyResponseSchema.parse({
          reference: 'honeypot',
          message: 'Thank you for your application.',
        })
        return c.json(response, 200)
      }

      // ── Consent check (152-ФЗ) ──
      if (!body.consent) {
        throw new AppError(422, 'CONSENT_REQUIRED', 'Consent to personal data processing is required')
      }

      // ── Rate limit (per-IP) ──
      const ip =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.req.header('x-real-ip') ??
        'unknown'
      const allowed = checkRateLimit(ip, env.CAREERS_RATE_LIMIT_PER_HOUR)
      if (!allowed) {
        return c.json(
          { error: { code: 'BAD_REQUEST', message: 'Too many submissions. Please try again later.' } },
          429 as never,
        )
      }

      // ── Look up the vacancy ──
      const vacancy = await prisma.vacancy.findFirst({
        where: { tenantId, slug, isPublished: true },
        select: { id: true, title: true },
      })
      if (!vacancy) {
        throw new AppError(404, 'NOT_FOUND', 'Vacancy not found')
      }

      // ── Dedup candidate (same logic as createCandidatesRoutes) ──
      const consentContext = {
        basis: 'public_careers_form',
        consent_text_version: '1.0',
        consented_at: new Date().toISOString(),
        ip,
      }

      let candidate = await prisma.candidate.findFirst({
        where: {
          tenantId,
          OR: [
            ...(body.email ? [{ email: body.email }] : []),
            ...(body.phone ? [{ phone: body.phone }] : []),
          ],
        },
      })

      let deduped = false
      if (!candidate) {
        candidate = await prisma.candidate.create({
          data: {
            tenantId,
            fullName: body.full_name,
            email: body.email,
            phone: body.phone ?? null,
            source: 'careers_page',
            consentContext: consentContext as never,
          },
        })
      } else {
        deduped = true
        // Update consent context on existing candidate for audit.
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: { consentContext: consentContext as never },
        })
      }

      // ── Create application (stage = new) ──
      const application = await prisma.application.create({
        data: {
          tenantId,
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          stage: 'new',
          notes: body.cover_note ?? null,
        },
      })

      // ── Audit event ──
      c.set('auditEntry', {
        action: 'application.created',
        entityType: 'Application',
        entityId: application.id,
        diff: {
          via: 'careers_page',
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          deduped,
        },
      })

      // ── AI scoring (async, if enabled) ──
      if (env.AI_SCORING_ENABLED) {
        // Import lazily to avoid circular deps. Fires and forgets — the score
        // lands asynchronously just like the authed flow.
        import('../../features/scoring/scoring.service').then(({ scoreApplication }) => {
          void scoreApplication({ prisma, env, applicationId: application.id }).catch(() => {
            // Scoring failure must never fail the apply response.
          })
        }).catch(() => { /* ignore */ })
      }

      // ── Response: no internal IDs leaked ──
      const response: PublicApplyResponse = publicApplyResponseSchema.parse({
        reference: application.id.slice(0, 8),
        message: 'Thank you for your application. We will be in touch.',
      })
      return c.json(response, 201)
    },
  )

  return app
}
