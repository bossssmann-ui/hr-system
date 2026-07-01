# 00 — Overview

> **Read me first.** Every AI agent (Copilot, Claude, Codex, etc.) and human contributor must read this file and the rest of `docs/contracts/*.md` before making changes. These documents are the source of truth for product scope, data shape, allowed state transitions, security model, audit obligations, and coding rules.

## Product goal

HR-System is a corporate HRIS/ERP platform covering the full employee lifecycle for a single tenant (with the architectural seam to add multi-tenancy later). Scope spans:

- **Recruiting** — requisitions, vacancies, candidates, resumes, applications, hiring pipeline.
- **Offer & onboarding** — offer letters, e-signature, day-one provisioning.
- **Lifecycle** — org structure, role changes, transfers, offboarding, alumni network.
- **Learning & performance** — LMS, learning paths, 1:1s, 360 reviews, OKRs, IDPs, probation FSM.
- **Finance & analytics** — comp planning, payroll integrations, HR analytics, flight-risk and burnout signals.
- **Partner & compliance** — vendor integrations (HH.ru, СберПодбор, Avito, Работа.ру, DocuSeal, Telegram, Gemini, OpenAI/Anthropic), 152-ФЗ / GDPR compliance, audit, retention.

The roadmap is split into **12 phases**. This document only covers the **active phase and the explicit deferral list**; the phase roadmap itself lives in a private Obsidian vault and is referenced by issue title from this repository.

## Active surfaces (Phase 0)

| Surface | Status | Owner of the surface |
| --- | --- | --- |
| `backend/` | active | Hono API, Prisma + PostgreSQL schema, FSM enforcement, RLS, audit middleware, notifier stub, queue stub. |
| `web/` | active | Recruiter UI: login, requisitions, vacancies, applications Kanban, admin (users + audit log). |
| `packages/contracts` | active | Zod schemas shared between backend and web. |

Phase 18 introduces the auto-pipeline foundation (feature flags + contracts + schema fields) in additive mode; business logic remains in follow-up PRs.

## Deferred surfaces

| Surface | Notes |
| --- | --- |
| `mobile/` (Expo + Maestro) | Directory kept intact; no Expo/EAS/Maestro work. |
| `landing/` (Astro) | Directory kept intact; no marketing content. |

## Out of scope for Phase 0

The following items are **explicitly deferred** to later phases. If a task seems to require any of them, stop and leave a `TODO(phase-N: …)` comment instead of implementing.

- External integrations: HH.ru, СберПодбор, Avito, Работа.ру, DocuSeal, Telegram, Gemini, OpenAI/Anthropic.
- AI scoring of resumes (LLM calls of any kind).
- Anti-fraud / proctoring of tests.
- Chrome extension for recruiters.
- Telegram bot / messenger integration.
- Probation FSM, 1:1s, 360 reviews, IDPs, OKRs.
- LMS, learning paths, knowledge hub (RAG).
- Mobile app (Expo) and landing page (Astro).
- DigitalOcean / Yandex Cloud deployment configuration.
- Valkey / real-time WebSocket layer (architect with future Pub/Sub in mind, do not stand up Valkey yet).
- ML models (flight-risk, burnout).
- Email delivery to external SMTP (Notifier stays in stub state).
- Payment processing.

## Decision-making rules

1. **Documentation contracts beat code intuition.** When code disagrees with these contracts, fix the code or update the contract — never silently drift.
2. **Migrations are the only way to change the schema.** No hand-edited SQL in production paths.
3. **FSMs are enforced at the service layer.** Routes call `canTransition(from, to, actorRoles)` before any update. RLS is the second line of defence, not the first.
4. **RLS policies are enforced by the database, not by the application.** Application code may add additional checks but must not be the only enforcement.
5. **All mutating routes emit an `AuditEvent`.** Failure to write the audit row is logged at error level but does not roll back the business transaction.
6. **No real secrets in the repo.** `.env.example` files only contain placeholder values.
7. **No new dependencies without justification** in the PR description. Prefer existing libraries (Zod, TanStack Query/Form/Router, Hono, Prisma, shadcn/ui).
8. **PR descriptions reference the phase / sub-phase and link the tracking issue.**
9. **Ambiguity is resolved by leaving a `TODO(phase-0-review: …)` comment**, not by guessing.

## Architectural seams (kept in mind, not built yet)

- `tenant_id UUID NOT NULL` on every business table for future multi-tenancy. A single bootstrap tenant exists today.
- `Notifier` is an abstraction with `email`, `telegram`, `in_app` channels — only `in_app` is implemented; the others log "not implemented". Adding SMTP/Telegram later does not change call sites.
- `Queue` is an in-process `setTimeout`-backed stub today. Swapping to BullMQ + Valkey later must not change producer call sites.
- Backend emits domain events via the `Notifier` so a future real-time layer (Valkey Pub/Sub) can subscribe without invasive changes.
- **Quiet Hours** (Phase 1E): automated outbound messages are deferred outside the active send window.
  - *Business context*: this company spans Vladivostok (UTC+10) → Moscow (UTC+3), so the active window is 09:00 Vladivostok → 18:00 Moscow = **23:00 UTC → 15:00 UTC** (wraps past midnight).
  - *Configuration*: `QUIET_HOURS_QUIET_START_UTC` (default 15) and `QUIET_HOURS_QUIET_END_UTC` (default 23) env vars control the quiet period boundaries.
  - *Central helper*: `backend/src/features/messaging/quiet-hours.ts` — import and reuse for any future automated-outbound path (scheduled jobs, Notifier transports, etc.) rather than reimplementing the logic.

## How to add a new feature

1. Read `10-data-model.md`, `20-fsm.md`, `30-rls-policies.md`, `40-audit.md`, `50-coding-standards.md`.
2. Identify which phase the feature belongs to. If it is not in the current phase, stop.
3. Design the schema change as a Prisma migration; do not hand-edit `migration.sql`.
4. Add or update FSM transitions and unit tests.
5. Add or update RLS policies in the next migration.
6. Add the route, wrap mutations in audit middleware, and emit notifier events.
7. Add web UI behind the recruiter / admin auth gates.
8. Update the relevant `docs/contracts/*.md` file if the contract changes.
