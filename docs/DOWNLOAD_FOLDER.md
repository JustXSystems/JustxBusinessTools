# Artifact delivery (company Drive / webhook / UNC)

Full Owner steps: **[`SETUP.md`](SETUP.md)#client-companies-part-b**.

## Model

1. Business Profile **Owner** connects the **company** Google account and a shared folder.
2. Staff use their own JBT logins; they never connect Drive.
3. The server uploads PDFs with the profile’s stored token into that company folder.

Platform `.env` only needs one `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Per-company tokens are encrypted on each Business Profile.

## Code map

| Area | Location |
|------|----------|
| Per-profile OAuth | `server/src/lib/profile-drive-oauth.ts`, `server/src/routes/profile-drive.ts` |
| Dispatch / retry | `server/src/lib/artifact-dispatch.ts` |
| UI | `web/components/profile/DownloadFolderPanel.tsx` |
| UNC desktop agent | `desktop-sync-agent/` |
