#!/usr/bin/env bash
# Apply a CI-built release tarball on the VPS (no Next.js build).
#
# Hardened flow:
#   preflight → verify checksum → extract stage → optional DB backup →
#   migrate/seeds on stage (live untouched) → atomic dir swap → PM2 →
#   health (API+web) → auto-rollback on failure
#
# Required:
#   RELEASE_TGZ   absolute path to jbt-release.tgz
#
# Optional CD controls (allowlisted):
#   RELEASE_ID, DEPLOY_PATH, RELEASES_DIR, SHARED_DIR
#   RUN_MIGRATIONS, SEED_TOOLS, BACKUP_DB, PM2_MODE, POST_DEPLOY_TASK
#   HEALTH_CHECK, AUTO_ROLLBACK, KEEP_RELEASES
#   RELEASE_SHA256   expected sha256 hex (or path to .sha256 file)
#   MIN_FREE_MB      default 2048
set -euo pipefail

RELEASE_TGZ="${RELEASE_TGZ:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/jbt}"
RELEASES_DIR="${RELEASES_DIR:-$(dirname "$DEPLOY_PATH")/jbt-releases}"
SHARED_DIR="${SHARED_DIR:-$(dirname "$DEPLOY_PATH")/jbt-shared}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
SEED_TOOLS="${SEED_TOOLS:-false}"
BACKUP_DB="${BACKUP_DB:-false}"
PM2_MODE="${PM2_MODE:-reload}"
POST_DEPLOY_TASK="${POST_DEPLOY_TASK:-none}"
HEALTH_CHECK="${HEALTH_CHECK:-true}"
AUTO_ROLLBACK="${AUTO_ROLLBACK:-true}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
RELEASE_ID="${RELEASE_ID:-}"
RELEASE_SHA256="${RELEASE_SHA256:-}"
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
WEB_PORT="${WEB_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/jbt}"

LIVE="$DEPLOY_PATH"
LIVE_NEW="${DEPLOY_PATH}.new"
LIVE_OLD="${DEPLOY_PATH}.old"
LIVE_FAILED="${DEPLOY_PATH}.failed"
CURRENT_FILE="$RELEASES_DIR/CURRENT"
PREVIOUS_FILE="$RELEASES_DIR/PREVIOUS"

die() { echo "ERROR: $*" >&2; exit 1; }

if [[ -z "$RELEASE_TGZ" || ! -f "$RELEASE_TGZ" ]]; then
  die "RELEASE_TGZ missing or not a file: ${RELEASE_TGZ:-}"
fi

case "$PM2_MODE" in
  reload|restart|restart_api|restart_web|restart_worker|none) ;;
  *) die "invalid PM2_MODE='$PM2_MODE'" ;;
esac

case "$POST_DEPLOY_TASK" in
  none|seed_tools|seed_admin|analytics_rollup) ;;
  *) die "invalid POST_DEPLOY_TASK='$POST_DEPLOY_TASK'" ;;
esac

