#!/usr/bin/env bash
# MySQL + local uploads backup for JustX Business Tools (run on the VPS).
# Example cron (daily 02:15 IST ≈ 20:45 UTC previous day — adjust TZ):
#   15 2 * * * /var/www/jbt/scripts/backup-jbt.sh >> /home/deploy/backups/backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/server/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DATE="$(date +%Y%m%d_%H%M)"

mkdir -p "$BACKUP_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# Only load simple KEY=VALUE lines (ignore comments / exports)
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    export "$line"
  fi
done < "$ENV_FILE"
set +a

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:?DB_USER required}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD required}"
DB_NAME="${DB_NAME:?DB_NAME required}"

UPLOAD_DIR_RAW="${UPLOAD_DIR:-./uploads}"
if [[ "$UPLOAD_DIR_RAW" = /* ]]; then
  UPLOAD_DIR="$UPLOAD_DIR_RAW"
else
  UPLOAD_DIR="$ROOT/server/${UPLOAD_DIR_RAW#./}"
fi

SQL_OUT="$BACKUP_ROOT/justx_systems_${DATE}.sql.gz"
echo "==> Dumping MySQL $DB_NAME → $SQL_OUT"
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --routines --triggers \
  "$DB_NAME" | gzip -c > "$SQL_OUT"

if [[ -d "$UPLOAD_DIR" ]]; then
  UP_OUT="$BACKUP_ROOT/jbt_uploads_${DATE}.tgz"
  echo "==> Archiving uploads $UPLOAD_DIR → $UP_OUT"
  tar -czf "$UP_OUT" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
else
  echo "==> Skip uploads (not found: $UPLOAD_DIR)"
fi

echo "==> Pruning backups older than ${RETENTION_DAYS}d in $BACKUP_ROOT"
find "$BACKUP_ROOT" -type f \( -name 'justx_systems_*.sql.gz' -o -name 'jbt_uploads_*.tgz' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "==> Backup OK"
ls -lh "$BACKUP_ROOT"/justx_systems_"${DATE}"* "$BACKUP_ROOT"/jbt_uploads_"${DATE}"* 2>/dev/null || true
