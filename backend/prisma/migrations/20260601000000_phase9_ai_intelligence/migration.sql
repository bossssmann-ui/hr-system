-- Phase 9: AI & Intelligence — per-employee flight-risk / burnout signals
-- and the HR Knowledge Hub (RAG, text-search fallback).
-- Spec: docs/contracts/00-overview.md, issue Phase 9.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "analytics_signal_type"   AS ENUM ('flight_risk', 'burnout');
CREATE TYPE "analytics_signal_status" AS ENUM ('open', 'reviewed', 'dismissed');

-- ─────────────────────────────────────────────────────────────────────────────
-- analytics_signals — one row per (employee, signal type). Daily upsert by
-- the `signals.compute` cron task. `factors` is the human-readable break-
-- down used to render the UI list ("manager-1on1 overdue 35d", etc.).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "analytics_signals" (
    "id"          UUID                       NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID                       NOT NULL,
    "employee_id" UUID                       NOT NULL,
    "type"        "analytics_signal_type"    NOT NULL,
    "score"       INTEGER                    NOT NULL,
    "factors"     JSONB                      NOT NULL DEFAULT '[]'::jsonb,
    "status"      "analytics_signal_status"  NOT NULL DEFAULT 'open',
    "computed_at" TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "created_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_signals_pkey"       PRIMARY KEY ("id"),
    CONSTRAINT "analytics_signals_score_range" CHECK ("score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "analytics_signals_employee_type_uk"
    ON "analytics_signals" ("employee_id", "type");
CREATE INDEX "analytics_signals_tenant_id_idx" ON "analytics_signals" ("tenant_id");
CREATE INDEX "analytics_signals_status_idx"    ON "analytics_signals" ("status");
CREATE INDEX "analytics_signals_type_score_idx" ON "analytics_signals" ("type", "score");

-- ─────────────────────────────────────────────────────────────────────────────
-- knowledge_articles — RAG knowledge hub. `search_vector` is a generated
-- tsvector column maintained by a trigger so we don't have to mirror it in
-- application code (avoids drift). Without pgvector we rely on tsvector
-- text search; an `embedding` column can be added later without migration
-- pain since the route already gracefully falls back.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "knowledge_articles" (
    "id"                  UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID         NOT NULL,
    "title"               TEXT         NOT NULL,
    "body"                TEXT         NOT NULL,
    "tags"                TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "visibility"          TEXT         NOT NULL DEFAULT 'internal',
    "created_by_user_id"  UUID         NOT NULL,
    "updated_by_user_id"  UUID,
    "deleted_at"          TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector"       tsvector,
    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_articles_visibility_check"
        CHECK ("visibility" IN ('internal', 'portal'))
);

CREATE INDEX "knowledge_articles_tenant_id_idx"  ON "knowledge_articles" ("tenant_id");
CREATE INDEX "knowledge_articles_deleted_at_idx" ON "knowledge_articles" ("deleted_at");
CREATE INDEX "knowledge_articles_search_vector_idx"
    ON "knowledge_articles" USING GIN ("search_vector");

-- Maintain search_vector on insert/update from title + body. Uses
-- the 'simple' config so multi-language (RU + EN) content searches
-- predictably without requiring extra dictionaries.
CREATE OR REPLACE FUNCTION knowledge_articles_search_vector_refresh()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW.body,  '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_articles_search_vector_refresh
    BEFORE INSERT OR UPDATE OF title, body ON "knowledge_articles"
    FOR EACH ROW EXECUTE FUNCTION knowledge_articles_search_vector_refresh();

-- updated_at triggers (set_updated_at() is defined in earlier migrations).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'analytics_signals_updated_at') THEN
    CREATE TRIGGER analytics_signals_updated_at
        BEFORE UPDATE ON "analytics_signals"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_articles_updated_at') THEN
    CREATE TRIGGER knowledge_articles_updated_at
        BEFORE UPDATE ON "knowledge_articles"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation. Signals are admin/hiring_manager-only (sensitive).
-- Knowledge Hub is admin-write, all roles read (employees see their portal
-- search in the same table).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "analytics_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_signals" FORCE ROW LEVEL SECURITY;

CREATE POLICY "analytics_signals_select" ON "analytics_signals" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('hiring_manager'))
    );

CREATE POLICY "analytics_signals_write" ON "analytics_signals" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "analytics_signals" TO app_user;

ALTER TABLE "knowledge_articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_articles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_articles_select" ON "knowledge_articles" FOR SELECT
    USING (tenant_id = app.current_tenant_id());

CREATE POLICY "knowledge_articles_write" ON "knowledge_articles" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_articles" TO app_user;
