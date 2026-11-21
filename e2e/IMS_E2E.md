# JustTestX IMS — full automation suite (local + production)

On-demand Playwright suite for **every IMS screen**, shell/search journeys, and mutating smoke paths against the **JustTestX** 2-year seed. Not part of PR smoke (`npm run test:e2e`).

---

## Where to run from

| | |
| --- | --- |
| **Machine** | Your Windows PC (or any machine with Node 20+) |
| **Folder** | `C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools` (this repo root) |
| **Shell** | PowerShell |
| **Against** | Local `:3100` **or** production `https://justxsystems.com/jbt` |

You do **not** SSH to the VPS to run the browser tests. The suite runs locally and drives the remote UI over HTTPS.

Seed / enable JustTestX IMS data **on production** is separate (SSH to VPS) — see “Manual configuration” below.

---

## One-time setup on your PC

```powershell
cd C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools
npm install
npx playwright install chromium
```

---

## Manual configuration before production run

### 1. JustTestX IMS data on production (VPS — once / when refreshing seed)

SSH as deploy, then:

```bash
cd /var/www/jbt
JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx:ims -w server -- --reset --set-password
JUSTTESTX_CONFIRM=YES npm run db:enable:justtestx:ims -w server
npm run db:audit:justtestx:ims -w server   # expect SCORE: 100/100
```

Details: [`docs/JUSTTESTX_IMS_SEED.md`](../docs/JUSTTESTX_IMS_SEED.md).

Default owner (unless you overrode seed env):

| | |
| --- | --- |
| Email | `santhosh.hs@justxsystems.com` |
| Password | whatever you set with `--set-password` (seed default `Justx@2026`) |

### 2. Confirm in the browser (2 minutes)

1. Open https://justxsystems.com/jbt/login  
2. Sign in as that owner  
3. Branch switcher → **JustTestX**  
4. Open https://justxsystems.com/jbt/ims — sidebar modules must load with seeded data  

If you see “Isn’t enabled yet”, enable IMS Live for JustTestX (Admin → Tools, or `db:enable:justtestx:ims`).

### 3. Values you set in PowerShell for the suite

| Variable | Required | Production value |
| --- | --- | --- |
| `E2E_IMS_BASE_URL` | **yes** | `https://justxsystems.com/jbt` |
| `E2E_IMS_EMAIL` | **yes** | JustTestX owner email |
| `E2E_IMS_PASSWORD` | **yes** | That user’s password |
| `E2E_IMS_MFA_CODE` | only if MFA on | Current 6-digit TOTP |
| `E2E_IMS_BRANCH_NAME` | no | Default `JustTestX` |
| `E2E_IMS_IGNORE_HTTPS` | no | `1` only if TLS is broken |

No other config files to edit. Auth cookies are written under `e2e/.auth/` (gitignored).

---

## How to run against production (pre–go-live)

```powershell
cd C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools

$env:E2E_IMS_BASE_URL  = 'https://justxsystems.com/jbt'
$env:E2E_IMS_EMAIL     = 'santhosh.hs@justxsystems.com'
$env:E2E_IMS_PASSWORD  = 'YOUR_PASSWORD_HERE'
# $env:E2E_IMS_MFA_CODE = '123456'   # if MFA enabled

npm run test:e2e:ims:prod
```

What happens:

1. Logs into production `/jbt/login` (not the marketing homepage)  
2. Switches branch to **JustTestX** via API  
3. Opens `/jbt/ims` and runs **42** scenarios (all modules + journeys)  
4. Writes reports under `e2e-results/ims*`  

> **Note:** Playwright treats `/login` as origin-absolute. The suite rewrites it to
> `/jbt/login` so you do not land on `https://justxsystems.com/login` (public marketing site).

Expected duration: often **30–90+ minutes** on production (full QA-style suite, not a smoke).

### After the run

```powershell
npm run test:e2e:ims:report
```

Then open:

| File | What to do |
| --- | --- |
| `e2e-results/ims-html/` | Failures, screenshots, traces |
| `e2e-results/ims/MANUAL_VERIFY.md` | PASS/FAIL + checkboxes for manual spot-checks |
| `e2e-results/ims/latest.json` | Machine-readable results |

---

## Local run (optional)

```powershell
cd C:\Users\iamsa\IdeaProjects\Production\JustxBusinessTools
# Ensure local DB has JustTestX IMS seed
npm run test:e2e:ims
```

---

## What the suite covers

1. **Read-only matrix** — every entry in `IMS_MODULES` via `/ims?m=…`  
2. **Shell** — login, JustTestX branch, nav, deep links, global search  
3. **Journeys** — new invoice/PO editors, reports, small Stock In + Help Desk ticket marked `E2E-<timestamp>`  

Catalog: [`e2e/ims/modules.catalog.ts`](ims/modules.catalog.ts).

Mutating tests are intentional on JustTestX for pre–go-live. Re-seed IMS on the VPS if you want a clean tenant afterward.

## Notes

- **Excise** is skipped when the module is not enabled for the tenant (`exciseActive`).
- Auth rate-limiting on production applies only to login/register/OTP/OAuth — not `/api/auth/me` (fixed so SPA navigation does not trip 429s).
- Module matrix uses one shared browser session + SPA sidebar clicks for speed and session stability.
