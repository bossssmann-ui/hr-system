#!/bin/sh
set -eu

task_name="${1:-}"

if [ -z "$task_name" ]; then
  echo "Cron task name is required"
  exit 1
fi

lock_suffix="$(printf '%s' "$task_name" | tr -c 'A-Za-z0-9_' '_')"
lock_hash="$(printf '%s' "$task_name" | cksum | awk '{print $1}')"
lock_root="/tmp/cron-task-locks"
mkdir -p "$lock_root"
chmod 700 "$lock_root"
lock_dir="${lock_root}/cron-task-${lock_suffix}-${lock_hash}.lock"

if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Cron task ${task_name} is already running; skipping overlapping run"
  exit 0
fi

cleanup() {
  rmdir "$lock_dir" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Cron task ${task_name} started"
cd /app
bun backend/src/cron.ts "$task_name"
echo "Cron task ${task_name} finished"
