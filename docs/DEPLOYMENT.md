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

Production scripts call Docker Compose with `--env-file .env.prod`, so `.env.prod`
is the server-side source of truth for both container environment and Compose
variable interpolation.

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
5. Start all services with `docker compose up -d`

### 4. Verify the stack
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs caddy
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
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f

# Single service
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f caddy
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f postgres
```

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
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d backend
   ```

---

## Password Reset Email

Password reset links are sent through SMTP when email is enabled. Configure a real mailbox such as `noreply@pacificstar.ru` in `.env.prod`:

```bash
EMAIL_ENABLED=true
SMTP_HOST=<smtp host from the mail provider>
SMTP_PORT=587
SMTP_USER=noreply@pacificstar.ru
SMTP_PASS=<mailbox or SMTP app password>
SMTP_FROM=noreply@pacificstar.ru
```

After changing these values, restart the backend:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d backend
```

If `EMAIL_ENABLED=false` or SMTP is incomplete, password reset links are still created but written only to backend logs for administrator recovery.

---

## Database Backup

Add this line to the VPS crontab (`crontab -e`) for daily backups at 02:00:
```cron
0 2 * * * cd /opt/hr-system && docker compose --env-file /opt/hr-system/.env.prod -f /opt/hr-system/docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" hr_system' | gzip > /opt/hr-system/backups/hr_system_$(date +\%Y\%m\%d).sql.gz
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
