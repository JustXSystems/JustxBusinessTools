# JustTestX — disposable IMS Dealer test tenant

Complete, **≥2-year** Inventory Management System (Dealer) scenario for **JustTestX** — an electrical / lighting distributor shaped for QA. Use it on production to exercise every IMS Dealer screen, then wipe it when testing is done.

Pairs with the BOS pack (`docs/JUSTTESTX_BOS_SEED.md`); same org/profile/login. Seed BOS and/or IMS independently.

## What gets created

| Layer | Content |
|-------|---------|
| **JBT** | Same **JustTestX** profile (created if missing), **imsdealer** enabled in `tool_catalog` |
| **Login** | `santhosh.hs@justxsystems.com` as **owner** (password only for new users, or with `--set-password`) |
| **IMS window** | Rolling **~2 years → today** (Asia/Kolkata) |
| **Catalog** | ~35 SKUs (LED/bulbs/switches/wire/networking + inactive), high opening stock + ledger |
| **Parties** | Customers + suppliers (GSTIN, terms, cities; unregistered SME included) |
| **Purchasing** | ~3 POs/month (draft / pending / approved / sent / partial / received / rejected / cancelled) + bills (incl. cancelled / on_hold) + AP payments |
| **Sales** | Near-daily high volume (1–3 invoices per workday; issued / draft / cancelled), GST intra/inter, POS-sourced, disputed, AR reminders/promises |
| **Stock** | Chronological IN → OUT (~thousands), damages, adjustments, customer/supplier returns (open/completed/cancelled) |
| **BOM** | Packages, rate cards, BOM docs (draft/confirmed/cancelled), DCs (draft/verified/approved/cancelled), DC returns, revisions, invoice↔DC links |
| **Ops** | Stock checks, expenses, daily closings, payment runs, field tasks/visits/check-ins, excise samples |
| **Bank / audit** | Matched NEFT + unmatched + ignored, audit items, support tickets, sync log (success/partial/failed) |
| **Reports** | Saved schedule for **every** runnable type (stock in/out, full stock, damage, PO, sales, AR/AP aging, margin, suppliers, onsite, low/dead stock) with custom full-window params; GST rate mix (5/12/18%), B2CL, AR 90+ / AP aging, damage density, dead-stock residuals, field GPS km |

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
2. Prefer the UI (while on JustTestX): **Admin → Tools → Justxsystems IMS — Dealer → Visible on home → Live → Save placement**.
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

Then in the UI (JustTestX branch): if the tool still isn’t on home, **Admin → Tools → Justxsystems IMS — Dealer → Visible on home → Live → Save placement**.

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
