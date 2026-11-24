# GMAP2MAPPLS (JBT free tool)

Paste a **Google Maps share link**, a **full Indian address**, or **lat,lng**. The tool finds that **same geographic point** on Mappls and hands you identifiers OEM apps (SimpleOne, etc.) can actually open.

Live route (after login): `/tools/gmap2mappls`  
API: `POST /api/public/gmap2mappls/resolve` · `GET /api/public/gmap2mappls/meta`

## Matching rule

**One shared lat/lng for Google and Mappls.**

1. Prefer coordinates from the Google Maps URL (`!3d!4d` pin, `/@lat,lng`, `q=lat,lng`, short `maps.app.goo.gl` expanded to Google hosts only).
2. If only an address is given, geocode with Photon then Nominatim (India-biased) and validate neighbourhood tokens (e.g. Hulimavu must not resolve to Whitefield / Navi Mumbai).
3. Call **Mappls Reverse Geocode only** at that lat/lng (token API and/or Mappls web click-revg).
4. **Never** use Mappls Text Search / place search as the primary matcher for full addresses.

Mappls address wording may differ; the **map point must match**.

### Mappls open URL

Use the official share form (no Google-style zoom suffix):

`https://www.mappls.com/@{lat},{lng}`

Do **not** append `,18z`. Mappls’s web app treats `@lat,lng,18z` as a broken path — the interstitial never opens the shared point. Plain `@lat,lng` loads the same pin Google uses.

## Why SimpleOne search fails with lat,lng / geo:

SimpleOne (and other Mappls OEM shells) wire the destination box to **Mappls Autosuggest / Text Search**.

| What you paste | What Mappls does | Result |
|----------------|------------------|--------|
| `12.877073,77.613574` or `geo:…` | Treated as **`query` text** (place name / keyword) | Wrong POI / city — **not** that coordinate |
| Mappls Pin e.g. `kcf7zj` | Resolved as **eLoc / Mappls Pin** | Correct place |
| Place name | Normal place search (biased by device location) | May or may not match Google |

Official Autosuggest docs: `query` = POI / house / keyword / place; `location=lat,lng` is only a **bias** parameter — it is **not** “go to these coordinates.” Mappls web search placeholder: **“Search for places & Mappls Pin.”**

So pasting Copy lat,lng or geo: into SimpleOne search is expected to fail. The tool’s primary SimpleOne action is **Copy Mappls Pin**.

### Best handoff to Mappls OEM apps (2W / 4W)

| Priority | Action | Why |
|----------|--------|-----|
| 1 | **Copy Mappls Pin** → paste into SimpleOne search | Only search string OEM Autosuggest resolves to the doorstep |
| 2 | **Open pin on Mappls** (`mappls.com/{pin}`) | Official Pin deep link |
| 3 | **Open Mappls** (`mappls.com/@lat,lng`) / **Directions** | Coordinate deep links (not search) |
| 4 | **Open on phone maps** (`geo:lat,lng`) | OS chooser if SimpleOne/Mappls registers for geo |
| 5 | **Copy Digipin** / share text / QR | Backup identifiers |

Ideal long-term (outside this tool): OEM partners expose `simpleone://navigate?lat=&lng=` or open Mappls Pin natively.

## How we get Mappls Pin

1. Mappls web `GET /get_click_revg?{lat}&{lng}&{zoom}` (AES payload → `elc` + Digipin) — works without `MAPPLS_ACCESS_TOKEN`.
2. Token Reverse Geocode when `MAPPLS_ACCESS_TOKEN` is set (may also return pin depending on key entitlements).
3. Digipin always filled from click-revg or offline India Post DIGIPIN encode.

## Local run

```bash
# from repo root
cp .env.example server/.env   # if needed
# optional — without this, click-revg still supplies Mappls Pin:
# MAPPLS_ACCESS_TOKEN=your_static_key

npm install
npm run dev
```

Open http://localhost:3000/tools/gmap2mappls

## Mappls token setup

1. Create / open an app at https://auth.mappls.com/console  
2. **Application → Credentials →** copy the **static key**  
3. Enable **Reverse Geocoding** for that key  
4. Bind the secret (do **not** paste the key into chat):

### Local

Add to `server/.env`:

```env
MAPPLS_ACCESS_TOKEN=your_static_key_here
```

### Production (VPS)

Mutable secrets live in `/var/www/jbt-shared/server.env` (symlinked into each release).

```bash
ssh deploy@YOUR_HOST
sudoedit /var/www/jbt-shared/server.env
# add:
# MAPPLS_ACCESS_TOKEN=...
pm2 reload justx-jbt-api   # or: pm2 reload ecosystem.config.cjs --only api
```

Without a token the tool still resolves shared coordinates and **Mappls Pin via click-revg**; formal Mappls address text may use sample copy.

## Acceptance checks

1. `https://www.google.com/maps/@12.8804,77.5958,18z` → same coords; Hulimavu / Bannerghatta area.  
2. Long Brindavan Enclaves / Hulimavu / Bannerghatta address → Bengaluru south, not Navi Mumbai / Whitefield.  
3. `India Gate` → Delhi area.  
4. Zigma / `12.877073,77.613574` → Mappls Pin `kcf7zj` (SimpleOne paste).  
5. Unset `MAPPLS_ACCESS_TOKEN` → Pin + Digipin still resolve via click-revg.

```bash
npm run test -w shared
npm run test -w server -- src/lib/gmap2mappls
```
