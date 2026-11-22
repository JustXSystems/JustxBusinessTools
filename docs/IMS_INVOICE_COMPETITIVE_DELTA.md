# IMS Invoice Management — Competitive Delta

Research date: 2026-11-22  
Benchmarks: **Zoho Books**, **SAP Business One (India)**, **TallyPrime**, **QuickBooks**, **FreshBooks**.

This document is the living backlog for making Justx IMS invoice management a corporate-standard, futuristic OOTB suite. Features are scored by competitive gap × India dealer/distributor value × architecture fit.

## What IMS already has (baseline)

| Capability | Status |
|---|---|
| GST tax invoices (CGST/SGST · IGST by place of supply) | ✅ |
| Draft → Issue → Cancel; duplicate | ✅ |
| Line discounts, round-off, free-text lines | ✅ |
| Partial payments, void receipt, AR aging | ✅ |
| Payment reminders (WA / SMS / email), promises, disputes | ✅ |
| Credit-limit warning at compose | ✅ |
| POS counter | ✅ |
| Quotation / BOM → invoice; DC-linked stock | ✅ |
| Tally XML export + CN/DN import as returns | ✅ |
| WhatsApp share + print paper | ✅ |
| HSN summary on paper | ✅ |
| Account manager from party | ✅ |

## Competitive feature matrix (delta)

Legend: ❌ missing · 🟡 partial / import-only · ✅ present · ★ Wave priority

| # | Feature | Zoho | SAP B1 | Tally | QB / FB | IMS today | Priority | Wave |
|---|---|---|---|---|---|---|---|---|
| 1 | **Ship-to ≠ Bill-to** on invoice | ✅ | ✅ | ✅ | ✅ | ❌ (DC only) | P0 | **1** |
| 2 | **Customer PO / order ref** | ✅ | ✅ | ✅ | ✅ | ❌ | P0 | **1** |
| 3 | **UPI / payment QR on invoice** | ✅ | 🟡 | ✅ | ✅ | ❌ | P0 | **1** |
| 4 | **Native Credit Notes** (apply to invoice) | ✅ | ✅ | ✅ | ✅ | 🟡 Tally→returns | P0 | **1** |
| 5 | **Native Debit Notes** | ✅ | ✅ | ✅ | ✅ | 🟡 | P1 | 2 |
| 6 | **Doc kinds**: Tax / Proforma / CN / DN | ✅ | ✅ | ✅ | ✅ | ❌ | P0 | **1** |
| 7 | **E-Invoice IRN + signed QR** (IRP) | ✅ | ✅ | ✅ | — | ❌ | P0 | 2 |
| 8 | **E-Way Bill** | ✅ | ✅ | ✅ | — | ❌ | P0 | 2 |
| 9 | **Recurring invoices** | ✅ | 🟡 | 🟡 | ✅ | ❌ | P1 | 2 |
| 10 | **Retainer / advance invoices** | ✅ | 🟡 | 🟡 | ✅ | 🟡 on-account | P1 | 3 |
| 11 | **Progress / milestone invoicing** | ✅ | ✅ | ❌ | 🟡 | ❌ | P1 | 3 |
| 12 | **Payment retention** | ✅ | ✅ | ❌ | 🟡 | ❌ | P2 | 3 |
| 13 | **Sales Orders** → DC → Invoice chain | ✅ | ✅ | ✅ | 🟡 | 🟡 BOM/DC only | P1 | 2 |
| 14 | **Partial invoice from order/DC** | ✅ | ✅ | ✅ | 🟡 | 🟡 DC link | P1 | 2 |
| 15 | **Invoice approval workflow** | ✅ | ✅ | ❌ | 🟡 | ❌ (PO/bills only) | P1 | 2 |
| 16 | **Shipping charges + GST** | ✅ | ✅ | ✅ | ✅ | ❌ | P1 | 2 |
| 17 | **Price lists / customer levels** | ✅ | ✅ | ✅ | ✅ | 🟡 rate cards (BOM) | P1 | 3 |
| 18 | **Multi-currency + forex** | ✅ | ✅ | ✅ | ✅ | ❌ | P2 | 4 |
| 19 | **Email invoice + payment link** | ✅ | ✅ | 🟡 | ✅ | 🟡 WhatsApp | P1 | 2 |
| 20 | **Customer portal** | ✅ | 🟡 | ❌ | ✅ | ❌ | P2 | 4 |
| 21 | **Invoice templates / branding packs** | ✅ | 🟡 | ✅ | ✅ | 🟡 shared paper | P2 | 3 |
| 22 | **Attachments on invoice** | ✅ | ✅ | ❌ | ✅ | ❌ | P2 | 3 |
| 23 | **Salesperson override** | ✅ | ✅ | ✅ | ✅ | 🟡 from party only | P2 | 2 |
| 24 | **Actual vs billed qty / free samples** | ❌ | 🟡 | ✅ | ❌ | ❌ | P2 | 3 |
| 25 | **Bulk send / bulk IRP push** | ✅ | ✅ | ✅ | 🟡 | ❌ | P1 | 2 |
| 26 | **Apply CN automatically to open invoices** | ✅ | ✅ | ✅ | ✅ | ❌ | P0 | **1** |
| 27 | **Journal / GL preview of invoice** | ✅ | ✅ | ✅ | ✅ | 🟡 books view | P2 | 3 |
| 28 | **Multi-GSTIN / branch series** | ✅ | ✅ | ✅ | — | ❌ | P1 | 3 |
| 29 | **Scheduled send** | ✅ | ❌ | ❌ | ✅ | ❌ | P2 | 4 |
| 30 | **Custom fields** | ✅ | ✅ | 🟡 | ✅ | ❌ | P2 | 4 |

