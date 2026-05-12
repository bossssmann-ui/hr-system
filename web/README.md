# Web

The browser client provides the baseline auth flow for future web features. It consumes the same API contracts as mobile and should keep server-state, form-state, and auth behavior centralized.

## Project Surface Status

This section may be updated during first-run bootstrap. If `AGENTS.md` marks web as deferred, add a short note here explaining that browser work is intentionally paused. When the user activates web, remove or rewrite that note before starting browser development.

## Stack

- React
- TypeScript
- Vite
- TanStack Query
- TanStack Form
- TanStack Router
- Zod contracts from `@web-app-demo/contracts`
- Playwright
- ESLint

## Commands

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
bun run test
bun run e2e
bun run e2e:ui
```

From the repository root, use `bun run dev:web`, `bun run build:web`, `bun run typecheck:web`, `bun run test:web`, and `bun run e2e:web`.

## Env

Create `web/.env` when needed:

```bash
VITE_API_URL=http://localhost:3000
```

## Practice

Use TanStack Query for server state, TanStack Form for forms, and shared Zod schemas from `packages/contracts` for validation. The access token lives only in browser memory; refresh uses the HttpOnly cookie set by the backend.

Keep the API client responsible for base URLs, auth headers, refresh/retry, and error parsing. Do not duplicate API shapes or auth state in page components.

## E2E

The Playwright smoke test lives in `e2e/specs/auth.spec.ts` and verifies `register -> refresh after reload -> protected UI -> logout`.

First run:

```bash
bun run e2e:install
bun run e2e
```

Detailed runbook: [../docs/TESTING.md](../docs/TESTING.md).

## Current Upstream Documentation

For browser framework, routing, forms, server-state, build, lint, or E2E questions, consult the current upstream documentation linked here first. This README describes this app's conventions; upstream docs are authoritative for library behavior.

- [React docs](https://react.dev/reference/react)
- [Vite guide](https://vite.dev/guide/)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Router docs](https://tanstack.com/router/latest/docs/overview)
- [Zod docs](https://zod.dev/)
- [Playwright docs](https://playwright.dev/docs/intro)
- [ESLint docs](https://eslint.org/docs/latest/)
