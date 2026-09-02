# JustX Business Tools — Observability

**Goal:** Dynatrace-class *operations* without rebuilding APM inside `/admin`.

| Layer | Tool | Role |
|-------|------|------|
| Control tower | Admin → **Operations** (`/jbt/admin/ops`) | Health, error pulse, deep links |
| Logs + metrics UI | **Grafana** + **Loki** + **Prometheus** | Search logs, dashboards |
| Log shipper | **Grafana Alloy** | Scrapes PM2 JSON logs → Loki |
| Errors | **Sentry** or **GlitchTip** via `SENTRY_DSN` | Exception store |
| Alerts | `ERROR_WEBHOOK_URL` + optional Grafana Alerting | Slack/Discord page |

Do **not** install SigNoz/ClickHouse on the same small Hostinger KVM as MySQL + PM2.

**This guide assumes your production layout** (see [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md)):

| Item | Value |
|------|--------|
| VPS | Hostinger KVM — `193.203.161.219` |
| SSH user | `deploy` |
| App path | `/var/www/jbt` |
| PM2 logs | `/home/deploy/.pm2/logs` |
| Public Grafana URL | `https://justxsystems.com/grafana` |
| Grafana bind | `127.0.0.1:3003` (Docker → nginx only) |

---

## Checklist (do in order)

