# Sync Center — complete configuration guide

**Route:** `/sync` (sidebar → **Sync Center**)  
**Who can use it:** Business Owners and Staff (same Business Profile / branch)  
**Related UI:** Business Profile → **Company document delivery**  
**Related:** Email Outbox Outlook compose uses the **same desktop agent** — see [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)

Sync Center is the **status / retry / optional UNC sync** page. Most companies only need Owner setup on **Business Profile**; staff then generate PDFs and files land automatically (Drive/webhook). Use Sync Center when:

- Delivery failed and you need retries  
- Destination is a Windows **UNC / file share** (desktop agent)  
- You want to sync via **this browser** (Chrome/Edge File System Access)  
- You need a desktop agent for **Email Outbox → Open in Outlook**

---

## Configuration map (where everything lives)

| Setting | Where to configure | Who | Stored in |
|---------|-------------------|-----|-----------|
| Destination mode (`auto` / Drive / webhook / UNC / none) | **Business Profile** → Company document delivery | Owner | MySQL profile |
| Company Google Drive OAuth + folder | Same panel → Connect / Save folder | Owner | Encrypted on profile |
| Artifact webhook URL + secret | Same panel (or Advanced) | Owner | Profile |
| Download Folder UNC path | Same panel → Show UNC options | Owner | Profile |
| Same-filename / conflict policy | Same panel | Owner | Profile |
| Desktop agent token (`JBT_AGENT_TOKEN`) | **Sync Center** → Create token + download launcher | Owner or Staff | DB agent row + your `.ps1` |
| Agent runtime env | Launcher `.ps1` or PowerShell on the PC | Staff PC | Local process only |
| Browser-linked folder (FSA) | Sync Center → Link folder in this browser | Staff (Chrome/Edge) | Browser IndexedDB (this browser only) |
| Platform Google OAuth client | VPS `server/.env` (`GOOGLE_CLIENT_*`) | JustX engineer | Server env |

Nothing below is configured in `EMAIL_WEBHOOK_URL` — that env var is for **quotation emails**, not PDF file delivery. (Profile **artifact** webhook is separate.)

---

## Step 0 — Prerequisites

1. Sign in at https://justxsystems.com/jbt (or local).  
2. Select the correct **branch / Business Profile** (Branch switcher).  
3. Owner must have an active Business Profile saved.  
4. For Drive: JustX engineer must already have `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `server/.env` (same as Sign in with Google).

### Customer PC — minimum software & environment (desktop agent)

**Primary setup (recommended for staff):** Sync Center → **Download setup for this PC** → extract → double-click **Install JustX Sync Agent.cmd**. No separate Node.js or PowerShell skills required (portable Node is inside the zip).

| Requirement | UNC / file sync | Outlook compose | Notes |
|-------------|-----------------|-----------------|--------|
| **Windows 10 or 11** | Required | Required | Agent and Outlook COM are Windows-only |
| **Outbound HTTPS** to JustX API | Required | Required | Same host as the web app API |
| **Setup zip from Sync Center** | Required | Required | Personalized zip includes token + portable Node |
| **Write access to Download Folder** | If syncing files | Not required | UNC/share ACL, mapped drive, and/or VPN as needed |
| **Desktop Microsoft Outlook** | Not required | Required | Classic Outlook with COM — not Outlook on the web alone |
| **Chrome or Edge on the same PC** | Recommended | Recommended | Browser must reach local bridge `http://127.0.0.1:17865` |
| **Node.js / PowerShell skills** | Not required | Not required | Included / used only behind the scenes |
| **Git repo / developer tools** | Not required | Not required | Advanced IT path only |

**Not required:** admin rights for normal per-user install, npm packages, Java, .NET SDK, or `EMAIL_WEBHOOK_URL` (cloud email Path A only).

**Also required (process):**

- Signed in as **Owner or Staff** on the correct Business Profile  
- For file sync: Owner has set **Download Folder** (or use Drive/webhook and skip the agent)  
- Local port **17865** free; Windows user logged on for auto-start  
- Browser and agent on the **same** PC  

**Operational caveats:**

| Topic | Detail |
|-------|--------|
| **Per Windows user** | Install is per logged-on user (`%LOCALAPPDATA%`) |
| **Classic Outlook** | Path C needs desktop Outlook COM |
| **Corporate lockdown** | If Scheduled Task is blocked, Install adds a Startup shortcut fallback |
| **Token privacy** | Setup zip + `config.json` contain `jxsa_…` — treat like a password |
| **Pack missing on server** | Web deploy must run `pack-agent-artifacts` (downloads Node win-x64 at build). If Sync Center setup fails with pack 404, redeploy web |
| **Drive / webhook only** | No agent required for PDFs when destination is Drive/webhook |

