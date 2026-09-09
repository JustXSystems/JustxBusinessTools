# Email Outbox — complete configuration guide

**Route:** `/email-outbox` (sidebar → **Email Outbox**)  
**Who:** Business Owners and Staff  
**Creates rows:** Quotation → **Send Via → Email** (and retries from this page)  
**Related:** [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) · [`SYNC_CENTER.md`](SYNC_CENTER.md) · [`SETUP.md`](SETUP.md)#email-delivery-configuration

Email Outbox is a **durable queue of quotation emails** for the current Business Profile. It is **not** the Notifications inbox and **not** Sync Center’s pending PDF files.

| Sidebar badge | Counts |
|---------------|--------|
| **Email Outbox** | `pending` + `failed` email drafts |
| **Notifications** | Unread in-app alerts |
| **Sync Center** | Pending **file** artifacts (company document delivery) |

---

## Who needs Email Outbox vs Sync Center?

| Goal | Use | Sync Center setup zip? |
|------|-----|------------------------|
| File quotation/survey PDFs to **company Drive / webhook / UNC** | **Company document delivery** (+ Sync Center only for UNC/status) | Only for **UNC** (or Outlook Path C) |
| **Send** the quotation by email | **Email Outbox** (this guide) | Only for **Path C — Open in Outlook** |
| Drive/webhook filing **and** email webhook | Both features, separately | Usually **no** agent |
| UNC filing **and** Outlook compose | Both use the **same** desktop agent | **Yes** — install once |

Filing a PDF to the company folder and emailing a customer are **independent**. Doing Send Via → Email does **not** by itself run Company document delivery (email attachments use `skipDispatch`). Staff who need the PDF in Drive/UNC must also use the tool’s company submit/deliver action (or rely on whatever flow your process defines).

Full “who / what / how” for files: [`SYNC_CENTER.md`](SYNC_CENTER.md)#who-needs-sync-center.

---

## Configuration map (where everything lives)

| Setting | Where | Who | Notes |
|---------|-------|-----|-------|
| `EMAIL_WEBHOOK_URL` | VPS `/var/www/jbt/server/.env` (or local `server/.env`) | JustX engineer | HTTPS inbound webhook **you** create |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Same `.env` | Engineer | Alias only if `EMAIL_WEBHOOK_URL` empty |
| Email template / accent / Reply-To | **Business Profile** → Send Via → Email | Owner | Also Admin → GST branches → Branding |
| Default To / CC / subject text | Same Send Via panel | Owner | Prefills Quotation send modal |
| Desktop agent token | **Sync Center** → Create token | Owner/Staff | Same agent as UNC sync |
| Mail client | OS default app | Staff PC | Path B |
| Outlook desktop | Windows + agent | Staff PC | Path C |

---

## Choose a delivery path

| Path | PDF auto-attached? | Corporate HTML? | Config burden |
|------|-------------------|-----------------|---------------|
| **A. Email webhook** | Yes | Yes (`html`) | Engineer: `.env` + automation |
| **B. Mailto + outbox** | No (download + attach) | No (plain in mail app) | None on server |
| **C. Outlook via agent** | Yes (COM) | Plain body in Outlook | Sync Center token + Windows |

Recommended: **A** in production; **B** until then; **C** for Outlook Sent Items without a cloud webhook. Combine: A primary, B/C when webhook fails (row stays in Outbox).

---

## Path A — Automatic send (`EMAIL_WEBHOOK_URL`)

### What to configure

JustX does **not** generate this URL. You create an inbound webhook in an external tool; JustX POSTs JSON to it.

| Env var | Prefer? | Meaning |
|---------|---------|---------|
| `EMAIL_WEBHOOK_URL` | Yes | Primary |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Only as fallback | Same purpose if primary empty |

### Step-by-step

#### 1) Create the webhook (outside JustX)

Pick one:

**n8n**  
New workflow → **Webhook** trigger → POST → copy Production URL → add Send Email / SMTP / SendGrid → map body fields → **Activate**.

