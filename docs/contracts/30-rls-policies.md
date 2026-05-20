# 30 — Row-Level Security Policies

PostgreSQL Row-Level Security is the **last line of defence** for tenant isolation and role authorisation. Application code calls `canTransition` and per-route guards first, but if every check fails, RLS must still refuse the query. RLS is mandatory on every business table.

## Session variables

Every backend request opens a transaction and sets two session-local variables before executing any user-facing query:

```sql
SET LOCAL app.user_id   = '<uuid>';
SET LOCAL app.user_roles = '<owner,recruiter,...>'; -- comma-separated role names
SET LOCAL app.tenant_id = '<uuid>';
```

The Prisma client wraps every request in a transaction using `$transaction([...])` with a prelude that issues `SET LOCAL` statements. System jobs (cron, queue workers) use a dedicated `system` role and set `app.user_id = NULL`.

Helper SQL functions live in the bootstrap migration:

```sql
CREATE FUNCTION app.current_user_id()  RETURNS uuid     LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_roles()    RETURNS text[]   LANGUAGE sql STABLE AS
  $$ SELECT string_to_array(coalesce(current_setting('app.user_roles', true), ''), ',') $$;

CREATE FUNCTION app.current_tenant_id() RETURNS uuid    LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.has_role(name text) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT name = ANY(app.current_roles()) $$;
```

## Tenant scoping (universal)

Every business table has a tenant scoping policy:

```sql
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id())
```

A query that omits `tenant_id` is impossible to satisfy without leaking; the database itself rejects it. This is the property that the integration test asserts.

## Per-table policy matrix

| Table | `owner` / `hr_admin` | `recruiter` | `hiring_manager` | `employee` / `candidate` |
| --- | --- | --- | --- | --- |
| `HiringRequisition` | full | read | read+write own / own org_unit | none |
| `Vacancy` | full | read | read | none |
| `Candidate` | full | read+write | read of candidates linked to own requisitions | none |
| `Resume` | full | read+write for candidates they touch | read of resumes linked to own requisitions | none |
| `Application` | full | read+write | read for own requisitions | none |
| `ApplicationStageEvent` | full read, insert with `actor=current_user_id` | same | read for own requisitions | none |
| `AuditEvent` | full read | read of own actions | read of own actions | none |
| `Notification` | full read of own row | full read of own row | full read of own row | full read of own row |
| `OrgUnit` | full | read | read | none |
| `UserRole` | full | none | none | none |

"Full" always means "within the current tenant".

## Policy templates

### Default tenant scope

```sql
ALTER TABLE hiring_requisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hiring_requisitions_tenant
  ON hiring_requisitions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
```

### Recruiter read on `HiringRequisition`

```sql
CREATE POLICY hiring_requisitions_recruiter_read
  ON hiring_requisitions FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND (app.has_role('owner') OR app.has_role('hr_admin') OR app.has_role('recruiter'))
  );
```

### Hiring manager write on their own requisitions

```sql
CREATE POLICY hiring_requisitions_manager_write
  ON hiring_requisitions FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      app.has_role('owner')
      OR app.has_role('hr_admin')
      OR (app.has_role('hiring_manager') AND created_by_user_id = app.current_user_id())
    )
  );
```

### Append-only `ApplicationStageEvent`

```sql
ALTER TABLE application_stage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_stage_events_select
  ON application_stage_events FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY application_stage_events_insert
  ON application_stage_events FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND actor_user_id = app.current_user_id()
  );

-- no UPDATE or DELETE policy ⇒ those operations are forbidden by RLS.
```

## Forbidden roles

`employee` and `candidate` have **no policies** on any recruiting table in Phase 0. They cannot read or write requisitions, vacancies, candidates, resumes, applications, or stage events. Their access path will be added in a later phase (candidate self-serve portal, employee self-service).

## Integration tests

Phase 0 ships **one** RLS integration test:
`backend/src/features/requisitions/requisitions.rls.integration.test.ts` asserts cross-tenant denial on `hiring_requisitions` by switching to the non-superuser `app_user` role, setting the three session variables, and confirming a tenant-B session cannot see tenant-A rows (while the matching tenant-A session can). It is wired into `backend/scripts/test-integration.mjs` so `bun run test:backend:integration` exercises it on every CI run.

The full matrix described below is **aspirational** for Phase 0 and lands alongside the per-domain routes that read/write the tables — each route ships its RLS scenarios in the same PR:

1. Two-tenant setup (`A`/`B`) with requisitions, candidates, applications populated in both.
2. As a `recruiter` from tenant `A`: every business table returns only tenant `A` rows.
3. `INSERT` into `application_stage_events` with `actor_user_id ≠ current_user_id` is rejected.
4. `UPDATE` on a tenant-`B` row affects 0 rows.
5. Cross-tenant `JOIN` returns no rows from tenant `B`.
6. As `employee`/`candidate`: every recruiting table returns 0 rows / refuses writes.

Tests must connect to PostgreSQL **without `BYPASSRLS`** and as a non-superuser role, otherwise the policies are silently skipped. The RLS migration creates an `app_user` role for this purpose; integration tests switch into it with `SET LOCAL ROLE app_user`.

## Operational notes

- The Prisma migration adapter must run as a role with `BYPASSRLS` (because migrations create / alter tables). Application code uses a separate runtime role without `BYPASSRLS`.
- `app.user_id` must be cleared at the end of every request (the transaction boundary handles this automatically because `SET LOCAL` is transaction-scoped).
- When in doubt about an RLS rule, deny by default and add a new policy in a migration.
