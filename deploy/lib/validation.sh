#!/usr/bin/env bash
# Input and resource validation helpers.

set -euo pipefail

validate_project_id() {
  local id="$1"
  [[ "$id" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Invalid project id: $id (use lowercase alphanumeric, -, _)"
}

validate_domain() {
  local d="$1"
  [[ "$d" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || die "Invalid domain: $d"
}

validate_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 65535 )) || die "Invalid port: $p"
}

validate_base_path() {
  local bp="$1"
  [[ "$bp" =~ ^/ ]] || die "BASE_PATH must start with / (got: $bp)"
  [[ ! "$bp" =~ /$ || "$bp" == "/" ]] || die "BASE_PATH must not end with / unless it is /"
}

validate_resources() {
  log_step "Validating disk, memory, and CPU"

  local disk_avail_gb
  disk_avail_gb="$(df -BG --output=avail "${DEPLOY_HOME:-/}" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)"
  if [[ -z "$disk_avail_gb" || "$disk_avail_gb" == "0" ]]; then
    disk_avail_gb="$(df -BG / | awk 'NR==2 {print $4}' | tr -dc '0-9')"
  fi
  if (( disk_avail_gb < MIN_DISK_GB )); then
    die "Insufficient disk space: ${disk_avail_gb}GB available (need ≥ ${MIN_DISK_GB}GB)"
  fi
  log_ok "Disk: ${disk_avail_gb}GB available"

  local mem_mb
  mem_mb="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
  if (( mem_mb < MIN_MEM_MB )); then
    die "Insufficient memory: ${mem_mb}MB available (need ≥ ${MIN_MEM_MB}MB)"
  fi
  log_ok "Memory: ${mem_mb}MB available"

  local cpus
  cpus="$(nproc 2>/dev/null || echo 1)"
  log_ok "CPU cores: ${cpus}"
}

validate_ports_free_or_ours() {
  local web="$1" api="$2" project="$3"
  for port in "$web" "$api"; do
    if port_in_use "$port"; then
      # Allow if already owned by our pm2/systemd process for this project
      if command -v pm2 >/dev/null 2>&1; then
        if pm2 jlist 2>/dev/null | grep -q "justx-${project}"; then
          log_info "Port $port in use by existing justx-${project} process (OK for redeploy)"
          continue
        fi
      fi
      log_warn "Port $port appears in use — ensure no conflicting service"
    else
      log_ok "Port $port is free"
    fi
  done
}

validate_oauth_credentials() {
  local client_id="$1"
  local client_secret="$2"
  [[ -n "$client_id" ]] || die "GOOGLE_CLIENT_ID is empty"
  [[ -n "$client_secret" ]] || die "GOOGLE_CLIENT_SECRET is empty"
  [[ "$client_id" == *".apps.googleusercontent.com" ]] || \
    log_warn "GOOGLE_CLIENT_ID does not look like a Google OAuth client id"
  [[ ${#client_secret} -ge 10 ]] || die "GOOGLE_CLIENT_SECRET looks too short"
  log_ok "OAuth credentials present and look valid"
}

validate_url_reachable() {
  local url="$1"
  local expect_code="${2:-200}"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -k "$url" 2>/dev/null || echo "000")"
  [[ "$code" == "$expect_code" || "$code" == "301" || "$code" == "302" || "$code" == "308" ]]
}
