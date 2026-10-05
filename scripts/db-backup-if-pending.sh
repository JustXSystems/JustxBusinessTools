#!/usr/bin/env bash
# Backs up MySQL before a release can change the schema. Run by vps-release.sh and vps-deploy.sh
# before migrations and before PM2 starts the new API (which also applies pending migrations on boot).
#
# Usage: db-backup-if-pending.sh <app-root>
#   <app-root> must have server/.env (or a symlink to it) and installed server deps.
#
# Env:
#   ENV_FILE      env file for backup-jbt.sh (default <app-root>/server/.env)
#   BACKUP_FORCE  true → always back up (MySQL + uploads), even with nothing pending
#   BACKUP_TAG    passed to backup-jbt.sh, e.g. pre-migrate-<release>
#
# Pending migrations → verified MySQL backup. Can't tell (DB unreachable, script error) → back up anyway.
# Exits non-zero if a needed backup fails, so the caller stops before touching the schema.
set -euo pipefail

APP_ROOT="${1:?usage: db-backup-if-pending.sh <app-root>}"
APP_ROOT="$(cd "$APP_ROOT" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$APP_ROOT/server/.env}"
BACKUP_FORCE="${BACKUP_FORCE:-false}"
BACKUP_TAG="${BACKUP_TAG:-}"

echo "==> Checking for pending DB migrations"
PENDING=""
if CHECK_OUT="$(cd "$APP_ROOT" && npm run -s db:migrate:pending -w server 2>&1)"; then
  printf '%s\n' "$CHECK_OUT" | grep -E '^pending: ' | sed 's/^/    /' || true
  PENDING="$(printf '%s\n' "$CHECK_OUT" | awk -F= '/^PENDING_MIGRATIONS=/{print $2; exit}')"
fi

if [[ ! "$PENDING" =~ ^[0-9]+$ ]]; then
  echo "    WARN: couldn't check pending migrations — backing up to be safe" >&2
  printf '%s\n' "${CHECK_OUT:-}" | tail -n 5 | sed 's/^/    /' >&2
  PENDING="unknown"
fi
echo "    pending migrations: $PENDING"

if [[ "$BACKUP_FORCE" == "true" ]]; then
  SCOPE="all"
  echo "==> DB backup (requested: MySQL + uploads)"
elif [[ "$PENDING" != "0" ]]; then
  SCOPE="db"
  echo "==> DB backup before migrations (MySQL only)"
else
  echo "==> No pending migrations — skipping pre-migration backup"
  exit 0
fi

if ! ENV_FILE="$ENV_FILE" BACKUP_SCOPE="$SCOPE" BACKUP_TAG="$BACKUP_TAG" bash "$HERE/backup-jbt.sh"; then
  echo "ERROR: DB backup failed — not applying migrations" >&2
  exit 1
fi
