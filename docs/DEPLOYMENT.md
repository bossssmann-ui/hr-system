# Deployment Guide — career.pacificstar.ru

Production stack: single RF VPS (Ubuntu 24.04) · Docker Compose · Caddy (auto-HTTPS) · PostgreSQL 18 · Bun/Hono backend · React SPA frontend.

All data stays on the RF server — compliant with 152-ФЗ.

---

## Prerequisites

| Requirement | Check |
|---|---|
| Docker Engine installed | `docker --version` |
| Git installed | `git --version` |
| DNS A-record `career.pacificstar.ru → 186.246.6.171` | `dig career.pacificstar.ru` |
| Ports **80** and **443** open in VPS firewall | Required for Caddy / Let's Encrypt |

Install Docker if missing:
```bash
curl -fsSL https://get.docker.com | sh
```

---

## First Deploy

### 1. Clone the repository
```bash
git clone https://github.com/bossssmann-ui/hr-system.git /opt/hr-system
cd /opt/hr-system
```

### 2. Create `.env.prod` from the example
```bash
cp .env.prod.example .env.prod
nano .env.prod   # fill in every placeholder — see comments in the file
```

Key values to change:
- `POSTGRES_PASSWORD` — strong random password
- `JWT_SECRET` — at least 32 random chars (`openssl rand -base64 48`)
- `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD` — your first admin account
- `CORS_ORIGINS` — must be `https://career.pacificstar.ru`
- `COOKIE_SECURE=true`

### 3. Run the deploy script
```bash
bash scripts/deploy.sh
```

The script will:
1. Pull latest code
2. Build all Docker images
3. Apply pending Prisma migrations
4. Seed the bootstrap owner (idempotent — safe to re-run)
5. Start all services with `docker compose up -d` (including `backend`, `worker`, and `cron`)

### 4. Verify the stack
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs caddy
```

Open **https://career.pacificstar.ru** — Caddy automatically provisions a Let's Encrypt certificate on first request (takes ~10 seconds).

---

## Subsequent Deploys

Every deploy is one command from the repo root on the server:
```bash
bash scripts/deploy.sh
```

---

## Viewing Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Single service
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml logs -f cron
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f postgres
```

---

## Background Processing in Production

`docker-compose.prod.yml` runs two dedicated background services:

- `worker` — continuous durable queue drain (`backend/src/worker.ts`).
- `cron` — in-container scheduler that runs `backend/src/cron.ts <task>` on defaults below.

Default cron schedules (UTC, configurable via `.env.prod`):

- `analytics.snapshot` — `CRON_ANALYTICS_SNAPSHOT_SCHEDULE` (daily)
- `probation.reminder` — `CRON_PROBATION_REMINDER_SCHEDULE` (daily)
- `1on1.reminder` — `CRON_ONE_ON_ONE_REMINDER_SCHEDULE` (daily)
- `review.reminder` — `CRON_REVIEW_REMINDER_SCHEDULE` (daily)
- `data.retention` — `CRON_DATA_RETENTION_SCHEDULE` (daily)
- `signals.compute` — `CRON_SIGNALS_COMPUTE_SCHEDULE` (daily)
- `selection.retention_outcomes` — `CRON_SELECTION_RETENTION_OUTCOMES_SCHEDULE` (daily)
- `selection.retention_calibration` — `CRON_SELECTION_RETENTION_CALIBRATION_SCHEDULE` (weekly)
- `okr.quarter_start` — `CRON_OKR_QUARTER_START_SCHEDULE` (quarterly)
- `hh.sourcing` — `CRON_HH_SOURCING_SCHEDULE` (daily, no-op when integration flag is off)

`queue.drain` is not scheduled by cron because it is handled by the dedicated `worker` service.

---

## Enabling Feature Flags

All integrations default to `false`. Enable them once you have the keys:

1. Edit `.env.prod`:
   ```bash
   nano .env.prod
   # e.g. set HH_INTEGRATION_ENABLED=true and fill HH_CLIENT_ID/SECRET/HH_TOKEN_ENCRYPTION_KEY
   ```

2. Restart the affected service (no rebuild needed for env-only changes):
   ```bash
   docker compose -f docker-compose.prod.yml up -d backend worker cron
   ```

---

## Database Backup

Add this line to the VPS crontab (`crontab -e`) for daily backups at 02:00:
```cron
0 2 * * * docker compose -f /opt/hr-system/docker-compose.prod.yml exec -T postgres pg_dump -U hr_user hr_system | gzip > /opt/hr-system/backups/hr_system_$(date +\%Y\%m\%d).sql.gz
```

Create the backups directory first:
```bash
mkdir -p /opt/hr-system/backups
```

---

## Rollback

To roll back to a previous Git commit:
```bash
git checkout <commit-hash>
bash scripts/deploy.sh
```

---

## Services Architecture

```
Internet
   │
   ▼
Caddy :443 (auto-HTTPS, Let's Encrypt)
   ├── /api/*  ──► backend:3000 (Bun/Hono)
   │                    │
   │                    ▼
   │               postgres:5432 (internal only)
   │
   └── /*      ──► web:80 (nginx, React SPA)
```

All services communicate on the `internal` Docker bridge network. Only Caddy exposes ports to the host.
