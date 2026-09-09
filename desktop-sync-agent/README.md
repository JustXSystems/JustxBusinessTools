# JustXSystems Desktop Sync Agent

Copies pending tool artifacts from the JustXSystems API into the Business Profile **Download Folder**, and opens a localhost bridge for Sync Center / Email Outbox → Outlook.

**Who needs this agent?** Only companies using **UNC / local-folder file sync** and/or **Email Outbox → Open in Outlook**. Drive/webhook PDF delivery and email webhook send do **not** need it. See [`docs/SYNC_CENTER.md`](../docs/SYNC_CENTER.md)#who-needs-sync-center.

**What it syncs:** pending **file** artifacts (today Quotation V1 + Site Survey V1 PDFs queued for UNC). It does **not** send emails; Outlook Path C only opens a compose window with the PDF attached.

## Customer setup (non-technical)

1. Owner: Business Profile → Company document delivery → destination **UNC** → paste **Download Folder path** (e.g. `C:\JustX\Artifacts`) → Save  
2. In JustX → **Sync Center** → **Set up on this PC**  
3. Click **Download setup for this PC**  
4. Extract `JustX-Sync-Agent-Setup.zip`  
5. Double-click **Install JustX Sync Agent.cmd**  
6. Return to Sync Center — should show **Connected**  
7. Click **Sync now (desktop agent)** and confirm Pending → 0 and files appear in the folder  

No separate Node.js install. Portable Node is inside the zip.

Optional: **Check Status.cmd** · **Uninstall JustX Sync Agent.cmd**

### Connected ≠ sync working

| Check | Expected |
|-------|----------|
| Sync Center **Connected** | Local bridge `http://127.0.0.1:17865` responds |
| `GET /status` → `apiBase` | **Production:** `https://justxsystems.com/jbt/api` (**not** `https://justxsystems.com/api`) |
| Pending after Sync now | Should drop to 0; files in Download Folder |

```powershell
Invoke-RestMethod http://127.0.0.1:17865/status | ConvertTo-Json -Depth 5
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\config.json"
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\agent.log" -Tail 40
```

If `apiBase` is wrong, edit `config.json`, restart the agent (or re-download setup after a fixed web deploy).  
If API returns 403 / auth errors, use Sync Center **Link folder in this browser** + **Sync now (this browser)** until the API agent-auth fix is deployed.

Full guide: [`docs/SYNC_CENTER.md`](../docs/SYNC_CENTER.md)#connected--sync-ok.

## Engineer: build packs

```bash
npm run pack:agent -w web
# or: node scripts/pack-agent-artifacts.mjs
```

Produces:

- `web/public/JustX-Sync-Agent-win-x64.zip` — primary Windows setup (Node win-x64 + CMD installers)
- `web/public/desktop-sync-agent.zip` — slim sources for advanced PowerShell bootstrap

First Windows pack build downloads Node 20 win-x64 into `desktop-sync-agent/.runtime-cache/` (gitignored). VPS deploy needs outbound HTTPS to `nodejs.org` once.

Setup zip / launcher must embed `JBT_API_BASE` with the app **base path** (`/jbt` in production). `resolveAgentApiBase()` uses `withBasePath("/api")`.

## Advanced / PowerShell

See Sync Center → Advanced, or:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-agent.ps1 -LauncherScript "$env:USERPROFILE\Downloads\start-justx-sync-agent.ps1"
```

Manual:

```powershell
$env:JBT_API_BASE = "https://justxsystems.com/jbt/api"   # include /jbt
$env:JBT_AGENT_TOKEN = "jxsa_…"
$env:JBT_DOWNLOAD_FOLDER = "C:\JustX\Artifacts"          # optional
npm start
```

## Bridge API (localhost)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness + version |
| GET | `/status` | `apiBase`, last sync result/error, folder probe, Outlook capability |
| POST | `/sync-once` | One sync pass |
| POST | `/open-email` | Outlook compose with PDF (classic COM; prefer HTMLBody when API sends `html`) |

Docs: [`docs/SYNC_CENTER.md`](../docs/SYNC_CENTER.md) · [`docs/EMAIL_OUTBOX.md`](../docs/EMAIL_OUTBOX.md) (Outlook prep, mailto encoding, Open in Outlook)
