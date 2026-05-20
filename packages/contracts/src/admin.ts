import { z } from 'zod'

export const roleNameSchema = z.enum([
  'owner',
  'hr_admin',
  'recruiter',
  'hiring_manager',
  'employee',
  'candidate',
])

export type RoleName = z.infer<typeof roleNameSchema>

export const userWithRolesSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  roles: z.array(roleNameSchema),
  createdAt: z.string().datetime(),
})

export type UserWithRoles = z.infer<typeof userWithRolesSchema>

export const listUsersResponseSchema = z.object({
  items: z.array(userWithRolesSchema),
})

export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>

export const auditEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  actorUserId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  diff: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
})

export type AuditEvent = z.infer<typeof auditEventSchema>

export const listAuditEventsResponseSchema = z.object({
  items: z.array(auditEventSchema),
  nextCursor: z.string().nullable(),
})

export type ListAuditEventsResponse = z.infer<typeof listAuditEventsResponseSchema>
