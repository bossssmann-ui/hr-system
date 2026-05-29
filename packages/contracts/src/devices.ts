/**
 * Phase 11 — Mobile device tokens.
 *
 * The mobile app registers its Expo (or FCM/APNs) push token with the
 * backend on first launch / login. Tokens are scoped to the authenticated
 * user; one user can have multiple active devices.
 *
 * The push channel itself is gated by the server-side `MOBILE_PUSH_ENABLED`
 * feature flag — these endpoints accept and store tokens regardless so the
 * fleet is already enrolled when push is turned on.
 */

import { z } from 'zod'

export const devicePlatformSchema = z.enum(['ios', 'android', 'web'])
export type DevicePlatform = z.infer<typeof devicePlatformSchema>

export const registerDeviceRequestSchema = z.object({
  platform: devicePlatformSchema,
  // Expo push tokens look like `ExponentPushToken[xxxx...]`; FCM/APNs tokens
  // are opaque hex/base64 strings. We only enforce a sane length window.
  token: z.string().min(8).max(2048),
})
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>

export const deviceTokenSchema = z.object({
  id: z.string().uuid(),
  platform: devicePlatformSchema,
  token: z.string(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
})
export type DeviceToken = z.infer<typeof deviceTokenSchema>

export const registerDeviceResponseSchema = z.object({
  device: deviceTokenSchema,
})
export type RegisterDeviceResponse = z.infer<typeof registerDeviceResponseSchema>

export const listDevicesResponseSchema = z.object({
  items: z.array(deviceTokenSchema),
})
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>
