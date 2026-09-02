# JustX Business Tools — Production Support Guide

**Audience:** JustX on-call / ops / engineering supporting the live SaaS  
**Production URL:** https://justxsystems.com/jbt/  
**API health:** https://justxsystems.com/jbt/api/health  

Related docs (do not duplicate full setup here):

| Doc | Use when |
|-----|----------|
| [`SETUP.md`](SETUP.md) | Env vars, Google OAuth once, client Drive onboarding |
| [`DEPLOY.md`](DEPLOY.md) | First-time VPS, GitHub Actions, nginx, PM2 |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Grafana/Loki/Prometheus, Admin Operations, Sentry/GlitchTip |
| [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) | Artifact delivery channels & filename policies |
| [`.env.example`](../.env.example) | Env template → `server/.env` on the VPS |

---

## 1. System inventory

| Item | Value |
|------|--------|
| Product | JustX Business Tools (JBT) |
| Public UI | https://justxsystems.com/jbt/ |
| Public API prefix | https://justxsystems.com/jbt/api/ |
| VPS | Hostinger KVM — `193.203.161.219` |
| SSH user | `deploy` |
| App path | `/var/www/jbt` |
| API process (PM2) | `justx-jbt-api` → **127.0.0.1:4002** |
| Worker process (PM2) | `justx-jbt-worker` → background jobs (artifact retry, renewals, analytics) |
| Web process (PM2) | `justx-jbt-web` → **127.0.0.1:3002** |
| Reverse proxy | nginx (TLS via certbot) strips `/jbt` for API |
| Database | MySQL 8 local — DB `justx_systems`, user `justx_user` |
| Repo | https://github.com/JustXSystems/JustxBusinessTools |
| Deploy trigger | Push to `master` or Actions → **Deploy** workflow |
| OAuth owner | `justxsystems@gmail.com` (Google Cloud) |
| Reserved port | **3001** = Zigma — **never** bind JBT there |

### Process map

```
Browser  →  https://justxsystems.com/jbt/...
                │
                ├─ /jbt/api/*  → nginx → 127.0.0.1:4002  (Express)
                └─ /jbt/*      → nginx → 127.0.0.1:3002  (Next.js)
                                      │
                                      └─ MySQL 127.0.0.1:3306
                                      └─ uploads (local disk) / optional S3
                                      └─ Google OAuth + per-profile Drive tokens
```

### Multi-tenant model (support-critical)

- **One** platform Google OAuth client in `server/.env`.
- **Each** Business Profile stores its own encrypted Drive refresh token + folder ID.
- Staff log into JBT only; **only the Profile Owner** connects company Drive.
- Platform admin flag / email (`PLATFORM_ADMIN_EMAIL`, default `admin@justx.local`) can see across orgs in admin tooling.

---

## 2. Support roles & ownership

| Area | Owner | Support action |
|------|--------|----------------|
| VPS, nginx, PM2, MySQL, `server/.env` | JustXSystems | SSH, restart, env, backups |
| Google Cloud OAuth client | JustXSystems (`justxsystems@gmail.com`) | Fix redirect URIs, client secret rotation |
| Deploy / GitHub Actions secrets | JustXSystems | Fix `DEPLOY_*` secrets, re-run workflow |
| Business Profile + company Drive folder | Customer **Owner** | Guide them via Profile UI (do not use personal Gmail) |
| Staff invites / roles | Customer Owner / Admin | Approve users, assign tools |
| Razorpay live keys / webhooks | JustXSystems (billing) | Dashboard + `RAZORPAY_*` env |
| UNC desktop sync agent | Customer IT | See `desktop-sync-agent/` |

**Role capabilities (default matrix)**

| Role | Admin console `/admin` | Billing | Write records | Approve users | Manage branches / tools |
|------|------------------------|---------|---------------|---------------|-------------------------|
| Owner | No (uses Profile app) | Yes | Yes | Yes | Yes |
| Admin | **Yes** | Yes | Yes | Yes | Yes |
| Staff | No | No | Yes | No | No |
| Viewer | No | No | No | No | No |

Hard rule: only **Admin** role opens the admin console (`adminConsole`).

---

## 3. Severity & triage