[[ "$KEEP_RELEASES" =~ ^[1-9][0-9]*$ ]] || die "KEEP_RELEASES must be a positive integer"
[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || die "MIN_FREE_MB must be an integer"

echo "==> Preflight"
for cmd in tar rsync curl pm2 node npm sha256sum df; do
  command -v "$cmd" >/dev/null 2>&1 || die "missing required command: $cmd"
done

# Free space on the filesystem that holds LIVE / releases
FREE_MB="$(df -Pm "$(dirname "$LIVE")" | awk 'NR==2{print $4}')"
echo "    free disk: ${FREE_MB}MB (min ${MIN_FREE_MB}MB)"
if (( FREE_MB < MIN_FREE_MB )); then
  die "insufficient disk free (${FREE_MB}MB < ${MIN_FREE_MB}MB)"
fi

TGZ_BYTES="$(wc -c <"$RELEASE_TGZ" | tr -d ' ')"
NEED_MB="$(( TGZ_BYTES / 1024 / 1024 * 3 + 512 ))"
echo "    artifact: $(( TGZ_BYTES / 1024 / 1024 ))MB (rough need ~${NEED_MB}MB for extract+swap)"
if (( FREE_MB < NEED_MB )); then
  die "insufficient disk for artifact extract/swap (need ~${NEED_MB}MB, have ${FREE_MB}MB)"
fi

verify_checksum() {
  local expected=""
  if [[ -n "$RELEASE_SHA256" ]]; then
    if [[ -f "$RELEASE_SHA256" ]]; then
      expected="$(awk 'NF{print $1; exit}' "$RELEASE_SHA256")"
    else
      expected="$RELEASE_SHA256"
    fi
  elif [[ -f "${RELEASE_TGZ}.sha256" ]]; then
    expected="$(awk 'NF{print $1; exit}' "${RELEASE_TGZ}.sha256")"
  fi
  [[ -n "$expected" ]] || die "RELEASE_SHA256 not provided and ${RELEASE_TGZ}.sha256 missing"
  expected="$(echo "$expected" | tr '[:upper:]' '[:lower:]' | tr -d ' \r\n')"
  local actual
  actual="$(sha256sum "$RELEASE_TGZ" | awk '{print $1}')"
  echo "    sha256 expected=$expected"
  echo "    sha256 actual  =$actual"
  [[ "$actual" == "$expected" ]] || die "checksum mismatch"
}

echo "==> Verify artifact checksum"
verify_checksum

mkdir -p "$RELEASES_DIR" "$SHARED_DIR/uploads" "$SHARED_DIR/server-uploads"

if [[ ! -f "$SHARED_DIR/server.env" ]]; then
  if [[ -f "$LIVE/server/.env" && ! -L "$LIVE/server/.env" ]]; then
    echo "==> Bootstrapping shared env from live"
    cp -a "$LIVE/server/.env" "$SHARED_DIR/server.env"
  elif [[ -L "$LIVE/server/.env" ]]; then
    cp -a "$(readlink -f "$LIVE/server/.env")" "$SHARED_DIR/server.env" 2>/dev/null \
      || cp -a "$LIVE/server/.env" "$SHARED_DIR/server.env"
  else
    die "$LIVE/server/.env missing (and no $SHARED_DIR/server.env). See docs/DEPLOY.md."
  fi
fi
chmod 600 "$SHARED_DIR/server.env" || true

# Bootstrap uploads into shared once (from real dirs, not symlinks)
if [[ -d "$LIVE/server/uploads" && ! -L "$LIVE/server/uploads" ]]; then
  echo "==> Bootstrapping shared server/uploads"
  rsync -a "$LIVE/server/uploads/" "$SHARED_DIR/server-uploads/"
fi
if [[ -d "$LIVE/uploads" && ! -L "$LIVE/uploads" ]]; then
  echo "==> Bootstrapping shared uploads"
  rsync -a "$LIVE/uploads/" "$SHARED_DIR/uploads/"
fi

API_PORT=4002
if grep -qE '^PORT=' "$SHARED_DIR/server.env"; then
  API_PORT="$(grep -E '^PORT=' "$SHARED_DIR/server.env" | head -1 | cut -d= -f2- | tr -d '\r')"
fi

if [[ -z "$RELEASE_ID" ]]; then
  RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
fi

STAGE="$RELEASES_DIR/$RELEASE_ID"
echo "==> Applying release $RELEASE_ID"
echo "    tarball: $RELEASE_TGZ"
echo "    live:    $LIVE"
echo "    stage:   $STAGE"
echo "    shared:  $SHARED_DIR"
echo "    migrations=$RUN_MIGRATIONS seed_tools=$SEED_TOOLS backup_db=$BACKUP_DB"
echo "    pm2=$PM2_MODE task=$POST_DEPLOY_TASK health=$HEALTH_CHECK auto_rollback=$AUTO_ROLLBACK"

rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf "$RELEASE_TGZ" -C "$STAGE"

if [[ ! -f "$STAGE/package.json" || ! -d "$STAGE/web/.next" || ! -d "$STAGE/node_modules" ]]; then
  die "release tarball incomplete (need package.json, web/.next, node_modules)"
fi

link_shared_into() {
  local root="$1"
  mkdir -p "$root/server"
  rm -rf "$root/server/.env" "$root/server/uploads" "$root/uploads"
  ln -sfn "$SHARED_DIR/server.env" "$root/server/.env"
  ln -sfn "$SHARED_DIR/server-uploads" "$root/server/uploads"
  ln -sfn "$SHARED_DIR/uploads" "$root/uploads"
}

link_shared_into "$STAGE"

if [[ -f "$STAGE/RELEASE.json" ]]; then
  echo "==> Release metadata"
  cat "$STAGE/RELEASE.json"
fi

run_task() {
  local root="$1"
  local task="$2"
  case "$task" in
    none) ;;
    seed_tools)
      echo "==> Post-deploy task: seed_tools"
      (cd "$root" && npm run db:seed:tools -w server)
      ;;
    seed_admin)
      echo "==> Post-deploy task: seed_admin"
      (cd "$root" && npm run db:seed -w server)
      ;;
    analytics_rollup)
      echo "==> Post-deploy task: analytics_rollup"
      (cd "$root" && npm run analytics:rollup -w server)
      ;;
    *) die "unhandled task '$task'" ;;
  esac
}

