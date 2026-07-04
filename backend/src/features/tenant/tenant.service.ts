/**
 * Phase 12 — Tenant lifecycle, settings, GDPR/152-ФЗ compliance.
 *
 * Pure-ish service layer: every method takes a `prisma`/`tenantId` pair so
 * callers (HTTP routes, cron) can supply their own DB client. The HTTP layer
 * lives in `tenant.routes.ts`.
 *
 * Conventions:
 *   - All writes that mutate tenant or candidate/employee PII go through this
 *     service so they share retention, audit and erasure semantics.
 *   - `runDataRetention` is idempotent: rows older than the policy window are
 *     anonymised (anonymize=true) or hard-deleted; AuditEvent rows are never
 *     touched. The job writes one `data_retention.run` AuditEvent per tenant.
 */

import { createHash } from 'node:crypto'

import type { DbClient } from '../../db'
import { hashPassword } from '../../auth/passwords'
import { Prisma } from '../../generated/prisma/client'
import type { RoleName } from '../../generated/prisma/enums'

// ─────────────────────────────────────────────────────────────────────────────
// Defaults — also see `data_retention_policies` migration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_RETENTION_POLICIES: Array<{
  entityType: 'candidate' | 'employee' | 'audit_event' | 'application' | 'resume'
  retainDays: number
  anonymize: boolean
}> = [
  // Кандидаты без Application → 90 дней. anonymize=true.
  { entityType: 'candidate', retainDays: 90, anonymize: true },
  // Terminated сотрудники → 1825 дней (5 лет).
  { entityType: 'employee', retainDays: 1825, anonymize: true },
  // Применяется только при ручном hard-delete; cron сам не трогает audit_event.
  { entityType: 'audit_event', retainDays: 36500, anonymize: false },
]

export const ANON_NAME = 'Удалён'
export const ANON_PHONE = null as string | null

