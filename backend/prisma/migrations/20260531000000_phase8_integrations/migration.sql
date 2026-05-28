-- Phase 8: External integrations — TelegramLink + ExternalVacancyPost.
-- Adds two new tables for job-board publication tracking and
-- Telegram chat ↔ candidate/employee bindings.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "job_board" AS ENUM (
    'hh',
    'sber_podbor',
    'avito_jobs',
    'rabota_ru'
);

CREATE TYPE "external_vacancy_post_status" AS ENUM (
    'pending',
    'published',
    'unpublished',
    'failed'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ExternalVacancyPost
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "external_vacancy_posts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "board" "job_board" NOT NULL,
    "external_id" TEXT,
    "status" "external_vacancy_post_status" NOT NULL DEFAULT 'pending',
    "last_error" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_vacancy_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_vacancy_posts_vacancy_board_uk"
    ON "external_vacancy_posts" ("vacancy_id", "board");
CREATE INDEX "external_vacancy_posts_tenant_id_idx"
    ON "external_vacancy_posts" ("tenant_id");
CREATE INDEX "external_vacancy_posts_board_status_idx"
    ON "external_vacancy_posts" ("board", "status");

ALTER TABLE "external_vacancy_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_vacancy_posts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "external_vacancy_posts_select" ON "external_vacancy_posts" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "external_vacancy_posts_write" ON "external_vacancy_posts" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- TelegramLink
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "telegram_links" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "candidate_id" UUID,
    "employee_id" UUID,
    "chat_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links" ("chat_id");
CREATE INDEX "telegram_links_tenant_id_idx" ON "telegram_links" ("tenant_id");
CREATE INDEX "telegram_links_candidate_id_idx" ON "telegram_links" ("candidate_id");
CREATE INDEX "telegram_links_employee_id_idx" ON "telegram_links" ("employee_id");

ALTER TABLE "telegram_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_links" FORCE ROW LEVEL SECURITY;

CREATE POLICY "telegram_links_select" ON "telegram_links" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "telegram_links_write" ON "telegram_links" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );
