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

## Why lat,lng / geo: fails in OEM “search”

Almost every listed OEM reuses **Mappls Autosuggest / NCASE destination search** (same contract as the Mappls app search bar: “Search for places & Mappls Pin”).

| Input | What the stack does | Result |
|-------|---------------------|--------|
| `12.877073,77.613574` / `geo:…` | Treated as **`query` text** | Wrong POI / city |
| Mappls Pin e.g. `kcf7zj` | Resolved as **eLoc** | Correct place |
| `mappls.com/navigation?places=lat,lng,Name&isNav=true` | **Navigation deep link** (not Autosuggest) | Correct point |
| Google Maps URL | Opens Google / Ola Google path | Correct point on non-Mappls stacks |

Official Autosuggest: `query` = POI / house / keyword / place / Pin; `location=lat,lng` is **bias only**.  
Ampere Nexus docs explicitly list **Last Mile Guidance (House Numbers & Mappls PIN)**.  
Mappls Routing / Navigation SDK accept **eLoc or lat,lng** as *route endpoints* — that is not the same as the search text field.

## Universal handoff (works across OEMs)

| Priority | Action | Covers |
|----------|--------|--------|
| 1 | **Copy Mappls Pin** → paste into OEM destination search | All Mappls NCASE / SDK / phone-projection OEMs |
| 2 | **Navigate Mappls · 2W** (`mode=biking`) / **· 4W** (`mode=driving`) | Skips search; official nav deep link with lat,lng |
| 3 | **Open pin on Mappls** / `@lat,lng` / **geo:** | Mappls app / OS chooser |
| 4 | **Open Google** | Ola Electric (Ola Maps) + some TVS Connect Google paths |
| 5 | Digipin / share text / QR | Backup identifiers |

## OEM coverage matrix

Sources: MapmyIndia investor go-lives (FY23–FY27), Mappls Auto / Ampere case pages, Ola Maps / TVS Connect product notes.

| Brand | Segment | Stack | What to use from this tool |
|-------|---------|-------|----------------------------|
| Simple Energy / SimpleOne | 2W | Mappls | **Mappls Pin** in search; or Navigate 2W |
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
