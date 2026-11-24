# GMAP2MAPPLS (JBT free tool)

Paste a **Google Maps share link**, a **full Indian address**, or **lat,lng**. The tool finds that **same geographic point** on Mappls and hands you identifiers every Mappls OEM shell can open.

Live route (after login): `/tools/gmap2mappls`  
API: `POST /api/public/gmap2mappls/resolve` · `GET /api/public/gmap2mappls/meta` (includes `oem` matrix)

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

Official Autosuggest: `query` = POI / house / keyword / place / Pin; `location=lat,lng` is **bias only**.  
Ampere docs advertise Mappls PIN last-mile; **SimpleOne does not reliably resolve Pin in search** even when the Pin is correct on Mappls web.

## Simple UI flow (automated)

1. Pick **Your vehicle brand** (dropdown shows companion app, e.g. SimpleOne → Simple Connect)  
2. Paste Google link → **Find point → open brand app**  
3. Tool opens that brand’s **companion app** with the destination (Android Intent)  
4. Confirm in the app and push / start navigation to the vehicle  

| Brand | Opens app | Package |
|-------|-----------|---------|
| Simple Energy | Simple Connect | `com.sepl.android` |
| Bajaj | Chetak | `com.bajajmychetak` |
| Hero | Hero Connect | `com.invenzen.rollr.hmc` |
| Ampere | Ampere Connect | `com.greavesmobility.app` |
| TVS | TVS Connect | `com.tvsm.connect` |
| Ola Electric | Ola Electric | `com.olaelectric.companion` |
| Mahindra · Adrenox (XUV700 / Scorpio-N) | Adrenox — Pin → **Push to car**; Share…; in-car NCASE Pin | `com.mahindra.adrenox` |
| Mahindra · Me4U (Born Electric) | Me4U — Pin → **Send to vehicle**; Share…; in-car NCASE Pin / EV routing backup | `com.mahindra.inglo` |
| Tata | iRA — Pin copy + open → **Send to car**; Share…; in-car Pin | `com.tatamotors.oneapp` |
| Hyundai | Bluelink — Pin copy + open → **Send to car**; Share…; in-car Pin | `com.hyundai.india.bluelink.prd` |
| Kia | Kia Connect — Pin copy + open → **Send to car**; Share…; in-car Pin | `com.kia.uvo.in.prd` |
| MG | iSMART — Pin copy + open → **Push POI to car**; Share…; in-car Pin | `com.saicmotor.iov.india` |
| Maruti | Suzuki Connect — Pin copy + open → **vehicle Mappls search**; Share…; in-car Pin | `com.msil.suzukiconnect_generation_2` |
| Matter / Tork / Suzuki 2W | Mappls nav (no public companion package) | — |

### Tool deep link (web)

Prefill brand (and optional Google link) for support / WhatsApp:

`/tools/gmap2mappls?brand=mahindra`

`/tools/gmap2mappls?brand=me4u` (Born Electric)

`/tools/gmap2mappls?brand=hyundai&q=https://maps.app.goo.gl/…`

Aliases: `oem=` for brand, `input=` for `q=`. Mahindra aliases include `adrenox`, `xuv700`, `scorpio-n` → Adrenox; `me4u`, `born-electric`, `be05`, `xev` → Me4U. Changing the brand dropdown updates `?brand=` in the URL.

### Mahindra Mappls Auto NCASE (Adrenox + Me4U)

| Model family | Phone app | Package | What this tool does |
|--------------|-----------|---------|---------------------|
| XUV700, Scorpio-N, connected ICE | **Adrenox Connect** | `com.mahindra.adrenox` | Copy Mappls Pin + open Adrenox → Push to car; in-car Pin for NCASE |
| Born Electric (BE.05 / BE.06 / XEV 9e, …) | **Me4U** | `com.mahindra.inglo` | Copy Mappls Pin + open Me4U → Send to vehicle; in-car Pin; Mappls 4W backup for EV routing verify |

Both stacks use Mappls Pin (not lat,lng). Multi-screen in-car navigation uses the same Pin via **Copy Pin for vehicle Mappls**.

### OEM app deep link (Android)

**Simple Connect (geo):** WhatsApp-style location Intent into `com.sepl.android`.

**4W send-to-car apps (Pin):** launch companion app + clipboard/QR Mappls Pin → search → Send/Push to car. Never paste lat,lng.

Use on an **Android phone with that brand’s app installed**. Desktop: scan the on-page QR. Mappls stays under Secondary / in-car CTA.

## OEM coverage matrix

Sources: MapmyIndia investor go-lives (FY23–FY27), Mappls Auto / Ampere case pages, Ola Maps / TVS Connect product notes.

| Brand | Segment | Stack | What to use from this tool |
|-------|---------|-------|----------------------------|
| Simple Energy / SimpleOne | 2W | Mappls + Simple Connect | **Open Simple Connect** (`com.sepl.android`) via geo Intent — not Mappls |
| Bajaj (Chetak + ICE/EV) | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Hero OneApp | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Ampere (Greaves) | 2W | Mappls | **Mappls Pin** (docs: PIN last-mile); Navigate 2W |
| Matter Motor Works | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Tork Motors | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Suzuki Motorcycles | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| TVS (e.g. Apache RTR 160) | 2W | Mixed | Pin for Mappls path; **Open Google** for Connect Google Maps EV path |
| Ola Electric | 2W | Ola Maps | **Open Google** / geo: (not Mappls Autosuggest) |
| Mahindra ICE (XUV700, Scorpio-N, …) | 4W | Mappls NCASE + Adrenox | **Adrenox** + Mappls Pin → **Push to car** |
| Mahindra Born Electric (BE.05 / XEV, …) | 4W | Mappls NCASE + Me4U | **Me4U** (`com.mahindra.inglo`) + Mappls Pin → **Send to vehicle** |
| Tata (Harrier, Safari, Sierra EV) | 4W | Mappls + iRA | **iRA** + Mappls Pin → **Send to car** |
| Hyundai / Kia connected lines | 4W | Mappls + Bluelink / Kia Connect | **App** + Mappls Pin → **Send to car** |
| MG Hector | 4W | Mappls + iSMART | **iSMART** + Mappls Pin → **Push POI to car** |
| Maruti (e-Vitara, Brezza NCASE) | 4W | Mappls + Suzuki Connect | **Pin** for vehicle Mappls / Suzuki Connect assist |

Private OEM schemes such as `simpleone://navigate?…` are **not** publicly documented; until OEMs publish them, **Mappls Pin + Mappls navigation deep links** are the portable solution.

## How we get Mappls Pin

1. Mappls web `GET /get_click_revg?{lat}&{lng}&{zoom}` → decrypt → `elc` + Digipin (no token required).
2. Token Reverse Geocode when `MAPPLS_ACCESS_TOKEN` is set.
3. Digipin also from offline India Post DIGIPIN encode.

## Local run

```bash
cp .env.example server/.env   # optional MAPPLS_ACCESS_TOKEN
npm install
npm run dev
```

Open http://localhost:3000/tools/gmap2mappls

## Acceptance checks

1. Google `@12.8804,77.5958` → same coords both sides.  
2. Brindavan / Hulimavu address → Bengaluru south.  
3. India Gate → Delhi.  
4. Zigma → Mappls Pin `kcf7zj` + Digipin + Navigate 2W/4W URLs.  
5. Meta `oem.brands` lists all brands above.

```bash
npm run test -w shared
npm run test -w server -- src/lib/gmap2mappls
```
