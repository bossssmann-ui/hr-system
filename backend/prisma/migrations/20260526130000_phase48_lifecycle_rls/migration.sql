-- Phase 4.8: Lifecycle RLS hardening + employee self-service read.
-- Spec: docs/employee-lifecycle-design.md §7.
--
-- Adjusts the policies introduced by 20260525000000_phase4a_employee_lifecycle
-- to match the §7 contract:
--   * §7.2 employee_lifecycle_events:
--       - SELECT: owner / hr_admin / hiring_manager, plus role `employee`
--         restricted to events on their own Employee row.
--       - INSERT: any tenant member whose actor_user_id matches the current
--         session user (or NULL when the `system` role is active, reserved
--         for cron / queue workers). The originating-transition gate stays
--         in the service layer.
--       - No UPDATE / DELETE policies → table is append-only.
--   * §7.3 onboarding_tasks: role `employee` sees only tasks assigned to
--     them (assignee_user_id = current_user_id), not the whole checklist.

-- ─────────────────────────────────────────────────────────────────────────────
-- employee_lifecycle_events (append-only, per §7.2)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "employee_lifecycle_events_select" ON "employee_lifecycle_events";
DROP POLICY IF EXISTS "employee_lifecycle_events_insert" ON "employee_lifecycle_events";
DROP POLICY IF EXISTS "employee_lifecycle_events_update" ON "employee_lifecycle_events";
DROP POLICY IF EXISTS "employee_lifecycle_events_delete" ON "employee_lifecycle_events";

CREATE POLICY "employee_lifecycle_events_select" ON "employee_lifecycle_events" FOR SELECT
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

CREATE POLICY "employee_lifecycle_events_insert" ON "employee_lifecycle_events" FOR INSERT
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (
            actor_user_id = app.current_user_id()
            OR (actor_user_id IS NULL AND app.has_role('system'))
        )
    );

-- No UPDATE / DELETE policies → with FORCE ROW LEVEL SECURITY the table is
-- append-only via RLS. We also REVOKE the UPDATE / DELETE grants so that any
-- attempt raises `permission denied` instead of silently affecting 0 rows
-- (per §7.5 test obligation).

REVOKE UPDATE, DELETE ON "employee_lifecycle_events" FROM app_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- onboarding_tasks (employee self-service: only own assigned tasks, per §7.3)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "onboarding_tasks_select" ON "onboarding_tasks";

CREATE POLICY "onboarding_tasks_select" ON "onboarding_tasks" FOR SELECT
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
