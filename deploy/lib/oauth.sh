#!/usr/bin/env bash
# Google Cloud OAuth setup — interactive or environment-driven.
# Cannot create OAuth clients without GCP API access; guides + validates instead.

set -euo pipefail

oauth_print_instructions() {
  local domain="$1"
  local base_path="$2"
  local origin="https://${domain}"
  local api_base="${origin}${base_path}"

  cat <<EOF

${C_BOLD}Google Cloud OAuth setup (once per platform)${C_RESET}
Sign in as justxsystems@gmail.com → https://console.cloud.google.com/

1. Create/select project (e.g. JustX-JBT)
2. Enable APIs: Google Drive API (+ People / userinfo for sign-in)
3. OAuth consent screen → External → JustX Business Tools
4. Credentials → Create OAuth client ID → Web application
5. Authorized JavaScript origins:
     ${origin}
6. Authorized redirect URIs:
     ${api_base}/api/auth/google/callback
     ${api_base}/api/profile/drive/callback

Copy Client ID and Client Secret. You can also export:
  export GOOGLE_CLIENT_ID=....apps.googleusercontent.com
  export GOOGLE_CLIENT_SECRET=....

EOF
}

oauth_setup() {
  local domain="$1"
  local base_path="$2"
  local cred_file="$3"

  log_step "Google Cloud OAuth credentials"

  # Prefer env, then existing credentials store
  if [[ -z "${GOOGLE_CLIENT_ID:-}" && -f "$cred_file" ]]; then
    GOOGLE_CLIENT_ID="$(get_credential "$cred_file" "GOOGLE_CLIENT_ID" || true)"
    GOOGLE_CLIENT_SECRET="$(get_credential "$cred_file" "GOOGLE_CLIENT_SECRET" || true)"
  fi

  if [[ -z "${GOOGLE_CLIENT_ID:-}" || -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
    oauth_print_instructions "$domain" "$base_path"
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      die "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for CI/non-interactive deploy"
    fi
    prompt_value GOOGLE_CLIENT_ID "Google OAuth Client ID"
    prompt_value GOOGLE_CLIENT_SECRET "Google OAuth Client Secret" "" 1
  else
    log_info "Using OAuth credentials from environment or store"
  fi

  validate_oauth_credentials "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET"

  # Merge into credentials file (preserve DB_*)
  local db_host db_port db_name db_user db_pass
  db_host="$(get_credential "$cred_file" "DB_HOST" 2>/dev/null || echo "${MYSQL_HOST:-127.0.0.1}")"
  db_port="$(get_credential "$cred_file" "DB_PORT" 2>/dev/null || echo "${MYSQL_PORT:-3306}")"
  db_name="$(get_credential "$cred_file" "DB_NAME" 2>/dev/null || echo "")"
  db_user="$(get_credential "$cred_file" "DB_USER" 2>/dev/null || echo "")"
  db_pass="$(get_credential "$cred_file" "DB_PASSWORD" 2>/dev/null || echo "")"

  local lines=()
  [[ -n "$db_host" ]] && lines+=("DB_HOST=${db_host}")
  [[ -n "$db_port" ]] && lines+=("DB_PORT=${db_port}")
  [[ -n "$db_name" ]] && lines+=("DB_NAME=${db_name}")
  [[ -n "$db_user" ]] && lines+=("DB_USER=${db_user}")
  [[ -n "$db_pass" ]] && lines+=("DB_PASSWORD=${db_pass}")
  lines+=("GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}")
  lines+=("GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}")
  save_credentials "$cred_file" "${lines[@]}"

  export GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  log_ok "OAuth credentials stored securely ($(basename "$cred_file"))"
}

# Lightweight check that Google's token endpoint is reachable (network/OAuth infra)
oauth_smoke_network() {
  if curl -fsS --max-time 10 "https://oauth2.googleapis.com/" -o /dev/null 2>/dev/null || \
     curl -fsS --max-time 10 -o /dev/null -w "%{http_code}" "https://accounts.google.com" | grep -qE '^[23]'; then
    log_ok "Google OAuth endpoints reachable"
  else
    log_warn "Could not reach Google OAuth endpoints (network/firewall?)"
  fi
}
