# CLAUDE.md

## Operating Standard

- Answer in the user's language.
- Be autonomous: inspect, decide, implement, validate, and report without unnecessary confirmation loops.
- Ask only when ambiguity blocks a safe decision, the product choice is genuinely open, or the action is risky/destructive.
- Do not hallucinate. Verify uncertain claims through code, tests, runtime output, or repository evidence.
- Preserve unrelated user changes. Do not revert or overwrite work you did not create unless explicitly asked.
- The job is to leave the system clearer, more correct, and easier to trust.
- When editing this file, keep `AGENTS.md` aligned unless the difference is intentional and documented.

## Instruction Priority

If instructions conflict, follow higher-priority system, developer, and user instructions first, then the nearest repository instructions. Safety, privacy, and preservation of user work take priority over speed.

## User Interaction

- Assume repository users are Vibe coders without programming experience. Do not ask them to choose between technical solutions.
- Frame choices as product decisions: describe the user experience each option creates, then recommend one.
- Ask for confirmation only when the product outcome is truly open or the action is risky.

## Repository Grounding

- Start from the repository itself, not assumptions. Read `README.md` and relevant `docs/` early.
- Trust current code, schemas, tests, and runtime output over stale docs; align docs when practical.
- Discover structure dynamically (`tree -L 2`, `rg --files`). Do not treat `README.md` as a file inventory.
- Use the repository's existing package manager, scripts, test runner, formatter, linter, and generators.
- Use `docs/LOCAL_DATABASE.md` and `docker-compose.yml` as the local PostgreSQL source of truth. Default to Docker Compose.
- In Codex shell sessions prefer `PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"` for `node`/`bun`.
- Do not add new production dependencies without explicit user approval. Prefer Zod, TanStack Query/Form/Router, Hono, Prisma, Expo, `@web-app-demo/contracts`.
- Before using framework APIs, check current installed package types rather than relying on memory.
- For E2E use Playwright (web) and Maestro (mobile). Read `docs/TESTING.md` before adding flows.
- For mobile E2E: prefer stable `testID` constants from `mobile/src/constants/testIds.ts`; run against a dev build, not Expo Go.

## Project Context

- Use `README.md` as source of truth for first-run setup and product intake.
- Keep durable choices in README and `docs/`, not in this file.
- Prefer monolithic backend architecture. Do not split into microservices without a concrete operational need.
- For real-time and deployment decisions, follow `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md`.

## Repository Remote Policy

- Inspect `git remote -v` before any branch, commit, push, or PR workflow.
- This repo is used as a template. If `origin` points to the template and the user has not said they are contributing back, remove it.
- Add the user's own GitHub repository as `origin` only when they provide a URL. Do not push to the template remote.

## Deployment & Storage Policy

- Deployment, infrastructure, and storage policy live in `README.md`, `docs/DEPLOYMENT.md`, `docs/STORAGE.md`, and `docs/LOCAL_DATABASE.md`.
- Use repository scripts/generators for deploy work; do not rely on provider details from memory.

## Task Mode

Classify the task before editing and scale the process to the task.

| Mode | When to use |
|---|---|
| `Review` | Read-only evaluation, explanation, or architecture review. Inspect evidence, cite files, report risks. Do not edit unless asked. |
| `Direct` | Cosmetic, copy, spacing, styling, or obvious local edits that do not change runtime behavior. Smallest change + narrow validation. |
| `Investigation` | Diagnosis when the root cause is unclear. Reproduce the failure path, use vertical + horizontal research, reframe if two attempts fail. |
| `TDD-first` | Behavior, logic, contracts, auth, permissions, persistence, validation, routing, or state transitions. Write the failing test first; implement minimally; repeat. |

## Acceptance Contract

For non-trivial work, define before starting: what "done" means, 3–5 observable pass/fail criteria, and primary + secondary validation signals. Skip ceremony for simple local tasks.

## Vertical And Horizontal Research

Before fixing non-trivial behavior inspect both axes.

**Vertical** — follow the execution path: UI → route/guard → page → hook/service → contract/API → persistence. Backend: request → validation → auth → domain logic → transaction → response.

