# JustXSystems Desktop Sync Agent

Copies pending tool artifacts from the JustXSystems API into the Business Profile **Download Folder** (local path, mapped drive, or UNC share reachable from this PC).

The agent also starts a **localhost bridge** (`http://127.0.0.1:17865`) so Owners and Staff can:

- Click **Sync now (desktop agent)** in **Sync Center** (`/sync`)
- Click **Open in Outlook** in **Email Outbox** (`/email-outbox`) — Windows + Outlook COM, PDF attached

See [`docs/EMAIL_OUTBOX.md`](../docs/EMAIL_OUTBOX.md) for email variants.

## Recommended: Sync Center UI

1. Open **Sync Center** in the web app (sidebar / mobile Sync).
2. Ensure Download Folder is set on Business Profile (Owner).
3. Click **Set up on this PC** → **Create token + download launcher**.
   - This **generates** `JBT_AGENT_TOKEN` (`jxsa_…`) — shown once on screen and embedded in the `.ps1`.
   - You do not invent this value; if lost, create a new token and revoke the old agent.
4. Run the downloaded `start-justx-sync-agent.ps1` on a PC that can reach the share (and/or has Outlook for Email Outbox).
5. Keep the agent window open. In Sync Center click **Sync now (desktop agent)**; for email use **Email Outbox → Open in Outlook**.

Any Owner or Staff member can create their own agent token and complete sync for the branch queue.

## Manual CLI setup

```powershell
cd desktop-sync-agent
$env:JBT_API_BASE = "https://your-host/api"   # or http://localhost:4000/api
$env:JBT_AGENT_TOKEN = "jxsa_..."
npm start
```

One-shot sync (no bridge):

```powershell
npm run sync-once
```

Optional:

| Env | Purpose |
|-----|---------|
| `JBT_DOWNLOAD_FOLDER` | Override profile path |
| `JBT_POLL_MS` | Background poll interval (default `15000`; `0` = UI-only) |
| `JBT_BRIDGE_PORT` | Local control port (default `17865`) |
| `JBT_BRIDGE_ORIGIN` | CORS allowlist (default `*`) |

## Bridge API (localhost only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/status` | Folder probe + last run + `outlookCompose` capability |
| POST | `/sync-once` | Run one sync pass (used by Sync Center) |
| POST | `/open-email` | Body `{ "outboxId": "eml_..." }` — fetch compose payload from API, open Outlook with PDF |

## Behavior

- Polls `GET /api/artifacts?pending=1` (unless `JBT_POLL_MS=0`)
- Probes folder writability via `/api/artifacts/agent/probe`
- Downloads content, writes atomically (`*.jbt-partial` → final name)
- Applies conflict policy from the profile
- Acks `synced` / `failed` / `skipped_duplicate`
