# 10 — Data Model

Canonical description of every entity in the HR-System database. The Prisma schema in `backend/prisma/schema.prisma` is the executable source of truth; this document is the **human-readable contract** that explains intent, invariants, and relationships. If they disagree, update both in the same PR.

## Conventions

- Primary keys are `String @id @default(dbgenerated("uuidv7()")) @db.Uuid`. UUIDv7 gives lexicographic sortability and matches the existing template baseline.
- Every business table has `tenant_id UUID NOT NULL` (no default). Single-tenant today; the column exists for future multi-tenancy and is referenced by every RLS policy. The value is set from the authenticated session (RLS session variable `app.tenant_id`, see `30-rls-policies.md`) and never from user input.
- Timestamps are `created_at` and `updated_at` (UTC, automatic via Prisma `@default(now())` and `@updatedAt`).
- Snake-case for column and table names (`@map`, `@@map`); camelCase in the Prisma client.
- Soft deletes use a nullable `deleted_at` where applicable; hard deletion happens on a retention schedule.
- Enums are PostgreSQL enum types declared in the schema and mirrored as Zod enums in `packages/contracts` (Phase 1+).

## Entities

### `User`

The authenticated identity. One physical person → one `User`. Provided by the vibe template.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `email` | string | Unique, login identifier. |
| `passwordHash` | string | Argon2id. Never logged. |
| `displayName` | string? | Optional human label. |
| `createdAt` / `updatedAt` | timestamp | |

Auth sessions live in `AuthSession`; that is template behavior and unchanged.

### `Role`

User → many Roles. Pivot table `UserRole(user_id, role)`.

Enum values: `owner`, `hr_admin`, `recruiter`, `hiring_manager`, `employee`, `candidate`.

Invariants:
- A user may hold multiple roles simultaneously (e.g. `recruiter` + `hiring_manager`).
- `owner` is reserved for the bootstrap user and HR-system administrators; it implies all other permissions inside their tenant.
- `candidate` is a placeholder for the candidate self-serve portal in a later phase.

### `OrgUnit`

Self-referential tree representing departments / divisions / teams.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `name` | string | |
| `parent_id` | UUID? | Nullable for top-level units; FK to `OrgUnit`. |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- A unit cannot be its own ancestor (enforced at the service layer with a recursive CTE check).

### `HiringRequisition`

The request to hire. Drives the funnel: a requisition must be approved before its `Vacancy` may be published.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `org_unit_id` | UUID | FK → `OrgUnit`. |
| `created_by_user_id` | UUID | FK → `User`. |
| `title` | string | Working title for the role. |
| `grade` | string | Internal grade label. |
| `salary_min` / `salary_max` | int | Whole currency units (no fractional). |
| `currency` | enum | `RUB`, `USD`, `THB`, `USDT`. |
| `justification` | string | Free text; required on `submitted`. |
| `status` | enum | See `20-fsm.md`. |
| `deadline_at` | timestamp? | Optional target close date. |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- `salary_min <= salary_max`.
- Status transitions are gated by `canTransition` in `backend/src/features/requisitions/requisitions.fsm.ts`.
- A `Vacancy` may only exist when `status ∈ { approved, in_recruitment, closed }`.

### `Vacancy`

The externally-visible posting for an approved requisition.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `requisition_id` | UUID | FK → `HiringRequisition`. `@unique` (1:1). |
| `org_unit_id` | UUID | Denormalised from the requisition for query simplicity. |
| `title` | string | May differ from the requisition title (job-board friendly wording). |
| `description` | text | Job-board friendly description. |
| `is_published` | bool | |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- `requisition_id` is unique (one vacancy per requisition).
- A vacancy may only be `is_published = true` when its requisition is in `approved` or `in_recruitment`.

### `Candidate`

