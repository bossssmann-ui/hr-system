-- Phase 1A HH integration RLS extension.

ALTER TABLE "hh_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hh_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "hh_connections_select" ON "hh_connections" FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND app.is_admin()
  );
CREATE POLICY "hh_connections_write" ON "hh_connections" FOR ALL
  USING (
    tenant_id = app.current_tenant_id()
    AND app.is_admin()
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.is_admin()
  );

ALTER TABLE "hh_sync_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hh_sync_cursors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "hh_sync_cursors_select" ON "hh_sync_cursors" FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND (app.is_admin() OR app.has_role('recruiter'))
  );
CREATE POLICY "hh_sync_cursors_write" ON "hh_sync_cursors" FOR ALL
  USING (
    tenant_id = app.current_tenant_id()
    AND (app.is_admin() OR app.has_role('recruiter'))
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND (app.is_admin() OR app.has_role('recruiter'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "hh_connections",
  "hh_sync_cursors"
TO app_user;
