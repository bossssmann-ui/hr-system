-- Phase 4.3: Employee Handoff.
-- Spec: docs/employee-lifecycle-design.md §1.2.
-- Adds snapshot columns to `employees` so that `createFromApplication` can
-- record candidate_id, requisition_id, grade, currency, agreed_base_salary,
-- and agreed_start_date at the moment of hire.

-- ─────────────────────────────────────────────────────────────────────────────
-- Snapshot columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees"
    ADD COLUMN "candidate_id"       UUID,
    ADD COLUMN "requisition_id"     UUID,
    ADD COLUMN "grade"              TEXT,
    ADD COLUMN "currency"           TEXT,
    ADD COLUMN "agreed_base_salary" INTEGER,
    ADD COLUMN "agreed_start_date"  DATE;

-- Default employment_type to full_time so createFromApplication can omit it
-- when the source data has no explicit employment type.
ALTER TABLE "employees"
    ALTER COLUMN "employment_type" SET DEFAULT 'full_time';

-- ─────────────────────────────────────────────────────────────────────────────
-- Foreign keys
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees"
    ADD CONSTRAINT "employees_candidate_id_fkey"
        FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employees"
    ADD CONSTRAINT "employees_requisition_id_fkey"
        FOREIGN KEY ("requisition_id") REFERENCES "hiring_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "employees_candidate_id_idx"    ON "employees"("candidate_id");
CREATE INDEX "employees_requisition_id_idx"  ON "employees"("requisition_id");
