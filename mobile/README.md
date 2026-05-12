# Mobile

The mobile app is built with Expo and React Native. It provides the baseline auth flow using the same API contracts as web.

## Project Surface Status

This section may be updated during first-run bootstrap. If `AGENTS.md` marks mobile as deferred, add a short note here explaining that mobile work is intentionally paused. When the user activates mobile, remove or rewrite that note before starting Expo or React Native development.

## Stack

- Expo SDK 55
- React Native
- TypeScript
- Expo Router
- TanStack Query
- TanStack Form
- Expo SecureStore
- Zod contracts from `@web-app-demo/contracts`
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

The Maestro smoke flow verifies `register -> current user -> logout` against an installed development build.

```bash
bun run e2e:maestro:setup
export PATH="$HOME/.maestro/bin:$PATH"
bun run e2e:maestro
```

Before running the flow, the backend must be reachable at the `EXPO_PUBLIC_API_URL` used when the mobile bundle was built or started. For iOS Simulator, `http://127.0.0.1:3000` is usually valid. For Android Emulator, use `http://10.0.2.2:3000`.

Stable selectors live in `src/constants/testIds.ts`, the flow is `.maestro/flows/auth-smoke.yaml`, and the runner is `scripts/e2e/run-maestro.mjs`. Detailed runbook: [../docs/TESTING.md](../docs/TESTING.md).

## Practice

Use TanStack Query for server state, TanStack Form for forms, and shared Zod schemas for validation. The refresh token is stored in `expo-secure-store` on native platforms; the access token lives only in app memory.

Keep API URL handling, auth headers, refresh/retry, and error parsing centralized in the API client. Add stable `testID` constants for interactive controls that E2E needs to touch.

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
