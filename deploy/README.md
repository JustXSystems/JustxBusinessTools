# JustX Systems — Deployment Automation
#
# Production framework for path-based multi-app hosting on Hostinger Ubuntu VPS.
# JBT: https://justxsystems.com/jbt/  (PM2 · web :3002 · api :4002)
# Note: port 3001 is reserved for the existing Zigma application on this VPS.

## Layout

```
deploy/
├── deploy.sh              # Main orchestrator
├── setup-server.sh        # One-time VPS init
├── health-check.sh        # Standalone health / smoke tests
├── rollback.sh            # Roll back to previous release
├── config/projects.conf   # Project registry (ports, paths, DB)
├── lib/                   # Shared modules
├── templates/             # nginx, .env, PM2, systemd, logrotate
└── hooks/                 # Optional on-<event>.sh + webhooks
```

## Architecture

| Concern | Detail |
|--------|--------|
| Host | `193.203.161.219` · `deploy@…` · Ubuntu KVM |
| Canonical domain | `justxsystems.com` (`www` → apex redirect) |
| Public URL | `https://justxsystems.com/jbt/` |
| App isolation | Unique ports, `.env`, nginx locations, logs per project |
| JBT ports | Web **`3002`** · API **`4002`** (PM2) |
| Reserved | Web **`3001`** — Zigma (do not reuse) |
| Process manager | **PM2** (default; `justx-jbt-web` + `justx-jbt-api`) |
| Releases | `/opt/justx/releases/<project>/` — keep last 3 + current |
| Secrets | `/opt/justx/shared/<project>/` mode `600` / `700` |
| Logs | `/var/log/deployments/<project>/` |

Nginx uses **one server block for the apex domain** and **per-project location includes** under `/etc/nginx/justx.d/`, so `/jbt` and other path apps share TLS.

---

## 0. Pull code from GitHub (on the VPS)

Repo: **https://github.com/JustXSystems/JustxBusinessTools**

### Hostinger / DNS (hPanel)

1. **VPS** → note IP `193.203.161.219`, SSH user `deploy` (or root for first setup).
2. **Domains** → `justxsystems.com` → DNS:
   - `A` `@` → `193.203.161.219`
   - `A` `www` → `193.203.161.219`
3. Wait until `ping justxsystems.com` resolves to that IP before SSL/Certbot.

### GitHub

1. Repo must be **readable** by the VPS:
   - **Public repo:** plain `git clone` works.
   - **Private repo:** add a deploy key (VPS SSH public key → GitHub repo **Settings → Deploy keys → Allow read**), or use a fine-grained PAT over HTTPS.
2. No GitHub Actions required for a manual first deploy (optional later — see `examples/github-actions-deploy.yml`).

### On the server (as `deploy`)

```bash
# Tools for clone (if missing)
sudo apt-get update && sudo apt-get install -y git

# Clone once
sudo mkdir -p /opt/justx/apps/jbt
sudo chown -R deploy:deploy /opt/justx
git clone https://github.com/JustXSystems/JustxBusinessTools.git /opt/justx/apps/jbt/src

cd /opt/justx/apps/jbt/src/deploy
```

If the repo is **private** and you use a deploy key:

```bash
ssh-keygen -t ed25519 -C "deploy@justxsystems" -f ~/.ssh/github_justx -N ""
cat ~/.ssh/github_justx.pub
# paste into GitHub → JustxBusinessTools → Settings → Deploy keys

# ~/.ssh/config
# Host github.com
#   IdentityFile ~/.ssh/github_justx
#   IdentitiesOnly yes

git clone git@github.com:JustXSystems/JustxBusinessTools.git /opt/justx/apps/jbt/src
```

---

## 1. First-time server setup

SSH as root **or** `deploy` with sudo:

```bash
cd /opt/justx/apps/jbt/src/deploy
sudo DEPLOY_USER=deploy ./setup-server.sh
```

This installs Node 20, nginx, MySQL, Certbot, PM2, firewall rules, and copies the toolkit to `/opt/justx/deploy`.

**DNS:** Point `justxsystems.com` and `www.justxsystems.com` A records to `193.203.161.219` before SSL.

---

## 2. Initial project deployment (JBT)

As `deploy` on the server:

```bash
export GOOGLE_CLIENT_ID="….apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="…"
export SSL_EMAIL="justxsystems@gmail.com"

# Recommended after clone (uses tree at REPO_ROOT / --local):
export REPO_ROOT=/opt/justx/apps/jbt/src
cd /opt/justx/deploy
./deploy.sh jbt --local

# Or let deploy.sh clone/pull via REPO_URL in projects.conf:
# cd /opt/justx/deploy && ./deploy.sh jbt
```

This starts **PM2** apps:

- `justx-jbt-web` → `127.0.0.1:3002` (Next.js, `basePath=/jbt`)
- `justx-jbt-api` → `127.0.0.1:4002` (Express)

Nginx proxies `https://justxsystems.com/jbt/` and `/jbt/api/` accordingly.

### Google OAuth redirect URIs (exact)

- `https://justxsystems.com/jbt/api/auth/google/callback`
- `https://justxsystems.com/jbt/api/profile/drive/callback`

Authorized JavaScript origin: `https://justxsystems.com`

### CI / non-interactive

```bash
export DEPLOY_MODE=ci NONINTERACTIVE=1
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
export SSL_EMAIL=justxsystems@gmail.com
./deploy.sh jbt --local
```

---

## 3. Subsequent deployments

```bash
cd /opt/justx/deploy
./deploy.sh jbt --local
pm2 status   # confirm justx-jbt-web / justx-jbt-api
```

| Flag | Meaning |
|------|---------|
| `--skip-prereqs` | Skip apt/Node installs |
| `--skip-ssl` | Do not run Certbot |
| `--skip-seed` | Skip DB seed scripts |
| `--skip-health` | Skip smoke tests |
| `--local` | Rsync from the repo that contains `deploy/` |

---

## 4. Adding another path app

Edit `config/projects.conf` with a **free** port (not 3001/3002/4002):

```ini
[my-app]
NAME=My App
DOMAIN=justxsystems.com
BASE_PATH=/my-app
WEB_PORT=3003
API_PORT=4003
...
```

```bash
./deploy.sh my-app
```

---

## 5. Health monitoring

```bash
./health-check.sh jbt
./health-check.sh jbt --json
pm2 logs justx-jbt-web --lines 50
```

Checks local `:3002` / `:4002`, MySQL, OAuth env, and HTTPS:

- `https://justxsystems.com/jbt`
- `https://justxsystems.com/jbt/api/health`

---

## 6. Rollback

```bash
./rollback.sh jbt --list
./rollback.sh jbt
```

---

## 7. PM2 cheat sheet

```bash
pm2 status
pm2 restart justx-jbt-web justx-jbt-api
pm2 save
# once (startup on reboot):
pm2 startup
```

---

## Security notes

- Secrets only under `/opt/justx/shared/jbt/` (mode 600)
- App ports bind on localhost; public entry is nginx :443
- Production `.env`: `REQUIRE_AUTH=true`, `CORS_ORIGIN=https://justxsystems.com`

Full product/OAuth walkthrough: **`SETUP_GUIDE.md`** · env checklist: **`PRODUCTION.md`**.