export function hashEmail(email: string): string {
  return `sha256:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant registration — creates Tenant + bootstrap owner + default settings +
// default retention policies + a `starter` plan subscription (if billing flag).
// ─────────────────────────────────────────────────────────────────────────────

export type RegisterTenantInput = {
  tenantName: string
  slug: string
  ownerEmail: string
  ownerPassword: string
  ownerDisplayName?: string
}

export type RegisterTenantResult = {
  tenant: { id: string; name: string; slug: string }
  user: {
    id: string
    email: string
    displayName: string | null
    roles: RoleName[]
    createdAt: Date
  }
}

export async function registerTenant(
  prisma: DbClient,
  input: RegisterTenantInput,
): Promise<RegisterTenantResult> {
  const passwordHash = await hashPassword(input.ownerPassword)
  const slug = input.slug.trim().toLowerCase()

  return prisma.$transaction(async (tx) => {
    const existingSlug = await tx.tenant.findUnique({ where: { slug } })
    if (existingSlug) {
      throw Object.assign(new Error('Tenant slug already taken'), { code: 'CONFLICT_SLUG' })
    }

    const existingUser = await tx.user.findUnique({ where: { email: input.ownerEmail } })
    if (existingUser) {
      throw Object.assign(new Error('User email already exists'), { code: 'CONFLICT_EMAIL' })
    }

    const tenant = await tx.tenant.create({
      data: { name: input.tenantName, slug },
    })

    const user = await tx.user.create({
      data: {
        email: input.ownerEmail,
        passwordHash,
        displayName: input.ownerDisplayName ?? null,
      },
    })

    await tx.userRole.create({
      data: { userId: user.id, role: 'owner', tenantId: tenant.id },
    })

    await tx.tenantSettings.create({
      data: { tenantId: tenant.id },
    })

    await tx.dataRetentionPolicy.createMany({
      data: DEFAULT_RETENTION_POLICIES.map((p) => ({ ...p, tenantId: tenant.id })),
    })

    // Attach the free starter plan when one exists. We do not require billing
    // to be enabled to seed the row — the BILLING_ENABLED flag only changes
    // whether the API surfaces billing endpoints and enforces seat limits.
    const starter = await tx.plan.findUnique({ where: { name: 'starter' } })
    if (starter) {
      await tx.subscription.create({
        data: { tenantId: tenant.id, planId: starter.id, status: 'trialing' },
      })
    }

    await tx.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'tenant.registered',
        entityType: 'Tenant',
        entityId: tenant.id,
        diff: { slug, name: tenant.name },
      },
    })

    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug ?? slug },
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: ['owner'],
        createdAt: user.createdAt,
      },
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant settings
// ─────────────────────────────────────────────────────────────────────────────

export async function getTenantSettings(prisma: DbClient, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) {
    throw Object.assign(new Error('Tenant not found'), { code: 'NOT_FOUND' })
  }

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  })

  return {
    tenantId,
    name: tenant.name,
    slug: tenant.slug,
    subdomain: tenant.subdomain,
    logoUrl: settings.logoUrl,
    primaryColor: settings.primaryColor,
    timezone: settings.timezone,
    locale: settings.locale,
    featureFlags: asFeatureFlags(settings.featureFlags),
    scoringWeights: asNumberRecord(settings.scoringWeights),
    pipelineThresholds: asPipelineThresholds(settings.pipelineThresholds),
    funnelStageConfig: asFunnelStageConfig(settings.funnelStageConfig),
  }
}

function asFeatureFlags(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

function asPipelineThresholds(value: unknown): { autoSelection: number; autoReject: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const autoSelection = record.autoSelection
  const autoReject = record.autoReject
  if (
    typeof autoSelection !== 'number' ||
    !Number.isFinite(autoSelection) ||
    autoSelection < 0 ||
    autoSelection > 100
  ) return null
  if (
    typeof autoReject !== 'number' ||
    !Number.isFinite(autoReject) ||
    autoReject < 0 ||
    autoReject > 100 ||
    autoReject > autoSelection
  ) return null
  return { autoSelection, autoReject }
}

const VALID_STAGES = new Set(['new', 'screen', 'tech', 'final', 'offer', 'hired', 'rejected'])

function asFunnelStageConfig(
  value: unknown,
): Array<{ stage: string; label?: string; order: number; hidden?: boolean }> | null {
  if (!Array.isArray(value)) return null
  const out: Array<{ stage: string; label?: string; order: number; hidden?: boolean }> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const entry = item as Record<string, unknown>
    if (typeof entry.stage !== 'string' || !VALID_STAGES.has(entry.stage)) return null
    if (typeof entry.order !== 'number' || !Number.isFinite(entry.order)) return null
    const label = entry.label !== undefined ? (typeof entry.label === 'string' ? entry.label : undefined) : undefined
    const hidden = entry.hidden !== undefined ? (typeof entry.hidden === 'boolean' ? entry.hidden : undefined) : undefined
    out.push({ stage: entry.stage, order: entry.order, ...(label !== undefined ? { label } : {}), ...(hidden !== undefined ? { hidden } : {}) })
  }
  return out
}

export async function updateTenantSettings(
  prisma: DbClient,
  tenantId: string,
  patch: {
    name?: string
    logoUrl?: string | null
    primaryColor?: string | null
    timezone?: string
    locale?: string
    featureFlags?: Record<string, boolean>
    scoringWeights?: Record<string, number> | null
    pipelineThresholds?: { autoSelection: number; autoReject: number } | null
    funnelStageConfig?: Array<{ stage: string; label?: string; order: number; hidden?: boolean }> | null
  },
) {
  await prisma.$transaction(async (tx) => {
    if (patch.name !== undefined) {
      await tx.tenant.update({ where: { id: tenantId }, data: { name: patch.name } })
    }
    const settingsPatch: Record<string, unknown> = {}
    if (patch.logoUrl !== undefined) settingsPatch.logoUrl = patch.logoUrl
    if (patch.primaryColor !== undefined) settingsPatch.primaryColor = patch.primaryColor
    if (patch.timezone !== undefined) settingsPatch.timezone = patch.timezone
    if (patch.locale !== undefined) settingsPatch.locale = patch.locale
    if (patch.featureFlags !== undefined) settingsPatch.featureFlags = patch.featureFlags
    if (patch.scoringWeights !== undefined) settingsPatch.scoringWeights = patch.scoringWeights
    if (patch.pipelineThresholds !== undefined) settingsPatch.pipelineThresholds = patch.pipelineThresholds
    if (patch.funnelStageConfig !== undefined) settingsPatch.funnelStageConfig = patch.funnelStageConfig

    await tx.tenantSettings.upsert({
      where: { tenantId },
      update: settingsPatch,
      create: { tenantId, ...settingsPatch },
    })
  })

  return getTenantSettings(prisma, tenantId)
}

// ─────────────────────────────────────────────────────────────────────────────
// GDPR Art. 17 — Erase candidate PII
// ─────────────────────────────────────────────────────────────────────────────

export async function eraseCandidate(
  prisma: DbClient,
  args: { tenantId: string; candidateId: string; actorUserId: string | null },
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: args.candidateId, tenantId: args.tenantId },
  })
  if (!candidate) {
    throw Object.assign(new Error('Candidate not found'), { code: 'NOT_FOUND' })
  }

  const erasedEmail = candidate.email ? hashEmail(candidate.email) : null

  await prisma.$transaction(async (tx) => {
    await tx.candidate.update({
      where: { id: candidate.id },
      data: {
        fullName: ANON_NAME,
        email: erasedEmail,
        phone: ANON_PHONE,
        location: null,
        externalIds: {},
        consentContext: Prisma.JsonNull,
      },
    })

    // Drop resume binaries (soft-delete via deletedAt) — file URLs may point
    // to PII like names; we keep the row so audit trails resolve but null out
    // payloads.
    await tx.resume.updateMany({
      where: { candidateId: candidate.id, deletedAt: null },
      data: { deletedAt: new Date(), parsedPayload: undefined },
    })

    await tx.auditEvent.create({
      data: {
        tenantId: args.tenantId,
        actorUserId: args.actorUserId,
        action: 'candidate.pii_erased',
        entityType: 'Candidate',
        entityId: candidate.id,
        diff: { erasedAt: new Date().toISOString() },
      },
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GDPR Art. 20 — Data export
// ─────────────────────────────────────────────────────────────────────────────

export async function exportCandidateData(
  prisma: DbClient,
  args: { tenantId: string; candidateId: string },
) {
  const candidate = await prisma.candidate.findFirst({
    where: { id: args.candidateId, tenantId: args.tenantId },
    include: {
      applications: { include: { stageEvents: true } },
      resumes: true,
      conversations: { include: { messages: true } },
    },
  })
  if (!candidate) {
    throw Object.assign(new Error('Candidate not found'), { code: 'NOT_FOUND' })
  }

  return {
    generatedAt: new Date().toISOString(),
    candidate: serialize(candidate, ['applications', 'resumes', 'conversations']),
    applications: candidate.applications.map((a) => serialize(a)),
    resumes: candidate.resumes.map((r) => serialize(r)),
    messages: candidate.conversations.flatMap((c) => c.messages.map((m) => serialize(m))),
  }
}

export async function exportEmployeeData(
  prisma: DbClient,
  args: { tenantId: string; employeeId: string },
) {
  const employee = await prisma.employee.findFirst({
    where: { id: args.employeeId, tenantId: args.tenantId },
    include: {
      lifecycleEvents: true,
      documents: true,
      checklists: { include: { tasks: true } },
      offboardingChecklists: { include: { tasks: true } },
    },
  })
  if (!employee) {
    throw Object.assign(new Error('Employee not found'), { code: 'NOT_FOUND' })
  }

  return {
    generatedAt: new Date().toISOString(),
    employee: serialize(employee, [
      'lifecycleEvents',
      'documents',
      'checklists',
      'offboardingChecklists',
    ]),
    lifecycleEvents: employee.lifecycleEvents.map((e) => serialize(e)),
    documents: employee.documents.map((d) => serialize(d)),
    onboarding: employee.checklists.map((c) => serialize(c)),
    offboarding: employee.offboardingChecklists.map((c) => serialize(c)),
  }
}

function serialize(row: Record<string, unknown>, skipKeys: string[] = []) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (skipKeys.includes(k)) continue
    if (v instanceof Date) out[k] = v.toISOString()
    else out[k] = v
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Data retention job
// ─────────────────────────────────────────────────────────────────────────────

export type RetentionRunResult = {
  processedCandidates: number
  processedEmployees: number
  processedApplications: number
  processedResumes: number
}

export async function runDataRetention(
  prisma: DbClient,
  args: { tenantId: string; now?: Date },
): Promise<RetentionRunResult> {
  const now = args.now ?? new Date()
  const policies = await prisma.dataRetentionPolicy.findMany({ where: { tenantId: args.tenantId } })

  const result: RetentionRunResult = {
    processedCandidates: 0,
    processedEmployees: 0,
    processedApplications: 0,
    processedResumes: 0,
  }

  for (const policy of policies) {
    if (policy.entityType === 'audit_event') continue
    const threshold = new Date(now.getTime() - policy.retainDays * 24 * 60 * 60 * 1000)

    if (policy.entityType === 'candidate') {
      // Только кандидаты без Application — те, что попали в воронку, остаются
      // под политикой `application`.
      const candidates = await prisma.candidate.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { lt: threshold },
          applications: { none: {} },
          // Уже анонимизированных не трогаем (fullName === ANON_NAME).
          NOT: { fullName: ANON_NAME },
        },
        select: { id: true, email: true },
      })

      for (const c of candidates) {
        if (policy.anonymize) {
          await prisma.candidate.update({
            where: { id: c.id },
            data: {
              fullName: ANON_NAME,
              email: c.email ? hashEmail(c.email) : null,
              phone: null,
              location: null,
              externalIds: {},
              consentContext: Prisma.JsonNull,
            },
          })
        } else {
          await prisma.candidate.delete({ where: { id: c.id } })
        }
        result.processedCandidates += 1
      }
    } else if (policy.entityType === 'employee') {
      // Только terminated сотрудники, прошедшие retainDays с момента
      // увольнения. Анонимизация затирает имя и контакты, но сохраняет
      // employment history для аналитики/архива.
      const employees = await prisma.employee.findMany({
        where: {
          tenantId: args.tenantId,
          status: 'terminated',
          terminatedAt: { lt: threshold },
          NOT: { fullName: ANON_NAME },
        },
        select: { id: true, email: true },
      })

      for (const e of employees) {
        if (policy.anonymize) {
          await prisma.employee.update({
            where: { id: e.id },
            data: {
              fullName: ANON_NAME,
              email: e.email ? hashEmail(e.email) : null,
              phone: null,
            },
          })
        } else {
          await prisma.employee.delete({ where: { id: e.id } })
        }
        result.processedEmployees += 1
      }
    } else if (policy.entityType === 'application') {
      const applications = await prisma.application.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { lt: threshold },
          stage: 'rejected',
        },
        select: { id: true },
      })
      for (const a of applications) {
        if (policy.anonymize) {
          await prisma.application.update({
            where: { id: a.id },
            data: { notes: null, aiScoring: undefined, aiInterviewQuestions: undefined },
          })
        } else {
          await prisma.application.delete({ where: { id: a.id } })
        }
        result.processedApplications += 1
      }
    } else if (policy.entityType === 'resume') {
      const resumes = await prisma.resume.findMany({
        where: {
          tenantId: args.tenantId,
          uploadedAt: { lt: threshold },
        },
        select: { id: true },
      })
      for (const r of resumes) {
        if (policy.anonymize) {
          await prisma.resume.update({
            where: { id: r.id },
            data: { parsedPayload: undefined, deletedAt: new Date() },
          })
        } else {
          await prisma.resume.delete({ where: { id: r.id } })
        }
        result.processedResumes += 1
      }
    }
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: args.tenantId,
      actorUserId: null,
      action: 'data_retention.run',
      entityType: 'Tenant',
      entityId: args.tenantId,
      diff: { ...result, runAt: now.toISOString() },
    },
  })

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing helpers
// ─────────────────────────────────────────────────────────────────────────────

export type BillingStatus = {
  enabled: boolean
  plan: {
    name: string
    maxEmployees: number
    maxUsers: number
    priceRubMonthly: number
  } | null
  subscription: {
    status: 'active' | 'past_due' | 'cancelled' | 'trialing'
    currentPeriodEnd: string | null
  } | null
  usage: { employees: number; users: number }
}

export async function getBillingStatus(
  prisma: DbClient,
  args: { tenantId: string; billingEnabled: boolean },
): Promise<BillingStatus> {
  const sub = await prisma.subscription.findUnique({
    where: { tenantId: args.tenantId },
    include: { plan: true },
  })

  const [employees, users] = await Promise.all([
    prisma.employee.count({
      where: { tenantId: args.tenantId, status: { not: 'terminated' } },
    }),
    prisma.userRole.findMany({
      where: { tenantId: args.tenantId },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ])

  return {
    enabled: args.billingEnabled,
    plan: sub
      ? {
          name: sub.plan.name,
          maxEmployees: sub.plan.maxEmployees,
          maxUsers: sub.plan.maxUsers,
          priceRubMonthly: sub.plan.priceRubMonthly,
        }
      : null,
    subscription: sub
      ? {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
        }
      : null,
    usage: { employees, users: users.length },
  }
}

/**
 * Throws `{ code: 'PLAN_LIMIT' }` when adding one more seat of the given kind
 * would exceed the active plan. No-op when billing is disabled or no plan is
 * attached.
 */
export async function enforceSeatLimit(
  prisma: DbClient,
  args: {
    tenantId: string
    billingEnabled: boolean
    seat: 'employee' | 'user'
  },
) {
  if (!args.billingEnabled) return

  const sub = await prisma.subscription.findUnique({
    where: { tenantId: args.tenantId },
    include: { plan: true },
  })
  if (!sub) return
  if (sub.status === 'cancelled') {
    throw Object.assign(new Error('Subscription cancelled'), { code: 'PLAN_LIMIT' })
  }

  if (args.seat === 'employee') {
    const used = await prisma.employee.count({
      where: { tenantId: args.tenantId, status: { not: 'terminated' } },
    })
    if (used + 1 > sub.plan.maxEmployees) {
      throw Object.assign(new Error('Employee seat limit reached'), { code: 'PLAN_LIMIT' })
    }
  } else {
    const used = await prisma.userRole.findMany({
      where: { tenantId: args.tenantId },
      select: { userId: true },
      distinct: ['userId'],
    })
    if (used.length + 1 > sub.plan.maxUsers) {
      throw Object.assign(new Error('User seat limit reached'), { code: 'PLAN_LIMIT' })
    }
  }
}