| Severity | Examples | First response |
|----------|----------|----------------|
| **SEV-1** | Site down, health 503, all logins fail, payment auto-complete left on public host | Check health → PM2 → nginx → MySQL; page eng if not restored in 15 min |
| **SEV-2** | OAuth broken for all tenants, deploys failing, Drive delivery failing for many profiles | Logs + env/Google Console; rollback if last deploy caused it |
| **SEV-3** | Single tenant Drive/PDF issue, one user locked, subscription glitch | Tenant-scoped diagnosis (profile ID, user email, artifact id) |
| **SEV-4** | How-to, branding, non-urgent config | Use SETUP / client checklist |

### Intake checklist (always collect)

1. Time (IST) and URL / screen  
2. User email + Business Profile name / GSTIN if known  
3. Browser + mobile vs desktop  
4. Exact error text or screenshot  
5. Whether it started after a deploy  
6. For delivery issues: quotation/survey number, destination (Drive / webhook / UNC)

---

## 4. Health checks (first 2 minutes)

### Public

```bash
curl -sS https://justxsystems.com/jbt/api/health
# Expect: {"ok":true,"service":"justx-api","db":"ok"}  HTTP 200

curl -sI https://justxsystems.com/jbt/
# Expect: HTTP/2 200 (or 307/308 to trailing slash) — not 502/504
```

If `db` is `"error"` → API is up but MySQL is unreachable (503).  
If curl fails entirely → DNS / nginx / TLS / firewall before blaming the app.

### On the VPS (SSH as `deploy`)

```bash
ssh -i ~/.ssh/jbt_deploy deploy@193.203.161.219

pm2 status
# justx-jbt-api, justx-jbt-web, and justx-jbt-worker should be online

curl -sS http://127.0.0.1:4002/api/health
curl -sI http://127.0.0.1:3002/jbt

ss -lntp | grep -E '3002|4002|3306'
sudo systemctl status nginx mysql --no-pager
```

### Quick decision tree

| Symptom | Likely layer |
|---------|----------------|
| Public 502 / gateway timeout | nginx upstream; PM2 down or wrong port |
| Health `ok:false`, `db:error` | MySQL down, wrong `DB_*`, socket/firewall |
| Health OK, blank / broken UI | Web PM2, wrong `NEXT_PUBLIC_BASE_PATH`, stale build |
| UI OK, API 401/CORS | `CORS_ORIGIN`, cookies, `REQUIRE_AUTH`, session |
| API process exits immediately | Invalid `server/.env` (see §6) |

---

## 5. Day-2 operations

### Logs

```bash
pm2 logs justx-jbt-api --lines 120
pm2 logs justx-jbt-web --lines 120
pm2 logs --lines 200          # both
# Optional: journal for nginx
sudo journalctl -u nginx -n 80 --no-pager
```

API errors in production return generic `"Server error"` to clients; **full stack is in PM2 logs**.

### Restart / reload

```bash
cd /var/www/jbt
pm2 restart justx-jbt-api justx-jbt-web
# After env change:
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

Memory cap: API/web restart at **512M**; worker at **768M** (`ecosystem.config.cjs`). Recurring restarts → check memory leaks / large PDF payloads / runaway jobs.

### Deploy (normal)

1. Merge / push to `master` (docs-only pushes are ignored by the workflow).  
2. Or: GitHub → **Actions** → **Deploy** → **Run workflow**.  
3. Remote runs `scripts/vps-deploy.sh`: `git reset --hard` → `npm ci` → web build (`/jbt`, webpack) → `pm2 reload` → health check.

Manual:

```bash
cd /var/www/jbt
./scripts/vps-deploy.sh
```

### Rollback

```bash
cd /var/www/jbt
git fetch origin
git reset --hard <known_good_sha>
./scripts/vps-deploy.sh
```

Note: `vps-deploy.sh` hard-resets to `origin/master` by default (`DEPLOY_BRANCH`). For a pinned SHA, reset then either temporarily point branch or run build + `pm2 reload` manually without fetching over your pin.

### Schema / seed (rare — prefer migrations from release notes)

Order matters (see `DEPLOY.md` Part 1.4). Never re-seed casually on production; seed scripts are for initial bootstrap.

```bash
# Example check only
mysql -u justx_user -p justx_systems -e "SHOW TABLES LIKE 'users';"
```

---

## 6. Production environment (support reference)

File: **`/var/www/jbt/server/.env`** (mode `600`, never commit).  
Template: root [`.env.example`](../.env.example). Full table: [`SETUP.md`](SETUP.md)#environment-reference.

### Must-be-true on public production

| Check | Expected |
|-------|----------|
| `NODE_ENV` | `production` (also set by PM2) |
| `PORT` | `4002` |
| `REQUIRE_AUTH` | `true` |
| `JWT_SECRET` | ≥32 random chars (not the example) |
| `PAYMENT_AUTO_COMPLETE` | **`false`** (API **refuses to start** if `true` in production) |
| `CORS_ORIGIN` | `https://justxsystems.com` — **no** `/jbt` |
| `WEB_PUBLIC_ORIGIN` | `https://justxsystems.com` — **no** `/jbt` |
| `WEB_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` | `/jbt` |
| `API_PUBLIC_URL` | `https://justxsystems.com/jbt` |
| Google redirect URIs | Include `/jbt/api/...` and match Google Console exactly |
| `PAYMENT_PROVIDER` | `razorpay` for live; `stripe` / `cashfree` when keys set; `mock` only on private staging |

