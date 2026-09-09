# JustX Business Tools — Setup guide

**Production URL:** https://justxsystems.com/jbt/  
**OAuth owner account:** `justxsystems@gmail.com`

This is the **single product/setup guide**. VPS deploy: [`DEPLOY.md`](DEPLOY.md).  
Production support / on-call: [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md).

| Who | Section |
|-----|---------|
| JustX engineer / admin | [Local development](#local-development) · [Production deploy](#production-deploy) · [Google OAuth](#google-oauth-once) · [Environment reference](#environment-reference) · [Email delivery](#email-delivery-configuration) · [Sync Center & Email Outbox](#sync-center--email-outbox) |
| JustX on-call / ops | [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md) |
| Customer company Owner | [Client companies](#client-companies-part-b) |

---

## How multi-tenant delivery works

```
ABB / Schneider / Zigma staff  →  justxsystems.com/jbt
                                      │
                                      ▼
                               JustX API + MySQL
                                      │
                    Business Profile A → that company’s Drive folder
                    Business Profile B → that company’s Drive folder
```

- **One** platform Google OAuth app in JustX `.env` (`GOOGLE_CLIENT_ID` / `SECRET`).
- **Each** Business Profile stores that company’s encrypted Drive token + folder ID.
- **Staff never** connect Google Drive — only the Profile **Owner** does.

---

## Local development

```bash
cp .env.example server/.env
npm install
npm run db:up      # optional
npm run db:setup   # schemas + seed
npm run dev        # web :3000, API :4000
```

- Leave `CORS_ORIGIN=http://localhost:3000`.
- Do **not** set `WEB_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` locally.
- Add Google localhost redirect URIs if testing OAuth (see below).

---

## Production deploy

Supported path: **[`DEPLOY.md`](DEPLOY.md)** (GitHub Actions → SSH → PM2).

1. Hostinger DNS: `A` for `@` and `www` → `193.203.161.219`
2. One-time VPS setup + `server/.env` + nginx `/jbt` (ports **3002** / **4002**)
3. Push to `master` (or run the **Deploy** workflow)

### Production checklist (JustX)

- [ ] https://justxsystems.com/jbt/ loads
- [ ] https://justxsystems.com/jbt/api/health → ok
- [ ] `REQUIRE_AUTH=true`, strong `JWT_SECRET`, strong DB password
- [ ] Google redirect URIs match `.env` (including `/jbt`)
- [ ] `PAYMENT_AUTO_COMPLETE=false` on the public host
- [ ] `server/.env` never committed
- [ ] `pm2 save` + `pm2 startup`

---

## Google OAuth (once)

Sign in to [Google Cloud Console](https://console.cloud.google.com/) as **`justxsystems@gmail.com`**.

1. Project (e.g. **JustX-JBT**) → enable **Google Drive API** (and standard Google sign-in / People userinfo).
2. **OAuth consent screen** → External → app **JustX Business Tools** → support/dev email `justxsystems@gmail.com`.
3. Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`.
4. **Credentials → OAuth client ID → Web application**

**Authorized JavaScript origins**

| Environment | Origin |
|-------------|--------|
| Production | `https://justxsystems.com` |
| Local (optional) | `http://localhost:3000` |

**Authorized redirect URIs**

| Purpose | Production | Local |
|---------|------------|-------|
| Login | `https://justxsystems.com/jbt/api/auth/google/callback` | `http://localhost:4000/api/auth/google/callback` |
| Company Drive | `https://justxsystems.com/jbt/api/profile/drive/callback` | `http://localhost:4000/api/profile/drive/callback` |

Put Client ID + Secret only in `server/.env`. Never commit them.

---

## Environment reference

Copy [`.env.example`](../.env.example) → `server/.env`.

### Required (production)

| Variable | Notes |
|----------|--------|
| `PORT` | API listen port (**4002** in prod via deploy) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL |
| `JWT_SECRET` | ≥32 random chars; used for sessions + Drive token encryption |
| `REQUIRE_AUTH` | Must be `true` in production |
| `CORS_ORIGIN` | Origin only — `https://justxsystems.com` (**no** `/jbt`) |
| `WEB_PUBLIC_ORIGIN` | Same as CORS for browser redirects |
| `WEB_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH` | `/jbt` in production |
| `API_PUBLIC_URL` | `https://justxsystems.com/jbt` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Platform OAuth |
| `GOOGLE_REDIRECT_URI` / `GOOGLE_DRIVE_REDIRECT_URI` | Must match Google Console |

### Payments

| Variable | Notes |
|----------|--------|
| `PAYMENT_PROVIDER` | `razorpay` live · `stripe` / `cashfree` when configured · `mock` only for private staging |
| `PAYMENT_AUTO_COMPLETE` | **`false`** on public production |
| `RAZORPAY_KEY_ID` / `KEY_SECRET` / `WEBHOOK_SECRET` | From Razorpay dashboard |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Optional Stripe Checkout |
| `CASHFREE_APP_ID` / `SECRET_KEY` / `WEBHOOK_SECRET` | Optional Cashfree PG |

### Optional

| Variable | Notes |
|----------|--------|
| `SMS_PROVIDER` | `console` · `twilio` · `msg91` · `http` |
| `ENABLE_PHONE_OTP` | `true` to show Phone OTP on login (or non-console SMS without `=false`) |
| `TWILIO_*` / `MSG91_*` / `SMS_API_*` | OTP SMS credentials |
| `ENABLE_MFA` | TOTP MFA APIs/UI (default on; set `false` to disable) |
| `ERROR_WEBHOOK_URL` | Slack/Discord POST for API 500s / uncaught errors |
| `EMAIL_WEBHOOK_URL` | HTTPS URL of **your** inbound webhook (n8n/Make/Zapier/Power Automate). JustX POSTs email JSON there — **not** generated by JustX. Full how-to: [Email delivery configuration](#email-delivery-configuration) · [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Fallback alias if `EMAIL_WEBHOOK_URL` is empty (same URL purpose) |
| `SENTRY_DSN` | Optional Sentry store endpoint (no SDK required) |
| `DRIVE_TOKEN_SECRET` | Defaults to `JWT_SECRET` |
| `UPLOAD_DIR` | Local upload path (default `./uploads`) |
| `FILE_URL_SECRET` | Optional; HMAC for `/api/files` signed URLs (defaults to `JWT_SECRET`) |
| `JBT_PROCESS_ROLE` | `all` (dev) · `api` · `worker` — production PM2 sets `api` + `worker` |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Email delivery configuration

JustX does **not** send SMTP mail by itself. Choose one path (you can combine A + B/C).

| Path | Configure where | Who |
|------|-----------------|-----|
| **A. Automatic HTML + PDF** | Create webhook in n8n/Make/Zapier/Power Automate → paste URL into **`server/.env`** as `EMAIL_WEBHOOK_URL` | JustX engineer |
| **B. Mail app + PDF download** | Nothing in `.env` | Staff (default if A unset) |
| **C. Outlook with PDF attached** | **Sync Center** in the web UI generates `JBT_AGENT_TOKEN` | Owner / Staff on a Windows PC |

Canonical detail (field mapping, provider clicks, agent steps): **[`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)** · JSON contract: **[`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md)** · Sync Center / UNC / Drive: **[`SYNC_CENTER.md`](SYNC_CENTER.md)**.

### Path A — `EMAIL_WEBHOOK_URL` (and optional `NOTIFY_EMAIL_WEBHOOK_URL`)

**What the value is:** the HTTPS URL of an **inbound webhook you create** outside JustX. JustX `POST`s JSON to it; your automation sends the real email.

**What it is not:** a SendGrid API key, Gmail password, or a JustX `/api/...` path.

1. In n8n / Make / Zapier / Power Automate, create a workflow triggered by **Webhook / Catch Hook / When an HTTP request is received**.
2. Copy the **production** webhook URL (must be `https://…`).
3. On the VPS, edit the API env file:

```bash
nano /var/www/jbt/server/.env
```

Locally: `server/.env` in the repo (from `.env.example`).

4. Add **one** line (prefer the first name):

```env
EMAIL_WEBHOOK_URL=https://hook.eu1.make.com/xxxxxxxx
# NOTIFY_EMAIL_WEBHOOK_URL=   # only if EMAIL_WEBHOOK_URL is unset — same purpose
```

5. Reload so PM2 picks up env:

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

6. In the automation, map at least `to`, `subject`, **`html`**, `pdfBase64` + `filename` (see [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md)).
7. Test: Quotation → Send Via → Email. Email Outbox should show **sent** if the webhook succeeds.

### Path B — no server email config

Leave `EMAIL_WEBHOOK_URL` empty. Staff send → draft goes to **Email Outbox**, browser opens `mailto:`, PDF downloads for manual attach.

Optional UI (Owner): **Business Profile → Send Via defaults → Email** (template, subject, Reply-To, intro/closing).

### Path C — `JBT_AGENT_TOKEN` (Outlook)

**Where generated:** web app only — **not** in `.env` on the server.

**Customer PC minimum:** Windows 10/11 + Sync Center **Download setup for this PC** (double-click Install). Outlook desktop if using Open in Outlook. No separate Node install. Full table: [`SYNC_CENTER.md`](SYNC_CENTER.md)#customer-pc--minimum-software--environment-desktop-agent.

1. Sign in as Owner/Staff → **Sync Center** (`/sync`).
2. **Set up on this PC** → **Download setup for this PC**.
3. Extract zip → double-click **Install JustX Sync Agent.cmd**.
4. **Email Outbox** → **Open in Outlook**.

Manual start: copy the token from Sync Center into:

```powershell
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"
$env:JBT_AGENT_TOKEN = "jxsa_…"
npm start   # inside desktop-sync-agent/
```

---

## Sync Center & Email Outbox

These are **two different queues**. Full “who needs what / what syncs / how it works”:

| Guide | Covers |
|-------|--------|
| **[`SYNC_CENTER.md`](SYNC_CENTER.md)** | Who needs Sync Center; which tools’ PDFs; all Company document delivery variants (Drive / artifact webhook / UNC); desktop setup; troubleshooting |
| **[`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)** | Who needs Email Outbox; paths A/B/C; when Sync Center agent is required for Outlook |

**Short reminder**

| Feature | Who typically needs it | What it moves |
|---------|------------------------|---------------|
| **Company document delivery** (Profile) | Every company that wants PDFs in Drive/webhook/UNC | Quotation + Site Survey PDFs (file artifacts) |
| **Sync Center** `/sync` | UNC companies; Outlook Path C; status/retry | Same file queue + agent install UI |
| **Email Outbox** `/email-outbox` | Anyone sending quotations by email | Email drafts (not the Sync Center file list) |

Do not confuse:

- Profile **artifact webhook** (files) ≠ `EMAIL_WEBHOOK_URL` (emails)  
- Sync Center **pending files** ≠ Email Outbox **pending emails**  
- Desktop agent token is created in **Sync Center** (UNC sync **and/or** Outlook compose)  
- **Not every customer needs the desktop agent** — Drive/webhook + email webhook need none

---

## Client companies (Part B)

Give this section to each paying customer. **Only the Business Profile Owner** connects Google Drive.

### Prerequisites

- Owner account at https://justxsystems.com/jbt  
- Active subscription if required  
- A **company** Google account (Workspace / shared ops mailbox recommended)

### Steps

1. **Sign in** → complete subscription if prompted.
2. **Profile** → create/save Business Profile (you must be Owner).
3. In Google Drive (company account): create a shared folder → copy folder URL.
4. In JBT Profile → **Company document delivery** → **Connect company Google Drive** → approve as the **company** account → paste folder link → Save → destination Auto/Google Drive.
5. Invite staff (they only log into JBT — they do **not** connect Drive).
6. Generate a test PDF → confirm it appears in the company Drive folder.

### Client checklist

- [ ] Owner account + subscription  
- [ ] Business Profile saved (Owner)  
- [ ] Company Google account + shared folder  
- [ ] Drive connected + folder saved  
- [ ] Test PDF delivered  
- [ ] Staff invited and told not to connect Google  

### Troubleshooting

| Symptom | Check |
|---------|--------|
| OAuth / Connect missing | Platform Google env (JustX Part A / deploy) |
| `redirect_uri_mismatch` | Console URI vs `.env` character-for-character |
| Connected, no files | Wrong folder link; reconnect; destination Auto/Drive |
| Only one PC “works” | Delivery is server-side via Owner connection — not a personal PC folder |

Advanced alternatives (webhook / UNC agent): see [`SYNC_CENTER.md`](SYNC_CENTER.md) (**§1.3 SharePoint/OneDrive webhook**, **§1.4 Download Folder path**), [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) and `desktop-sync-agent/`.  
Email send paths: [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

---

## Who owns what

| Item | Owner |
|------|--------|
| Hosting, MySQL, `.env`, nginx, PM2 | JustXSystems |
| Google Cloud OAuth client | JustXSystems (`justxsystems@gmail.com`) |
| Each company’s Business Profile + Drive folder | That company’s Owner |
| Staff accounts | That company’s Owner / admins |
