#!/usr/bin/env bash
# Clone/pull, install, build, release rotation.

set -euo pipefail

build_prepare_release() {
  local project_id="$1"
  local repo_url="$2"
  local branch="$3"
  local base_path="$4"
  local web_port="$5"
  local api_port="$6"
  local env_file="$7"

  log_step "Application build & release"

  ensure_dir "$PROJECT_RELEASES" 755
  ensure_dir "$PROJECT_APP_DIR" 755
  ensure_dir "$PROJECT_SHARED" 700

  local release_id
  release_id="$(timestamp)"
  local release_dir="${PROJECT_RELEASES}/${release_id}"
  ensure_dir "$release_dir" 755

  # Source: clone fresh OR copy from local REPO_ROOT when REPO_URL empty / USE_LOCAL_SOURCE=1
  if [[ "${USE_LOCAL_SOURCE:-0}" == "1" || -z "$repo_url" ]]; then
    log_info "Using local source: ${REPO_ROOT}"
    rsync -a --delete \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude 'web/.next' \
      --exclude 'web/out' \
      --exclude 'server/.env' \
      --exclude 'deploy/releases' \
      --exclude 'test-results' \
      --exclude 'android' \
      --exclude 'desktop-sync-agent/node_modules' \
      "${REPO_ROOT}/" "${release_dir}/"
  else
    if [[ -d "${PROJECT_APP_DIR}/repo/.git" ]]; then
      log_info "Pulling ${branch} in cached repo"
      git -C "${PROJECT_APP_DIR}/repo" fetch --depth 1 origin "$branch"
      git -C "${PROJECT_APP_DIR}/repo" checkout -B "$branch" "origin/${branch}"
    else
      log_info "Cloning ${repo_url} (${branch})"
      ensure_dir "${PROJECT_APP_DIR}" 755
      git clone --depth 1 --branch "$branch" "$repo_url" "${PROJECT_APP_DIR}/repo"
    fi
    rsync -a --delete \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude 'web/.next' \
      --exclude 'server/.env' \
      "${PROJECT_APP_DIR}/repo/" "${release_dir}/"
  fi

  env_link_to_release "$env_file" "$release_dir"

  # Uploads shared across releases
  ensure_dir "${PROJECT_SHARED}/uploads" 755
  rm -rf "${release_dir}/server/uploads"
  ln -sfn "${PROJECT_SHARED}/uploads" "${release_dir}/server/uploads"

  (
    cd "$release_dir"
    export NODE_ENV=production
    export NEXT_PUBLIC_BASE_PATH="$base_path"
    export WEB_BASE_PATH="$base_path"

    # Keep devDependencies: server start uses tsx; Next build needs its toolchain
    run_with_progress "npm ci" npm ci
    run_with_progress "Building web (basePath=${base_path})" \
      env NEXT_PUBLIC_BASE_PATH="$base_path" npm run build -w web
  )

  # Write release metadata
  cat > "${release_dir}/.release.json" <<EOF
{
  "id": "${release_id}",
  "project": "${project_id}",
  "basePath": "${base_path}",
  "webPort": ${web_port},
  "apiPort": ${api_port},
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  RELEASE_DIR="$release_dir"
  RELEASE_ID="$release_id"
  export RELEASE_DIR RELEASE_ID
  log_ok "Release built: ${release_id}"
}

build_activate_release() {
  local release_dir="$1"
  local previous=""
  if [[ -L "$PROJECT_CURRENT" || -d "$PROJECT_CURRENT" ]]; then
    previous="$(readlink -f "$PROJECT_CURRENT" 2>/dev/null || true)"
  fi

  ln -sfn "$release_dir" "${PROJECT_APP_DIR}/current.new"
  mv -Tf "${PROJECT_APP_DIR}/current.new" "$PROJECT_CURRENT"
  log_ok "Activated release → ${PROJECT_CURRENT}"

  # Prune old releases (keep BACKUP_KEEP + current)
  local keep=$((BACKUP_KEEP + 1))
  ls -1dt "${PROJECT_RELEASES}"/*/ 2>/dev/null | tail -n "+$((keep + 1))" | while read -r old; do
    log_info "Pruning old release: $(basename "$old")"
    rm -rf "$old"
  done

  PREVIOUS_RELEASE="$previous"
  export PREVIOUS_RELEASE
}
