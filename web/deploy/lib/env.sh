#!/usr/bin/env bash
# Generate production-ready server/.env from credentials + secrets.

set -euo pipefail

env_generate() {
  local project_id="$1"
  local domain="$2"
  local base_path="$3"
  local api_port="$4"
  local cred_file="$5"
  local env_file="$6"
  local template="${DEPLOY_ROOT}/templates/env.production.tpl"

  log_step "Generating production environment file"

  load_env_file "$cred_file" 0

  local jwt_secret
  if [[ -f "$env_file" ]]; then
    jwt_secret="$(grep -E '^JWT_SECRET=' "$env_file" | head -1 | cut -d= -f2- || true)"
  fi
  if [[ -z "${jwt_secret:-}" ]]; then
    jwt_secret="$(generate_secret 48)"
    log_info "Generated new JWT_SECRET"
  else
    log_info "Preserving existing JWT_SECRET"
  fi

  local payment_webhook
  payment_webhook="$(generate_secret 24)"

  local origin="https://${domain}"
  local api_public="${origin}${base_path}"
  # strip trailing slash from api_public if base is /
  if [[ "$base_path" == "/" ]]; then
    api_public="$origin"
  fi

  [[ -n "${DB_PASSWORD:-}" ]] || die "DB_PASSWORD missing — run database_ensure first"
  [[ -n "${GOOGLE_CLIENT_ID:-}" ]] || die "GOOGLE_CLIENT_ID missing — run oauth_setup first"
  [[ -n "${GOOGLE_CLIENT_SECRET:-}" ]] || die "GOOGLE_CLIENT_SECRET missing"

  # Optional Razorpay from env (never invent fake live keys)
  local payment_provider="${PAYMENT_PROVIDER:-razorpay}"
  local payment_auto="${PAYMENT_AUTO_COMPLETE:-false}"
  if [[ -z "${RAZORPAY_KEY_ID:-}" ]]; then
    payment_provider="mock"
    payment_auto="false"
    log_warn "RAZORPAY_KEY_ID not set — using PAYMENT_PROVIDER=mock (set Razorpay env vars for live payments)"
  fi

  ensure_dir "$(dirname "$env_file")" 700

  # Prefer template when present; otherwise write directly
  if [[ -f "$template" ]]; then
    render_template "$template" "$env_file" \
      "PORT=${api_port}" \
      "DB_HOST=${DB_HOST:-127.0.0.1}" \
      "DB_PORT=${DB_PORT:-3306}" \
      "DB_USER=${DB_USER}" \
      "DB_PASSWORD=${DB_PASSWORD}" \
      "DB_NAME=${DB_NAME}" \
      "CORS_ORIGIN=${origin}" \
      "WEB_PUBLIC_ORIGIN=${origin}" \
      "WEB_BASE_PATH=${base_path}" \
      "NEXT_PUBLIC_BASE_PATH=${base_path}" \
      "JWT_SECRET=${jwt_secret}" \
      "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}" \
      "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}" \
      "GOOGLE_REDIRECT_URI=${api_public}/api/auth/google/callback" \
      "GOOGLE_DRIVE_REDIRECT_URI=${api_public}/api/profile/drive/callback" \
      "API_PUBLIC_URL=${api_public}" \
      "PAYMENT_PROVIDER=${payment_provider}" \
      "PAYMENT_AUTO_COMPLETE=${payment_auto}" \
      "PAYMENT_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET:-$payment_webhook}" \
      "RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID:-}" \
      "RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET:-}" \
      "RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET:-}" \
      "SUBSCRIPTION_PRO_PRICE_INR=${SUBSCRIPTION_PRO_PRICE_INR:-499}" \
      "NODE_ENV=production" \
      "REQUIRE_AUTH=true" \
      "UPLOAD_DRIVER=local" \
      "UPLOAD_DIR=./uploads"
  else
    cat > "$env_file" <<EOF
NODE_ENV=production
PORT=${api_port}
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
CORS_ORIGIN=${origin}
WEB_PUBLIC_ORIGIN=${origin}
WEB_BASE_PATH=${base_path}
NEXT_PUBLIC_BASE_PATH=${base_path}
JWT_SECRET=${jwt_secret}
REQUIRE_AUTH=true
UPLOAD_DRIVER=local
UPLOAD_DIR=./uploads
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
GOOGLE_REDIRECT_URI=${api_public}/api/auth/google/callback
GOOGLE_DRIVE_REDIRECT_URI=${api_public}/api/profile/drive/callback
API_PUBLIC_URL=${api_public}
PAYMENT_PROVIDER=${payment_provider}
PAYMENT_AUTO_COMPLETE=${payment_auto}
PAYMENT_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET:-$payment_webhook}
SUBSCRIPTION_PRO_PRICE_INR=${SUBSCRIPTION_PRO_PRICE_INR:-499}
RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID:-}
RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET:-}
RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET:-}
EOF
  fi

  chmod 600 "$env_file"
  log_ok "Wrote ${env_file} (mode 600)"
}

# Symlink/copy env into release server/.env
env_link_to_release() {
  local env_file="$1"
  local release_dir="$2"
  ensure_dir "${release_dir}/server" 755
  ln -sfn "$env_file" "${release_dir}/server/.env"
  # Also export NEXT_PUBLIC for build via a small file in shared
  log_ok "Linked server/.env → release"
}