1. [§0](#0-before-you-start) SSH in, check RAM / OS  
2. [§A](#a-install-docker-engine--compose-on-the-vps) Install Docker + Compose (if missing)  
3. [§B](#b-pull-latest-code-with-observability-files) Pull latest `master` (includes `deploy/observability/`)  
4. [§C](#c-configure-and-start-the-grafana-stack) Configure `.env` and `docker compose up -d`  
5. [§D](#d-expose-grafana-through-nginx) Add nginx `/grafana/` location  
6. [§E](#e-wire-the-api-env-and-reload-pm2) Set API env (`LOG_FORMAT`, `GRAFANA_PUBLIC_URL`, …) and reload PM2  
7. [§F](#f-verify-end-to-end) Verify Grafana + Admin Ops + Loki queries  
8. [§G](#g-using-grafana-to-view-and-analyze-jbt-logs) **Day-to-day: view & analyze logs in Grafana**  
9. [§G.6](#g6-triage-one-http-request-end-to-end) **Triage one HTTP request end-to-end**  
10. Optional: [§3](#3-sentry--glitchtip-exception-store) Sentry / GlitchTip  
11. Optional: [§D.3](#d3-strongly-recommended-http-basic-auth-in-front-of-grafana) nginx basic auth for Grafana  
12. [§4](#4-phase-4--tempo-traces--prometheus-exporters) **Phase 4:** Tempo + OTel + node/MySQL exporters  

---

## 0. Before you start

### 0.1 SSH into the VPS

From your laptop (Windows PowerShell or terminal), using your deploy key:

```bash
ssh -i ~/.ssh/jbt_deploy deploy@193.203.161.219
```

You should land as user `deploy` in a shell on the VPS.

### 0.2 Confirm OS and memory

Docker needs a supported Linux distro (Hostinger KVMs are usually **Ubuntu 22.04/24.04**). Check:

```bash
cat /etc/os-release
free -h
df -h /
```

**RAM guidance**

| Free RAM (approx.) | Action |
|--------------------|--------|
| **≥ 2 GB free** after MySQL + PM2 | Safe to run this stack (~1.5–1.7 GB mem limits total) |
| **~1–1.5 GB free** | Start stack; watch `free -h` / `docker stats`. If the box swaps heavily, stop stack or move it to a second VPS |
| **&lt; 1 GB free** | Do **not** start Docker observability on this host — use Sentry SaaS + Admin Ops only, or a separate monitoring VM |

The compose file caps containers (`mem_limit`) so they cannot grow unbounded, but the OS still needs headroom for MySQL and Node.

### 0.3 Confirm Docker is missing (or already present)

```bash
docker --version
docker compose version
```

- If both print a version → skip to [§B](#b-pull-latest-code-with-observability-files).  
- If `command not found` → continue with [§A](#a-install-docker-engine--compose-on-the-vps).

---

## A. Install Docker Engine + Compose on the VPS

You need **root/sudo** once. On Hostinger the `deploy` user usually has `sudo`.

### A.1 Update packages

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
```

### A.2 Add Docker’s official GPG key and apt repository (Ubuntu)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
```

If `VERSION_CODENAME` is empty or apt fails, check `cat /etc/os-release` and use the Ubuntu codename explicitly (e.g. `jammy` for 22.04, `noble` for 24.04) in the `deb` line.

### A.3 Install Engine, CLI, and Compose plugin

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### A.4 Enable Docker on boot and start it

```bash
sudo systemctl enable --now docker
sudo systemctl status docker --no-pager
```

Expect `Active: active (running)`.

#### A.4.1 If `Job for docker.service failed`

Do **not** continue to Compose yet. Capture the real error:

```bash
sudo systemctl status docker.service --no-pager -l
sudo journalctl -xeu docker.service --no-pager | tail -80
sudo journalctl -xeu containerd.service --no-pager | tail -40
```

Also collect environment clues (paste if asking for help):

```bash
cat /etc/os-release
uname -r
free -h
df -h /
dpkg -l | grep -E 'docker|containerd' | awk '{print $1,$2,$3}'
systemd-detect-virt
lsmod | grep -E 'overlay|br_netfilter|nf_tables' || true
sudo iptables -L -n | head -5
```

Then apply the matching fix below.

**Fix 1 — start `containerd` first (very common)**

```bash
sudo systemctl enable --now containerd
sudo systemctl restart docker
sudo systemctl status docker --no-pager
```

**Fix 2 — conflicting / leftover packages**

Ubuntu’s `docker.io` / old `docker` snap can fight `docker-ce`:

```bash
# see what's installed
dpkg -l | grep -i docker
snap list 2>/dev/null | grep -i docker || true

# remove Ubuntu/snap leftovers (keeps docker-ce if already installed from Docker's repo)
sudo apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc 2>/dev/null || true
sudo snap remove docker 2>/dev/null || true

# reinstall official stack cleanly
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now containerd
sudo systemctl enable --now docker
```

**Fix 2b — `no sockets found via socket activation` + packages show `iU` (half-installed)**

Your `dpkg` lines look like `iU docker-ce ...` (Unpacked, not fully configured) and `TriggeredBy: × docker.socket`. That combination produces:

```text
failed to load listeners: no sockets found via socket activation: make sure the service was started by systemd
```

Finish the broken install, reset the socket unit, then start Docker:

```bash
# Clear systemd "restart too quickly" lock
sudo systemctl reset-failed docker.service docker.socket

# Complete any interrupted package configure steps
sudo dpkg --configure -a
sudo apt-get -f install -y

# Prefer official Compose plugin; Ubuntu's docker-compose-v2 is optional to remove
sudo apt-get remove -y docker-compose-v2 2>/dev/null || true
sudo apt-get purge -y docker.io containerd 2>/dev/null || true

# Ensure official packages are fully installed (status must become "ii", not "iU")
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify package state — second column letter must be "i" (e.g. ii), not U
dpkg -l | grep -E 'docker-ce|containerd.io|docker-compose-plugin'

# Bring socket + daemon up in the correct order
sudo systemctl enable containerd.service docker.socket docker.service
sudo systemctl restart containerd.service
sudo systemctl restart docker.socket
sudo systemctl restart docker.service
sudo systemctl status docker.socket docker.service --no-pager
```

If `docker.socket` still fails, check it and fall back to a non-socket listen address temporarily:

```bash
sudo systemctl status docker.socket --no-pager -l
sudo journalctl -xeu docker.socket --no-pager | tail -40

# Fallback: make dockerd listen on the unix socket without socket activation
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "hosts": ["unix:///var/run/docker.sock"],
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
# Override systemd so -H fd:// is not forced (conflicts with "hosts" in daemon.json)
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/override.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd --containerd=/run/containerd/containerd.sock
EOF
sudo systemctl daemon-reload
sudo systemctl reset-failed docker.service docker.socket
sudo systemctl stop docker.socket
sudo systemctl start docker.service
sudo systemctl status docker.service --no-pager
```

**Fix 3 — iptables / nftables network controller errors**

If the journal says something like `failed to start daemon: Error initializing network controller` or iptables/nft related:

```bash
sudo apt-get install -y iptables
sudo mkdir -p /etc/docker
# only create if missing — do not overwrite a custom daemon.json without reading it first
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{
  "iptables": true,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}' | sudo tee /etc/docker/daemon.json
fi
sudo systemctl restart containerd
sudo systemctl restart docker
```

If it still fails on nftables specifically, try legacy iptables:

```bash
sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
sudo systemctl restart docker
```

**Fix 4 — missing kernel modules (overlay / bridge)**

```bash
sudo modprobe overlay
sudo modprobe br_netfilter
echo -e 'overlay\nbr_netfilter' | sudo tee /etc/modules-load.d/docker.conf
sudo systemctl restart docker
```

If `modprobe overlay` fails, the VPS kernel may not support Docker (rare on Hostinger **KVM**; more common on OpenVZ). Check:

```bash
systemd-detect-virt
# expect kvm or microsoft/qemu — not openvz
```

**Fix 5 — disk full**

```bash
df -h /
# if root is 100%, free space before Docker can start
```

**Fix 6 — AppArmor noise (Ubuntu)**

```bash
sudo apt-get install -y apparmor apparmor-utils
sudo systemctl restart apparmor
sudo systemctl restart docker
```

After any fix, confirm:

```bash
sudo systemctl is-active docker
docker run --rm hello-world
```

Only then continue to [§A.5](#a5-let-deploy-run-docker-without-typing-sudo-every-time).

### A.5 Let `deploy` run Docker without typing `sudo` every time

```bash
sudo usermod -aG docker deploy
```

**Important:** group membership only applies to **new** logins. Either:

```bash
# Option 1 — new SSH session (recommended)
exit
# then SSH in again as deploy
ssh -i ~/.ssh/jbt_deploy deploy@193.203.161.219
```

or for the current session only:

```bash
newgrp docker
```

### A.6 Smoke-test Docker

```bash
docker run --rm hello-world
docker compose version
```

You should see the Hello from Docker message and a Compose version like `v2.x.x`.

**Debian note:** if the VPS is Debian (not Ubuntu), use Docker’s Debian repo docs instead (`https://docs.docker.com/engine/install/debian/`). Steps are the same idea: keyring → apt repo → `docker-ce` + `docker-compose-plugin`.

---

## B. Pull latest code with observability files

The stack lives under `/var/www/jbt/deploy/observability/`. It must exist on the VPS (pushed to `master`).

```bash
cd /var/www/jbt
git fetch origin
git status
# Prefer the normal deploy script so app + deps stay consistent:
./scripts/vps-deploy.sh
```

Or, if you only need the docs/compose files and will reload PM2 yourself later:

```bash
cd /var/www/jbt
git pull origin master
ls deploy/observability/docker-compose.yml
ls docs/OBSERVABILITY.md
```

Confirm these files exist:

- `deploy/observability/docker-compose.yml`
- `deploy/observability/.env.example`
- `deploy/observability/nginx-grafana.conf.example`
- `deploy/observability/alloy.config.alloy`
- `deploy/observability/loki-config.yml`
- `deploy/observability/prometheus.yml`
- `deploy/observability/grafana/provisioning/datasources/datasources.yml`

### B.1 Confirm PM2 log path (Alloy volume)

Alloy mounts host PM2 logs read-only:

```bash
ls /home/deploy/.pm2/logs | head
```

If your PM2 home is elsewhere (`echo $PM2_HOME` / `pm2 ping`), edit the volume in `deploy/observability/docker-compose.yml`:

```yaml
- /home/deploy/.pm2/logs:/var/log/pm2:ro
```

Change the **left** side (host path) to match reality, then recreate Alloy later with `docker compose up -d`.

---

## C. Configure and start the Grafana stack

### C.1 Create the observability `.env`

```bash
cd /var/www/jbt/deploy/observability
cp .env.example .env
chmod 600 .env
nano .env   # or: vim .env
```

Set at least:

```bash
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=USE_A_LONG_RANDOM_PASSWORD_HERE
GF_SERVER_ROOT_URL=https://justxsystems.com/grafana
```

Generate a password example:

```bash
openssl rand -base64 24
```

Paste that into `GF_SECURITY_ADMIN_PASSWORD`. **Do not** leave `change-me-now`. **Do not** commit `.env`. **Never put the real password in this guide or any git-tracked file** — only in `/var/www/jbt/deploy/observability/.env` on the VPS (`chmod 600`).

**Where to read the live password later:**

```bash
grep GF_SECURITY_ADMIN_ /var/www/jbt/deploy/observability/.env
```

Login URL: https://justxsystems.com/grafana/ — user is usually `admin` unless you changed `GF_SECURITY_ADMIN_USER`.

### C.2 Start the containers

```bash
cd /var/www/jbt/deploy/observability
docker compose up -d
```

First run pulls images (Loki, Prometheus, Alloy, Grafana) — can take several minutes on a small VPS.

### C.3 Check container health

```bash
docker compose ps
docker compose logs --tail=50
```

All four services should be `Up` (or `running`):

- `loki`
- `prometheus`
- `alloy`
- `grafana`

Local Grafana (only on loopback — not public yet):

```bash
curl -sI http://127.0.0.1:3003/grafana/ | head
# or without subpath probe:
curl -sI http://127.0.0.1:3003/ | head
```

If Grafana fails to start with a password error, re-check `.env` — `GF_SECURITY_ADMIN_PASSWORD` is required.

### C.4 Useful Docker lifecycle commands

```bash
cd /var/www/jbt/deploy/observability

docker compose ps                 # status
docker compose logs -f grafana    # follow one service
docker compose restart            # restart all
docker compose down               # stop & remove containers (volumes kept)
docker compose down -v            # DANGER: also deletes Loki/Grafana data volumes
docker stats --no-stream          # live RAM/CPU snapshot
```

---

## D. Expose Grafana through nginx

Grafana must **not** be published on `0.0.0.0:3003`. Compose already binds `127.0.0.1:3003`. nginx terminates TLS and proxies `/grafana/`.

### D.0 Symptom: `/grafana` shows the marketing homepage (`index.html`)

That means nginx is **not** proxying to Grafana. A catch-all SPA rule is winning, for example:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

`https://justxsystems.com/grafana/` must hit Grafana (login page), not the justxsystems marketing site.

**Fix:** add the `/grafana/` location **in the same HTTPS `server { }` block**, and place it **above** any `location /` / `try_files … /index.html` catch-all.

### D.1 Find the live site config

```bash
sudo nginx -T 2>/dev/null | grep -nE 'server_name|justxsystems|/jbt|grafana|try_files|index\.html' | head -80
ls /etc/nginx/sites-enabled/
# common patterns:
#   /etc/nginx/sites-enabled/justxsystems.com
#   /etc/nginx/sites-enabled/default
```

Open the **HTTPS** `server { ... }` block for `justxsystems.com` (the one that already has `/jbt`).

Confirm Grafana is up locally before blaming nginx:

```bash
cd /var/www/jbt/deploy/observability && docker compose ps
curl -sI http://127.0.0.1:3003/grafana/ | head -15
# Expect HTTP/1.1 302 or 200 from Grafana — NOT HTML from the marketing site
```

### D.2 Add the Grafana location (before the SPA catch-all)

#### D.2.1 Find which file to edit (do this first)

```bash
ls -la /etc/nginx/sites-enabled/
sudo nginx -T 2>/dev/null | grep -nE 'server_name|listen 443|/jbt|try_files' | head -60
```

Note the **filename** under `sites-enabled` (often a symlink). Common names:

- `/etc/nginx/sites-enabled/justxsystems.com`
- `/etc/nginx/sites-enabled/default`
- something under `/etc/nginx/conf.d/`

If `sites-enabled` shows a symlink (e.g. `justxsystems.com -> /etc/nginx/sites-available/justxsystems.com`), edit the **sites-available** target — both work, but editing the real file is clearer:

```bash
# Example — replace with YOUR filename from ls above
readlink -f /etc/nginx/sites-enabled/*
```

#### D.2.2 Make a backup (always)

```bash
# Replace YOUR_FILE with the real path, e.g. /etc/nginx/sites-available/justxsystems.com
sudo cp YOUR_FILE YOUR_FILE.bak.$(date +%Y%m%d-%H%M)
```

#### D.2.3 Open the file in nano

```bash
sudo nano YOUR_FILE
```

**nano basics**

| Key | Action |
|-----|--------|
| Arrow keys | Move cursor |
| `Ctrl+W` | Search (type `/jbt` then Enter) |
| `Ctrl+O` then Enter | Save |
| `Ctrl+X` | Exit |
| `Ctrl+C` | Show cursor line number (if enabled) |

#### D.2.4 What you are looking for

You want the block that starts roughly like:

```nginx
server {
    listen 443 ssl;          # or listen 443 ssl http2;
    server_name justxsystems.com www.justxsystems.com;
    ...
    location /jbt/api/ { ... }
    location /jbt { ... }

    location / {
        try_files $uri $uri/ /index.html;   # <-- SPA catch-all (marketing site)
    }
}
```

There may be **two** `server { }` blocks (HTTP `:80` and HTTPS `:443`). Edit the **HTTPS / 443** one (the one that already has `/jbt`).

#### D.2.5 Where to paste

1. Search for `/jbt` with `Ctrl+W`.
2. Place the cursor **after** the closing `}` of the last `/jbt…` location.
3. Place it **before** the catch-all `location / { … try_files … /index.html; }`.
4. Paste this (in nano: right‑click paste, or Shift+Insert):

```nginx
    # --- Grafana (JBT observability) ---
    location = /grafana {
        return 301 /grafana/;
    }

    location /grafana/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
```

Indentation (spaces) should match nearby `location` blocks. Do **not** put this outside `server { }`.

**Wrong:** only editing the port‑80 block, or pasting below `location /` SPA rule with no earlier match (order among prefix locations is by longest match, so `/grafana/` should still win — but if you forget the block entirely, SPA wins).

**Do not** use `proxy_pass http://127.0.0.1:3003/;` (trailing slash).

#### D.2.6 Save, test, reload

In nano: `Ctrl+O` → Enter → `Ctrl+X`.

Then:

```bash
sudo nginx -t
```

- If you see `syntax is ok` and `test is successful`:

```bash
sudo systemctl reload nginx
```

- If `nginx -t` reports an error, it prints the file and line number — reopen nano, fix that line, save, run `nginx -t` again. **Do not reload** until the test passes.

#### D.2.7 One-shot append helper (optional, if you already know the file)

If you prefer not to hunt by hand, you can insert with a snippet file then merge carefully. Safest for beginners is still nano (above). Quick check after reload:

```bash
sudo nginx -T 2>/dev/null | grep -A12 'location /grafana'
curl -sI https://justxsystems.com/grafana/ | head -15
```

Copy the snippet from the repo anytime with:

```bash
cat /var/www/jbt/deploy/observability/nginx-grafana.conf.example
```

### D.3 (Strongly recommended) HTTP basic auth in front of Grafana

**What it is:** an extra username/password prompt from **nginx** before anyone reaches the Grafana login page. It is not Grafana’s own admin password — it is a second gate so bots and scanners never hit Grafana.

**Why:** Grafana under `/grafana/` is on the public internet. Basic auth cuts noise even if someone guesses a weak Grafana password.

**Helper script (preferred):**

```bash
bash /var/www/jbt/deploy/observability/scripts/setup-grafana-basic-auth.sh
# Creates /etc/nginx/.htpasswd-grafana + snippet; follow the printed `include` line
sudo nginx -t && sudo systemctl reload nginx
```

**Manual equivalent:**

```bash
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd_grafana YOUR_NGINX_USER
# enter a password when prompted (-c creates the file; omit -c to add another user later)
sudo chmod 640 /etc/nginx/.htpasswd_grafana
sudo chown root:www-data /etc/nginx/.htpasswd_grafana
```

Then add inside `location /grafana/ { ... }` (near the top of the block):

```nginx
    auth_basic "Grafana";
    auth_basic_user_file /etc/nginx/.htpasswd_grafana;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Browser flow: nginx asks for basic-auth user → then Grafana asks for `admin` / Grafana password.

### D.4 Test and reload nginx

```bash
sudo nginx -t
sudo systemctl reload nginx

# On the VPS — should NOT look like the marketing homepage
curl -sI https://justxsystems.com/grafana/ | head -20
curl -s https://justxsystems.com/grafana/ | head -5
# Expect Grafana HTML (title contains Grafana) or a 401 if basic auth is on
```

From your laptop open `https://justxsystems.com/grafana/` (keep the trailing slash).

Log in with `GF_SECURITY_ADMIN_USER` / `GF_SECURITY_ADMIN_PASSWORD` from `deploy/observability/.env`.

### D.5 If Grafana redirects you back to `/` after proxy works

Check compose env:

```bash
cd /var/www/jbt/deploy/observability
grep GF_ /var/www/jbt/deploy/observability/.env
docker compose exec grafana env | grep GF_SERVER
```

Required:

- `GF_SERVER_ROOT_URL=https://justxsystems.com/grafana/` (trailing slash recommended)
- `GF_SERVER_SERVE_FROM_SUB_PATH=true` (already in compose)
- `GF_SERVER_DOMAIN=justxsystems.com`

Then recreate Grafana:

```bash
# ensure .env has trailing slash on ROOT_URL
nano /var/www/jbt/deploy/observability/.env
docker compose up -d --force-recreate grafana
```

### D.6 Symptom: Explore / “Loki: API logs” opens marketing `index.html`

**Cause:** Grafana sometimes returns `Location: /login` or `Location: /explore` **without** the `/grafana` prefix. nginx then hits the SPA `try_files … /index.html` and you see the homepage.

**Fix A — nginx `proxy_redirect` (do this now on the VPS)**

```bash
sudo nano /etc/nginx/sites-available/justxsystems.com
```

Inside `location /grafana/ { ... }` add these three lines (if missing):

```nginx
    proxy_redirect ~^/(?!grafana/)(.*)$ /grafana/$1;
    proxy_redirect http://127.0.0.1:3003/ /grafana/;
    proxy_redirect http://127.0.0.1:3003 /grafana;
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Fix B — Grafana root URL + recreate**

```bash
cd /var/www/jbt/deploy/observability
grep GF_SERVER .env
# set:
# GF_SERVER_ROOT_URL=https://justxsystems.com/grafana/
# GF_SERVER_DOMAIN=justxsystems.com
docker compose up -d --force-recreate grafana
```

**Verify redirects keep `/grafana`:**

```bash
curl -sI 'http://127.0.0.1:3003/grafana/explore' | grep -i location
curl -sI 'https://justxsystems.com/grafana/explore' | grep -i location
# Expect Location containing /grafana/login — NOT /login alone
```

**Workaround until fixed:** open https://justxsystems.com/grafana/ → sidebar **Explore** → paste `{service="justx-jbt-api"}` (do not use a bookmarked `/explore` URL without `/grafana`).

---

## E. Wire the API env and reload PM2

### E.1 Edit `server/.env` on the VPS

```bash
nano /var/www/jbt/server/.env
# ensure mode stays private:
chmod 600 /var/www/jbt/server/.env
```

Add or update:

```bash
LOG_FORMAT=json
GRAFANA_PUBLIC_URL=https://justxsystems.com/grafana
# optional but recommended:
ERROR_WEBHOOK_URL=https://hooks.slack.com/services/...   # or Discord webhook
SENTRY_DSN=https://KEY@HOST/PROJECT                      # Sentry SaaS or GlitchTip
SENTRY_ENVIRONMENT=production
ERRORS_UI_URL=https://glitchtip.example/                 # optional deep link in Ops UI
```

| Variable | Why |
|----------|-----|
| `LOG_FORMAT=json` | One JSON object per log line so Loki can parse `status`, `requestId`, etc. |
| `GRAFANA_PUBLIC_URL` | Admin → Operations “Open Grafana” button |
| `ERROR_WEBHOOK_URL` | Instant Slack/Discord page on server errors |
| `SENTRY_DSN` | Exception store (SaaS or GlitchTip) |
| `ERRORS_UI_URL` | Optional link in Operations UI |

### E.2 Reload PM2 with the new env

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
pm2 status
```

Confirm JSON logs:

```bash
pm2 logs justx-jbt-api --lines 20 --nostream
```

You should see lines that look like JSON (`{"level":...,"msg":"http_request",...}`) rather than plain text.

---

## F. Verify end-to-end

### F.1 Admin Operations

1. Sign in as an Admin user.  
2. Open **https://justxsystems.com/jbt/admin/ops** (or Admin → **Operations**).  
3. Confirm API/Web/DB health, error pulse, and that **Open Grafana** points at your public URL.

### F.2 Grafana Explore (Loki) — quick smoke test

1. Open `https://justxsystems.com/grafana` → **Explore**.  
2. Choose datasource **Loki** (provisioned automatically).  
3. Run:

```logql
{job="pm2"}
```

If that works, narrow to API JSON:

```logql
{job="pm2"} |= "justx-jbt-api"
```

For day-to-day analysis (filters, request tracing, 5xx, live tail), see **[§G](#g-using-grafana-to-view-and-analyze-jbt-logs)**.

### F.3 If Alloy shows no logs

```bash
# Host can read PM2 logs?
ls -la /home/deploy/.pm2/logs | head

# Alloy container sees the mount?
cd /var/www/jbt/deploy/observability
docker compose exec alloy ls /var/log/pm2 | head

# Alloy config / errors
docker compose logs alloy --tail=80
```

Fix the host path in `docker-compose.yml` if needed, then:

```bash
docker compose up -d --force-recreate alloy
```

---

## G. Using Grafana to view and analyze JBT logs

This is the **operator handbook** after the stack is up. You do not need SSH for normal log analysis.

### G.0 If Explore looks empty (most common)

Your stack is often **working** even when `{service="justx-jbt-api"}` returns nothing.

**Why:** PM2 prefixes every line like:

```text
2026-09-02T06:27:58: {"ts":"...","service":"justx-jbt-api","msg":"http_request",...}
```

Until Alloy strips that prefix, Loki never gets a `service` **label**. Labels you will see instead:

| Label | Value |
|-------|--------|
| `job` | `pm2` |
| `filename` | `/var/log/pm2/justx-jbt-api-out.log` |
| `service_name` | `pm2` (auto; not our app service) |

**Use these queries now:**

```logql
{job="pm2"}
{job="pm2"} |= "justx-jbt-api"
{filename=~".*justx-jbt-api.*"}
```

In Explore → **Label browser**, click `job` → `pm2` → Run query. You should see JSON lines.

After deploying the updated `alloy.config.alloy` (PM2 prefix strip) and recreating Alloy, `{service="justx-jbt-api"}` starts working for **new** lines:

```bash
cd /var/www/jbt/deploy/observability
docker compose up -d --force-recreate alloy
```

### G.1 Mental model (what you are looking at)

```
Browser / API call
    → justx-jbt-api / justx-jbt-worker (PM2)
        → JSON line on stdout (LOG_FORMAT=json)
            → /home/deploy/.pm2/logs/*.log
                → Grafana Alloy (reads files)
                    → Loki (stores logs)
                        → Grafana Explore (you search here)
```

| Piece | Role |
|-------|------|
| **Grafana** | UI — Explore, dashboards, time picker |
| **Loki** | Log database (query with **LogQL**) |
| **Alloy** | Ships PM2 log files into Loki |
| **Admin → Operations** | Quick health + recent errors + deep link into Grafana |

Each useful API log line is JSON, roughly:

```json
{
  "ts": "2026-09-02T05:24:40.123Z",
  "level": "info",
  "service": "justx-jbt-api",
  "msg": "http_request",
  "requestId": "a1b2c3d4e5f6…",
  "method": "GET",
  "path": "/api/health",
  "status": 200,
  "durationMs": 12
}
```

Alloy promotes some fields to **labels** (fast filters): `service`, `level`, `job`.  
Other fields (`requestId`, `status`, `path`, `msg`, …) are searched after `| json` in LogQL.

| Label / field | Typical values | Use for |
|---------------|----------------|---------|
| `service` | `justx-jbt-api`, `justx-jbt-worker` | API vs background jobs |
| `level` | `info`, `warn`, `error` | Severity |
| `job` | `pm2` | All PM2-scraped logs |
| `msg` | `http_request`, `api_listen`, … | Event type |
| `requestId` | hex string | Trace one HTTP request end-to-end |
| `status` | `200`, `401`, `500`, … | HTTP status (after `\| json`) |
| `path` | `/api/...` | Which endpoint |
| `durationMs` | number | Latency |

### G.2 Log in

1. Open **https://justxsystems.com/grafana/** (trailing slash).  
2. Username: usually `admin` (from `GF_SECURITY_ADMIN_USER` on the VPS).  
3. Password: from the VPS only — never from this git doc:

```bash
grep GF_SECURITY_ADMIN_ /var/www/jbt/deploy/observability/.env
```

4. If Grafana forces a password change on first login, set a new strong password and update the VPS `.env` to match for documentation consistency (Grafana stores the live password in its own DB after first boot; changing `.env` alone does not always reset an existing admin — use Grafana UI **Profile → Change password** or the Grafana admin reset docs if needed).

### G.3 Open Explore (your main log tool)

1. Left sidebar → the **compass** icon → **Explore**  
   (or go to `https://justxsystems.com/grafana/explore`).  
2. Top-left datasource dropdown → choose **Loki** (should be default).  
3. Top-right **time range** → start with **Last 15 minutes** or **Last 1 hour**.  
4. Query type: **Builder** (guided) or **Code** (paste LogQL). Prefer **Code** once you know the queries below.  
5. Click **Run query** (or Shift+Enter).

Tips:

- Turn on **Live** (tail) only when debugging an active issue — it streams continuously.  
- Use **Split** to compare API vs worker side by side.  
- Click a log line to expand JSON fields.

### G.4 Discover labels if queries return nothing

If `{service="justx-jbt-api"}` is empty:

1. In Explore, open **Label browser** / **Kick start your query**.  
2. Or run a wide query:

```logql
{job="pm2"}
```

3. Confirm JSON logging is on and traffic exists:

```bash
pm2 logs justx-jbt-api --lines 5 --nostream
# should look like {"ts":...,"level":...,"service":"justx-jbt-api",...}
```

4. Hit the API once, wait ~30–60s, re-run Explore:

```bash
curl -sI https://justxsystems.com/jbt/api/health | head
```

### G.5 Everyday LogQL recipes (copy / paste)

#### All API logs

```logql
{job="pm2"} |= "justx-jbt-api"
# after Alloy prefix-strip is live:
{service="justx-jbt-api"}
```

#### All worker / job logs

```logql
{job="pm2"} |= "justx-jbt-worker"
# or:
{service="justx-jbt-worker"}
```

#### Everything Alloy scraped from PM2

```logql
{job="pm2"}
```

#### Only errors

```logql
{job="pm2"} |= `"level":"error"`
# or after labels work:
{service="justx-jbt-api", level="error"}
```

#### Only warnings + errors

```logql
{job="pm2"} |= "justx-jbt-api" |~ `"level":"(warn|error)"`
```

#### HTTP access lines

```logql
{job="pm2"} |= "http_request"
```

#### HTTP 5xx (server failures)

```logql
{job="pm2"} |= "http_request" |= `"status":5`
# richer (needs clean JSON line — after Alloy strip):
{service="justx-jbt-api"} |= "http_request" | json | status >= 500
```

#### HTTP 4xx (client / auth issues)

```logql
{service="justx-jbt-api"} |= "http_request" | json | status >= 400 | status < 500
```

#### Slow requests (> 2 seconds)

```logql
{service="justx-jbt-api"} |= "http_request" | json | durationMs > 2000
```

#### One endpoint (example: health)

```logql
{service="justx-jbt-api"} |= "http_request" | json | path = `/api/health`
```

#### Free-text search (error message fragment)

```logql
{service="justx-jbt-api"} |= "Drive" | json
```

`|=` means “line contains this string” (before or after parsing). Use `!=` to exclude noise.

### G.6 Triage one HTTP request end-to-end

Triage with **request id + Loki**. When `OTEL_ENABLED=true`, also open the **Tempo** span for that request (`traceId` on log lines / span attribute `request.id`).

#### What “start to end” means

```
Browser
  → nginx (TLS, /jbt/api → :4002)
    → Express API (X-Request-Id + OTel span)
      → MySQL / Google Drive / Razorpay / disk
        → response (+ X-Request-Id; logs include requestId + traceId)
          → PM2 → Alloy → Loki
          → OTLP :4318 → Alloy → Tempo
```

Worker jobs (`justx-jbt-worker`) are **separate** processes — they get their own log lines (and their own traces when OTel is on).

#### Step 1 — Capture the request id

| Source | Where |
|--------|--------|
| Browser DevTools | Network → failed/slow call → **Headers** → Response `X-Request-Id` |
| Error JSON | Many 500 responses: `"requestId": "..."` |
| Admin Ops | **Operations** → recent error row |
| Reproduce yourself | `curl -sI https://justxsystems.com/jbt/api/health \| findstr /I request` (Windows) or `curl -sI ... \| grep -i request` |

Example id: `54d1dd5fa816c9e575649774`

#### Step 2 — Confirm the access log in Loki

Grafana → Explore → Loki → Last 1–6 hours:

```logql
{service="justx-jbt-api"} |= "<paste-request-id>"
```

or:

```logql
{job="pm2"} |= "<paste-request-id>"
```

You should see at least one `http_request` line with:

| Field | Meaning |
|-------|---------|
| `method` / `path` | Endpoint called |
| `status` | HTTP status |
| `durationMs` | How long the handler took |
| `level` | `info` / `warn` / `error` |
| `traceId` | Present when OTel is enabled — paste into Tempo Explore |

#### Step 3 — Pull the full story for that id

Same query — expand every matching line (not only `http_request`). Look for:

- `level=error` / stack snippets from `reportError`
- Drive / delivery / payment messages that share the same `requestId`
- A slow `durationMs` with status 200 (timeout on client, not always 5xx)

#### Step 3b — Open the Tempo trace (when OTel is on)

1. Copy `traceId` from the Loki line, **or** Admin → Operations → **Tempo: traces**.  
2. Grafana → Explore → **Tempo** → TraceQL search / paste the id.  
3. Span attribute `request.id` should match your request id (for logs ↔ traces).

#### Step 4 — Classify

| Signal | Likely cause | Next action |
|--------|--------------|-------------|
| No log line at all | Never hit API (DNS, nginx, wrong host, CORS preflight only) | `curl -sI` public URL; check nginx `error.log` |
| `status=401/403` | Auth / role | Session cookie, JWT, org role |
| `status=404` | Route / pack / artifact missing | Path spelling, admin SKU |
| `status=5xx` + error log | Server exception | Stack in Loki / Ops / Sentry |
| `status=200` but UI broken | Frontend / wrong payload | Web logs + Network response body |
| High `durationMs` | DB / Drive / upstream slow | Query MySQL slow log; Drive token; timeout settings |
| Line only on worker | Async job after HTTP returned | Search worker logs around same timestamp |

#### Step 5 — Cross-check Ops + optional Sentry

1. Admin → **Operations** — same `requestId` in recent errors?  
2. If `SENTRY_DSN` configured — open Errors UI / Sentry and search by message or tag `requestId`.  
3. If Slack/Discord webhook configured — check the page for that id.

#### Step 6 — Reproduce and verify the fix

```bash
# after deploy / config change
curl -sI https://justxsystems.com/jbt/api/health | grep -i x-request-id
# copy id → Grafana → confirm new http_request line within ~30s
```

#### Honest gap vs Dynatrace

- Spans cover Node HTTP / selected libs — not full nginx/MySQL wire protocol unless instrumented  
- Worker ↔ API correlation still needs shared ids in job payloads  
- **request id + Loki** remains the fastest path; Tempo is the deeper view when OTel is enabled

---

## 1. Application reference (already in repo)

### G.7 Analyze patterns (volume / rates)

Explore can show **logs** or switch visualization to metrics-from-logs.

#### Count of log lines over time (API)

```logql
sum(count_over_time({service="justx-jbt-api"}[1m]))
```

#### Count of 5xx per minute

```logql
sum(count_over_time({service="justx-jbt-api"} |= "http_request" | json | status >= 500 [1m]))
```

#### Count of errors by level (table)

In Explore, run a logs query filtered to `level="error"`, then use the **volume** histogram above the results to see when spikes happened. Narrow the time picker to the spike window and re-run.

#### Top noisy messages (approximate)

```logql
{service="justx-jbt-api"} | json | line_format "{{.msg}}"
```

Then visually scan which `msg` values dominate; refine with `|= "that_msg"`.

### G.8 Save a useful query for the team

1. Run a good query in Explore.  
2. Click the **star** / **Add to dashboard** / **Save query** options available in your Grafana version.  
3. Or create a simple dashboard:
   - Left menu → **Dashboards** → **New** → **New dashboard** → **Add visualization**  
   - Datasource **Loki**  
   - Panel A: `{service="justx-jbt-api", level="error"}` (Logs panel)  
   - Panel B: 5xx rate query from §G.7 (Time series)  
4. Save as e.g. **JBT API health**.

Suggested starter panels:

| Panel | Query | Type |
|-------|-------|------|
| API errors | `{service="justx-jbt-api", level="error"}` | Logs |
| Worker errors | `{service="justx-jbt-worker", level="error"}` | Logs |
| 5xx / min | `sum(count_over_time({service="justx-jbt-api"} \|= "http_request" \| json \| status >= 500 [1m]))` | Time series |
| Live access | `{service="justx-jbt-api"} \|= "http_request"` | Logs + Live |

### G.9 Prometheus (optional, light use)

Datasource **Prometheus** is provisioned for later metrics (exporters / Alloy). Day one you can ignore it; logs in Loki cover most JBT incidents. When node/MySQL exporters are added (Phase 4), use Explore → Prometheus for CPU/RAM/disk.

### G.10 Incident playbook (15 minutes)

| Step | Action |
|------|--------|
| 1 | Admin → **Operations** — are API/Web/DB red? Any recent errors? |
| 2 | Copy `requestId` if present |
| 3 | Grafana Explore → Loki → Last 1h → `{service="justx-jbt-api", level=~"warn\|error"}` |
| 4 | If you have a request id → `{job="pm2"} \|= "<id>"` |
| 5 | Check 5xx burst: `… \| json \| status >= 500` |
| 6 | Correlate with deploy time (`git log` / GitHub Actions) or VPS `pm2 status` / `free -h` |
| 7 | Fix → confirm new traffic is green in Explore Live for 5 minutes |

### G.11 Common pitfalls

| Problem | Cause / fix |
|---------|-------------|
| Empty Loki results | Time range too narrow; `LOG_FORMAT` not json; Alloy down; no traffic yet |
| Only old plain-text lines | Reload PM2 after setting `LOG_FORMAT=json` |
| `service` label missing | Pre-JSON PM2 noise — filter `|= "{"` or wait for new lines |
| Query error on `status >= 500` | Must `| json` first so `status` becomes a number field |
| Too many results / slow | Narrow time range; add `service=` / `level=` labels before `|=` |
| Confused by marketing site | Always use `/grafana/` URL — see §D |

---

## 1. Application reference (already in repo)

### Structured logs

- Production defaults to JSON lines on stdout (`LOG_FORMAT=json`).  
- Each request gets `X-Request-Id` (also returned on 500 responses as `requestId`).  
- Access log event: `msg=http_request` with `status`, `durationMs`, `path`.

### Admin Operations

Shows:

- API / Web probe + DB status, memory, uptime  
- Delivery / audit risk signals  
- Recent in-memory errors with **request id**  
- Links to Grafana Explore and runbooks  

---

## 3. Sentry / GlitchTip (exception store)

### What they are

| Tool | What it is | Role vs Grafana/Loki |
|------|------------|----------------------|
| **Sentry** | Hosted error tracker (sentry.io) | Groups exceptions, stack traces, release regression |
| **GlitchTip** | Open-source Sentry-compatible self-host | Same API shape; you run the UI/DB yourself |
| **Loki** (what you have now) | Log search | Every line, including successful `http_request` |
| **ERROR_WEBHOOK_URL** | Slack/Discord hook | Instant ping on `reportError` |

**Use Loki** to search any request. **Use Sentry/GlitchTip** when you want a dedicated error inbox (deduped crashes, assignee, email alerts). They complement each other — not replacements.

JBT already posts to Sentry’s store API from [`server/src/lib/error-reporting.ts`](../server/src/lib/error-reporting.ts) — **no npm Sentry SDK required**.

### Option A — Sentry SaaS (recommended on this VPS)

1. Create a free project at https://sentry.io (platform: Node).  
2. Copy the **DSN** (looks like `https://KEY@o123.ingest.sentry.io/456`).  
3. On the VPS edit `/var/www/jbt/server/.env`:

```bash
SENTRY_DSN=https://KEY@o123.ingest.sentry.io/PROJECT_ID
SENTRY_ENVIRONMENT=production
ERRORS_UI_URL=https://sentry.io/organizations/YOUR_ORG/issues/
```

4. Reload API:

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

5. Trigger a test error (or wait for a real 500) → check Sentry Issues.  
6. Admin → **Operations** → Errors UI link uses `ERRORS_UI_URL`.

### Option B — GlitchTip self-hosted

Same DSN env vars, but the DSN host is **your** GlitchTip instance.

**Do not** install GlitchTip (Postgres + Redis + app) on the same small Hostinger box as MySQL + PM2 + Grafana unless you have spare RAM. Prefer:

- Sentry SaaS, or  
- a **second** small VPS for GlitchTip only.

If you do run GlitchTip elsewhere:

```bash
SENTRY_DSN=https://KEY@glitchtip.yourdomain.com/1
SENTRY_ENVIRONMENT=production
ERRORS_UI_URL=https://glitchtip.yourdomain.com/
```

Then `pm2 reload ecosystem.config.cjs --update-env`.

### Option C — Slack/Discord only (fastest alert)

Create an Incoming Webhook, then:

```bash
ERROR_WEBHOOK_URL=https://hooks.slack.com/services/...
# or Discord webhook URL
```

Reload PM2 as above. Every `reportError` posts a short message including `requestId`.

---

## 4. Phase 4 — Tempo traces + Prometheus exporters

Lean stack on the same Hostinger VPS (mem-capped). **Do not** self-host GlitchTip/ClickHouse here.

### 4.1 What you get

| Piece | Role |
|-------|------|
| **Tempo** | Trace store (OTLP from API/worker via Alloy `:4318`) |
| **node_exporter** | Host CPU / RAM / disk (always on with compose) |
| **mysqld_exporter** | MySQL metrics (`--profile mysql-metrics`) |
| **OTel SDK** | Opt-in in Node (`OTEL_ENABLED=true`) |

### 4.2 Bring up Tempo + exporters

After `git pull` / `./scripts/vps-deploy.sh`:

```bash
cd /var/www/jbt/deploy/observability
# keep existing .env; ensure GF_* still set
docker compose up -d
docker compose ps
curl -sI http://127.0.0.1:4318/ | head   # Alloy OTLP (may 404 without POST — connection is enough)
```

Expect `tempo`, `node-exporter`, `alloy`, `grafana`, `loki`, `prometheus` **Up**.

### 4.3 Enable OTel on the API (and worker)

In `/var/www/jbt/.env` (or wherever PM2 loads env):

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
LOG_FORMAT=json
GRAFANA_PUBLIC_URL=https://justxsystems.com/grafana
```

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
# or: ./scripts/vps-deploy.sh
```

Hit any API route, then Grafana → Explore → **Tempo**, or Admin → **Operations** → **Tempo: traces**.

Log lines should include `"traceId":"…"` when a span is active.

### 4.4 Optional MySQL exporter

```sql
CREATE USER 'jbt_exporter'@'127.0.0.1' IDENTIFIED BY 'LONG_RANDOM_SECRET';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'jbt_exporter'@'127.0.0.1';
FLUSH PRIVILEGES;
```

In `deploy/observability/.env`:

```bash
MYSQL_EXPORTER_DSN=jbt_exporter:LONG_RANDOM_SECRET@(host.docker.internal:3306)/
```

```bash
cd /var/www/jbt/deploy/observability
docker compose --profile mysql-metrics up -d
```

Grafana → Explore → **Prometheus** → `mysql_up` or `mysql_global_status_threads_connected`.

### 4.5 Host metrics (no extra config)

Explore → **Prometheus**:

```promql
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
rate(node_cpu_seconds_total{mode="idle"}[5m])
```

Admin Ops also links **Prometheus: host mem**.

### 4.6 nginx basic auth (recommended)

```bash
bash /var/www/jbt/deploy/observability/scripts/setup-grafana-basic-auth.sh
# follow printed include snippet, then:
sudo nginx -t && sudo systemctl reload nginx
```

Also ensure `proxy_redirect` lines from [§D.6](#d6-symptom-explore--loki-api-logs-opens-marketing-indexhtml) are present so Explore stays under `/grafana/`.

---

## 5. Security

- Grafana: strong admin password; prefer nginx basic auth or SSO; no anonymous access  
- Never publish Grafana on a public port without TLS + auth  
- Operations page: same Admin role gate as the rest of `/admin`  
- Never commit Grafana passwords, `.env`, or DSNs  
- Keep `deploy/observability/.env` mode `600` and owned by `deploy`  

---

## 6. Troubleshooting cheat sheet

| Symptom | Check |
|---------|--------|
| `Job for docker.service failed` | [§A.4.1](#a41-if-job-for-dockerservice-failed) — `journalctl -xeu docker.service`; start `containerd`; remove `docker.io`/snap conflicts |
| `no sockets found via socket activation` / `iU` packages | [§A.4.1 Fix 2b](#a41-if-job-for-dockerservice-failed) — `dpkg --configure -a`, fix `docker.socket`, or daemon.json + systemd override |
| `docker: command not found` | Finish [§A](#a-install-docker-engine--compose-on-the-vps); re-login after `usermod -aG docker` |
| `permission denied` talking to Docker socket | `groups` should list `docker`; `newgrp docker` or re-SSH |
| `GF_SECURITY_ADMIN_PASSWORD` compose error | Create `.env` from `.env.example` with a real password |
| Grafana 502 from nginx | `docker compose ps`; `curl -sI http://127.0.0.1:3003/`; nginx `proxy_pass` port **3003** |
| `/grafana` shows marketing homepage / `index.html` | `/grafana/` location missing or **below** SPA `try_files … /index.html` — see [§D.0](#d0-symptom-grafana-shows-the-marketing-homepage-indexhtml) |
| Explore / Loki button → marketing homepage | Grafana redirect dropped `/grafana` — add nginx `proxy_redirect` [§D.6](#d6-symptom-explore--loki-api-logs-opens-marketing-indexhtml); fix `GF_SERVER_ROOT_URL` trailing slash |
| Grafana UI broken under `/grafana` | `GF_SERVER_ROOT_URL` and `GF_SERVER_SERVE_FROM_SUB_PATH=true` (already in compose) |
| No logs in Loki | PM2 path mount; `LOG_FORMAT=json`; Alloy logs; wait 1–2 min after reload — see [§G.4](#g4-discover-labels-if-queries-return-nothing) |
| How to search / analyze logs | [§G](#g-using-grafana-to-view-and-analyze-jbt-logs) — Explore, LogQL recipes, request tracing |
| VPS OOM / MySQL flaky | `docker stats`; `docker compose down` to free RAM; consider a second VM |
| After `git pull`, compose files missing | Observability commit not on `master` yet — pull again after push |

---

## 7. Minimal “do this now” copy-paste (experienced ops)

```bash
# SSH as deploy, then:
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker deploy
# re-SSH or: newgrp docker

cd /var/www/jbt && ./scripts/vps-deploy.sh   # or git pull
cd /var/www/jbt/deploy/observability
cp .env.example .env && chmod 600 .env
# edit GF_SECURITY_ADMIN_PASSWORD
docker compose up -d

# merge nginx-grafana.conf.example into site config, then:
sudo nginx -t && sudo systemctl reload nginx

# edit /var/www/jbt/server/.env → LOG_FORMAT=json GRAFANA_PUBLIC_URL=...
cd /var/www/jbt && pm2 reload ecosystem.config.cjs --update-env && pm2 save
```
