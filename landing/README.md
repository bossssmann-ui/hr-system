# Landing

The landing workspace is a separate Astro project for static marketing or informational pages. It should stay independent from the authenticated browser app unless a product need explicitly requires shared API data.

## Project Surface Status

**Deferred surface (Phase 0).** Marketing content for HR-System is intentionally paused. The directory is kept intact so the template structure remains valid; do not add pages or product copy here until this surface is reactivated by the product owner.

## Stack

- Astro
- TypeScript
- Vite through Astro

## Commands

From the repository root:

```bash
bun run dev:landing
bun run typecheck:landing
bun run build:landing
```

From `landing`:

```bash
bun run dev
bun run typecheck
bun run build
bun run preview
```

Astro publishes pages from `src/pages`. Static assets live in `public`.

## Deployment

Production deployment for the landing site uses DigitalOcean App Platform Static Sites from the full Git monorepo branch with `bun install --frozen-lockfile && bun run build:landing` and `landing/dist` by default. Generate the concrete spec with `bun run deploy:do:specs`; App Platform builds from Git, not from local `dist`. If landing links to the browser app, `PUBLIC_WEB_APP_URL` must be a concrete build-time URL and landing must be redeployed after it changes. Follow the shared runbook in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). If the user explicitly chooses Yandex Cloud, deploy the built `landing/dist` output through Yandex Object Storage static website hosting plus Cloud CDN by following [../docs/YANDEX_CLOUD.md](../docs/YANDEX_CLOUD.md).

## Practice

Keep landing-specific UI and content in this workspace. Do not duplicate authenticated browser-app flows from `web`. If the landing project starts reading API data or shared DTOs, add `@web-app-demo/contracts` intentionally and validate the producer/consumer path.

## Current Upstream Documentation

For Astro, routing, content, build, or deployment questions, consult the current upstream documentation linked here first. This README describes this workspace's conventions; upstream docs are authoritative for Astro behavior.

- [Astro docs](https://docs.astro.build/en/getting-started/)
- [Astro project structure](https://docs.astro.build/en/basics/project-structure/)
- [Astro pages and routing](https://docs.astro.build/en/basics/astro-pages/)
- [Astro deployment guides](https://docs.astro.build/en/guides/deploy/)
- [TypeScript docs](https://www.typescriptlang.org/docs/)
- [Vite guide](https://vite.dev/guide/)
