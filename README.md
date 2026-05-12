# Vibe Coding Template

A full-stack starter for web and mobile products: one repository with a Bun/Hono backend, a React browser client, an Expo mobile app, an Astro landing project, and shared API contracts. The goal is to give agents and developers clear architectural boundaries so new features keep following the same shape.

## First-Run Bootstrap For Agents

When installing this repository from a GitHub URL into a fresh Codex or agent session, treat setup as an onboarding task before feature work. This README is the source of truth for first-run setup because fresh installers may not read `AGENTS.md`.

Give the agent this initial prompt:

```text
Install this repository into the project. First read README.md, CLAUDE.md if present, and relevant docs/*.md. Before setup, ask me what product I want to build first, which surfaces I need now (web, mobile, backend/API, landing, or full-stack), and whether I need deployment now. If deployment is needed, ask whether to use DigitalOcean or Yandex Cloud. Treat this checkout as a new project by default, not as a pull request back to the template: detach the original template remote unless I explicitly say I am contributing to the template, and add my own GitHub remote only if I provide one or ask you to create/publish it. After I answer, record the chosen project focus in AGENTS.md and CLAUDE.md before feature work. Do not require cloud credentials for local development.
```

- First read `README.md`, `CLAUDE.md` if present, and relevant `docs/*.md`, then inspect package scripts and `.env.example` files before running setup commands.
- Inspect `git remote -v` before any branch, commit, push, or PR workflow. If `origin` points to the template repository and the user has not explicitly said they are contributing to the template, treat this as a new project and detach from the template remote with `git remote remove origin`.
- If the user provides their own GitHub repository URL or asks to publish the new project, add that URL as the new `origin` after the template remote is removed. If the user has not chosen a destination yet, leave the repository with no `origin` and report that publishing is not configured.
- Do not open pull requests against the template repository during first-run project setup. Ask only if the user explicitly says this checkout is for improving the template itself.
- Ask the user a short intake in the user's language before making product or deployment choices:
  - what product or app they want to build first;
  - which surfaces are active now: web, mobile, backend/API, landing, or full-stack;
  - whether deployment is needed now, and if yes, whether to use DigitalOcean or Yandex Cloud.
- After the user answers, update the `Project Focus` block in `AGENTS.md` and the matching block in `CLAUDE.md` before starting feature work. These files should say which surfaces are active, which are deferred, what validation to run, and what deployment/release work is in or out of scope.
- If only the web app is active, keep mobile intact but deferred: do not run Expo/EAS/Maestro setup, do not add mobile features, and add or update a short deferred-surface note in `mobile/README.md`. When the user later asks for mobile, update `AGENTS.md` and `CLAUDE.md`, remove or rewrite that note, then set up and validate mobile normally.
- If only the mobile app is active, keep web and landing intact but deferred: do not add browser-only features or Playwright flows unless they support the active mobile/backend work, and add or update a short deferred-surface note in `web/README.md` or `landing/README.md` as relevant. When the user later asks for web, update `AGENTS.md` and `CLAUDE.md`, remove or rewrite that note, then set up and validate web normally.
- Prefer README-level deferred-surface notes over source-code comments. Add code comments only when a dormant code path would otherwise mislead future work.
- Default to local-only setup when the user does not need deployment yet. Local development must not require DigitalOcean or Yandex Cloud credentials.
- If deployment is requested, make the cloud choice explicit. Use DigitalOcean as the international/default option and Yandex Cloud when the audience is in Russia or the user chooses it.
- Explain manual prerequisites only for the chosen path: provider account, billing/project/folder setup, `doctl auth init` or `yc init`, registry access, managed PostgreSQL or compatible database, Expo/EAS/App Store/Google Play accounts when mobile release work is requested.
- The agent may create uncommitted local `.env` files from `.env.example` and generate a local-only `JWT_SECRET`; never commit secrets or print raw secrets in the final report.
- After setup, run the smallest meaningful validation for the chosen active surfaces and report local URLs, commands run, and anything the user still needs to authorize manually.

## What's Inside

- `backend` - Bun + Hono + Prisma + PostgreSQL, custom JWT auth, Zod validation, and OpenAPI output.
- `web` - React + Vite + TanStack Query/Form/Router with the baseline browser auth flow.
- `landing` - a separate Astro project for a static landing page.
- `mobile` - Expo + React Native + Expo Router + TanStack Query/Form with SecureStore-backed auth.
- `packages/contracts` - shared Zod schemas and TypeScript API types.
- `docker-compose.yml` - local PostgreSQL on port `54329`; test runners use a repository-derived port by default, or `POSTGRES_TEST_PORT` when set.
- `docs/TESTING.md` - the backend, Playwright, and Maestro testing contract.

