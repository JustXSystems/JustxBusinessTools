# REFACTOR_ANALYSIS.md

Analysis of `JustX_Business_Tools.html` (source of truth). The user referenced `JustX_Business_Tools-4.html`; the workspace contains `JustX_Business_Tools.html` (~199 KB, single-page app). This document reflects that file.

---

## 1. Sections Found in the HTML

| Section / Screen | Route key (`go(screen)`) | Description |
|------------------|--------------------------|-------------|
| App shell | (global) | Sticky topbar: brand, business name button, notifications |
| Home / Dashboard | `home` | Hero greeting, tool search, tool grid |
| Business Profile | `profile` | Logo, business details, bank, terms |
| Notifications | `notifications` | Derived feed from AMC, payments, visitors, service tasks |
| Document tools (×4) | `quotation`, `salesorder`, `invoice`, `po` | Editor + saved list + print preview |
| Tracker tools (×12) | See tools list | List + modal add/edit |
| Calculator tools (×8) | See tools list | Live calculation panels, no persistence |
| QR Code tool | `qrscanner` | Generate / scan modes |
| Modal layer | (global) | `#jbtModal` — confirm, validation lists, tracker forms |
| Toast layer | (global) | `#jbtToast` — success/error feedback |
| Print view | (CSS `@media print`) | Document preview only; hides chrome |

**Navigation model:** Single-page; `route = { screen, params }`; `render()` dispatches to `TOOL_RENDERERS[screen]` or fixed screens. No URL routing in the HTML app.

**Categories in `TOOL_CATALOG`** (home metadata; grid shows deduplicated tools, not grouped by category in UI):

- Sales & Business
- Procurement
- Inventory
- Projects & Service
- Solar Solutions
- Finance & Calculators
- Dealers / Distributors
- Utilities

Note: `TOOL_CATALOG` lists duplicate `id`s (`po`, `profitcalc`) under multiple categories; `uniqueTools()` deduplicates by `id`.

---

## 2. Business Tools (26 unique tool IDs)

### Document tools (persist full documents + list summaries)

| ID | Name | Storage list key |
|----|------|-------------------|
| `quotation` | Quotation Creator | `jbt:quotation:list` |
| `salesorder` | Sales Order Creator | `jbt:salesorder:list` |
| `invoice` | Invoice Creator | `jbt:invoice:list` |
| `po` | Purchase Order Creator | `jbt:po:list` |

### Tracker tools (generic list + modal CRUD)

| ID | Name | List key |
|----|------|----------|
| `paymenttracker` | Payment Tracker | `jbt:paymenttracker:list` |
| `vendors` | Vendor Directory | `jbt:vendors:list` |
| `stock` | Stock In / Stock Out | `jbt:stock:list` |
| `projects` | Project Creator | `jbt:projects:list` |
| `amc` | AMC Tracker | `jbt:amc:list` |
| `servicetasks` | Service Task Creator | `jbt:servicetasks:list` |
| `installation` | Installation Report | `jbt:installation:list` |
| `sitesurvey` | Solar Site Survey | `jbt:sitesurvey:list` |
| `pricelist` | Price List Manager | `jbt:pricelist:list` |
| `creditlimit` | Credit Limit Tracker | `jbt:creditlimit:list` |
| `targettracker` | Target vs Achievement | `jbt:targettracker:list` |
| `dealerorders` | Dealer Order Tracker | `jbt:dealerorders:list` |
| `visitors` | Visitor & Appointment Manager | `jbt:visitors:list` |

### Calculator tools (no saved records in HTML app)

| ID | Name |
|----|------|
| `gstcalc` | GST Calculator |
| `tdscalc` | TDS Calculator |
| `taxcalc` | Tax Calculator |
| `profitcalc` | Profit Calculator |
| `emicalc` | EMI Calculator |
| `loancalc` | Loan Calculator |
| `solarroi` | Solar ROI Calculator |
| `dealercommission` | Commission Calculator |

### Utility tools

| ID | Name | Persistence |
|----|------|-------------|
| `qrscanner` | QR Code Scanner | Generate/download only; scan is ephemeral |
| `notifications` | Notifications (catalog entry) | Screen reads other tools’ lists |

**Record-count tools (subscription rule applies):** 4 document + 12 tracker = **16 tools** with persisted records. Calculators and QR do not save records today.

