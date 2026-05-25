-- Phase 4.1 — Employee lifecycle.
-- Creates the Employee, EmployeeLifecycleEvent, OnboardingChecklist,
-- OnboardingTask and EmploymentDocument tables (plus their enums) and the
-- RLS policies described in `docs/contracts/30-rls-policies.md`.
--
-- §2 invariants encoded as CHECK constraints:
--   * employees.application_id is UNIQUE (one Employee per hired Application).
--   * status = 'probation'  → probation_ends_at IS NOT NULL.
--   * status = 'terminated' → termination_date AND termination_ground IS NOT NULL.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "EmployeeStatus" AS ENUM (
    'prehire', 'probation', 'active', 'on_leave', 'terminated', 'alumni'
);

CREATE TYPE "EmploymentType" AS ENUM (
    'permanent', 'fixed_term', 'contractor', 'intern', 'part_time'
);

CREATE TYPE "TerminationGround" AS ENUM (
    'voluntary',
    'mutual_agreement',
    'employer_initiative',
    'probation_failed',
    'fixed_term_expiry',
    'redundancy',
    'for_cause',
    'other'
);

CREATE TYPE "ProbationOutcome" AS ENUM ('passed', 'failed', 'extended');

CREATE TYPE "OnboardingTaskStatus" AS ENUM (
    'pending', 'in_progress', 'done', 'blocked', 'skipped'
);

CREATE TYPE "LifecycleEventType" AS ENUM (
    'hired',
    'probation_started',
    'probation_extended',
    'probation_passed',
    'probation_failed',
    'transferred',
    'role_changed',
    'compensation_changed',
    'leave_started',
    'leave_ended',
    'terminated',
    'rehired'
);

CREATE TYPE "EmploymentDocumentType" AS ENUM (
    'employment_contract',
    'additional_agreement',
    'nda',
    'transfer_order',
    'termination_order',
    'id_document',
    'tax_form',
    'medical_certificate',
    'other'
);

CREATE TYPE "EmploymentDocumentStatus" AS ENUM (
    'draft', 'pending_signature', 'signed', 'archived', 'expired'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- employees
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employees" (
    "id"                 UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"          UUID NOT NULL,
    "user_id"            UUID,
    "application_id"     UUID,
    "org_unit_id"        UUID NOT NULL,
    "manager_user_id"    UUID,
    "full_name"          TEXT NOT NULL,
    "work_email"         TEXT,
    "personal_email"     TEXT,
    "phone"              TEXT,
    "employment_type"    "EmploymentType" NOT NULL,
    "status"             "EmployeeStatus" NOT NULL DEFAULT 'prehire',
    "hire_date"          DATE NOT NULL,
    "start_date"         DATE,
    "probation_ends_at"  DATE,
    "probation_outcome"  "ProbationOutcome",
    "termination_date"   DATE,
    "termination_ground" "TerminationGround",
    "termination_note"   TEXT,
    "compensation"       JSONB,
    "external_ids"       JSONB NOT NULL DEFAULT '{}',
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    "deleted_at"         TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employees_probation_ends_at_check"
        CHECK (status <> 'probation' OR probation_ends_at IS NOT NULL),
    CONSTRAINT "employees_terminated_fields_check"
        CHECK (
            status <> 'terminated'
            OR (termination_date IS NOT NULL AND termination_ground IS NOT NULL)
        )
);