**Verify:** after Install, Sync Center shows Connected, or run **Check Status.cmd**.

**Advanced:** PowerShell launcher / slim `desktop-sync-agent.zip` still available under Sync Center → Advanced.

---

## Part 1 — Owner: Company document delivery (required for automatic PDFs)

**Where:** Sidebar → **Business Profile** → panel **Company document delivery**  
**Save:** Use the profile **Save** button after changing destination / UNC / webhook fields. Drive folder has its own **Save company folder** button.

### 1.1 Choose destination

| Value in UI | Meaning | Typical when |
|-------------|---------|--------------|
| **Auto** (recommended) | Try company Drive → else profile webhook → else UNC queue | Default for most companies |
| **Company Google Drive** | Only Drive | Drive is the sole destination |
| **Corporate webhook** | POST each file to your SharePoint / Power Automate URL | IT already has an intake flow |
| **Company file server (UNC)** | Queue for desktop agent / browser sync to a path | On-prem share only |
| **Browser download only** | No company folder automation | Temporary / demos |

### 1.2 Google Drive (most common)

1. Destination = **Auto** or **Company Google Drive**.  
2. Click **Connect company Google Drive**.  
3. Sign in with the **company** Google / Workspace account (not personal if avoidable).  
4. Paste shared folder link (or folder ID) → optional label → **Save company folder**.  
5. Set **Same-filename policy**:

| Policy | Effect |
|--------|--------|
| **Overwrite** (recommended) | Same name → new Drive revision, same link |
| **Rename** | Keeps old file; writes `name (1).ext` |
| **Skip** | Leaves existing file unchanged |

6. Click profile **Save** if you also changed destination dropdown.  
7. Generate a test quotation PDF → confirm it appears in the company Drive folder.  
8. Sync Center should show **Company automatic delivery** ready.

**Staff:** do nothing on Drive. They only use JustX tools.

**Troubleshoot:**

| Symptom | Fix |
|---------|-----|
| Connect button missing / OAuth error | Platform `GOOGLE_CLIENT_*` + redirect URI (see [`SETUP.md`](SETUP.md)) |
| Connected but no uploads | Folder not saved; reconnect; destination not Auto/Drive |
| Wrong company files | Wrong Business Profile selected in branch switcher |

### 1.3 Corporate artifact webhook (optional)

**Different from** `EMAIL_WEBHOOK_URL` (emails). This is **per Business Profile** for PDF/files.

1. Destination = **Auto** or **Corporate webhook**, or open **Show UNC / file-server options** / webhook section.  
2. Paste **Webhook URL** (Power Automate / Logic Apps / n8n that accepts file POSTs).  
3. Optional **Webhook secret** (leave blank to keep existing).  
4. Profile **Save**.

Your flow must accept whatever JSON/multipart the JustX artifact dispatcher sends (see code / ops notes if customizing).

### 1.4 UNC / Download Folder (optional)

1. Click **Show UNC / file-server options** (or set destination to **UNC**).  
2. **Download Folder path** examples:

```text
\\fileserver\shared\JustX-Artifacts
D:\CompanyShare\Quotations
Z:\JustX
```

3. Set conflict policy (overwrite / rename / skip).  
4. Profile **Save**.  
5. Continue to **Part 2** (desktop agent) or browser FSA sync.

If destination is UNC and path is empty, Sync Center shows a warning to set the path.

---

## Part 2 — Sync Center page (status & manual sync)

**Where:** Sidebar → **Sync Center** (`/sync`)

### 2.1 What each panel means

| Panel | Meaning |
|-------|---------|
| **Company automatic delivery** | Effective destination + whether automation is ready; link back to Profile |
| **Pending** | Artifacts waiting for folder sync (UNC / FSA / agent) — **not** Email Outbox count |
| **Download Folder** | UNC/absolute path from Profile |
| **This browser** | File System Access link status (Chrome/Edge) |
| **Desktop agent** | Whether `http://127.0.0.1:17865` responds on **this PC** |
| **Sync now (desktop agent)** | Triggers one sync pass via local agent |
| **Sync now (this browser)** | Writes pending files into the linked FSA folder |
| **Link folder in this browser** | Pick a local/network folder (persists in this browser) |
| **Connect desktop agent** | Create `JBT_AGENT_TOKEN` + launcher |
| **Registered agents** | List / revoke tokens for this profile |
| **Pending files** | Queue list + Retry for failed/conflict |

### 2.2 Browser sync (no agent)

