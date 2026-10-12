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
| Auditing | `audit` | Issues, ledgers, GST reconciliation, bank import & matching, documents |
| | `excise` | Liquor excise register (shown when the business type needs it) |
| System | `integrations` | Tally (XML export / sync) and POS connectors with sync log |
| | `connect` | Import from other JBT tools (see below) |
| | `helpdesk` | Support tickets and FAQ |
| | `settings` | Business, taxonomy, reminders, roles matrix, team |

Stock only changes through movements (`ims_movements`), posted inside a
transaction with the item row locked. Document numbers come from
`ims_sequences` per fiscal year, e.g. `PO/26-27/0007`.

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
