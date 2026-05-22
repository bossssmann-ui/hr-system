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
| Application AI interview prep (Phase 1D) | `application.questions_generated` |
| Assessments (Phase 1D) | `assessment_template.create`, `assessment_template.update`, `assessment_session.invited`, `assessment_session.consented`, `assessment_session.submitted` |
| Interview (Phase 1F) | `interview.create`, `interview.consent_updated`, `interview.recording_uploaded`, `interview.transcribe_requested`, `interview.build_protocol_requested`, `interview.transcribed`, `interview.protocol_built`, `interview.offer_draft_built` |
| Integrations (HH.ru) | `hh.sync.candidate_imported` |
| Auth | `auth.login`, `auth.logout`, `auth.refresh`, `auth.password_changed` |
| Admin | `user.role_added`, `user.role_removed` |

New actions require a one-line entry in this table and a `TODO(phase-N)` comment if not implemented yet.

---

## Phase 1F — Recording consent PII note (152-ФЗ)

Interview recordings and transcripts contain **personal data** including voice, name, and employment-related statements. The legal basis for processing is the **candidate's explicit consent to being recorded** (`consent_recorded = true`), set via `PATCH /api/interviews/:id/consent` by a recruiter before transcription begins.

### What is processed and where

| Data | Storage | Legal basis |
| --- | --- | --- |
| Recording file | Local Docker volume (stub); real DigitalOcean Spaces in Phase 3 | Candidate's recorded consent |
| Transcript (diarized segments) | PostgreSQL JSONB on `Interview.transcript` | Same consent |
| Interview protocol | PostgreSQL JSONB on `Interview.protocol` | Same consent (protocol is derived from transcript) |
| Offer draft | PostgreSQL JSONB on `Interview.offer_draft` | Same consent (deterministic mapping from protocol) |

### LLM data residency

When building the interview protocol, the transcript is sent to the configured LLM provider (default: Anthropic Claude via `LLM_SCORING_API_KEY`). Unlike Phase 1C resume scoring, PII is **not stripped** here — the protocol legitimately needs full interview context (candidate name, quoted statements, etc.).

If using a **non-RF LLM** provider (e.g. Anthropic), this is a **data-residency consideration** for the system owner under 152-ФЗ. Mitigations:
1. Use Yandex SpeechKit for ASR (data stays in RF).
2. Self-host Whisper + a local LLM (see `backend/src/integrations/asr/` — WhisperProvider seam is ready).
3. Or accept the cross-border transfer with appropriate consent and safeguards.

**Document the owner's choice** in the tenant's privacy notice. This system does not block deployment based on the LLM provider — the owner must weigh the tradeoff.

### Consent audit trail

Every time `consent_recorded` is updated, an `interview.consent_updated` `AuditEvent` is written with the actor, entity, and new value. The consent field itself is a `boolean` on `Interview` — not stripped by the audit redact rules.

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

## 152-ФЗ note for proctored assessments + AI interview prep (Phase 1D)

Assessment proctoring processes behavioral anti-fraud signals (`paste_events`, `focus_loss_events`, `keystroke_timing`) and may process webcam snapshots **only** when:
1. `PROCTORING_WEBCAM_ENABLED=true`; and
2. candidate provides separate explicit webcam consent.

The assessment cannot start until proctoring consent is recorded (`assessment_sessions.consent_recorded = true`). No consent → `POST /api/public/assessment/:token/start` must fail with consent error.

Trust Score is computed server-side from raw signals and stored as an advisory field (`assessment_sessions.trust_score`). A low score may set `applications.trust_flagged = true` for recruiter review, but it must never auto-reject candidates.

AI-generated interview questions and optional open-answer grading follow the same PII rule as Phase 1C: prompt payloads must include job-relevant content only and must exclude direct contact PII (`full_name`, `email`, `phone`).

## Logging vs audit

- **Audit** = persisted in the database, queryable, retained by retention policy, never contains secrets.
- **Application logs** = stderr / log aggregator. Used for diagnostics. Never the source of truth.

These two surfaces must not be confused. Never use `console.log(applicationDiff)` as an audit substitute.

## Phase 1E — Messaging audit actions

| Action | Entity type | Trigger |
| --- | --- | --- |
| `message.sent` | `Message` | Recruiter sends outbound message (after queue delivers) |
| `message.received` | `Message` | Inbound message ingested from any channel webhook |
| `conversation.create` | `Conversation` | New conversation created (auto or manual) |
| `message_template.create` | `MessageTemplate` | Template created |
| `message_template.update` | `MessageTemplate` | Template updated |
| `message_template.delete` | `MessageTemplate` | Template deleted |

## 152-ФЗ note for careers-page applicants (Phase 1G)

Candidates who apply via the public careers form (`POST /api/public/vacancies/:slug/apply`) submit their personal data voluntarily under Federal Law No. 152-ФЗ. The legal basis for processing is:

> The subject's own submission of their resume, contact details, and cover note in response to a publicly advertised vacancy, accompanied by an explicit consent checkbox on the form.

### What is processed and where

| Data | Storage | Legal basis |
| --- | --- | --- |
| `full_name`, `email`, `phone` | PostgreSQL `candidates` table | Applicant-initiated submission + explicit consent |
| `cover_note` | PostgreSQL `applications.notes` | Same |
| `resume_link` / `resume_text` | Not persisted in Phase 1G (reserved for Phase 2 stub upload) | — |
| `consent_context` | PostgreSQL `candidates.consent_context` JSONB | Records `basis`, `consent_text_version`, `consented_at`, `ip` |

### Consent context fields

When a candidate is created or updated via the careers form, `consent_context` is set to:

```json
{
  "basis": "public_careers_form",
  "consent_text_version": "1.0",
  "consented_at": "<ISO 8601 timestamp>",
  "ip": "<submitter IP>"
}
```

The `consent_text_version` must be bumped if the consent wording on the form changes materially (update the careers page component and this doc together).

### Audit trail

Every careers-page application emits an `application.created` `AuditEvent` with `diff.via = "careers_page"`. This allows administrators to audit all inbound applications from the careers channel.

### Anti-spam

A honeypot hidden field silently rejects bot submissions. A per-IP rate limit (default 20/hour, configurable via `CAREERS_RATE_LIMIT_PER_HOUR`) prevents automated flooding. CAPTCHA is not implemented in Phase 1G — add `// TODO(phase-1g+): stronger anti-spam` if needed.

### Feature flag

The `CAREERS_PAGE_ENABLED` env variable (default `false`) gates the `/api/public/` endpoints and the `/careers*` frontend routes. When off, the public API returns 404 and the authed app is unaffected.

## Phase 1G — Careers audit actions

| Action | Entity type | Trigger |
| --- | --- | --- |
| `application.created` | `Application` | Public apply form submission; `diff.via = "careers_page"` |



## 152-ФЗ note for candidate messaging (Phase 1E)

Messages contain PII (candidate identity, contact content). They are stored in the `messages` table on the basis of the recruiting relationship/consent (same legal basis as applications). Retention applies as per the general candidate PII policy.

**AI-draft prompt restriction:** The `POST /api/conversations/:id/ai-draft` endpoint sends only conversation history and non-contact role context to the LLM. Direct PII fields (`email`, `phone`, `full_name`) are **not** included in the LLM prompt.

When using a non-RF LLM (e.g. Anthropic), conversation content sent to the LLM provider is a data-residency consideration for the owner. Inform tenants accordingly before enabling AI drafts.
