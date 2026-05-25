-- Phase 4.1: Employee Lifecycle.
-- Spec: docs/employee-lifecycle-design.md §2 (+ §1.3 reuse).
-- Adds employees, employee_lifecycle_events, onboarding_checklists,
-- onboarding_tasks, employment_documents with tenant-scoped RLS and the
-- §2 invariants encoded as UNIQUE / CHECK constraints.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "employee_status" AS ENUM (
    'pre_onboarding',
    'probation',
    'active',
    'on_leave',
    'terminated',
    'alumni'
);

CREATE TYPE "employment_type" AS ENUM (
    'full_time',
    'part_time',
    'contract',
    'internship'
);

CREATE TYPE "termination_ground" AS ENUM (
    'voluntary_resignation',
    'involuntary',
    'end_of_contract',
    'probation_fail',
    'mutual_agreement',
    'retirement',
    'other'
);

CREATE TYPE "probation_outcome" AS ENUM (
    'passed',
    'failed',
    'extended'
);

CREATE TYPE "onboarding_task_status" AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'skipped',
    'blocked'
);

CREATE TYPE "lifecycle_event_type" AS ENUM (
    'hired',
    'probation_started',
    'probation_passed',
    'probation_failed',
    'probation_extended',
    'role_change',
    'transfer',
    'leave_started',
    'leave_ended',
    'terminated',
    'rehired'
);

CREATE TYPE "employment_document_type" AS ENUM (
    'offer_letter',
    'employment_contract',
    'nda',
    'addendum',
    'termination_letter',
    'certificate',
    'other'
);

CREATE TYPE "employment_document_status" AS ENUM (
    'draft',
    'pending_signature',
    'signed',
    'declined',
    'expired',
    'archived'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- employees
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employees" (
    "id"                  UUID                  NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                  NOT NULL,
    "user_id"             UUID,
    "application_id"      UUID,
    "org_unit_id"         UUID,
    "full_name"           TEXT                  NOT NULL,
    "email"               TEXT,
    "phone"               TEXT,
    "job_title"           TEXT,
    "employment_type"     "employment_type"     NOT NULL,
    "status"              "employee_status"     NOT NULL DEFAULT 'pre_onboarding',
    "hire_date"           DATE,
    "probation_ends_at"   TIMESTAMP(3),
    "probation_outcome"   "probation_outcome",
    "terminated_at"       TIMESTAMP(3),
    "termination_ground"  "termination_ground",
    "termination_note"    TEXT,
    "created_at"          TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),

    -- §2 invariants:
    --   - application_id is unique (one Application → at most one Employee).
    --     The UNIQUE INDEX below also enforces this; the named constraint
    --     keeps it discoverable in error messages.
    --   - status='probation' ⇒ probation_ends_at NOT NULL.
    --   - status='terminated' ⇒ terminated_at NOT NULL AND termination_ground NOT NULL.
    CONSTRAINT "employees_probation_requires_ends_at_chk"
        CHECK ("status" <> 'probation' OR "probation_ends_at" IS NOT NULL),
    CONSTRAINT "employees_terminated_requires_metadata_chk"
        CHECK (
            "status" <> 'terminated'
            OR ("terminated_at" IS NOT NULL AND "termination_ground" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX "employees_user_id_key"        ON "employees"("user_id")        WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "employees_application_id_key" ON "employees"("application_id") WHERE "application_id" IS NOT NULL;
CREATE INDEX        "employees_tenant_id_idx"      ON "employees"("tenant_id");
CREATE INDEX        "employees_org_unit_id_idx"    ON "employees"("org_unit_id");
CREATE INDEX        "employees_status_idx"         ON "employees"("status");
CREATE INDEX        "employees_user_id_idx"        ON "employees"("user_id");

ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- employee_lifecycle_events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employee_lifecycle_events" (
    "id"            UUID                    NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID                    NOT NULL,
    "employee_id"   UUID                    NOT NULL,
    "type"          "lifecycle_event_type"  NOT NULL,
    "from_status"   "employee_status",
    "to_status"     "employee_status",
    "effective_at"  TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "payload"       JSONB,
    "note"          TEXT,
    "created_at"    TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_lifecycle_events_tenant_id_idx"            ON "employee_lifecycle_events"("tenant_id");
CREATE INDEX "employee_lifecycle_events_employee_effective_idx"   ON "employee_lifecycle_events"("employee_id", "effective_at");
CREATE INDEX "employee_lifecycle_events_type_idx"                 ON "employee_lifecycle_events"("type");

ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- onboarding_checklists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "onboarding_checklists" (
    "id"           UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID         NOT NULL,
    "employee_id"  UUID         NOT NULL,
    "title"        TEXT         NOT NULL,
    "description"  TEXT,
    "due_date"     DATE,
    "completed_at" TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_checklists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_checklists_tenant_id_idx"   ON "onboarding_checklists"("tenant_id");
CREATE INDEX "onboarding_checklists_employee_id_idx" ON "onboarding_checklists"("employee_id");

ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- onboarding_tasks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "onboarding_tasks" (
    "id"                   UUID                     NOT NULL DEFAULT uuidv7(),
    "tenant_id"            UUID                     NOT NULL,
    "checklist_id"         UUID                     NOT NULL,
    "task_order"           INTEGER                  NOT NULL,
    "title"                TEXT                     NOT NULL,
    "description"          TEXT,
    "status"               "onboarding_task_status" NOT NULL DEFAULT 'pending',
    "assignee_user_id"     UUID,
    "due_date"             DATE,
    "completed_at"         TIMESTAMP(3),
    "completed_by_user_id" UUID,
    "created_at"           TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_tasks_checklist_order_key" ON "onboarding_tasks"("checklist_id", "task_order");
CREATE INDEX        "onboarding_tasks_tenant_id_idx"       ON "onboarding_tasks"("tenant_id");
CREATE INDEX        "onboarding_tasks_checklist_id_idx"    ON "onboarding_tasks"("checklist_id");
CREATE INDEX        "onboarding_tasks_status_idx"          ON "onboarding_tasks"("status");

ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_checklist_id_fkey"
    FOREIGN KEY ("checklist_id") REFERENCES "onboarding_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- employment_documents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employment_documents" (
    "id"                  UUID                         NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                         NOT NULL,
    "employee_id"         UUID                         NOT NULL,
    "type"                "employment_document_type"   NOT NULL,
    "status"              "employment_document_status" NOT NULL DEFAULT 'draft',
    "title"               TEXT                         NOT NULL,
    "file_url"            TEXT,
    "metadata"            JSONB,
    "issued_at"           TIMESTAMP(3),
    "signed_at"           TIMESTAMP(3),
    "expires_at"          TIMESTAMP(3),
    "created_by_user_id"  UUID                         NOT NULL,
    "created_at"          TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employment_documents_tenant_id_idx"   ON "employment_documents"("tenant_id");
CREATE INDEX "employment_documents_employee_id_idx" ON "employment_documents"("employee_id");
CREATE INDEX "employment_documents_type_idx"        ON "employment_documents"("type");
CREATE INDEX "employment_documents_status_idx"      ON "employment_documents"("status");

ALTER TABLE "employment_documents" ADD CONSTRAINT "employment_documents_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse pattern from Phase 0/1F)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'employees_updated_at') THEN
    CREATE TRIGGER employees_updated_at
        BEFORE UPDATE ON "employees"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'onboarding_checklists_updated_at') THEN
    CREATE TRIGGER onboarding_checklists_updated_at
        BEFORE UPDATE ON "onboarding_checklists"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'onboarding_tasks_updated_at') THEN
    CREATE TRIGGER onboarding_tasks_updated_at
        BEFORE UPDATE ON "onboarding_tasks"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'employment_documents_updated_at') THEN
    CREATE TRIGGER employment_documents_updated_at
        BEFORE UPDATE ON "employment_documents"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- Pattern matches Phase 1D/1E/1F/2:
--   - owner / hr_admin: full read+write within tenant
--   - recruiter: read-only (visibility for hand-off from recruiting → HR)
--   - hiring_manager: read-only within tenant
--   - employee self-read for own row / own checklists / own documents
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employees_select" ON "employees" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR app.has_role('hiring_manager')
            OR (app.has_role('employee') AND user_id = app.current_user_id())
        )
    );

