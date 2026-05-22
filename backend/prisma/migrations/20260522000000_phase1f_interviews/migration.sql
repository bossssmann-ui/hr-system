-- Phase 1F: Interview table with transcript/protocol/offer-draft JSONB columns.

-- Enum
CREATE TYPE "InterviewStatus" AS ENUM ('created', 'transcribing', 'transcribed', 'protocol_ready', 'failed');

-- Table
CREATE TABLE "interviews" (
    "id"                  UUID        NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID        NOT NULL,
    "application_id"      UUID        NOT NULL,
    "scheduled_at"        TIMESTAMPTZ,
    "recording_url"       TEXT,
    "consent_recorded"    BOOLEAN     NOT NULL DEFAULT false,
    "status"              "InterviewStatus" NOT NULL DEFAULT 'created',
    "transcript"          JSONB,
    "protocol"            JSONB,
    "offer_draft"         JSONB,
    "created_by_user_id"  UUID        NOT NULL,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "interviews"
    ADD CONSTRAINT "interviews_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE;

-- Indexes
CREATE INDEX "interviews_tenant_id_idx"      ON "interviews"("tenant_id");
CREATE INDEX "interviews_application_id_idx" ON "interviews"("application_id");

-- updated_at trigger (reuse pattern from Phase 0)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'interviews_updated_at'
  ) THEN
    CREATE TRIGGER interviews_updated_at
        BEFORE UPDATE ON "interviews"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interviews" FORCE ROW LEVEL SECURITY;

-- Recruiter / hr_admin / owner: full access within tenant.
CREATE POLICY "interviews_select" ON "interviews" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );

CREATE POLICY "interviews_insert" ON "interviews" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "interviews_update" ON "interviews" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "interviews_delete" ON "interviews" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

-- Grant to app runtime role
GRANT SELECT, INSERT, UPDATE, DELETE ON "interviews" TO app_user;
