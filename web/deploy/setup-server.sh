#!/usr/bin/env bash
# =============================================================================
# setup-server.sh — one-time Hostinger/Ubuntu VPS initialization
# Run as root or a user with passwordless sudo:
#   curl ... | bash   OR   sudo ./setup-server.sh
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
# shellcheck source=lib/prereqs.sh
source "${SCRIPT_DIR}/lib/prereqs.sh"

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_HOME="${DEPLOY_HOME:-/opt/justx}"
SSH_PUBKEY="${SSH_PUBKEY:-}"

log_init "global" "setup-server"

echo -e "${C_BOLD}JustX server setup — ${HOSTNAME:-$(hostname)}${C_RESET}"
echo "  Deploy user: ${DEPLOY_USER}"
echo "  Deploy home: ${DEPLOY_HOME}"
echo

if ! is_root && ! have_sudo; then
  die "Run as root or with sudo privileges"
fi

check_prerequisites

# Create deploy user
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log_ok "User ${DEPLOY_USER} exists"
else
  run_elevated adduser --disabled-password --gecos "JustX Deploy" "$DEPLOY_USER"
  log_ok "Created user ${DEPLOY_USER}"
fi

# sudoers — deploy may run nginx/systemctl/ufw without password
SUDOERS_FILE="/etc/sudoers.d/justx-${DEPLOY_USER}"
run_elevated tee "$SUDOERS_FILE" >/dev/null <<EOF
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /bin/systemctl, /usr/sbin/ufw, /usr/bin/certbot, /bin/cp, /bin/mv, /bin/ln, /bin/mkdir, /bin/chmod, /bin/chown, /bin/touch, /bin/rm, /usr/bin/tee, /usr/sbin/mysqld, /usr/bin/mysql
EOF
run_elevated chmod 440 "$SUDOERS_FILE"
log_ok "Sudoers configured for ${DEPLOY_USER}"

# Directories
for d in "$DEPLOY_HOME" "$APPS_ROOT" "$RELEASES_ROOT" "$SHARED_ROOT" "$CONFIG_ROOT" "$LOG_ROOT" \
         /etc/nginx/justx.d /var/www/html; do
  run_elevated mkdir -p "$d"
done
run_elevated chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_HOME" "$LOG_ROOT"
run_elevated usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true

# SSH key-only hardening (optional)
if [[ -n "$SSH_PUBKEY" ]]; then
  local_home="$(eval echo "~${DEPLOY_USER}")"
  run_elevated mkdir -p "${local_home}/.ssh"
  echo "$SSH_PUBKEY" | run_elevated tee -a "${local_home}/.ssh/authorized_keys" >/dev/null
  run_elevated chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${local_home}/.ssh"
  run_elevated chmod 700 "${local_home}/.ssh"
  run_elevated chmod 600 "${local_home}/.ssh/authorized_keys"
  log_ok "SSH public key installed for ${DEPLOY_USER}"
fi

# Copy this deploy toolkit into /opt/justx/deploy if running from repo
TARGET_DEPLOY="${DEPLOY_HOME}/deploy"
if [[ "$SCRIPT_DIR" != "$TARGET_DEPLOY" ]]; then
  run_elevated mkdir -p "$TARGET_DEPLOY"
  run_elevated rsync -a --delete \
    --exclude 'releases' \
    "${SCRIPT_DIR}/" "${TARGET_DEPLOY}/"
  run_elevated chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$TARGET_DEPLOY"
  run_elevated chmod +x "${TARGET_DEPLOY}"/*.sh "${TARGET_DEPLOY}/lib"/*.sh 2>/dev/null || true
  log_ok "Deploy toolkit installed at ${TARGET_DEPLOY}"
fi

# Logrotate
run_elevated cp "${SCRIPT_DIR}/templates/logrotate.conf.tpl" /etc/logrotate.d/justx-deployments
# Fix owner name in logrotate if needed
run_elevated sed -i "s/create 0640 deploy deploy/create 0640 ${DEPLOY_USER} ${DEPLOY_USER}/" \
  /etc/logrotate.d/justx-deployments || true

# Placeholder index for /
if [[ ! -f /var/www/html/index.html ]]; then
  run_elevated tee /var/www/html/index.html >/dev/null <<'HTML'
<!DOCTYPE html><html><head><meta charset="utf-8"><title>JustX Systems</title></head>
<body style="font-family:system-ui;padding:3rem"><h1>JustX Systems</h1>
<p>Platform host is online. Apps are served under path prefixes (e.g. /jbt).</p></body></html>
HTML
fi

# SSH tip
log_info "Recommended /etc/ssh/sshd_config: PasswordAuthentication no (after key login works)"

echo
log_ok "Server initialization complete"
echo
echo "Next steps:"
echo "  1. SSH as ${DEPLOY_USER}@$(curl -fsS -m 3 ifconfig.me 2>/dev/null || echo YOUR_SERVER_IP)"
echo "  2. Export Google OAuth credentials:"
echo "       export GOOGLE_CLIENT_ID=..."
echo "       export GOOGLE_CLIENT_SECRET=..."
echo "  3. Deploy JBT:"
echo "       cd ${TARGET_DEPLOY}"
echo "       USE_LOCAL_SOURCE=1 ./deploy.sh jbt --local"
echo "     or clone the repo and run ./deploy.sh jbt"
echo
echo "DNS: Point justxsystems.com (and www) A record → this VPS before SSL will succeed."
echo "JBT production URL: https://justxsystems.com/jbt/  (PM2 web :3002, api :4002; Zigma keeps :3001)"
