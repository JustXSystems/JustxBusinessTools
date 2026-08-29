#!/usr/bin/env bash
# =============================================================================
# JustX deploy.sh — production deployment orchestrator
# Usage:
#   ./deploy.sh jbt                 # interactive / first deploy
#   DEPLOY_MODE=ci ./deploy.sh jbt  # CI/CD non-interactive
#   USE_LOCAL_SOURCE=1 ./deploy.sh jbt
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/logging.sh
source "${SCRIPT_DIR}/lib/logging.sh"
# shellcheck source=lib/secrets.sh
source "${SCRIPT_DIR}/lib/secrets.sh"
# shellcheck source=lib/validation.sh
source "${SCRIPT_DIR}/lib/validation.sh"
# shellcheck source=lib/prereqs.sh
source "${SCRIPT_DIR}/lib/prereqs.sh"
# shellcheck source=lib/database.sh
source "${SCRIPT_DIR}/lib/database.sh"
# shellcheck source=lib/oauth.sh
source "${SCRIPT_DIR}/lib/oauth.sh"
# shellcheck source=lib/env.sh
source "${SCRIPT_DIR}/lib/env.sh"
# shellcheck source=lib/build.sh
source "${SCRIPT_DIR}/lib/build.sh"
# shellcheck source=lib/nginx.sh
source "${SCRIPT_DIR}/lib/nginx.sh"
# shellcheck source=lib/process.sh
source "${SCRIPT_DIR}/lib/process.sh"
# shellcheck source=lib/health.sh
source "${SCRIPT_DIR}/lib/health.sh"
# shellcheck source=lib/rollback_lib.sh
source "${SCRIPT_DIR}/lib/rollback_lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <project_id> [options]

Options:
  --skip-prereqs     Skip dependency installation
  --skip-ssl         Skip Certbot
  --skip-seed        Skip DB seed commands
  --skip-health      Skip post-deploy health checks
  --local            Deploy from this repo (USE_LOCAL_SOURCE=1)
  --help             Show this help

Environment:
  DEPLOY_MODE=ci|interactive
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
  MYSQL_ROOT_PASSWORD / MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD
  SSL_EMAIL  DEPLOY_WEBHOOK_URL  SKIP_SSL=1

Projects: $(list_projects | tr '\n' ' ')
EOF
}

