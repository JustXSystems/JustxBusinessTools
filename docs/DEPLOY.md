# Production deploy — GitHub Actions + PM2

**URL:** https://justxsystems.com/jbt/  
**VPS:** `deploy@193.203.161.219` (Hostinger KVM)  
**Ports:** web **3002** · API **4002** (do not use **3001** — Zigma)

This is the supported deploy path. The old multi-script `deploy/*.sh` toolkit is **retired**.

Product/OAuth/env details: [`SETUP.md`](SETUP.md).

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

# On your PC: create a deploy key (no passphrase for Actions)
# ssh-keygen -t ed25519 -f jbt_deploy -C "github-actions-jbt"
# Put jbt_deploy.pub into: sudo -u deploy mkdir -p ~deploy/.ssh && … authorized_keys
```

GitHub Actions needs the **private** key as secret `DEPLOY_SSH_KEY`.

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

Load schemas:

```bash
cd /var/www/jbt
mysql -u justx_user -p justx_systems < mysql/init.sql
mysql -u justx_user -p justx_systems < mysql/jbt_schema.sql
mysql -u justx_user -p justx_systems < mysql/admin_schema.sql
mysql -u justx_user -p justx_systems < mysql/auth_extensions.sql
mysql -u justx_user -p justx_systems < mysql/admin_platform.sql
mysql -u justx_user -p justx_systems < mysql/artifact_delivery_schema.sql
mysql -u justx_user -p justx_systems < mysql/notifications_schema.sql
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

## Part 2 — GitHub Actions (ongoing deploys)

### 2.1 Repo secrets

| Secret | Example |
|--------|---------|
| `DEPLOY_HOST` | `193.203.161.219` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Contents of private key (`-----BEGIN …`) |
| `DEPLOY_PATH` | `/var/www/jbt` |

### 2.2 Ship code

- Push to **`master`**, or  
- Actions → **Deploy** → **Run workflow**

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)  
Remote script: [`scripts/vps-deploy.sh`](../scripts/vps-deploy.sh)

### 2.3 Manual deploy on the VPS

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

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
| Actions SSH fail | Public key on server; secret is **private** key; user can enter `DEPLOY_PATH` |
| Build fail | Node 20+ on VPS; `npm ci` needs lockfile |
| `JWT_SECRET` / env errors | `server/.env` incomplete — API exits on bad prod env |
| MySQL 1819 | Stronger `DB_PASSWORD` (upper+lower+digit+special) |
| 502 from nginx | `pm2 status`; ports 3002/4002 listening |
| OAuth mismatch | Google redirect URIs must include `/jbt/api/...` |
