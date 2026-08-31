# Mobile (Capacitor Android)

## Prerequisites

- Android Studio
- `npm install` at repo root
- API and web dev servers, or a deployed host

## Development (live reload)

Point the WebView at your dev server (device must reach your machine):

```powershell
# Emulator uses 10.0.2.2 for host machine localhost
$env:CAPACITOR_SERVER_URL="http://10.0.2.2:3000"
$env:NEXT_PUBLIC_API_URL="http://10.0.2.2:4000"

npm run dev
npm run cap:sync
npm run cap:open:android
```

On a physical device, use your LAN IP (e.g. `http://192.168.1.10:3000`) and set `NEXT_PUBLIC_API_URL` to `http://192.168.1.10:4000`.

## Production-style

1. Deploy web + API with HTTPS.
2. Set `CAPACITOR_SERVER_URL` to your web URL (or remove it and ship a static `web/out` build).
3. Set `NEXT_PUBLIC_API_URL` to your API origin when not using same-host `/api`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run cap:sync` | Copy web assets + update Android project |
| `npm run cap:open:android` | Open Android Studio |

## Native behavior

- **Safe area** — CSS `env(safe-area-inset-*)` on top bar and bottom nav
- **Back button** — Android back navigates history or minimizes app
- **QR camera** — Requests Capacitor camera permission before `getUserMedia`