A person who applied or was sourced. Independent of any single vacancy.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `full_name` | string | |
| `email` | string? | Unique when non-null (partial index). |
| `phone` | string? | Unique when non-null (partial index). |
| `location` | string? | Free text city/country. |
| `source` | enum | `manual`, `hh_ru`, `sberpodbor`, `avito`, `rabota_ru`, `referral`, `careers_page`. |
| `external_ids` | jsonb | e.g. `{"hh_id": "..."}`. Populated by Phase 1+ integrations. |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- Email and phone are unique when present (`CREATE UNIQUE INDEX ... WHERE email IS NOT NULL`).
- `external_ids` keys correspond to integration identifiers; values are opaque strings.

### `Resume`

Uploaded resume file. Phase 0 stores files in the local Docker volume; DigitalOcean Spaces wiring arrives in Phase 1.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `candidate_id` | UUID | FK → `Candidate`; one candidate → many resumes. |
| `file_url` | string | Private URL; presigned at read time. |
| `parsed_payload` | jsonb? | Populated by Phase 1 parsing. |
| `uploaded_at` | timestamp | |
| `deleted_at` | timestamp? | Soft-delete marker. Hard-deletion at 365 days enforced in Phase 11. |

Allowed file types: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Max size 10 MB. Validation happens at the upload endpoint.

### `Application`

A candidate's pursuit of a specific vacancy. The Kanban funnel operates on this table.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `candidate_id` | UUID | FK → `Candidate`. |
| `vacancy_id` | UUID | FK → `Vacancy`. |
| `stage` | enum | See `20-fsm.md`. |
| `assigned_to_user_id` | UUID? | Recruiter handling the application. |
| `notes` | text? | Free-text recruiter notes. |
| `ai_scoring` | jsonb? | Populated by Phase 1+. |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- `UNIQUE (candidate_id, vacancy_id)` — a candidate may not be double-counted in the same funnel.
- Stage changes go through `canTransition` in `backend/src/features/applications/applications.fsm.ts` and write an `ApplicationStageEvent`.

### `ApplicationStageEvent`

Append-only audit trail of the Kanban funnel. Distinct from `AuditEvent` because it is a first-class domain concept (recruiters look at this view directly).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `application_id` | UUID | FK → `Application`. |
| `from_stage` | enum | |
| `to_stage` | enum | |
| `actor_user_id` | UUID | FK → `User`. |
| `comment` | text? | |
| `created_at` | timestamp | |

Invariants:
- Insert-only (no update / delete). Enforced by RLS (no `UPDATE` or `DELETE` policy) and trigger.
- `actor_user_id = current_user_id` is enforced both by RLS policy and by the service layer.

### `AuditEvent`

System-wide audit log. Distinct from `ApplicationStageEvent` — this is the cross-cutting record of every mutating action.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `actor_user_id` | UUID? | Nullable for system actions (cron, backfills). |
| `action` | string | Dotted name, e.g. `requisition.submit`, `application.move_stage`. |
| `entity_type` | string | e.g. `HiringRequisition`. |
| `entity_id` | UUID | |
| `diff` | jsonb | Compact JSON Patch (`[{"op":"replace","path":"/stage","value":"screen"}]`). Secrets stripped. |
| `ip` | string? | Best-effort source IP. |
| `user_agent` | string? | Best-effort UA. |
| `created_at` | timestamp | |

Indexes:
- `(entity_type, entity_id)` for entity timeline queries.
- `(actor_user_id, created_at)` for per-actor history.

Retention: keep indefinitely in Phase 0; partitioning + retention policy is a Phase 11 concern.

### `Notification`

Inbox-style record written by `Notifier.notify('in_app', …)`. The `email` and `telegram` channels do not write a row in Phase 0; they log "not implemented".

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `recipient_user_id` | UUID | FK → `User`. |
| `template` | string | Template identifier. |
| `payload` | jsonb | Template variables. |
| `read_at` | timestamp? | Null until the recipient marks it read. |
| `created_at` | timestamp | |

## Bootstrap tenant + owner

A single tenant UUID is generated by the first migration / seed step. The bootstrap owner `User` is provisioned from `.env` (`BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`) and granted the `owner` role inside that tenant. No real credentials live in the repo; `.env.example` carries placeholder values only.
