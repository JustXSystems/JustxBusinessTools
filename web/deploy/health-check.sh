#!/usr/bin/env bash
# =============================================================================
# health-check.sh — standalone health monitoring for a JustX project
# Usage: ./health-check.sh jbt [--json]
# Exit 0 = healthy, 1 = unhealthy (suitable for cron / uptime monitors)
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
# shellcheck source=lib/oauth.sh
source "${SCRIPT_DIR}/lib/oauth.sh"
# shellcheck source=lib/health.sh
source "${SCRIPT_DIR}/lib/health.sh"

JSON=0
project_id=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --help|-h)
      echo "Usage: $0 <project_id> [--json]"
      exit 0
      ;;
    *) project_id="$1"; shift ;;
  esac
done

[[ -n "$project_id" ]] || die "project_id required"
load_project "$project_id"
ensure_dir "$PROJECT_LOG_DIR" 755
log_init "$project_id" "health"

if run_full_health_check "$project_id"; then
  if [[ "$JSON" -eq 1 ]]; then
    echo "{\"ok\":true,\"project\":\"${project_id}\",\"url\":\"https://${PROJECT_DOMAIN}${PROJECT_BASE_PATH}\"}"
  fi
  exit 0
fi

if [[ "$JSON" -eq 1 ]]; then
  echo "{\"ok\":false,\"project\":\"${project_id}\"}"
fi
exit 1
