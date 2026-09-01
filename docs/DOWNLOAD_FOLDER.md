# Artifact delivery (company Drive / webhook / UNC)

Full Owner steps: **[`SETUP.md`](SETUP.md)#client-companies-part-b**.

## Model

1. Business Profile **Owner** connects the **company** Google account and a shared folder.
2. Staff use their own JBT logins; they never connect Drive.
3. The server uploads PDFs with the profile’s stored token into that company folder.

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
| UI | `web/components/profile/DownloadFolderPanel.tsx` |
| UNC desktop agent | `desktop-sync-agent/` |
