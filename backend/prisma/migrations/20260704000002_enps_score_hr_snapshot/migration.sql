-- Polishing A — eNPS as tenant KPI in HR snapshot (issue #171).
-- Additive: only adds a nullable column, no data loss, backward-compatible.
ALTER TABLE "hr_snapshots"
ADD COLUMN "enps_score" DECIMAL(5,2);