Startup validation (`server/src/lib/env.ts`) exits the process if prod env is unsafe. Symptom: PM2 `errored` / restart loop; logs show `Invalid server environment:`.

### Optional ops env

| Var | Purpose |
|-----|---------|
| `ERROR_WEBHOOK_URL` | Alert on API errors (Slack/Discord-compatible JSON) |
| `SENTRY_DSN` | Optional Sentry ingest without installing the SDK |
| `ENABLE_PHONE_OTP` / `SMS_PROVIDER` | Phone OTP login (`msg91` / `twilio` / `http`) |
| `ENABLE_MFA` | TOTP MFA (Profile → Security); default enabled |
| `STRIPE_*` / `CASHFREE_*` | Alternate payment gateways |

### Generate secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Uploads

| Var | Notes |
|-----|--------|
| `UPLOAD_DRIVER` | `local` (default) or `s3` / `cloud` |
| `UPLOAD_DIR` | Default `./uploads` under API cwd — back this up if local |
| Logos | Max ~2MB; PNG/JPEG/WebP/GIF |

### Background jobs (API process)

| Job | Env | Default behavior |
|-----|-----|------------------|
| Artifact delivery retry | `ARTIFACT_RETRY_MS` | ~60s (min 15s); runs in **justx-jbt-worker** |
| Subscription renewal notices | `RENEWAL_NOTICE_INTERVAL_HOURS` | 24h; set `0` to disable; worker process |
| Renewal window | `RENEWAL_NOTICE_WITHIN_DAYS` | 14 |
| Analytics rollup | `ANALYTICS_ROLLUP_INTERVAL_HOURS` | Off unless `>0`; worker process |
| Process role | `JBT_PROCESS_ROLE` | `api` / `worker` / `all` (dev) — set by PM2 ecosystem |

---

## 7. Auth & access runbook

### Login methods

- Email / password (`POST /api/auth/login`)  
- Google OAuth (`/api/auth/google` → callback)  
- Phone OTP (`/api/auth/otp/request` + `/verify`) — needs SMS provider (`SMS_PROVIDER`, Twilio, etc.)

Open (unauthenticated) routes include: `/api/health`, branding config, `/api/auth/*`, `/api/files/*` (**signed URL or session required**), `/api/webhooks/*`, `/api/public/*`, Drive OAuth callback.

### Common auth issues

| Symptom | Checks |
|---------|--------|
| `redirect_uri_mismatch` | Google Console URI vs `GOOGLE_REDIRECT_URI` character-for-character; must include `/jbt` in prod |
| Login redirect to `?error=oauth_not_configured` | Missing `GOOGLE_CLIENT_ID` / `SECRET` |
| Session lost / 401 after deploy | `JWT_SECRET` changed → all sessions invalidated |
| CORS errors in browser | `CORS_ORIGIN` must be origin only; credentials enabled |
| User pending / cannot work | Org approval / team approval status — Admin/Owner must approve |
| Platform admin missing | `is_platform_admin` on `users`, or email = `PLATFORM_ADMIN_EMAIL` |