---

## 3. Forms

| Form | Location | Submit action |
|------|----------|---------------|
| Business Profile | `profile` | `saveProfileForm()` → `saveProfile()` |
| Tool search | `home` | `filterTools()` (client filter, no submit) |
| Document editor | quotation/salesorder/invoice/po | `docSave()`, `docPrint()`, `docReset()` |
| Tracker add/edit modal | All tracker tools | Modal OK → `listUpsert()` |
| GST calculator | `gstcalc` | Live `oninput` / `onchange` |
| TDS calculator | `tdscalc` | Live + `tdsSectionChange()` |
| Tax calculator | `taxcalc` | Live |
| Profit calculator | `profitcalc` | Live |
| EMI calculator | `emicalc` | Live |
| Loan calculator | `loancalc` | Live |
| Solar ROI calculator | `solarroi` | Live |
| Commission calculator | `dealercommission` | Live |
| QR generate | `qrscanner` | `qrGenUpdate()`, `qrDownload()` |
| QR scan | `qrscanner` | Camera / file upload |

---

## 4. Data Fields

### Business profile (`PROFILE`)

| Field | Type | Notes |
|-------|------|-------|
| `logo` | base64 data URL | File upload |
| `businessName` | string | Required for document save |
| `addressLine1`, `addressLine2` | string | |
| `gstin`, `pan` | string | |
| `state`, `stateCode` | string | State from `INDIAN_STATES` |
| `phone`, `email` | string | |
| `bankName`, `bankBranch`, `bankAccount`, `bankIfsc`, `bankUpi` | string | Shown on documents |
| `terms` | multiline string | Default T&C on documents |

### Document record (`DOC_STATE`)

| Field | Type |
|-------|------|
| `id` | string (generated) |
| `docNo` | string (auto: `PREFIX/YYYY/MM/1000+n`) |
| `docDate`, `extraDate` | ISO date |
| `party.name`, `party.address`, `party.phone`, `party.gstin`, `party.state` | string |
| `items[]` | `{ id, name, hsn, qty, unit, rate }` |
| `igstPct`, `cgstPct`, `sgstPct`, `cgstSgstEnabled` | number/boolean |
| `notes` | string |
| `status` | `draft` / `saved` |

List summary (per document): `id`, `docNo`, `partyName`, `docDate`, `grandTotal`, `status`.

### Tracker records (per-tool fields — see `TRACKER_CONFIGS`)

<details>
<summary>Payment Tracker</summary>
`kind`, `party`, `ref`, `date`, `amount`, `status`
</details>

<details>
<summary>Vendors</summary>
`name`, `category`, `phone`, `email`, `gstin`, `notes`
</details>

<details>
<summary>Stock</summary>
`direction`, `item`, `qty`, `unit`, `date`, `reference`
</details>

<details>
<summary>Projects</summary>
`name`, `client`, `startDate`, `endDate`, `budget`, `status`, `notes`
</details>

<details>
<summary>AMC</summary>
`client`, `contractNo`, `startDate`, `renewalDate`, `value`, `status`
</details>

<details>
<summary>Service Tasks</summary>
`title`, `client`, `assignedTo`, `dueDate`, `priority`, `status`, `notes`
</details>

<details>
<summary>Installation</summary>
`client`, `site`, `installDate`, `capacity`, `engineer`, `status`, `notes`
</details>

<details>
<summary>Site Survey</summary>
`client`, `site`, `surveyDate`, `roofType`, `roofArea`, `shading`, `sanctionedLoad`, `surveyor`, `notes`
</details>

<details>
<summary>Price List</summary>
`product`, `sku`, `costPrice`, `sellPrice`, `unit`, `updated`
</details>

<details>
<summary>Credit Limit</summary>
`customer`, `creditLimit`, `outstanding`, `reviewDate`, `notes`
</details>

<details>
<summary>Target Tracker</summary>
`period`, `salesperson`, `target`, `achieved`
</details>

<details>
<summary>Dealer Orders</summary>
`orderNo`, `supplier`, `orderDate`, `expectedDate`, `amount`, `status`
</details>

<details>
<summary>Visitors</summary>
`name`, `purpose`, `date`, `time`, `contact`, `status`
</details>

