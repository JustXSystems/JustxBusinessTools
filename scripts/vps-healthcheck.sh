#!/usr/bin/env bash
# Post-deploy probes against local API, web, and PM2.
# Env:
#   API_PORT   (default 4002)
#   WEB_PORT   (default 3002)
#   WEB_BASE_PATH (default /jbt)
#   HEALTH_RETRIES   (default 30) — attempts while waiting for API to listen
#   HEALTH_SLEEP_SEC (default 2)  — delay between attempts
set -euo pipefail

API_PORT="${API_PORT:-4002}"
WEB_PORT="${WEB_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/jbt}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"
WEB_BASE_PATH="/${WEB_BASE_PATH#/}"
WEB_BASE_PATH="${WEB_BASE_PATH%/}"
[[ "$WEB_BASE_PATH" == "/" ]] && WEB_BASE_PATH=""

dump_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    echo "==> PM2 status (debug)" >&2
    pm2 list >&2 || true
    pm2 describe justx-jbt-api 2>&1 | tail -n 40 >&2 || true
    echo "==> Recent API logs" >&2
    pm2 logs justx-jbt-api --lines 40 --nostream >&2 || true
  fi
}

echo "==> Health check (API :${API_PORT}) — up to $((HEALTH_RETRIES * HEALTH_SLEEP_SEC))s"
ok=0
for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if body="$(curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null)" \
    && echo "$body" | grep -q '"ok"'; then
    echo "$body"
    echo "    API ready on attempt ${attempt}/${HEALTH_RETRIES}"
    ok=1
    break
  fi
  echo "    attempt ${attempt}/${HEALTH_RETRIES}: not ready yet…"
  sleep "$HEALTH_SLEEP_SEC"
done

if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: API did not become healthy on :${API_PORT} within $((HEALTH_RETRIES * HEALTH_SLEEP_SEC))s" >&2
  dump_pm2
  exit 1
fi

echo "==> Post-deploy API checks"
curl -fsS --max-time 10 "http://127.0.0.1:${API_PORT}/api/config/branding" | tee /dev/stderr | grep -q '"branding"'
curl -fsS --max-time 10 "http://127.0.0.1:${API_PORT}/api/public/status" | tee /dev/stderr | grep -q '"ok"'

QUOTE_CODE="$(curl -sS --max-time 10 -o /tmp/jbt_quote_probe.json -w '%{http_code}' "http://127.0.0.1:${API_PORT}/api/public/quotation-v1/deploy-probe-token" || true)"
if [[ "$QUOTE_CODE" != "404" ]]; then
  echo "WARN: public quotation probe expected HTTP 404, got ${QUOTE_CODE:-none}" >&2
  cat /tmp/jbt_quote_probe.json 2>/dev/null || true
fi

echo "==> Health check (web :${WEB_PORT}${WEB_BASE_PATH})"
WEB_CODE="$(curl -sS --max-time 10 -o /tmp/jbt_web_probe.html -w '%{http_code}' \
  "http://127.0.0.1:${WEB_PORT}${WEB_BASE_PATH}" || true)"
case "$WEB_CODE" in
  200|301|302|307|308)
    echo "web HTTP $WEB_CODE"
    ;;
  *)
    echo "ERROR: web probe expected 200/3xx, got ${WEB_CODE:-none}" >&2
    head -c 500 /tmp/jbt_web_probe.html 2>/dev/null || true
    dump_pm2
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
