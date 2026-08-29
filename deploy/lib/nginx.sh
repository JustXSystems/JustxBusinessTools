#!/usr/bin/env bash
# Nginx reverse proxy + SSL for path-based multi-project hosting on one domain.

set -euo pipefail

_domain_slug() {
  echo "$1" | tr '[:upper.]' '[:lower:]' | sed 's/[^a-z0-9]/-/g'
}

_domain_alt() {
  local d="$1"
  if [[ "$d" == www.* ]]; then
    echo "${d#www.}"
  else
    echo "www.${d}"
  fi
}

_cert_name_for() {
  local domain="$1"
  if [[ -d "/etc/letsencrypt/live/${domain}" ]]; then
    echo "$domain"
  elif [[ -d "/etc/letsencrypt/live/$(_domain_alt "$domain")" ]]; then
    _domain_alt "$domain"
  else
    echo "$domain"
  fi
}

_ensure_catchall_ssl() {
  run_elevated mkdir -p /etc/nginx/ssl
  if [[ ! -f /etc/nginx/ssl/justx-catchall.crt ]]; then
    run_elevated openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout /etc/nginx/ssl/justx-catchall.key \
      -out /etc/nginx/ssl/justx-catchall.crt \
      -subj "/CN=justx-catchall" >/dev/null 2>&1
  fi
}

nginx_write_project_config() {
  local project_id="$1"
  local domain="$2"
  local base_path="$3"
  local web_port="$4"
  local api_port="$5"

  log_step "Nginx reverse proxy (${domain}${base_path})"

  local slug
  slug="$(_domain_slug "$domain")"
  local alt
  alt="$(_domain_alt "$domain")"
  local include_dir="/etc/nginx/justx.d/${slug}"
  local loc_staging="${PROJECT_SHARED}/nginx-location-${project_id}.conf"
  local loc_target="${include_dir}/${project_id}.conf"
  local site_name="justx-${slug}"
  local site_target="${NGINX_SITES_AVAILABLE}/${site_name}"

  ensure_dir "$PROJECT_SHARED" 700
  ensure_dir "$PROJECT_LOG_DIR" 755
  run_elevated mkdir -p "$include_dir" /var/www/html
  _ensure_catchall_ssl

  # Upstreams must live in http context (conf.d), not inside server{}
  local up_staging="${PROJECT_SHARED}/nginx-upstream-${project_id}.conf"
  local up_target="/etc/nginx/conf.d/justx-${project_id}-upstream.conf"
  render_template "${DEPLOY_ROOT}/templates/nginx.upstream.conf.tpl" "$up_staging" \
    "PROJECT_ID=${project_id}" \
    "WEB_PORT=${web_port}" \
    "API_PORT=${api_port}"
  run_elevated cp "$up_staging" "$up_target"

  # Per-project location snippet (server context)
  render_template "${DEPLOY_ROOT}/templates/nginx.project.conf.tpl" "$loc_staging" \
    "PROJECT_ID=${project_id}" \
    "DOMAIN=${domain}" \
    "BASE_PATH=${base_path}" \
    "WEB_PORT=${web_port}" \
    "API_PORT=${api_port}"

  if [[ -f "$loc_target" ]]; then
    run_elevated cp -a "$loc_target" "${loc_target}.bak.$(timestamp)"
  fi
  run_elevated cp "$loc_staging" "$loc_target"

  # Domain server block — HTTP bootstrap or SSL
  local cert_name
  cert_name="$(_cert_name_for "$domain")"
  local domain_staging="${PROJECT_SHARED}/nginx-domain-${slug}.conf"
  local has_ssl=0
  if [[ -f "/etc/letsencrypt/live/${cert_name}/fullchain.pem" ]]; then
    has_ssl=1
  fi

  # Avoid duplicate limit_req_zone: strip from domain tpl if already in another justx site
  if [[ "$has_ssl" -eq 1 ]]; then
    render_template "${DEPLOY_ROOT}/templates/nginx.domain.conf.tpl" "$domain_staging" \
      "DOMAIN=${domain}" \
      "DOMAIN_ALT=${alt}" \
      "DOMAIN_SLUG=${slug}" \
      "CERT_NAME=${cert_name}"
  else
    render_template "${DEPLOY_ROOT}/templates/nginx.domain.http.conf.tpl" "$domain_staging" \
      "DOMAIN=${domain}" \
      "DOMAIN_ALT=${alt}" \
      "DOMAIN_SLUG=${slug}"
  fi

  # Dedupe limit_req_zone if site already enabled with the zone
  if grep -rqs "zone=justx_global_limit" "${NGINX_SITES_ENABLED}/" 2>/dev/null && \
     [[ ! -f "${NGINX_SITES_ENABLED}/${site_name}" ]]; then
    sed -i '/limit_req_zone.*justx_global_limit/d' "$domain_staging" || true
  fi

  if [[ -f "$site_target" ]]; then
    run_elevated cp -a "$site_target" "${site_target}.bak.$(timestamp)"
  fi
  run_elevated cp "$domain_staging" "$site_target"
  run_elevated ln -sfn "$site_target" "${NGINX_SITES_ENABLED}/${site_name}"

  # Catch-all once
  local catch_target="${NGINX_SITES_AVAILABLE}/justx-catchall"
  if [[ ! -f "$catch_target" ]]; then
    run_elevated cp "${DEPLOY_ROOT}/templates/nginx.catch-all.conf.tpl" "$catch_target"
    run_elevated ln -sfn "$catch_target" "${NGINX_SITES_ENABLED}/justx-catchall"
  fi

  if [[ -L "${NGINX_SITES_ENABLED}/default" ]]; then
    run_elevated rm -f "${NGINX_SITES_ENABLED}/default"
  fi

  # nginx fails on include *.conf when the glob matches nothing
  if ! compgen -G "${include_dir}/*.conf" >/dev/null; then
    run_elevated tee "${include_dir}/_empty.conf" >/dev/null <<< "# placeholder"
  fi

  if ! run_elevated nginx -t; then
    die "nginx -t failed — config not reloaded"
  fi
  run_elevated systemctl reload nginx
  log_ok "Nginx config installed (${site_name} + ${project_id}.conf)"
}