### Calculator inputs (session-only)

- GST: `gst_amt`, `gst_rate`, `gst_mode`
- TDS: `tds_section`, `tds_amt`, `tds_rate`
- Tax: `tax_income`, `tax_ded`
- Profit: `pf_cost`, `pf_sell`, `pf_qty`
- EMI: `emi_p`, `emi_r`, `emi_n`
- Loan: `ln_p`, `ln_r`, `ln_y`
- Solar ROI: `sr_cost`, `sr_size`, `sr_before`, `sr_after`, `sr_life`
- Commission: `cm_sale`, `cm_rate`, `cm_tds`
- QR: `qr_text`; scan result string

---

## 5. Buttons and Actions

| Action | Trigger | Behavior |
|--------|---------|----------|
| Navigate home | Brand click, back buttons | `go('home')` |
| Open profile | Topbar business button, quick chip | `go('profile')` |
| Open notifications | Topbar bell | `go('notifications')` |
| Open tool | Tool card | `go(toolId)` |
| Search tools | Search input | `filterTools(q)` |
| Save profile | Save button | Read fields → `kvSet('jbt:profile')` |
| Upload/remove logo | Buttons + file input | `handleLogoUpload`, `clearLogo` |
| Document: add/remove item | Buttons | `docAddItem`, `docRemoveItem` |
| Document: toggle CGST/SGST | Checkbox | `docToggleCgstSgst` |
| Document: save | Save button | Validate → persist doc + list; invoice syncs payment tracker |
| Document: print/PDF | Print button | `window.print()` after validation |
| Document: reset/new | Reset button | Confirm modal → blank state |
| Document: saved list | Saved button | `go(toolId, {view:'list'})` |
| Document: open/delete saved | List row buttons | `openSavedDoc`, `deleteSavedDoc` |
| Tracker: add | Header button | `openTrackerModal(toolId)` |
| Tracker: edit/delete | Row buttons | Modal save / `deleteTrackerRow` |
| Calculator | Input events | `*CalcUpdate()` functions |
| QR: mode switch | Generate/Scan tabs | `qrSwitchMode` |
| QR: download | Download button | Export PNG |
| QR: camera/upload | Buttons | `qrStartCamera`, `qrHandleUpload` |
| Modal OK/Cancel | Modal buttons | Confirm handlers / close |
| Toast | Auto | `toast(msg)` |

---

## 6. Modal Dialogs

| Modal | Created by | Purpose |
|-------|------------|---------|
| Generic `#jbtModal` | `showModal(opts)` | Missing fields, delete confirm, reset confirm |
| Tracker form modal | `openTrackerModal` | Add/edit tracker record (reuses `#jbtModal`) |

Modal options: `title`, `message`, `lines[]`, `confirmText`, `cancelText`, `onConfirm`.

---

## 7. Tables and Record Views

| View | Component pattern | Columns / display |
|------|-------------------|-------------------|
| Document preview table | `.doc-preview table` | #, Item, HSN, Qty, Rate, Amount + tax summary |
| Saved documents list | `.tracker-list` / `.tracker-row` | docNo, party, date, amount, status, Open/Delete |
| Tracker lists | `.tracker-list` | titleField, subtitleFields, metaFields, status pill, Edit/Delete |
| Notifications list | `.tracker-list` | Derived text, urgent/upcoming pill |
| Calculator result grids | `.result-grid` | 2×2 metric cards |

No pagination, sorting, or export in the HTML app (except print/PDF for documents and QR image download).

---

## 8. JavaScript Functions (grouped)

### Core / utils
`hasStorage`, `kvGet`, `kvSet`, `kvDelete`, `listGet`, `listUpsert`, `listDelete`, `newId`, `esc`, `fmtINR`, `todayISO`, `fmtDate`, `numberToWordsIndian`, `sanitizeFile`, `currentFYMonth`, `stateOptions`, `toast`, `showModal`, `go`, `loadProfile`, `saveProfile`, `render`, `afterRender`, `renderTopbar`, `uniqueTools`, `renderHome`, `filterTools`, `renderProfileScreen`, `handleLogoUpload`, `clearLogo`, `saveProfileForm`, `renderNotifications`, `loadNotificationsList`, `bootstrap`

