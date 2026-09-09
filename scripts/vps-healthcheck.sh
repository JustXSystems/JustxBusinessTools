#!/usr/bin/env bash
# Post-deploy probes against local API, web, and PM2.
# Env:
#   API_PORT   (default 4002)
#   WEB_PORT   (default 3002)
#   WEB_BASE_PATH (default /jbt)
set -euo pipefail

API_PORT="${API_PORT:-4002}"
WEB_PORT="${WEB_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/jbt}"
WEB_BASE_PATH="/${WEB_BASE_PATH#/}"
WEB_BASE_PATH="${WEB_BASE_PATH%/}"
[[ "$WEB_BASE_PATH" == "/" ]] && WEB_BASE_PATH=""

echo "==> Health check (API :${API_PORT})"
sleep 3
curl -fsS "http://127.0.0.1:${API_PORT}/api/health" | tee /dev/stderr | grep -q '"ok"'
echo

echo "==> Post-deploy API checks"
curl -fsS "http://127.0.0.1:${API_PORT}/api/config/branding" | tee /dev/stderr | grep -q '"branding"'
curl -fsS "http://127.0.0.1:${API_PORT}/api/public/status" | tee /dev/stderr | grep -q '"ok"'

QUOTE_CODE="$(curl -sS -o /tmp/jbt_quote_probe.json -w '%{http_code}' "http://127.0.0.1:${API_PORT}/api/public/quotation-v1/deploy-probe-token" || true)"
if [[ "$QUOTE_CODE" != "404" ]]; then
  echo "WARN: public quotation probe expected HTTP 404, got ${QUOTE_CODE:-none}" >&2
  cat /tmp/jbt_quote_probe.json 2>/dev/null || true
fi

echo "==> Health check (web :${WEB_PORT}${WEB_BASE_PATH})"
WEB_CODE="$(curl -sS -o /tmp/jbt_web_probe.html -w '%{http_code}' \
  "http://127.0.0.1:${WEB_PORT}${WEB_BASE_PATH}" || true)"
case "$WEB_CODE" in
  200|301|302|307|308)
    echo "web HTTP $WEB_CODE"
    ;;
  *)
    echo "ERROR: web probe expected 200/3xx, got ${WEB_CODE:-none}" >&2
    head -c 500 /tmp/jbt_web_probe.html 2>/dev/null || true
    exit 1
    ;;
esac

if command -v pm2 >/dev/null 2>&1; then
  for app in justx-jbt-api justx-jbt-web justx-jbt-worker; do
    if ! pm2 describe "$app" >/dev/null 2>&1; then
      echo "ERROR: PM2 app missing: $app" >&2
      exit 1
    fi
  done
  echo "PM2 apps present: api, web, worker"
fi

echo "==> Health OK"
