# Email delivery & Email Outbox — setup guide

JustX supports **three** ways to send quotation emails. Use the one that matches your company.

| Variant | Who configures | PDF attached automatically? | Corporate HTML? |
|---------|----------------|----------------------------|-----------------|
| **A. Email webhook** | JustX engineer (server `.env`) | Yes | Yes (`html` field) |
| **B. Mail app (mailto)** | No server email setup | No — PDF downloads for manual attach | No (plain text only) |
| **C. Outlook via desktop agent** | Staff PC + Sync Center agent | Yes (Outlook COM) | Plain body in Outlook; HTML still stored for webhook retry |

**Email Outbox** (`/email-outbox`) stores every send attempt so staff can retry on another device or method.

---

## Variant A — Email webhook (recommended for production)

Automatic HTML + PDF delivery. No local Outlook required.

### What are `EMAIL_WEBHOOK_URL` and `NOTIFY_EMAIL_WEBHOOK_URL`?

These are **not** values JustX generates for you. They are the **HTTPS URL of an inbound webhook you create** in an external automation / email tool.

| Env var | Meaning |
|---------|---------|
| **`EMAIL_WEBHOOK_URL`** | Preferred. When a staff user sends a quotation (or Email Outbox retries), the JustX **API POSTs JSON** to this URL. Your tool receives it and actually sends the email (SMTP, SendGrid, Microsoft 365, etc.). |
| **`NOTIFY_EMAIL_WEBHOOK_URL`** | **Optional alias** for the same thing. JustX reads `EMAIL_WEBHOOK_URL` first; if empty, it uses `NOTIFY_EMAIL_WEBHOOK_URL`. Older setups and UPI notify also check this name. **Set only one** — prefer `EMAIL_WEBHOOK_URL`. |

You do **not** buy or mint a “webhook key” from JustX. Flow:

```
JustX API  --POST JSON-->  YOUR webhook URL  -->  your automation sends the email
```

### Where to get the URL (create it yourself)

Pick **one** provider your company already uses (or create a free/paid account). Create a workflow whose **first step is “Webhook / HTTP Request received”**, copy the **production webhook URL** it shows, and paste that into `server/.env`.

#### Option 1 — n8n (self-hosted or cloud)

1. Open n8n → **New workflow**.
2. Add trigger: **Webhook**.
3. Method: **POST**. Path e.g. `jbt-email`.
4. Click **Listen for test event** / activate the workflow.
5. Copy the **Production URL**, e.g.  
   `https://n8n.yourcompany.com/webhook/jbt-email`  
   or cloud: `https://….app.n8n.cloud/webhook/….`
6. Add next nodes: parse JSON body → **Send Email** / SendGrid / SMTP.
7. Map fields from the POST body (`to`, `subject`, **`html`**, `pdfBase64`, …) — see table below.
8. **Activate** the workflow (inactive webhooks return errors).

#### Option 2 — Make.com (Integromat)

1. Create a scenario → trigger **Webhooks → Custom webhook**.
2. Click **Add** → copy the webhook address Make shows (looks like `https://hook.eu1.make.com/…`).
3. Add a module: **Email** / **Microsoft 365 Email** / **SendGrid** → map JSON fields.
4. Run once to “determine data structure”, then turn the scenario **On**.

#### Option 3 — Zapier

1. Create Zap → trigger **Webhooks by Zapier → Catch Hook**.
2. Copy the **Custom Webhook URL** Zapier shows.
3. Action: **Email by Zapier** / Gmail / Outlook / SendGrid → map fields (decode base64 for PDF if needed).
4. Publish the Zap.

#### Option 4 — Microsoft Power Automate / Azure Logic Apps

1. Create flow → trigger **When an HTTP request is received**.
2. Paste a JSON schema (or use “Use sample payload” from a test send).
3. After save, Power Automate shows **HTTP POST URL** — that is your `EMAIL_WEBHOOK_URL`.
4. Add **Send an email (V2)** / Office 365 Outlook → attach file from `pdfBase64`.

#### Option 5 — SendGrid / Brevo / Mailgun “Inbound Parse” is the wrong direction

Do **not** paste a generic marketing API key as the URL. JustX needs a URL that **accepts POST**. Typical pattern:

1. Use n8n/Make/Zapier/Power Automate as above, **or**
2. Host a tiny HTTPS endpoint that receives JSON and calls SendGrid’s **Mail Send** API with `html` + attachment.

