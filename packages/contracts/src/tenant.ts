import { z } from 'zod'

import { roleNameSchema } from './admin'
import { emailSchema, passwordSchema } from './auth'

// ─────────────────────────────────────────────────────────────────────────────
// Tenant registration — POST /api/register
// ─────────────────────────────────────────────────────────────────────────────

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'Slug must be lowercase letters, digits, or dashes',
  })

export const registerTenantRequestSchema = z.object({
  tenantName: z.string().trim().min(2).max(120),
  slug: tenantSlugSchema,
  ownerEmail: emailSchema,
  ownerPassword: passwordSchema,
  ownerDisplayName: z.string().trim().min(2).max(80).optional(),
})

export type RegisterTenantRequest = z.infer<typeof registerTenantRequestSchema>

export const registerTenantResponseSchema = z.object({
  tenant: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
    roles: z.array(roleNameSchema),
    createdAt: z.string().datetime(),
  }),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
})

export type RegisterTenantResponse = z.infer<typeof registerTenantResponseSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Tenant settings — GET / PATCH /api/settings/tenant
// ─────────────────────────────────────────────────────────────────────────────

export const tenantSettingsSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  subdomain: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  timezone: z.string(),
  locale: z.string(),
  featureFlags: z.record(z.string(), z.boolean()),
  scoringWeights: z.record(z.string(), z.number()).nullable(),
  pipelineThresholds: z
    .object({
      autoSelection: z.number().min(0).max(100),
      autoReject: z.number().min(0).max(100),
    })
    .refine((value) => value.autoReject <= value.autoSelection, {
      message: 'autoReject must be less than or equal to autoSelection',
      path: ['autoReject'],
    })
    .nullable(),
})

export type TenantSettings = z.infer<typeof tenantSettingsSchema>

export const updateTenantSettingsRequestSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().url().max(1024).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a #RRGGBB hex string' })
    .nullable()
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(16).optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  scoringWeights: z.record(z.string(), z.number()).nullable().optional(),
  pipelineThresholds: z
    .object({
      autoSelection: z.number().min(0).max(100),
      autoReject: z.number().min(0).max(100),
    })
    .refine((value) => value.autoReject <= value.autoSelection, {
      message: 'autoReject must be less than or equal to autoSelection',
      path: ['autoReject'],
    })
    .nullable()
    .optional(),
})

export type UpdateTenantSettingsRequest = z.infer<typeof updateTenantSettingsRequestSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Data retention
// ─────────────────────────────────────────────────────────────────────────────

export const retentionEntityTypeSchema = z.enum([
  'candidate',
  'employee',
  'audit_event',
  'application',
  'resume',
])

export type RetentionEntityType = z.infer<typeof retentionEntityTypeSchema>

export const dataRetentionPolicySchema = z.object({
  id: z.string(),
  entityType: retentionEntityTypeSchema,
  retainDays: z.number().int().positive(),
  anonymize: z.boolean(),
})

export type DataRetentionPolicy = z.infer<typeof dataRetentionPolicySchema>

export const retentionRunResponseSchema = z.object({
  processedCandidates: z.number().int().nonnegative(),
  processedEmployees: z.number().int().nonnegative(),
  processedApplications: z.number().int().nonnegative(),
  processedResumes: z.number().int().nonnegative(),
})

export type RetentionRunResponse = z.infer<typeof retentionRunResponseSchema>

// ─────────────────────────────────────────────────────────────────────────────
// GDPR Art.17 / Art.20
// ─────────────────────────────────────────────────────────────────────────────

export const eraseCandidateResponseSchema = z.object({
  id: z.string(),
  status: z.literal('erased'),
})

export type EraseCandidateResponse = z.infer<typeof eraseCandidateResponseSchema>

export const candidateDataExportSchema = z.object({
  generatedAt: z.string().datetime(),
  candidate: z.record(z.string(), z.unknown()),
  applications: z.array(z.record(z.string(), z.unknown())),
  resumes: z.array(z.record(z.string(), z.unknown())),
  messages: z.array(z.record(z.string(), z.unknown())),
})

export type CandidateDataExport = z.infer<typeof candidateDataExportSchema>

export const employeeDataExportSchema = z.object({
  generatedAt: z.string().datetime(),
  employee: z.record(z.string(), z.unknown()),
  lifecycleEvents: z.array(z.record(z.string(), z.unknown())),
  documents: z.array(z.record(z.string(), z.unknown())),
  onboarding: z.array(z.record(z.string(), z.unknown())),
  offboarding: z.array(z.record(z.string(), z.unknown())),
})

export type EmployeeDataExport = z.infer<typeof employeeDataExportSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionStatusSchema = z.enum(['active', 'past_due', 'cancelled', 'trialing'])

export const billingStatusResponseSchema = z.object({
  enabled: z.boolean(),
  plan: z
    .object({
      name: z.string(),
      maxEmployees: z.number().int().nonnegative(),
      maxUsers: z.number().int().nonnegative(),
      priceRubMonthly: z.number().int().nonnegative(),
    })
    .nullable(),
  subscription: z
    .object({
      status: subscriptionStatusSchema,
      currentPeriodEnd: z.string().datetime().nullable(),
    })
    .nullable(),
  usage: z.object({
    employees: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
  }),
})

export type BillingStatusResponse = z.infer<typeof billingStatusResponseSchema>
