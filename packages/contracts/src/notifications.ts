/**
 * Phase 10 — Notifications & realtime event contracts.
 *
 * Persisted notification rows are exposed via REST so the frontend can render
 * the bell dropdown and reconcile state after a reconnect. The realtime SSE
 * stream pushes thin events; consumers refetch the list to get the full row.
 */
import { z } from 'zod'

export const notificationChannelSchema = z.enum(['in_app', 'email', 'telegram'])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  channel: notificationChannelSchema,
  template: z.string(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type Notification = z.infer<typeof notificationSchema>

export const listNotificationsResponseSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
})
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>

export const markNotificationsReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
})
export type MarkNotificationsReadResponse = z.infer<typeof markNotificationsReadResponseSchema>

// ─── Realtime events ─────────────────────────────────────────────────────────

export const realtimeEventTypeSchema = z.enum([
  'notification.new',
  'application.stage_changed',
  'offer.status_changed',
  'checklist.task_updated',
  'review.request_submitted',
])
export type RealtimeEventType = z.infer<typeof realtimeEventTypeSchema>

export const realtimeEventSchema = z.object({
  type: realtimeEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
})
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>
