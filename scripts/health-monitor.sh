#!/usr/bin/env bash
# External health probe for JustX Business Tools.
# Cron every 5 min:
#   */5 * * * * /var/www/jbt/scripts/health-monitor.sh >> /home/deploy/backups/health.log 2>&1
#
# Optional alert: set ALERT_WEBHOOK_URL to a Slack/Discord/generic POST webhook.
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://justxsystems.com/jbt/api/health}"
STATUS_URL="${STATUS_URL:-https://justxsystems.com/jbt/api/public/status}"
BRANDING_URL="${BRANDING_URL:-https://justxsystems.com/jbt/api/config/branding}"
UI_URL="${UI_URL:-https://justxsystems.com/jbt/}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
STATE_FILE="${HEALTH_STATE_FILE:-$HOME/backups/jbt-health.state}"
mkdir -p "$(dirname "$STATE_FILE")"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fail=0
detail=""

body="$(curl -fsS --max-time 15 "$HEALTH_URL" 2>/dev/null || true)"
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$HEALTH_URL" 2>/dev/null || echo 000)"

if [[ "$code" != "200" ]] || ! grep -q '"ok":true' <<<"$body" || ! grep -q '"db":"ok"' <<<"$body"; then
  fail=1
  detail="health HTTP=$code body=${body:-<empty>}"
fi

status_body="$(curl -fsS --max-time 15 "$STATUS_URL" 2>/dev/null || true)"
status_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$STATUS_URL" 2>/dev/null || echo 000)"
if [[ "$status_code" != "200" ]] || ! grep -q '"ok":true' <<<"$status_body"; then
  fail=1
  detail="${detail:+$detail; }status HTTP=$status_code"
fi

brand_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$BRANDING_URL" 2>/dev/null || echo 000)"
if [[ "$brand_code" != "200" ]]; then
  fail=1
  detail="${detail:+$detail; }branding HTTP=$brand_code"
fi

ui_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -L "$UI_URL" 2>/dev/null || echo 000)"
if [[ "$ui_code" != "200" && "$ui_code" != "304" ]]; then
  fail=1
  detail="${detail:+$detail; }ui HTTP=$ui_code"
fi

# Optional local PM2 restart storm check (when run on VPS with pm2)
if command -v pm2 >/dev/null 2>&1; then
  for app in justx-jbt-api justx-jbt-web justx-jbt-worker; do
    restarts="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
apps=json.load(sys.stdin)
for a in apps:
  if a.get('name')=='$app':
    print(a.get('pm2_env',{}).get('restart_time',0)); break
else:
  print(0)
" 2>/dev/null || echo 0)"
    # Informational only in log; alert if process missing
    status="$(pm2 describe "$app" >/dev/null 2>&1 && echo online || echo missing)"
    if [[ "$status" == "missing" ]]; then
      fail=1
      detail="${detail:+$detail; }$app missing from pm2"
    fi
    echo "$ts pm2 $app status=$status restarts=${restarts:-0}"
  done
fi

prev="$(cat "$STATE_FILE" 2>/dev/null || echo ok)"
if [[ "$fail" -eq 0 ]]; then
  echo "$ts OK health=$code ui=$ui_code"
  echo ok > "$STATE_FILE"
  if [[ "$prev" != "ok" && -n "$ALERT_WEBHOOK_URL" ]]; then
    curl -fsS -X POST "$ALERT_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"JBT recovered: $HEALTH_URL\"}" >/dev/null || true
  fi
  exit 0
fi

echo "$ts FAIL $detail" >&2
echo fail > "$STATE_FILE"

if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
  curl -fsS -X POST "$ALERT_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"JBT health FAIL at $ts — $detail\"}" >/dev/null || true
fi
exit 1
