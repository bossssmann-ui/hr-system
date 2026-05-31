-- Phase 15c: domestic logist AI interview + resume parsing
--
-- Adds per-session specializations (chosen package mix) and assessment profile
-- (resume signals + interview risk flags) JSONB columns to selection_sessions.
ALTER TABLE "selection_sessions"
    ADD COLUMN "specializations" JSONB,
    ADD COLUMN "assessment_profile" JSONB;
