# Production deploy — GitHub Actions (CI build) + PM2

**URL:** https://justxsystems.com/jbt/  
**VPS:** `deploy@193.203.161.219` (Hostinger KVM)  
**Ports:** web **3002** · API **4002** (do not use **3001** — Zigma)

This is the supported deploy path. The old multi-script `deploy/*.sh` toolkit is **retired**.

Product/OAuth/env details: [`SETUP.md`](SETUP.md).  
On-call / incident runbooks: [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md).

---

## How it works

```
git push master
  → GitHub Actions build (npm cache + Next cache)
  → npm prune --omit=dev + pack jbt-release.tgz (+ .sha256)
  → scp to VPS + checksum verify
  → scripts/vps-release.sh
       ├─ preflight (disk, rsync, pm2, …)
       ├─ extract to /var/www/jbt-releases/<sha>
       ├─ optional DB backup
       ├─ migrate/seeds on stage (live still old)
       ├─ atomic swap: jbt → jbt.old ; jbt.new → jbt
       ├─ pm2 reload
       ├─ health: API + web :3002/jbt
       └─ on failure: auto-restore jbt.old (default on)
```

**Mutable data** lives in `/var/www/jbt-shared/` (`server.env`, `uploads/`, `server-uploads/`) and is symlinked into each release.  
**VPS does not run `next build` on normal deploys.**  
Emergency fallback: `./scripts/vps-deploy.sh` (git pull + build on the server).

---

## Part 1 — One-time server setup (do once)

SSH as root or a sudo user.

### 1.1 Packages

```bash
sudo apt-get update
sudo apt-get install -y git curl build-essential nginx certbot python3-certbot-nginx mysql-server rsync

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm install -g pm2
```

### 1.2 Deploy user + SSH key

```bash
sudo adduser --disabled-password --gecos "" deploy   # skip if exists
sudo usermod -aG sudo deploy   # optional; or grant narrower rights
```

Then allow GitHub Actions (and you) to SSH as `deploy` using a key pair:

1. On your **PC**, create the key (Part 2.2).
2. On the **VPS**, install the **public** key into `deploy`’s `authorized_keys` (Part 2.3 below — full commands).
3. Later, put the **private** key into the GitHub secret `DEPLOY_SSH_KEY` (Part 2.5).

**Meaning of “put `jbt_deploy.pub` into authorized_keys”:**  
Linux only trusts SSH logins listed in that user’s `~/.ssh/authorized_keys` file. You paste the one-line contents of `jbt_deploy.pub` there so `ssh deploy@…` works without a password.
### 1.3 Clone the app

```bash
sudo mkdir -p /var/www/jbt /var/www/jbt-releases /var/www/jbt-shared
sudo chown -R deploy:deploy /var/www/jbt /var/www/jbt-releases /var/www/jbt-shared
sudo -u deploy git clone https://github.com/JustXSystems/JustxBusinessTools.git /var/www/jbt
cd /var/www/jbt
```

`jbt-releases/` stores staged artifact trees (for rollback).  
`jbt-shared/` holds `server.env` + uploads (created/bootstrapped on first hardened deploy).  
Live app path stays `/var/www/jbt` (atomic directory swap on each release).

### 1.4 MySQL (manual — clear and once)

```bash
sudo mysql
```

```sql
CREATE DATABASE justx_systems CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'justx_user'@'localhost' IDENTIFIED BY 'YourStrongPass1!';
GRANT ALL PRIVILEGES ON justx_systems.* TO 'justx_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Password must satisfy MySQL policy (upper + lower + digit + special).

Load schemas (stop if any file errors — later files need `users` from `admin_schema.sql`):

```bash
cd /var/www/jbt
# one password prompt for the whole chain
mysql -u justx_user -p justx_systems < mysql/init.sql \
  && mysql -u justx_user -p justx_systems < mysql/jbt_schema.sql \
  && mysql -u justx_user -p justx_systems < mysql/admin_schema.sql \
  && mysql -u justx_user -p justx_systems < mysql/auth_extensions.sql \
  && mysql -u justx_user -p justx_systems < mysql/admin_platform.sql \
  && mysql -u justx_user -p justx_systems < mysql/artifact_delivery_schema.sql \
  && mysql -u justx_user -p justx_systems < mysql/notifications_schema.sql \
  && mysql -u justx_user -p justx_systems < mysql/product_commerce_schema.sql

