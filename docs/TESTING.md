# Testing

The goal of this template's tests is to show future agents where behavior should be verified and where E2E should stay intentionally small.

## Pyramid

- Contracts/unit: shared Zod schema matrices, env parsing, JWTs, password hashing, client API refresh/retry behavior, and token cleanup.
- Backend integration: refresh-token rotation, auth guards, duplicate registration, concurrency, and stable error shapes through real routes and PostgreSQL.
- Web Playwright: short happy-path E2E through a real backend and Vite UI.
- Mobile Maestro: short happy-path smoke flows against an installed Expo development build.

Negative validation matrices, edge cases, and pure rules belong in unit/integration tests. Client E2E should cover the main user journeys: perform a real API flow, interact with the UI, and observe a stable end state.

## Backend

```bash
bun run test
bun run test:contracts
bun run test:backend
bun run test:backend:integration
bun run test:web
bun run test:mobile
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/web_app_demo?schema=public" bun run --cwd backend prisma:validate
bun run smoke:backend:docker
```

Contract tests live in `packages/contracts/src/*.test.ts` and protect shared request/response/error schemas used by backend, web, and mobile. Web and mobile unit tests live in each client `tests/` directory and cover API refresh/retry behavior that would be too expensive and brittle to fully exercise in E2E.

Backend tests live next to backend code and verify auth behavior through services and routes. The integration runner starts `postgres_test`, applies migrations, and runs register/login/refresh/logout/guard/error-shape scenarios. By default, the test database port is derived from the absolute repository path so parallel checkouts do not collide. Set `POSTGRES_TEST_PORT` when a fixed port is required.

The Docker smoke test builds the backend image, starts it against `postgres_test`, waits for `/health`, and removes only the smoke container it created.

`.github/workflows/ci.yml` runs typecheck, contract tests, web client tests, mobile client tests, backend tests, and the web Playwright smoke flow on pushes to `main` and pull requests.

## Web E2E

Playwright is configured in `web/playwright.config.ts`.

```bash
bun run --cwd web e2e:install
bun run e2e:web
```

The web E2E flow:

- starts `docker compose up -d postgres_test` unless `E2E_SKIP_DOCKER=1` is set;
- generates the Prisma client and applies migrations;
- starts the backend on `E2E_BACKEND_PORT`, which defaults to a repository-derived port;
- starts Vite on `E2E_WEB_PORT`, which defaults to a repository-derived port;
- runs the auth smoke path: register -> cookie refresh after reload -> protected route -> logout.

Useful env:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:<test-port>/web_app_demo_test?schema=public"
E2E_BACKEND_PORT=<backend-port>
E2E_WEB_PORT=<web-port>
E2E_SKIP_DOCKER=1
```

By default, Playwright computes `POSTGRES_TEST_PORT` from the absolute repository path and refuses to run against a database that does not use the `_test` suffix. This prevents E2E from accidentally writing to development or production data.

Playwright artifacts live in `web/e2e/.artifacts/` and are not committed. For interactive debugging:

```bash
bun run --cwd web e2e:ui
```

## Mobile Maestro E2E

The Maestro flow is `mobile/.maestro/flows/auth-smoke.yaml`; the runner is `mobile/scripts/e2e/run-maestro.mjs`.

Install the CLI:

```bash
bun run --cwd mobile e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version
```

Prerequisites:

- Java 17+.
- Xcode/iOS Simulator for iOS, or Android Studio/emulator for Android.
- An installed Expo development build with `bundleIdentifier/package` set to `com.webappdemo.mobile`.
- A backend reachable at the `EXPO_PUBLIC_API_URL` used when the bundle was built or started.
- A host-reachable `E2E_API_HEALTH_URL` for runner preflight, for example `http://127.0.0.1:3000/health`.

Development build examples:

```bash
cd mobile
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 bunx eas-cli build --profile development --platform ios
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 bunx eas-cli build --profile development --platform android
```

Run the smoke flow:

```bash
bun run --cwd mobile e2e:maestro
```

Useful env:

```bash
MAESTRO_DEVICE="iPhone 16 Pro"
MAESTRO_APP_ID=com.webappdemo.mobile
E2E_DISPLAY_NAME="Mobile E2E User"
E2E_EMAIL="mobile-e2e@example.com"
E2E_PASSWORD=password123
E2E_API_HEALTH_URL=http://127.0.0.1:3000/health
```

Mobile E2E uses `testID` selectors from `mobile/src/constants/testIds.ts`. New flows should add stable selectors in UI instead of relying on fragile coordinates. Text selectors are acceptable for final user-visible messages. The auth smoke checks register, session restore after app relaunch, and logout.

## Current Upstream Documentation

For testing questions, consult the current upstream documentation linked here first. This document describes this repository's testing contract; upstream docs are authoritative for runner behavior.

- Playwright intro: https://playwright.dev/docs/intro
- Playwright `webServer`: https://playwright.dev/docs/test-webserver
- Playwright `baseURL`, traces, screenshots, and video: https://playwright.dev/docs/test-use-options
- Playwright CLI and browser install: https://playwright.dev/docs/test-cli and https://playwright.dev/docs/browsers
- Maestro docs: https://docs.maestro.dev/
- Maestro CLI install/run: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli and https://docs.maestro.dev/maestro-cli/run-your-first-test-with-the-maestro-cli
- Maestro selectors and launch reset: https://docs.maestro.dev/api-reference/selectors and https://docs.maestro.dev/reference/commands-available/launchapp
- Docker Compose: https://docs.docker.com/compose/
