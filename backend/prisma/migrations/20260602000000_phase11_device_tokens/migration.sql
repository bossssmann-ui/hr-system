-- Phase 11: Mobile app — device tokens for push notifications.
--
-- One row per (user, push-token). Tokens come from Expo/FCM/APNs and are
-- registered by the mobile client on first launch / login. Soft-disabled
-- (is_active = false) when Expo reports DeviceNotRegistered.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "device_platform" AS ENUM ('ios', 'android', 'web');

-- Extend the notification channel enum with the new `push` variant. The
-- in_app channel keeps its current semantics; the push channel is gated by
-- MOBILE_PUSH_ENABLED and is a no-op when the flag is off.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'push';

-- ─────────────────────────────────────────────────────────────────────────────
-- device_tokens
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "device_tokens" (
    "id"         UUID              NOT NULL DEFAULT uuidv7(),
    "tenant_id"  UUID              NOT NULL,
    "user_id"    UUID              NOT NULL,
    "platform"   "device_platform" NOT NULL,
    "token"      TEXT              NOT NULL,
    "is_active"  BOOLEAN           NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_tokens_user_id_token_uk"
    ON "device_tokens" ("user_id", "token");
CREATE INDEX "device_tokens_tenant_id_idx"  ON "device_tokens" ("tenant_id");
CREATE INDEX "device_tokens_user_active_idx" ON "device_tokens" ("user_id", "is_active");

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — owner-scoped: a user can manage only their own device tokens.
-- Tenant admins (owner / hr_admin) can read all tokens in their tenant for
-- diagnostics; mutations are always restricted to the owning user.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "device_tokens_owner_rw" ON "device_tokens"
    USING (
        tenant_id = app.current_tenant_id()
        AND (user_id = app.current_user_id() OR app.is_admin())
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND user_id = app.current_user_id()
    );
