#!/usr/bin/env bash
# Post a customer-facing outage / recovery notice to ALERT_WEBHOOK_URL (Slack/Discord/etc).
# Usage:
#   ALERT_WEBHOOK_URL=... ./scripts/notify-outage.sh investigating
#   ALERT_WEBHOOK_URL=... ./scripts/notify-outage.sh restored
set -euo pipefail

MODE="${1:-investigating}"
WEBHOOK="${ALERT_WEBHOOK_URL:-}"
if [[ -z "$WEBHOOK" ]]; then
  echo "Set ALERT_WEBHOOK_URL" >&2
  exit 1
fi

case "$MODE" in
  investigating|outage)
    TEXT='We are investigating an issue affecting JustX Business Tools (justxsystems.com/jbt). Document generation and login may fail. We will update when service is restored.'
    ;;
  restored|resolved)
    TEXT='JustX Business Tools (justxsystems.com/jbt) has been restored. If you still see errors, hard-refresh or sign in again.'
    ;;
  *)
    TEXT="$MODE"
    ;;
esac

curl -fsS -X POST "$WEBHOOK" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"text":%s}' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TEXT")")"
echo
echo "Posted ($MODE)"