#### Quick local test (optional)

Use [webhook.site](https://webhook.site): open the page, copy **Your unique URL**, temporarily set it as `EMAIL_WEBHOOK_URL`, send one quotation, confirm JSON appears. Then replace with your real automation URL. **Do not leave webhook.site in production** (emails won’t send).

### Where to put the URL in JustX

1. SSH / edit **`server/.env`** on the API host (production: `/var/www/jbt/server/.env`).
2. Set **one** of:

```env
EMAIL_WEBHOOK_URL=https://hook.eu1.make.com/xxxxxxxx
# Prefer the line above. Only if you already use the old name:
# NOTIFY_EMAIL_WEBHOOK_URL=https://same-or-other-hook.example/jbt-email
```

3. Reload API so env is picked up:

```bash
cd /var/www/jbt
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

4. In your automation, map JSON fields:

| Field | Use as |
|-------|--------|
| `to` | To |
| `cc` | CC |
| `subject` | Subject |
| `body` | Plain-text part |
| **`html`** | **HTML body (required for corporate template)** |
| `replyTo` | Reply-To |
| `from` / `fromName` / `fromEmail` | From (if provider allows) |
| `pdfBase64` + `filename` | PDF attachment |
| `outboxId` / `quoteNo` | Logging |

Full contract: [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md).

### Business Profile settings (Owner)

1. Sign in → **Business Profile**.
2. Set **Document accent color** (colors the corporate email).
3. Under **Send Via defaults → Email**:
   - Choose **Corporate HTML** or **Plain text**
   - Subject, Reply-To, intro/closing (corporate)
4. **Admin → GST branches → Branding** can set accent + template per branch.

### Staff usage

1. Quotation → **Send Via → Email** → Send.
2. If webhook works: status **sent**, customer receives HTML + PDF.
3. If webhook fails: item appears in **Email Outbox** as **failed** — use **Send via webhook** to retry.

### Checklist

- [ ] Created inbound webhook in n8n / Make / Zapier / Power Automate / custom
- [ ] Copied **HTTPS production** URL into `EMAIL_WEBHOOK_URL` (or alias)
- [ ] Reloaded API with `--update-env`
- [ ] Automation maps **`html`**, not only `body`
- [ ] Test send from Quotation; confirm inbox HTML + attachment
- [ ] Profile template = Corporate; accent color set

---

## Variant B — Local mail app (no webhook)

Zero SMTP setup. Browser opens Outlook / Apple Mail / Gmail handler with To/CC/subject/body. **Browsers cannot attach PDFs to mailto** — JustX downloads the PDF so the user attaches it.

### Configuration required

**None** on the server for email. Optional:

- Business Profile email templates (subject / plain message / corporate intro)
- Staff must have a default mail client registered on the device

### Staff usage

1. Quotation → Email → Send (with webhook **unset**).
2. JustX:
   - Saves draft to **Email Outbox** (`pending`)
   - Downloads the PDF
   - Opens `mailto:` with To/CC/subject/body
3. User attaches the downloaded PDF in the mail client and sends.
4. Later / another PC: open **Email Outbox** → **Open mail app** / **Download PDF** again.

### Checklist

- [ ] Device has a default email client
- [ ] User knows to attach the downloaded PDF
- [ ] Bookmark **Email Outbox** for retries

### Limits

- Body length capped (~1800 chars) by mailto
- No corporate HTML in the mail client via this path
- Cross-device: outbox syncs via server; mail client must exist on the device you use to open

---

## Variant C — Open in Outlook with PDF (desktop agent)

Best for Windows offices that live in desktop Outlook and do not want a cloud email webhook yet.

### Prerequisites

- Windows PC with **Microsoft Outlook** (desktop, COM-capable)
- JustX **desktop sync agent** running (same as Sync Center)
- Agent token for this Business Profile (`JBT_AGENT_TOKEN`)

### How to generate `JBT_AGENT_TOKEN`

JustX **creates** this token for you. You do **not** invent a password or copy it from `.env.example`.

| Step | Where | What happens |
|------|--------|----------------|
| 1 | Sign in as **Business Owner** or **Staff** | Same branch / Business Profile you want the agent to use |
| 2 | Open **Sync Center** (`/sync`) | Sidebar → Sync Center |
| 3 | Click **Set up on this PC** | Expands setup panel |
| 4 | Optional: type an **Agent label** (e.g. `Accounts PC`) | Helps identify the machine later |
| 5 | Click **Create token + download launcher** | API creates a token like `jxsa_…` (shown **once** on screen) and downloads `start-justx-sync-agent.ps1` |
| 6 | Keep / copy the token | Use **Copy token**, or open the `.ps1` — it already sets `$env:JBT_AGENT_TOKEN = "jxsa_…"` |
| 7 | Run the launcher on the Outlook PC | See below |

Notes:

- Token format: `jxsa_` + random secret (generated server-side).
- It is **scoped to the current Business Profile** and can be **Revoked** later under Sync Center → Registered agents.
- Treat it like a password: anyone with the token can sync artifacts / open email compose for that profile.
- If you lose the token, **create a new one** (and revoke the old agent). There is no “show token again” after the first display.

### Step-by-step setup

1. **Business Profile** → set Download Folder if you also use file sync (optional for email-only).
2. Generate token + launcher as above (**Sync Center** → **Create token + download launcher**).
3. On the Outlook PC, place the `.ps1` next to the repo (or inside `desktop-sync-agent`) and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-justx-sync-agent.ps1
```

4. Keep the agent window open. Sync Center should show **Desktop agent: Connected**.
5. Send a quotation by Email (or open **Email Outbox**).
6. Click **Open in Outlook** on the outbox row.
7. Outlook compose opens with To/CC/subject/body + **PDF attached** — review and Send.

### Agent env (manual start)

If you prefer not to use the downloaded `.ps1`:

1. Generate a token in Sync Center (step above) and **Copy token**.
2. From `desktop-sync-agent/`:

```powershell
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"   # your public API base ending in /api
$env:JBT_AGENT_TOKEN = "jxsa_PASTE_THE_TOKEN_HERE"
$env:JBT_BRIDGE_PORT = "17865"
npm start
```

| Env | Where it comes from |
|-----|---------------------|
| `JBT_API_BASE` | Your JustX API root + `/api` (launcher fills this automatically from the browser). Prod example: `https://justxsystems.com/jbt/api`. Local: `http://localhost:4000/api`. |
| `JBT_AGENT_TOKEN` | **Only** from Sync Center → Create token (or the downloaded `.ps1`). |
| `JBT_BRIDGE_PORT` | Default `17865` — leave unless the port is taken. |

Bridge endpoint used by the UI: `POST http://127.0.0.1:17865/open-email` with `{ "outboxId": "eml_..." }`.

### Checklist

- [ ] Created token in Sync Center (not typed by hand)
- [ ] Agent running on the same PC as the browser session used for **Open in Outlook**
- [ ] Outlook installed and able to open via COM
- [ ] Outbox item has a PDF (`artifactId` present)
- [ ] Windows only (macOS/Linux agent returns a clear error)

### Limits

- Outlook body is **plain text** (HTML remains available for webhook retry)
- Agent must run on the PC that has Outlook
- Not available in pure browser / mobile without the agent

---

## Email Outbox UI

**Route:** `/email-outbox` (sidebar: **Email Outbox**)

| Action | Needs |
|--------|--------|
| Send via webhook | Variant A configured |
| Open mail app | Local mail client (Variant B) |
| Download PDF | Artifact on the outbox row |
| Open in Outlook | Variant C agent online |
| Requeue / Cancel | Always (except cancel after sent) |

Pending items are profile-scoped (same branch as Sync Center). Log in on another device → same outbox → choose a method available on that device.

---

## Decision guide

```
Need branded HTML + automatic PDF for all staff?
  └─ Yes → Variant A (EMAIL_WEBHOOK_URL from your automation tool)
Need zero server email setup today?
  └─ Yes → Variant B (mailto + PDF download + Outbox)
Need Outlook Sent folder + attachment without webhook?
  └─ Yes → Variant C (Sync Center generates JBT_AGENT_TOKEN)
```

You can combine: **A primary**, **B/C fallback** when webhook is down (failed rows stay in Outbox).

---

## Related docs

- [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) — webhook JSON contract + how to obtain the URL  
- [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) — desktop agent / Sync Center  
- [`SETUP.md`](SETUP.md) — env reference  
- Business Profile → Send Via — templates & accent color  
