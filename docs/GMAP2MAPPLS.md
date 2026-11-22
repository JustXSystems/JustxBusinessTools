# GMAP2MAPPLS (JBT free tool)

Paste a **Google Maps share link**, a **full Indian address**, or **lat,lng**. The tool finds that **same geographic point** on Mappls.

Live route (after login): `/tools/gmap2mappls`  
API: `POST /api/public/gmap2mappls/resolve` · `GET /api/public/gmap2mappls/meta`

## Matching rule

**One shared lat/lng for Google and Mappls.**

1. Prefer coordinates from the Google Maps URL (`!3d!4d` pin, `/@lat,lng`, `q=lat,lng`, short `maps.app.goo.gl` expanded to Google hosts only).
2. If only an address is given, geocode with Photon then Nominatim (India-biased) and validate neighbourhood tokens (e.g. Hulimavu must not resolve to Whitefield / Navi Mumbai).
3. Call **Mappls Reverse Geocode only** at that lat/lng.
4. **Never** use Mappls Text Search / place search as the primary matcher for full addresses.

Mappls address wording may differ; the **map point must match**.

## Local run

```bash
# from repo root
cp .env.example server/.env   # if needed
# optional — without this, sample mode still works:
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

Optional GitHub Actions secret: store `MAPPLS_ACCESS_TOKEN` in repo secrets for ops reference; the **runtime** source of truth is `server.env` on the VPS (same pattern as `JWT_SECRET`, payment keys).

Without a token the tool runs in **sample mode**: shared coordinates still resolve; Mappls address text uses fixtures / sample copy.

## Acceptance checks

1. `https://www.google.com/maps/@12.8804,77.5958,18z` → same coords; Hulimavu / Bannerghatta area.  
2. Long Brindavan Enclaves / Hulimavu / Bannerghatta address → Bengaluru south, not Navi Mumbai / Whitefield.  
3. `India Gate` → Delhi area.  
4. Unset `MAPPLS_ACCESS_TOKEN` → sample mode still works.

```bash
npm run test -w shared
npm run test -w server -- src/lib/gmap2mappls
```
