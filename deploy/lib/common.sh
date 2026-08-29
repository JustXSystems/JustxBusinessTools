#!/usr/bin/env bash
# Shared constants, path helpers, and project config loader.
# shellcheck disable=SC2034

set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Allow CI to point at a synced tree that is not the parent of deploy/
REPO_ROOT="${REPO_ROOT:-$(cd "${DEPLOY_ROOT}/.." && pwd)}"

# Runtime paths on the server (override via environment)
DEPLOY_HOME="${DEPLOY_HOME:-/opt/justx}"
APPS_ROOT="${APPS_ROOT:-${DEPLOY_HOME}/apps}"
RELEASES_ROOT="${RELEASES_ROOT:-${DEPLOY_HOME}/releases}"
SHARED_ROOT="${SHARED_ROOT:-${DEPLOY_HOME}/shared}"
CONFIG_ROOT="${CONFIG_ROOT:-${DEPLOY_HOME}/config}"
LOG_ROOT="${LOG_ROOT:-/var/log/deployments}"
NGINX_SITES_AVAILABLE="${NGINX_SITES_AVAILABLE:-/etc/nginx/sites-available}"
NGINX_SITES_ENABLED="${NGINX_SITES_ENABLED:-/etc/nginx/sites-enabled}"
BACKUP_KEEP="${BACKUP_KEEP:-3}"
MIN_DISK_GB="${MIN_DISK_GB:-5}"
MIN_MEM_MB="${MIN_MEM_MB:-512}"

# Modes: interactive (default) | ci
DEPLOY_MODE="${DEPLOY_MODE:-interactive}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
CI="${CI:-false}"

if [[ "${CI}" == "true" || "${NONINTERACTIVE}" == "1" || "${DEPLOY_MODE}" == "ci" ]]; then
  DEPLOY_MODE="ci"
  NONINTERACTIVE=1
fi

PROJECTS_CONF="${DEPLOY_ROOT}/config/projects.conf"
STATE_DIR="${CONFIG_ROOT}/state"

# Colors (disabled when not a TTY or NO_COLOR is set)
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_BLUE='\033[0;34m'
  C_CYAN='\033[0;36m'
  C_DIM='\033[2m'
else
  C_RESET='' C_BOLD='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_CYAN='' C_DIM=''
fi

die() {
  echo -e "${C_RED}ERROR:${C_RESET} $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

is_root() { [[ "$(id -u)" -eq 0 ]]; }

have_sudo() {
  if is_root; then return 0; fi
  command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null
}

run_elevated() {
  if is_root; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_dir() {
  local dir="$1" mode="${2:-755}"
  if [[ ! -d "$dir" ]]; then
    if [[ -w "$(dirname "$dir")" ]] || have_sudo || is_root; then
      if [[ -w "$(dirname "$dir")" ]]; then
        mkdir -p "$dir"
      else
        run_elevated mkdir -p "$dir"
      fi
    else
      die "Cannot create directory: $dir"
    fi
  fi
  chmod "$mode" "$dir" 2>/dev/null || run_elevated chmod "$mode" "$dir" || true
}

# Load a project stanza from projects.conf into PROJECT_* globals.
# Usage: load_project <project_id>
load_project() {
  local id="$1"
  [[ -f "$PROJECTS_CONF" ]] || die "Missing projects config: $PROJECTS_CONF"
  [[ -n "$id" ]] || die "Project id required"

  local in_block=0
  PROJECT_ID=""
  PROJECT_NAME=""
  PROJECT_DOMAIN=""
  PROJECT_BASE_PATH=""
  PROJECT_WEB_PORT=""
  PROJECT_API_PORT=""
  PROJECT_REPO_URL=""
  PROJECT_REPO_BRANCH="main"
  PROJECT_DB_NAME=""
  PROJECT_DB_USER=""
  PROJECT_APP_DIR=""
  PROJECT_HEALTH_PATHS=""
  PROJECT_SQL_FILES=""
  PROJECT_SEED_CMD=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    # strip comments / blank
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$line" ]] && continue

    if [[ "$line" =~ ^\[(.+)\]$ ]]; then
      if [[ "${BASH_REMATCH[1]}" == "$id" ]]; then
        in_block=1
        PROJECT_ID="$id"
      else
        in_block=0
      fi
      continue
    fi

    if [[ "$in_block" -eq 1 && "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      case "$key" in
        NAME) PROJECT_NAME="$val" ;;
        DOMAIN) PROJECT_DOMAIN="$val" ;;
        BASE_PATH) PROJECT_BASE_PATH="$val" ;;
        WEB_PORT) PROJECT_WEB_PORT="$val" ;;
        API_PORT) PROJECT_API_PORT="$val" ;;
        REPO_URL) PROJECT_REPO_URL="$val" ;;
        REPO_BRANCH) PROJECT_REPO_BRANCH="$val" ;;
        DB_NAME) PROJECT_DB_NAME="$val" ;;
        DB_USER) PROJECT_DB_USER="$val" ;;
        APP_DIR) PROJECT_APP_DIR="$val" ;;
        HEALTH_PATHS) PROJECT_HEALTH_PATHS="$val" ;;
        SQL_FILES) PROJECT_SQL_FILES="$val" ;;
        SEED_CMD) PROJECT_SEED_CMD="$val" ;;
      esac
    fi
  done < "$PROJECTS_CONF"

  [[ -n "$PROJECT_ID" ]] || die "Unknown project: $id (not found in $PROJECTS_CONF)"
  [[ -n "$PROJECT_DOMAIN" ]] || die "Project $id missing DOMAIN"
  [[ -n "$PROJECT_WEB_PORT" ]] || die "Project $id missing WEB_PORT"
  [[ -n "$PROJECT_API_PORT" ]] || die "Project $id missing API_PORT"
  [[ -n "$PROJECT_BASE_PATH" ]] || PROJECT_BASE_PATH="/"
  [[ -n "$PROJECT_APP_DIR" ]] || PROJECT_APP_DIR="${APPS_ROOT}/${PROJECT_ID}"
  [[ -n "$PROJECT_REPO_BRANCH" ]] || PROJECT_REPO_BRANCH="main"
  [[ -n "$PROJECT_HEALTH_PATHS" ]] || PROJECT_HEALTH_PATHS="${PROJECT_BASE_PATH},${PROJECT_BASE_PATH}/api/health"

  PROJECT_SHARED="${SHARED_ROOT}/${PROJECT_ID}"
  PROJECT_RELEASES="${RELEASES_ROOT}/${PROJECT_ID}"
  PROJECT_CURRENT="${PROJECT_APP_DIR}/current"
  PROJECT_ENV_FILE="${PROJECT_SHARED}/.env"
  PROJECT_CREDENTIALS="${PROJECT_SHARED}/credentials.env"
  PROJECT_NGINX_CONF="justx-${PROJECT_ID}"
  PROJECT_LOG_DIR="${LOG_ROOT}/${PROJECT_ID}"
}