### Session / cookie notes

- Sessions stored in MySQL (`sessions` table).  
- Changing `JWT_SECRET` or `DRIVE_TOKEN_SECRET` breaks cryptographic material; Drive tokens encrypted with Drive secret (defaults to `JWT_SECRET`) — **rotating JWT without re-connecting Drive** can break company Drive until Owners reconnect.

---

## 8. Google Drive / PDF delivery runbook

### Expected flow

1. Owner connects **company** Google account under Profile → Company document delivery.  
2. Owner pastes shared folder link; destination Auto / Google Drive.  
3. Staff generate quotation / site survey PDF.  
4. Server queues `artifact_deliveries` (`sync_status`: `pending` → `in_progress` → `synced` / `failed`).  
5. Scheduler retries failed/pending on `ARTIFACT_RETRY_MS`.

### Diagnosis SQL (on VPS)

```sql
-- Recent deliveries for a profile
SELECT id, original_filename, sync_status, channel, last_error, created_at, updated_at
FROM artifact_deliveries
WHERE business_profile_id = :profileId
ORDER BY created_at DESC
LIMIT 20;

-- Events for one artifact
SELECT event_type, channel, detail, created_at
FROM artifact_delivery_events
WHERE artifact_id = :artifactId
ORDER BY created_at;
```

### Common delivery issues

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Connect button missing / OAuth fails | Platform Google env / redirect URI | Fix JustX `.env` + Console (not the customer) |
| Connected but no files | Wrong folder; destination `none`; token revoked | Owner reconnect + verify folder + destination Auto/Drive |
| Only one PC “works” | Misunderstanding — delivery is **server-side**, not a local folder | Explain model; optional UNC agent for LAN shares |
| `failed` after token revoke | Owner changed password / revoked app | Reconnect Drive |
| Same filename confusion | Overwrite vs Rename vs Skip policy | See [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) |
| Large upload timeouts | nginx `proxy_read_timeout` / body size | Conf example uses 120s / 32m — match Express 30mb |

Webhook / UNC alternatives: [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md), `desktop-sync-agent/`.

---

## 9. Payments & subscriptions runbook

| Mode | Env | When |
|------|-----|------|
| Live | `PAYMENT_PROVIDER=razorpay`, `PAYMENT_AUTO_COMPLETE=false`, real `RAZORPAY_*` | Public production |
| Staging mock | `mock` + auto-complete only on **non-public** hosts | Never on justxsystems.com |

### Checks

1. Confirm env: `PAYMENT_AUTO_COMPLETE` must be `false` in prod (enforced at boot).  
2. Razorpay dashboard: webhook URL pointing at public API (`/api/webhooks/...`), secret matches `RAZORPAY_WEBHOOK_SECRET`.  
3. Admin console (Admin role): subscriptions, payments, gateways, SKUs.  
4. Customer: Owner/Admin → billing UI; tool licenses via packs / SKUs.

### Useful symptoms

| Symptom | Check |
|---------|--------|
| Checkout stuck pending | Webhook not reaching API; secret mismatch; nginx blocking |
| Tools locked after pay | Org subscription items / licenses not activated — admin payments + DB |
| Price wrong | `SUBSCRIPTION_PRO_PRICE_INR` / catalog SKUs in admin |
| Logs: `Illegal mix of collations` on subscription | `org_subscription_items` (etc.) on MySQL 8 default collation vs `tool_skus` unicode_ci — restart API after deploy (auto CONVERT) or ALTER tables to `utf8mb4_unicode_ci` |

Renewal notices run in-process (default every 24h). Logs: `[renewals] scanned=...`.

---

## 10. nginx / TLS / path routing

Config pattern: [`deploy/nginx-jbt.conf.example`](../deploy/nginx-jbt.conf.example).

Critical behaviors:

