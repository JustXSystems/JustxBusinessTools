# Justx BOS — Business Operating System

A working business application (Finance, HR, Projects) built on the [BOS design system](BOS_DESIGN_SYSTEM.md). The UI follows the **Justx BOS Design** reference tool (`/tools/bosdesign`) screen for screen. The difference is that every live screen reads and writes real data.

One codebase, two entry points, same data:

| Entry point | URL | Who it's for |
|-------------|-----|--------------|
| JBT tool | `/tools/bos` | Users working inside JBT. BOS shows as a tool next to Quotation, Site Survey, … |
| Standalone app | `/bos` | Full-screen BOS with its own splash and sign-in (JBT accounts, password / MFA / mobile OTP) |

## Architecture

```
web/app/bos/                      Standalone entry (/bos) → BosStandalone
web/components/tools/ToolView     Tool entry (/tools/bos) → BosTool (lazy, ssr:false)
web/components/bos-app/           The app: BosApp shell + workspaces
  core.tsx                        Context, navigation/intents, useBosData, useBosAction, previews
  home/ finance/ hr/ projects/ connect/ settings/
web/lib/bos-app/api.ts            Typed client for /api/bos (+ sendToBos bridge)
server/src/bos/                   Self-contained API module (createBosRouter)
  host.ts                         Host contract (identity, permissions, audit, notifications, brand)
  hosts/jbt.ts                    JBT implementation of the host
  connectors/                     Quotation V1, Site Survey V1 (read-only adapters)
server/src/routes/bos.ts          Wires BOS into JBT at /api/bos
mysql/migrations/010_bos_core.sql bos_* schema
```

### Pluggable by design

BOS never imports JBT internals. It talks to its host through one interface:

```ts
interface BosHost {
  actor(req): Promise<BosActor | null>;        // who is calling, which tenant, which role
  enabled?(actor): Promise<boolean>;           // optional: is BOS turned on for this caller (false → 403)
  requireWrite: RequestHandler;                // gate for mutating requests
  audit(actor, action, entityType, entityId, diff?, ip?): Promise<void>;
  notify(actor, notice: BosNotice): void;      // approvals/decisions → host notifications
  brand(tenantId): Promise<BosBrand>;          // company name, GSTIN, state, logo
  readonly appHref: string;                    // deep-link base ("/tools/bos" in JBT)
}
```

Inside JBT, `jbtHost` maps the JBT session to an actor. The tenant is the active business profile (branch), and the JBT role becomes the BOS role. Audit entries go into the JBT audit log, and notices go to the JBT notification bell. To run BOS behind another server, implement `BosHost` and mount the router:

```ts
app.use("/api/bos", createBosRouter({ db, host: myHost, connectors: [] }));
```

The web app has no host-specific code either. It only calls `/api/bos/*`, and the shell adapts to `mode="tool"` (embedded, with a **Full screen ↗** link) or `mode="standalone"` (with **Sign out**).

## Data — `bos_*` schema (migration 010)

`mysql/migrations/010_bos_core.sql` is additive. It only creates new `bos_*` tables (`CREATE TABLE IF NOT EXISTS`) and never alters existing JBT tables. The API applies it automatically on start (`runPendingMigrations`). Until it has run, every endpoint answers `503 { code: "BOS_SCHEMA_PENDING" }`, and the UI shows a "being set up" notice instead of an error.

| Area | Tables |
|------|--------|
| Core | `bos_settings`, `bos_sequences` (invoice/employee numbering per fiscal year), `bos_events` (activity feed + event bus), `bos_links` (source-tool record → BOS entity) |
| Finance | `bos_parties` (customers & vendors), `bos_invoices` (GST lines as JSON, CGST/SGST/IGST), `bos_payments`, `bos_bills`, `bos_expenses` |
| HR | `bos_departments`, `bos_employees`, `bos_profile_changes`, `bos_leave_requests`, `bos_attendance`, `bos_holidays` |
| Projects | `bos_projects` |

Every row is partitioned by `tenant_id`. In JBT that is the business profile, so each branch has its own books and HR.

## Modules

**Live (real data):**

- **Home.** My Profile (linked employee record, leave balances, quick actions, activity ticker, celebrations) and a Dashboard.
- **Finance & Accounts.**
  - Dashboard with revenue vs spend, aging, alerts and approvals.
  - Customers & Vendors.
  - GST Invoices: editor with a live paper preview and print. Intra-state invoices get CGST + SGST and inter-state ones get IGST, based on the place of supply.
  - Receivables & payments, Payables (bills with approval), Expenses (claims, approval, reimbursement), GST summary (output, ITC, net payable) and the Audit log.
