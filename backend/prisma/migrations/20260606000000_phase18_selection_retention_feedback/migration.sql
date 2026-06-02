-- Phase 18: retention prediction + outcome feedback loop for logist_domestic

ALTER TABLE "selection_verdicts"
  ADD COLUMN IF NOT EXISTS "retention_prediction" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'selection_retention_outcome_status') THEN
    CREATE TYPE "selection_retention_outcome_status" AS ENUM (
      'in_progress',
      'resolved_survived_90',
      'resolved_terminated'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "selection_retention_outcomes" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "session_id" UUID NOT NULL UNIQUE,
  "hire_date" DATE NOT NULL,
  "observed_days" INT NOT NULL,
  "survived_30" BOOLEAN NOT NULL,
  "survived_60" BOOLEAN NOT NULL,
  "survived_90" BOOLEAN NOT NULL,
  "termination_ground" "termination_ground",
  "outcome_status" "selection_retention_outcome_status" NOT NULL,
  "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "selection_retention_outcomes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "selection_retention_outcomes_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "selection_sessions"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "selection_retention_outcomes_tenant_id_idx"
  ON "selection_retention_outcomes" ("tenant_id");
CREATE INDEX IF NOT EXISTS "selection_retention_outcomes_tenant_status_idx"
  ON "selection_retention_outcomes" ("tenant_id", "outcome_status");

CREATE TABLE IF NOT EXISTS "selection_scoring_weights" (
  "id" UUID PRIMARY KEY DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "model_version" TEXT NOT NULL,
  "weights" JSONB NOT NULL,
  "sample_size" INT NOT NULL,
  "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "active" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "selection_scoring_weights_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "selection_scoring_weights_tenant_model_uk" UNIQUE ("tenant_id", "model_version")
);

CREATE INDEX IF NOT EXISTS "selection_scoring_weights_tenant_active_idx"
  ON "selection_scoring_weights" ("tenant_id", "active");
