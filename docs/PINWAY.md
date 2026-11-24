# Pinway (JBT free utility)

**Drop any Google place into your car.**

Paste a **Google Maps share link**, a **full Indian address**, or **lat,lng**. Pinway finds that **same geographic point** on Mappls and opens the right OEM companion app (Simple Connect, Adrenox, Me4U, Bluelink, …).

| Surface | URL |
|---------|-----|
| Standalone app (mobile / A2HS) | `/pinway` |
| Embedded tool (redirects to standalone by default) | `/tools/gmap2mappls` |
| API | `POST /api/public/gmap2mappls/resolve` · `GET /api/public/gmap2mappls/meta` |

Internal catalog / API id remains `gmap2mappls`.

## Matching rule

**One shared lat/lng for Google and Mappls.**

1. Prefer coordinates from the Google Maps URL (`!3d!4d` pin, `/@lat,lng`, `q=lat,lng`, short `maps.app.goo.gl` expanded to Google hosts only).
2. If only an address is given, geocode with Photon then Nominatim (India-biased) and validate neighbourhood tokens.
3. Call **Mappls Reverse Geocode only** at that lat/lng (token API and/or Mappls web click-revg for Pin).
4. **Never** use Mappls Text Search as the primary matcher for full addresses.

### Mappls open URL

`https://www.mappls.com/@{lat},{lng}` — do **not** append `,18z`.

## Why search fails (lat,lng **and** Pin on SimpleOne)

Almost every listed OEM reuses **Mappls Autosuggest / NCASE destination search**.

| Input | What the stack does | Result |
|-------|---------------------|--------|
| `12.877073,77.613574` / `geo:…` | Treated as **`query` text** | Wrong POI / city |
| Mappls Pin e.g. `kcf7zj` on **mappls.com** | Resolved as **eLoc** | Correct (verified: Zigma) |
| Same Pin in **SimpleOne search** | Often **no eLoc entitlement** → fuzzy text match | **Wrong place** (field-tested) |
| **POI place name** e.g. `Zigma Technologies Nyanappanahalli` | Normal Autosuggest POI | Correct when listed |
| Google / geo → **Share / Push to Simple Connect** | Official Push Navigation / WhatsApp-location path | Correct point on dash |
| `mappls.com/navigation?places=lat,lng,Name&isNav=true` | Nav deep link (not Autosuggest) | Correct point |

## App flow

1. **Brand** — 2W/4W filter, search, chips; Mahindra: **Adrenox · ICE** vs **Me4U · Born Electric**
2. **Place** — paste Google link or **Paste & find** from clipboard
3. **Open** — companion app Intent, or for Pin OEMs one-tap copy Pin + open

Extras: recents, WhatsApp Pinway link to the driver’s phone, Pin pulse, “App didn’t open?” → Play Store, desktop QR / Android Intent emphasis, Add to Home Screen.

### Deep links

`/pinway?brand=mahindra`

`/pinway?brand=me4u` (Born Electric)

`/pinway?brand=hyundai&q=https://maps.app.goo.gl/…`

Aliases: `oem=` for brand, `input=` for `q=`. Legacy `/tools/gmap2mappls?…` redirects to `/pinway`.

### Mahindra Mappls Auto NCASE (Adrenox + Me4U)

| Model family | Phone app | Package | What Pinway does |
|--------------|-----------|---------|------------------|
| XUV700, Scorpio-N, connected ICE | **Adrenox Connect** | `com.mahindra.adrenox` | Copy Mappls Pin + open Adrenox → Push to car |
| Born Electric (BE.05 / BE.06 / XEV 9e, …) | **Me4U** | `com.mahindra.inglo` | Copy Mappls Pin + open Me4U → Send to vehicle |

Pin-paste OEMs (`deferAutoOpen`): stay on **ready** until the primary CTA (copy Pin + open in one tap). Geo OEMs (Simple Connect) auto-open on resolve / brand switch.

## OEM coverage

| Brand | Segment | What to use |
|-------|---------|-------------|
| Simple Energy / SimpleOne | 2W | **Open Simple Connect** via geo Intent |
| Bajaj / Hero / Ampere / TVS | 2W | Companion geo Intent or Mappls Pin |
| Ola Electric | 2W | Ola Electric app (Google Maps family) |
| Mahindra ICE | 4W | **Adrenox** + Pin → Push to car |
| Mahindra Born Electric | 4W | **Me4U** + Pin → Send to vehicle |
| Tata / Hyundai / Kia / MG / Maruti | 4W | Companion + Pin → send / push to car |
| Matter / Tork / Suzuki 2W | 2W | Mappls nav (no public companion package) |

## Local run

```bash
cp .env.example server/.env   # optional MAPPLS_ACCESS_TOKEN
npm install
npm run dev
```

Open http://localhost:3000/pinway

```bash
npm run test -w shared
npm run test -w server -- src/lib/gmap2mappls
```
