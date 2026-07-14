#!/usr/bin/env sh
set -eu

TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: $0 <cron-task-name>" >&2
  exit 64
fi

APP_DIR="${APP_DIR:-/opt/hr-system}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.prod}"
LOG_DIR="${LOG_DIR:-$APP_DIR/logs/cron}"
LOCK_DIR="${LOCK_DIR:-/tmp/hr-system-cron-locks}"

mkdir -p "$LOG_DIR" "$LOCK_DIR"

LOG_FILE="$LOG_DIR/$TASK.log"
LOCK_FILE="$LOCK_DIR/$TASK.lock"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

(
  if ! flock -n 9; then
    echo "$STARTED_AT task=$TASK status=skipped reason=already_running" >> "$LOG_FILE"
    exit 0
  fi

  echo "$STARTED_AT task=$TASK status=started" >> "$LOG_FILE"
  cd "$APP_DIR"
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm backend bun run --cwd backend start:cron -- "$TASK" >> "$LOG_FILE" 2>&1; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) task=$TASK status=succeeded" >> "$LOG_FILE"
  else
    code=$?
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) task=$TASK status=failed exit_code=$code" >> "$LOG_FILE"
    exit "$code"
  fi
) 9>"$LOCK_FILE"
