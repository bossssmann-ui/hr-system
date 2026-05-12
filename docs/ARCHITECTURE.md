# Architecture

This repository defines a golden path for web/mobile products: shared contracts, one backend, two app clients, a static landing project, and little custom infrastructure.

## Contracts

`packages/contracts` is the source of truth for API payloads, DTOs, and error shapes. New endpoints should start with Zod schemas in contracts. The backend then uses those schemas for request validation, while web and mobile use them in TanStack Form and API clients.

Do not hand-copy API shapes into clients. When a contract changes, validate producer and consumers in one pass: backend route/service, web API client/form, and mobile API client/form.

## Backend

Backend code follows this flow:

```text
Hono route -> Zod validation -> auth/session guard -> feature service -> Prisma -> DTO
```

- `src/index.ts` is only the runtime entrypoint.
- `src/app.ts` owns the Hono app, CORS, secure headers, error handling, route mounting, and OpenAPI output.
- `src/env.ts` validates environment variables with Zod.
- `src/db.ts` creates the Prisma client.
- `src/auth/*` owns the auth feature: routes, service logic, JWT helpers, password hashing, and refresh-token hashing.

Routes should stay thin. Do not put business logic into Hono handlers, UI clients, or child components when the decision belongs in a backend service.

## Auth

Auth v1 is custom JWT-based auth:

- Passwords use `Bun.password.hash/verify` with Argon2id.
- Access tokens are short-lived JWTs signed and verified with `jose`.
- Refresh tokens are opaque random tokens; only their SHA-256 hash is stored in PostgreSQL.
- Web keeps the refresh token in an HttpOnly `SameSite=Lax` cookie and keeps the access token in memory.
- Mobile keeps the refresh token in `expo-secure-store` and keeps the access token in memory.

Refresh-token rotation creates a new session and revokes the previous one. `/api/auth/me` checks both the JWT and the active database session.

## Frontend

Web and mobile follow the same client rules:

- TanStack Query owns server state.
- TanStack Form owns form state.
- Zod schemas come from `@web-app-demo/contracts`.
- The API client centralizes base URL handling, auth headers, refresh/retry behavior, and error shape parsing.

Do not create a new form, query, auth, or API abstraction until the existing pattern stops solving the current problem.

`landing` is a separate Astro workspace for a static landing page. It does not own the auth flow and should not duplicate the browser client from `web`. If the landing project starts reading API data or shared DTOs, connect `@web-app-demo/contracts` and validate producer/consumer sides the same way as `web` and `mobile`.

## Testing

Backend unit/integration tests verify contracts and auth behavior at the owning layer. Web E2E uses Playwright and starts a real backend + Vite through `webServer`. Mobile E2E uses Maestro and stable React Native `testID` selectors.

Client E2E in this template is a happy-path smoke layer, not the place for large validation matrices. Keep negative payloads, password/JWT/session rules, and error-shape checks in backend tests. Add fast client-level tests for form validation and API state edge cases when those surfaces grow.

## Prisma

Do not hand-write Prisma migration SQL. Change `backend/prisma/schema.prisma`, then use:

```bash
bun run --cwd backend prisma:migrate
```

For production, apply already-created migrations:

```bash
bun run --cwd backend prisma:deploy
```

## Current Upstream Documentation

For framework and API questions, consult the current upstream documentation linked here first. This document describes repository conventions; upstream docs are authoritative for tool behavior.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [TanStack Router docs](https://tanstack.com/router/latest/docs/overview)
- [Expo docs](https://docs.expo.dev/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
