#!/usr/bin/env bash
# =============================================================================
# rollback.sh — roll back to a previous release
# Usage:
#   ./rollback.sh jbt              # previous release
#   ./rollback.sh jbt <releaseId>  # specific release
#   ./rollback.sh jbt --list
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
# shellcheck source=lib/env.sh
source "${SCRIPT_DIR}/lib/env.sh"
# shellcheck source=lib/nginx.sh
source "${SCRIPT_DIR}/lib/nginx.sh"
# shellcheck source=lib/process.sh
source "${SCRIPT_DIR}/lib/process.sh"
# shellcheck source=lib/oauth.sh
source "${SCRIPT_DIR}/lib/oauth.sh"
# shellcheck source=lib/health.sh
source "${SCRIPT_DIR}/lib/health.sh"
# shellcheck source=lib/rollback_lib.sh
source "${SCRIPT_DIR}/lib/rollback_lib.sh"

usage() {
  echo "Usage: $0 <project_id> [--list | <releaseId>]"
}

project_id=""
target=""
list_only=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) list_only=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *)
      if [[ -z "$project_id" ]]; then project_id="$1"
      else target="$1"
      fi
      shift
      ;;
  esac
done

[[ -n "$project_id" ]] || { usage; die "project_id required"; }

if [[ "$list_only" -eq 1 ]]; then
  rollback_list "$project_id"
  exit 0
fi

if [[ "$NONINTERACTIVE" != "1" ]]; then
  confirm "Roll back ${project_id} to ${target:-previous release}?" || die "Aborted"
fi

rollback_to "$project_id" "$target"
