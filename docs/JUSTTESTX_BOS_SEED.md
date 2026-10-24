# JustTestX — disposable BOS test tenant

Complete, one-year Business Operating System scenario for **JustTestX** (an IT services company shaped like Justx Systems). Use it on production to exercise every BOS screen, then wipe it when testing is done.

## What gets created

| Layer | Content |
|-------|---------|
| **JBT** | Organization `JustTestX Organization`, business profile **JustTestX** (approved), BOS enabled in `tool_catalog`, POS + Quotation/Site Survey handoff switches on |
| **Login** | `santhosh.hs@justxsystems.com` as **owner** of that org (password only set for new users, or with `--set-password`) |
| **BOS window** | Rolling **365 days → today** (Asia/Kolkata) |
| **People** | 8 departments, 17 employees (active / probation / exited), holidays, attendance, leave (pending/approved/rejected), profile-change pending |
| **Finance** | Customers & vendors, GST invoices (paid / partial / overdue / draft / void / POS), payments, bills, expenses, catalog, sales QT/SO/DC |
| **Payroll** | PF/ESI/PT settings, salary structures, monthly runs (paid → finalized → current draft) + payslips |
| **Banking** | HDFC + cash books, matched receipts, unmatched line, bank charges |
| **Budgets / Assets / Accounting** | FY 26-27 category budget, fixed assets + events, system chart + capital journal |
| **HR extras** | Recruitment pipeline, training/KRAs/promotions/PIP/recognition, travel, employee services, policies + acks, compliance calendar, agreements |
| **Projects** | Pipeline stages, milestones, tasks |

Scripts live under `server/scripts/justtestx/`.

## Safety

- **Never runs without** `JUSTTESTX_CONFIRM=YES`
- Points at whatever DB is in `server/.env` (on the VPS that is production)
- Re-seed requires `--reset` (wipes that tenant’s `bos_*` rows first)
- Does **not** change an existing user’s password unless you pass `--set-password`

## Load on production

SSH to the VPS, then from the app tree:

```bash
cd /var/www/jbt
# optional dry-run (no DB writes)
npm run db:seed:justtestx -w server -- --dry-run

JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx -w server -- --reset --set-password
```

PowerShell (local against a DB):

```powershell
cd C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools
$env:JUSTTESTX_CONFIRM='YES'
npm run db:seed:justtestx -w server -- --reset --set-password
```

Overrides:

| Env / flag | Purpose |
|------------|---------|
| `JUSTTESTX_EMAIL` | Owner email (default `santhosh.hs@justxsystems.com`) |
| `JUSTTESTX_PASSWORD` | Password when creating user or with `--set-password` (default `Justx@2026`) |
| `--reset` | Wipe existing JustTestX BOS data, then seed |
| `--set-password` | Force-update the owner password hash |
| `--dry-run` | Print plan only |

### After seeding

1. Sign in at https://justxsystems.com/jbt/
2. Switch active branch to **JustTestX**
3. Open **Justx BOS** (`/tools/bos` or `/bos`)
4. Walk Finance, HR, Projects, Connected tools, Settings — every module should have realistic rows

## Wipe / delete when done

```bash
# BOS data only (profile remains)
JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server

# BOS data + soft-archive the profile
JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server -- --archive

# BOS data + hard-delete the profile (and org if it has no other branches)
JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server -- --hard
```

`bos_*` tables are **not** FK-linked to `business_profiles`, so always wipe BOS (or use these scripts) before/with profile removal. Hard delete cascades normal JBT profile-scoped rows (`subscriptions`, `branch_access`, `tool_records`, …).

## Notes

- Profile GSTIN used: `29JTXTS0001X1Z5` (unique). If that GSTIN is already taken on another profile, the seed still creates JustTestX and skips setting GSTIN on `business_profiles`.
- This pack is for **QA of BOS in prod**, not a customer onboarding path. Keep it clearly named JustTestX so it is obvious to remove.
