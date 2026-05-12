# Backend

The backend owns the API, authentication, integrations, persistence, and server-side business logic. Web and mobile clients rely on the shared data contract in `packages/contracts`.

## Stack

- Bun
- Hono
- Prisma 7
- PostgreSQL
- Zod
- jose JWT
- TypeScript

## Commands

```bash
docker compose up -d postgres
cp backend/.env.example backend/.env
bun run dev
bun run typecheck
bun run test
bun run test:unit
bun run test:integration
bun run smoke:docker
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/web_app_demo?schema=public" bun run prisma:validate
bun run prisma:generate
bun run prisma:migrate
bun run prisma:deploy
```

From the repository root, use `bun run dev:backend`, `bun run build:backend`, `bun run typecheck:backend`, and `bun run test:backend`.

`bun run test:integration` starts `postgres_test` from `../docker-compose.yml`, applies Prisma migrations to `web_app_demo_test`, and runs DB-backed auth API tests. If Docker is managed separately, set `TEST_SKIP_DOCKER=1` and `TEST_DATABASE_URL`.

`bun run smoke:docker` builds the backend Docker image, starts it against `postgres_test`, waits for `/health`, and removes only the smoke container it created.

## Env

Copy `backend/.env.example` to `backend/.env` for local development. `JWT_SECRET` must be at least 32 characters. `COOKIE_SECURE=false` is appropriate for local HTTP; production should use `COOKIE_SECURE=true` with HTTPS origins in `CORS_ORIGINS`.

## Auth API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /openapi.json`
- `GET /health`

Passwords are hashed through `Bun.password` with Argon2id. Access tokens are short-lived JWTs through `jose`. Refresh tokens are opaque random tokens; only a SHA-256 hash is stored in the database. Refresh rotates the token and revokes the previous session.

## Architecture

`src/index.ts` only loads env, creates the Prisma client, and starts the Bun server. The Hono app is created in `src/app.ts`. The auth feature lives in `src/auth`: routes validate and delegate, the service owns session/user logic, and token helpers isolate JWT and refresh-token mechanics.

Prisma migration SQL is not written by hand. Change `prisma/schema.prisma`, then run `bun run prisma:migrate`.

## Current Upstream Documentation

For backend framework, ORM, auth, validation, and runtime questions, consult the current upstream documentation linked here first. This README describes this backend's conventions; upstream docs are authoritative for API behavior.

- [Bun docs](https://bun.sh/docs)
- [Hono docs](https://hono.dev/docs)
- [Hono Zod OpenAPI example](https://hono.dev/examples/zod-openapi)
- [Prisma docs](https://www.prisma.io/docs)
- [Prisma migrations](https://www.prisma.io/docs/orm/prisma-migrate)
- [PostgreSQL docs](https://www.postgresql.org/docs/)
- [Zod docs](https://zod.dev/)
- [jose documentation](https://github.com/panva/jose)
- [Docker Compose docs](https://docs.docker.com/compose/)
