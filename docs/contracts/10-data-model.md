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
| `hh_vacancy_id` | string? | HH.ru vacancy identifier for negotiations sync. Nullable until linked by admin, unique when present. |
| `slug` | string? | URL-safe slug for the public careers page (e.g. `frontend-engineer`). Auto-generated from `title` on first publish. Unique per tenant (partial unique index on `(tenant_id, slug) WHERE slug IS NOT NULL`). Nullable until published. |
| `title` | string | May differ from the requisition title (job-board friendly wording). |
| `description` | text | Job-board friendly description. |
| `is_published` | bool | |
| `created_at` / `updated_at` | timestamp | |

Invariants:
- `requisition_id` is unique (one vacancy per requisition).
- A vacancy may only be `is_published = true` when its requisition is in `approved` or `in_recruitment`.
- `slug` is set automatically on first publish (see `backend/src/features/vacancies/slug.ts`); re-publishing does not change an existing slug.
- The public careers API (`GET /api/public/vacancies`) only returns vacancies where `is_published = true` AND `slug IS NOT NULL`.

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
| `source` | enum | `manual`, `hh_ru`, `sberpodbor`, `avito`, `rabota_ru`, `referral`, `careers_page`. Phase 1G: `careers_page` is set when the candidate applies via the public careers form. |
| `external_ids` | jsonb | e.g. `{"hh_id": "..."}`. Populated by Phase 1+ integrations. |
| `consent_context` | jsonb? | Consent/legal basis context. Structure: `{basis, consent_text_version, consented_at, ip?}`. For `careers_page` applicants: `basis = "public_careers_form"`, `consent_text_version = "1.0"`, `consented_at = <ISO 8601>`. For HH imports: applicant-initiated negotiation. |
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
| `ai_scoring` | jsonb? | Phase 1C advisory score payload: `{status, input_hash, result?, failure?}`. |
| `ai_score_feedback` | jsonb? | Phase 1C recruiter feedback payload: `{user_id, agrees, note, created_at}`. |
| `external_ids` | jsonb | Integration ids, e.g. `{"hh_negotiation_id":"..."}`. |
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

### `HhConnection`

Per-tenant HH OAuth credential storage for negotiations sync.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | Unique per tenant. |
| `access_token` | string | Encrypted at rest (application-level encryption helper). |
| `refresh_token` | string | Encrypted at rest (application-level encryption helper). |
| `token_expires_at` | timestamp | HH access token expiry. |
| `connected_employer_id` | string? | Employer id from HH `/me` response. |
| `created_at` / `updated_at` | timestamp | |

### `HhSyncCursor`

Incremental polling cursor per linked vacancy.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | |
| `vacancy_id` | UUID | FK → `Vacancy`, unique (one cursor per vacancy). |
| `last_synced_at` | timestamp? | Last processed negotiation timestamp. |
| `last_negotiation_id` | string? | Tie-breaker for equal timestamps. |
| `created_at` / `updated_at` | timestamp | |

## Bootstrap tenant + owner

A single tenant UUID is generated by the first migration / seed step. The bootstrap owner `User` is provisioned from `.env` (`BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`) and granted the `owner` role inside that tenant. No real credentials live in the repo; `.env.example` carries placeholder values only.

---

## Phase 1F additions — Interview / Transcript / Protocol / Offer Draft

### `Interview`

Represents one interview session for an `Application`. Holds the recording reference, ASR transcript, LLM-generated protocol, and offer draft — all as JSONB columns for schema-flexible iteration; a standalone table for RLS granularity.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | RLS key. |
| `application_id` | UUID | FK → `Application`; one application → many interviews. |
| `scheduled_at` | timestamp? | Optional interview time. |
| `recording_url` | string? | Stub path (e.g. `local://recordings/...`). Real DigitalOcean Spaces wiring is Phase 3. |
| `consent_recorded` | bool | **152-ФЗ gate.** Transcription MUST NOT start until this is `true`. Set via `PATCH /api/interviews/:id/consent`. |
| `status` | enum | `created → transcribing → transcribed → protocol_ready → failed`. See FSM below. |
| `transcript` | jsonb? | `{ segments: [{speaker, start_ms, end_ms, text}], language, asr_provider, asr_model, created_at }`. Set by the ASR pipeline. |
| `protocol` | jsonb? | Structured interview protocol. Set by the LLM pipeline. See schema below. |
| `offer_draft` | jsonb? | Pre-filled offer from agreed terms. Set by the deterministic mapping. See schema below. |
| `created_by_user_id` | UUID | FK → `User`. |
| `created_at` / `updated_at` | timestamp | |

