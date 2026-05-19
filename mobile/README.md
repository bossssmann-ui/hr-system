# Mobile

The mobile app is built with Expo and React Native. It provides the baseline auth flow using the same API contracts as web.

## Project Surface Status

**Deferred surface (Phase 0).** Mobile work is intentionally paused for the HR-System project. Do not run Expo/EAS setup, do not add features here, and do not configure Maestro flows until this surface is reactivated by the product owner. The directory is kept intact so the template structure remains valid for future work. When mobile is activated, remove this note before starting any React Native work. See `docs/contracts/00-overview.md` for the active/deferred surface table.

## Current App Shape

- `/` is the register/login screen and intentionally has no tabs.
- Authenticated users land on `/components`, which lives in the bottom tab shell with `/profile`.
- `/details/[id]` is a stack screen outside the tabs and uses an in-screen back button at the top left.
- App screens should use `src/components/screen.tsx` for safe-area handling, standard spacing, scroll/non-scroll layout, keyboard avoidance, and consistent optional back navigation.

## Stack

- Expo SDK 55
- React Native
- TypeScript
- Expo Router
- TanStack Query
- TanStack Form
- Expo SecureStore
- Zod contracts from `@web-app-demo/contracts`
- Native ShadCN-style UI primitives in `src/components/ui`
- Maestro E2E smoke flow

## Commands

```bash
bun run dev
bun run android
bun run ios
bun run web
bun run typecheck
bun run lint
bun run build
bun run e2e:maestro
```

From the repository root, use `bun run dev:mobile`, `bun run build:mobile`, `bun run typecheck:mobile`, and `bun run e2e:mobile`.

## Env

Create `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Use this value on Android emulators:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

For Maestro E2E against Expo dev client, prefer a LAN-reachable API URL and set `EXPO_PUBLIC_E2E=1` only for the E2E Metro session:

```bash
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000
EXPO_PUBLIC_E2E=1
```

`EXPO_PUBLIC_*` variables are included in the client bundle, so never put secrets there.

## Development Build

1. Sign up or log in to an Expo account.
2. Check EAS CLI availability with `bunx eas-cli --version`.
3. Log in with `bunx eas-cli login`.
4. Link the project with `bunx eas-cli project:init`.
5. Build a development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

`expo-dev-client` is already installed. Native `ios` and `android` folders are not stored in this template; Expo prebuild/development build workflows generate them when needed.

## Maestro E2E

The Maestro smoke flow verifies `register -> current user -> logout` against an installed Expo development build. It is designed for Expo dev client, not Expo Go. Run it against a backend that is using Docker Compose `postgres_test`, not the development database.

Start the backend test database and API in a separate terminal:

```bash
docker compose version
docker info
docker compose up -d postgres_test
export TEST_DATABASE_URL="postgresql://superuser:superpassword@localhost:54330/web_app_demo_test?schema=public"
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
DATABASE_URL="$TEST_DATABASE_URL" bun run --cwd backend prisma:deploy
PORT="$BACKEND_PORT" DATABASE_URL="$TEST_DATABASE_URL" JWT_SECRET="mobile-e2e-secret-at-least-thirty-two-characters" CORS_ORIGINS="http://$LAN_IP:$METRO_PORT,http://localhost:$METRO_PORT" COOKIE_SECURE=false bun run --cwd backend start:raw
```

Start Metro for the installed dev build in another terminal:

```bash
export LAN_IP=<your-machine-lan-ip>
export BACKEND_PORT=3000
export METRO_PORT=8081
EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://$LAN_IP:$BACKEND_PORT" bunx expo start --dev-client --host lan --port "$METRO_PORT"
```

```bash
bun run e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
EXPO_PUBLIC_E2E=1 MAESTRO_DEV_SERVER_URL=http://<LAN_IP>:8081 E2E_API_HEALTH_URL=http://<LAN_IP>:3000/health bun run e2e:maestro
```

Run the local policy audit after changing Maestro flows or runner inputs:

```bash
bun run e2e:maestro:audit
```

Before running the flow, the backend must be reachable at the `EXPO_PUBLIC_API_URL` used when Metro serves the mobile bundle, and Metro must be reachable at `MAESTRO_DEV_SERVER_URL`. The runner opens `exp+mobile://expo-development-client/?url=<metro-url>` after state reset and after app relaunch so Maestro lands in the app bundle instead of the Expo launcher or simulator home screen. If you rename the Expo slug, set `MAESTRO_DEV_CLIENT_SCHEME=exp+<slug>`.

Stable selectors live in `src/constants/testIds.ts`, the flow is `.maestro/flows/auth-smoke.yaml`, and the runner is `scripts/e2e/run-maestro.mjs`. Detailed runbook: [../docs/TESTING.md](../docs/TESTING.md).

## Practice

Use TanStack Query for server state, TanStack Form for forms, and shared Zod schemas for validation. The refresh token is stored in `expo-secure-store` on native platforms; the access token lives only in app memory.

Keep API URL handling, auth headers, refresh/retry, and error parsing centralized in the API client. Add stable `testID` constants for interactive controls that E2E needs to touch.

Mobile UI primitives live in `src/components/ui` and mirror the local Web ShadCN registry by file name. They are React Native-first implementations using native style props, controlled/uncontrolled values, and native touch patterns instead of DOM/Radix props such as `className` or `asChild`. The protected `/components` route is the local component catalog and the post-auth smoke surface.

Render visible text through `src/components/ui/typography.tsx`. `Typography` owns the mobile type scale from `h1` through `h6` plus body, caption, label, button, link, and code text variants; screens and UI primitives should not import React Native `Text` directly or use legacy text wrappers.

## Current Upstream Documentation

For Expo, React Native, routing, secure storage, EAS, forms, server-state, or E2E questions, consult the current upstream documentation linked here first. This README describes this app's conventions; upstream docs are authoritative for platform behavior.

- [Expo docs](https://docs.expo.dev/)
- [Expo SDK 55 docs](https://docs.expo.dev/versions/latest/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
- [Expo SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo EAS docs](https://docs.expo.dev/eas/)
- [EAS Build docs](https://docs.expo.dev/build/introduction/)
- [React Native docs](https://reactnative.dev/docs/getting-started)
- [TanStack Query React docs](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Form React docs](https://tanstack.com/form/latest/docs/framework/react/quick-start)
- [Zod docs](https://zod.dev/)
- [Maestro docs](https://docs.maestro.dev/)
