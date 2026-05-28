-- Phase 6: Learning & Performance — LMS, 1:1s, 360° Reviews, OKRs, IDPs.
-- Spec: docs/contracts/10-data-model.md (Phase 6 section), issue Phase 6.
--
-- All new tables follow the standard tenant/RLS pattern:
--   * tenant_id UUID NOT NULL (RLS scoped to current_tenant)
--   * updated_at trigger via set_updated_at()
--   * RLS policies: hr_admin/owner full access; employees read-only on their
--     own rows; managers (hiring_manager) inherit hr_admin read where stated.
--   * GRANTed to app_user.

-- ─────────────────────────────────────────────────────────────────────────────
-- Employees: add role_family for learning-path auto-assignment
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "role_family" TEXT;
CREATE INDEX IF NOT EXISTS "employees_role_family_idx" ON "employees"("role_family");

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "learning_content_type" AS ENUM ('video', 'article', 'quiz', 'external_link', 'scorm');
CREATE TYPE "learning_assignment_status" AS ENUM ('assigned', 'started', 'completed', 'expired');
CREATE TYPE "one_on_one_status" AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE "review_cycle_status" AS ENUM ('draft', 'open', 'closed');
CREATE TYPE "review_request_status" AS ENUM ('pending', 'submitted', 'declined');
CREATE TYPE "okr_status" AS ENUM ('draft', 'active', 'achieved', 'missed');
CREATE TYPE "key_result_status" AS ENUM ('open', 'on_track', 'at_risk', 'achieved');
CREATE TYPE "idp_status" AS ENUM ('draft', 'active', 'completed');
CREATE TYPE "idp_item_status" AS ENUM ('planned', 'in_progress', 'completed', 'dropped');

-- ─────────────────────────────────────────────────────────────────────────────
-- learning_courses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "learning_courses" (
    "id"               UUID                    NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID                    NOT NULL,
    "title"            TEXT                    NOT NULL,
    "description"      TEXT,
    "content_type"     "learning_content_type" NOT NULL,
    "content_url"      TEXT,
    "duration_minutes" INTEGER,
    "is_mandatory"     BOOLEAN                 NOT NULL DEFAULT FALSE,
    "org_unit_id"      UUID,
    "created_by_user_id" UUID                  NOT NULL,
    "deleted_at"       TIMESTAMP(3),
    "created_at"       TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_courses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_courses_tenant_id_idx"   ON "learning_courses"("tenant_id");
CREATE INDEX "learning_courses_org_unit_id_idx" ON "learning_courses"("org_unit_id");
CREATE INDEX "learning_courses_deleted_at_idx"  ON "learning_courses"("deleted_at");

ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'learning_courses_updated_at') THEN
    CREATE TRIGGER learning_courses_updated_at
        BEFORE UPDATE ON "learning_courses"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "learning_courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_courses" FORCE ROW LEVEL SECURITY;

CREATE POLICY "learning_courses_select" ON "learning_courses" FOR SELECT
    USING (tenant_id = app.current_tenant_id());

