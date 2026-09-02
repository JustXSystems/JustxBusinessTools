# JustX Business Tools — Observability

**Goal:** Dynatrace-class *operations* without rebuilding APM inside `/admin`.

| Layer | Tool | Role |
|-------|------|------|
| Control tower | Admin → **Operations** (`/jbt/admin/ops`) | Health, error pulse, deep links |
| Logs + metrics UI | **Grafana** + **Loki** + **Prometheus** | Search logs, dashboards, host metrics |
| Traces | **Tempo** + OpenTelemetry (opt-in) | Span tree for one HTTP request |
| Log / trace shipper | **Grafana Alloy** | PM2 logs → Loki; OTLP `:4318` → Tempo |
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
| OTLP (traces) bind | `127.0.0.1:4318` (Alloy; Node sends here) |
| App env file | `/var/www/jbt/server/.env` (not the repo root) |

**If Grafana + Loki already work** and you only need Phase 4 (traces / host metrics): skip to [§4](#4-phase-4--tempo-traces--hostmysql-metrics--step-by-step) after a fresh [§B](#b-pull-latest-code-with-observability-files) deploy.

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
12. [§4](#4-phase-4--tempo-traces--hostmysql-metrics--step-by-step) **Phase 4 (after Loki works):** Tempo traces + host/MySQL metrics  

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
- `deploy/observability/tempo-config.yml` (Phase 4 — traces)
- `deploy/observability/scripts/setup-grafana-basic-auth.sh`
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

First run pulls images — can take several minutes on a small VPS. Current compose starts:

| Service | Purpose |
|---------|---------|
| `loki` | Log store |
| `prometheus` | Metrics store |
| `alloy` | Ships PM2 logs → Loki; receives OTLP traces → Tempo |
| `grafana` | UI |
| `tempo` | Trace store (Phase 4) |
| `node-exporter` | Host CPU/RAM/disk metrics (Phase 4) |

`mysqld-exporter` stays **off** until you run with `--profile mysql-metrics` ([§4.7](#47-optional--mysql-metrics)).

### C.3 Check container health

```bash
docker compose ps
docker compose logs --tail=50
```

These should be `Up` (or `running`):

- `loki`
- `prometheus`
- `alloy`
- `grafana`
- `tempo`
- `node-exporter`

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

The API reads environment from **`/var/www/jbt/server/.env`** (loaded by Node/`dotenv`).  
Do **not** put these in `deploy/observability/.env` — that file is only for Grafana/Docker.

### E.1 Edit `server/.env` on the VPS

```bash
nano /var/www/jbt/server/.env
# ensure mode stays private:
chmod 600 /var/www/jbt/server/.env
```

Add or update (minimum for logs + Ops links):

```bash
LOG_FORMAT=json
GRAFANA_PUBLIC_URL=https://justxsystems.com/grafana
```

Optional alerts / exception store:

```bash
ERROR_WEBHOOK_URL=https://hooks.slack.com/services/...   # or Discord webhook
SENTRY_DSN=https://KEY@HOST/PROJECT                      # Sentry SaaS or GlitchTip
SENTRY_ENVIRONMENT=production
ERRORS_UI_URL=https://glitchtip.example/                 # optional deep link in Ops UI
```

**Leave traces off until [§4](#4-phase-4--tempo-traces--hostmysql-metrics--step-by-step)** (Tempo + Alloy OTLP must be running first). When you are ready for Phase 4, add:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

| Variable | Why |
|----------|-----|
| `LOG_FORMAT=json` | One JSON object per log line so Loki can parse `status`, `requestId`, etc. |
| `GRAFANA_PUBLIC_URL` | Admin → Operations “Open Grafana” / Loki / Tempo buttons |
| `ERROR_WEBHOOK_URL` | Instant Slack/Discord page on server errors |
| `SENTRY_DSN` | Exception store (SaaS or GlitchTip) |
| `ERRORS_UI_URL` | Optional link in Operations UI |
| `OTEL_ENABLED=true` | Turn on OpenTelemetry spans (API + worker) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Where Node sends traces (Alloy on the VPS loopback) |

Save in nano: `Ctrl+O` → Enter → `Ctrl+X`.

### E.2 Reload PM2 with the new env

PM2 does **not** pick up `.env` changes until you reload with `--update-env` (or run a full deploy).

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

If you set `OTEL_ENABLED=true`, after a few requests you should also see `"traceId":"..."` inside those JSON lines ([§4.5](#45-verify-traces-in-grafana-and-admin-ops)).

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

### F.3 Traces / host metrics (only after Phase 4)

If you have **not** enabled Phase 4 yet, skip this. After [§4](#4-phase-4--tempo-traces--hostmysql-metrics--step-by-step):

1. Admin → **Operations** — Telemetry should show **OTel on**; buttons **Tempo: traces** and **Prometheus: host mem** should appear.  
2. Grafana → Explore → **Tempo** — after hitting any API URL, Search should show recent traces for `justx-jbt-api`.  
3. Grafana → Explore → **Prometheus** — run `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes`.

### F.4 If Alloy shows no logs

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

### G.9 Prometheus (host / MySQL metrics)

Datasource **Prometheus** is provisioned automatically. Day one (logs only) you can ignore it. After Phase 4, `node-exporter` scrapes the VPS — use Explore → **Prometheus** for CPU/RAM/disk ([§4.6](#46-host-metrics-always-on-after-compose-up)). MySQL needs the optional profile ([§4.7](#47-optional--mysql-metrics)).

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

## 4. Phase 4 — Tempo traces + host/MySQL metrics (step-by-step)

Do this **only after** Grafana opens at `https://justxsystems.com/grafana/` and Loki shows API logs ([§F](#f-verify-end-to-end) / [§G](#g-using-grafana-to-view-and-analyze-jbt-logs)).

Lean stack on the **same** Hostinger VPS (containers are mem-capped). **Do not** self-host GlitchTip or ClickHouse on this box.

### 4.0 What Phase 4 adds (plain English)

| You already have | Phase 4 adds |
|------------------|--------------|
| Loki = “what did the API print?” | **Tempo** = “what did this one HTTP call do, as a timeline of spans?” |
| Admin Ops health cards | Deep links: **Tempo: traces**, **Prometheus: host mem** |
| — | **node_exporter** = is the VPS out of RAM / CPU? |
| — | Optional **mysqld_exporter** = is MySQL saturated? |

**How traces flow (memorize this):**

```text
Browser → nginx → Node API (OpenTelemetry SDK)
                      │
                      ├─ JSON log line (requestId + traceId) → PM2 → Alloy → Loki
                      │
                      └─ OTLP HTTP → 127.0.0.1:4318 (Alloy) → Tempo → Grafana Explore
```

Traces are **opt-in**. Docker can run Tempo forever; the API only sends spans when `OTEL_ENABLED=true` in **`/var/www/jbt/server/.env`**.

### 4.1 Prerequisites checklist

SSH in first ([§0.1](#01-ssh-into-the-vps)), then confirm:

```bash
# 1) You are deploy on the VPS
whoami
# expect: deploy

# 2) Docker works
docker --version
docker compose version

# 3) Grafana already responds (from earlier §§ C–D)
curl -sI http://127.0.0.1:3003/grafana/ | head -5
# expect HTTP/1.1 200 or 302 — not connection refused

# 4) Free RAM still OK for ~0.5 GB more (Tempo + node-exporter)
free -h
```

If Docker or Grafana is missing, finish [§A](#a-install-docker-engine--compose-on-the-vps)–[§D](#d-expose-grafana-through-nginx) first — do not start Phase 4 mid-install.

### 4.2 Pull the Phase 4 files onto the VPS

Phase 4 lives in git (`tempo-config.yml`, updated `docker-compose.yml`, OTel code in `server/`). Your VPS must be on current `master`.

**Preferred (rebuilds app + installs npm deps including OpenTelemetry packages):**

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

Wait until it finishes (npm ci, web build, PM2 reload, health check). That can take several minutes.

**If deploy already ran today and you only need compose files**, still confirm files exist:

```bash
cd /var/www/jbt
git log -1 --oneline
ls deploy/observability/tempo-config.yml
ls deploy/observability/docker-compose.yml
grep -n tempo deploy/observability/docker-compose.yml | head
ls server/src/lib/otel.ts
```

If `tempo-config.yml` is missing, deploy did not get the Phase 4 commit — run `./scripts/vps-deploy.sh` again (or `git fetch && git reset --hard origin/master` only if you know that is safe on this host).

### 4.3 Start / refresh the Docker stack (Tempo + node-exporter)

This uses the **same** folder and `.env` as Grafana day one. You do **not** create a second stack.

```bash
cd /var/www/jbt/deploy/observability

# Confirm Grafana password file still exists (do NOT recreate if already set)
ls -la .env
grep GF_SECURITY_ADMIN_USER .env
# Password is there — do not paste it into chat or git

# Pull new images and (re)create containers
docker compose up -d

# Watch status
docker compose ps
```

**What you should see as `Up`:**

| Name (approx.) | Required? |
|----------------|-----------|
| `loki` | yes |
| `prometheus` | yes |
| `alloy` | yes |
| `grafana` | yes |
| `tempo` | yes (Phase 4) |
| `node-exporter` | yes (Phase 4) |
| `mysqld-exporter` | no — only after [§4.7](#47-optional--mysql-metrics) |

If `tempo` or `node-exporter` is missing, the compose file on disk is old — go back to [§4.2](#42-pull-the-phase-4-files-onto-the-vps).

**Check logs if something is Restarting:**

```bash
docker compose logs tempo --tail=40
docker compose logs node-exporter --tail=20
docker compose logs alloy --tail=40
```

**Check OTLP port (Alloy receives traces here):**

```bash
ss -lntp | grep 4318 || netstat -lntp 2>/dev/null | grep 4318
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4318/
# Any response code is fine (often 404/405). "Connection refused" means Alloy is not listening.
```

**Check host metrics scrape (optional):**

```bash
# From inside the compose network — Prometheus should list node-exporter
docker compose exec prometheus wget -qO- http://node-exporter:9100/metrics | head -5
```

RAM snapshot:

```bash
docker stats --no-stream
free -h
```

If the box starts swapping heavily, stop extras first:

```bash
cd /var/www/jbt/deploy/observability
docker compose stop tempo node-exporter
# last resort: docker compose down   (keeps volumes; Loki history preserved)
```

### 4.4 Turn on OpenTelemetry in the API (and worker)

#### 4.4.1 Edit the correct file

The app env file is:

```text
/var/www/jbt/server/.env
```

**Not** `/var/www/jbt/.env`  
**Not** `/var/www/jbt/deploy/observability/.env`

```bash
nano /var/www/jbt/server/.env
```

#### 4.4.2 Add these lines (or change them if they already exist)

Keep your existing DB / JWT / Google lines. Append or edit:

```bash
LOG_FORMAT=json
GRAFANA_PUBLIC_URL=https://justxsystems.com/grafana

# Phase 4 — traces
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

| Line | Meaning |
|------|---------|
| `OTEL_ENABLED=true` | Start the OpenTelemetry SDK on API **and** worker |
| `OTEL_EXPORTER_OTLP_ENDPOINT=...` | Send spans to Alloy on this VPS (loopback only — not public) |

Optional (usually leave default):

```bash
# OTEL_SERVICE_NAME=justx-jbt-api
# OTEL_DIAG_DEBUG=true    # noisy — only while debugging missing traces
```

Save: `Ctrl+O` → Enter → `Ctrl+X`.

```bash
chmod 600 /var/www/jbt/server/.env
```

#### 4.4.3 Reload PM2 so the new env is loaded

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
pm2 status
```

Both `justx-jbt-api` and `justx-jbt-worker` should be **online**.

If you prefer a full rebuild (also refreshes `node_modules` OTel packages):

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

#### 4.4.4 Generate traffic and confirm `traceId` in logs

```bash
# Trigger a few API calls (from the VPS)
curl -sI http://127.0.0.1:4002/api/health | head -15
# Note X-Request-Id header

# Or hit public health
curl -sI https://justxsystems.com/jbt/api/health | head -15

# Inspect recent API logs for traceId
pm2 logs justx-jbt-api --lines 30 --nostream | grep -E 'traceId|http_request' | tail -10
```

**Success look:** a JSON line containing both `"requestId":"..."` and `"traceId":"..."` (32 hex characters).

**If there is `requestId` but no `traceId`:**

1. Confirm env is really loaded:

```bash
pm2 env 0 | grep -E 'OTEL_|LOG_FORMAT|GRAFANA' || true
# If empty, find the API id: pm2 list
# then: pm2 env <id> | grep OTEL
```

2. Confirm Tempo/Alloy still up: `docker compose -f /var/www/jbt/deploy/observability/docker-compose.yml ps`  
3. Confirm you edited **`server/.env`**, then `pm2 reload … --update-env` again.  
4. Confirm `server/src/lib/otel.ts` exists (deploy pulled Phase 4 code).

### 4.5 Verify traces in Grafana (and Admin Ops)

#### 4.5.1 Admin Operations

1. Browser: https://justxsystems.com/jbt/admin/ops  
2. Under **Telemetry config**, expect **OTel on**.  
3. Under **Observability links**, use:
   - **Tempo: traces**
   - **Prometheus: host mem**
   - **Loki: API logs (1h)** (still your fastest triage)

#### 4.5.2 Grafana → Tempo

1. Open https://justxsystems.com/grafana/ and sign in.  
2. Left sidebar → **Explore**.  
3. Top datasource dropdown → **Tempo** (not Loki).  
4. Use **Search** / TraceQL search for service `justx-jbt-api`, last 15–60 minutes.  
5. Click a recent trace → you should see HTTP spans. Span attribute **`request.id`** matches the `X-Request-Id` / Loki `requestId`.

**From a Loki log line:** copy `traceId` → Explore → Tempo → paste the id (TraceQL / TraceID query).

#### 4.5.3 Loki ↔ Tempo together

```logql
{service="justx-jbt-api"} |= "<paste-request-id>"
```

Expand the line → copy `traceId` → open in Tempo. Full triage steps: [§G.6](#g6-triage-one-http-request-end-to-end).

### 4.6 Host metrics (always on after compose up)

No extra MySQL user needed. `node-exporter` scrapes the VPS; Prometheus scrapes `node-exporter`.

1. Grafana → Explore → datasource **Prometheus**.  
2. Run:

```promql
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
```

Expect a graph between `0` and `1` (fraction of RAM free).

Other useful queries:

```promql
# Idle CPU rate (higher = more idle)
rate(node_cpu_seconds_total{mode="idle"}[5m])

# Root filesystem free bytes (panel may need mountpoint label filter)
node_filesystem_avail_bytes{mountpoint="/"}
```

Or click **Prometheus: host mem** on Admin → Operations.

If Prometheus Explore is empty:

```bash
cd /var/www/jbt/deploy/observability
docker compose ps node-exporter
docker compose logs node-exporter --tail=30
docker compose exec prometheus wget -qO- 'http://localhost:9090/api/v1/targets' | head -c 2000
```

Look for job `node` / target `node-exporter:9100` = **UP**.

### 4.7 Optional — MySQL metrics

Skip unless you want DB graphs. Creates a **read-only** MySQL user and starts one more container.

#### 4.7.1 Create the MySQL user (on the VPS)

```bash
sudo mysql
```

In the MySQL prompt (replace `LONG_RANDOM_SECRET` with a real password — generate with `openssl rand -base64 24`):

```sql
CREATE USER IF NOT EXISTS 'jbt_exporter'@'127.0.0.1' IDENTIFIED BY 'LONG_RANDOM_SECRET';
CREATE USER IF NOT EXISTS 'jbt_exporter'@'localhost' IDENTIFIED BY 'LONG_RANDOM_SECRET';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'jbt_exporter'@'127.0.0.1';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'jbt_exporter'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

#### 4.7.2 Put the DSN in the **observability** `.env` (Docker file)

This goes in **`/var/www/jbt/deploy/observability/.env`** — the same file as `GF_SECURITY_ADMIN_PASSWORD`.  
It is **not** `server/.env`.

```bash
# Generate a password once; reuse it in SQL + DSN
openssl rand -base64 24
```

```bash
nano /var/www/jbt/deploy/observability/.env
```

Add **one** line (password must match the SQL user). Rules:

- No spaces around `=`
- No quotes around the value
- Trailing `/` after the host is required
- If the password contains `@`, `:`, `/`, or `#`, URL-encode them or pick a simpler password

```bash
MYSQL_EXPORTER_DSN=jbt_exporter:LONG_RANDOM_SECRET@(host.docker.internal:3306)/
```

Verify the line is present and non-empty (**do not** paste the password into chat):

```bash
grep -E '^MYSQL_EXPORTER_DSN=' /var/www/jbt/deploy/observability/.env | sed 's/:.*@/:***@/'
# Expect: MYSQL_EXPORTER_DSN=jbt_exporter:***@(host.docker.internal:3306)/
```

Save, then recreate the exporter (editing `.env` alone is not enough if the container already started empty):

```bash
chmod 600 /var/www/jbt/deploy/observability/.env
cd /var/www/jbt/deploy/observability
docker compose --profile mysql-metrics up -d --force-recreate mysqld-exporter
docker compose ps
docker compose logs mysqld-exporter --tail=30
```

**Healthy logs** look like “Listening on …” / no restart loop.  
**Broken** (empty DSN) looks exactly like:

```text
failed to validate config … err="no user specified in section or parent"
Error parsing host config file=.my.cnf err="no configuration found"
```

That means `DATA_SOURCE_NAME` inside the container is empty → fix the `.env` line and `--force-recreate` again.

Confirm the container actually received the DSN (password redacted in output):

```bash
docker compose --profile mysql-metrics exec mysqld-exporter \
  sh -c 'echo "$DATA_SOURCE_NAME" | sed "s/:.*@/:***@/"'
# Expect: jbt_exporter:***@(host.docker.internal:3306)/
```

#### 4.7.3 Query in Grafana

Explore → **Prometheus**:

```promql
mysql_up
mysql_global_status_threads_connected
```

`mysql_up` should be `1`. If `0` or target DOWN, check password/DSN and that MySQL listens on `127.0.0.1:3306`.

#### 4.7.4 Symptom: crash loop / “no user specified”

| Cause | Fix |
|-------|-----|
| Started profile before setting `MYSQL_EXPORTER_DSN` | Add DSN to observability `.env`, then `--force-recreate mysqld-exporter` |
| Line commented out (`# MYSQL_EXPORTER_DSN=…`) | Uncomment it |
| Put DSN in `server/.env` by mistake | Move to `deploy/observability/.env` |
| Quotes / spaces: `DSN="…"` or `DSN = …` | Use bare `MYSQL_EXPORTER_DSN=user:pass@(host.docker.internal:3306)/` |
| Do not need MySQL metrics right now | Stop the crash loop: `docker compose --profile mysql-metrics stop mysqld-exporter` (or omit the profile) |

Optional — allow Docker host to connect if MySQL only allows socket users (user already created for `127.0.0.1` above covers `host.docker.internal` via host-gateway on Linux).

Test MySQL login from the host before blaming Docker:

```bash
mysql -h 127.0.0.1 -u jbt_exporter -p -e "SELECT 1"
```

### 4.8 Optional — nginx basic auth in front of Grafana

Recommended once Grafana is public. Step-by-step: [§D.3](#d3-strongly-recommended-http-basic-auth-in-front-of-grafana).

```bash
bash /var/www/jbt/deploy/observability/scripts/setup-grafana-basic-auth.sh
# Follow the printed "include …" line inside location /grafana/
sudo nginx -t && sudo systemctl reload nginx
```

Also keep the `proxy_redirect` lines from [§D.6](#d6-symptom-explore--loki-api-logs-opens-marketing-indexhtml) so Explore stays under `/grafana/`.

### 4.9 Phase 4 done checklist

| Check | How |
|-------|-----|
| Containers up | `cd /var/www/jbt/deploy/observability && docker compose ps` |
| OTLP listening | `ss -lntp \| grep 4318` |
| Env on | `grep OTEL_ /var/www/jbt/server/.env` then PM2 reload done |
| Logs have traceId | `pm2 logs justx-jbt-api --lines 20 --nostream \| grep traceId` |
| Tempo UI | Grafana Explore → Tempo → recent `justx-jbt-api` traces |
| Ops UI | `/jbt/admin/ops` shows OTel **on** + Tempo button |
| Host mem | Prometheus query `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` |

### 4.10 Turn traces off again (if needed)

```bash
nano /var/www/jbt/server/.env
# set OTEL_ENABLED=false   or delete the OTEL_* lines
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
```

Tempo can keep running idle; or `docker compose stop tempo` to free RAM.

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
| Phase 4: no `tempo` / `node-exporter` in `compose ps` | Pull latest master ([§4.2](#42-pull-the-phase-4-files-onto-the-vps)), then `docker compose up -d` |
| Phase 4: logs have `requestId` but no `traceId` | Edit **`/var/www/jbt/server/.env`** (not observability `.env`); `OTEL_ENABLED=true`; `pm2 reload … --update-env`; Alloy on `:4318` |
| Tempo Explore empty | Generate traffic; wait ~30s; datasource **Tempo**; check `docker compose logs tempo alloy` |
| Prometheus host query empty | `node-exporter` Up? Prometheus target `node` UP? ([§4.6](#46-host-metrics-always-on-after-compose-up)) |
| `mysql_up` = 0 | DSN password / `host.docker.internal` / profile `mysql-metrics` ([§4.7](#47-optional--mysql-metrics)) |
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

# --- Phase 4 (after Loki works) — see docs §4 for full walkthrough ---
cd /var/www/jbt && ./scripts/vps-deploy.sh
cd /var/www/jbt/deploy/observability && docker compose up -d && docker compose ps
# edit /var/www/jbt/server/.env → OTEL_ENABLED=true + OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
cd /var/www/jbt && pm2 reload ecosystem.config.cjs --update-env
curl -sI http://127.0.0.1:4002/api/health | head
pm2 logs justx-jbt-api --lines 20 --nostream | grep traceId
# Grafana Explore → Tempo; Admin → /jbt/admin/ops → Tempo: traces
```
