# IMS Invoice Management — Competitive Delta

Research date: 2026-11-22 (pass 2)  
Benchmarks: **Zoho Books**, **SAP Business One (India / FP2608)**, **TallyPrime**, **QuickBooks**, **FreshBooks**.

Living backlog for corporate-standard IMS invoicing. Score = competitive gap × India dealer value × architecture fit.

## IMS baseline (shipped through Wave 3a)

| Capability | Status |
|---|---|
| GST tax invoices (CGST/SGST · IGST) | ✅ |
| Draft → Issue → Cancel; duplicate | ✅ |
| Ship-to ≠ Bill-to · Customer PO | ✅ |
| Proforma · Credit note · Debit note | ✅ |
| CN applies to AR; convert proforma → tax draft | ✅ |
| Shipping charges + GST | ✅ |
| Payment retention % (withheld from balance) | ✅ |
| Salesperson override | ✅ |
| Recurring profiles + run / tick | ✅ |
| UPI payment QR on paper | ✅ |
| e-Invoice IRN associate / mark cancelled | ✅ |
| Partial payments, AR aging, reminders, promises | ✅ |
| POS · Quotation/BOM → invoice · DC-linked stock | ✅ |
| Tally XML + CN/DN import | ✅ |

## Competitive feature matrix

Legend: ❌ missing · 🟡 partial · ✅ present

| # | Feature | Zoho | SAP B1 | Tally | QB/FB | IMS | Pri | Wave |
|---|---|---|---|---|---|---|---|---|
| 1 | Ship-to ≠ Bill-to | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 2 | Customer PO / order ref | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 3 | UPI / payment QR | ✅ | 🟡 | ✅ | ✅ | ✅ | P0 | 1 |
| 4 | Native Credit Notes | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 5 | Native Debit Notes | ✅ | ✅ | ✅ | ✅ | ✅ | P1 | 3 |
| 6 | Doc kinds Tax/PF/CN/DN | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 7 | E-Invoice IRN + signed QR | ✅ | ✅ | ✅ | — | 🟡 manual IRN | P0 | 2 |
| 8 | E-Way Bill | ✅ | ✅ | ✅ | — | 🟡 field only | P0 | 2 |
| 9 | Recurring invoices | ✅ | 🟡 | 🟡 | ✅ | ✅ | P1 | 3 |
| 10 | Retainer / advance invoices | ✅ | ✅ A/R DP | 🟡 | ✅ | 🟡 on-account | P1 | 4 |
| 11 | Progress / milestone invoicing | ✅ | ✅ | ❌ | 🟡 | ❌ | P1 | 4 |
| 12 | Payment retention | ✅ | ✅ | ❌ | 🟡 | ✅ | P1 | 3 |
| 13 | Sales Orders → DC → Invoice | ✅ | ✅ | ✅ | 🟡 | 🟡 BOM/DC | P1 | 4 |
| 14 | Partial invoice from order/DC | ✅ | ✅ | ✅ | 🟡 | 🟡 DC link | P1 | 4 |
| 15 | Invoice approval workflow | ✅ | ✅ | ❌ | 🟡 | ❌ | P1 | 4 |
| 16 | Shipping charges + GST | ✅ | ✅ | ✅ | ✅ | ✅ | P1 | 2 |
| 17 | Price lists / customer levels | ✅ | ✅ | ✅ | ✅ | 🟡 BOM rate cards | P1 | 4 |
| 18 | Multi-currency + forex | ✅ | ✅ | ✅ | ✅ | ❌ | P2 | 5 |
| 19 | Email invoice + payment link | ✅ | ✅ | 🟡 | ✅ | 🟡 WhatsApp | P1 | 4 |
| 20 | Customer portal | ✅ | 🟡 | ❌ | ✅ | ❌ | P2 | 5 |
| 21 | Invoice templates / branding | ✅ | 🟡 | ✅ | ✅ | 🟡 DocumentPaper | P2 | 4 |
| 22 | Attachments on invoice | ✅ | ✅ | ❌ | ✅ | ❌ | P2 | 4 |
| 23 | Salesperson override | ✅ | ✅ | ✅ | ✅ | ✅ | P2 | 3 |
| 24 | Actual vs billed qty / free qty | ❌ | 🟡 | ✅ | ❌ | ❌ | P2 | 4 |
| 25 | Bulk send / bulk IRP push | ✅ | ✅ Doc Gen Wizard | ✅ | 🟡 | ❌ | P1 | 4 |
| 26 | Apply CN to open invoices | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 27 | Journal / GL preview | ✅ | ✅ | ✅ | ✅ | 🟡 books | P2 | 4 |
| 28 | Multi-GSTIN / branch series | ✅ | ✅ | ✅ | — | ❌ | P1 | 5 |
| 29 | Scheduled send | ✅ | ❌ | ❌ | ✅ | ❌ | P2 | 5 |
| 30 | Custom fields | ✅ | ✅ UDF | 🟡 | ✅ | ❌ | P2 | 5 |
| 31 | **Dunning wizard / letters** | 🟡 reminders | ✅ | 🟡 | 🟡 | 🟡 AR reminders | P1 | 4 |
| 32 | **Down-payment / deposit invoice** | ✅ retainer | ✅ A/R DP | 🟡 | ✅ | ❌ | P1 | 4 |
| 33 | **Installment payment plans** | 🟡 | ✅ | ❌ | 🟡 | ❌ | P2 | 5 |
| 34 | **Document generation wizard** (batch invoice from deliveries) | 🟡 | ✅ | 🟡 | ❌ | ❌ | P1 | 4 |
| 35 | **Packing slip from SO** | 🟡 | ✅ | 🟡 | ❌ | 🟡 DC | P2 | 4 |
| 36 | **Reserve invoice** | ❌ | ✅ | ❌ | ❌ | ❌ | P2 | 5 |
| 37 | **Batch print / PDF pack** | ✅ | ✅ | ✅ | ✅ | ❌ | P2 | 4 |
| 38 | **Invoice from timesheet / project** | ✅ | 🟡 | ❌ | ✅ | ❌ | P2 | 5 |
| 39 | **Split payment on create** | ✅ | ✅ | ✅ | ✅ | 🟡 POS | P2 | 4 |
| 40 | **MSME UDYAM on invoice** | 🟡 | ❌ | ✅ | — | ❌ | P2 | 4 |
| 41 | **Godown / warehouse on line** | 🟡 | ✅ | ✅ | ❌ | 🟡 stock loc | P2 | 4 |
| 42 | **Auto-charge cards on recurring** | ✅ | ❌ | ❌ | ✅ | ❌ | P2 | 5 |
| 43 | **Progress from quote % / amount** | ✅ | 🟡 | ❌ | 🟡 | ❌ | P1 | 4 |
| 44 | **Open amount columns in lists** | ✅ | ✅ | ✅ | ✅ | ✅ balance | P2 | — |
| 45 | **Convert estimate → SO → invoice** | ✅ | ✅ | ✅ | ✅ | 🟡 quote→inv | P1 | 4 |

