#!/usr/bin/env bash
# Runs ON the VPS after git update (called by GitHub Actions or manually).
# Prerequisites: Node 20+, npm, PM2, server/.env already configured.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-master}"
BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/jbt}"

echo "==> Deploying JBT from $(pwd) (branch=${BRANCH})"

if [[ ! -f server/.env ]]; then
  echo "ERROR: server/.env missing. Create it once (see docs/DEPLOY.md)." >&2
  exit 1
fi

# Load API port for health check (default 4002)
API_PORT=4002
if grep -qE '^PORT=' server/.env; then
  API_PORT="$(grep -E '^PORT=' server/.env | head -1 | cut -d= -f2- | tr -d '\r')"
fi

if [[ -d .git ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/${BRANCH}"
fi

echo "==> npm ci"
npm ci

# Windows lockfiles often omit the Linux lightningcss optional binary (Tailwind/PostCSS).
if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  if [[ ! -d node_modules/lightningcss-linux-x64-gnu ]]; then
    echo "==> Installing lightningcss Linux native binary"
    npm install --no-save --no-package-lock lightningcss-linux-x64-gnu@1.32.0
  fi
  if [[ -f node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node \
     && -d node_modules/lightningcss \
     && ! -f node_modules/lightningcss/lightningcss.linux-x64-gnu.node ]]; then
    cp -f node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node \
      node_modules/lightningcss/lightningcss.linux-x64-gnu.node
  fi
fi

echo "==> Build web (basePath=${BASE_PATH}, webpack — Turbopack breaks lightningcss .node on VPS)"
export NODE_ENV=production
export NEXT_PUBLIC_BASE_PATH="$BASE_PATH"
export WEB_BASE_PATH="$BASE_PATH"
npm run build -w web

echo "==> Apply pending DB migrations"
npm run db:migrate -w server || echo "WARN: migrations failed — check logs / mysql/migrations"

echo "==> PM2 reload"
if pm2 describe justx-jbt-api >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "==> Health check"
sleep 3
curl -fsS "http://127.0.0.1:${API_PORT}/api/health" | tee /dev/stderr | grep -q '"ok"'
echo

echo "==> Post-deploy checks"
curl -fsS "http://127.0.0.1:${API_PORT}/api/config/branding" | tee /dev/stderr | grep -q '"branding"'
curl -fsS "http://127.0.0.1:${API_PORT}/api/public/status" | tee /dev/stderr | grep -q '"ok"'
# Public quote with nonsense token must be 404 (not 401 auth wall)
QUOTE_CODE="$(curl -sS -o /tmp/jbt_quote_probe.json -w '%{http_code}' "http://127.0.0.1:${API_PORT}/api/public/quotation-v1/deploy-probe-token" || true)"
if [[ "$QUOTE_CODE" != "404" ]]; then
  echo "WARN: public quotation probe expected HTTP 404, got ${QUOTE_CODE:-none}" >&2
  cat /tmp/jbt_quote_probe.json 2>/dev/null || true
fi
if command -v pm2 >/dev/null 2>&1; then
  for app in justx-jbt-api justx-jbt-web justx-jbt-worker; do
    if ! pm2 describe "$app" >/dev/null 2>&1; then
      echo "ERROR: PM2 app missing: $app" >&2
      exit 1
    fi
  done
  echo "PM2 apps present: api, web, worker"
fi
echo
echo "==> Deploy OK"
