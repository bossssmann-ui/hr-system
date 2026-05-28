import { z } from 'zod'

/** Phase 8 — aggregate integrations status returned by `GET /api/integrations/status`. */
export const integrationsStatusSchema = z.object({
  telegram: z.object({
    enabled: z.boolean(),
    configured: z.boolean(),
    activeLinks: z.number().int().nonnegative(),
  }),
  email: z.object({
    enabled: z.boolean(),
    configured: z.boolean(),
    from: z.string().nullable(),
  }),
  hh: z.object({
    enabled: z.boolean(),
    configured: z.boolean(),
    connected: z.boolean(),
    lastSyncAt: z.string().datetime().nullable(),
  }),
  jobBoards: z.array(
    z.object({
      board: z.enum(['sber_podbor', 'avito_jobs', 'rabota_ru']),
      enabled: z.boolean(),
      configured: z.boolean(),
      reason: z.string().nullable(),
      publishedVacancies: z.number().int().nonnegative(),
    }),
  ),
})

export type IntegrationsStatus = z.infer<typeof integrationsStatusSchema>