list_projects() {
  grep -E '^\[' "$PROJECTS_CONF" | sed 's/^\[//;s/\]$//' || true
}

# Expand template: replaces {{VAR}} with value of shell var VAR (or named mapping)
render_template() {
  local template="$1"
  local output="$2"
  shift 2
  [[ -f "$template" ]] || die "Template not found: $template"

  local content
  content="$(cat "$template")"
  local pair key val
  for pair in "$@"; do
    key="${pair%%=*}"
    val="${pair#*=}"
    # escape sed specials in val
    val_escaped="$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')"
    content="$(printf '%s' "$content" | sed "s/{{${key}}}/${val_escaped}/g")"
  done
  # fail if unresolved placeholders remain (except optional ones marked OPTIONAL_)
  if printf '%s' "$content" | grep -qE '\{\{[A-Z0-9_]+\}\}'; then
    local leftover
    leftover="$(printf '%s' "$content" | grep -oE '\{\{[A-Z0-9_]+\}\}' | sort -u | tr '\n' ' ')"
    die "Unresolved template placeholders in $(basename "$template"): $leftover"
  fi
  printf '%s\n' "$content" > "$output"
}

confirm() {
  local prompt="${1:-Continue?}"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    return 0
  fi
  local reply
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

prompt_value() {
  local var_name="$1"
  local prompt="$2"
  local default="${3:-}"
  local secret="${4:-0}"
  local current="${!var_name:-}"

  if [[ -n "$current" ]]; then
    return 0
  fi
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    if [[ -n "$default" ]]; then
      printf -v "$var_name" '%s' "$default"
      return 0
    fi
    die "Missing required value in CI mode: $var_name"
  fi

  local reply
  if [[ "$secret" == "1" ]]; then
    read -r -s -p "$prompt: " reply
    echo
  else
    if [[ -n "$default" ]]; then
      read -r -p "$prompt [$default]: " reply
      reply="${reply:-$default}"
    else
      read -r -p "$prompt: " reply
    fi
  fi
  printf -v "$var_name" '%s' "$reply"
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

timestamp() { date -u +"%Y%m%dT%H%M%SZ"; }

atomic_write() {
  local target="$1"
  local tmp
  tmp="$(mktemp "${target}.XXXXXX")"
  cat > "$tmp"
  chmod "${2:-644}" "$tmp"
  mv -f "$tmp" "$target"
}

secure_write() {
  local target="$1"
  local mode="${2:-600}"
  local dir
  dir="$(dirname "$target")"
  ensure_dir "$dir" 700
  atomic_write "$target" "$mode"
  chmod "$mode" "$target"
}