**Status FSM:**
- `created` — initial state after `POST /api/interviews`.
- `transcribing` — ASR job in progress; set immediately before calling the ASR provider.
- `transcribed` — transcript stored; ASR job succeeded.
- `protocol_ready` — protocol + offer draft stored; full pipeline succeeded.
- `failed` — any pipeline stage failed; the error reason is logged in `AuditEvent`.

**RLS:** recruiter / hr_admin / owner can read/write within their tenant. `hiring_manager` can read only.

### Transcript JSONB schema

```json
{
  "segments": [
    { "speaker": "interviewer", "start_ms": 0, "end_ms": 5000, "text": "…" }
  ],
  "language": "ru-RU",
  "asr_provider": "yandex_speechkit",
  "asr_model": "general",
  "created_at": "2026-05-22T10:00:00.000Z"
}
```

### InterviewProtocol JSONB schema

```json
{
  "summary": "…",
  "questions_and_answers": [
    { "question": "…", "answer": "…", "segment_indices": [0, 1] }
  ],
  "agreed_terms": {
    "salary": 250000,
    "currency": "RUB",
    "start_date": "2026-06-01",
    "special_conditions": ["Remote 2 days/week"],
    "salary_source": { "segment_index": 4, "quote": "Зарплата 250 000 рублей" },
    "start_date_source": { "segment_index": 4, "quote": "выход 1 июня 2026" },
    "special_conditions_sources": [{ "segment_index": 5, "quote": "…" }]
  },
  "strengths": ["…"],
  "concerns": ["…"],
  "model": "claude-haiku-4-5-20251001",
  "generated_at": "2026-05-22T10:05:00.000Z",
  "schema_version": 1
}
```

Each `agreed_term` carries a `source: { segment_index, quote }` — the quote-link affordance that lets recruiters trace a salary figure back to the exact sentence in the transcript.

### OfferDraft JSONB schema

```json
{
  "salary": 250000,
  "currency": "RUB",
  "start_date": "2026-06-01",
  "conditions": ["Remote 2 days/week"],
  "grade": null,
  "status": "draft"
}
```

**Deterministic mapping** from `protocol.agreed_terms` — no LLM involved. This makes the draft fully auditable. The full `Offer` entity + approval chain + DocuSeal e-signing are Phase 3.

### ASR Provider configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `TRANSCRIPTION_ENABLED` | `false` | Feature flag. With flag off → upload works, transcription shows "not configured". |
| `ASR_PROVIDER` | `yandex_speechkit` | Reference implementation. WhisperProvider seam is in `backend/src/integrations/asr/` for future self-hosted option. |
| `ASR_API_KEY` | — | Yandex Cloud API key. Required when `TRANSCRIPTION_ENABLED=true`. |
| `ASR_FOLDER_ID` | — | Yandex Cloud folder id. |
| `ASR_LANGUAGE` | `ru-RU` | Default recognition language. |
| `INTERVIEW_RECORDING_MAX_BYTES` | `524288000` (500 MB) | Max upload size. |

**Privacy note (152-ФЗ):** Recording + transcript contain PII. They are stored in our PostgreSQL database under the candidate's consent (`consent_recorded = true`). When building the protocol, the transcript is sent to the configured LLM provider. If using a non-RF LLM (e.g. Anthropic), this is a data-residency consideration for the owner. See `40-audit.md` for consent basis documentation.

---

## Phase 1D additions — Proctored assessments + AI interview questions

### `Application` (extended)

