# Landing

The landing workspace is a separate Astro project for static marketing or informational pages. It should stay independent from the authenticated browser app unless a product need explicitly requires shared API data.

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