mysql -u justx_user -p justx_systems -e "SHOW TABLES LIKE 'users';"
# must print: users
```

### 1.5 Create `server/.env`

```bash
cp .env.example server/.env
nano server/.env
chmod 600 server/.env
```

Production essentials (see [`SETUP.md`](SETUP.md) for full list):

```env
NODE_ENV=production
PORT=4002
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=justx_user
DB_PASSWORD=YourStrongPass1!
DB_NAME=justx_systems
CORS_ORIGIN=https://justxsystems.com
WEB_PUBLIC_ORIGIN=https://justxsystems.com
WEB_BASE_PATH=/jbt
NEXT_PUBLIC_BASE_PATH=/jbt
JWT_SECRET=paste_long_random_hex
REQUIRE_AUTH=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://justxsystems.com/jbt/api/auth/google/callback
GOOGLE_DRIVE_REDIRECT_URI=https://justxsystems.com/jbt/api/profile/drive/callback
API_PUBLIC_URL=https://justxsystems.com/jbt
PAYMENT_PROVIDER=mock
PAYMENT_AUTO_COMPLETE=false
```

Seed once:

```bash
cd /var/www/jbt
npm ci
export NEXT_PUBLIC_BASE_PATH=/jbt
npm run db:seed -w server
npm run db:seed:tools -w server
```

### 1.6 nginx + SSL

1. DNS: `A` `@` and `www` → `193.203.161.219`
2. Paste locations from [`deploy/nginx-jbt.conf.example`](../deploy/nginx-jbt.conf.example) into the `server { }` for `justxsystems.com`
3. `sudo nginx -t && sudo systemctl reload nginx`
4. `sudo certbot --nginx -d justxsystems.com -d www.justxsystems.com`

Prefer redirecting `www` → apex.

### 1.7 First PM2 start

```bash
cd /var/www/jbt
export NEXT_PUBLIC_BASE_PATH=/jbt
npm run build -w web
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # run the command it prints (once)
```

Check:

```bash
curl -s http://127.0.0.1:4002/api/health
curl -sI http://127.0.0.1:3002/jbt
# then: https://justxsystems.com/jbt/
```

---

## Part 2 — GitHub Actions secrets (do once)

These secrets let GitHub Actions **SCP the release** and **SSH into the VPS** to run `scripts/vps-release.sh`.  
Finish **Part 1** first (clone at `/var/www/jbt`, `server/.env`, MySQL, nginx, first PM2 start).

### 2.1 What each secret means

| Secret | Meaning | Exact value to use |
|--------|---------|-------------------|
| `DEPLOY_HOST` | VPS address | `193.203.161.219` |
| `DEPLOY_USER` | Linux login user | `deploy` |
| `DEPLOY_SSH_KEY` | **Private** SSH key (full file) | Contents of `jbt_deploy` (not `.pub`) |
| `DEPLOY_PATH` | App directory on the server | `/var/www/jbt` |

Releases are stored next to the live app: `/var/www/jbt-releases` (sibling of `DEPLOY_PATH`).

### 2.2 Create an SSH key (on your Windows PC)

In **PowerShell** (note: do **not** use `-N ""` — PowerShell drops the empty string and breaks `-N`):

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\jbt_deploy" -C "github-actions-jbt" -N '""'
```

