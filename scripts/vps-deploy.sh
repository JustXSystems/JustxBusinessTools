#!/usr/bin/env bash
# Manual / emergency deploy ON the VPS (git pull + npm ci + Next build).
# Prefer GitHub Actions artifact deploy (scripts/vps-release.sh) for normal releases.
#
# Optional CD controls (same allowlist as vps-release.sh):
#   DEPLOY_BRANCH      (default: master)
#   RUN_MIGRATIONS     true|false (default: true)
#   SEED_TOOLS         true|false (default: false)
#   PM2_MODE           reload|restart|restart_api|restart_web|restart_worker|none (default: reload)
#   POST_DEPLOY_TASK   none|seed_tools|seed_admin|analytics_rollup (default: none)
#   HEALTH_CHECK       true|false (default: true)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-master}"
BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/jbt}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
SEED_TOOLS="${SEED_TOOLS:-false}"
PM2_MODE="${PM2_MODE:-reload}"
POST_DEPLOY_TASK="${POST_DEPLOY_TASK:-none}"
HEALTH_CHECK="${HEALTH_CHECK:-true}"

echo "==> Deploying JBT from $(pwd) (branch=${BRANCH}, local-build fallback)"
echo "    migrations=$RUN_MIGRATIONS seed_tools=$SEED_TOOLS pm2=$PM2_MODE task=$POST_DEPLOY_TASK health=$HEALTH_CHECK"

case "$PM2_MODE" in
  reload|restart|restart_api|restart_web|restart_worker|none) ;;
  *)
    echo "ERROR: invalid PM2_MODE='$PM2_MODE'" >&2
    exit 1
    ;;
esac

case "$POST_DEPLOY_TASK" in
  none|seed_tools|seed_admin|analytics_rollup) ;;
  *)
    echo "ERROR: invalid POST_DEPLOY_TASK='$POST_DEPLOY_TASK'" >&2
    exit 1
    ;;
esac

if [[ ! -f server/.env ]]; then
  echo "ERROR: server/.env missing. Create it once (see docs/DEPLOY.md)." >&2
  exit 1
fi

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

# Windows lockfiles often omit Linux Tailwind/lightningcss optional natives.
chmod +x scripts/ensure-css-native-linux.sh
./scripts/ensure-css-native-linux.sh

echo "==> Build web (basePath=${BASE_PATH}, webpack)"
export NODE_ENV=production
export NEXT_PUBLIC_BASE_PATH="$BASE_PATH"
export WEB_BASE_PATH="$BASE_PATH"
npm run build -w web

run_task() {
  local task="$1"
  case "$task" in
    none) ;;
    seed_tools) npm run db:seed:tools -w server ;;
    seed_admin) npm run db:seed -w server ;;
    analytics_rollup) npm run analytics:rollup -w server ;;
    *)
      echo "ERROR: unhandled task '$task'" >&2
      exit 1
      ;;
  esac
}

if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  echo "==> Apply pending DB migrations"
  npm run db:migrate -w server
else
  echo "==> Skipping migrations"
fi

if [[ "$SEED_TOOLS" == "true" ]]; then
  echo "==> Seed tool definitions"
  npm run db:seed:tools -w server
fi

run_task "$POST_DEPLOY_TASK"

case "$PM2_MODE" in
  none)
    echo "==> Skipping PM2"
    ;;
  reload)
    echo "==> PM2 reload"
    if pm2 describe justx-jbt-api >/dev/null 2>&1; then
      pm2 reload ecosystem.config.cjs --update-env
    else
      pm2 start ecosystem.config.cjs
    fi
    pm2 save
    ;;
  restart)
    echo "==> PM2 restart (all)"
    if pm2 describe justx-jbt-api >/dev/null 2>&1; then
      pm2 restart ecosystem.config.cjs --update-env
    else
      pm2 start ecosystem.config.cjs
    fi
    pm2 save
    ;;
  restart_api)
    pm2 restart justx-jbt-api --update-env
    pm2 save
    ;;
  restart_web)
    pm2 restart justx-jbt-web --update-env
    pm2 save
    ;;
  restart_worker)
    pm2 restart justx-jbt-worker --update-env
    pm2 save
    ;;
esac

if [[ "$HEALTH_CHECK" == "true" ]]; then
  export API_PORT
  bash "$ROOT/scripts/vps-healthcheck.sh"
fi

echo "==> Deploy OK (local-build fallback)"
