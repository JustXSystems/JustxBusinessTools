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
                    Business Profile A → that company’s folder / webhook / UNC
                    Business Profile B → that company’s folder / webhook / UNC
```

- **Optional** platform Google OAuth — configure in **Admin → Integrations** (preferred) or `server/.env` (`GOOGLE_CLIENT_ID` / `SECRET`). Only needed for **Sign in with Google** and **Company Google Drive** delivery.
- **Each** Business Profile stores that company’s encrypted Drive token + folder ID **if** they use Drive.
- **Staff never** connect Google Drive — only the Profile **Owner** does (and only when using Drive).
- Companies can skip Google entirely: use **artifact webhook** (SharePoint/OneDrive), **UNC + desktop agent**, and/or **email** paths without Drive.

---

## Is Google Cloud OAuth mandatory?

**No.** The API and web app **bring up without** Google OAuth (neither Admin Integrations nor `GOOGLE_CLIENT_*` env). Startup validation does **not** require them.

| Capability | Needs Google Cloud OAuth? |
|------------|---------------------------|
| App boot (DB, JWT, PM2, UI) | **No** |
| Email/password login | **No** (always available) |
| Phone OTP login | **No** (optional SMS env) |
| Sign in with Google | **Yes** |
| Company document delivery → **Google Drive** | **Yes** (same platform client; Owner connects company Drive) |
| Company document delivery → **artifact webhook** (SharePoint / OneDrive via Power Automate, n8n, …) | **No** |
| Company document delivery → **UNC / Download Folder** + Sync Center agent | **No** |
| Company document delivery → **none** (browser download / no company folder) | **No** |
| Email Path A (`EMAIL_WEBHOOK_URL`) | **No** |
| Email Path B (mailto) | **No** |
| Email Path C (Outlook desktop agent) | **No** |

**`justxsystems@gmail.com`** is only the Google Cloud Console account JustX uses to **own** the platform OAuth client when you *do* enable Google. It is not a runtime dependency and is not hardcoded. Any Google Cloud project/account can host the client.

Without Google configured (Admin or env):

- Login UI hides “Sign in with Google” (`GET /api/auth/methods` → `google: false`).
- Business Profile shows that platform Google is not configured; **Connect company Google Drive** is unavailable.
- Webhook / UNC / email paths work as documented in [`SYNC_CENTER.md`](SYNC_CENTER.md) and [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

### Recommended stacks without Google / Drive

| Goal | Configure |
|------|-----------|
| PDFs → SharePoint or OneDrive (cloud, no office PC) | Profile destination **Corporate webhook** + Power Automate Create file — [`SYNC_CENTER.md`](SYNC_CENTER.md)#13-corporate-artifact-webhook-sharepoint--onedrive--power-automate |
| PDFs → Windows share / synced folder | Profile **Download Folder path** + Sync Center setup zip — [`SYNC_CENTER.md`](SYNC_CENTER.md)#14-company-file-server--download-folder-path-unc--optional |
| Send quotation emails automatically | **Admin → Integrations → Email webhook** (or `EMAIL_WEBHOOK_URL` in `.env` as fallback) — [Email delivery](#email-delivery-configuration) |
| Send via Outlook with PDF | Sync Center desktop agent — Path C below |
| Staff login without Google | Email/password (and optional Phone OTP) |

You can mix: e.g. SharePoint webhook for files + email webhook for mail, **zero** Google Cloud setup.

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

Supported path: **[`DEPLOY.md`](DEPLOY.md)** (GitHub Actions builds artifact → SCP → PM2).

1. Hostinger DNS: `A` for `@` and `www` → `193.203.161.219`
2. One-time VPS setup + `server/.env` + nginx `/jbt` (ports **3002** / **4002**)
3. Push to `master` (or run the **Deploy** workflow with optional CD inputs)

### Production checklist (JustX)

- [ ] https://justxsystems.com/jbt/ loads
- [ ] https://justxsystems.com/jbt/api/health → ok
- [ ] `REQUIRE_AUTH=true`, strong `JWT_SECRET`, strong DB password
- [ ] Google redirect URIs match `.env` (including `/jbt`)
- [ ] `PAYMENT_AUTO_COMPLETE=false` on the public host
- [ ] `server/.env` never committed
- [ ] `pm2 save` + `pm2 startup`

---

## Google OAuth (optional — only for Google login + Company Drive)

**Skip this entire section** if customers will use webhook/UNC/email only (see [Is Google Cloud OAuth mandatory?](#is-google-cloud-oauth-mandatory)).

When you want Sign in with Google and/or Company Google Drive delivery, create **one** platform OAuth client (JustX currently uses Google Cloud under `justxsystems@gmail.com` — any project owner works).

Sign in to [Google Cloud Console](https://console.cloud.google.com/).

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

Put Client ID + Secret in **Admin → Integrations** (preferred) or `server/.env` as fallback. Never commit them.

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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **Optional fallback.** Prefer **Admin → Integrations**. Needed only for Sign in with Google + Company Drive. |
| `GOOGLE_REDIRECT_URI` / `GOOGLE_DRIVE_REDIRECT_URI` | Required **only if** Google client is set; must match Google Console (still from env / `API_PUBLIC_URL`) |

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
| `EMAIL_WEBHOOK_URL` | **Optional fallback.** Prefer **Admin → Integrations → Email webhook**. HTTPS URL of **your** inbound webhook (n8n/Make/Zapier/Power Automate). Full how-to: [Email delivery configuration](#email-delivery-configuration) · [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Fallback alias if Admin and `EMAIL_WEBHOOK_URL` are empty (same URL purpose) |
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
| **A. Automatic HTML + PDF** | Create webhook → paste URL in **Admin → Integrations** (preferred) or `EMAIL_WEBHOOK_URL` in `.env` | Platform admin / JustX engineer |
| **B. Mail app + PDF download** | Nothing required | Staff (default if A unset) |
| **C. Outlook with PDF attached** | **Sync Center** in the web UI generates `JBT_AGENT_TOKEN` | Owner / Staff on a Windows PC |

Canonical detail (field mapping, provider clicks, agent steps): **[`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)** · JSON contract: **[`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md)** · Sync Center / UNC / Drive: **[`SYNC_CENTER.md`](SYNC_CENTER.md)**.

### Path A — Email webhook (Admin Integrations or `EMAIL_WEBHOOK_URL`)

**What the value is:** the HTTPS URL of an **inbound webhook you create** outside JustX. JustX `POST`s JSON to it; your automation sends the real email.

**What it is not:** a SendGrid API key, Gmail password, or a JustX `/api/...` path.

**Preferred (no PM2 reload):**

1. In n8n / Make / Zapier / Power Automate, create a workflow triggered by **Webhook / Catch Hook / When an HTTP request is received**.
2. Copy the **production** webhook URL (must be `https://…`).
3. Sign in as a **platform admin** → **Admin → Integrations** → **Email webhook** → paste URL → Enable → **Save** → **Send test POST**.
4. In the automation, map at least `to`, `subject`, **`html`**, `pdfBase64` + `filename` (see [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md)).
5. Test: Quotation → Send Via → Email. Email Outbox should show **sent** if the webhook succeeds.

**Fallback via `.env` (still supported):**

1. On the VPS, edit the API env file:

```bash
nano /var/www/jbt/server/.env
```

Locally: `server/.env` in the repo (from `.env.example`).

2. Add **one** line (prefer the first name):

```env
EMAIL_WEBHOOK_URL=https://hook.eu1.make.com/xxxxxxxx
# NOTIFY_EMAIL_WEBHOOK_URL=   # only if EMAIL_WEBHOOK_URL is unset — same purpose
```

3. Reload so PM2 picks up env:

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

4. After verifying in Admin, you can migrate the URL into Admin Integrations and remove it from `.env`.

### Path B — no server email config

Leave email webhook unset in Admin and `.env`. Staff send → draft goes to **Email Outbox**, browser opens `mailto:`, PDF downloads for manual attach.

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

Give the matching subsection to each paying customer.

### B1 — Google Drive companies (needs platform Google OAuth)

**Only the Business Profile Owner** connects Google Drive. Requires JustX to have configured [Google OAuth](#google-oauth-optional--only-for-google-login--company-drive).

#### Prerequisites

- Owner account at https://justxsystems.com/jbt  
- Active subscription if required  
- A **company** Google account (Workspace / shared ops mailbox recommended)

#### Steps

1. **Sign in** → complete subscription if prompted.
2. **Profile** → create/save Business Profile (you must be Owner).
3. In Google Drive (company account): create a shared folder → copy folder URL.
4. In JBT Profile → **Company document delivery** → **Connect company Google Drive** → approve as the **company** account → paste folder link → Save → destination Auto/Google Drive.
5. Invite staff (they only log into JBT — they do **not** connect Drive).
6. Generate a test PDF → confirm it appears in the company Drive folder.

#### Client checklist

- [ ] Owner account + subscription  
- [ ] Business Profile saved (Owner)  
- [ ] Company Google account + shared folder  
- [ ] Drive connected + folder saved  
- [ ] Test PDF delivered  
- [ ] Staff invited and told not to connect Google  

#### Troubleshooting

| Symptom | Check |
|---------|--------|
| OAuth / Connect missing | Platform Google env (JustX Part A / deploy) |
| `redirect_uri_mismatch` | Console URI vs `.env` character-for-character |
| Connected, no files | Wrong folder link; reconnect; destination Auto/Drive |
| Only one PC “works” | Delivery is server-side via Owner connection — not a personal PC folder |

### B2 — No Google / no Drive (SharePoint, OneDrive, UNC, email-only)

Platform Google OAuth is **not** required. Owner still saves a Business Profile.

| Customer wants | Owner configures |
|----------------|------------------|
| PDFs in SharePoint / OneDrive | Destination **Corporate webhook** + Power Automate HTTP URL — [`SYNC_CENTER.md`](SYNC_CENTER.md)#13-corporate-artifact-webhook-sharepoint--onedrive--power-automate |
| PDFs on file server / synced folder | **Download Folder path** + Sync Center setup on one PC — [`SYNC_CENTER.md`](SYNC_CENTER.md)#14-company-file-server--download-folder-path-unc--optional |
| Email only | Leave company destination none/unset; use Email Outbox paths A/B/C — [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) |

Staff log in with **email/password** (or Phone OTP if enabled). They never need a Google account.

Advanced detail: [`SYNC_CENTER.md`](SYNC_CENTER.md), [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md), `desktop-sync-agent/`.  
Email send paths: [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md).

---

## Who owns what

| Item | Owner |
|------|--------|
| Hosting, MySQL, `.env`, nginx, PM2 | JustXSystems |
| Google Cloud OAuth client (optional) | JustXSystems (e.g. `justxsystems@gmail.com`) — only if Google login / Drive is offered |
| Each company’s Business Profile + Drive **or** webhook/UNC | That company’s Owner |
| Staff accounts | That company’s Owner / admins |
