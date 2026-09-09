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
#   FORCE_NPM_CI       true|false — skip node_modules reuse; always npm ci
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
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
FORCE_NPM_CI="${FORCE_NPM_CI:-false}"
WEB_PORT="${WEB_PORT:-3002}"
WEB_BASE_PATH="${WEB_BASE_PATH:-/jbt}"

LIVE="$DEPLOY_PATH"
# Swap helpers live under RELEASES_DIR (deploy-owned). Creating /var/www/jbt.new
# requires write on /var/www, which deploy usually lacks.
LIVE_NEW="$RELEASES_DIR/live-next"
LIVE_OLD="$RELEASES_DIR/live-prev"
LIVE_FAILED="$RELEASES_DIR/live-failed"
CURRENT_FILE="$RELEASES_DIR/CURRENT"
PREVIOUS_FILE="$RELEASES_DIR/PREVIOUS"
SWAP_MODE="rsync" # rsync (default) | mv (only if parent of LIVE is writable)

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
[[ -w "$RELEASES_DIR" ]] || die "RELEASES_DIR not writable: $RELEASES_DIR (chown deploy)"
[[ -w "$SHARED_DIR" ]] || die "SHARED_DIR not writable: $SHARED_DIR (chown deploy)"

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

if [[ ! -f "$STAGE/package.json" || ! -d "$STAGE/web/.next" ]]; then
  die "release tarball incomplete (need package.json, web/.next)"
fi

# npm workspaces often nest runtime deps (lockfile has web/node_modules/next,
# server/node_modules/@opentelemetry/*) — not only the repo-root node_modules.
dep_exists_any() {
  local p
  for p in "$@"; do
    [[ -e "$p" ]] && return 0
  done
  return 1
}

# Args: root [label] [quiet]
# quiet=1 → no ERROR spam (used when probing whether to reuse live modules)
verify_runtime_deps() {
  local root="$1"
  local label="${2:-$root}"
  local quiet="${3:-0}"
  local missing=()

  dep_exists_any \
    "$root/node_modules/next" \
    "$root/web/node_modules/next" \
    || missing+=("next (root or web/node_modules)")

  dep_exists_any \
    "$root/node_modules/.bin/next" \
    "$root/web/node_modules/.bin/next" \
    || missing+=("next bin")

  dep_exists_any \
    "$root/node_modules/tsx" \
    "$root/server/node_modules/tsx" \
    || missing+=("tsx")

  dep_exists_any \
    "$root/node_modules/.bin/tsx" \
    "$root/server/node_modules/.bin/tsx" \
    || missing+=("tsx bin")

  dep_exists_any \
    "$root/node_modules/@opentelemetry/sdk-node" \
    "$root/server/node_modules/@opentelemetry/sdk-node" \
    || missing+=("@opentelemetry/sdk-node (root or server/node_modules)")

  dep_exists_any \
    "$root/node_modules/express" \
    "$root/server/node_modules/express" \
    || missing+=("express")

  if [[ "${#missing[@]}" -gt 0 ]]; then
    if [[ "$quiet" != "1" ]]; then
      echo "ERROR: incomplete node_modules in $label:" >&2
      printf '  - %s\n' "${missing[@]}" >&2
    fi
    return 1
  fi
  return 0
}

# Copy workspace-local node_modules too (next/otel are often not hoisted).
rsync_node_modules_tree() {
  local src="$1"
  local dst="$2"
  local sub
  mkdir -p "$dst/node_modules"
  rsync -a "$src/node_modules/" "$dst/node_modules/"
  for sub in web server shared; do
    if [[ -d "$src/$sub/node_modules" ]]; then
      mkdir -p "$dst/$sub/node_modules"
      rsync -a "$src/$sub/node_modules/" "$dst/$sub/node_modules/"
    fi
  done
}

install_stage_deps() {
  echo "==> Install production deps on stage"
  if [[ -d "$STAGE/node_modules" && -f "$STAGE/package-lock.json" && "$FORCE_NPM_CI" != "true" ]]; then
    if verify_runtime_deps "$STAGE" "tarball node_modules" 1; then
      echo "    tarball already includes complete node_modules — skip npm ci"
      return 0
    fi
    echo "    tarball node_modules incomplete — will npm ci"
    rm -rf "$STAGE/node_modules" "$STAGE/web/node_modules" "$STAGE/server/node_modules"
  fi
  # Fast path: reuse live node_modules when lockfile unchanged AND live deps are complete
  if [[ "$FORCE_NPM_CI" != "true" ]] \
    && [[ -f "$LIVE/package-lock.json" && -d "$LIVE/node_modules" ]] \
    && cmp -s "$STAGE/package-lock.json" "$LIVE/package-lock.json" \
    && verify_runtime_deps "$LIVE" "live node_modules" 1; then
    echo "    reusing live node_modules (package-lock.json unchanged + deps OK)"
    rsync_node_modules_tree "$LIVE" "$STAGE"
    verify_runtime_deps "$STAGE" "stage after reuse" || die "reused node_modules still incomplete"
    return 0
  fi
  if [[ "$FORCE_NPM_CI" == "true" ]]; then
    echo "    FORCE_NPM_CI=true — fresh npm ci --omit=dev"
    rm -rf "$STAGE/node_modules" "$STAGE/web/node_modules" "$STAGE/server/node_modules"
  else
    echo "    npm ci --omit=dev (lockfile changed, live incomplete, or first install)"
  fi
  (cd "$STAGE" && npm ci --omit=dev)
  verify_runtime_deps "$STAGE" "stage after npm ci" || die "npm ci left incomplete node_modules"
}

