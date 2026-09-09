#!/usr/bin/env bash
# Roll live app back to a previously staged release directory.
# Usage:
#   RELEASE_ID=<sha> ./scripts/vps-rollback.sh
# Optional: DEPLOY_PATH, RELEASES_DIR, SHARED_DIR, PM2_MODE, HEALTH_CHECK
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/var/www/jbt}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$DEPLOY_PATH")/jbt-releases}"
SHARED_DIR="${SHARED_DIR:-$(dirname "$DEPLOY_PATH")/jbt-shared}"
RELEASE_ID="${RELEASE_ID:-}"
PM2_MODE="${PM2_MODE:-reload}"
HEALTH_CHECK="${HEALTH_CHECK:-true}"
WEB_PORT="${WEB_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/jbt}"

LIVE="$DEPLOY_PATH"
CURRENT_FILE="$RELEASES_DIR/CURRENT"

die() { echo "ERROR: $*" >&2; exit 1; }

if [[ -z "$RELEASE_ID" ]]; then
  echo "ERROR: set RELEASE_ID to a folder under $RELEASES_DIR" >&2
  echo "Available:" >&2
  ls -1 "$RELEASES_DIR" 2>/dev/null | grep -vE '^(incoming|CURRENT|PREVIOUS|live-next|live-prev|live-failed)$' || true
  if [[ -f "$CURRENT_FILE" ]]; then
    echo "CURRENT=$(cat "$CURRENT_FILE")" >&2
  fi
  exit 1
fi

STAGE="$RELEASES_DIR/$RELEASE_ID"
[[ -d "$STAGE" && -f "$STAGE/package.json" ]] || die "release not found: $STAGE"
[[ -f "$SHARED_DIR/server.env" ]] || die "missing $SHARED_DIR/server.env"
[[ -w "$LIVE" ]] || die "LIVE path not writable: $LIVE"

case "$PM2_MODE" in
  reload|restart|none) ;;
  *) die "PM2_MODE allowlist for rollback: reload|restart|none" ;;
esac

API_PORT=4002
if grep -qE '^PORT=' "$SHARED_DIR/server.env"; then
  API_PORT="$(grep -E '^PORT=' "$SHARED_DIR/server.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi

link_shared_into() {
  local root="$1"
  mkdir -p "$root/server"
  rm -rf "$root/server/.env" "$root/server/uploads" "$root/uploads"
  ln -sfn "$SHARED_DIR/server.env" "$root/server/.env"
  ln -sfn "$SHARED_DIR/server-uploads" "$root/server/uploads"
  ln -sfn "$SHARED_DIR/uploads" "$root/uploads"
}

echo "==> Rollback to $RELEASE_ID → $LIVE (in-place rsync)"
link_shared_into "$STAGE"
rsync -a --delete --exclude '.git/' "$STAGE"/ "$LIVE"/
link_shared_into "$LIVE"

cd "$LIVE"
case "$PM2_MODE" in
  none) ;;
  reload)
    pm2 reload ecosystem.config.cjs --update-env
    pm2 save
    ;;
  restart)
    pm2 restart ecosystem.config.cjs --update-env
    pm2 save
    ;;
esac

if [[ "$HEALTH_CHECK" == "true" ]]; then
  export API_PORT WEB_PORT WEB_BASE_PATH
  bash "$LIVE/scripts/vps-healthcheck.sh"
fi

echo "$RELEASE_ID" >"$CURRENT_FILE"
echo "==> Rollback OK ($RELEASE_ID)"
echo "NOTE: DB schema is not automatically reversed. Restore a SQL backup if needed."