**Make.com**  
Webhooks → Custom webhook → copy `https://hook.…make.com/…` → Email / Microsoft 365 / SendGrid module → turn scenario **On**.

**Zapier**  
Webhooks by Zapier → Catch Hook → copy URL → Email/Gmail/SendGrid action → Publish.

**Power Automate**  
When an HTTP request is received → save → copy **HTTP POST URL** → Send an email (V2) → attach from `pdfBase64`.

**Not valid as the URL:** SendGrid API key, SMTP password, Gmail app password (those belong **inside** the automation).

**Optional test:** [webhook.site](https://webhook.site) URL → temporary `.env` → send one quote → confirm JSON → replace with real flow.

#### 2) Put URL on the JustX API host

**Production:**

```bash
nano /var/www/jbt/server/.env
```

```env
EMAIL_WEBHOOK_URL=https://YOUR-PRODUCTION-WEBHOOK-URL
```

**Local:** `server/.env` (from `.env.example`).

Reload:

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

#### 3) Map JSON in your automation

| Field | Use as |
|-------|--------|
| `to`, `cc`, `subject` | Envelope |
| `body` | Plain text part |
| **`html`** | **HTML body (required for Corporate template)** |
| `replyTo`, `fromName`, `fromEmail` | Headers if supported |
| `pdfBase64` + `filename` | Attachment |
| `outboxId`, `quoteNo` | Logging |

Full contract: [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md).

#### 4) Business Profile branding (Owner)

1. **Business Profile**  
2. Document accent color  
3. **Send Via defaults → Email**: Corporate HTML or Plain; subject; Reply-To; intro/closing  
4. Optional: **Admin → GST branches → Branding** per branch  

#### 5) Staff test

Quotation → Send Via → Email → Send.  
Email Outbox: **sent** = success. **failed** = use **Send via webhook** to retry.

### Path A checklist

- [ ] Webhook created and **active**  
- [ ] URL in `EMAIL_WEBHOOK_URL`  
- [ ] API reloaded with `--update-env`  
- [ ] Automation maps **`html`** and PDF  
- [ ] Profile Corporate template + accent  
- [ ] Test inbox shows HTML + attachment  

---

## Path B — Mailto + PDF download (no server email)

### What to configure

**Server:** leave `EMAIL_WEBHOOK_URL` empty.  
**Optional:** Business Profile Send Via defaults (subject / message).  
**PC:** default mail client (Outlook, Apple Mail, etc.).

### Staff flow

1. Quotation → Email → Send.  
2. JustX saves Outbox (`pending`), downloads PDF, opens `mailto:`.  
3. User attaches downloaded PDF → Send in mail app.  
4. Later: Email Outbox → **Open mail app** / **Download PDF**.

### Limits

- Browsers cannot attach files via `mailto:`  
- Body length capped (~1800 chars)  
- No corporate HTML in the mail client  
- Need a mail client on the device you use to open  

### Path B checklist

- [ ] Webhook unset  
- [ ] Default mail client works  
- [ ] Staff know to attach the PDF  
- [ ] Email Outbox bookmarked for retries  

---

## Path C — Outlook with PDF (desktop agent)

Uses the **same** Sync Center desktop agent as UNC file sync.

### Customer PC — minimum requirements

| Requirement | Needed? | Notes |
|-------------|---------|--------|
| Windows 10/11 | Yes | Path C is Windows-only |
| Sync Center setup zip + Install.cmd | Yes | No separate Node.js install |
| Outbound HTTPS to JustX API | Yes | Token auth to API |
| **Desktop Outlook** (COM) | Yes | Classic Outlook COM — not web-only / New Outlook without COM |
| Chrome/Edge on **same PC** as agent | Yes | Outbox talks to `127.0.0.1:17865` |
| Download Folder / UNC | No | Only if also syncing files |

Canonical full matrix + site caveats: [`SYNC_CENTER.md`](SYNC_CENTER.md)#customer-pc--minimum-software--environment-desktop-agent.

### What to configure

| Item | Where |
|------|--------|
| Agent token | Sync Center → **Create token + download launcher** |
| Agent process | Run `.ps1` / `npm start` on Windows PC with Outlook |
| Download Folder | Optional (needed for file sync; not required for Outlook-only) |

### Generate `JBT_AGENT_TOKEN`

1. Sign in as Owner/Staff on the correct Business Profile.  
2. **Sync Center** → **Set up on this PC**.  
3. Optional label → **Create token + download launcher**.  
4. Token `jxsa_…` shown **once** + embedded in `.ps1`.  
5. Lost → create new + **Revoke** old under Registered agents.

Detailed agent env: [`SYNC_CENTER.md`](SYNC_CENTER.md)#23-desktop-agent-sync-unc--outlook.

### Run agent + send

**Recommended (non-technical):** Sync Center → **Download setup for this PC** → extract → double-click **Install JustX Sync Agent.cmd**.

**Advanced:**

```powershell
powershell -ExecutionPolicy Bypass -File .\start-justx-sync-agent.ps1 -Install
```

Sync Center: **Desktop agent: Connected**.  
Email Outbox → **Open in Outlook** (browser and agent on **same** PC).

Foreground only:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-justx-sync-agent.ps1
```

Manual:

```powershell
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"
$env:JBT_AGENT_TOKEN = "jxsa_…"
cd desktop-sync-agent
npm start
```

Health / remove: `-Health` / `-Uninstall` on the launcher, or `health-check.ps1` / `uninstall-agent.ps1` in `desktop-sync-agent`.

### Path C checklist

- [ ] Customer PC meets [minimum requirements](#customer-pc--minimum-requirements) (Windows, Node 18+, Outlook, …)  
- [ ] Token from Sync Center (not invented)  
- [ ] Agent installed (`-Install`) or running on this PC  
- [ ] Sync Center shows Connected (or `health-check.ps1` OK)  
- [ ] Desktop Outlook installed  
- [ ] Outbox row has PDF  
- [ ] Windows only  

### Limits

- Outlook body is plain text (HTML still stored for webhook retry)  
- Agent must run on the Outlook PC  

---

## Email Outbox UI reference

### Status values

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for mailto / Outlook / later send |
| `failed` | Webhook (or channel) failed — retry |
| `opened` | Mail app / Outlook compose was opened |
| `sent` | Webhook reported success |
| `cancelled` | User cancelled |

### Actions

| Button | Requires |
|--------|----------|
| **Send via webhook** | Path A configured on API |
| **Open mail app** | Path B — local mail client |
| **Download PDF** | Row has artifact |
| **Open in Outlook** | Path C — agent online on this PC |
| **Requeue** | Sets back toward pending |
| **Cancel** | Stops further send attempts |

Filters: **Pending** (pending+failed) vs **All**.

### How rows get created

1. Staff sends quotation email.  
2. API creates outbox row (+ artifact PDF when provided).  
3. If webhook configured and succeeds → `sent`.  
4. Else → `pending` / `failed` and client may open mailto + download PDF.

---

## Engineer vs Owner vs Staff

| Role | Configures |
|------|------------|
| **JustX engineer** | `EMAIL_WEBHOOK_URL` in `server/.env`, PM2 reload, optional automation hosting |
| **Company Owner** | Profile email templates, accent; Sync Center token if needed |
| **Staff** | Send quotations; Outbox actions; run agent on their PC if using C |

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Always mailto, never auto-send | `EMAIL_WEBHOOK_URL` empty or API not reloaded |
| Webhook 4xx/5xx in Outbox | Automation inactive; wrong URL; mapping error |
| HTML looks plain | Automation mapped `body` only — map **`html`** |
| Open in Outlook disabled / errors | Agent not on this PC; not Windows; Outlook missing |
| Wrong badge count | Fixed by route-specific badges; pending = pending+failed emails |
| Wrong company emails | Branch / Business Profile switcher |

---

## Related docs

- [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) — JSON contract  
- [`SYNC_CENTER.md`](SYNC_CENTER.md) — agent + file delivery  
- [`SETUP.md`](SETUP.md) — env + short email section  
- `desktop-sync-agent/README.md` — `/open-email` bridge  
