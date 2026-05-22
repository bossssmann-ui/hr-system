-- Phase 1G: Public careers page + vacancy landings.
-- Adds `slug` to the `vacancies` table (unique per tenant, nullable until published).

-- ─────────────────────────────────────────────────────────────────────────────
-- Add slug column to vacancies
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "vacancies" ADD COLUMN "slug" TEXT;

-- Partial unique index: two rows can both have NULL slug (not yet published),
-- but once a slug is set it must be unique within the tenant.
CREATE UNIQUE INDEX "vacancies_tenant_id_slug_key"
    ON "vacancies" ("tenant_id", "slug")
    WHERE "slug" IS NOT NULL;
