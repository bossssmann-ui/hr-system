import { z } from 'zod'

export const orgUnitSchema = z.object({
  id: z.string(),
  name: z.string(),
  tenantId: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type OrgUnit = z.infer<typeof orgUnitSchema>

export const createOrgUnitRequestSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
})

export type CreateOrgUnitRequest = z.infer<typeof createOrgUnitRequestSchema>

export const listOrgUnitsResponseSchema = z.object({
  items: z.array(orgUnitSchema),
})

export type ListOrgUnitsResponse = z.infer<typeof listOrgUnitsResponseSchema>