If that still errors, run without `-N` and press **Enter** twice when asked for a passphrase (leave it blank):

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\jbt_deploy" -C "github-actions-jbt"
```

You get:

| File | Use |
|------|-----|
| `%USERPROFILE%\.ssh\jbt_deploy` | → GitHub secret `DEPLOY_SSH_KEY` |
| `%USERPROFILE%\.ssh\jbt_deploy.pub` | → VPS `authorized_keys` |

Show the public key (copy this line for the server):

```powershell
Get-Content $env:USERPROFILE\.ssh\jbt_deploy.pub
```

### 2.3 Put the public key on the VPS

SSH as root or `deploy`, then:

```bash
sudo mkdir -p /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys
# Paste the single line from jbt_deploy.pub, save, exit

sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Test from your PC (must succeed before Actions will work):

```powershell
ssh -i $env:USERPROFILE\.ssh\jbt_deploy deploy@193.203.161.219
```

You should land in a shell as `deploy` with no password prompt.

### 2.4 Confirm `DEPLOY_PATH` exists

On the VPS:

```bash
ls /var/www/jbt
ls /var/www/jbt/server/.env
sudo mkdir -p /var/www/jbt-releases /var/www/jbt-shared
sudo chown deploy:deploy /var/www/jbt-releases /var/www/jbt-shared
```

If `/var/www/jbt` is missing, complete Part 1.3–1.7 first.  
If you cloned somewhere else, use **that** path as `DEPLOY_PATH` instead.

### 2.5 Add secrets in GitHub

1. Open https://github.com/JustXSystems/JustxBusinessTools  
2. **Settings** → **Secrets and variables** → **Actions**  
3. **New repository secret** — create four secrets:

**`DEPLOY_HOST`**
```
193.203.161.219
```

**`DEPLOY_USER`**
```
deploy
```

**`DEPLOY_PATH`**
```
/var/www/jbt
```

**`DEPLOY_SSH_KEY`** — paste the **entire private** key:

```powershell
Get-Content $env:USERPROFILE\.ssh\jbt_deploy -Raw
```

Must include the `BEGIN` / `END` lines, for example:

