# Artifact delivery (company Drive / webhook / UNC)

**Complete Sync Center guide (who / what / how):** [`SYNC_CENTER.md`](SYNC_CENTER.md)  
**Customer PC (desktop agent):** [`SYNC_CENTER.md`](SYNC_CENTER.md)#customer-pc--minimum-software--environment-desktop-agent  
Owner Drive steps (short): [`SETUP.md`](SETUP.md)#client-companies-part-b  
Quotation emails (separate): [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)

## Who this is for

| Company type | Owner sets | Staff | Sync Center |
|--------------|------------|-------|-------------|
| Google Drive (most common) | Connect company Drive + folder | Just use tools | Rarely (status/retry) |
| SharePoint / OneDrive (cloud) | **Webhook URL** from Power Automate | Just use tools | Rarely (status/retry) |
| Artifact webhook (n8n/Make/…) | Webhook URL on profile | Just use tools | Rarely (status/retry) |
| UNC / file share / **local folder** | **Download Folder path** (absolute or UNC) | One PC runs desktop agent | **Yes** |
| Email-only (no company folder) | Destination `none` / leave unset | Email Outbox paths | Only if Outlook Path C |

**How to obtain Webhook URL, secret, and Download Folder path (incl. SharePoint/OneDrive / local `C:\…`):** see [`SYNC_CENTER.md`](SYNC_CENTER.md)#13-corporate-artifact-webhook-sharepoint--onedrive--power-automate and [`SYNC_CENTER.md`](SYNC_CENTER.md)#14-company-file-server--download-folder-path-unc--optional.

**Agent gotcha:** Sync Center **Connected** only proves `127.0.0.1:17865` is up. Production agent `apiBase` must be `https://justxsystems.com/jbt/api`. Diagnose + browser-sync workaround: [`SYNC_CENTER.md`](SYNC_CENTER.md)#connected--sync-ok.

## What gets delivered

**Files (this guide / Sync Center):** PDFs from tools that call company delivery — today **Quotation V1** and **Site Survey V1**.

**Emails:** separate — [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md) (Paths A/B/C, Outlook prep, mailto encoding). Emailing a quotation does **not** replace Company document delivery. UNC already working? Add email without changing Download Folder — [`EMAIL_OUTBOX.md`](EMAIL_OUTBOX.md)#end-to-end-unc-already-working--add-email-only.

## Field cheat sheet

| Field on Business Profile | You get it from… | Example |
|---------------------------|------------------|---------|
| **Webhook URL** | Power Automate → “When an HTTP request is received” → **HTTP POST URL** | `https://prod-….logic.azure.com/workflows/…` |
| **Webhook secret** | You invent it (optional) | Long random string; not a Microsoft secret |
| **Download Folder path** | File Explorer address bar on a writable folder | `\\server\share\JustX` or `C:\JustX\Artifacts` or `C:\Users\…\OneDrive - Co\JustX` |
| **Company file server section** | UI: **Show UNC / file-server options** | Reveals Download Folder + conflict policy |

Do **not** paste a SharePoint browser link or OneDrive sharing link into Webhook URL or Download Folder — those are not valid for these fields.

## Model

1. Business Profile **Owner** chooses destination (Auto / Drive / webhook / UNC / none) and connects Drive or sets webhook/UNC as needed.
2. Staff use their own JBT logins; they never connect Drive.
3. On submit/deliver, the server stages an artifact and:
   - **Drive / webhook:** uploads or POSTs immediately  
   - **UNC:** leaves **pending** until desktop agent or browser folder sync writes the file  

Platform `.env` only needs one `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Per-company tokens are encrypted on each Business Profile.

## Same-filename policy (revisions)

Configured on Profile → Company document delivery.

| Policy | Google Drive | UNC / browser folder |
|--------|--------------|----------------------|
| **Overwrite** (default / recommended) | Updates the existing file → **new Drive revision**, same name and link | Replaces the file on disk |
| **Rename** | Keeps the old file; creates `name (1).ext`, `(2)`, … | Same |
| **Skip** | Leaves the existing Drive file unchanged | Leaves the local file unchanged |

Re-submitting the same quotation number therefore keeps one Drive file with revision history when Overwrite is selected.

## Code map

| Area | Location |
|------|----------|
| Per-profile OAuth | `server/src/lib/profile-drive-oauth.ts`, `server/src/routes/profile-drive.ts` |
| Drive upload / revise | `server/src/lib/google-drive-upload.ts` |
| Dispatch / retry | `server/src/lib/artifact-dispatch.ts` |
| UI | `web/components/profile/DownloadFolderPanel.tsx`, `web/app/sync/page.tsx` |
| UNC desktop agent | `desktop-sync-agent/` |