- **HR Management.**
  - Overview.
  - Employees: full profile, a personal-detail change approval flow, and bank details that are masked until an audited reveal.
  - Org chart & departments.
  - Leave & attendance: requests and approvals, calendar, daily roster, holidays.
- **Projects.** Pipeline kanban (drag to change stage) and an All Projects list.
- **Connected Tools.** Connector overview, per-tool records and imports.
- **Settings & Audit.** Company & GST, invoicing, HR policy, integrations and the audit log.

**Coming next.** Accounting, banking, payroll, budgeting, assets, reports, recruitment, performance and the remaining modules show their reference screen with a "Coming next — design preview" banner, so the app stays visually complete.

Owners, admins and single-user installs are *managers*. Only managers approve, void, archive and edit settings. Other users get `403` from the API and view-only screens.

## Talking to other JBT tools

Connectors read another tool's records and import them into BOS. The source tool is never modified. Each import writes a `bos_links` row, so re-importing the same record returns the existing BOS entity instead of a duplicate.

| Connector | Auto-sync imports | Manual targets |
|-----------|-------------------|----------------|
| Quotation V1 (`/tools/quotationv1`) | Approved → customer + draft GST invoice (lines, HSN, GST rates carried over). Sent/submitted → customer | Customer, Invoice |
| Site Survey V1 (`/tools/sitesurveyv1`) | Saved/submitted/sent → customer + project lead (site address, estimate) | Customer, Project |

- **Auto-sync** is **off for new workspaces**, because its first run imports every eligible past quotation and survey. A manager turns it on in Settings → Integrations → Automatic sync. Once on, it runs when BOS opens, throttled to once every 30 seconds per tenant. **Sync now** runs it on demand either way.
- **Events out.** Approval requests and decisions (leave, expenses, bills, profile changes) become JBT notifications with deep links back into BOS. A manual import that creates an invoice or project sends one notification. A sync sends a single summary ("3 draft invoices and 1 project lead created from your tools.") instead of one per record.
- **Bridge for tool authors.** Any JBT screen can push a record to BOS with `sendToBos("quotationv1", id, "invoice")` from `web/lib/bos-app/api.ts`.
- **New connector.** Implement `BosConnector` (`id`, `label`, `targets`, `autoTargets`, `list`, `get`) in `server/src/bos/connectors/` and add it to `server/src/routes/bos.ts`.

### Send to BOS buttons (admin switches)

Quotation V1 and Site Survey V1 can show a **Send to BOS** button. These tools are live, so the button sits behind a per-org switch that is **off by default**:

| Switch | Where the button appears | What it creates |
|--------|--------------------------|-----------------|
| `bos.handoff.quotationv1` | Quotation editor actions, next to Email | Customer + draft GST invoice |
| `bos.handoff.sitesurveyv1` | Submitted survey screen, next to Email | Customer + project lead |

- **Turn on:** Admin → Tools → **Justx BOS** → Placement → *Switches*. Changes reach open screens within a minute (config refresh).
- **Shown only when** the switch is on, BOS is Live for the org, and the record has been saved. Drafts, rejected quotations and unsaved edits show a disabled button with the reason. If BOS can't be reached, the button stays hidden and the host tool is unaffected.
- **Once sent**, the button becomes **Open in BOS** and deep-links to the invoice or project. Imports go through the same idempotent connector, so a record is never created twice.
- **Storage:** `org_feature_switches` (migration 011), keyed by org and switch. No row means off. `GET /api/admin/features` lists the switches and `PUT /api/admin/features/:key {enabled}` sets one (admins only, audited, bumps `config_version`). `/api/config/effective` exposes them as `features`, and the web reads them with `useFeatureSwitch(key)`.
- **New switch:** add it to `FEATURE_SWITCHES` in `server/src/lib/feature-switches.ts`. The admin panel lists it under its `tool` automatically.

## Deep links

`?ws=<workspace>&m=<module>&open=<id>` opens a workspace, module and record. Examples: `/tools/bos?ws=finance&m=invoices&open=<invoiceId>` and `/bos?ws=hr&m=leave`. The `open` parameter is consumed on load. The URL then tracks navigation, so a refresh lands on the same screen.