CREATE POLICY "learning_courses_write" ON "learning_courses" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_courses" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- learning_paths
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "learning_paths" (
    "id"                UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"         UUID         NOT NULL,
    "title"             TEXT         NOT NULL,
    "description"       TEXT,
    "role_family"       TEXT,
    "auto_assign"       BOOLEAN      NOT NULL DEFAULT FALSE,
    "created_by_user_id" UUID        NOT NULL,
    "deleted_at"        TIMESTAMP(3),
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_paths_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_paths_tenant_id_idx"    ON "learning_paths"("tenant_id");
CREATE INDEX "learning_paths_role_family_idx"  ON "learning_paths"("role_family");
CREATE INDEX "learning_paths_deleted_at_idx"   ON "learning_paths"("deleted_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'learning_paths_updated_at') THEN
    CREATE TRIGGER learning_paths_updated_at
        BEFORE UPDATE ON "learning_paths"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "learning_paths" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_paths" FORCE ROW LEVEL SECURITY;

CREATE POLICY "learning_paths_select" ON "learning_paths" FOR SELECT
    USING (tenant_id = app.current_tenant_id());

CREATE POLICY "learning_paths_write" ON "learning_paths" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_paths" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- learning_path_items (course ordered inside a path)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "learning_path_items" (
    "id"          UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID         NOT NULL,
    "path_id"     UUID         NOT NULL,
    "course_id"   UUID         NOT NULL,
    "item_order"  INTEGER      NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_path_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_path_items_tenant_id_idx" ON "learning_path_items"("tenant_id");
CREATE INDEX "learning_path_items_path_id_idx"   ON "learning_path_items"("path_id");
CREATE UNIQUE INDEX "learning_path_items_path_order_key" ON "learning_path_items"("path_id", "item_order");

ALTER TABLE "learning_path_items" ADD CONSTRAINT "learning_path_items_path_id_fkey"
    FOREIGN KEY ("path_id") REFERENCES "learning_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_path_items" ADD CONSTRAINT "learning_path_items_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "learning_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'learning_path_items_updated_at') THEN
    CREATE TRIGGER learning_path_items_updated_at
        BEFORE UPDATE ON "learning_path_items"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "learning_path_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_path_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "learning_path_items_select" ON "learning_path_items" FOR SELECT
    USING (tenant_id = app.current_tenant_id());

CREATE POLICY "learning_path_items_write" ON "learning_path_items" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_path_items" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- learning_assignments (course or path assigned to employee)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "learning_assignments" (
    "id"                 UUID                          NOT NULL DEFAULT uuidv7(),
    "tenant_id"          UUID                          NOT NULL,
    "employee_id"        UUID                          NOT NULL,
    "course_id"          UUID,
    "path_id"            UUID,
    "status"             "learning_assignment_status"  NOT NULL DEFAULT 'assigned',
    "progress_percent"   INTEGER                       NOT NULL DEFAULT 0,
    "score"              INTEGER,
    "due_date"           DATE,
    "started_at"         TIMESTAMP(3),
    "completed_at"       TIMESTAMP(3),
    "assigned_by_user_id" UUID                         NOT NULL,
    "created_at"         TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "learning_assignments_target_chk" CHECK (
        (course_id IS NOT NULL AND path_id IS NULL)
        OR (course_id IS NULL AND path_id IS NOT NULL)
    ),
    CONSTRAINT "learning_assignments_progress_chk" CHECK (progress_percent >= 0 AND progress_percent <= 100)
);

CREATE INDEX "learning_assignments_tenant_id_idx"   ON "learning_assignments"("tenant_id");
CREATE INDEX "learning_assignments_employee_id_idx" ON "learning_assignments"("employee_id");
CREATE INDEX "learning_assignments_status_idx"      ON "learning_assignments"("status");
CREATE UNIQUE INDEX "learning_assignments_employee_course_key"
    ON "learning_assignments"("employee_id", "course_id") WHERE "course_id" IS NOT NULL;
CREATE UNIQUE INDEX "learning_assignments_employee_path_key"
    ON "learning_assignments"("employee_id", "path_id") WHERE "path_id" IS NOT NULL;

ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "learning_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_path_id_fkey"
    FOREIGN KEY ("path_id") REFERENCES "learning_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'learning_assignments_updated_at') THEN
    CREATE TRIGGER learning_assignments_updated_at
        BEFORE UPDATE ON "learning_assignments"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "learning_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "learning_assignments_select" ON "learning_assignments" FOR SELECT
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

CREATE POLICY "learning_assignments_update_self" ON "learning_assignments" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND app.has_role('employee')
        AND EXISTS (
            SELECT 1 FROM employees e
            WHERE e.id = employee_id AND e.user_id = app.current_user_id()
        )
    )
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "learning_assignments_write" ON "learning_assignments" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_assignments" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- one_on_ones
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "one_on_ones" (
    "id"               UUID                  NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID                  NOT NULL,
    "employee_id"      UUID                  NOT NULL,
    "manager_user_id"  UUID                  NOT NULL,
    "scheduled_at"     TIMESTAMP(3)          NOT NULL,
    "duration_minutes" INTEGER,
    "status"           "one_on_one_status"   NOT NULL DEFAULT 'scheduled',
    "agenda"           TEXT,
    "notes"            TEXT,
    "action_items"     JSONB                 NOT NULL DEFAULT '[]'::jsonb,
    "reminder_sent_at" TIMESTAMP(3),
    "completed_at"     TIMESTAMP(3),
    "created_by_user_id" UUID                NOT NULL,
    "created_at"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "one_on_ones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "one_on_ones_tenant_id_idx"      ON "one_on_ones"("tenant_id");
CREATE INDEX "one_on_ones_employee_id_idx"    ON "one_on_ones"("employee_id");
CREATE INDEX "one_on_ones_manager_user_id_idx" ON "one_on_ones"("manager_user_id");
CREATE INDEX "one_on_ones_scheduled_at_idx"   ON "one_on_ones"("scheduled_at");
CREATE INDEX "one_on_ones_status_idx"         ON "one_on_ones"("status");

ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'one_on_ones_updated_at') THEN
    CREATE TRIGGER one_on_ones_updated_at
        BEFORE UPDATE ON "one_on_ones"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "one_on_ones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "one_on_ones" FORCE ROW LEVEL SECURITY;

