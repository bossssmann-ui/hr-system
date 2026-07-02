/**
 * Contracts for Horizon 4 — Performance module.
 *
 * Standalone 1:1 (OneOnOne) endpoint schemas.
 * The employee-scoped variants live in `learning.ts` and remain unchanged.
 */

import { z } from 'zod'

// ─── OneOnOne status ─────────────────────────────────────────────────────────

export const performanceOneOnOneStatusSchema = z.enum(['scheduled', 'completed', 'cancelled'])
export type PerformanceOneOnOneStatus = z.infer<typeof performanceOneOnOneStatusSchema>

// ─── Action item (complete-request shape) ────────────────────────────────────

export const performanceActionItemSchema = z.object({
  text: z.string().min(1),
  assigneeUserId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
})
export type PerformanceActionItem = z.infer<typeof performanceActionItemSchema>

// ─── Create request ──────────────────────────────────────────────────────────

export const createOneOnOneRequestSchema = z.object({
  employeeId: z.string().uuid(),
  managerUserId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  agenda: z.string().optional(),
})
export type CreateOneOnOneRequest = z.infer<typeof createOneOnOneRequestSchema>

// ─── Patch request (reschedule / edit agenda / durationMinutes) ──────────────

export const patchOneOnOneRequestSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  agenda: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
})
export type PatchOneOnOneRequest = z.infer<typeof patchOneOnOneRequestSchema>

// ─── Complete request ────────────────────────────────────────────────────────

export const completeOneOnOneRequestSchema = z.object({
  notes: z.string().optional(),
  actionItems: z.array(performanceActionItemSchema).optional(),
})
export type CompleteOneOnOneRequest = z.infer<typeof completeOneOnOneRequestSchema>

// ─── Response DTO ────────────────────────────────────────────────────────────

export const oneOnOneResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  managerUserId: z.string(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().nullable(),
  status: performanceOneOnOneStatusSchema,
  agenda: z.string().nullable(),
  notes: z.string().nullable(),
  actionItems: z.array(performanceActionItemSchema),
  reminderSentAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type OneOnOneResponse = z.infer<typeof oneOnOneResponseSchema>

// ─── List response ───────────────────────────────────────────────────────────

export const listOneOnOnesResponseSchema = z.object({
  items: z.array(oneOnOneResponseSchema),
  total: z.number().int(),
})
export type ListOneOnOnesResponse = z.infer<typeof listOneOnOnesResponseSchema>
