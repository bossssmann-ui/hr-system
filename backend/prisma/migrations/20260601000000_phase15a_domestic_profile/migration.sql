-- Phase 15a: specialization module results table
-- NOTE: specializations + assessment_profile columns are added by Phase 15c migration.
CREATE TABLE IF NOT EXISTS specialization_module_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID REFERENCES selection_sessions(id),
  package_id     TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('primary','secondary','mentioned_only','contradicted')),
  raw_score      NUMERIC(5,2),
  max_score      NUMERIC(5,2),
  weighted_score NUMERIC(5,2),
  flags          JSONB,
  submitted_at   TIMESTAMPTZ DEFAULT now()
);
