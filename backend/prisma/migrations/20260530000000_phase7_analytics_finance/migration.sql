-- Phase 7: HR Analytics & Finance — HrSnapshot daily aggregates,
-- compensation planning (CompPlan / CompPlanItem) for payroll & comp review.
-- Spec: docs/contracts/00-overview.md, issue Phase 7.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "comp_plan_status" AS ENUM ('draft', 'approved', 'applied');

-- ─────────────────────────────────────────────────────────────────────────────
-- hr_snapshots — materialised daily KPI rollup, one row per tenant per day.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "hr_snapshots" (
    "id"                       UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"                UUID         NOT NULL,
    "snapshot_date"            DATE         NOT NULL,
    "headcount"                INTEGER      NOT NULL,
    "headcount_by_status"      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "headcount_by_org_unit"    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "open_requisitions"        INTEGER      NOT NULL DEFAULT 0,
    "hired_mtd"                INTEGER      NOT NULL DEFAULT 0,
    "terminated_mtd"           INTEGER      NOT NULL DEFAULT 0,
    "avg_time_to_hire_days"    DECIMAL(10,2),
    "probation_pass_rate_qtd"  DECIMAL(5,2),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_snapshots_tenant_date_unique"
    ON "hr_snapshots"("tenant_id", "snapshot_date");
CREATE INDEX "hr_snapshots_tenant_id_idx" ON "hr_snapshots"("tenant_id");
CREATE INDEX "hr_snapshots_date_idx" ON "hr_snapshots"("snapshot_date");

-- ─────────────────────────────────────────────────────────────────────────────
-- comp_plans — HR-curated compensation review cycle (raises, promotions).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "comp_plans" (
    "id"                  UUID               NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID               NOT NULL,
    "name"                TEXT               NOT NULL,
    "effective_date"      DATE               NOT NULL,
    "budget_currency"     "Currency"         NOT NULL,
    "budget_total"        INTEGER            NOT NULL DEFAULT 0,
    "status"              "comp_plan_status" NOT NULL DEFAULT 'draft',
    "notes"               TEXT,
    "created_by_user_id"  UUID               NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at"         TIMESTAMP(3),
    "applied_at"          TIMESTAMP(3),
    "created_at"          TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comp_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comp_plans_budget_nonneg_check" CHECK ("budget_total" >= 0)
);

CREATE INDEX "comp_plans_tenant_id_idx" ON "comp_plans"("tenant_id");
CREATE INDEX "comp_plans_status_idx" ON "comp_plans"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- comp_plan_items — line items per employee inside a CompPlan.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "comp_plan_items" (
    "id"              UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"       UUID         NOT NULL,
    "plan_id"         UUID         NOT NULL,
    "employee_id"     UUID         NOT NULL,
    "current_salary"  INTEGER      NOT NULL,
    "proposed_salary" INTEGER      NOT NULL,
    "currency"        "Currency"   NOT NULL,
    "change_pct"      DECIMAL(7,2) NOT NULL,
    "reason"          TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comp_plan_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comp_plan_items_salary_positive_check"
        CHECK ("current_salary" >= 0 AND "proposed_salary" >= 0)
);

ALTER TABLE "comp_plan_items"
    ADD CONSTRAINT "comp_plan_items_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "comp_plans"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "comp_plan_items_plan_employee_unique"
    ON "comp_plan_items"("plan_id", "employee_id");
CREATE INDEX "comp_plan_items_tenant_id_idx" ON "comp_plan_items"("tenant_id");
CREATE INDEX "comp_plan_items_plan_id_idx" ON "comp_plan_items"("plan_id");
CREATE INDEX "comp_plan_items_employee_id_idx" ON "comp_plan_items"("employee_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (set_updated_at() is defined in earlier migrations)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'comp_plans_updated_at') THEN
    CREATE TRIGGER comp_plans_updated_at
        BEFORE UPDATE ON "comp_plans"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'comp_plan_items_updated_at') THEN
    CREATE TRIGGER comp_plan_items_updated_at
        BEFORE UPDATE ON "comp_plan_items"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation; hr_admin / owner full write access; analytics read
-- is also exposed to hiring_manager (dashboards in their workflow).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "hr_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hr_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY "hr_snapshots_select" ON "hr_snapshots" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('hiring_manager'))
    );

CREATE POLICY "hr_snapshots_insert" ON "hr_snapshots" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "hr_snapshots_update" ON "hr_snapshots" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "hr_snapshots_delete" ON "hr_snapshots" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "hr_snapshots" TO app_user;

ALTER TABLE "comp_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comp_plans" FORCE ROW LEVEL SECURITY;

CREATE POLICY "comp_plans_select" ON "comp_plans" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('hiring_manager'))
    );

CREATE POLICY "comp_plans_insert" ON "comp_plans" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "comp_plans_update" ON "comp_plans" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "comp_plans_delete" ON "comp_plans" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "comp_plans" TO app_user;

ALTER TABLE "comp_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comp_plan_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "comp_plan_items_select" ON "comp_plan_items" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('hiring_manager'))
    );

CREATE POLICY "comp_plan_items_insert" ON "comp_plan_items" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "comp_plan_items_update" ON "comp_plan_items" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "comp_plan_items_delete" ON "comp_plan_items" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "comp_plan_items" TO app_user;