if [[ "$BACKUP_DB" == "true" ]]; then
  echo "==> DB backup before migrations"
  if [[ -x "$STAGE/scripts/backup-jbt.sh" ]]; then
    ENV_FILE="$SHARED_DIR/server.env" bash "$STAGE/scripts/backup-jbt.sh"
  elif [[ -f "$LIVE/scripts/backup-jbt.sh" ]]; then
    ENV_FILE="$SHARED_DIR/server.env" bash "$LIVE/scripts/backup-jbt.sh"
  else
    die "backup requested but backup-jbt.sh not found"
  fi
fi

# Migrations / seeds against STAGE — live tree still serving previous release
if [[ "$RUN_MIGRATIONS" == "true" ]]; then
  echo "==> Apply pending DB migrations (on stage, before swap)"
  (cd "$STAGE" && npm run db:migrate -w server)
else
  echo "==> Skipping migrations"
fi

if [[ "$SEED_TOOLS" == "true" ]]; then
  echo "==> Seed tool definitions (on stage)"
  (cd "$STAGE" && npm run db:seed:tools -w server)
fi

run_task "$STAGE" "$POST_DEPLOY_TASK"

apply_pm2() {
  local root="$1"
  case "$PM2_MODE" in
    none)
      echo "==> Skipping PM2"
      ;;
    reload)
      echo "==> PM2 reload"
      (
        cd "$root"
        if pm2 describe justx-jbt-api >/dev/null 2>&1; then
          pm2 reload ecosystem.config.cjs --update-env
        else
          pm2 start ecosystem.config.cjs
        fi
        pm2 save
      )
      ;;
    restart)
      echo "==> PM2 restart (all)"
      (
        cd "$root"
        if pm2 describe justx-jbt-api >/dev/null 2>&1; then
          pm2 restart ecosystem.config.cjs --update-env
        else
          pm2 start ecosystem.config.cjs
        fi
        pm2 save
      )
      ;;
    restart_api)
      (cd "$root" && pm2 restart justx-jbt-api --update-env && pm2 save)
      ;;
    restart_web)
      (cd "$root" && pm2 restart justx-jbt-web --update-env && pm2 save)
      ;;
    restart_worker)
      (cd "$root" && pm2 restart justx-jbt-worker --update-env && pm2 save)
      ;;
  esac
}

