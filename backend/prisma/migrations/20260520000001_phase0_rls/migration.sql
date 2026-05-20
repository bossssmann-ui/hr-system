-- Phase 0 Row-Level Security.
--
-- Hand-written migration enabling RLS on every business table and creating
-- the policies described in `docs/contracts/30-rls-policies.md`. The
-- application sets three session-local variables at the start of each request:
--
--   SET LOCAL app.user_id    = '<uuid>';
--   SET LOCAL app.user_roles = 'recruiter,owner';  -- comma-separated
--   SET LOCAL app.tenant_id  = '<uuid>';
--
-- System jobs use `app.user_id = ''` (NULL) and the policies treat the
-- absence of a role as zero-access.
--
-- The application runtime role does NOT have BYPASSRLS. Migrations run as a
-- superuser / migrator role that does, which is why this migration can
-- create policies despite RLS being enabled.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper schema + functions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_roles() RETURNS text[]
    LANGUAGE sql STABLE AS
$$ SELECT string_to_array(coalesce(NULLIF(current_setting('app.user_roles', true), ''), ''), ',') $$;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.has_role(name text) RETURNS boolean
    LANGUAGE sql STABLE AS
$$ SELECT name = ANY(app.current_roles()) $$;

CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
    LANGUAGE sql STABLE AS
$$ SELECT app.has_role('owner') OR app.has_role('hr_admin') $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant scope: every business table is partitioned by tenant_id. The same
-- policy is applied to every table — query and mutation alike — so any code
-- path that omits the session variable returns zero rows by construction.
-- ─────────────────────────────────────────────────────────────────────────────

-- user_roles
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_tenant_admin" ON "user_roles"
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

-- org_units
ALTER TABLE "org_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_units" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_units_tenant_read" ON "org_units" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "org_units_tenant_write" ON "org_units" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

-- hiring_requisitions
ALTER TABLE "hiring_requisitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hiring_requisitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "hiring_requisitions_select" ON "hiring_requisitions" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR (app.has_role('hiring_manager') AND created_by_user_id = app.current_user_id())
        )
    );
CREATE POLICY "hiring_requisitions_insert" ON "hiring_requisitions" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR app.has_role('recruiter')
            OR (app.has_role('hiring_manager') AND created_by_user_id = app.current_user_id())
        )
    );
CREATE POLICY "hiring_requisitions_update" ON "hiring_requisitions" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR (app.has_role('hiring_manager') AND created_by_user_id = app.current_user_id())
        )
    )
    WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY "hiring_requisitions_delete" ON "hiring_requisitions" FOR DELETE
    USING (tenant_id = app.current_tenant_id() AND app.is_admin());

-- vacancies — read for recruiter/hiring_manager, write for admin.
ALTER TABLE "vacancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vacancies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "vacancies_select" ON "vacancies" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "vacancies_write" ON "vacancies" FOR ALL
    USING (tenant_id = app.current_tenant_id() AND app.is_admin())
    WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_admin());

-- candidates — recruiter has full read/write; admin full; hiring_manager read.
ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "candidates_select" ON "candidates" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "candidates_write" ON "candidates" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- resumes
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resumes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "resumes_select" ON "resumes" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "resumes_write" ON "resumes" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- applications
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "applications_select" ON "applications" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "applications_write" ON "applications" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

-- application_stage_events — append-only. SELECT for any recruiter/manager;
-- INSERT requires actor_user_id = current_user_id; no UPDATE / DELETE policy,
-- so those operations are denied by RLS.
ALTER TABLE "application_stage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_stage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "application_stage_events_select" ON "application_stage_events" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "application_stage_events_insert" ON "application_stage_events" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
        AND actor_user_id = app.current_user_id()
    );

-- audit_events — append-only. Admin can read all; non-admin sees only own.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_select" ON "audit_events" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (
            app.is_admin()
            OR actor_user_id = app.current_user_id()
        )
    );
CREATE POLICY "audit_events_insert" ON "audit_events" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id());

-- notifications — recipient sees own row only; insert allowed inside tenant.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notifications_select" ON "notifications" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND recipient_user_id = app.current_user_id()
    );
CREATE POLICY "notifications_update_own" ON "notifications" FOR UPDATE
    USING (
        tenant_id = app.current_tenant_id()
        AND recipient_user_id = app.current_user_id()
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND recipient_user_id = app.current_user_id()
    );
CREATE POLICY "notifications_insert" ON "notifications" FOR INSERT
    WITH CHECK (tenant_id = app.current_tenant_id());

-- tenants — admin-only read for the current tenant; never expose other tenants.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenants_self" ON "tenants" FOR SELECT
    USING (id = app.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Runtime role
-- ─────────────────────────────────────────────────────────────────────────────
-- The application runtime connects with this role (or one that inherits it).
-- It has CRUD on every business table but NO `BYPASSRLS` attribute, so the
-- policies above are the actual access boundary. Migrations and the
-- integration tests run as a superuser/migrator that bypasses RLS by
-- definition. Tests assert the boundary by switching to this role via
-- `SET LOCAL ROLE app_user`.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA app, public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "tenants",
    "user_roles",
    "org_units",
    "hiring_requisitions",
    "vacancies",
    "candidates",
    "resumes",
    "applications",
    "application_stage_events",
    "audit_events",
    "notifications"
TO app_user;