## Architecture notes (OOTB)

```
ims_invoices.doc_kind ∈ { tax_invoice | proforma | credit_note | debit_note }
ims_recurring_invoices → generates tax invoices (source_tool=recurring)
retention_pct / retention_amount → withheld from invoiceBalance
shipping_* + withShippingTotals()
einv_* / eway_* → IRP-ready stubs + manual associate
```

Shared UI: `DocumentPaper`, `LineEditor`, `InvoicePaper`, Sales SubTabs (`Invoices` · `Recurring` · `POS`).

## Next waves

1. **4** — Sales Order module; retainer/down-payment; progress from quote; invoice approval; email + payment link; dunning letters; batch IRP; document gen wizard  
2. **5** — Live GSP push; multi-GSTIN; customer portal; multi-currency; custom fields; auto-charge

## Migrations

- `053_ims_invoice_corporate.sql` — doc kinds, ship-to, UPI settings, e-Invoice stubs  
- `054_ims_invoice_shipping.sql` — shipping GST  
- `055_ims_recurring_invoices.sql` — recurring profiles + retention + recurring_id  

## Acceptance (Wave 3a)

- [x] Recurring tab: create profile, Run now, Process due  
- [x] Salesperson picker on invoice editor  
- [x] Retention % reduces collectible balance  
- [x] Debit note from issued tax invoice  
- [x] Convert proforma → tax invoice draft  
- [x] Unit tests: advanceRecurringDate, retention balance  