- `/jbt/api/` → `http://127.0.0.1:4002/api/` (path strip)  
- `/jbt` → Next on **3002** (keeps `/jbt` basePath)  
- `client_max_body_size 32m` for API and UI  
- TLS: certbot for `justxsystems.com` (+ www → apex preferred)

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certificates
```

Certificate expiry / renew failures → HTTPS errors for UI **and** Google OAuth callbacks.

---

## 11. Database support

### Connectivity

```bash
mysql -u justx_user -p -h 127.0.0.1 justx_systems -e "SELECT 1"
```

Credentials live only in `server/.env` (`DB_*`).

### Backup (automated)

Script: [`scripts/backup-jbt.sh`](../scripts/backup-jbt.sh) — MySQL dump + local uploads tarball, retention via `BACKUP_RETENTION_DAYS` (default 14).

**Install crons (backup + health) once on the VPS:**

```bash
chmod +x /var/www/jbt/scripts/*.sh
mkdir -p ~/backups
# Optional off-box + Slack/Discord alerts:
# export BACKUP_RSYNC_TARGET='backup@otherhost:/var/backups/jbt/'
# export ALERT_WEBHOOK_URL='https://hooks.example/...'
/var/www/jbt/scripts/install-ops-cron.sh
```

Manual cron entries (if not using the installer):

```bash
# 15 2 * * * /var/www/jbt/scripts/backup-jbt.sh >> /home/deploy/backups/backup.log 2>&1
# */5 * * * * ALERT_WEBHOOK_URL='...' /var/www/jbt/scripts/health-monitor.sh >> /home/deploy/backups/health.log 2>&1
```

**Off-box copy** (pick one; set before cron installer or in the crontab env):

| Env | Example |
|-----|---------|
| `BACKUP_RSYNC_TARGET` | `backup@192.0.2.10:/jbt/` |
| `BACKUP_OFFBOX_CMD` | `aws s3 cp %s s3://my-bucket/jbt/` (`%s` = file path) |

Manual one-shot:

```bash
# As deploy — no sudo needed; --no-tablespaces avoids PROCESS privilege error on MySQL 8
mkdir -p ~/backups
DATE=$(date +%Y%m%d_%H%M)
mysqldump -u justx_user -p -h 127.0.0.1 --single-transaction --routines --triggers --no-tablespaces \
  justx_systems | gzip > ~/backups/justx_systems_$DATE.sql.gz
```

Also back up if using local uploads:

```bash
tar -czf ~/backups/jbt_uploads_$DATE.tgz -C /var/www/jbt/server uploads
# path may vary with UPLOAD_DIR / cwd — confirm with `pm2 show justx-jbt-api`
```

### Schema migrations

Versioned SQL lives in [`mysql/migrations/`](../mysql/migrations/). The API applies pending files on startup; deploy also runs `npm run db:migrate -w server`.

```bash
# Manual
cd /var/www/jbt && npm run db:migrate -w server
# or
./scripts/db-migrate.sh
```

### Health monitor (alerting)

Script: [`scripts/health-monitor.sh`](../scripts/health-monitor.sh) — probes public health + UI; optional `ALERT_WEBHOOK_URL` Slack/Discord POST; checks PM2 apps when run on the VPS.

Prefer `install-ops-cron.sh` (above) over hand-editing crontab.

### Restore (SEV-1 data loss — coordinate)

1. Stop API writes: `pm2 stop justx-jbt-api`  
2. Restore dump into `justx_systems`  
3. Start API; verify health + spot-check a known org  

### Schema apply order (greenfield / repair)

Same as deploy guide — stop on first error:

`init.sql` → `jbt_schema.sql` → `admin_schema.sql` → `auth_extensions.sql` → `admin_platform.sql` → `artifact_delivery_schema.sql` → `notifications_schema.sql` → `product_commerce_schema.sql`

Known pitfall: mid-file abort on `admin_schema.sql` → missing `users` / duplicate column errors — pull latest SQL and resume carefully (see `DEPLOY.md` troubleshooting).

### Audit trail

Table `audit_events` — login, Google auth, admin actions. Useful for “who changed what”:

```sql
SELECT action, entity_type, entity_id, created_at, ip
FROM audit_events
ORDER BY created_at DESC
LIMIT 50;
```

---

## 12. Incident runbooks (copy/paste)

### A. Entire site down / 502

1. `curl` public health + `pm2 status`  
2. If PM2 stopped: `cd /var/www/jbt && pm2 start ecosystem.config.cjs && pm2 save`  
3. If errored loop: `pm2 logs justx-jbt-api --err --lines 80` → fix `.env` or MySQL  
4. If PM2 OK: `sudo nginx -t`, upstream ports, `ss -lntp`  
5. If recent deploy: rollback (§5)

