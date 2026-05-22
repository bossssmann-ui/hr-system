# 40 — Audit

Two distinct audit surfaces exist in Phase 0:

1. **`ApplicationStageEvent`** — first-class domain log for the Kanban funnel. Recruiters look at it directly.
2. **`AuditEvent`** — cross-cutting, system-wide log of every mutating action. Written by the audit middleware.

This document defines what gets logged where, how, and for how long.

## What gets logged in `AuditEvent`

Every mutating route — `POST`, `PATCH`, `DELETE` — must produce exactly one `AuditEvent` row on success. The audit middleware in `backend/src/http/audit.ts` wraps these routes and, after the business transaction commits, asynchronously inserts the row.

Required fields per write:

| Field | Source |
| --- | --- |
| `actor_user_id` | `app.user_id` (nullable for cron / queue actions). |
| `action` | Dotted action name, e.g. `requisition.submit`. The route declares this string explicitly; no auto-inference from the URL. |
| `entity_type` | The Prisma model name (`HiringRequisition`, `Application`, …). |
| `entity_id` | UUID of the affected row. |
| `diff` | JSON Patch (`[{"op":"replace","path":"/stage","value":"screen"}]`) describing the change. For `INSERT`, the diff is `[{"op":"add","path":"","value":<row>}]` with sensitive fields stripped. |
| `ip`, `user_agent` | Best-effort from the request. |
| `tenant_id` | From session. |

### Action vocabulary (Phase 0)

| Domain | Actions |
| --- | --- |
| Requisition | `requisition.create`, `requisition.update`, `requisition.submit`, `requisition.manager_approve`, `requisition.hr_approve`, `requisition.approve`, `requisition.start_recruitment`, `requisition.close`, `requisition.reject`, `requisition.delete` |
| Vacancy | `vacancy.create`, `vacancy.update`, `vacancy.publish`, `vacancy.unpublish` |
| Candidate | `candidate.create`, `candidate.update`, `candidate.delete` |
| Resume | `resume.upload`, `resume.soft_delete` |
| Application | `application.create`, `application.update`, `application.move_stage`, `application.assign`, `application.delete` |
| Application AI scoring | `application.ai_scored`, `application.rescore_requested`, `application.score_feedback` |
| Integrations (HH.ru) | `hh.sync.candidate_imported` |
| Auth | `auth.login`, `auth.logout`, `auth.refresh`, `auth.password_changed` |
| Admin | `user.role_added`, `user.role_removed` |

New actions require a one-line entry in this table and a `TODO(phase-N)` comment if not implemented yet.

## What never goes into `diff`

The audit middleware **must strip** these fields before serialising the diff:

- `passwordHash`, `password`, `password_confirm`
- `refreshTokenHash`, any value starting with `eyJ` (likely JWT)
- Any field name matching `/secret|token|api_?key|private_?key|otp|2fa/i`
- `file_url` raw value is stored, but the diff only stores the canonical path, not any presigned query string.

The strip happens in `backend/src/http/audit.ts::redact()` and is unit-tested.

## Audit middleware semantics

```ts
// Pseudocode
app.use(async (c, next) => {
  await next()
  if (!c.req.method.startsWith('POST') && c.req.method !== 'PATCH' && c.req.method !== 'DELETE') return
  if (c.res.status >= 400) return // only successful mutations are audited
  const entry = c.get('auditEntry') // route populated this via c.set('auditEntry', { ... })
  if (!entry) return
  queueMicrotask(() => writeAudit(entry).catch((err) => logger.error({ err }, 'audit.write_failed')))
})
```

Key properties:

- **Audit failure does not roll back the business transaction.** A logged-and-swallowed error is acceptable in Phase 0; observability / alerting hooks land later.
- **Routes declare `auditEntry` explicitly.** The middleware does not introspect the request body — that keeps the action vocabulary explicit and PR-reviewable.
- **`AuditEvent` writes use the same Prisma client.** They participate in tenant RLS scoping naturally.

## Query patterns

Reviewers and admins use the audit log via the admin pages and the API:

| Pattern | Index used |
| --- | --- |
| "All events for this requisition" | `(entity_type, entity_id)` |
| "All actions by this user this week" | `(actor_user_id, created_at)` |
| "All recent `application.move_stage` events" | `(action, created_at)` (added in a later migration if needed) |

In Phase 0 the admin page exposes pagination + filters on `actor_user_id`, `entity_type`, `entity_id`, and a created-at range.

## Retention

| Surface | Retention |
| --- | --- |
| `AuditEvent` | Indefinite in Phase 0. Partitioning by `created_at` and 7-year retention land in Phase 11 (compliance). |
| `ApplicationStageEvent` | Indefinite (small volume per application). |
| `Resume` | Soft-delete in Phase 0; hard-delete at 365 days enforced in Phase 11 for 152-ФЗ / GDPR compliance. |
| `Notification` | Soft-delete after `read_at + 90 days` (Phase 1+). |

## 152-ФЗ note for HH imports

For `hh.sync.candidate_imported`, the candidate record keeps consent context indicating the applicant-initiated HH negotiation source, import timestamp, and negotiation id. This is the legal basis for storing HH-imported candidate data in Phase 1A.

## 152-ФЗ note for AI scoring (Phase 1C)

AI scoring requests must exclude direct candidate contact PII (`full_name`, `email`, `phone`) before sending payloads to third-party LLM providers. The scoring input is restricted to job-relevant resume evidence (experience, education, skills, location, total experience) plus vacancy/requisition profile data.

## Logging vs audit

- **Audit** = persisted in the database, queryable, retained by retention policy, never contains secrets.
- **Application logs** = stderr / log aggregator. Used for diagnostics. Never the source of truth.

These two surfaces must not be confused. Never use `console.log(applicationDiff)` as an audit substitute.
