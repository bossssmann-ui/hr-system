# 50 — Coding Standards for AI Agents and Humans

This file lists the rules **every contributor** — Copilot, Claude, Codex, or a human — must follow. Violations are blockers in code review.

## Hard rules (non-negotiable)

1. **Migrations are the ONLY way to change the schema.**
   - Edit `backend/prisma/schema.prisma` and run `bun run --cwd backend prisma:migrate` to generate a migration.
   - Never hand-edit `migration.sql` unless a reviewer explicitly requests it for a backfill / safety check, and document why.
   - Do not run ad-hoc `ALTER TABLE` against any database.

2. **Never bypass FSM `canTransition` calls.**
   - The legal transition matrix lives in `backend/src/features/<domain>/<domain>.fsm.ts` and is the only place transitions are encoded.
   - Routes must call `canTransition(from, to, actorRoles)` and respond `HTTP 422 fsm.forbidden_transition` on failure.
   - Adding a new transition is one diff: schema enum + FSM constant + `docs/contracts/20-fsm.md` + tests.

3. **Never log secrets.**
   - Passwords, refresh tokens, JWTs, API keys, private keys, OTPs, presigned URL query strings — never in logs, never in `AuditEvent.diff`, never in test fixtures.
   - The `redact()` helper in `backend/src/http/audit.ts` is the canonical scrubber.
   - A pre-commit secret scanner is a Phase 1+ deliverable; until then reviewers must check manually.

4. **RLS is the last line of defence, not the first.**
   - Application code enforces auth + FSM + route guards.
   - RLS is enabled on every business table and is what the integration test verifies.
   - Do not disable RLS in any path other than migrations.

5. **Every mutating route emits an `AuditEvent`.**
   - Use the audit middleware (`backend/src/http/audit.ts`); routes declare the action name explicitly with `c.set('auditEntry', { action, entityType, entityId, diff })`.

6. **PR descriptions reference the phase / sub-phase from the roadmap and link the tracking issue.**
   - Example: `Phase 0 → Phase 0.3 backend foundation. Closes #12.`

7. **No new dependencies without justification.**
   - Prefer the libraries already in the workspace: Zod, TanStack Query / Form / Router, Hono, Prisma, shadcn/ui, `@web-app-demo/contracts`.
   - If a new dependency is genuinely needed, list it in the PR description with a one-sentence reason and reviewer approval is required.

8. **No real secrets in the repo.**
   - `.env.example` only contains placeholder values. Real credentials live in developer-local `.env` files and (later) deployment secrets.

9. **Tenant isolation always.**
   - Every business table has `tenant_id`. Every query relies on RLS (`SET LOCAL app.tenant_id`); do not pass `tenant_id` as a query filter from user input.

10. **Soft-delete by default for personal data.**
    - Hard-delete is a Phase 11 retention concern. Until then, all candidate / resume removals set `deleted_at`.

## Style and structure

- **TypeScript everywhere.** Strict mode on. No `any` unless commented and bounded.
- **Zod is the single source of validation truth.** Hono routes use `@hono/zod-openapi`; web forms use `TanStack Form` with the same Zod schemas via `packages/contracts`.
- **No barrel re-exports across feature boundaries.** Import from the file that owns the symbol.
- **One feature = one folder under `backend/src/features/<domain>/`.** Each folder typically contains: `<domain>.fsm.ts`, `<domain>.service.ts`, `<domain>.routes.ts`, plus tests.
- **Pure functions where possible.** FSM modules, redaction helpers, validators must be pure.
- **Errors return a `{ code, message, details? }` envelope.** The vibe template's `errorResponse` helper is the canonical builder.

## Testing

- Unit tests for every FSM module — every legal and illegal transition (in place).
- One RLS integration test asserting cross-tenant denial on `hiring_requisitions` (in `backend/src/features/requisitions/requisitions.rls.integration.test.ts`). Per-table role-based denial tests land alongside the matching domain routes.
- Web E2E (Playwright) covers the seeded recruiter journey. Phase 0 ships the auth E2E only; the requisitions/applications flows land alongside their forms.
- `bun run typecheck`, `bun run test`, `bun run test:backend:integration`, `bun run e2e:web` must all pass in CI.

## Forbidden patterns

- **No `prisma.$queryRawUnsafe` with user input** — use parameterised `$queryRaw\``.
- **No `BYPASSRLS` on the runtime role.** Migrations are the only exception.
- **No silent fallbacks.** If RLS denies a query, the API returns 403, not an empty array masquerading as success.
- **No "for now I'll skip the FSM" shortcuts.** If a transition isn't allowed yet, add it to the table — don't carve a side door.
- **No copy-paste of role checks across routes.** Use the shared `requireRole(...)` guard at `backend/src/auth/requireRole.ts`.

## Working with these contracts

- When code and `docs/contracts/*.md` disagree, **stop and fix one of them in the same PR**.
- When the spec is ambiguous, leave a `TODO(phase-0-review: <what is unclear>)` comment in code and call it out in the PR description rather than guessing.
- When adding a new domain, add a corresponding entry to `10-data-model.md`, `20-fsm.md` (if it has states), `30-rls-policies.md`, and `40-audit.md` (action vocabulary).