CREATE POLICY "one_on_ones_select" ON "one_on_ones" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR manager_user_id = app.current_user_id()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    );

CREATE POLICY "one_on_ones_write" ON "one_on_ones" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR manager_user_id = app.current_user_id())
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR manager_user_id = app.current_user_id())
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "one_on_ones" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- review_cycles + review_requests (360° feedback)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "review_cycles" (
    "id"          UUID                   NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID                   NOT NULL,
    "title"       TEXT                   NOT NULL,
    "quarter"     TEXT                   NOT NULL,
    "status"      "review_cycle_status"  NOT NULL DEFAULT 'draft',
    "questions"   JSONB                  NOT NULL DEFAULT '[]'::jsonb,
    "opened_at"   TIMESTAMP(3),
    "closes_at"   TIMESTAMP(3),
    "closed_at"   TIMESTAMP(3),
    "created_by_user_id" UUID            NOT NULL,
    "created_at"  TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_cycles_tenant_id_idx" ON "review_cycles"("tenant_id");
CREATE INDEX "review_cycles_status_idx"    ON "review_cycles"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'review_cycles_updated_at') THEN
    CREATE TRIGGER review_cycles_updated_at
        BEFORE UPDATE ON "review_cycles"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "review_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_cycles" FORCE ROW LEVEL SECURITY;

CREATE POLICY "review_cycles_select" ON "review_cycles" FOR SELECT
    USING (tenant_id = app.current_tenant_id());

CREATE POLICY "review_cycles_write" ON "review_cycles" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "review_cycles" TO app_user;

CREATE TABLE "review_requests" (
    "id"                  UUID                      NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                      NOT NULL,
    "cycle_id"            UUID                      NOT NULL,
    "subject_employee_id" UUID                      NOT NULL,
    "reviewer_user_id"    UUID                      NOT NULL,
    "relationship"        TEXT                      NOT NULL DEFAULT 'peer',
    "status"              "review_request_status"   NOT NULL DEFAULT 'pending',
    "response"            JSONB,
    "decline_reason"      TEXT,
    "submitted_at"        TIMESTAMP(3),
    "declined_at"         TIMESTAMP(3),
    "reminder_sent_at"    TIMESTAMP(3),
    "created_at"          TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_requests_tenant_id_idx"           ON "review_requests"("tenant_id");
CREATE INDEX "review_requests_cycle_id_idx"            ON "review_requests"("cycle_id");
CREATE INDEX "review_requests_subject_employee_id_idx" ON "review_requests"("subject_employee_id");
CREATE INDEX "review_requests_reviewer_user_id_idx"    ON "review_requests"("reviewer_user_id");
CREATE INDEX "review_requests_status_idx"              ON "review_requests"("status");
CREATE UNIQUE INDEX "review_requests_cycle_subject_reviewer_key"
    ON "review_requests"("cycle_id", "subject_employee_id", "reviewer_user_id");

ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_subject_employee_id_fkey"
    FOREIGN KEY ("subject_employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'review_requests_updated_at') THEN
    CREATE TRIGGER review_requests_updated_at
        BEFORE UPDATE ON "review_requests"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "review_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_requests" FORCE ROW LEVEL SECURITY;

-- Reviewer sees their own requests; subject sees aggregated results only when
-- cycle is closed (enforced at the service layer when returning aggregates);
-- admins see all.
CREATE POLICY "review_requests_select" ON "review_requests" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR reviewer_user_id = app.current_user_id()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = subject_employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    );

CREATE POLICY "review_requests_update_self" ON "review_requests" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND reviewer_user_id = app.current_user_id()
    )
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "review_requests_write" ON "review_requests" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "review_requests" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- okrs + key_results
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "okrs" (
    "id"          UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID         NOT NULL,
    "employee_id" UUID         NOT NULL,
    "parent_okr_id" UUID,
    "quarter"     TEXT         NOT NULL,
    "objective"   TEXT         NOT NULL,
    "description" TEXT,
    "status"      "okr_status" NOT NULL DEFAULT 'draft',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID  NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "okrs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "okrs_progress_chk" CHECK (progress_percent >= 0 AND progress_percent <= 100)
);

CREATE INDEX "okrs_tenant_id_idx"      ON "okrs"("tenant_id");
CREATE INDEX "okrs_employee_id_idx"    ON "okrs"("employee_id");
CREATE INDEX "okrs_quarter_idx"        ON "okrs"("quarter");
CREATE INDEX "okrs_parent_okr_id_idx"  ON "okrs"("parent_okr_id");