### B. Health OK but login / OAuth broken

1. Compare Google Console redirect URIs to `GOOGLE_*` in `.env`  
2. Confirm `API_PUBLIC_URL` / `WEB_PUBLIC_ORIGIN`  
3. Check API logs during a login attempt  
4. Confirm clock skew is not extreme on VPS (`date -u`)

### C. Deploy failed (GitHub Actions)

| Log message | Fix |
|-------------|-----|
| `Permission denied (publickey)` | Public key not in `deploy` `authorized_keys`, or secret is `.pub` by mistake |
| `server/.env missing` | Recreate `/var/www/jbt/server/.env` |
| `DEPLOY_PATH` / `cd` fails | Secret path ≠ real clone path |
| Build / lightningcss | Script installs Linux binary; ensure Node 20+; web build uses webpack |
| Health check failed after reload | API crash — read PM2 logs / env validation |

Re-test SSH from a laptop with the same key before debugging Actions.

### D. Single customer: PDFs not in Drive

1. Confirm Owner (not staff) connected **company** account  
2. Destination not `none`  
3. Query `artifact_deliveries` for `failed` + `last_error`  
4. Ask Owner to reconnect Drive and generate a test PDF  
5. If platform-wide: check Google API quotas / OAuth client status

### E. Disk / memory pressure

```bash
df -h
free -h
pm2 status   # watch restarts
du -sh /var/www/jbt/server/uploads ~/backups 2>/dev/null
```

Clear old backups if safe; investigate upload growth; consider S3 for logos if local disk fills.

---

## 13. Monitoring checklist (daily / weekly)

**Daily (or on-call shift start)**

- [ ] https://justxsystems.com/jbt/api/health → `ok`  
- [ ] `pm2 status` — api, web, **worker** online, low restart count  
- [ ] Quick glance at `pm2 logs` for repeated errors  
- [ ] Last GitHub **Deploy** workflow green (if releases shipped)
- [ ] `health-monitor.sh` cron green (if installed)

**Weekly**

- [ ] MySQL dump / `backup-jbt.sh` succeeded and copied off-box  
- [ ] Disk usage & SSL expiry (`certbot certificates`)  
- [ ] Spot-check test PDF → Drive on a JustX-owned profile  
- [ ] Razorpay webhook success rate (if live)  
- [ ] Review failed `artifact_deliveries` older than 24h  

**After every production deploy**

- [ ] Health 200  
- [ ] `/api/public/status` + branding probe (also run by `vps-deploy.sh`)  
- [ ] Login page loads under `/jbt`  
- [ ] PM2 api + web + **worker** present  
- [ ] One authenticated API call (e.g. open Profile)  
- [ ] No new PM2 crash loops for 10 minutes  

---

## 14. Useful endpoints (support)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | No | Liveness + DB ping |
| GET | `/api/public/status` | No | Public status JSON (status page + deploy probes) |
| GET | `/api/config/branding` | No | Branding assets |
| * | `/api/auth/*` | No | Login / OTP / MFA / Google |
| * | `/api/admin/*` | Admin role | Platform/org admin |
| * | `/api/profile/drive/*` | Owner for connect | Company Drive OAuth |
| * | `/api/artifacts/*` | Yes | Artifact status / delivery |
| * | `/api/files/*` | Signed URL **or** session | Local upload GET |
| * | `/api/webhooks/*` | Provider secret | Payments / external |
| * | `/api/public/quotation-v1/*` | Public token | Shared quotation links |

Public base in production always includes **`/jbt`** before `/api`.

---

## 15. Communications templates

### Status page / customer (outage)

Public page: https://justxsystems.com/jbt/status · API: `/api/public/status`  
Ops notify (Slack/Discord): `ALERT_WEBHOOK_URL=... ./scripts/notify-outage.sh investigating|restored`

> We are investigating an issue affecting JustX Business Tools (justxsystems.com/jbt). Document generation and login may fail. We will update when service is restored.

### Drive delivery (customer Owner)

