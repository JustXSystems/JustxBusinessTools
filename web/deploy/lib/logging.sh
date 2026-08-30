#!/usr/bin/env bash
# Structured logging with timestamps, levels, and deployment log files.
# shellcheck disable=SC2034

set -euo pipefail

: "${LOG_ROOT:=/var/log/deployments}"
: "${C_RESET:=}" "${C_RED:=}" "${C_GREEN:=}" "${C_YELLOW:=}" "${C_BLUE:=}" "${C_CYAN:=}" "${C_DIM:=}" "${C_BOLD:=}"

_DEPLOY_LOG_FILE=""
_DEPLOY_STEP=0
_DEPLOY_ERRORS=0

log_init() {
  local project="${1:-global}"
  local action="${2:-deploy}"
  local log_dir="${LOG_ROOT}/${project}"
  ensure_dir "$log_dir" 755
  local ts
  ts="$(date -u +"%Y%m%dT%H%M%SZ")"
  _DEPLOY_LOG_FILE="${log_dir}/${action}-${ts}.log"
  touch "$_DEPLOY_LOG_FILE" 2>/dev/null || {
    run_elevated touch "$_DEPLOY_LOG_FILE"
    run_elevated chown "$(id -u):$(id -g)" "$_DEPLOY_LOG_FILE"
  }
  chmod 640 "$_DEPLOY_LOG_FILE" 2>/dev/null || true
  ln -sfn "$_DEPLOY_LOG_FILE" "${log_dir}/latest.log" 2>/dev/null || true
  log_info "Logging to ${_DEPLOY_LOG_FILE}"
}

_log_write() {
  local level="$1"
  shift
  local msg="$*"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local line="[$ts] [$level] $msg"
  if [[ -n "$_DEPLOY_LOG_FILE" ]]; then
    echo "$line" >> "$_DEPLOY_LOG_FILE" 2>/dev/null || true
  fi
}

log_info() {
  _log_write INFO "$*"
  echo -e "${C_CYAN}ℹ${C_RESET} $*"
}

log_ok() {
  _log_write OK "$*"
  echo -e "${C_GREEN}✔${C_RESET} $*"
}

log_warn() {
  _log_write WARN "$*"
  echo -e "${C_YELLOW}⚠${C_RESET} $*" >&2
}

log_error() {
  _DEPLOY_ERRORS=$((_DEPLOY_ERRORS + 1))
  _log_write ERROR "$*"
  echo -e "${C_RED}✖${C_RESET} $*" >&2
}

log_step() {
  _DEPLOY_STEP=$((_DEPLOY_STEP + 1))
  local title="$*"
  _log_write STEP "${_DEPLOY_STEP}. $title"
  echo
  echo -e "${C_BOLD}${C_BLUE}▸ Step ${_DEPLOY_STEP}: ${title}${C_RESET}"
}

log_debug() {
  if [[ "${DEBUG:-0}" == "1" ]]; then
    _log_write DEBUG "$*"
    echo -e "${C_DIM}· $*${C_RESET}"
  else
    _log_write DEBUG "$*"
  fi
}

# Spinner / progress for long commands
# Usage: run_with_progress "message" command args...
run_with_progress() {
  local message="$1"
  shift
  log_info "$message"

  if [[ ! -t 1 || "${CI:-false}" == "true" || "$NONINTERACTIVE" == "1" ]]; then
    "$@"
    return $?
  fi

  local logfile
  logfile="$(mktemp)"
  "$@" >"$logfile" 2>&1 &
  local pid=$!
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$(( (i + 1) % ${#spin} ))
    printf "\r${C_CYAN}%s${C_RESET} %s" "${spin:$i:1}" "$message"
    sleep 0.1
  done
  wait "$pid"
  local rc=$?
  printf "\r"
  if [[ $rc -eq 0 ]]; then
    log_ok "$message"
  else
    log_error "$message failed (exit $rc)"
    tail -n 40 "$logfile" >&2 || true
    cat "$logfile" >> "${_DEPLOY_LOG_FILE:-/dev/null}" 2>/dev/null || true
  fi
  rm -f "$logfile"
  return $rc
}

# Optional monitoring hook (webhook / file)
notify_hook() {
  local event="$1"
  local detail="${2:-}"
  local hook_script="${DEPLOY_ROOT}/hooks/on-${event}.sh"
  local webhook="${DEPLOY_WEBHOOK_URL:-}"

  if [[ -x "$hook_script" ]]; then
    log_debug "Running hook: $hook_script"
    "$hook_script" "$event" "$detail" || log_warn "Hook $event exited non-zero"
  fi

  if [[ -n "$webhook" ]]; then
    curl -fsS -X POST -H "Content-Type: application/json" \
      -d "{\"event\":\"${event}\",\"detail\":\"${detail}\",\"host\":\"$(hostname)\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
      "$webhook" >/dev/null 2>&1 || log_warn "Monitoring webhook failed"
  fi
}