```
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

Do **not** paste the `.pub` file into `DEPLOY_SSH_KEY`.

### 2.6 Run a deploy

- Push a commit to **`master`**, or  
- **Actions** → workflow **Deploy** → **Run workflow** (optional CD inputs below)

Watch the job log: **build** packs the artifact; **deploy** SCPs it and runs `vps-release.sh`.

### 2.7 Manual deploy (without Actions)

**Preferred emergency path** (build on the VPS):

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

Same allowlisted env knobs as Actions (`RUN_MIGRATIONS`, `SEED_TOOLS`, `PM2_MODE`, `POST_DEPLOY_TASK`, `HEALTH_CHECK`).

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)  
Release apply: [`scripts/vps-release.sh`](../scripts/vps-release.sh)  
Local-build fallback: [`scripts/vps-deploy.sh`](../scripts/vps-deploy.sh)

---

## Advanced CD — workflow_dispatch options

**Actions → Deploy → Run workflow** exposes optional controls.  
Push-to-`master` always uses the safe defaults (no exotic tasks).

| Input | Default | Purpose |
|-------|---------|---------|
| `deploy_enabled` | `true` | Set `false` to **build + upload artifact only** (no VPS change) |
| `run_migrations` | `true` | Apply `mysql/migrations` on **stage before** live swap |
| `backup_db` | `false` | Run `backup-jbt.sh` (MySQL dump) before migrations |
| `seed_tools` | `false` | Re-seed tool catalog (`db:seed:tools`) |
| `pm2_mode` | `reload` | `reload` · `restart` · `restart_api` · `restart_web` · `restart_worker` · `none` |
| `post_deploy_task` | `none` | Allowlisted: `none` · `seed_tools` · `seed_admin` · `analytics_rollup` |
| `health_check` | `true` | API + web (`:3002/jbt`) + PM2 probes |
| `auto_rollback` | `true` | Restore previous live tree if health fails after swap |
| `keep_releases` | `3` | Staged dirs under `/var/www/jbt-releases` |

**Rules**

- Ordinary schema changes → commit under `mysql/migrations` (auto on deploy).
- Occasional known ops → checkbox / allowlisted `post_deploy_task`.
- `seed_admin` is intentional and rare — not for routine deploys.
- Migrations run **before** the live swap; a migrate failure leaves the old app serving.
- Auto-rollback restores **code** only — DB migrations are forward-only (use `backup_db` + SQL restore if you must reverse schema).
- There is **no** free-text “run any shell” input.

Example: ship code with DB backup first:

1. Run workflow  
2. `backup_db` = true  
3. `run_migrations` = true  

Example: refresh tool definitions:

1. Run workflow  
2. `seed_tools` = true

---

## Day-2 commands

```bash
pm2 status
pm2 logs justx-jbt-api --lines 80
pm2 logs justx-jbt-web --lines 80
pm2 restart justx-jbt-api justx-jbt-web
```

### Rollback (artifact releases)

```bash
ls /var/www/jbt-releases
cat /var/www/jbt-releases/CURRENT   # active sha
cat /var/www/jbt-releases/PREVIOUS  # prior sha (if set)
RELEASE_ID=<previous_short_sha> /var/www/jbt/scripts/vps-rollback.sh
```

Auto-rollback already runs when a deploy fails health checks (`auto_rollback=true`).  
Manual rollback restores **code** only; schema is not reversed — restore `~/backups/justx_systems_*.sql.gz` if needed.

### Rollback (git + local build fallback)

```bash
cd /var/www/jbt
git fetch origin
git reset --hard <commit_sha>
DEPLOY_BRANCH=HEAD ./scripts/vps-deploy.sh
# or: skip fetch by temporarily adjusting the script flow — prefer artifact rollback above
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Actions: `Permission denied (publickey)` | Public key not in `/home/deploy/.ssh/authorized_keys`, or secret is the **.pub** file by mistake |
| Actions: `DEPLOY_PATH` / apply fails | Path wrong or clone missing — fix Part 1.3 |
| Actions: `server/.env missing` | Create `/var/www/jbt/server/.env` (Part 1.5) |
| Actions: SCP / checksum fail | Re-run workflow; confirm both `.tgz` and `.sha256` uploaded |
| Disk full / preflight | Free space under `/var/www` (need ~3× artifact size); prune `jbt-releases` / backups |
| Health fail then auto-rollback | Read Actions log; fix app bug; previous live tree restored automatically |
| Web probe fail (`:3002`) | `pm2 logs justx-jbt-web`; confirm `NEXT_PUBLIC_BASE_PATH=/jbt` |
| Shared env missing | Ensure `/var/www/jbt-shared/server.env` (bootstrapped from first deploy) |
| Local `ssh -i …` fails | Same key/user/host as secrets; fix this before debugging Actions |
| Build fail on CI | Node 20; lockfile; check **build** job logs (not VPS) |
| `Cannot find module '../lightningcss…'` on **fallback** VPS build | `vps-deploy.sh` installs Linux binary; prefer CI artifact path |
| `JWT_SECRET` / env errors | `server/.env` incomplete — API exits on bad prod env |
| MySQL 1819 | Stronger `DB_PASSWORD` (upper+lower+digit+special) |
| `users` missing / `Duplicate column 'home_tool_ids'` | `admin_schema.sql` aborted mid-file — pull latest, then re-run from `admin_schema.sql` onward (see Part 1.4) |
| 502 from nginx | `pm2 status`; ports 3002/4002 listening |
| OAuth mismatch | Google redirect URIs must include `/jbt/api/...` |
| `Illegal mix of collations` | See prior notes / run `ALTER TABLE … CONVERT TO … utf8mb4_unicode_ci` |

### lightningcss native binary (CI + VPS fallback)

Windows-generated lockfiles often omit `lightningcss-linux-x64-gnu`. Before `next build` on Linux, run `scripts/ensure-lightningcss-native.sh` (wired into GitHub Actions and `vps-deploy.sh`). The CI artifact path does not rebuild CSS on the VPS.
