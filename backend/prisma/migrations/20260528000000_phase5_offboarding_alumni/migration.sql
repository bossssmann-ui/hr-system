-- Phase 5: Offboarding, alumni network & employee self-service portal.

-- ─────────────────────────────────────────────────────────────────────────────
-- User.disabled_at (for deactivation on termination)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_at" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "alumni_status" AS ENUM ('active', 'do_not_rehire', 'archived');
CREATE TYPE "exit_reason_category" AS ENUM ('voluntary', 'mutual', 'probation_failed', 'for_cause', 'other');
ALTER TYPE "lifecycle_event_type" ADD VALUE IF NOT EXISTS 'notice_started';

-- ─────────────────────────────────────────────────────────────────────────────
-- offboarding_checklists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "offboarding_checklists" (
    "id"          UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID         NOT NULL,
    "employee_id" UUID         NOT NULL,
    "title"       TEXT         NOT NULL,
    "description" TEXT,
    "due_date"    DATE,
    "completed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offboarding_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offboarding_checklists_tenant_id_idx" ON "offboarding_checklists"("tenant_id");
CREATE INDEX "offboarding_checklists_employee_id_idx" ON "offboarding_checklists"("employee_id");

ALTER TABLE "offboarding_checklists" ADD CONSTRAINT "offboarding_checklists_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'offboarding_checklists_updated_at') THEN
    CREATE TRIGGER offboarding_checklists_updated_at
        BEFORE UPDATE ON "offboarding_checklists"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "offboarding_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offboarding_checklists" FORCE ROW LEVEL SECURITY;

CREATE POLICY "offboarding_checklists_select" ON "offboarding_checklists" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    );

CREATE POLICY "offboarding_checklists_write" ON "offboarding_checklists" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "offboarding_checklists" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- offboarding_tasks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "offboarding_tasks" (
    "id"                  UUID                    NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                    NOT NULL,
    "checklist_id"        UUID                    NOT NULL,
    "task_order"          INTEGER                 NOT NULL,
    "title"               TEXT                    NOT NULL,
    "description"         TEXT,
    "assignee_role"       TEXT                    NOT NULL,
    "status"              "onboarding_task_status" NOT NULL DEFAULT 'pending',
    "assignee_user_id"    UUID,
    "due_date"            DATE,
    "completed_at"        TIMESTAMP(3),
    "completed_by_user_id" UUID,
    "created_at"          TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offboarding_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offboarding_tasks_tenant_id_idx" ON "offboarding_tasks"("tenant_id");
CREATE INDEX "offboarding_tasks_checklist_id_idx" ON "offboarding_tasks"("checklist_id");
CREATE INDEX "offboarding_tasks_status_idx" ON "offboarding_tasks"("status");
CREATE UNIQUE INDEX "offboarding_tasks_checklist_order_key" ON "offboarding_tasks"("checklist_id", "task_order");

ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_checklist_id_fkey"
    FOREIGN KEY ("checklist_id") REFERENCES "offboarding_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'offboarding_tasks_updated_at') THEN
    CREATE TRIGGER offboarding_tasks_updated_at
        BEFORE UPDATE ON "offboarding_tasks"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "offboarding_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offboarding_tasks" FORCE ROW LEVEL SECURITY;

CREATE POLICY "offboarding_tasks_select" ON "offboarding_tasks" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
            OR (
                app.has_role('employee')
                AND assignee_user_id = app.current_user_id()
            )
        )
    );

CREATE POLICY "offboarding_tasks_write" ON "offboarding_tasks" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "offboarding_tasks" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- exit_interviews
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "exit_interviews" (
    "id"                  UUID                   NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                   NOT NULL,
    "employee_id"         UUID                   NOT NULL,
    "conducted_by_user_id" UUID,
    "conducted_at"        TIMESTAMP(3),
    "reason_category"     "exit_reason_category" NOT NULL,
    "notes"               TEXT,
    "would_rehire"        BOOLEAN,
    "metadata"            JSONB,
    "created_at"          TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exit_interviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exit_interviews_employee_id_key" ON "exit_interviews"("employee_id");
CREATE INDEX "exit_interviews_tenant_id_idx" ON "exit_interviews"("tenant_id");

ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'exit_interviews_updated_at') THEN
    CREATE TRIGGER exit_interviews_updated_at
        BEFORE UPDATE ON "exit_interviews"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "exit_interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exit_interviews" FORCE ROW LEVEL SECURITY;

CREATE POLICY "exit_interviews_select" ON "exit_interviews" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
        )
    );

CREATE POLICY "exit_interviews_write" ON "exit_interviews" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "exit_interviews" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- alumni_profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "alumni_profiles" (
    "id"                   UUID            NOT NULL DEFAULT uuidv7(),
    "tenant_id"            UUID            NOT NULL,
    "employee_id"          UUID            NOT NULL,
    "candidate_id"         UUID,
    "status"               "alumni_status" NOT NULL DEFAULT 'active',
    "would_rehire"         BOOLEAN,
    "departure_reason"     TEXT,
    "rehire_eligible_from" DATE,
    "tags"                 TEXT[]          NOT NULL DEFAULT '{}',
    "notes"                TEXT,
    "created_at"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alumni_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alumni_profiles_employee_id_key" ON "alumni_profiles"("employee_id");
CREATE INDEX "alumni_profiles_tenant_id_idx" ON "alumni_profiles"("tenant_id");
CREATE INDEX "alumni_profiles_status_idx" ON "alumni_profiles"("status");

ALTER TABLE "alumni_profiles" ADD CONSTRAINT "alumni_profiles_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alumni_profiles" ADD CONSTRAINT "alumni_profiles_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'alumni_profiles_updated_at') THEN
    CREATE TRIGGER alumni_profiles_updated_at
        BEFORE UPDATE ON "alumni_profiles"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "alumni_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alumni_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "alumni_profiles_select" ON "alumni_profiles" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND app.is_admin()
    );

CREATE POLICY "alumni_profiles_write" ON "alumni_profiles" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "alumni_profiles" TO app_user;
