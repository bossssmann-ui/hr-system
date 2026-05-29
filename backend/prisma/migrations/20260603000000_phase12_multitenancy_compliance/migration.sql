-- Phase 12: Multi-tenancy activation, compliance (152-ФЗ / GDPR) and billing.
--
-- - Tenant gains `slug` / `subdomain` for self-serve registration and
--   subdomain routing (Caddy wildcard cert handles the TLS side).
-- - tenant_settings stores per-tenant branding, locale, timezone, and
--   feature_flags (jsonb overrides on top of process-level env flags).
-- - data_retention_policies drive the monthly `data.retention` cron job:
--   anonymise PII for rows older than retainDays when anonymize=true,
--   otherwise hard-delete. AuditEvent rows are never matched (the cron
--   skips entity_type='audit_event' policies on delete).
-- - plans + subscriptions back the billing flow guarded by BILLING_ENABLED.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant: slug + subdomain
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "tenants"
    ADD COLUMN "slug"      TEXT,
    ADD COLUMN "subdomain" TEXT;

CREATE UNIQUE INDEX "tenants_slug_key"      ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_settings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "tenant_settings" (
    "tenant_id"     UUID         NOT NULL,
    "logo_url"      TEXT,
    "primary_color" TEXT,
    "timezone"      TEXT         NOT NULL DEFAULT 'Europe/Moscow',
    "locale"        TEXT         NOT NULL DEFAULT 'ru-RU',
    "feature_flags" JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "tenant_settings_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_isolation" ON "tenant_settings"
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- data_retention_policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "retention_entity_type" AS ENUM (
    'candidate',
    'employee',
    'audit_event',
    'application',
    'resume'
);

CREATE TABLE "data_retention_policies" (
    "id"          UUID                    NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID                    NOT NULL,
    "entity_type" "retention_entity_type" NOT NULL,
    "retain_days" INT                     NOT NULL,
    "anonymize"   BOOLEAN                 NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_retention_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_retention_policies_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "data_retention_policies_tenant_entity_uk"
    ON "data_retention_policies"("tenant_id", "entity_type");
CREATE INDEX "data_retention_policies_tenant_id_idx"
    ON "data_retention_policies"("tenant_id");

ALTER TABLE "data_retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_retention_policies" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "data_retention_policies_isolation" ON "data_retention_policies"
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- plans + subscriptions
--
-- `plans` is a global catalogue (no tenant_id). `subscriptions` is one row per
-- tenant; enforcement at the API layer reads it to enforce seat limits.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "subscription_status" AS ENUM (
    'active',
    'past_due',
    'cancelled',
    'trialing'
);

CREATE TABLE "plans" (
    "id"                 UUID         NOT NULL DEFAULT uuidv7(),
    "name"               TEXT         NOT NULL,
    "max_employees"      INT          NOT NULL,
    "max_users"          INT          NOT NULL,
    "price_rub_monthly"  INT          NOT NULL,
    "features"           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

CREATE TABLE "subscriptions" (
    "id"                     UUID                  NOT NULL DEFAULT uuidv7(),
    "tenant_id"              UUID                  NOT NULL,
    "plan_id"                UUID                  NOT NULL,
    "status"                 "subscription_status" NOT NULL DEFAULT 'active',
    "current_period_end"     TIMESTAMP(3),
    "stripe_subscription_id" TEXT,
    "created_at"             TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "subscriptions_plan_id_fkey"
        FOREIGN KEY ("plan_id")   REFERENCES "plans"("id")
);

CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");
CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_isolation" ON "subscriptions"
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id());

-- Seed the canonical free trial plan so the bootstrap tenant and the
-- self-serve `POST /api/register` flow always have a plan to attach to.
INSERT INTO "plans" ("name", "max_employees", "max_users", "price_rub_monthly", "features")
VALUES
    ('starter',  25,   5,      0, '{"description":"Free trial — up to 25 employees"}'::jsonb),
    ('growth',   100,  20, 19900, '{"description":"Growth plan — up to 100 employees"}'::jsonb),
    ('business', 500,  100, 49900, '{"description":"Business plan — up to 500 employees"}'::jsonb)
ON CONFLICT ("name") DO NOTHING;
