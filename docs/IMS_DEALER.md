# Justx IMS — Dealer

Inventory, purchasing, GST sales, receivables, payables, field ops and audit for
dealers and distributors. Built on the BOS kit with the IMS skin
(see [IMS_THEME.md](IMS_THEME.md)).

| Where | How |
|---|---|
| Inside JBT | `/tools/imsdealer` (tool id `imsdealer`, opt-in: Admin → Tools → Visible on home → Live) |
| Full screen | `/ims` (signs in with the JBT login, `?next=/ims`) |
| API | `/api/ims/*` |
| Schema | `mysql/migrations/028_ims_core.sql` + `029`–`032` (all tables prefixed `ims_`) |

Deep links: `?m=<module>&open=<id>`, e.g. `/tools/imsdealer?m=purchase&open=<poId>`.

## Tenancy and access

Every row carries `tenant_id` = the JBT business profile, so IMS shares one
company with Quotation, BOS and the other tools.

IMS has its own roles (`ims_members`), separate from JBT roles:

| Role | Typical use |
|---|---|
| owner | Everything, including settings and team |
| manager | Day-to-day operations and approvals |
| incharge | Store in-charge: stock in/out, checks, returns |
| staff | Counter / warehouse entries |
| accountant | Sales, receivables, payables, closing |
| auditor | Read-only books plus the audit workspace |
| field | Onsite track only |
| viewer | Read-only |

Permissions are a matrix (Settings → Roles) over: `stockIn, stockOut, damage,
stockCheck, items, suppliers, po, approvals, sales, receivables, payables,
closing, field, reports, integrations, audit, settings`. Owners always have
every permission. Non-GET requests need a write role.

## Modules

| Section | Module (`?m=`) | Highlights |
|---|---|---|
| Inventory | `dashboard` | KPIs, stock value, aging, attention list, recent activity |
| | `stockin`, `stockout` | Batch entries by search or barcode, party, reference; insufficient-stock guard |
| | `stock` | Full stock with status/aging filters, export |
| | `checks` | Cycle counts: draft → submit → approve posts adjustments |
| | `lowstock` | Grouped by supplier; one click drafts a reorder PO |
| | `items` | Catalog, bulk import/export (CSV/XLSX), labels, item detail with movements |
| | `returns` | Customer/supplier returns, damage quarantine, restore, refunds |
| | `scanner` | Camera / keyboard-wedge barcode lookup and quick entry |
| | `history` | Movement journal with period, type and party filters |
| Purchasing | `parties` | Suppliers and customers, statements, bulk import |
| | `purchase` | POs: draft → approval (limit in settings) → sent → receive (partial) → bill |
| | `approvals` | PO and bill approvals queue |
| Sales & Finance | `sales` | GST invoices (CGST/SGST or IGST by place of supply), POS quick sale, print |
| | `receivables` | Aging, priorities, reminders (WhatsApp/SMS/email templates), promises, disputes |
| | `payables` | Bills, approvals, holds, scheduled payment runs |
| | `ledger` | Party ledger and statements, manual entries, expenses |
| | `closing` | Daily cash closing with expected vs counted cash, reopen |
| Operations | `field` | Check-in/out with GPS, live pings, tasks, travel distance |
| Insights | `reports` | Report builder, saved reports with submit/approve, scheduled sends |
| | `gst` | GSTR summary, HSN summary, item GST sanity check |
| Auditing | `audit` | Issues, ledgers, financial statements (trial balance, P&L, balance sheet, day book built as double-entry vouchers from IMS records), GST reconciliation incl. GSTR-2B upload matching, document trail per invoice / bill / PO / payment / expense, bank import & matching, documents, Ask Audit AI |
| | `excise` | Liquor excise register (shown when the business type needs it) |
| System | `integrations` | Tally (XML export / sync: masters, sales, purchases, credit / debit notes from returns, receipts / payments against Cash or Bank Account) and POS connectors with sync log |
| | `connect` | Import from other JBT tools (see below) |
| | `helpdesk` | Support tickets and FAQ |
| | `settings` | Business, taxonomy, reminders, roles matrix, team |

Stock only changes through movements (`ims_movements`), posted inside a
transaction with the item row locked. Document numbers come from
`ims_sequences` per fiscal year, e.g. `PO/26-27/0007`.

## Document trail and GSTR-2B

Both features are read-only and add no tables.

- **Document trail.** `GET /api/ims/audit/trace/:type/:id` covers invoices,
  bills, POs, payments and expenses. It follows the record through each step
  (source → order → goods receipt → bill / invoice → approval → payment →
  bank match → returns → GST → documents → Tally). Each step is marked in
  order, needs a look, problem, or not applicable. The response also includes
  the record's activity and its audit findings. Open it with **Trace** on
  Findings, Ask Audit AI or GSTR-2B rows.
