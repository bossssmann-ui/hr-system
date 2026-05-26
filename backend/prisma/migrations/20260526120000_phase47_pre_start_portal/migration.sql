-- Phase 4.7: Pre-start inbox / first-day plan.
-- Spec: docs/employee-lifecycle-design.md §5.3 (roadmap §7.4).
-- Adds `pre_start_portal_entries` opened by `createFromApplication` together
-- with the `Employee(pre_onboarding)` row. The entry stays `pending_link`
-- until `hr_admin` links a `User(role = employee)` to the employee.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "pre_start_portal_status" AS ENUM (
    'pending_link',
    'active',
    'closed'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pre_start_portal_entries" (
    "id"          UUID                      NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID                      NOT NULL,
    "employee_id" UUID                      NOT NULL,
    "status"      "pre_start_portal_status" NOT NULL DEFAULT 'pending_link',
    "opened_at"   TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_at"   TIMESTAMP(3),
    "closed_at"   TIMESTAMP(3),
    "created_at"  TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_start_portal_entries_pkey" PRIMARY KEY ("id")
);

-- One portal entry per employee.
CREATE UNIQUE INDEX "pre_start_portal_entries_employee_id_key"
    ON "pre_start_portal_entries"("employee_id");
CREATE INDEX "pre_start_portal_entries_tenant_id_idx"
    ON "pre_start_portal_entries"("tenant_id");
CREATE INDEX "pre_start_portal_entries_status_idx"
    ON "pre_start_portal_entries"("status");

ALTER TABLE "pre_start_portal_entries" ADD CONSTRAINT "pre_start_portal_entries_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger (reuse the helper installed in Phase 4.1)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pre_start_portal_entries_updated_at') THEN
    CREATE TRIGGER pre_start_portal_entries_updated_at
        BEFORE UPDATE ON "pre_start_portal_entries"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- Pattern matches Phase 4.1 employment_documents:
--   - owner / hr_admin: full read+write within tenant.
--   - employee: read own row, only once `Employee.user_id` is linked (gating
--     promised in §5.3; rows in `pending_link` remain invisible to the
--     candidate because Employee.user_id is still NULL at that point).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "pre_start_portal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pre_start_portal_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pre_start_portal_entries_select" ON "pre_start_portal_entries" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id
                      AND e.user_id = app.current_user_id()
                )
            )
        )
    );

CREATE POLICY "pre_start_portal_entries_write" ON "pre_start_portal_entries" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "pre_start_portal_entries" TO app_user;