### Document engine
`blankDocState`, `docComputeTotals`, `docFilename`, `docMissingFields`, `openDocumentTool`, `rerenderDocScreen`, `loadDocFromStorage`, `renderDocScreen`, `renderDocList`, `loadDocListBody`, `emptyStorageNote`, `openSavedDoc`, `deleteSavedDoc`, `renderDocEditor`, `renderDocPreviewInner`, `docUpdateTop`, `docUpdateParty`, `docUpdateItem`, `docAddItem`, `docRemoveItem`, `docToggleCgstSgst`, `docRerenderPreview`, `docSave`, `docPrint`, `docReset`, `syncInvoiceToPaymentTracker`

### Tracker engine
`openTrackerTool`, `loadTrackerList`, `trackerRowHtml`, `openTrackerModal`, `deleteTrackerRow`

### Calculators
`calcHeader`, `openGstCalc`, `gstCalcUpdate`, `openTdsCalc`, `tdsSectionChange`, `tdsCalcUpdate`, `openTaxCalc`, `slabTaxNew`, `slabTaxOld`, `taxCalcUpdate`, `openProfitCalc`, `profitCalcUpdate`, `openEmiCalc`, `emiCalcUpdate`, `openLoanCalc`, `loanCalcUpdate`, `openSolarRoiCalc`, `solarRoiUpdate`, `openCommissionCalc`, `commissionCalcUpdate`

### QR
`openQrTool`, `qrSwitchMode`, `rerenderQrScreen`, `qrGenerateHtml`, `qrGenUpdate`, `qrDownload`, `qrScanHtml`, `qrStartCamera`, `qrStopCamera`, `qrScanFound`, `qrHandleUpload`

### Config objects
`TOOL_CATALOG`, `DOCUMENT_CONFIGS`, `TRACKER_CONFIGS`, `TOOL_RENDERERS`, `TDS_SECTIONS`, `INDIAN_STATES`, `PROFILE`, `LOGO_SRC`

---

## 9. Event Handlers

| Pattern | Examples |
|---------|----------|
| `onclick` on buttons | `go()`, `docSave()`, `openTrackerModal()`, modal confirms |
| `oninput` / `onchange` on fields | Document live preview, all calculators |
| `oninput` on search | `filterTools(this.value)` |
| `onchange` on file inputs | Logo upload, QR image upload |
| `window.__jbtAfterRender` | Deferred init after `render()` (lists, calculator first run) |
| Wrapped `render` | Loads notifications when `route.screen === 'notifications'` |

No `addEventListener` usage except implicit via inline handlers.

---

## 10. localStorage / sessionStorage / Persistence

| Mechanism | Usage |
|-----------|--------|
| `localStorage` | **Not used** |
| `sessionStorage` | **Not used** |
| `window.storage` | **Authoritative** in HTML app (`get`/`set`/`delete` with JSON values) |

**Keys:**

- `jbt:profile` — business profile object
- `jbt:{tool}:list` — array of list summaries or tracker rows
- `jbt:{tool}:doc:{id}` — full document snapshots (quotation, salesorder, invoice, po)

If `window.storage` is missing, UI shows `emptyStorageNote()` (“Storage unavailable… Claude.ai”).

**Cross-tool integration:** Saving an invoice upserts a receivable into `jbt:paymenttracker:list` (`syncInvoiceToPaymentTracker`).

---

## 11. CSS Classes and Inline Styles

### CSS variables (`:root`)
`--bg-0` through `--bg-2`, glass tokens, `--accent`, `--teal`, `--grad`, text colors, `--success/warning/danger`, radius, shadows, backward-compat aliases (`--navy-*`, `--blue-*`).

### Major class groups (~80+ rules)
`app-topbar*`, `brand*`, `home-hero*`, `search-box`, `tool-grid`, `tool-card*`, `tool-header*`, `wrap-2col`, `panel*`, `field*`, `btn*`, `items-editor`, `item-row-card`, `doc-preview*`, `empty-state*`, `tracker-*`, `pill-*`, `modal-*`, `toast*`, `result-*`, `profile-hero*`, `logo-preview*`, `business-name-input`, print utilities (`no-print`).

### Inline `style=""` (~39 occurrences)
Document editor toggles, preview alignment, modal max-width, QR scan area, profile notes, flex layouts on buttons, preview table row emphasis. **Target: eliminate in Next.js refactor.**