- **GSTR-2B.** Auditing → GST → GSTR-2B reconciliation. The browser reads the
  portal's JSON, its Excel (B2B sheet) or a CSV, then posts one row per
  invoice to `POST /api/ims/audit/gstr2b`. Rows are matched to bills by
  supplier GSTIN and normalised invoice number. When the number doesn't match,
  matching falls back to GSTIN + amount + date within 5 days. Results:
  matched, differs, not in 2B (credit at risk) and not in books. Nothing is
  stored. Matching covers one return month: the month stated in the file
  (JSON `rtnprd`, or the Excel "Tax period") or the month picked on the card,
  so other months' bills are not reported as missing. Invoices the portal marks
  as "ITC not available" show as differs and count as credit at risk.

The sidebar shows a count on each module that has open alerts.

## Ask AI

Read-only. The topbar **Ask AI** button appears on dashboard, stock, lowstock,
items, history, purchase, parties, receivables, payables and reports.
`POST /api/ims/assistant/ask` answers the suggested questions from live tenant
data and returns a compact data summary. Receivables, payables and PO data are
included only when the user's role has that permission.

In **Auditing / CA → Ask Audit AI**, `GET /api/ims/audit/ask?q=` maps the
question (category, amount, age, document number) onto the audit rule
engine's open findings, with links to each record.

Gemini is optional and per user. The user's own key is stored only in that
browser's localStorage (`justx.ims.gemini.v1`). The browser calls
`generativelanguage.googleapis.com` directly with the question and the data
summary. The server never sees or stores the key. Without a key, only the
built-in answers are used.

## Field map

Onsite Track's team map and day trail use the source chosen in
**Settings → Field map** (`GET /api/ims/settings/map` for every IMS user,
`PUT` needs the settings permission). It is stored as the `map` row of
`ims_integrations`, so there is no schema change.

| Source | Outside requests | Notes |
|---|---|---|
| Built-in (default) | None | Positions, trails and a scale drawn in the browser. No street layer; Google Maps links for streets. |
| Tile server | The tile host | Raster `{z}/{x}/{y}` URL: OpenStreetMap public servers (light use only), a provider such as Mappls, Ola Maps or MapTiler with a browser key restricted to the site, or the business's own tile server. |
| Self-hosted PMTiles | Your own server only | One `.pmtiles` file (e.g. an India extract of a Protomaps build) drawn with protomaps-leaflet. The host must answer HTTP range requests (206) and allow CORS for the site if it's on another domain. |

URLs must be `https://` or a path on the same site. A data credit is required
for tile and PMTiles sources, and is shown on the map. Leaflet and
protomaps-leaflet load only when a tile source is switched on. If tiles fail
to load, the built-in map is shown instead. **Test and preview** checks a
sample tile, or the PMTiles header and range support, before saving.

## Working with other JBT tools

All exchange stays inside the same business profile.

- **Quotation → IMS.** The Quotation V1 document source lists quotations;
  Connect imports one as a draft IMS invoice (and creates the customer party
  when missing). `ims_links` records the mapping, so re-importing returns the
  existing invoice instead of a duplicate.
- **BOS → IMS.** The BOS catalog source (`server/src/ims/sources/bos-catalog.ts`)
  exposes BOS items and parties; Connect imports them into the IMS catalog and
  party list.
- **IMS → BOS.** The BOS connector `server/src/bos/connectors/ims-dealer.ts`
  exposes issued IMS invoices to BOS, which can import them like Quotation
  documents.
- **Audit and notifications.** IMS events are written to `ims_events` and to
  the host audit log and notification feed.

## Extending

The router is built from a host adapter, so it can be mounted in another app:

```ts
createImsRouter({ db, host, sources: [quotationV1Connector(pool)], catalogs: [bosCatalogSource(pool)] });
```

- **New document source** (another tool's documents → IMS invoices): implement
  `ImsDocumentSource` in `server/src/ims/sources/types.ts` and add it to
  `sources` in `server/src/routes/ims.ts`. BOS connectors already match the
  shape.
- **New catalog source** (items/parties): implement `ImsCatalogSource` and add
  it to `catalogs`.
- **New module:** add a route file registered in `server/src/ims/index.ts`, a
  client in `web/lib/ims/`, and an entry in `IMS_MODULES`
  (`web/components/ims/modules.tsx`). The sidebar, command palette, More
  actions and deep links pick it up from the registry.

## Errors

| Code | HTTP | Meaning |
|---|---|---|
| `IMS_SCHEMA_PENDING` | 503 | Migrations 028+ not applied yet |
| `IMS_NOT_ENABLED` | 403 | Tool not enabled for this business profile |
| `IMS_INSUFFICIENT_STOCK` | 409 | Movement would make stock negative (unless allowed in settings) |
| duplicate entry | 409 | Unique SKU / document number clash |
