# JustTestX — disposable IMS Dealer test tenant

Complete, **≥2-year** Inventory Management System (Dealer) scenario for **JustTestX** — an electrical / lighting distributor shaped for QA. Use it on production to exercise every IMS Dealer screen, then wipe it when testing is done.

Pairs with the BOS pack (`docs/JUSTTESTX_BOS_SEED.md`); same org/profile/login. Seed BOS and/or IMS independently.

## What gets created

| Layer | Content |
|-------|---------|
| **JBT** | Same **JustTestX** profile (created if missing), **imsdealer** enabled in `tool_catalog` |
| **Login** | `santhosh.hs@justxsystems.com` as **owner** (password only for new users, or with `--set-password`) |
| **IMS window** | Rolling **~2 years → today** (Asia/Kolkata), e.g. 2024-10-24 → 2026-10-24 |
| **Catalog** | ~35 SKUs (LED/bulbs/switches/wire/fixtures + inactive), opening stock + ledger |
| **Parties** | Customers + suppliers (GSTIN, terms, cities) |
| **Purchasing** | Monthly POs (draft / pending / sent / partial / received / rejected / cancelled) + vendor bills + AP payments |
| **Sales** | ~195 invoices across the window (issued / draft / cancelled), GST intra/inter, AR activity |
| **Stock** | Chronological IN → OUT movements (~600+), damages, adjustments, customer/supplier returns |
| **Ops** | Stock checks, expenses, month closings, payment runs, field tasks/visits/check-ins |
| **Bank / audit** | Matched NEFT lines + 1 unmatched, audit items, support tickets, reports, sync log |

Scripts live under `server/scripts/justtestx/` (`seed-ims.ts`, `wipe-ims.ts`, `audit-ims.ts`, `ims-scenario.ts`).

## Safety

- **Never runs without** `JUSTTESTX_CONFIRM=YES`
- Points at whatever DB is in `server/.env` (on the VPS that is production)
- Re-seed requires `--reset` (wipes that tenant’s `ims_*` rows first)
- Does **not** change an existing user’s password unless you pass `--set-password`
- Does **not** wipe BOS data (and BOS wipe does not touch IMS)

## Load on production

Ensure IMS migrations are applied (`028`–`032` / `npm run db:migrate -w server`), then:

```bash
cd /var/www/jbt
npm run db:seed:justtestx:ims -w server -- --dry-run

JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx:ims -w server -- --reset --set-password
```

PowerShell (local against a DB):

```powershell
cd C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools
$env:JUSTTESTX_CONFIRM='YES'
npm run db:seed:justtestx:ims -w server -- --reset --set-password
```

Overrides:

| Env / flag | Purpose |
|------------|---------|
| `JUSTTESTX_EMAIL` | Owner email (default `santhosh.hs@justxsystems.com`) |
| `JUSTTESTX_PASSWORD` | Password when creating user or with `--set-password` (default `Justx@2026`) |
| `--reset` | Wipe existing JustTestX IMS data, then seed |
| `--set-password` | Force-update the owner password hash |
| `--dry-run` | Print plan only |

### Quality check

```bash
npm run db:audit:justtestx:ims -w server
```

Expect **SCORE: 100/100** (stock vs last movement, GST totals, status mix, ≥2-year span).

### After seeding

1. Sign in at https://justxsystems.com/jbt/
2. Switch active branch to **JustTestX** (IMS is Live only on that org — other branches stay hidden)
3. Soft-refresh, then open **IMS Dealer** (`/tools/imsdealer`)
4. Walk Items, Parties, Purchases, Sales, Stock, Returns, Banking, Field, Audit — every module should have realistic rows

### “Isn’t enabled yet” banner

That message means the **active branch’s org** does not have `imsdealer` Live in `tool_catalog`.

1. Confirm the branch switcher shows **JustTestX** (not your main company).
2. Prefer the UI (while on JustTestX): **Admin → Tools → Justx IMS — Dealer → Visible on home → Live → Save placement**.
3. Or, on the VPS (**bash**, not PowerShell), after this repo revision is deployed:

```bash
cd /var/www/jbt
JUSTTESTX_CONFIRM=YES npm run db:enable:justtestx:ims -w server
```

If that npm script is missing (older deploy), flip Live in MySQL instead:

```bash
cd /var/www/jbt/server
set -a; source .env; set +a
mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'SQL'
INSERT INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
SELECT p.organization_id, 'imsdealer', 'Utilities', 41, 1
FROM business_profiles p
WHERE p.business_name = 'JustTestX'
ON DUPLICATE KEY UPDATE available = 1, group_name = 'Utilities', sort_order = 41;

UPDATE business_profiles
SET config_version = config_version + 1
WHERE business_name = 'JustTestX';
SQL
```

Then in the UI (JustTestX branch): if the tool still isn’t on home, **Admin → Tools → Justx IMS — Dealer → Visible on home → Live → Save placement**.

4. If JustTestX IMS data was never loaded on this database, deploy the JustTestX IMS scripts, run migrations, then seed (see above).

## Wipe / delete when done

```bash
# IMS data only (profile remains; BOS untouched)
JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx:ims -w server
```

To remove the whole JustTestX tenant after both tools are wiped, use the BOS wipe `--archive` / `--hard` options in `docs/JUSTTESTX_BOS_SEED.md` (after wiping IMS first if you seeded it).

## Notes

- Profile GSTIN used: `29JTXTS0001X1Z5` (same as BOS pack).
- This pack is for **QA of IMS Dealer in prod**, not customer onboarding. Keep it named JustTestX so it is obvious to remove.