CREATE POLICY "employees_insert" ON "employees" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "employees_update" ON "employees" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "employees_delete" ON "employees" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

ALTER TABLE "employee_lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_lifecycle_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employee_lifecycle_events_select" ON "employee_lifecycle_events" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR app.has_role('hiring_manager')
        )
    );

CREATE POLICY "employee_lifecycle_events_insert" ON "employee_lifecycle_events" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

CREATE POLICY "employee_lifecycle_events_update" ON "employee_lifecycle_events" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY "employee_lifecycle_events_delete" ON "employee_lifecycle_events" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

ALTER TABLE "onboarding_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_checklists" FORCE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_checklists_select" ON "onboarding_checklists" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
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

CREATE POLICY "onboarding_checklists_write" ON "onboarding_checklists" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

ALTER TABLE "onboarding_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_tasks" FORCE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_tasks_select" ON "onboarding_tasks" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('hiring_manager')
            OR (
                app.has_role('employee')
                AND EXISTS (
                    SELECT 1 FROM onboarding_checklists c
                    JOIN employees e ON e.id = c.employee_id
                    WHERE c.id = checklist_id
                      AND e.user_id = app.current_user_id()
                )
            )
        )
    );

CREATE POLICY "onboarding_tasks_write" ON "onboarding_tasks" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

ALTER TABLE "employment_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employment_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "employment_documents_select" ON "employment_documents" FOR SELECT
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

CREATE POLICY "employment_documents_write" ON "employment_documents" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants to runtime role
-- ─────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON
    "employees",
    "employee_lifecycle_events",
    "onboarding_checklists",
    "onboarding_tasks",
    "employment_documents"
TO app_user;