run_health() {
  local root="$1"
  export API_PORT WEB_PORT WEB_BASE_PATH
  if [[ -x "$root/scripts/vps-healthcheck.sh" ]]; then
    bash "$root/scripts/vps-healthcheck.sh"
  else
    die "vps-healthcheck.sh missing in $root"
  fi
}

PREV_ID=""
if [[ -f "$CURRENT_FILE" ]]; then
  PREV_ID="$(tr -d ' \r\n' <"$CURRENT_FILE")"
fi

echo "==> Prepare atomic swap target $LIVE_NEW"
rm -rf "$LIVE_NEW"
mkdir -p "$LIVE_NEW"
rsync -a "$STAGE"/ "$LIVE_NEW"/
link_shared_into "$LIVE_NEW"

# Remember previous pointer for ops
if [[ -n "$PREV_ID" ]]; then
  echo "$PREV_ID" >"$PREVIOUS_FILE"
fi

echo "==> Atomic swap: $LIVE → $LIVE_OLD ; $LIVE_NEW → $LIVE"
rm -rf "$LIVE_OLD"
if [[ -e "$LIVE" || -L "$LIVE" ]]; then
  mv "$LIVE" "$LIVE_OLD"
fi
mv "$LIVE_NEW" "$LIVE"

SWAP_DONE=1
rollback_live() {
  echo "==> AUTO-ROLLBACK: restoring previous live tree" >&2
  if [[ ! -e "$LIVE_OLD" && ! -L "$LIVE_OLD" ]]; then
    echo "ERROR: no $LIVE_OLD to restore" >&2
    return 1
  fi
  rm -rf "$LIVE_FAILED"
  if [[ -e "$LIVE" || -L "$LIVE" ]]; then
    mv "$LIVE" "$LIVE_FAILED" || true
  fi
  mv "$LIVE_OLD" "$LIVE"
  apply_pm2 "$LIVE" || true
  if [[ "$HEALTH_CHECK" == "true" ]]; then
    run_health "$LIVE" || echo "WARN: health still failing after rollback" >&2
  fi
  if [[ -n "$PREV_ID" ]]; then
    echo "$PREV_ID" >"$CURRENT_FILE"
  fi
  return 0
}

on_fail() {
  local rc=$?
  trap - ERR
  set +e
  if [[ "${SWAP_DONE:-0}" -eq 1 && "$AUTO_ROLLBACK" == "true" ]]; then
    rollback_live || true
  fi
  exit "$rc"
}
trap on_fail ERR

apply_pm2 "$LIVE"

if [[ "$HEALTH_CHECK" == "true" ]]; then
  run_health "$LIVE"
fi

# Success — drop ERR trap before cleanup
trap - ERR
echo "$RELEASE_ID" >"$CURRENT_FILE"

# Keep git metadata for emergency ./scripts/vps-deploy.sh fallback
if [[ -d "$LIVE_OLD/.git" && ! -e "$LIVE/.git" ]]; then
  echo "==> Preserving .git from previous live tree"
  mv "$LIVE_OLD/.git" "$LIVE/.git"
fi

# Keep LIVE.old briefly as emergency; prune older failed/old trees + release dirs
echo "==> Pruning old release dirs (keep $KEEP_RELEASES)"
# shellcheck disable=SC2012
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | grep -v '/incoming/' | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  # Never delete the release we just activated if listed
  [[ "$old" == "$STAGE/" || "$old" == "$STAGE" ]] && continue
  echo "    rm $old"
  rm -rf "$old"
done

# Remove previous live.old after successful health (stage dirs remain for rollback script)
rm -rf "$LIVE_OLD" "$LIVE_FAILED" "$LIVE_NEW"

if [[ "$RELEASE_TGZ" == "$RELEASES_DIR/incoming/"* ]]; then
  rm -f "$RELEASE_TGZ" "${RELEASE_TGZ}.sha256"
fi

echo "==> Deploy OK (atomic release $RELEASE_ID)"