## Quick Start

```bash
bun install
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run --cwd backend prisma:migrate
bun run dev:backend
bun run dev:web
bun run dev:landing
bun run dev:mobile
```

Create `web/.env` when the browser client should use a non-default API URL:

```bash
VITE_API_URL=http://localhost:3000
```

Create `mobile/.env` for Expo:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Android emulators usually need `http://10.0.2.2:3000` instead of `localhost`.

## Workspace Commands

- `bun run dev` - start all workspace projects in parallel dev mode.
- `bun run dev:backend` - start the backend API.
- `bun run dev:web` - start the Vite web app.
- `bun run dev:landing` - start the Astro landing project.
- `bun run dev:mobile` - start the Expo app.
- `bun run typecheck` - run TypeScript checks across workspaces.
- `bun run build` - run production build/typecheck/export scripts for workspaces that define them.
- `bun run test` - run contract, backend, web, and mobile unit/integration tests.
- `bun run test:contracts` - run shared Zod contract tests.
- `bun run test:backend` - run backend unit and integration tests.
- `bun run test:backend:integration` - run DB-backed auth tests through `postgres_test`.
- `bun run test:web` - run web client tests.
- `bun run test:mobile` - run mobile client tests.
- `bun run e2e:web` - run the Playwright auth smoke test through backend + Vite.
- `bun run e2e:mobile` - run the Maestro auth smoke test against an installed mobile build.
- `bun run --cwd backend prisma:migrate` - create/apply a Prisma migration in development.
- `bun run --cwd backend prisma:deploy` - apply existing Prisma migrations on a server.

## Project READMEs

- [backend/README.md](backend/README.md) - API, auth, Prisma, and backend validation.
- [web/README.md](web/README.md) - browser client setup, env, and Playwright smoke.
- [mobile/README.md](mobile/README.md) - Expo setup, development builds, and Maestro smoke.
- [landing/README.md](landing/README.md) - Astro landing commands and publishing model.
- [packages/contracts/README.md](packages/contracts/README.md) - shared schema and DTO rules.

## Architecture Notes

API contracts live in `packages/contracts` and are imported by every layer. The backend validates input with those Zod schemas; web and mobile reuse the same schemas in TanStack Form and API clients.

The backend flow is `route -> validation -> auth/session guard -> service -> Prisma -> DTO`. Routes stay thin, auth business logic lives in the feature service, and `src/index.ts` only starts the Bun server.

Durable repository context lives in [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Current Upstream Documentation

For framework, API, deployment, or testing questions, consult the current upstream documentation linked here first. The repository docs describe this template's conventions; the linked docs are the authoritative source for tool behavior and provider-specific changes.

- Runtime and package manager: [Bun docs](https://bun.sh/docs)
- Backend framework: [Hono docs](https://hono.dev/docs)
- Database ORM: [Prisma docs](https://www.prisma.io/docs) and [PostgreSQL docs](https://www.postgresql.org/docs/)
- Validation and contracts: [Zod docs](https://zod.dev/)
- JWT library: [jose documentation](https://github.com/panva/jose)
- Web stack: [React docs](https://react.dev/reference/react), [Vite guide](https://vite.dev/guide/), [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview), [TanStack Form](https://tanstack.com/form/latest/docs/framework/react/quick-start), and [TanStack Router](https://tanstack.com/router/latest/docs/overview)
- Testing: [Playwright docs](https://playwright.dev/docs/intro) and [Maestro docs](https://docs.maestro.dev/)
- Mobile: [Expo docs](https://docs.expo.dev/), [Expo Router docs](https://docs.expo.dev/router/introduction/), [EAS Build docs](https://docs.expo.dev/build/introduction/), and [React Native docs](https://reactnative.dev/docs/getting-started)
- Landing: [Astro docs](https://docs.astro.build/en/getting-started/)
- Local infrastructure: [Docker Compose docs](https://docs.docker.com/compose/)
- Deployment providers: [DigitalOcean App Platform](https://docs.digitalocean.com/products/app-platform/), [doctl](https://docs.digitalocean.com/reference/doctl/), [DigitalOcean Container Registry](https://docs.digitalocean.com/products/container-registry/), [Yandex Cloud CLI](https://yandex.cloud/en/docs/cli/), [Yandex Serverless Containers](https://yandex.cloud/en/docs/serverless-containers/), and [Yandex Container Registry](https://yandex.cloud/en/docs/container-registry/)
