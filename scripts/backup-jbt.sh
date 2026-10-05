#!/usr/bin/env bash
# MySQL + local uploads backup for JustX Business Tools (run on the VPS).
# Example cron (daily 02:15 IST ≈ 20:45 UTC previous day — adjust TZ):
#   15 2 * * * /var/www/jbt/scripts/backup-jbt.sh >> /home/deploy/backups/backup.log 2>&1
#
# Optional:
#   BACKUP_SCOPE   all (default: MySQL + uploads) | db (MySQL only — used before deploy migrations)
#   BACKUP_TAG     suffix for the file names, e.g. pre-migrate-<release> (letters, digits, . _ - only)
#
# Exits non-zero unless the dump finished and verified, so callers can stop before changing the schema.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/server/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_SCOPE="${BACKUP_SCOPE:-all}"
BACKUP_TAG="${BACKUP_TAG:-}"
DATE="$(date +%Y%m%d_%H%M%S)"

case "$BACKUP_SCOPE" in
  all|db) ;;
  *) echo "ERROR: invalid BACKUP_SCOPE='$BACKUP_SCOPE' (all|db)" >&2; exit 1 ;;
esac
if [[ -n "$BACKUP_TAG" ]]; then
  [[ "$BACKUP_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: invalid BACKUP_TAG='$BACKUP_TAG'" >&2; exit 1; }
  DATE="${DATE}_${BACKUP_TAG}"
fi
command -v mysqldump >/dev/null 2>&1 || { echo "ERROR: mysqldump not installed" >&2; exit 1; }

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
SQL_PART="${SQL_OUT}.part"
UP_OUT=""
trap 'rm -f "$SQL_PART"' EXIT
echo "==> Dumping MySQL $DB_NAME → $SQL_OUT"
# --no-tablespaces: justx_user typically lacks PROCESS (MySQL 8 tablespace dump error)
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --routines --triggers --no-tablespaces \
  "$DB_NAME" | gzip -c > "$SQL_PART"

# A dump cut short (disk full, lost connection) has no trailer line; never keep it as a backup.
echo "==> Verifying dump"
gzip -t "$SQL_PART" || { echo "ERROR: dump archive is corrupt" >&2; exit 1; }
gzip -dc "$SQL_PART" | tail -n 1 | grep -q -- "-- Dump completed" \
  || { echo "ERROR: dump is incomplete (no 'Dump completed' trailer)" >&2; exit 1; }
mv -f "$SQL_PART" "$SQL_OUT"
chmod 600 "$SQL_OUT" || true
echo "    OK $(du -h "$SQL_OUT" | cut -f1)"

if [[ "$BACKUP_SCOPE" == "db" ]]; then
  echo "==> Skip uploads (BACKUP_SCOPE=db)"
elif [[ -d "$UPLOAD_DIR" ]]; then
  UP_OUT="$BACKUP_ROOT/jbt_uploads_${DATE}.tgz"
  echo "==> Archiving uploads $UPLOAD_DIR → $UP_OUT"
  tar -czf "$UP_OUT" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
else
  echo "==> Skip uploads (not found: $UPLOAD_DIR)"
fi

echo "==> Pruning backups older than ${RETENTION_DAYS}d in $BACKUP_ROOT"
find "$BACKUP_ROOT" -type f \( -name 'justx_systems_*.sql.gz' -o -name 'jbt_uploads_*.tgz' \) \
  -mtime "+${RETENTION_DAYS}" -print -delete || true

# Optional off-box copy (rsync / scp / custom). Examples in docs/PRODUCTION_SUPPORT.md
# BACKUP_OFFBOX_CMD='rsync -avz %s backup@remote:/jbt/'
# BACKUP_OFFBOX_CMD='aws s3 cp %s s3://bucket/jbt-backups/'
if [[ -n "${BACKUP_OFFBOX_CMD:-}" ]]; then
  echo "==> Off-box copy via BACKUP_OFFBOX_CMD"
  for f in "$SQL_OUT" "$UP_OUT"; do
    [[ -n "$f" && -f "$f" ]] || continue
    # shellcheck disable=SC2059
    cmd="$(printf "$BACKUP_OFFBOX_CMD" "$f")"
    echo "    $cmd"
    eval "$cmd"
  done
elif [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
  echo "==> Off-box rsync → $BACKUP_RSYNC_TARGET"
  FILES=("$SQL_OUT")
  [[ -n "$UP_OUT" && -f "$UP_OUT" ]] && FILES+=("$UP_OUT")
  rsync -avz --chmod=Fu=r,Fgo= "${FILES[@]}" "$BACKUP_RSYNC_TARGET"/
fi

echo "==> Backup OK"
ls -lh "$BACKUP_ROOT"/justx_systems_"${DATE}"* "$BACKUP_ROOT"/jbt_uploads_"${DATE}"* 2>/dev/null || true
