#!/usr/bin/env bash
# Self-healing prerequisite checker — detect and install missing deps.

set -euo pipefail

_apt_update_done=0

apt_update_once() {
  if [[ "$_apt_update_done" -eq 0 ]]; then
    run_with_progress "Updating apt package index" run_elevated apt-get update -qq
    _apt_update_done=1
  fi
}

apt_install() {
  apt_update_once
  run_with_progress "Installing: $*" run_elevated DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

ensure_nodejs() {
  local need_major="${1:-20}"
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if (( major >= need_major )); then
      log_ok "Node.js $(node -v) (>= v${need_major})"
      return 0
    fi
    log_warn "Node.js $(node -v) is below v${need_major} — upgrading"
  else
    log_info "Node.js not found — installing v${need_major}.x"
  fi

  apt_install ca-certificates curl gnupg
  if [[ ! -f /etc/apt/sources.list.d/nodesource.list ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${need_major}.x" | run_elevated bash -
  fi
  apt_install nodejs
  log_ok "Node.js $(node -v) / npm $(npm -v)"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_ok "Docker $(docker --version | head -1)"
  else
    log_info "Installing Docker"
    apt_install docker.io
    run_elevated systemctl enable --now docker || true
    if ! is_root; then
      run_elevated usermod -aG docker "$(id -un)" || true
      log_warn "Added $(id -un) to docker group — re-login may be required"
    fi
    log_ok "Docker installed"
  fi

  if docker compose version >/dev/null 2>&1; then
    log_ok "Docker Compose $(docker compose version --short 2>/dev/null || echo present)"
  elif command -v docker-compose >/dev/null 2>&1; then
    log_ok "docker-compose $(docker-compose --version)"
  else
    apt_install docker-compose-v2 2>/dev/null || apt_install docker-compose || true
  fi
}

ensure_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    log_ok "nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"
  else
    apt_install nginx
    run_elevated systemctl enable --now nginx
    log_ok "nginx installed"
  fi
}

ensure_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    log_ok "certbot $(certbot --version 2>&1 | head -1)"
  else
    apt_install certbot python3-certbot-nginx
    log_ok "certbot installed"
  fi
}

ensure_mysql_client() {
  if command -v mysql >/dev/null 2>&1; then
    log_ok "mysql client present"
  else
    apt_install mysql-client || apt_install default-mysql-client
    log_ok "mysql client installed"
  fi
}

ensure_mysql_server() {
  if command -v mysqld >/dev/null 2>&1 || systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mariadb 2>/dev/null; then
    log_ok "MySQL/MariaDB server running"
    return 0
  fi
  if [[ "${INSTALL_MYSQL_SERVER:-1}" == "1" ]]; then
    log_info "Installing MySQL server"
    apt_install mysql-server
    run_elevated systemctl enable --now mysql || run_elevated systemctl enable --now mariadb || true
    log_ok "MySQL server installed"
  else
    log_warn "MySQL server not detected (set INSTALL_MYSQL_SERVER=1 to auto-install)"
  fi
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log_ok "pm2 $(pm2 -v)"
  else
    run_with_progress "Installing PM2 globally" run_elevated npm install -g pm2
    log_ok "pm2 installed"
  fi
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    log_ok "git $(git --version | awk '{print $3}')"
  else
    apt_install git
    log_ok "git installed"
  fi
}

ensure_system_packages() {
  local pkgs=(
    curl wget ca-certificates build-essential
    openssl gnupg lsb-release ufw fail2ban
    jq unzip rsync logrotate
  )
  local missing=()
  local p
  for p in "${pkgs[@]}"; do
    if ! dpkg -s "$p" >/dev/null 2>&1; then
      missing+=("$p")
    fi
  done
  if ((${#missing[@]})); then
    apt_install "${missing[@]}"
  fi
  log_ok "System packages present"
}

configure_firewall() {
  if ! command -v ufw >/dev/null 2>&1; then
    return 0
  fi
  log_info "Configuring UFW (SSH/HTTP/HTTPS)"
  run_elevated ufw allow OpenSSH >/dev/null 2>&1 || run_elevated ufw allow 22/tcp >/dev/null 2>&1 || true
  run_elevated ufw allow 80/tcp >/dev/null 2>&1 || true
  run_elevated ufw allow 443/tcp >/dev/null 2>&1 || true
  # Non-interactive enable
  echo "y" | run_elevated ufw enable >/dev/null 2>&1 || true
  log_ok "Firewall rules applied (22/80/443)"
}

configure_unattended_upgrades() {
  apt_install unattended-upgrades apt-listchanges 2>/dev/null || true
  if [[ -d /etc/apt/apt.conf.d ]]; then
    run_elevated tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
    log_ok "Unattended security upgrades enabled"
  fi
}

check_prerequisites() {
  log_step "Self-healing prerequisite check"
  validate_resources
  ensure_system_packages
  ensure_git
  ensure_nodejs 20
  ensure_docker
  ensure_nginx
  ensure_certbot
  ensure_mysql_client
  ensure_mysql_server
  ensure_pm2

  if [[ "${CONFIGURE_FIREWALL:-1}" == "1" ]]; then
    configure_firewall
  fi
  if [[ "${CONFIGURE_AUTO_UPDATES:-1}" == "1" ]]; then
    configure_unattended_upgrades
  fi

  log_ok "All prerequisites satisfied"
}