main() {
  local project_id=""
  local skip_prereqs=0 skip_health=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --skip-prereqs) skip_prereqs=1; shift ;;
      --skip-ssl) SKIP_SSL=1; export SKIP_SSL; shift ;;
      --skip-seed) SKIP_SEED=1; export SKIP_SEED; shift ;;
      --skip-health) skip_health=1; shift ;;
      --local) USE_LOCAL_SOURCE=1; export USE_LOCAL_SOURCE; shift ;;
      -*)
        die "Unknown option: $1"
        ;;
      *)
        project_id="$1"
        shift
        ;;
    esac
  done

  [[ -n "$project_id" ]] || { usage; die "project_id required"; }
  validate_project_id "$project_id"
  load_project "$project_id"
  validate_domain "$PROJECT_DOMAIN"
  validate_port "$PROJECT_WEB_PORT"
  validate_port "$PROJECT_API_PORT"
  validate_base_path "$PROJECT_BASE_PATH"

  ensure_dir "$DEPLOY_HOME" 755
  ensure_dir "$APPS_ROOT" 755
  ensure_dir "$RELEASES_ROOT" 755
  ensure_dir "$SHARED_ROOT" 755
  ensure_dir "$LOG_ROOT" 755
  ensure_dir "$PROJECT_LOG_DIR" 755
  ensure_dir "$PROJECT_SHARED" 700

  log_init "$project_id" "deploy"
  notify_hook "deploy_start" "$project_id"

  echo -e "${C_BOLD}JustX Deploy — ${PROJECT_NAME:-$project_id}${C_RESET}"
  echo -e "  Domain:  https://${PROJECT_DOMAIN}${PROJECT_BASE_PATH}/"
  echo -e "  Ports:   web=${PROJECT_WEB_PORT} api=${PROJECT_API_PORT} (PM2)"
  echo -e "  Mode:    ${DEPLOY_MODE}"
  echo

  # Trap errors → optional auto-rollback of release symlink only if previous existed
  local deploy_failed=0
  trap 'deploy_failed=1; log_error "Deploy aborted"; notify_hook deploy_fail "'"$project_id"'"; exit 1' ERR

  if [[ "$skip_prereqs" -eq 0 ]]; then
    check_prerequisites
  else
    log_warn "Skipping prerequisite check"
  fi

  validate_ports_free_or_ours "$PROJECT_WEB_PORT" "$PROJECT_API_PORT" "$project_id"

  database_ensure "$PROJECT_DB_NAME" "$PROJECT_DB_USER" "$PROJECT_CREDENTIALS"
  oauth_setup "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" "$PROJECT_CREDENTIALS"
  env_generate "$project_id" "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" \
    "$PROJECT_API_PORT" "$PROJECT_CREDENTIALS" "$PROJECT_ENV_FILE"

  # Backup DB before migrations when DB already has data
  load_env_file "$PROJECT_CREDENTIALS" 0
  if [[ -d "$PROJECT_CURRENT" ]]; then
    database_backup "$PROJECT_DB_NAME" "$PROJECT_DB_USER" "$DB_PASSWORD" \
      "${PROJECT_SHARED}/db-backups" >/dev/null || log_warn "DB backup skipped"
  fi

  build_prepare_release "$project_id" "$PROJECT_REPO_URL" "$PROJECT_REPO_BRANCH" \
    "$PROJECT_BASE_PATH" "$PROJECT_WEB_PORT" "$PROJECT_API_PORT" "$PROJECT_ENV_FILE"

  database_migrate "$RELEASE_DIR" "$PROJECT_DB_NAME" "$PROJECT_DB_USER" "$DB_PASSWORD" \
    "$PROJECT_SQL_FILES" "$PROJECT_SEED_CMD"

  build_activate_release "$RELEASE_DIR"

  # Production default: PM2 (Zigma and JBT coexist as separate PM2 apps/ports)
  if [[ "${PROCESS_MANAGER:-pm2}" == "systemd" ]]; then
    process_systemd_install "$project_id" "$PROJECT_CURRENT" "$PROJECT_WEB_PORT" \
      "$PROJECT_API_PORT" "$PROJECT_BASE_PATH" "$PROJECT_ENV_FILE"
  else
    process_start "$project_id" "$PROJECT_CURRENT" "$PROJECT_WEB_PORT" \
      "$PROJECT_API_PORT" "$PROJECT_BASE_PATH" "$PROJECT_ENV_FILE"
    log_info "PM2 apps: justx-${project_id}-web (:${PROJECT_WEB_PORT}) + justx-${project_id}-api (:${PROJECT_API_PORT})"
  fi

  # Wait for listeners
  sleep 5

  nginx_write_project_config "$project_id" "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" \
    "$PROJECT_WEB_PORT" "$PROJECT_API_PORT"
  nginx_ensure_ssl "$PROJECT_DOMAIN"
  # Re-apply domain SSL server block after certbot
  nginx_write_project_config "$project_id" "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" \
    "$PROJECT_WEB_PORT" "$PROJECT_API_PORT"

  # Logrotate
  if [[ -f "${DEPLOY_ROOT}/templates/logrotate.conf.tpl" ]]; then
    run_elevated cp "${DEPLOY_ROOT}/templates/logrotate.conf.tpl" /etc/logrotate.d/justx-deployments || true
  fi

  if [[ "$skip_health" -eq 0 ]]; then
    if ! run_full_health_check "$project_id"; then
      log_error "Health checks failed"
      if [[ -n "${PREVIOUS_RELEASE:-}" && -d "${PREVIOUS_RELEASE}" && "${AUTO_ROLLBACK_ON_FAIL:-1}" == "1" ]]; then
        log_warn "Auto-rolling back to previous release"
        rollback_to "$project_id" "$(basename "$PREVIOUS_RELEASE")" || true
      fi
      die "Deployment finished with failing health checks"
    fi
  fi

  trap - ERR
  notify_hook "deploy_ok" "$project_id:$RELEASE_ID"
  echo
  log_ok "Deployment complete: https://${PROJECT_DOMAIN}${PROJECT_BASE_PATH}"
  echo -e "  Release: ${RELEASE_ID}"
  echo -e "  Logs:    ${PROJECT_LOG_DIR}/"
  echo -e "  Env:     ${PROJECT_ENV_FILE}"
  echo -e "  PM2:     pm2 status"
}

main "$@"