CREATE UNIQUE INDEX "employees_user_id_key"        ON "employees"("user_id");
CREATE UNIQUE INDEX "employees_application_id_key" ON "employees"("application_id");
CREATE INDEX "employees_tenant_id_idx"        ON "employees"("tenant_id");
CREATE INDEX "employees_org_unit_id_idx"      ON "employees"("org_unit_id");
CREATE INDEX "employees_manager_user_id_idx"  ON "employees"("manager_user_id");
CREATE INDEX "employees_status_idx"           ON "employees"("status");
CREATE INDEX "employees_tenant_status_idx"    ON "employees"("tenant_id", "status");

ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_user_id_fkey"
    FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- employee_lifecycle_events (append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employee_lifecycle_events" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "employee_id"   UUID NOT NULL,
    "event_type"    "LifecycleEventType" NOT NULL,
    "from_status"   "EmployeeStatus",
    "to_status"     "EmployeeStatus",
    "effective_at"  TIMESTAMP(3) NOT NULL,
    "actor_user_id" UUID,
    "payload"       JSONB NOT NULL DEFAULT '{}',
    "comment"       TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_lifecycle_events_tenant_id_idx"
    ON "employee_lifecycle_events"("tenant_id");
CREATE INDEX "employee_lifecycle_events_employee_effective_idx"
    ON "employee_lifecycle_events"("employee_id", "effective_at");
CREATE INDEX "employee_lifecycle_events_event_type_idx"
    ON "employee_lifecycle_events"("event_type");

ALTER TABLE "employee_lifecycle_events"
    ADD CONSTRAINT "employee_lifecycle_events_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- onboarding_checklists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "onboarding_checklists" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "employee_id"  UUID NOT NULL,
    "template_key" TEXT,
    "started_at"   TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_checklists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_checklists_employee_id_key"
    ON "onboarding_checklists"("employee_id");
CREATE INDEX "onboarding_checklists_tenant_id_idx"
    ON "onboarding_checklists"("tenant_id");

ALTER TABLE "onboarding_checklists"
    ADD CONSTRAINT "onboarding_checklists_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- onboarding_tasks
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "onboarding_tasks" (
    "id"                   UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"            UUID NOT NULL,
    "checklist_id"         UUID NOT NULL,
    "title"                TEXT NOT NULL,
    "description"          TEXT,
    "task_order"           INTEGER NOT NULL,
    "status"               "OnboardingTaskStatus" NOT NULL DEFAULT 'pending',
    "assignee_user_id"     UUID,
    "due_at"               TIMESTAMP(3),
    "completed_at"         TIMESTAMP(3),
    "completed_by_user_id" UUID,
    "metadata"             JSONB,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_tasks_checklist_order_key"
    ON "onboarding_tasks"("checklist_id", "task_order");
CREATE INDEX "onboarding_tasks_tenant_id_idx"         ON "onboarding_tasks"("tenant_id");
CREATE INDEX "onboarding_tasks_checklist_id_idx"      ON "onboarding_tasks"("checklist_id");
CREATE INDEX "onboarding_tasks_assignee_user_id_idx"  ON "onboarding_tasks"("assignee_user_id");
CREATE INDEX "onboarding_tasks_status_idx"            ON "onboarding_tasks"("status");

ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_checklist_id_fkey"
    FOREIGN KEY ("checklist_id") REFERENCES "onboarding_checklists"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assignee_user_id_fkey"
    FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_completed_by_user_id_fkey"
    FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- employment_documents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "employment_documents" (
    "id"                 UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"          UUID NOT NULL,
    "employee_id"        UUID NOT NULL,
    "type"               "EmploymentDocumentType" NOT NULL,
    "status"             "EmploymentDocumentStatus" NOT NULL DEFAULT 'draft',
    "title"              TEXT NOT NULL,
    "file_url"           TEXT,
    "effective_at"       TIMESTAMP(3),
    "expires_at"         TIMESTAMP(3),
    "signed_at"          TIMESTAMP(3),
    "signed_by_user_id"  UUID,
    "external_ref"       TEXT,
    "metadata"           JSONB,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    "deleted_at"         TIMESTAMP(3),

    CONSTRAINT "employment_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employment_documents_tenant_id_idx"      ON "employment_documents"("tenant_id");
CREATE INDEX "employment_documents_employee_id_idx"    ON "employment_documents"("employee_id");
CREATE INDEX "employment_documents_employee_type_idx"  ON "employment_documents"("employee_id", "type");
CREATE INDEX "employment_documents_status_idx"         ON "employment_documents"("status");

ALTER TABLE "employment_documents" ADD CONSTRAINT "employment_documents_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employment_documents" ADD CONSTRAINT "employment_documents_signed_by_user_id_fkey"
    FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
--
-- Reads: HR roles (owner / hr_admin / recruiter / hiring_manager) + the
-- employee themselves (for their own row / onboarding / documents).
-- Writes: HR admins only (owner / hr_admin). Recruiter has no write access to
-- the lifecycle tables; the hand-off from Application → Employee is a service
-- action performed under hr_admin / owner authority.
-- Lifecycle events are insert-only (no UPDATE / DELETE policies).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY "employees_select" ON "employees" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR (app.has_role('hiring_manager') AND manager_user_id = app.current_user_id())
            OR (app.has_role('employee') AND user_id = app.current_user_id())
        )
    );
CREATE POLICY "employees_write" ON "employees" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

ALTER TABLE "employee_lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_lifecycle_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "employee_lifecycle_events_select" ON "employee_lifecycle_events" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR EXISTS (
                SELECT 1 FROM employees e
                WHERE e.id = employee_id
                  AND (
                      (app.has_role('hiring_manager') AND e.manager_user_id = app.current_user_id())
                      OR (app.has_role('employee')   AND e.user_id         = app.current_user_id())
                  )
            )
        )
    );
CREATE POLICY "employee_lifecycle_events_insert" ON "employee_lifecycle_events" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND app.is_admin()
        AND (actor_user_id IS NULL OR actor_user_id = app.current_user_id())
    );

ALTER TABLE "onboarding_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_checklists" FORCE ROW LEVEL SECURITY;
CREATE POLICY "onboarding_checklists_select" ON "onboarding_checklists" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM employees e
                WHERE e.id = employee_id
                  AND (
                      (app.has_role('hiring_manager') AND e.manager_user_id = app.current_user_id())
                      OR (app.has_role('employee')   AND e.user_id         = app.current_user_id())
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
            OR assignee_user_id = app.current_user_id()
            OR EXISTS (
                SELECT 1 FROM onboarding_checklists c
                JOIN employees e ON e.id = c.employee_id
                WHERE c.id = checklist_id
                  AND (
                      (app.has_role('hiring_manager') AND e.manager_user_id = app.current_user_id())
                      OR (app.has_role('employee')   AND e.user_id         = app.current_user_id())
                  )
            )
        )
    );
CREATE POLICY "onboarding_tasks_write_admin" ON "onboarding_tasks" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());
CREATE POLICY "onboarding_tasks_update_assignee" ON "onboarding_tasks" FOR UPDATE
    USING (tenant_id = app.current_tenant_id() AND assignee_user_id = app.current_user_id())
    WITH CHECK (tenant_id = app.current_tenant_id() AND assignee_user_id = app.current_user_id());

ALTER TABLE "employment_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employment_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "employment_documents_select" ON "employment_documents" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR EXISTS (
                SELECT 1 FROM employees e
                WHERE e.id = employee_id
                  AND (
                      (app.has_role('hiring_manager') AND e.manager_user_id = app.current_user_id())
                      OR (app.has_role('employee')   AND e.user_id         = app.current_user_id())
                  )
            )
        )
    );
CREATE POLICY "employment_documents_write" ON "employment_documents" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON
    "employees",
    "employee_lifecycle_events",
    "onboarding_checklists",
    "onboarding_tasks",
    "employment_documents"
TO app_user;
