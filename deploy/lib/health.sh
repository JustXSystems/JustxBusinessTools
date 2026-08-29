#!/usr/bin/env bash
# Health checks and smoke tests.

set -euo pipefail

_health_result() {
  local name="$1" ok="$2" detail="$3"
  if [[ "$ok" == "1" ]]; then
    log_ok "Health: ${name} — ${detail}"
  else
    log_error "Health: ${name} — ${detail}"
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${name}=$([[ $ok == 1 ]] && echo PASS || echo FAIL) ${detail}" \
    >> "${PROJECT_LOG_DIR}/health.log" 2>/dev/null || true
}

health_check_local_ports() {
  local web_port="$1" api_port="$2"
  local ok=1

  if curl -fsS --max-time 10 "http://127.0.0.1:${api_port}/api/health" | grep -q '"ok"'; then
    _health_result "api_local" 1 "http://127.0.0.1:${api_port}/api/health"
  else
    _health_result "api_local" 0 "API not healthy on :${api_port}"
    ok=0
  fi

  local web_code
  web_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${web_port}${PROJECT_BASE_PATH:-}" || echo 000)"
  if [[ "$web_code" =~ ^(200|301|302|308)$ ]]; then
    _health_result "web_local" 1 "HTTP ${web_code} on :${web_port}"
  else
    _health_result "web_local" 0 "HTTP ${web_code} on :${web_port}${PROJECT_BASE_PATH:-}"
    ok=0
  fi
  return $((1 - ok))
}

health_check_https() {
  local domain="$1"
  local base_path="$2"
  local paths_csv="${3:-}"
  local ok=1
  local origin="https://${domain}"

  local paths=()
  if [[ -n "$paths_csv" ]]; then
    IFS=',' read -ra paths <<< "$paths_csv"
  else
    paths=("${base_path}" "${base_path}/api/health")
  fi
  paths+=("${base_path}/api/ping")

  local path url code
  declare -A seen=()
  for path in "${paths[@]}"; do
    path="$(echo "$path" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$path" ]] && continue
    [[ -n "${seen[$path]:-}" ]] && continue
    seen[$path]=1

    url="${origin}${path}"
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -L "$url" 2>/dev/null || echo 000)"

    if [[ "$path" == *"/api/ping" ]]; then
      if [[ "$code" == "200" ]]; then
        _health_result "https_ping" 1 "${url} → ${code}"
      else
        local hcode
        hcode="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -L "${origin}${base_path}/api/health" 2>/dev/null || echo 000)"
        if [[ "$hcode" == "200" ]]; then
          _health_result "https_ping" 1 "ping N/A; health ${hcode} OK"
        else
          _health_result "https_ping" 0 "${url} → ${code}"
          ok=0
        fi
      fi
      continue
    fi

    if [[ "$code" == "200" || "$code" == "301" || "$code" == "302" || "$code" == "308" ]]; then
      _health_result "https_${path}" 1 "${url} → ${code}"
    else
      _health_result "https_${path}" 0 "${url} → ${code}"
      ok=0
    fi
  done
  return $((1 - ok))
}

health_check_database() {
  local cred_file="$1"
  load_env_file "$cred_file" 0
  if MYSQL_PWD="${DB_PASSWORD}" mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" \
      -u "${DB_USER}" "${DB_NAME}" -e "SELECT 1 AS ok" 2>/dev/null | grep -q 1; then
    _health_result "database" 1 "connected as ${DB_USER}@${DB_NAME}"
    return 0
  fi
  _health_result "database" 0 "connection failed"
  return 1
}

health_check_oauth_config() {
  local env_file="$1"
  load_env_file "$env_file" 0
  if [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" && -n "${GOOGLE_REDIRECT_URI:-}" ]]; then
    _health_result "oauth_config" 1 "client + redirect URIs configured"
    oauth_smoke_network || true
    return 0
  fi
  _health_result "oauth_config" 0 "missing Google OAuth env"
  return 1
}

run_full_health_check() {
  local project_id="$1"
  log_step "Health check & smoke tests (${project_id})"
  ensure_dir "$PROJECT_LOG_DIR" 755

  local failed=0
  health_check_local_ports "$PROJECT_WEB_PORT" "$PROJECT_API_PORT" || failed=1
  health_check_database "$PROJECT_CREDENTIALS" || failed=1
  health_check_oauth_config "$PROJECT_ENV_FILE" || failed=1
  sleep 2
  health_check_https "$PROJECT_DOMAIN" "$PROJECT_BASE_PATH" "$PROJECT_HEALTH_PATHS" || failed=1

  if [[ "$failed" -eq 0 ]]; then
    log_ok "All health checks passed"
    notify_hook "health_ok" "$project_id"
    return 0
  fi
  log_error "One or more health checks failed — see ${PROJECT_LOG_DIR}/health.log"
  notify_hook "health_fail" "$project_id"
  return 1
}
