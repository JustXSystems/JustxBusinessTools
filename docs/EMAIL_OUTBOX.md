# Email Outbox — complete configuration guide

**Route:** `/email-outbox` (sidebar → **Email Outbox**)  
**Who:** Business Owners and Staff  
**Creates rows:** Quotation → **Send Via → Email** (and retries from this page)  
**Related:** [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) · [`SYNC_CENTER.md`](SYNC_CENTER.md) · [`SETUP.md`](SETUP.md)#email-delivery-configuration

Email Outbox is a **durable queue of quotation emails** for the current Business Profile. It is **not** the Notifications inbox and **not** Sync Center’s pending PDF files.

| Sidebar badge | Counts |
|---------------|--------|
| **Email Outbox** | `pending` + `failed` + `opened` (still actionable) |
| **Notifications** | Unread in-app alerts |
| **Sync Center** | Pending **file** artifacts (company document delivery) |

---

## Who needs Email Outbox vs Sync Center?

| Goal | Use | Sync Center setup zip? |
|------|-----|------------------------|
| File quotation/survey PDFs to **company Drive / webhook / UNC / local folder** | **Company document delivery** (+ Sync Center only for UNC/status) | Only for **UNC/local folder** (or Outlook Path C) |
| **Send** the quotation by email | **Email Outbox** (this guide) | Only for **Path C — Open in Outlook** |
| Drive/webhook filing **and** email webhook | Both features, separately | Usually **no** agent |
| UNC/local filing **and** Outlook compose | Both use the **same** desktop agent | **Yes** — install once |

Filing a PDF to the company folder and emailing a customer are **independent**. Doing Send Via → Email does **not** by itself run Company document delivery (email attachments use `skipDispatch`). Staff who need the PDF in Drive/UNC must also use the tool’s company submit/deliver action.

**If UNC / Download Folder already works:** you do **not** change Profile document-delivery settings for email. Use this guide only for Paths A/B/C below. Same desktop agent can serve both file sync and Outlook.

Full “who / what / how” for files: [`SYNC_CENTER.md`](SYNC_CENTER.md)#who-needs-sync-center.

---

## Configuration map (where everything lives)

| Setting | Where | Who | Notes |
|---------|-------|-----|-------|
| `EMAIL_WEBHOOK_URL` | **Admin → Integrations** (preferred) or `server/.env` | Platform admin | HTTPS inbound webhook **you** create |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Same `.env` fallback | Engineer | Alias only if Admin / primary empty |
| Email template / accent / Reply-To | **Business Profile** → Send Via → Email | Owner | Also Admin → GST branches → Branding |
| Default To / CC / subject text | Same Send Via panel | Owner | Prefills Quotation send modal |
| Desktop agent token | **Sync Center** → Download setup | Owner/Staff | Same agent as UNC sync |
| Mail client / `mailto` handler | Windows default apps | Staff PC | Path B |
| Classic Outlook (COM) | Windows desktop | Staff PC | Path C — **not** New Outlook alone |
| Download Folder / UNC | Business Profile | Owner | **Not required for email** |

---

## Choose a delivery path

| Path | PDF auto-attached? | Corporate HTML? | Config burden |
|------|-------------------|-----------------|---------------|
| **A. Email webhook** | Yes | Yes (`html` field) | Platform admin + automation |
| **B. Mailto + outbox** | No (download + attach) | **No** — plain text only in mail app | None on server; working default mail client |
| **C. Outlook via agent** | Yes (COM) | **Yes** — Corporate `html` via Outlook `HTMLBody` (**agent ≥ 1.1.3** + classic Outlook) | Sync Center agent + **classic** Outlook COM |

Recommended: **A** in production for HTML delivered to the customer inbox without a staff PC; **C** when you want HTML compose + PDF on Windows without a webhook; **B** only for plain-text mailto. Combine: A primary, B/C when webhook fails.

**Important expectations**

