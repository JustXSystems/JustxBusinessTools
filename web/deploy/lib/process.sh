#!/usr/bin/env bash
# Process manager: PM2 (preferred) with systemd unit fallback.

set -euo pipefail

process_start() {
  local project_id="$1"
  local release_dir="$2"
  local web_port="$3"
  local api_port="$4"
  local base_path="$5"
  local env_file="$6"

  log_step "Starting application (PM2)"

  local eco_tpl="${DEPLOY_ROOT}/templates/pm2.ecosystem.config.cjs.tpl"
  local eco_out="${PROJECT_SHARED}/ecosystem.config.cjs"

  render_template "$eco_tpl" "$eco_out" \
    "PROJECT_ID=${project_id}" \
    "RELEASE_DIR=${release_dir}" \
    "WEB_PORT=${web_port}" \
    "API_PORT=${api_port}" \
    "BASE_PATH=${base_path}" \
    "ENV_FILE=${env_file}" \
    "LOG_DIR=${PROJECT_LOG_DIR}"

  ensure_dir "$PROJECT_LOG_DIR" 755

  pm2 delete "justx-${project_id}-api" 2>/dev/null || true
  pm2 delete "justx-${project_id}-web" 2>/dev/null || true

  # PM2 env_file support varies — load .env into the environment then start
  load_env_file "$env_file" 1
  export NODE_ENV=production
  export NEXT_PUBLIC_BASE_PATH="$base_path"
  export WEB_BASE_PATH="$base_path"
  export PORT="$api_port"

  pm2 start "$eco_out" --update-env

  pm2 save
  if [[ "${PM2_STARTUP:-1}" == "1" ]]; then
    run_elevated env PATH="$PATH" pm2 startup systemd -u "$(id -un)" --hp "$(eval echo "~$(id -un)")" \
      >/dev/null 2>&1 || log_warn "Run once as root: pm2 startup"
  fi

  log_ok "PM2 processes started: justx-${project_id}-api / justx-${project_id}-web"
}

process_stop() {
  local project_id="$1"
  pm2 stop "justx-${project_id}-api" 2>/dev/null || true
  pm2 stop "justx-${project_id}-web" 2>/dev/null || true
}

process_status() {
  local project_id="$1"
  pm2 describe "justx-${project_id}-api" >/dev/null 2>&1 && \
  pm2 describe "justx-${project_id}-web" >/dev/null 2>&1
}

process_systemd_install() {
  local project_id="$1"
  local release_dir="$2"
  local web_port="$3"
  local api_port="$4"
  local base_path="$5"
  local env_file="$6"

  local tpl="${DEPLOY_ROOT}/templates/systemd.service.tpl"
  for role in api web; do
    local port="$api_port" cmd="npm run start -w server"
    if [[ "$role" == "web" ]]; then
      port="$web_port"
      cmd="npx next start -p ${web_port}"
    fi
    local unit="justx-${project_id}-${role}.service"
    local staging="/tmp/${unit}"
    render_template "$tpl" "$staging" \
      "PROJECT_ID=${project_id}" \
      "ROLE=${role}" \
      "RELEASE_DIR=${release_dir}" \
      "PORT=${port}" \
      "BASE_PATH=${base_path}" \
      "ENV_FILE=${env_file}" \
      "USER=$(id -un)" \
      "CMD=${cmd}"
    run_elevated cp "$staging" "/etc/systemd/system/${unit}"
    run_elevated systemctl daemon-reload
    run_elevated systemctl enable --now "$unit"
  done
  log_ok "systemd units enabled for ${project_id}"
}
