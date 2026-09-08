# JustXSystems Desktop Sync Agent

Copies pending tool artifacts from the JustXSystems API into the Business Profile **Download Folder**, and opens a localhost bridge for Sync Center / Email Outbox → Outlook.

## Customer setup (non-technical)

1. In JustX → **Sync Center** → **Set up on this PC**
2. Click **Download setup for this PC**
3. Extract `JustX-Sync-Agent-Setup.zip`
4. Double-click **Install JustX Sync Agent.cmd**
5. Return to Sync Center — should show **Connected**

No separate Node.js install. Portable Node is inside the zip.

Optional: **Check Status.cmd** · **Uninstall JustX Sync Agent.cmd**

## Engineer: build packs

```bash
npm run pack:agent -w web
# or: node scripts/pack-agent-artifacts.mjs
```

Produces:

- `web/public/JustX-Sync-Agent-win-x64.zip` — primary Windows setup (Node win-x64 + CMD installers)
- `web/public/desktop-sync-agent.zip` — slim sources for advanced PowerShell bootstrap

First Windows pack build downloads Node 20 win-x64 into `desktop-sync-agent/.runtime-cache/` (gitignored). VPS deploy needs outbound HTTPS to `nodejs.org` once.

## Advanced / PowerShell

See Sync Center → Advanced, or:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-agent.ps1 -LauncherScript "$env:USERPROFILE\Downloads\start-justx-sync-agent.ps1"
```

## Bridge API (localhost)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness + version |
| GET | `/status` | Folder probe + Outlook capability |
| POST | `/sync-once` | One sync pass |
| POST | `/open-email` | Outlook compose with PDF |

Docs: [`docs/SYNC_CENTER.md`](../docs/SYNC_CENTER.md) · [`docs/EMAIL_OUTBOX.md`](../docs/EMAIL_OUTBOX.md)
