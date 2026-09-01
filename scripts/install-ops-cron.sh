#!/usr/bin/env bash
# Install backup + health-monitor cron jobs for the deploy user.
# Usage (on VPS as deploy):
#   /var/www/jbt/scripts/install-ops-cron.sh
# Optional:
#   ALERT_WEBHOOK_URL='https://hooks.slack.com/...' BACKUP_RSYNC_TARGET='backup@host:/jbt/' \
#     /var/www/jbt/scripts/install-ops-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SH="$ROOT/scripts/backup-jbt.sh"
HEALTH_SH="$ROOT/scripts/health-monitor.sh"
LOG_DIR="${OPS_LOG_DIR:-$HOME/backups}"
mkdir -p "$LOG_DIR"
chmod +x "$BACKUP_SH" "$HEALTH_SH" "$ROOT/scripts/install-ops-cron.sh" 2>/dev/null || true

MARKER_BEGIN="# BEGIN JBT OPS CRON"
MARKER_END="# END JBT OPS CRON"

ALERT_LINE=""
if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
  ALERT_LINE="ALERT_WEBHOOK_URL='${ALERT_WEBHOOK_URL}' "
fi

OFFBOX_ENV=""
if [[ -n "${BACKUP_RSYNC_TARGET:-}" ]]; then
  OFFBOX_ENV+="BACKUP_RSYNC_TARGET='${BACKUP_RSYNC_TARGET}' "
fi
if [[ -n "${BACKUP_OFFBOX_CMD:-}" ]]; then
  OFFBOX_ENV+="BACKUP_OFFBOX_CMD='${BACKUP_OFFBOX_CMD}' "
fi

BLOCK=$(cat <<EOF
${MARKER_BEGIN}
# Daily DB+uploads backup at 02:15 (server local time)
15 2 * * * ${OFFBOX_ENV}${BACKUP_SH} >> ${LOG_DIR}/backup.log 2>&1
# Health probe every 5 minutes
*/5 * * * * ${ALERT_LINE}${HEALTH_SH} >> ${LOG_DIR}/health.log 2>&1
${MARKER_END}
EOF
)

EXISTING="$(crontab -l 2>/dev/null || true)"
# Strip previous JBT block
CLEANED="$(printf '%s\n' "$EXISTING" | awk -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
  $0==b {skip=1; next}
  $0==e {skip=0; next}
  !skip {print}
')"

{
  printf '%s\n' "$CLEANED"
  printf '%s\n' "$BLOCK"
} | grep -v '^$' | crontab -

echo "==> Installed JBT ops cron:"
crontab -l | sed -n "/${MARKER_BEGIN}/,/${MARKER_END}/p"
echo
echo "Logs: $LOG_DIR/backup.log  $LOG_DIR/health.log"
echo "Off-box: set BACKUP_RSYNC_TARGET or BACKUP_OFFBOX_CMD before re-running this script (or export in crontab)."
