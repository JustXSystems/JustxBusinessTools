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
| `GET /health` → `version` | Matches shipped `AGENT_VERSION` (e.g. **1.1.3+** for Corporate HTML in Outlook) |
| `GET /status` → `apiBase` | **Production:** `https://justxsystems.com/jbt/api` (**not** `https://justxsystems.com/api`) |
| Pending after Sync now | Should drop to 0; files in Download Folder |

```powershell
Invoke-RestMethod http://127.0.0.1:17865/health
Invoke-RestMethod http://127.0.0.1:17865/status | ConvertTo-Json -Depth 5
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\config.json"
Get-Content "$env:LOCALAPPDATA\JustX\sync-agent\agent.log" -Tail 40
```

If `apiBase` is wrong, edit `config.json`, restart the agent (or re-download setup after a fixed web deploy).  
If API returns 403 / auth errors, use Sync Center **Link folder in this browser** + **Sync now (this browser)** until the API agent-auth fix is deployed.  
If `version` is old after reinstall, production never repacked the win zip — see [Version & CI pack](#version--ci-pack) below.

Full guide: [`docs/SYNC_CENTER.md`](../docs/SYNC_CENTER.md)#connected--sync-ok.

## Engineer: build packs

```bash
npm run pack:agent -w web
# or: node scripts/pack-agent-artifacts.mjs
# win only: npm run pack:agent:win -w web
```

Produces:

- `web/public/JustX-Sync-Agent-win-x64.zip` — primary Windows setup (Node win-x64 + CMD installers)
- `web/public/desktop-sync-agent.zip` — slim sources for advanced PowerShell bootstrap

`JBT_SKIP_WIN_AGENT_PACK=1` skips the ~28MB win zip (CI default on push). Set unset/`0` (or Deploy input **`pack_win_agent=true`**) to rebuild it.

First Windows pack build downloads Node **20.18.1** win-x64 into `desktop-sync-agent/.runtime-cache/` (gitignored). That portable runtime is **not** the agent app version.

Setup zip / launcher must embed `JBT_API_BASE` with the app **base path** (`/jbt` in production). `resolveAgentApiBase()` uses `withBasePath("/api")`.

### Version & CI pack

| Item | Location |
|------|----------|
| App version (source of truth) | `src/index.js` → `export const AGENT_VERSION` (exposed on `/health` + `/status`) |
| Setup `packVersion` | `web/lib/artifact-delivery/win-setup-pack.ts` → `AGENT_PACK_VERSION` |
| Pack stamp in zip | `JustX-Sync-Agent/PACK_VERSION.txt` (written by `scripts/pack-justx-sync-agent-win.mjs` from `AGENT_VERSION`) |

**Ship a new version to production customers**

1. Bump `AGENT_VERSION` (and keep `AGENT_PACK_VERSION` aligned).  
2. GitHub Actions → **Deploy** → **`pack_win_agent` = true**.  
3. Build web log must show `JBT_SKIP_WIN_AGENT_PACK=0` and the packed `AGENT_VERSION`.  
4. Customer: Sync Center → Download setup → Install → confirm `/health` → `version`.

Ordinary push deploys **do not** refresh the VPS win zip. Details: [`docs/DEPLOY.md`](../docs/DEPLOY.md)#advanced-cd--workflow_dispatch-options · [`docs/EMAIL_OUTBOX.md`](../docs/EMAIL_OUTBOX.md)#confirm-agent-version--113-path-c--html.

**Actions Node 20 deprecation warning:** CI runner / `actions/cache` only — ignore for agent version confirmation.

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