> PDF delivery uses the **company** Google account connected under Profile → Company document delivery. Staff accounts should not connect Drive. Please reconnect with the shared company mailbox, confirm the folder link, set destination to Auto or Google Drive, then generate a test PDF.

### After JWT / secret rotation (internal)

> `JWT_SECRET` was rotated. All user sessions were invalidated — users must log in again. Profile Owners may need to **reconnect Google Drive** if Drive token encryption used the same secret.

---

## 16. Security notes for support

- Never paste `server/.env`, private SSH keys, or Razorpay/Google secrets into tickets or chat.  
- Prefer screen-sharing redacted UI over dumping DB rows with PII.  
- Do not disable `REQUIRE_AUTH` or enable `PAYMENT_AUTO_COMPLETE` on the public host “temporarily”.  
- GitHub `DEPLOY_SSH_KEY` is production access — rotate if leaked (new key → `authorized_keys` + secret).  
- Prefer least privilege: customer data changes via Admin UI / Owner when possible, not raw SQL updates.

---

## 17. One-page on-call cheat sheet

Print or pin this section. Full detail is in the sections above.

| | |
|--|--|
| **UI** | https://justxsystems.com/jbt/ |
| **Health** | https://justxsystems.com/jbt/api/health → `{"ok":true,"db":"ok"}` |
| **SSH** | `ssh -i ~/.ssh/jbt_deploy deploy@193.203.161.219` |
| **App** | `/var/www/jbt` · env `server/.env` |
| **PM2** | `justx-jbt-api` **:4002** · `justx-jbt-web` **:3002** |
| **Do not use** | Port **3001** (Zigma) |

### First 60 seconds

```bash
curl -sS https://justxsystems.com/jbt/api/health
ssh -i $env:USERPROFILE\.ssh\jbt_deploy deploy@193.203.161.219   # Windows
cd /var/www/jbt && pm2 status
curl -sS http://127.0.0.1:4002/api/health
pm2 logs justx-jbt-api --lines 80
```

| Symptom | Do this |
|---------|---------|
| 502 / health fail | `pm2 status` → restart or fix `.env` / MySQL |
| API restart loop | Logs: `Invalid server environment` → fix prod env |
| OAuth mismatch | Google Console URI = `.env` incl. `/jbt/api/...` |
| One customer no PDF | Owner reconnect company Drive; check `artifact_deliveries` |
| Bad deploy | `git reset --hard <good_sha>` then build+reload (see §5) |

### Safe commands

```bash
pm2 restart justx-jbt-api justx-jbt-web justx-jbt-worker
pm2 reload ecosystem.config.cjs --update-env && pm2 save
./scripts/vps-deploy.sh          # pulls origin/master
./scripts/backup-jbt.sh          # DB + uploads
./scripts/health-monitor.sh      # public health probe
sudo nginx -t && sudo systemctl reload nginx
mysql -u justx_user -p -h 127.0.0.1 justx_systems -e "SELECT 1"
```

### Never on public prod

- `REQUIRE_AUTH=false` · `PAYMENT_AUTO_COMPLETE=true`
- Paste secrets into chat · disable auth “temporarily”
- Bind JBT to port **3001**

### Severity reminder

**SEV-1** site/auth/pay down → health → PM2 → nginx → MySQL (escalate 15m)  
**SEV-2** platform OAuth/Drive/deploy → logs + rollback  
**SEV-3** single tenant → profile ID + email + artifact id  
**SEV-4** how-to → SETUP / client checklist

### Paths

| Path | What |
|------|------|
| `/var/www/jbt` | App root |
| `/var/www/jbt/server/.env` | Secrets |
| `/var/www/jbt/ecosystem.config.cjs` | PM2 apps |
| `/var/www/jbt/scripts/vps-deploy.sh` | Deploy entrypoint |
| `/home/deploy/.ssh/authorized_keys` | CI + operator SSH |

### Operator SSH (Windows)

```powershell
ssh -i $env:USERPROFILE\.ssh\jbt_deploy deploy@193.203.161.219
```

---

## 18. Doc maintenance

When changing ports, base path, health contract, or deploy flow, update **this guide**, [`DEPLOY.md`](DEPLOY.md), [`SETUP.md`](SETUP.md), and [`.env.example`](../.env.example) together so on-call instructions stay accurate.