| Field | Type | Notes |
| --- | --- | --- |
| `ai_interview_questions` | jsonb? | Advisory AI-generated questions list: `[{question, rationale, competency}]`. Recruiter-curated, never auto-rejects. |
| `trust_flagged` | bool | Advisory risk flag set when assessment `trust_score` is below configured threshold. Does **not** auto-reject. |

### `AssessmentTemplate`

Reusable assessment definition, optionally tied to a vacancy.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | RLS tenant key |
| `vacancy_id` | UUID? | Optional FK → `Vacancy` |
| `title` / `description` | text | Recruiter-facing template metadata |
| `time_limit_min` | int? | Optional timer limit |
| `created_by` | UUID | FK → `User` |
| `created_at` / `updated_at` | timestamp | |

### `AssessmentQuestion`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `template_id` | UUID | FK → `AssessmentTemplate` |
| `question_order` | int | Stable render/grading order |
| `type` | enum | `open`, `single_choice`, `multi_choice` |
| `prompt` | text | Candidate-visible question |
| `options` | jsonb? | Choice options for choice-based questions |
| `rubric` | text? | Optional rubric for AI open-answer grading |
| `competency` | text? | Optional competency tag |
| `weight` | float | Weighted contribution |

### `AssessmentSession`

One candidate test attempt linked to an application and a tokenized public link.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `tenant_id` | UUID | RLS tenant key |
| `template_id` | UUID | FK → `AssessmentTemplate` |
| `application_id` | UUID | FK → `Application` |
| `invite_token` | text (unique) | Candidate link token (`/assessment/:token`) |
| `status` | enum | `invited`, `consented`, `in_progress`, `submitted`, `graded`, `expired` |
| `consent_recorded` | bool | Mandatory proctoring consent gate |
| `started_at` / `submitted_at` | timestamp? | Session timeline |
| `trust_score` | int? | 0–100 (server-computed only) |
| `trust_signals` | jsonb? | Raw behavioral proctoring signals + consent payload |
| `created_at` | timestamp | |

### `AssessmentAnswer`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | PK |
| `session_id` | UUID | FK → `AssessmentSession` |
| `question_id` | UUID | FK → `AssessmentQuestion` |
| `answer` | jsonb | Candidate answer payload |
| `ai_grade` | jsonb? | Optional AI grade for open answers: `{score, rationale}` |
| `created_at` | timestamp | |

RLS: `assessment_templates` and `assessment_sessions` are tenant-scoped. `assessment_questions` and `assessment_answers` inherit tenant isolation through parent-row joins in policy predicates.

---

## Phase 1E — Candidate Messenger

### Conversation

One conversation thread per candidate (by default). Spans multiple channels.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | uuidv7 |
| `tenant_id` | `uuid` | FK → tenants |
| `candidate_id` | `uuid` | FK → candidates (CASCADE) |
| `application_id` | `uuid?` | FK → applications (SET NULL) |
| `subject` | `text?` | Optional thread subject |
| `last_message_at` | `timestamptz?` | Updated on each new message |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

RLS: tenant-scoped, `recruiter` / `hr_admin` / `owner` read+write.

### Message

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | uuidv7 |
| `tenant_id` | `uuid` | FK → tenants |
| `conversation_id` | `uuid` | FK → conversations (CASCADE) |
| `channel` | `enum` | `in_app` \| `email` \| `telegram` \| `hh_chat` |
| `direction` | `enum` | `inbound` \| `outbound` |
| `body` | `text` | Message content |
| `sender_user_id` | `uuid?` | Set for outbound recruiter messages |
| `external_id` | `text?` | Channel-side ID for dedup |
| `status` | `enum` | `draft` \| `queued` \| `sent` \| `delivered` \| `failed` \| `received` |
| `sent_at` | `timestamptz?` | When successfully sent/received |
| `created_at` | `timestamptz` | |

Dedup: partial unique index on `(channel, external_id)` WHERE `external_id IS NOT NULL`.

### MessageTemplate

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | uuidv7 |
| `tenant_id` | `uuid` | FK → tenants |
| `name` | `text` | Template name shown in picker |
| `channel` | `enum?` | Optional channel filter |
| `subject` | `text?` | For email |
| `body` | `text` | Template with `{{variable}}` placeholders |
| `created_by_user_id` | `uuid` | |
| `created_at` / `updated_at` | `timestamptz` | |