**Horizontal** — check adjacent surfaces: sibling routes, related hooks, shared services, schemas, tests; loading/empty/error/success states; producer and consumer sides of contracts.

Do enough research to find the owner layer. Do not turn research into wandering.

## Root Cause Discipline

- Understand the failure path before patching. Fix the owner layer, not the nearest visible symptom.
- Reject child-side fallbacks, defensive state repair, duplicated logic, or wrappers that hide an upstream mistake.
- If the smallest diff and the correct diff diverge, choose the correct diff with the smallest system-wide footprint.
- A change is not minimal if it makes the code harder to understand tomorrow.

## Change-Surface Triggers

When touching a boundary, inspect and align directly coupled code.

- **Shared contracts/schemas**: validate producer and consumer sides.
- **Routes, guards, layouts**: inspect protected/public flows and navigation side effects.
- **Queries/mutations**: inspect keys, invalidation, loading/empty/error/optimistic states.
- **Schema/persistence**: inspect contract shape, serializers, migrations, read and write paths.
- **Auth/permissions**: inspect guards, loaders, session shape, backend enforcement.
- **Async workflows**: inspect retries, idempotency, ordering, and failure visibility.

## Minimal Sufficient Change

- Aim for the smallest coherent change that fully solves the real problem at the owning layer.
- Prefer flat, simple implementations. Do not add abstractions unless they remove real current complexity.
- Prefer decoupling over DRY. Small intentional duplication beats the wrong shared abstraction.
- Delete obsolete escape hatches when a clearer ownership model replaces them.

## Documentation Discipline

- Code is the primary source of truth. `README.md` and `docs/` capture durable context: architecture, workflows, operational constraints, caveats, and non-obvious decisions.
- Do not mirror code structure in docs or maintain exhaustive file inventories.
- Update docs when a change materially affects architecture, setup, operations, contracts, or user flows.

## Testing And Validation

- Run the smallest meaningful validation that covers the changed surface. Cheap gates first: targeted tests → typecheck → lint → build → wider suites.
- For non-trivial behavior, account for important edge cases (happy path, failure, boundary, permission, persistence, recovery).
- Validate after implementation and before closing. Non-zero exits, type errors, and lint errors are failed validation.
- Do not declare success on proxy metrics alone. If only secondary signals were checked, say so.

## Prisma Migration Policy

- Express schema changes declaratively in `schema.prisma`. Generate migrations with the Prisma workflow.
- Do not hand-write migration SQL unless explicitly asked. Do not run ad-hoc `ALTER TABLE`.

## UI And Design

- Follow the existing design system, component primitives, and styling conventions.
- Use parent padding + container gap for layout rhythm. Keep spacing on the shared scale.
- Shared visual components are visually closed units — compose from outside through wrappers, not visual overrides.

## Safety And Workspace Hygiene

- Never stop processes to free ports. Use isolated ports or test config overrides.
- Do not propose CI/CD or deployment pipelines unless explicitly asked.
- Do not print secrets, tokens, private keys, credentials, cookies, or raw `.env` values.
- Do not weaken auth, permissions, validation, encryption, rate limits, or auditability.
- Do not stage, commit, amend, rebase, reset, push, or delete files unless explicitly asked.
- Keep diffs focused. Put investigation artifacts under `.scratch/`.

## Decision Rules

- Obvious and low-risk → execute.
- Material product or architecture tradeoffs → present up to two options and recommend one.
- Safe assumption unblocks work → proceed and state the assumption.
- Destructive, irreversible, security- or privacy-sensitive → ask first.

## Completion Protocol

Report at the end of every implementation or investigation:

- What changed and why; root cause when identified; affected layers.
- Validation performed; primary signal status (met / not met / partially validated); secondary signal status.
- Documentation status (updated / not needed / needs alignment).
- Remaining risks, missing coverage, or follow-up work.
- Migration or rollout implications when contracts, schemas, persistence, auth, routing, or architecture changed.
- Suggested commit message when the change is ready.
