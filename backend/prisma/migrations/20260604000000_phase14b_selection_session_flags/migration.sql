-- Phase 14b: per-session selection flags
--
-- Stores the randomly-chosen Stage 1 trap key (and future per-session
-- assessment metadata). Nullable JSONB so existing rows stay valid.

ALTER TABLE "selection_sessions"
    ADD COLUMN "flags" JSONB;
