# HR-System

Corporate HRIS/ERP platform covering the full employee lifecycle: from job requisition and resume parsing through onboarding, performance, learning, and alumni network. This repository was bootstrapped from the [vibe coding template](https://github.com/bossssmann-ui/vibe) and is being built in 12 phases. The roadmap lives in a private Obsidian vault; each phase is tracked by a GitHub issue.

The current phase is **Phase 18 — Авто-конвейер (Горизонт 1)**. See `docs/contracts/00-overview.md` for the canonical statement of scope, active surfaces, and decision rules. Future Copilot/Claude agents must read the `docs/contracts/*.md` files at the start of every task.

**Phase 18 (fully implemented)** добавляет сквозной авто-конвейер рекрутинга: HH-импорт → AI-скоринг → авто-selection → авто-assessment → composite score → уведомления рекрутеру. Весь конвейер управляется feature-флагами (`AUTO_SELECTION_ENABLED`, `AUTO_ASSESSMENT_ENABLED`, `COMPOSITE_SCORE_ENABLED`, `RECRUITER_NOTIFICATIONS_ENABLED`) и покрыт сквозным интеграционным тестом. Подробная схема потоков — в `docs/contracts/00-overview.md#phase-18`.

## Active vs deferred surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| `backend/` (Hono + Prisma + PostgreSQL) | **active** | Recruiting-core data model, FSMs, RLS, auth. |
| `web/` (React + Vite + TanStack) | **active** | Recruiter UI. Phase 0 ships auth + a working read-only `/requisitions` page; the rest of the routing skeleton (`/vacancies`, `/applications`, `/admin/*`) is wired with placeholders and lands alongside the matching backend routes in Phase 0.x / Phase 1. |
| `packages/contracts` (Zod) | **active** | Shared request/response schemas between web and backend. |
| `mobile/` (Expo) | deferred | Kept intact; no Expo/EAS/Maestro work until activated. |
| `landing/` (Astro) | deferred | Kept intact; no marketing content yet. |

Deployment (DigitalOcean / Yandex Cloud), real-time chat, AI scoring, DocuSeal, HH.ru and other job-board integrations are **out of scope for Phase 0** and are tracked under later phases. See `docs/contracts/00-overview.md` for the exhaustive deferred list.

## Quick start

Requirements: [Bun](https://bun.sh/), Docker, and a POSIX shell.

```bash
# 1. Install workspace dependencies.
bun install

# 2. Bring up local PostgreSQL (see docs/LOCAL_DATABASE.md for details).
docker compose up -d postgres

# 3. Copy env templates and edit credentials if needed.
cp .env.example .env
cp backend/.env.example backend/.env

# 4. Apply migrations and seed the bootstrap tenant + owner user.
bun run --cwd backend prisma:migrate

# 5. Start the stack (in separate terminals).
bun run dev:backend
bun run dev:web
```

The seeded owner credentials come from the backend `.env` (`BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`). Never commit real credentials — `.env.example` only contains placeholder values.

## Demo journey (Phase 0)

1. Log in as the seeded owner.
2. Navigate to `/requisitions` — you'll see an empty list (the seeded owner has no requisitions yet).

Phase 0 ships the auth baseline, the recruiting data model, FSM enforcement, the audit middleware, RLS policies, and the read-only `/requisitions` page. Org-unit + requisition forms, the FSM-driven approval buttons, vacancy auto-create, and the Kanban funnel arrive in Phase 0.x / Phase 1+.

## Commands

```bash
bun run typecheck         # all workspaces
bun run test              # contracts + backend + web (+ mobile, currently dormant)
bun run test:backend
bun run test:backend:integration
bun run e2e:web
```

## Documentation

- `docs/contracts/` — **anchor docs for AI agents.** Read these first.
- `docs/ARCHITECTURE.md` — high-level system shape (template-inherited; updated as Phase 0 lands).
- `docs/LOCAL_DATABASE.md` — Docker Compose PostgreSQL setup.
- `docs/TESTING.md` — testing strategy and Playwright/Maestro guidance.
- `docs/DEPLOYMENT.md`, `docs/STORAGE.md`, `docs/YANDEX_CLOUD.md` — deferred infra; reference only.

## Repository conventions

- Migrations are the only way to change the database schema.
- Never bypass FSM `canTransition` calls; FSM rules are tested at the unit level.
- Never log secrets; PR review must catch any leak.
- PRs reference the phase / sub-phase from the roadmap and link the tracking issue.
- New dependencies require justification in the PR description.

See `docs/contracts/50-coding-standards.md` for the full list of rules that apply to every contributor (human or AI).