## Wave-1 architecture (this cycle)

Corporate-standard **document model** under `ims_invoices`:

```
doc_kind ∈ { tax_invoice | proforma | credit_note | debit_note }
against_invoice_id → original tax invoice (CN/DN)
ship_to_* · customer_po_no
einv_* · eway_* (stubs ready for IRP connectors)
credit_applied on tax invoices
```

Settings gains: `bank_upi`, bank account block, `cn_prefix` / `dn_prefix` / `proforma_prefix`.

OOTB UI components:

- Ship-to composer block (mirrors DocumentPaper `shipTo`)
- Payment QR strip on issued tax invoices
- Credit Note action on issued invoices → draft CN → issue applies credit
- Sales list filter by document kind
- E-Invoice status chip (Not applicable / Yet to push / …)

## Wave-2+ (next cycles)

1. IRP push adapter (GSP-ready JSON + status machine) + e-Way Bill
2. Recurring invoice profiles + scheduler job
3. Sales Order module (SO → DC → Invoice) with partial billing
4. Invoice approval (reuse Approvals queues)
5. Email + hosted payment link
6. Shipping charges in totals engine
7. Retainer + progress + retention
8. Multi-GSTIN series + price lists
9. Customer portal + multi-currency

## Design principles

1. **One totals engine** — extend `computeTotals` / `invoiceBalance`; never fork GST math.
2. **DocumentPaper OOTB** — every doc kind prints through the shared paper; title/stamp vary by `doc_kind`.
3. **Stock ownership stays explicit** — invoice / DC / CN declare who posts stock.
4. **Compliance fields first-class** — IRN/QR/e-Way columns exist before connectors so UI never rewrites.
5. **Additive migrations only** — default `doc_kind = tax_invoice` keeps all existing tenants green.
6. **Test → fix → push** each wave; E2E catalogue gains scenarios as features land.

## Acceptance for Wave 1

- [x] Ship-to prints when set; blank ship-to hides block
- [x] Customer PO appears in paper meta
- [x] Settings UPI → QR on issued tax invoice when balance > 0
- [x] Create Credit Note from issued invoice; issue applies to AR balance
- [x] Proforma can be saved/issued without stock or AR impact
- [x] KPI / outstanding queries exclude CN / DN / proforma sales inflation
- [x] Unit tests for balance + credit application; smoke E2E still green

## Wave 2 progress

- [x] e-Invoice status on issue (`yet_to_push` for B2B)
- [x] Associate IRN / Ack / e-Way from portal (manual) + mark cancelled
- [ ] Live IRP/GSP push adapter
- [ ] Shipping charges + GST in totals engine
- [ ] Recurring invoice profiles
- [ ] Sales Order → DC → Invoice
- [ ] Invoice approval queue
