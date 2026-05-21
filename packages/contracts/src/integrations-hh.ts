import { z } from 'zod'

export const hhIntegrationStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  reason: z.string().nullable().optional(),
  connected: z.boolean(),
  connection: z
    .object({
      tokenExpiresAt: z.string().datetime(),
      connectedEmployerId: z.string().nullable(),
    })
    .nullable()
    .optional(),
  linkedVacancies: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        hhVacancyId: z.string().nullable(),
      }),
    )
    .optional()
    .default([]),
  lastSyncAt: z.string().datetime().nullable().optional(),
})

export type HhIntegrationStatus = z.infer<typeof hhIntegrationStatusSchema>

export const hhAuthorizeUrlResponseSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  reason: z.string().nullable().optional(),
  authorizeUrl: z.string().url().optional(),
})

export type HhAuthorizeUrlResponse = z.infer<typeof hhAuthorizeUrlResponseSchema>

export const hhSyncSummarySchema = z.object({
  importedCandidates: z.number().int().nonnegative(),
  upsertedApplications: z.number().int().nonnegative(),
  vacanciesProcessed: z.number().int().nonnegative(),
  negotiationsScanned: z.number().int().nonnegative(),
  lastSyncedAt: z.string().datetime().nullable(),
})

export const hhSyncResponseSchema = z.object({
  ok: z.boolean(),
  summary: hhSyncSummarySchema,
})

export type HhSyncResponse = z.infer<typeof hhSyncResponseSchema>

export const hhCallbackResponseSchema = z.object({
  connected: z.boolean(),
})

export type HhCallbackResponse = z.infer<typeof hhCallbackResponseSchema>

export const hhVacancyLinkResponseSchema = z.object({
  vacancy: z.object({
    id: z.string(),
    title: z.string(),
    hhVacancyId: z.string().nullable(),
  }),
})

export type HhVacancyLinkResponse = z.infer<typeof hhVacancyLinkResponseSchema>
