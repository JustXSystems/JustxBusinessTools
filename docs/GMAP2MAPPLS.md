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

1. Paste Google link → **Find same point**  
2. Tool **auto-opens Mappls** at the exact lat/lng (2W biking / 4W driving nav deep link; Google for Ola)  
3. Pick **Your brand** in the dropdown  
4. Tap the **one big button** and follow the **1–2 short steps** shown for that brand  

| Brand type | Auto-open | One user action |
|------------|-----------|-----------------|
| SimpleOne | Mappls nav | Copy place name → paste in SimpleOne / Push |
| Most Mappls OEMs | Mappls nav | Copy Mappls Pin → paste in vehicle search |
| Ola Electric | Google Maps | Use that Google point in Ola |

## OEM coverage matrix

Sources: MapmyIndia investor go-lives (FY23–FY27), Mappls Auto / Ampere case pages, Ola Maps / TVS Connect product notes.

| Brand | Segment | Stack | What to use from this tool |
|-------|---------|-------|----------------------------|
| Simple Energy / SimpleOne | 2W | Mappls | **Place name** or **Google/geo → Push to Simple Connect** (Pin search often wrong) |
| Bajaj (Chetak + ICE/EV) | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Hero OneApp | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Ampere (Greaves) | 2W | Mappls | **Mappls Pin** (docs: PIN last-mile); Navigate 2W |
| Matter Motor Works | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Tork Motors | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| Suzuki Motorcycles | 2W | Mappls | **Mappls Pin**; Navigate 2W |
| TVS (e.g. Apache RTR 160) | 2W | Mixed | Pin for Mappls path; **Open Google** for Connect Google Maps EV path |
| Ola Electric | 2W | Ola Maps | **Open Google** / geo: (not Mappls Autosuggest) |
| Mahindra (Scorpio-N, XUV400, Born Electric, 7X0, …) | 4W | Mappls | **Mappls Pin**; Navigate 4W |
| Tata (Harrier, Safari, Sierra EV) | 4W | Mappls | **Mappls Pin**; Navigate 4W |
| Hyundai / Kia connected lines | 4W | Mappls | **Mappls Pin**; Navigate 4W |
| MG Hector | 4W | Mappls | **Mappls Pin**; Navigate 4W |
| Maruti (e-Vitara, Brezza NCASE) | 4W | Mappls | **Mappls Pin**; Navigate 4W |

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