### Channel adapters

| Channel | Feature flag | Env vars | Inbound |
| --- | --- | --- | --- |
| `in_app` | Always on | — | DB-only |
| `hh_chat` | `HH_INTEGRATION_ENABLED` | `HH_CLIENT_ID/SECRET/TOKEN` | Via HH sync |
| `telegram` | `TELEGRAM_ENABLED=true` | `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN` | Webhook `POST /api/integrations/telegram/webhook` |
| `email` | `EMAIL_ENABLED` | `SMTP_HOST/PORT/USER/PASS/FROM` | Out of scope (Phase 1E+) |

### Candidate ↔ channel mapping (externalIds)

The `Candidate.externalIds` JSONB column stores channel-specific IDs:
- `telegram_chat_id`: Telegram chat ID
- `hh_messages_url`: HH negotiation messages URL

## Phase 3 — Offer + Compensation

### Offer

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | uuidv7 |
| `tenant_id` | `uuid` | FK → tenants |
| `application_id` | `uuid` | FK → applications, ON DELETE CASCADE |
| `interview_id` | `uuid?` | Optional FK → interviews, ON DELETE SET NULL |
| `salary` | `int` | CHECK > 0 |
| `currency` | `enum` | `RUB | USD | THB | USDT` |
| `start_date` | `date` | Proposed first day |
| `grade` | `text?` | Snapshot of grade if known |
| `conditions` | `text[]` | Free-form bullets |
| `status` | `OfferStatus` | FSM in `20-fsm.md` |
| `docuseal_submission_id` | `text?` | Set on `approved → sent` when DocuSeal is enabled |
| `docuseal_document_url` | `text?` | Audit-log URL once signing completes |
| `docuseal_signing_url` | `text?` | Embed/redirect URL surfaced to the candidate |
| `sent_at` / `expires_at` | `timestamptz?` | Set on `→ sent`; expiry default = 7 days |
| `accepted_at` / `declined_at` | `timestamptz?` | Stamped on terminal transitions |
| `declined_reason` | `text?` | Optional free-text |
| `created_by_user_id` | `uuid` | Recruiter who created the draft |

Indexes: `(tenant_id)`, `(application_id)`, `(status, expires_at)` for the
expirer cron. `set_updated_at()` trigger maintains `updated_at`.

RLS posture:
- SELECT: tenant + (admin / recruiter / hiring_manager)
- INSERT / UPDATE: tenant + (admin / recruiter)
- DELETE: tenant + admin

### CompBand

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | uuidv7 |
| `tenant_id` | `uuid` | FK → tenants |
| `grade` | `text` | Free-form grade label |
| `currency` | `enum` | `RUB | USD | THB | USDT` |
| `min_salary` / `mid_salary` / `max_salary` | `int` | CHECK `0 < min <= mid <= max` |
| `deleted_at` | `timestamptz?` | Soft delete |

Unique: `(tenant_id, grade, currency)` for the band catalogue lookup.

RLS posture:
- SELECT: tenant + (admin / recruiter / hiring_manager)
- INSERT / UPDATE / DELETE: tenant + admin

---

## Phase 5 — Offboarding, alumni, employee portal

### `OffboardingChecklist` / `OffboardingTask`

Offboarding mirrors onboarding for notice-period exits. A checklist belongs to one `Employee`; tasks are ordered by `task_order`, assigned by role (`hr_admin`, `hiring_manager`, `it`, `employee`), and reuse `OnboardingTaskStatus` (`pending`, `in_progress`, `completed`, `skipped`, `blocked`). The `notice → terminated` FSM gate requires the latest offboarding checklist to have `completed_at` set.

### `ExitInterview`

One optional exit interview per employee (`employee_id` unique). It records `reason_category` (`voluntary`, `mutual`, `probation_failed`, `for_cause`, `other`), interviewer, conducted timestamp, notes, `would_rehire`, and optional JSON metadata.

### `AlumniProfile`