install_stage_deps

if [[ ! -d "$STAGE/node_modules" ]]; then
  die "node_modules missing after install"
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

# Remember previous pointer for ops
if [[ -n "$PREV_ID" ]]; then
  echo "$PREV_ID" >"$PREVIOUS_FILE"
fi

PARENT_DIR="$(dirname "$LIVE")"
if [[ -w "$PARENT_DIR" ]]; then
  SWAP_MODE="mv"
  echo "==> Parent $PARENT_DIR is writable — using atomic mv swap"
else
  SWAP_MODE="rsync"
  echo "==> Parent $PARENT_DIR not writable by $(id -un) — using in-place rsync into $LIVE"
fi

# Ensure live exists and is writable (content owned by deploy)
mkdir -p "$LIVE"
[[ -w "$LIVE" ]] || die "LIVE path not writable: $LIVE (chown to deploy)"

activate_release_rsync() {
  local src="$1"
  echo "==> Sync release → live (preserve .git + win agent zip)"
  link_shared_into "$src"
  rsync -a --delete \
    --exclude '.git/' \
    --exclude 'web/public/JustX-Sync-Agent-win-x64.zip' \
    "$src"/ "$LIVE"/
  link_shared_into "$LIVE"
}

activate_release_mv() {
  local src="$1"
  echo "==> Prepare swap tree at $LIVE_NEW"
  rm -rf "$LIVE_NEW"
  mkdir -p "$LIVE_NEW"
  rsync -a \
    --exclude '.git/' \
    --exclude 'web/public/JustX-Sync-Agent-win-x64.zip' \
    "$src"/ "$LIVE_NEW"/
  # Preserve win agent zip from current live if present
  if [[ -f "$LIVE/web/public/JustX-Sync-Agent-win-x64.zip" ]]; then
    mkdir -p "$LIVE_NEW/web/public"
    cp -a "$LIVE/web/public/JustX-Sync-Agent-win-x64.zip" \
      "$LIVE_NEW/web/public/JustX-Sync-Agent-win-x64.zip"
  fi
  link_shared_into "$LIVE_NEW"

  echo "==> Atomic swap: $LIVE → $LIVE_OLD ; $LIVE_NEW → $LIVE"
  rm -rf "$LIVE_OLD"
  if [[ -e "$LIVE" || -L "$LIVE" ]]; then
    # Prefer moving into releases (same FS) when possible
    if [[ -w "$RELEASES_DIR" ]]; then
      rm -rf "$LIVE_OLD"
      mv "$LIVE" "$LIVE_OLD"
    else
      mv "$LIVE" "${LIVE}.old.$$"
      LIVE_OLD="${LIVE}.old.$$"
    fi
  fi
  mv "$LIVE_NEW" "$LIVE"
}

if [[ "$SWAP_MODE" == "mv" ]]; then
  activate_release_mv "$STAGE"
else
  # Snapshot current live into releases for emergency rollback (best-effort)
  if [[ -f "$LIVE/package.json" ]]; then
    echo "==> Snapshot current live → $LIVE_OLD (best-effort)"
    rm -rf "$LIVE_OLD"
    mkdir -p "$LIVE_OLD"
    rsync -a --exclude '.git/' "$LIVE"/ "$LIVE_OLD"/ || true
  fi
  activate_release_rsync "$STAGE"
fi

verify_runtime_deps "$LIVE" "live after activate" || die "live tree missing runtime deps after activate"

SWAP_DONE=1
rollback_live() {
  echo "==> AUTO-ROLLBACK: restoring previous release" >&2
  local restored=0
  if [[ -n "$PREV_ID" && -d "$RELEASES_DIR/$PREV_ID" && -f "$RELEASES_DIR/$PREV_ID/package.json" ]]; then
    echo "    from staged release $PREV_ID" >&2
    activate_release_rsync "$RELEASES_DIR/$PREV_ID" && restored=1
  elif [[ -d "$LIVE_OLD" && -f "$LIVE_OLD/package.json" ]]; then
    echo "    from $LIVE_OLD snapshot" >&2
    activate_release_rsync "$LIVE_OLD" && restored=1
  fi
  if [[ "$restored" -ne 1 ]]; then
    echo "ERROR: no previous release available to restore" >&2
    return 1
  fi
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
  mv "$LIVE_OLD/.git" "$LIVE/.git" || true
fi

echo "==> Pruning old release dirs (keep $KEEP_RELEASES)"
# shellcheck disable=SC2012
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null \
  | grep -vE '/(incoming|live-next|live-prev|live-failed)/$' \
  | tail -n +"$((KEEP_RELEASES + 1))" \
  | while read -r old; do
  [[ "$old" == "$STAGE/" || "$old" == "$STAGE" ]] && continue
  echo "    rm $old"
  rm -rf "$old"
done

rm -rf "$LIVE_NEW" "$LIVE_FAILED"
# Keep LIVE_OLD snapshot until next successful deploy overwrites it

if [[ "$RELEASE_TGZ" == "$RELEASES_DIR/incoming/"* ]]; then
  rm -f "$RELEASE_TGZ" "${RELEASE_TGZ}.sha256"
fi

echo "==> Deploy OK (release $RELEASE_ID, swap=$SWAP_MODE)"