### External scripts
- `qrcodejs` (CDN)
- `jsQR` (CDN)

### Embedded assets
- Large base64 `LOGO_SRC` in script

---

## 12. Proposed Reusable Component Mapping

```
AppShell
├── Header (brand, profile shortcut, notifications)
├── Sidebar (desktop — from navigation.config)
├── BottomNavigation (mobile)
└── PageShell

pages/
├── dashboard/          → renderHome + filterTools
├── profile/            → BusinessProfileForm, BusinessProfileCard
├── tools/              → ToolGrid, ToolCard
├── tools/[toolId]/     → ToolLayout + type-specific feature
├── subscription/       → SubscriptionPlans, UpgradeModal
├── settings/           → admin/theme (future)
└── notifications/      → derived feed list

tools/
├── DocumentToolLayout
│   ├── DocumentForm (party, dates, items editor)
│   ├── DocumentPreview (print-friendly)
│   ├── DocumentSavedList
│   └── DocumentActions (save, print, reset)
├── TrackerToolLayout
│   ├── ToolRecordTable / ToolRecordCard (responsive)
│   ├── ToolRecordForm (modal)
│   └── ToolActions
├── CalculatorToolLayout
│   ├── CalculatorForm (tool-specific fields)
│   └── CalculatorResults
└── QrToolLayout
    ├── QrGenerator
    └── QrScanner

subscription/
├── ToolUsageCounter
├── UsageLimitBanner
├── SubscriptionGate
├── UpgradeModal
└── PaymentStatus

common/
├── Button, Input, Select, Textarea, DatePicker
├── Modal, ConfirmDialog, Toast
├── DataTable, Pagination, EmptyState, LoadingSpinner, ErrorMessage
└── ExportActions (CSV/PDF/print — configurable)

hooks/
├── useBusinessProfile, useToolRecords, useSubscription, useUsageLimit
├── useModal, useToast, useDebounce, useResponsive
```

**Registry:** `tools.config.ts` maps `toolId` → `{ type, metadata, fields, validation, columns, listKey, feature module }`.

---

## 13. Proposed Data Model (per tool)

### Shared entities (MySQL + API)

```typescript
// User & tenancy (new — not in HTML)
User { id, email, ... }
BusinessProfile {
  id, userId, logoUrl, businessName, addressLine1, addressLine2,
  gstin, pan, state, stateCode, phone, email,
  bankName, bankBranch, bankAccount, bankIfsc, bankUpi, terms,
  createdAt, updatedAt
}

Subscription {
  userId, planId, status, currentPeriodStart, currentPeriodEnd,
  paymentProvider, externalSubscriptionId
}

ToolUsage {
  userId, businessProfileId, toolId, recordCount, updatedAt
}
```

### Document tools (`quotation`, `salesorder`, `invoice`, `po`)

```typescript
DocumentRecord {
  id, businessProfileId, toolId, // toolId = quotation | salesorder | invoice | po
  docNo, docDate, extraDate,
  party: { name, address, phone, gstin, state },
  items: Array<{ name, hsn, qty, unit, rate }>,
  tax: { igstPct, cgstPct, sgstPct, cgstSgstEnabled },
  notes, status,
  computed: { taxable, totalTax, grandTotal }, // server-computed
  createdAt, updatedAt
}

DocumentListItem {
  id, docNo, partyName, docDate, grandTotal, status
}
```

### Tracker tools (generic `ToolRecord`)

```typescript
ToolRecord {
  id, businessProfileId, toolId,
  data: Record<string, unknown>, // schema per TRACKER_CONFIGS fields
  createdAt, updatedAt
}
```

Field schemas align with `TRACKER_CONFIGS` keys; validation via Zod per tool in `features/tools/{toolId}/schema.ts`.

### Calculators
No `ToolRecord` persistence unless product decision adds “save calculation history.” Subscription: **0 records** or exempt from limit.

### QR tool
Ephemeral; optional future `QrHistory` if required.

### Notifications (derived, not stored)
Query aggregates:
- AMC: `renewalDate` within 30 days
- Payments: status Pending/Overdue
- Visitors: scheduled future dates
- Service tasks: incomplete with `dueDate`