1. Chrome or Edge on a PC that can see the target folder.  
2. **Link folder in this browser** → pick folder (can be mapped drive).  
3. **Sync now (this browser)** when Pending &gt; 0.  
4. Re-link if you clear site data or switch browser/profile.

**Limits:** Not available in all browsers; permission is per-browser; UNC may need the share mapped/accessible to that Windows user.

### 2.3 Desktop agent sync (UNC / Outlook)

#### Generate token (UI) + install (recommended)

1. Sync Center → **Set up on this PC**.  
2. Optional **PC label**.  
3. Click **Download setup for this PC** → saves `JustX-Sync-Agent-Setup.zip`.  
4. Extract the zip on the Windows PC.  
5. Double-click **Install JustX Sync Agent.cmd** → wait for SUCCESS.  
6. Return to Sync Center → **Desktop agent: Connected** → **Sync now** if needed.  

Uninstall: run **Uninstall JustX Sync Agent.cmd**. Status: **Check Status.cmd**.

**Advanced (IT / PowerShell):** Sync Center → Advanced → Download PowerShell launcher, or use `desktop-sync-agent\install-agent.ps1`. See `desktop-sync-agent/README.md`.

#### Manual env (instead of `.ps1`)

```powershell
cd desktop-sync-agent
npm install   # once
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"
$env:JBT_AGENT_TOKEN = "jxsa_PASTE_FROM_SYNC_CENTER"
$env:JBT_DOWNLOAD_FOLDER = "\\fileserver\shared\JustX-Artifacts"   # optional override
$env:JBT_POLL_MS = "15000"      # 0 = only sync when UI clicks
$env:JBT_BRIDGE_PORT = "17865"
npm start
```

| Env | Required? | Where from |
|-----|-----------|------------|
| `JBT_API_BASE` | Yes | Public API ending in `/api` (launcher sets from browser). Local: `http://localhost:4000/api` |
| `JBT_AGENT_TOKEN` | Yes | **Only** Sync Center → Create token |
| `JBT_DOWNLOAD_FOLDER` | No | Overrides Profile Download Folder for this PC |
| `JBT_POLL_MS` | No | Background poll; default `15000`; `0` = UI-triggered only |
| `JBT_BRIDGE_PORT` | No | Default `17865` |
| `JBT_BRIDGE_ORIGIN` | No | CORS for bridge; default `*` |

#### Revoke

Sync Center → Registered agents → **Revoke**. Old launcher / LocalAppData config stop working; create a new token and re-run `-Install`.

#### Same agent for Email Outbox

With agent running on Windows + Outlook installed: **Email Outbox → Open in Outlook**. No separate token. Use `-Install` so the agent is up after reboot.

---

## Part 3 — End-to-end checklists

### Drive-only company (recommended)

- [ ] Owner: Profile → Connect Drive → Save folder → Overwrite policy → Save  
- [ ] Test PDF appears in Drive  
- [ ] Staff never open Sync Center for normal work  
- [ ] Sync Center used only if something is pending/failed  

### UNC company

- [ ] Owner: Destination Auto or UNC → set Download Folder path → Save  
- [ ] Staff or Owner: Sync Center → Create token + run agent on share-reachable PC  
- [ ] Sync now (desktop agent) or wait for poll  
- [ ] Or: Link folder in browser + Sync now (this browser)  

### Artifact webhook company

- [ ] Owner: set destination + webhook URL (+ secret) → Save  
- [ ] Confirm automation receives posts  
- [ ] Sync Center for failures / status  

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Pending never drops | Destination UNC without agent/FSA; Drive not connected; webhook failing |
| Agent “Not detected” | Agent not running on **this** PC; wrong machine; run Check Status.cmd |
| Setup download fails / pack incomplete | Redeploy web so `JustX-Sync-Agent-win-x64.zip` is published (`npm run pack:agent`) |
| Agent pack download fails | Slim `desktop-sync-agent.zip` 404 — same redeploy |
| Folder not reachable | Path wrong; PC not on VPN; agent user lacks share ACL |
| Badge / pending confusion | Sync Center pending = **files**; Email Outbox badge = **emails** |
| Token lost | Download setup again (new token); revoke old agent |
| Staff can’t edit path | Only Owner edits Profile delivery settings |

---

## Related docs

- [`SETUP.md`](SETUP.md) — platform env, client Drive Part B  
- [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) — quotation email paths + Outlook  
- [`DOWNLOAD_FOLDER.md`](DOWNLOAD_FOLDER.md) — short model + conflict policy  
- `desktop-sync-agent/README.md` — bridge API  