Created idempotently on termination. Links the terminated `Employee` and optional source `Candidate`; tracks alumni `status` (`active`, `do_not_rehire`, `archived`), rehire eligibility, tags, notes, and departure/rehire metadata. Admin-only RLS in Phase 5.

### `User.disabled_at`

Termination deactivates the linked account by setting `users.disabled_at` and deleting auth sessions. Auth rejects login, refresh, and current-session reads for disabled users.

---

## Phase 6 — Learning & Performance (LMS, 1:1s, 360° Reviews, OKRs, IDPs)

### `Employee.role_family` (new column)

Free-form role family label (e.g. `engineering`, `sales`) used to drive
`LearningPath` auto-assignment when a new `Employee` is created.

### `LearningCourse`

A reusable course. `content_type` is one of `video`, `article`, `quiz`,
`external_link`, `scorm`. `org_unit_id` scopes a course to a department
(`null` = available org-wide). `is_mandatory` flags compliance courses.
Soft-deleted via `deleted_at`.

RLS posture:
- SELECT: tenant
- INSERT / UPDATE / DELETE: tenant + admin (`hr_admin` / `owner`)

### `LearningPath` / `LearningPathItem`

A `LearningPath` groups `LearningCourse` rows in an ordered sequence
(`learning_path_items.item_order` unique per path). Paths can carry a
`role_family` and an `auto_assign` flag: when both are set, the path is
assigned to every newly created `Employee` whose `role_family` matches (or
when the path has `role_family IS NULL`). Same admin-write RLS as courses.

### `LearningAssignment`

Joins an `Employee` to either a `LearningCourse` xor a `LearningPath` (CHECK
constraint enforces exactly one target). Tracks `status`
(`assigned | started | completed | expired`), `progress_percent` (0–100),
optional `score` and `due_date`. The `(employee_id, course_id)` and
`(employee_id, path_id)` partial unique indexes make assignment idempotent.

RLS posture:
- SELECT: tenant + (admin / hiring_manager / employee owning the row)
- UPDATE (self): employee owning the row may patch `status / progress / score`
- INSERT / DELETE: tenant + admin

### `OneOnOne`

A scheduled 1:1 between a manager (`manager_user_id`) and an `Employee`.
Holds `status` (`scheduled | completed | cancelled`), `agenda`, `notes`, a
JSON `action_items` array, and a `reminder_sent_at` watermark used by the
`1on1.reminder` cron job to avoid double-sending.

RLS posture:
- SELECT: tenant + (admin / the manager / employee owning the row)
- WRITE: tenant + (admin / the manager)

### `ReviewCycle` / `ReviewRequest`

A 360° review cycle is opened by `hr_admin` (`draft → open`) and later
closed (`open → closed`). `questions` is a JSON array of `{id, prompt,
type}` items. Each `ReviewRequest` ties one reviewer (`reviewer_user_id`)
to one subject `Employee` for the cycle and carries a relationship label
(`peer`, `manager`, `report`, `self`, …). Unique
`(cycle_id, subject_employee_id, reviewer_user_id)` prevents duplicate
requests.

RLS posture:
- ReviewCycle SELECT: tenant; WRITE: admin.
- ReviewRequest SELECT: tenant + (admin / the reviewer / the subject).
  Reviewer may UPDATE their own request to `submitted` / `declined`.

### `Okr` / `KeyResult`

Per-employee OKR scoped to a `quarter` string (e.g. `2026-Q2`). `parent_okr_id`
supports caascading (org → team → individual). `progress_percent` is recomputed
server-side from child `KeyResult` rows whenever a key result is updated.
`KeyResult` carries `start_value`, `target_value`, `current_value`, `unit`, and
`status` (`open | on_track | at_risk | achieved`).

RLS posture:
- SELECT: tenant + (admin / hiring_manager / employee owning the OKR)
- WRITE: tenant + (admin / employee owning the OKR)
  Managers do not WRITE in Phase 6; admin overrides remain available.

### `Idp` / `IdpItem`

Individual Development Plan keyed `(employee_id, quarter)` unique. Items are
free-form learning/coaching actions with `status`
(`planned | in_progress | completed | dropped`) and an optional `due_date`.
Same RLS as `Okr` (admin/manager read, owner write).