nginx_ensure_ssl() {
  local domain="$1"
  local email="${SSL_EMAIL:-admin@${domain#www.}}"

  if [[ "${SKIP_SSL:-0}" == "1" ]]; then
    log_warn "SKIP_SSL=1 — skipping Certbot"
    return 0
  fi

  log_step "SSL certificate (Let's Encrypt)"

  local cert_name
  cert_name="$(_cert_name_for "$domain")"
  if [[ -d "/etc/letsencrypt/live/${cert_name}" ]]; then
    log_ok "Certificate already present for ${cert_name}"
    return 0
  fi

  local alt
  alt="$(_domain_alt "$domain")"
  local args=(--nginx -d "$domain")
  # Only add alt if DNS likely exists; certbot fails if not
  if [[ "${SSL_INCLUDE_ALT:-1}" == "1" ]]; then
    args+=(-d "$alt")
  fi

  if [[ "$NONINTERACTIVE" == "1" ]]; then
    run_elevated certbot "${args[@]}" --non-interactive --agree-tos -m "$email" --redirect \
      || run_elevated certbot --nginx -d "$domain" --non-interactive --agree-tos -m "$email" --redirect \
      || log_warn "Certbot failed — ensure DNS A/AAAA for ${domain} points to this VPS"
  else
    run_elevated certbot "${args[@]}" --agree-tos -m "$email" --redirect \
      || run_elevated certbot --nginx -d "$domain" --agree-tos -m "$email" --redirect \
      || log_warn "Certbot failed — check DNS for ${domain}"
  fi

  # Re-write domain SSL server block now that certs exist
  if [[ -d "/etc/letsencrypt/live/$(_cert_name_for "$domain")" ]]; then
    # Caller should re-invoke nginx_write_project_config; we reload domain file here
    log_ok "SSL certificate issued"
  fi
}

nginx_rollback_config() {
  local project_id="$1"
  local domain="${2:-$PROJECT_DOMAIN}"
  local slug
  slug="$(_domain_slug "$domain")"
  local loc_target="/etc/nginx/justx.d/${slug}/${project_id}.conf"
  local bak
  bak="$(ls -1t "${loc_target}.bak."* 2>/dev/null | head -1 || true)"
  if [[ -n "$bak" ]]; then
    run_elevated cp -a "$bak" "$loc_target"
    run_elevated nginx -t && run_elevated systemctl reload nginx
    log_ok "Restored nginx location from $(basename "$bak")"
  else
    log_warn "No nginx location backup for ${project_id}"
  fi
}