---

## 14. Behavior That Must Remain Unchanged

1. **Tool inventory:** All 26 tools reachable from home; search filters by name, description, category.
2. **Business profile** auto-fills document header, bank block, terms on preview/print.
3. **Document numbering:** `PREFIX/YEAR/MONTH/1000+seq` per tool session counter.
4. **Document validation:** Business name required; party name; items with name and rate > 0.
5. **Tax math:** Line totals, CGST/SGST vs IGST toggle, Indian amount-in-words on preview.
6. **Invoice → Payment Tracker:** Saving invoice creates receivable with id `recv_{invoiceId}`, Pending status.
7. **Document list:** Open saved, delete with confirmation, empty states.
8. **Print:** Print hides chrome; preview is white/print-styled document.
9. **Tracker CRUD:** Modal add/edit with required field validation; delete with confirm; status pills with color mapping.
10. **Calculator formulas:** GST add/remove; TDS sections with preset rates; tax old vs new regime with rebate heuristics; EMI/loan amortization; solar ROI; commission with TDS.
11. **QR:** Generate from text; download PNG; camera scan + image upload via jsQR; copy scanned text.
12. **Notifications:** Same derivation rules and urgent/upcoming labeling.
13. **Greeting:** Time-based good morning/afternoon/evening on home.
14. **Storage fallback message** when backend unavailable (adapt to API error states).
15. **Visual language:** Dark glass UI, cyan accent, frosted panels (migrate to CSS variables, not pixel-identical requirement but UX parity).

---

## 15. Assumptions and Unclear Behavior

| Topic | Question / assumption |
|-------|----------------------|
| File name | `JustX_Business_Tools-4.html` not present; using `JustX_Business_Tools.html`. |
| Multi-business | HTML supports one `PROFILE`; refactor adds multiple business profiles per user — **confirm UX**. |
| Subscription on calculators | HTML does not save calculator runs; **assume calculators are not subject to 28-record limit** unless you want history saved. |
| Deleted records restore quota | **Proposed:** count current rows in DB (delete frees quota). Confirm. |
| Document `editId` flow | `openDocumentTool` with `editId` has async/load race (sets blank then loaded); preserve fix in refactor. |
| `notifications` in catalog | Opens as screen via topbar, not tool card; catalog entry may be redundant. |
| Export CSV/Excel | Not in HTML; user requirements ask for reusable export — **new feature**, define per tool. |
| Auth | HTML has no login; Next.js + Spring Boot need JWT/session — **new**. |
| `window.storage` vs MySQL | Production uses MySQL; Claude artifact storage is dev legacy only. |
| Existing `web/` app | Current Next.js has clients/invoices/tasks/expenses — **different product slice**; merge or replace? |
| Server stack | User mentions Spring Boot API; repo has Express `server/` — **confirm target backend**. |
| Admin / i18n / theme | Required in spec but absent from HTML — **new modules**, placeholder config. |
| Payment | UPI default, provider abstraction; no real payment in HTML — **implement in backend**, not client-trusted. |
| Offline / PWA | Not in HTML; Capacitor + pending sync is **new**; offline creates must not bypass server limit. |
| Category-grouped home | Catalog has categories but UI shows flat “All Tools” grid — **keep flat unless UX change requested**. |
| State code auto-fill | Profile has manual state code; no auto from state selection today. |
| Seq counter persistence | `seqCounters` is in-memory only; doc numbers reset on reload — **confirm if server should persist sequences**. |

---

## Proposed Component Tree (summary)

```
RootLayout (providers: Query, Theme, Auth, Toast)
└── AppShell
    ├── Header
    ├── Sidebar | BottomNavigation (responsive)
    └── main
        ├── DashboardPage (Hero, Search, ToolGrid)
        ├── ProfilePage (BusinessProfileForm)
        ├── NotificationsPage
        ├── ToolsIndexPage (optional alias of dashboard)
        └── ToolDetailPage [toolId]
            ├── ToolHeader + ToolUsageCounter + UsageLimitBanner
            ├── SubscriptionGate (blocks create at limit)
            └── Feature module (Document | Tracker | Calculator | QR)
```

---

## Migration Plan (phased)

### Phase 0 — Analysis (this document)
Complete. Await decisions on ambiguities.