## Enabling BOS

BOS is **opt-in and hidden by default**. Existing customers see nothing until an admin enables it.

1. Restart the API once after deploying. Migration 010 is applied on start.
2. Go to Admin → Tools → **Justx BOS** → Placement, set **Visible on home** to **Live**, then **Save placement**. The catalog row is seeded with `available = 0`.
3. Users then find it under *Utilities* (`/tools/bos`), and `/bos` opens the full-screen app.
4. Optional, when the team is ready: turn on automatic sync (BOS Settings → Integrations) and the Send to BOS switches (Admin → Tools → Justx BOS → Switches).

`/bos` checks the same catalog flag. A signed-in user whose org hasn't enabled BOS sees a "not enabled yet" screen; platform admins always have access.

The API enforces the same rule, so typing `/tools/bos` or calling `/api/bos` directly doesn't bypass it. Until the org's catalog row is Live, every BOS endpoint answers `403` with `code: "BOS_NOT_ENABLED"` before it reads or writes any data. As a result, auto-sync, imports and BOS notifications can't start on their own. The check is the optional `BosHost.enabled(actor)` hook; JBT implements it in `server/src/bos/hosts/jbt.ts` and fails closed if the lookup errors.

## Isolation (zero impact on live JBT)

- New tables only. No changes to existing JBT tables or data.
- Existing tools change only through the Send to BOS switches above, which are off until an admin turns them on.
- The API lives under `/api/bos` only, behind JBT session auth, the org's BOS catalog flag and the write-permission gate.
- The UI is lazy-loaded (`next/dynamic`, `ssr: false`), so no BOS code ships on other routes. Styles are scoped to `.bos` (see the design system isolation contract).
- `/bos` is public-path matched exactly (`/bos` and `/bos/*`). It renders its own sign-in, and no other route's auth behaviour changes.

## API

All endpoints are under `/api/bos`. They require a JBT session and BOS Live for the org (`403 BOS_NOT_ENABLED` otherwise); `GET` is read access and everything else needs write permission.

| Area | Endpoints |
|------|-----------|
| Workspace | `GET /session`, `GET/PUT /settings`, `GET /events?limit&entityType&entityId` (max 200) |
| Parties | `GET/POST /parties`, `PATCH/DELETE /parties/:id` |
| Invoices | `GET/POST /invoices`, `GET/PUT/DELETE /invoices/:id`, `POST /invoices/:id/issue`, `POST /invoices/:id/void`, `POST /invoices/:id/payments`, `DELETE /invoices/:id/payments/:paymentId` |
| Bills | `GET/POST /bills`, `POST /bills/:id/decision`, `POST /bills/:id/pay`, `DELETE /bills/:id` |
| Expenses | `GET/POST /expenses`, `POST /expenses/:id/decision`, `POST /expenses/:id/reimburse` |
| Finance | `GET /finance/overview`, `GET /finance/gst?month=YYYY-MM` |
| HR | `/hr/departments`, `/hr/employees` (+ `/:id`, `/:id/bank`, `/:id/profile-changes`), `/hr/profile-changes` (+ `/:id/decision`), `/hr/leave` (+ `/:id/decision`, `/:id/cancel`), `GET/PUT /hr/attendance`, `/hr/holidays`, `GET /hr/overview`, `GET /hr/me` |
| Projects | `GET/POST /projects`, `PATCH /projects/:id` |
| Connect | `GET /connect`, `GET /connect/:tool`, `POST /connect/:tool/:ref/import`, `POST /connect/sync`, `GET /links?sourceTool&sourceRef` |

## Verification

```bash
cd server && npx tsc --noEmit -p . && npx vitest run
cd web && npx tsc --noEmit -p . && npx eslint components/bos-app lib/bos-app app/bos && npx vitest run components/bos-app lib/bos-app
```

`web/components/bos-app/BosApp.test.tsx` renders the whole app against a mocked API. It walks every workspace and module, checks live GST maths in the invoice editor, the deep links (including a project handed off from Site Survey), and the pending-migration notice. `SendToBos.test.tsx` covers the button in every state: switch off, BOS not Live, unsaved, draft, sent, already linked and refused. On the server, `server/src/bos/router.test.ts` checks the sign-in and enabled gates over HTTP, and `logic.test.ts` covers the pure rules, including the sync summary.
