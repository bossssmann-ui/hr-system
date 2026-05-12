# Deployment

Use this document only after the user has chosen deployment. Read the `Project Focus` block in [AGENTS.md](../AGENTS.md) or [CLAUDE.md](../CLAUDE.md) first; it records the installed project's active surfaces, deferred surfaces, selected provider, and release scope. Local setup from `README.md` does not require DigitalOcean or Yandex Cloud credentials.

Choose the cloud provider based on the project's audience:

- International/default: DigitalOcean.
- Russia-focused audience: Yandex Cloud, because DigitalOcean may be unavailable without a VPN.

Do not store secrets in the repository. Minimum backend env:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
CORS_ORIGINS=https://web.example.com,https://mobile-preview.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=true
```

## DigitalOcean With doctl

1. Install `doctl`.
2. Create a DigitalOcean token and run:

```bash
doctl auth init
```

3. Create Managed PostgreSQL or provide another PostgreSQL-compatible database.
4. Build the backend image from the repository root:

```bash
docker build -f backend/Dockerfile -t registry.digitalocean.com/<registry>/web-app-demo-backend:latest .
```

5. Log in to the registry and push the image:

```bash
doctl registry login
docker push registry.digitalocean.com/<registry>/web-app-demo-backend:latest
```

6. Create an App Platform spec with a backend web service, `/health` health check, env variables, and a managed database connection. Generate a spec with `doctl apps spec create`, or prepare YAML that matches the current service shape and run `doctl apps create --spec <path-to-spec.yaml>`. If the app already exists, use `doctl apps update <app-id> --spec <path-to-spec.yaml>`.

7. Apply migrations in a protected one-off console/job:

```bash
bun run --cwd backend prisma:deploy
```

## Yandex Cloud With yc

1. Install the Yandex Cloud CLI.
2. Configure a profile:

```bash
yc init
```

3. Create a Container Registry and build the backend image:

```bash
docker build -f backend/Dockerfile -t cr.yandex/<registry-id>/web-app-demo-backend:latest .
docker push cr.yandex/<registry-id>/web-app-demo-backend:latest
```

4. Create a Serverless Container:

```bash
yc serverless container create --name web-app-demo-backend
```

5. Deploy a revision. The app reads its port from `PORT`; Yandex sets it automatically.

```bash
yc serverless container revision deploy \
  --container-name web-app-demo-backend \
  --image cr.yandex/<registry-id>/web-app-demo-backend:latest \
  --cores 1 \
  --memory 512MB \
  --execution-timeout 30s \
  --environment DATABASE_URL=<postgres-url>,JWT_SECRET=<secret>,CORS_ORIGINS=<origins>,COOKIE_SECURE=true
```

6. Connect PostgreSQL through Managed PostgreSQL, an external Postgres instance, or another compatible endpoint. After deployment, apply Prisma migrations through a protected one-off run with the same env:

```bash
bun run --cwd backend prisma:deploy
```

## Expo / EAS

1. Log in to an Expo account:

```bash
bunx eas-cli login
```

2. Link the project:

```bash
cd mobile
bunx eas-cli project:init
```

3. Configure the public API URL:

```bash
bunx eas-cli env:create --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production
```

4. Development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

5. Production build:

```bash
bunx eas-cli build --profile production --platform all
```

Apple App Store release work requires Apple Developer Program access. Google Play release work requires a Google Play Developer account.

## Current Upstream Documentation

For deployment questions, consult the current upstream documentation linked here first. This document captures the repository's deployment shape; provider docs are authoritative for CLI flags, product limits, pricing, and service behavior.

- DigitalOcean App Platform: https://docs.digitalocean.com/products/app-platform/
- DigitalOcean App specs: https://docs.digitalocean.com/products/app-platform/reference/app-spec/
- DigitalOcean deployment from container images: https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-container-images/
- DigitalOcean doctl CLI: https://docs.digitalocean.com/reference/doctl/
- DigitalOcean Container Registry: https://docs.digitalocean.com/products/container-registry/
- Yandex Cloud CLI: https://yandex.cloud/en/docs/cli/
- Yandex Serverless Containers: https://yandex.cloud/en/docs/serverless-containers/
- Yandex Container Registry: https://yandex.cloud/en/docs/container-registry/
- Yandex Managed PostgreSQL: https://yandex.cloud/en/docs/managed-postgresql/
- Docker Compose: https://docs.docker.com/compose/
- Prisma migrations: https://www.prisma.io/docs/orm/prisma-migrate
- Expo EAS: https://docs.expo.dev/eas/
- EAS Build: https://docs.expo.dev/build/introduction/
