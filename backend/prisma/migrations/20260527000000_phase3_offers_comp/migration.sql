-- Phase 3: Offer lifecycle + Compensation calculator.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "OfferStatus" AS ENUM (
    'draft',
    'manager_review',
    'approved',
    'sent',
    'accepted',
    'declined',
    'expired'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- offers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "offers" (
    "id"                       UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"                UUID         NOT NULL,
    "application_id"           UUID         NOT NULL,
    "interview_id"             UUID,
    "salary"                   INTEGER      NOT NULL,
    "currency"                 "Currency"   NOT NULL,
    "start_date"               DATE         NOT NULL,
    "grade"                    TEXT,
    "conditions"               TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"                   "OfferStatus" NOT NULL DEFAULT 'draft',
    "docuseal_submission_id"   TEXT,
    "docuseal_document_url"    TEXT,
    "docuseal_signing_url"     TEXT,
    "sent_at"                  TIMESTAMPTZ,
    "expires_at"               TIMESTAMPTZ,
    "accepted_at"              TIMESTAMPTZ,
    "declined_at"              TIMESTAMPTZ,
    "declined_reason"          TEXT,
    "created_by_user_id"       UUID         NOT NULL,
    "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offers_salary_positive_check" CHECK ("salary" > 0)
);

ALTER TABLE "offers"
    ADD CONSTRAINT "offers_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE;

ALTER TABLE "offers"
    ADD CONSTRAINT "offers_interview_id_fkey"
    FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE SET NULL;

CREATE INDEX "offers_tenant_id_idx"          ON "offers"("tenant_id");
CREATE INDEX "offers_application_id_idx"     ON "offers"("application_id");
CREATE INDEX "offers_status_expires_at_idx"  ON "offers"("status", "expires_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- comp_bands
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "comp_bands" (
    "id"          UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID         NOT NULL,
    "grade"       TEXT         NOT NULL,
    "currency"    "Currency"   NOT NULL,
    "min_salary"  INTEGER      NOT NULL,
    "mid_salary"  INTEGER      NOT NULL,
    "max_salary"  INTEGER      NOT NULL,
    "deleted_at"  TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "comp_bands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comp_bands_ordering_check"
        CHECK ("min_salary" > 0 AND "min_salary" <= "mid_salary" AND "mid_salary" <= "max_salary")
);

CREATE UNIQUE INDEX "comp_bands_tenant_grade_currency_unique"
    ON "comp_bands"("tenant_id", "grade", "currency");
CREATE INDEX "comp_bands_tenant_id_idx" ON "comp_bands"("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'offers_updated_at') THEN
    CREATE TRIGGER offers_updated_at
        BEFORE UPDATE ON "offers"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'comp_bands_updated_at') THEN
    CREATE TRIGGER comp_bands_updated_at
        BEFORE UPDATE ON "comp_bands"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "offers_select" ON "offers" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );

CREATE POLICY "offers_insert" ON "offers" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

CREATE POLICY "offers_update" ON "offers" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "offers_delete" ON "offers" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "offers" TO app_user;

ALTER TABLE "comp_bands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comp_bands" FORCE ROW LEVEL SECURITY;

CREATE POLICY "comp_bands_select" ON "comp_bands" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );

CREATE POLICY "comp_bands_insert" ON "comp_bands" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "comp_bands_update" ON "comp_bands" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "comp_bands_delete" ON "comp_bands" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "comp_bands" TO app_user;