### Phase 1 — Foundation
- Scaffold `src/` per target structure inside `web/` (keep original HTML).
- Port CSS variables → `styles/variables.css`, `globals.css` (no inline styles).
- `tools.config.ts`, `navigation.config.ts`, `subscription.config.ts`.
- App shell components (Header, Sidebar, BottomNav).
- Business profile API + MySQL schema + read/write profile.

### Phase 2 — Generic tool framework
- `ToolLayout`, `ToolRecordTable`, `ToolRecordForm`, modals, toast.
- Tracker tools: config-driven CRUD against API.
- Usage counter + client-side gate (28 records).

### Phase 3 — Document tools
- Document editor, preview, print CSS, saved list.
- Invoice → payment tracker sync on server.

### Phase 4 — Calculators & QR
- Port calculation logic to shared `lib/calculators/*`.
- QR with dynamic import of qrcode/jsQR; Capacitor camera permissions.

### Phase 5 — Subscription & backend enforcement
- Express API: atomic create with `FREE_LIMIT_REACHED`.
- Payment provider abstraction, webhook placeholder.
- Subscription activation without client trust.

### Phase 6 — Admin, PWA, Capacitor, tests
- PWA manifest/service worker.
- Capacitor Android project + safe-area/back button.
- Unit tests (limits, validation), component tests, E2E plan execution.

### Phase 7 — Polish
- Notifications derived endpoint.
- Export pipeline.
- i18n scaffolding.

---

## Existing Repo Context

| Path | Status |
|------|--------|
| `JustX_Business_Tools.html` | Full JBT monolith (source of truth) |
| `web/` | Next.js App Router stub: dashboard, clients, invoices, tasks, expenses |
| `server/` | Express + MySQL: clients, invoices, tasks, expenses, stats |
| `mysql/` | Docker / setup scripts |

**Recommendation:** Extend `web/` with JBT structure; evolve `server/` or add Spring Boot service per your direction; map legacy Express routes only if still needed.

---

## Subscription Rule Mapping (28 records)

| Tool type | Counted records |
|-----------|-----------------|
| Document tools | Each saved document = 1 record |
| Tracker tools | Each list row = 1 record |
| Calculators | 0 (unless history added) |
| QR | 0 |

**Client:** `useUsageLimit` + `ToolUsageCounter` + warnings at 24, block at 28, upgrade modal.

**Server:** `INSERT` with `SELECT COUNT(*) ... FOR UPDATE` or equivalent; return `FREE_LIMIT_REACHED`.

---

---

## 16. Confirmed Decisions (Aug 2026)

| Topic | Decision |
|-------|----------|
| Backend | **Express** (`server/`) — no Spring Boot |
| Multi-business profiles | **Single profile** per user, matching HTML `PROFILE` |
| Calculators & 28-record limit | **Exempt** from quota (`subscriptionExempt: true` in registry); optional future usage telemetry without blocking |
| Delete restores quota | **Yes** — count current DB rows; supplement with `tool_usage` cache table updated on create/delete for fast reads |
| Document number sequences | **Server-persisted** per tool: `PREFIX/YEAR/MONTH/1000+n` via `document_sequences` table with atomic increment |
| Legacy `web/clients/invoices/tasks` | **Replace** with JBT App Router structure; legacy Express routes remain but UI migrates to JBT tools |
| Export CSV/Excel | **All applicable tools** (documents, trackers with tables) — Phase 7 pipeline |
| Home categories | **Category-grouped** home when not searching; flat filtered grid when searching |

### Document sequence tools (server analysis)

| Tool ID | Prefix | Pattern example |
|---------|--------|-----------------|
| `quotation` | QTN | QTN/2026/03/1001 |
| `salesorder` | SO | SO/2026/03/1001 |
| `invoice` | INV | INV/2026/03/1001 |
| `po` | PO | PO/2026/03/1001 |

Trackers use client-generated string IDs (HTML `newId()`); no doc-no sequence.

### Quota counting

| Tool type | Counted toward 28 |
|-----------|-------------------|
| Document (4) | Yes — each saved document |
| Tracker (12) | Yes — each list row |
| Calculator (8) | No — exempt |
| QR, Notifications screen | No |

---

*Phase 0 complete. Phase 1 implementation in progress.*
