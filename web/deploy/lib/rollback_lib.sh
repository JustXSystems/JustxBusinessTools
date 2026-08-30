#!/usr/bin/env bash
# Release rollback helpers (previous N versions).

set -euo pipefail

rollback_list() {
  local project_id="$1"
  load_project "$project_id"
  echo "Releases for ${project_id} (newest first):"
  ls -1dt "${PROJECT_RELEASES}"/*/ 2>/dev/null | while read -r d; do
    local id marker=""
    id="$(basename "$d")"
    if [[ "$(readlink -f "$PROJECT_CURRENT" 2>/dev/null)" == "$(readlink -f "$d")" ]]; then
      marker=" ← current"
    fi
    echo "  ${id}${marker}"
  done
}

rollback_to() {
  local project_id="$1"
  local target_id="${2:-}"

  load_project "$project_id"
  log_init "$project_id" "rollback"
  log_step "Rollback ${project_id}"

  local target_dir=""
  if [[ -n "$target_id" ]]; then
    target_dir="${PROJECT_RELEASES}/${target_id}"
    [[ -d "$target_dir" ]] || die "Release not found: $target_id"
  else
    # Previous = second newest
    target_dir="$(ls -1dt "${PROJECT_RELEASES}"/*/ 2>/dev/null | sed -n '2p' || true)"
    [[ -n "$target_dir" ]] || die "No previous release to roll back to"
    target_dir="${target_dir%/}"
  fi

  log_info "Switching current → $(basename "$target_dir")"

  # Re-link env + uploads
  env_link_to_release "$PROJECT_ENV_FILE" "$target_dir"
  ensure_dir "${PROJECT_SHARED}/uploads" 755
  rm -rf "${target_dir}/server/uploads"
  ln -sfn "${PROJECT_SHARED}/uploads" "${target_dir}/server/uploads"

  ln -sfn "$target_dir" "${PROJECT_APP_DIR}/current.new"
  mv -Tf "${PROJECT_APP_DIR}/current.new" "$PROJECT_CURRENT"

  process_start "$project_id" "$target_dir" "$PROJECT_WEB_PORT" "$PROJECT_API_PORT" \
    "$PROJECT_BASE_PATH" "$PROJECT_ENV_FILE"

  nginx_write_project_config "$project_id" "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" \
    "$PROJECT_WEB_PORT" "$PROJECT_API_PORT"

  sleep 3
  if run_full_health_check "$project_id"; then
    log_ok "Rollback successful"
    notify_hook "rollback_ok" "$project_id:$(basename "$target_dir")"
  else
    log_error "Rollback activated but health checks failing"
    notify_hook "rollback_degraded" "$project_id"
    return 1
  fi
}