| Expectation | Reality |
|-------------|---------|
| “I set Corporate HTML in the app” | HTML is **stored** on the outbox row. To **see** it: Path **A** (webhook) or Path **C** (**Open in Outlook** / **Open HTML in Outlook**). Path B mailto is always plain. |
| Body shows `Dear+Customer,%0A%0A…` | Broken mailto encoding (spaces as `+`). Fixed by `buildMailtoHref` (`%20`) — redeploy web; see [Mailto encoding](#mailto-encoding-spaces-as--and-0a). |
| Open mail app / Open in Outlook do nothing | Often Outlook stuck on **Add Account**, **New Outlook** without COM, or hung `OUTLOOK.exe` — see [Prep classic Outlook](#prep-classic-outlook-on-windows-paths-b--c). |
| UNC works but email fails | Expected to be independent; email does not use Download Folder. |
| Open in Outlook still plain after HTML send | Agent must be **≥ 1.1.3** (HTML via temp file + `HTMLBody`; older agents truncated large HTML on PowerShell `-Command`). Confirm version — [Confirm agent version ≥ 1.1.3](#confirm-agent-version--113-path-c--html). Re-download setup only after a deploy that **repacked** the win zip (`pack_win_agent=true`). |

---

## Create an Email Outbox draft (all paths)

Nothing appears in Email Outbox until staff send from a tool.

1. Sign in at https://justxsystems.com/jbt/ on the correct Business Profile / branch.  
2. Open **Quotation** (or Site Survey where email send exists).  
3. Generate/save so a PDF can be built.  
4. **Send Via → Email**: fill **To** (required), optional CC / subject / message. Choose **Corporate** template if you need HTML.  
5. Send. API creates an outbox row (+ PDF artifact when provided); Corporate stores `body_html` on the row.  
6. If email webhook is configured and succeeds → status **`sent`** (may never appear as Pending).  
7. Else: Quotation UI **prefers desktop Outlook** when agent is online and a PDF exists (required for Corporate HTML). Otherwise mailto (plain) + PDF download. Open **Email Outbox** (`/email-outbox`) → **Pending** — confirm To/Subject and (for Path C) a PDF.

Optional Owner polish (not required to send): **Business Profile → Send Via defaults → Email** (template Corporate/Plain, subject, Reply-To, intro/closing).

---

## Path A — Automatic send (`EMAIL_WEBHOOK_URL`)

### What to configure

JustX does **not** generate this URL. You create an inbound webhook in an external tool; JustX POSTs JSON to it.

| Env var | Prefer? | Meaning |
|---------|---------|---------|
| `EMAIL_WEBHOOK_URL` | Yes (or Admin Integrations) | Primary |
| `NOTIFY_EMAIL_WEBHOOK_URL` | Only as fallback | Same purpose if primary empty |

### Step-by-step

#### 1) Create the webhook (outside JustX)

Pick one:

**n8n** — New workflow → **Webhook** trigger → POST → copy Production URL → Send Email / SMTP / SendGrid → map fields → **Activate**.

**Make.com** — Webhooks → Custom webhook → copy `https://hook.…make.com/…` → Email module → scenario **On**.

**Zapier** — Webhooks by Zapier → Catch Hook → Email/Gmail/SendGrid → Publish.

**Power Automate** — When an HTTP request is received → **HTTP POST URL** → Send an email (V2) → attach from `pdfBase64`.

**Not valid as the URL:** SendGrid API key, SMTP password, Gmail app password (those belong **inside** the automation).

#### 2) Put URL on JustX

**Preferred:** platform admin → **Admin → Integrations → Email webhook** → paste → Enable → Save → **Send test POST**.

**Fallback `.env`:**

```bash
nano /var/www/jbt/server/.env
```

```env
EMAIL_WEBHOOK_URL=https://YOUR-PRODUCTION-WEBHOOK-URL
```

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

#### 4) Staff test

Quotation → Send Via → Email. Email Outbox: **sent** = success. **failed** = **Send via webhook** to retry.

### Path A checklist

- [ ] Webhook created and **active**  
- [ ] URL in Admin Integrations or `EMAIL_WEBHOOK_URL`  
- [ ] API reloaded if using `.env`  
- [ ] Automation maps **`html`** and PDF  
- [ ] Profile Corporate template + accent (optional)  
- [ ] Test inbox shows HTML + attachment  

---

## Path B — Mailto + PDF download (no server email)

### What to configure

**Server:** leave email webhook unset.  
**Optional:** Business Profile Send Via defaults.  
**PC:** working **default mail app** that handles `mailto:` (classic Outlook recommended on Windows).

### Prep classic Outlook on Windows (Paths B + C)

Both **Open mail app** and **Open in Outlook** fail if classic Outlook is stuck or New Outlook owns the UI.

#### 1) See what is running

```powershell
Get-Process OUTLOOK, olk -ErrorAction SilentlyContinue |
  Format-Table Id, ProcessName, MainWindowTitle, Responding -AutoSize
```

| Process | Meaning |
|---------|---------|
| `OUTLOOK` + title **Add Account** | Finish account setup — Inbox not ready |
| `olk` | **New Outlook** (Store) — weak/no COM; turn off for Path C |
| `OUTLOOK` + Inbox title | Classic Outlook ready |

#### 2) Finish Add Account / restart Outlook

```powershell
Stop-Process -Name OUTLOOK, olk -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process "C:\Program Files\Microsoft Office\root\Office16\OUTLOOK.EXE"
```

1. Complete **Add Account** until a real **Inbox** appears.  
2. Turn **New Outlook** toggle **Off** if shown.  
3. Manually **New Email** once to confirm compose works.

#### 3) Confirm `mailto` outside JustX

```powershell
Start-Process "mailto:your.email@example.com?subject=JBT%20test&body=Mailto%20works"
```

**Expected:** compose opens with readable subject/body (spaces, not `+`).  
If not: **Settings → Apps → Default apps** → set **Email** / **MAILTO** to **Outlook** (classic), not Outlook (new).

#### 4) Confirm COM for Path C (optional here; required for C)

```powershell
Stop-Process -Name olk -Force -ErrorAction SilentlyContinue
$o = New-Object -ComObject Outlook.Application
$m = $o.CreateItem(0)
$m.Subject = "JBT COM OK"
$m.Display()
"COM worked"
```

Must return in a few seconds with a compose window. If it hangs, classic Outlook is still blocked — repeat steps 1–2.

### Staff flow (Path B)

1. Quotation → Email → Send (creates Outbox `pending`; may auto-download PDF and open mailto for **plain** templates).  
2. Or Email Outbox → pending row → **Download PDF** first.  
3. Click **Open mail app** (browser may ask to open Outlook → Allow).  
4. In the mail client: **Attach** the downloaded PDF → **Send**.  
5. Row stays **`pending`** after mailto (mailto cannot verify the draft opened). Use **Cancel** when done, or leave it until webhook **sent**. Do **not** expect status → `opened` from Path B alone.

### Manual fallback (always works if Download PDF works)

1. Email Outbox → **Download PDF**.  
2. Open Outlook or Gmail yourself.  
3. New message → copy To / Subject / body from the Outbox row.  
4. Attach PDF → Send.

### Mailto encoding (spaces as `+` and `%0A`)

**Symptom:** body looks like `Dear+Customer,%0A%0APlease+find+attached…`.

**Cause:** older UI built `mailto:` with `URLSearchParams`, which uses form-encoding (`+` for spaces). Many Outlook builds show that literally.

**Fix:** use RFC 6068 percent-encoding (`%20`) via `web/lib/mailto.ts` (`buildMailtoHref`). After web deploy, send a **new** email and use **Open mail app** again.

```text
Wrong:  mailto:a@x.com?body=Dear+Customer,%0A%0APlease…
Right:  mailto:a@x.com?body=Dear%20Customer%0A%0APlease…
```

### Path B limits

- Browsers cannot attach files via `mailto:` — always **Download PDF** + attach.  
- Body length capped (~1800 chars).  
- **No corporate HTML** in the mail client (plain only).  
- Requires a working OS mail handler (prep section above).

### Path B checklist

- [ ] Webhook unset (or ignore Path A buttons)  
- [ ] Outlook Inbox ready / mailto probe works  
- [ ] Pending outbox row exists  
- [ ] **Download PDF** succeeds  
- [ ] **Open mail app** opens compose with normal spaces (after mailto fix deploy)  
- [ ] Staff attach PDF before Send  
- [ ] Row remains **pending** after mailto (expected — Cancel when finished)  

---

## Path C — Outlook with PDF (desktop agent)

Uses the **same** Sync Center desktop agent as UNC / local-folder file sync.

### Customer PC — minimum requirements

| Requirement | Needed? | Notes |
|-------------|---------|--------|
| Windows 10/11 | Yes | Path C is Windows-only |
| Sync Center setup zip + Install.cmd | Yes | No separate Node.js install |
| Outbound HTTPS to JustX API | Yes | Token auth; production base must include `/jbt` |
| **Classic desktop Outlook** (COM) | Yes | Not Outlook on the web alone; New Outlook (`olk`) is insufficient |
| Chrome/Edge on **same PC** as agent | Yes | Outbox talks to `http://127.0.0.1:17865` |
| Download Folder / UNC | No | Only if also syncing files |

Canonical agent matrix: [`SYNC_CENTER.md`](SYNC_CENTER.md)#customer-pc--minimum-software--environment-desktop-agent · Connected vs sync: [`SYNC_CENTER.md`](SYNC_CENTER.md)#connected--sync-ok.

### What to configure

| Item | Where |
|------|--------|
| Agent install + token | Sync Center → **Download setup for this PC** |
| Classic Outlook ready | [Prep classic Outlook](#prep-classic-outlook-on-windows-paths-b--c) |
| Download Folder | Optional (UNC only) |

### Install agent (if not already for UNC)

1. Sync Center → **Set up on this PC** → **Download setup for this PC**.  
2. Extract zip → **Install JustX Sync Agent.cmd**.  
3. Sync Center shows **Desktop agent: Connected**.  
4. Verify API base:

```powershell
Invoke-RestMethod http://127.0.0.1:17865/status | ConvertTo-Json -Depth 5
# apiBase must be https://justxsystems.com/jbt/api  (with /jbt)
# version must be >= 1.1.3 for Corporate HTML in Outlook
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\agent.log" -Tail 40
```

### Confirm agent version ≥ 1.1.3 (Path C + HTML)

Corporate HTML in Outlook needs agent **≥ 1.1.3**. Reinstalling from Sync Center only helps if production’s **`JustX-Sync-Agent-win-x64.zip` was rebuilt and shipped** in that deploy. Ordinary `push` deploys **skip** the ~28MB win pack (VPS keeps the old zip).

#### Where `1.1.3` lives in source / pack

| Location | What it is |
|----------|------------|
| `desktop-sync-agent/src/index.js` → `AGENT_VERSION = "1.1.3"` | Runtime `/health` + `/status` → `version` (source of truth) |
| `web/lib/artifact-delivery/win-setup-pack.ts` → `AGENT_PACK_VERSION` | Written into setup `config.json` as `packVersion` |
| Pack script `scripts/pack-justx-sync-agent-win.mjs` | Reads `AGENT_VERSION` from `index.js`; writes `JustX-Sync-Agent/PACK_VERSION.txt` inside the zip |
| Built zip → `JustX-Sync-Agent/app/src/index.js` | What Sync Center downloads and Install.cmd copies |

**Not the agent version:** GitHub Actions “Node 20 is being deprecated” / runner Node 24. That is the **CI runner**. The customer zip still pins portable **Node 20.18.1 win-x64** on purpose (`NODE_VERSION` in the pack script). Cache keys like `agent-node-win-Linux-v20.18.1` are that portable runtime download, not app version `1.1.3`.

#### Confirm on the customer PC (after install)

```powershell
Invoke-RestMethod http://127.0.0.1:17865/health
# expect: version = "1.1.3" (or higher)

Invoke-RestMethod http://127.0.0.1:17865/status | ConvertTo-Json -Depth 5
# expect: version >= 1.1.3, apiBase = https://justxsystems.com/jbt/api
```

If `version` is still `1.1.0` / `1.1.1` / `1.1.2`: the downloaded zip was old — ship a new pack (below), then Sync Center → Download setup → Install again.

#### Confirm in CI / deploy (engineer)

1. **Actions → Deploy → Run workflow** with **`pack_win_agent` = true** (required to rebuild the win zip).  
   - Default `push` to `master`: `PACK_WIN_AGENT=false` → log may say `Skipping JustX-Sync-Agent-win-x64.zip (JBT_SKIP_WIN_AGENT_PACK=1)` → **VPS zip unchanged**.  
   - Job-level env can still show `JBT_SKIP_WIN_AGENT_PACK: 1`; only the **Build web** step overrides it to `0` when packing.
2. In **Build web** logs, expect:
   - `PACK_WIN_AGENT=true` and `JBT_SKIP_WIN_AGENT_PACK=0`
   - `Source AGENT_VERSION:` / `export const AGENT_VERSION = "1.1.3"`
   - `Sync Agent pack version: 1.1.3`
   - `Packed agent version file:` (`agent=1.1.3` …) and `AGENT_VERSION inside zip index.js:`
3. Optional local check of a built zip:

```bash
unzip -p web/public/JustX-Sync-Agent-win-x64.zip JustX-Sync-Agent/PACK_VERSION.txt
unzip -p web/public/JustX-Sync-Agent-win-x64.zip JustX-Sync-Agent/app/src/index.js | grep AGENT_VERSION
```

Full deploy knobs: [`DEPLOY.md`](DEPLOY.md)#advanced-cd--workflow_dispatch-options · pack details: `desktop-sync-agent/README.md`.

### Engineer ship order (Path C HTML fix → customers)

Do this whenever `AGENT_VERSION` / Outlook bridge changes (e.g. 1.1.3):

1. Merge code with `AGENT_VERSION` bumped in `desktop-sync-agent/src/index.js` (keep `AGENT_PACK_VERSION` in sync).  
2. **Actions → Deploy → Run workflow**: `deploy_enabled=true`, **`pack_win_agent=true`**.  
3. Confirm **Build web** logs: `JBT_SKIP_WIN_AGENT_PACK=0`, packed `agent=…` matches source.  
4. After VPS swap: Sync Center → **Download setup for this PC** → Install (do not reuse an old extracted folder).  
5. On PC: `/health` → `version` matches; COM probe OK; Email Outbox → **Open HTML in Outlook** on a new Corporate send.

Skipping step 2 leaves the old zip on the VPS — reinstall alone will not upgrade the agent.

### Send with Open in Outlook

1. Complete [Prep classic Outlook](#prep-classic-outlook-on-windows-paths-b--c) (COM probe must succeed).  
2. Confirm [agent version ≥ 1.1.3](#confirm-agent-version--113-path-c--html).  
3. Create pending outbox row with **PDF** ([Create draft](#create-an-email-outbox-draft-all-paths)). Corporate template should have HTML stored on the row.  
4. Email Outbox: Desktop agent **Online**; **Open in Outlook** / **Open HTML in Outlook** enabled (disabled if no agent or no `artifactId`).  
5. Click that button — wait up to ~30–90s for large PDFs.  
6. Outlook compose opens with To/Subject, **HTML body** (when present), and **PDF attached**.  
7. Click **Send** in Outlook. Status → **`opened`** (still listed under Pending until Cancel or webhook **sent**).

If open fails: status → **`failed`** + `lastError`; row stays in Pending; fix Outlook/agent and retry (or **Requeue**).

### Path C checklist

- [ ] Classic Outlook Inbox ready; New Outlook off; COM probe OK  
- [ ] Agent Connected; `apiBase` = `https://justxsystems.com/jbt/api`  
- [ ] `/health` → `version` **≥ 1.1.3** (re-download after `pack_win_agent=true` deploy if not)  
- [ ] Pending row has PDF  
- [ ] **Open in Outlook** (not **Open mail app**) opens compose with HTML + attachment  
- [ ] Windows only  

### Path C limits

- Mailto / **Open mail app** cannot carry Corporate HTML — use **Open in Outlook** / **Open HTML in Outlook** (or Path A).  
- Agent **≥ 1.1.3** writes Corporate HTML to a temp file and sets Outlook `BodyFormat = HTML` + `HTMLBody` (avoids Windows ~8K `-Command` limit that made large HTML fall back to plain). Older packs stay plain.  
- Reinstall from Sync Center does **not** upgrade the agent unless production zip was rebuilt (`pack_win_agent=true`).  
- Agent must run on the Outlook PC with classic Outlook COM.  
- Same `apiBase` / auth issues that block UNC sync also block compose.  
- Never invent `JBT_AGENT_TOKEN` — only Sync Center.

Manual agent start:

```powershell
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"
$env:JBT_AGENT_TOKEN = "jxsa_…"
# from desktop-sync-agent install or sources
npm start
```

---

## End-to-end: UNC already working — add email only

Typical customer who already has `C:\JustX\Artifacts` (or UNC) syncing:

1. **Do not change** Download Folder / UNC for email.  
2. Run [Prep classic Outlook](#prep-classic-outlook-on-windows-paths-b--c).  
3. Confirm agent version: `Invoke-RestMethod http://127.0.0.1:17865/health` → `version` **≥ 1.1.3**. If older, engineer ships zip with **`pack_win_agent=true`**, then Sync Center → Download setup → Install again.  
4. Prefer Path B for a quick plain-text test: Quotation email → Outbox → **Download PDF** → **Open mail app** (or manual attach).  
5. Path C for Corporate HTML + PDF: same agent → Email Outbox → **Open in Outlook** / **Open HTML in Outlook** (not Open mail app).  
6. Optional later: Path A webhook for automatic HTML + PDF without a staff PC.

---

## Email Outbox UI reference

### Status values

| Status | Meaning | In Pending list / badge? |
|--------|---------|--------------------------|
| `pending` | Waiting for mailto / Outlook / webhook | Yes |
| `failed` | Webhook or **open draft** failed — retry | Yes |
| `opened` | Outlook compose reported success (staff should still Send in Outlook) | Yes — stays until Cancel or webhook **sent** |
| `sent` | Webhook reported success | No |
| `cancelled` | User cancelled | No |

**Open-draft rules**

- Outlook open **failure** → status `failed` + `lastError`; pending count does **not** clear; action buttons stay.  
- Mailto does **not** auto-mark `opened` (cannot verify the draft appeared).  
- Only **sent** / **cancelled** leave the actionable queue.

### Actions

| Button | Requires | Notes |
|--------|----------|-------|
| **Send via webhook** | Path A configured on API | |
| **Open mail app** | Path B — working `mailto` handler | Plain text only; does **not** mark `opened` |
| **Download PDF** | Row has artifact | Always needed for Path B attach |
| **Open in Outlook** / **Open HTML in Outlook** | Path C — agent online on this PC + PDF | Label is **Open HTML in Outlook** when row has `html`; needs agent ≥ 1.1.3 |
| **Requeue** | `failed` / `opened` / `cancelled` | Sets status back toward `pending` |
| **Cancel** | Actionable row | Stops further send attempts |

Filters: **Pending** = `pending` + `failed` + `opened` (UI note: “Pending / failed / opened”) vs **All**.

### How rows get created

1. Staff sends quotation email (Quotation / Site Survey).  
2. API creates outbox row (+ artifact PDF when provided); Corporate template stores **`body_html`**.  
3. If webhook configured and succeeds → `sent`.  
4. Else → `pending` / `failed`. Client **prefers desktop Outlook** when HTML and/or PDF + agent online; otherwise mailto (plain) + optional PDF download. HTML never goes through mailto.

---

## Engineer vs Owner vs Staff

| Role | Configures |
|------|------------|
| **JustX engineer** | Admin Integrations / `EMAIL_WEBHOOK_URL`, PM2, automation hosting; Deploy with **`pack_win_agent=true`** when shipping a new desktop agent |
| **Company Owner** | Profile email templates, accent; Sync Center setup if Path C / UNC |
| **Staff** | Send quotations; Outbox actions; Outlook ready on their PC for B/C; confirm `/health` version after install |

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Always mailto, never auto-send | Email webhook empty or API not reloaded |
| Webhook 4xx/5xx in Outbox | Automation inactive; wrong URL; mapping error |
| HTML looks plain (webhook) | Automation mapped `body` only — map **`html`** |
| Expected HTML but see plain text (B/C) | Path B mailto is always plain. Use **Open in Outlook** with agent ≥ 1.1.3. Full HTML without a staff PC = Path A webhook |
| Open in Outlook HTML still plain | Agent &lt; 1.1.3, or still using mailto / Open mail app, or Sync Center zip never repacked. Confirm `/health` → `version`; redeploy with `pack_win_agent=true`; reinstall — [Confirm agent version](#confirm-agent-version--113-path-c--html) |
| Reinstalled agent but version still old | Deploy skipped win pack (`JBT_SKIP_WIN_AGENT_PACK=1` / `pack_win_agent` false). VPS kept previous zip. Re-run Deploy with **`pack_win_agent=true`**, then download setup again |
| CI “Node 20 deprecated” / cache key `v20.18.1` | Actions runner warning only — not agent app version. Portable Node in zip is pinned separately; look for `AGENT_VERSION` / `PACK_VERSION.txt` in Build web logs |
| Body shows `+` and `%0A` | Old mailto form-encoding — redeploy web with `buildMailtoHref`; new send |
| Open mail app / Outlook do nothing | Outlook **Add Account** stuck; New Outlook; hung process — [Prep classic Outlook](#prep-classic-outlook-on-windows-paths-b--c) |
| Open in Outlook times out / hangs | COM hang (`New-Object Outlook.Application`); close `olk`; restart classic Outlook; COM probe |
| Open in Outlook disabled | Agent offline; or row has no PDF (`artifactId`) |
| Agent Connected but compose fails | Check `apiBase` (`…/jbt/api`), `agent.log`, [`SYNC_CENTER.md`](SYNC_CENTER.md)#troubleshooting |
| UNC Pending stuck vs email | Separate queues — Sync Center = files; Email Outbox = emails |
| Open in Outlook fails but item vanishes from Pending | Fixed: failures → `failed` (stay in queue); Pending includes `opened`. Redeploy API + web; agent ≥ 1.1.2 reports `agent-open-failed` |
| Wrong badge count | Outbox badge = pending+failed+opened **emails** |
| Wrong company emails | Branch / Business Profile switcher |

### Diagnostic commands (Windows)

```powershell
# Agent bridge + version
Invoke-RestMethod http://127.0.0.1:17865/health
Invoke-RestMethod http://127.0.0.1:17865/status | ConvertTo-Json -Depth 5
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\config.json"
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\agent.log" -Tail 40

# Outlook processes
Get-Process OUTLOOK, olk -ErrorAction SilentlyContinue |
  Format-Table Id, ProcessName, MainWindowTitle, Responding -AutoSize

# mailto probe
Start-Process "mailto:you@example.com?subject=JBT%20test&body=Mailto%20works"
```

---

## Related docs

- [`EMAIL_WEBHOOK.md`](EMAIL_WEBHOOK.md) — JSON contract  
- [`SYNC_CENTER.md`](SYNC_CENTER.md) — agent + UNC/local folder delivery · Connected ≠ sync · [agent version / pack](SYNC_CENTER.md#confirm-desktop-agent-version-in-build--on-pc)  
- [`DEPLOY.md`](DEPLOY.md)#advanced-cd--workflow_dispatch-options — `pack_win_agent`  
- [`SETUP.md`](SETUP.md) — env + short email section  
- [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) — file delivery channels (not email)  
- `desktop-sync-agent/README.md` — `/open-email` bridge · pack version  
- `web/lib/mailto.ts` — correct mailto percent-encoding  
