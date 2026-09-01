# JustX Business Tools — Setup guide

**Production URL:** https://justxsystems.com/jbt/  
**OAuth owner account:** `justxsystems@gmail.com`

This is the **single product/setup guide**. VPS deploy: [`DEPLOY.md`](DEPLOY.md).  
Production support / on-call: [`PRODUCTION_SUPPORT.md`](PRODUCTION_SUPPORT.md).

| Who | Section |
|-----|---------|
| JustX engineer / admin | [Local development](#local-development) · [Production deploy](#production-deploy) · [Google OAuth](#google-oauth-once) · [Environment reference](#environment-reference) |
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
| `PAYMENT_PROVIDER` | `razorpay` live · `mock` only for private staging |
| `PAYMENT_AUTO_COMPLETE` | **`false`** on public production |
| `RAZORPAY_KEY_ID` / `KEY_SECRET` / `WEBHOOK_SECRET` | From Razorpay dashboard |

### Optional

| Variable | Notes |
|----------|--------|
| `SMS_PROVIDER` | `console` · `twilio` · `http` |
| `TWILIO_*` / `SMS_API_*` | OTP SMS |
| `DRIVE_TOKEN_SECRET` | Defaults to `JWT_SECRET` |
| `UPLOAD_DIR` | Local upload path (default `./uploads`) |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

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

Advanced alternatives (webhook / UNC agent): see [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) and `desktop-sync-agent/`.

---

## Who owns what

| Item | Owner |
|------|--------|
| Hosting, MySQL, `.env`, nginx, PM2 | JustXSystems |
| Google Cloud OAuth client | JustXSystems (`justxsystems@gmail.com`) |
| Each company’s Business Profile + Drive folder | That company’s Owner |
| Staff accounts | That company’s Owner / admins |
