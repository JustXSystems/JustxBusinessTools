# Production deploy — GitHub Actions + PM2

**URL:** https://justxsystems.com/jbt/  
**VPS:** `deploy@193.203.161.219` (Hostinger KVM)  
**Ports:** web **3002** · API **4002** (do not use **3001** — Zigma)

This is the supported deploy path. The old multi-script `deploy/*.sh` toolkit is **retired**.

Product/OAuth/env details: [`SETUP.md`](SETUP.md).  
On-call / incident runbooks: [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md).

---

## How it works

```
git push → GitHub Actions → SSH to VPS → scripts/vps-deploy.sh
                                              ├─ git pull
                                              ├─ npm ci
                                              ├─ build web (/jbt)
                                              └─ pm2 reload
```

---

## Part 1 — One-time server setup (do once)

SSH as root or a sudo user.

### 1.1 Packages

```bash
sudo apt-get update
sudo apt-get install -y git curl build-essential nginx certbot python3-certbot-nginx mysql-server

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
sudo mkdir -p /var/www/jbt
sudo chown -R deploy:deploy /var/www/jbt
sudo -u deploy git clone https://github.com/JustXSystems/JustxBusinessTools.git /var/www/jbt
cd /var/www/jbt
```

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

These secrets let GitHub Actions **SSH into the VPS** and run `scripts/vps-deploy.sh`.  
Finish **Part 1** first (clone at `/var/www/jbt`, `server/.env`, MySQL, nginx, first PM2 start).

### 2.1 What each secret means

| Secret | Meaning | Exact value to use |
|--------|---------|-------------------|
| `DEPLOY_HOST` | VPS address | `193.203.161.219` |
| `DEPLOY_USER` | Linux login user | `deploy` |
| `DEPLOY_SSH_KEY` | **Private** SSH key (full file) | Contents of `jbt_deploy` (not `.pub`) |
| `DEPLOY_PATH` | App directory on the server | `/var/www/jbt` |

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
ls /var/www/jbt/scripts/vps-deploy.sh
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
- **Actions** → workflow **Deploy** → **Run workflow**

Watch the job log. On success it SSHs in, runs `./scripts/vps-deploy.sh`, and health-checks the API.

### 2.7 Manual deploy (without Actions)

On the VPS as `deploy`:

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

Workflow file: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)  
Remote script: [`scripts/vps-deploy.sh`](../scripts/vps-deploy.sh)

---

## Day-2 commands

```bash
pm2 status
pm2 logs justx-jbt-api --lines 80
pm2 logs justx-jbt-web --lines 80
pm2 restart justx-jbt-api justx-jbt-web
```

Rollback = redeploy an older commit:

```bash
cd /var/www/jbt
git fetch origin
git reset --hard <commit_sha>
./scripts/vps-deploy.sh
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Actions: `Permission denied (publickey)` | Public key not in `/home/deploy/.ssh/authorized_keys`, or secret is the **.pub** file by mistake |
| Actions: `DEPLOY_PATH` / `cd` fails | Path wrong or clone missing — fix Part 1.3 |
| Actions: `server/.env missing` | Create `/var/www/jbt/server/.env` (Part 1.5) |
| Local `ssh -i …` fails | Same key/user/host as secrets; fix this before debugging Actions |
| Build fail | Node 20+ on VPS; `npm ci` needs lockfile |
| `Cannot find module '../lightningcss.linux-x64-gnu.node'` | Turbopack can’t load the native binary — build with webpack: `cd web && npx next build --webpack` (repo `web` build script already uses `--webpack`) |
| `JWT_SECRET` / env errors | `server/.env` incomplete — API exits on bad prod env |
| MySQL 1819 | Stronger `DB_PASSWORD` (upper+lower+digit+special) |
| `users` missing / `Duplicate column 'home_tool_ids'` | `admin_schema.sql` aborted mid-file — pull latest, then re-run from `admin_schema.sql` onward (see Part 1.4) |
| 502 from nginx | `pm2 status`; ports 3002/4002 listening |
| OAuth mismatch | Google redirect URIs must include `/jbt/api/...` |
| `Illegal mix of collations` (`utf8mb4_unicode_ci` vs `utf8mb4_0900_ai_ci`) | Runtime tables created without COLLATE on MySQL 8 — deploy latest (auto-converts) or run: `ALTER TABLE org_subscription_items CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` (also `org_tool_licenses`, `checkout_intents`, `product_bundle_items` if needed) |

### lightningcss / Turbopack on VPS

Next.js 16 defaults to Turbopack, which fails loading the `lightningcss` native `.node` binary in PostCSS. Production builds use webpack:

```bash
cd /var/www/jbt
# ensure Linux binary exists (once)
test -d node_modules/lightningcss-linux-x64-gnu \
  || npm install --no-save lightningcss-linux-x64-gnu@1.32.0
cp -n node_modules/lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node \
  node_modules/lightningcss/ 2>/dev/null || true

export NEXT_PUBLIC_BASE_PATH=/jbt
cd web && npx next build --webpack
```
