# Local PostgreSQL

Use Docker Compose for local PostgreSQL on Windows, macOS, and Linux. Do not ask users to install PostgreSQL natively during first-run setup unless they explicitly choose to manage their own database.

This template currently uses the official `postgres:18-alpine` image. The major version is pinned to PostgreSQL 18 instead of `postgres:latest` so patch updates are easy while unexpected major upgrades do not break local volumes.

## Prerequisites

- Windows: Docker Desktop with the WSL 2 backend enabled.
- macOS: Docker Desktop or another Docker Engine with Compose v2.
- Linux: Docker Engine and the Docker Compose plugin.

Check that Compose is available:

```bash
docker compose version
```

Run commands from the repository root.

## Start Development Database

```bash
docker compose pull postgres
docker compose up -d postgres
docker compose ps postgres
docker compose exec postgres pg_isready -U postgres -d web_app_demo
```

The development database is:

```text
host: localhost
port: 54329
database: web_app_demo
user: postgres
password: postgres
DATABASE_URL: postgresql://postgres:postgres@localhost:54329/web_app_demo?schema=public
```

Create the backend env file:

```bash
# macOS, Linux, or Git Bash on Windows
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

Then apply Prisma migrations:

```bash
bun run --cwd backend prisma:migrate
```

## Optional Port Overrides

If `54329` is already in use, create a repository-root `.env` from `.env.example` and change `POSTGRES_PORT`:

```bash
# macOS, Linux, or Git Bash on Windows
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

After changing the port, update `backend/.env` so `DATABASE_URL` uses the same port.

## Test Database

`postgres_test` is reserved for integration, Docker smoke, and Playwright flows:

```bash
docker compose up -d postgres_test
```

Manual default connection:

```text
host: localhost
port: 54330
database: web_app_demo_test
user: postgres
password: postgres
DATABASE_URL: postgresql://postgres:postgres@localhost:54330/web_app_demo_test?schema=public
```

Automated test runners normally set a repository-derived `POSTGRES_TEST_PORT` so multiple template checkouts can run in parallel. Set `POSTGRES_TEST_PORT` only when a fixed test database port is required.

## Reset Local Data

Stop containers but keep local data:

```bash
docker compose down
```

Delete local PostgreSQL data only when you intentionally want a clean database:

```bash
docker compose down -v
```

PostgreSQL major upgrades are not automatic data migrations. If this template bumps from one PostgreSQL major version to another, either export/import the data manually or delete the local development volumes with `docker compose down -v` when the data is disposable.

## Current Upstream Documentation

- Docker Compose: https://docs.docker.com/compose/
- PostgreSQL Docker Official Image: https://hub.docker.com/_/postgres
- PostgreSQL docs: https://www.postgresql.org/docs/