ALTER TABLE "okrs" ADD CONSTRAINT "okrs_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "okrs" ADD CONSTRAINT "okrs_parent_okr_id_fkey"
    FOREIGN KEY ("parent_okr_id") REFERENCES "okrs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'okrs_updated_at') THEN
    CREATE TRIGGER okrs_updated_at
        BEFORE UPDATE ON "okrs"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "okrs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "okrs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "okrs_select" ON "okrs" FOR SELECT
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

CREATE POLICY "okrs_write" ON "okrs" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "okrs" TO app_user;

CREATE TABLE "key_results" (
    "id"            UUID                 NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID                 NOT NULL,
    "okr_id"        UUID                 NOT NULL,
    "title"         TEXT                 NOT NULL,
    "unit"          TEXT,
    "start_value"   DOUBLE PRECISION     NOT NULL DEFAULT 0,
    "target_value"  DOUBLE PRECISION     NOT NULL,
    "current_value" DOUBLE PRECISION     NOT NULL DEFAULT 0,
    "status"        "key_result_status"  NOT NULL DEFAULT 'open',
    "created_at"    TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "key_results_tenant_id_idx" ON "key_results"("tenant_id");
CREATE INDEX "key_results_okr_id_idx"    ON "key_results"("okr_id");

ALTER TABLE "key_results" ADD CONSTRAINT "key_results_okr_id_fkey"
    FOREIGN KEY ("okr_id") REFERENCES "okrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'key_results_updated_at') THEN
    CREATE TRIGGER key_results_updated_at
        BEFORE UPDATE ON "key_results"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "key_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "key_results" FORCE ROW LEVEL SECURITY;

CREATE POLICY "key_results_select" ON "key_results" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
            OR EXISTS (
                SELECT 1 FROM okrs o JOIN employees e ON e.id = o.employee_id
                WHERE o.id = okr_id AND e.user_id = app.current_user_id()
            )
        )
    );

CREATE POLICY "key_results_write" ON "key_results" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM okrs o JOIN employees e ON e.id = o.employee_id
                WHERE o.id = okr_id AND e.user_id = app.current_user_id()
            )
        )
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM okrs o JOIN employees e ON e.id = o.employee_id
                WHERE o.id = okr_id AND e.user_id = app.current_user_id()
            )
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "key_results" TO app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- idps + idp_items
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "idps" (
    "id"          UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID         NOT NULL,
    "employee_id" UUID         NOT NULL,
    "quarter"     TEXT         NOT NULL,
    "summary"     TEXT,
    "status"      "idp_status" NOT NULL DEFAULT 'draft',
    "created_by_user_id" UUID  NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idps_tenant_id_idx"   ON "idps"("tenant_id");
CREATE INDEX "idps_employee_id_idx" ON "idps"("employee_id");
CREATE UNIQUE INDEX "idps_employee_quarter_key" ON "idps"("employee_id", "quarter");

ALTER TABLE "idps" ADD CONSTRAINT "idps_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'idps_updated_at') THEN
    CREATE TRIGGER idps_updated_at
        BEFORE UPDATE ON "idps"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "idps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idps" FORCE ROW LEVEL SECURITY;

CREATE POLICY "idps_select" ON "idps" FOR SELECT
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

CREATE POLICY "idps_write" ON "idps" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM employees e
                    WHERE e.id = employee_id AND e.user_id = app.current_user_id()
                )
            )
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "idps" TO app_user;

CREATE TABLE "idp_items" (
    "id"          UUID              NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID              NOT NULL,
    "idp_id"      UUID              NOT NULL,
    "title"       TEXT              NOT NULL,
    "description" TEXT,
    "status"      "idp_item_status" NOT NULL DEFAULT 'planned',
    "due_date"    DATE,
    "completed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idp_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idp_items_tenant_id_idx" ON "idp_items"("tenant_id");
CREATE INDEX "idp_items_idp_id_idx"    ON "idp_items"("idp_id");

ALTER TABLE "idp_items" ADD CONSTRAINT "idp_items_idp_id_fkey"
    FOREIGN KEY ("idp_id") REFERENCES "idps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'idp_items_updated_at') THEN
    CREATE TRIGGER idp_items_updated_at
        BEFORE UPDATE ON "idp_items"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE "idp_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idp_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "idp_items_select" ON "idp_items" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
            OR EXISTS (
                SELECT 1 FROM idps i JOIN employees e ON e.id = i.employee_id
                WHERE i.id = idp_id AND e.user_id = app.current_user_id()
            )
        )
    );

CREATE POLICY "idp_items_write" ON "idp_items" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM idps i JOIN employees e ON e.id = i.employee_id
                WHERE i.id = idp_id AND e.user_id = app.current_user_id()
            )
        )
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM idps i JOIN employees e ON e.id = i.employee_id
                WHERE i.id = idp_id AND e.user_id = app.current_user_id()
            )
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "idp_items" TO app_user;
