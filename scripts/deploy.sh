#!/usr/bin/env bash
# scripts/deploy.sh — idempotent production deploy for career.pacificstar.ru
# Run from the repo root on the VPS: bash scripts/deploy.sh
set -euo pipefail

COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"

echo "▶ [1/5] Pulling latest code..."
git pull

echo "▶ [2/5] Building images..."
$COMPOSE build

echo "▶ [3/5] Applying database migrations..."
$COMPOSE run --rm backend bun run --cwd backend prisma:deploy

echo "▶ [4/5] Seeding bootstrap owner (idempotent)..."
$COMPOSE run --rm backend bun run --cwd backend prisma:seed

echo "▶ [5/5] Starting services..."
$COMPOSE up -d

echo ""
echo "✅ Deploy complete. Stack status:"
$COMPOSE ps
