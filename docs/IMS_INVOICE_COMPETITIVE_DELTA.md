# IMS Invoice Management — Competitive Delta

Research date: 2026-11-22 (pass 4 / Wave 5)  
Benchmarks: **Zoho Books**, **SAP Business One (India / FP2608)**, **TallyPrime**, **QuickBooks**, **FreshBooks**.

Living backlog for corporate-standard IMS invoicing. Score = competitive gap × India dealer value × architecture fit.

## IMS baseline (shipped through Wave 5a/b)

| Capability | Status |
|---|---|
| GST tax invoices (CGST/SGST · IGST) | ✅ |
| Draft → Issue → Cancel; duplicate | ✅ |
| Ship-to ≠ Bill-to · Customer PO | ✅ |
| Proforma · Credit note · Debit note · Retainer | ✅ |
| CN applies to AR; convert proforma → tax draft | ✅ |
| Shipping charges + GST | ✅ |
| Payment retention % (withheld from balance) | ✅ |
| Salesperson override | ✅ |
| Recurring profiles + run / tick | ✅ |
| Invoice approval queue (threshold + Approvals tab) | ✅ |
| Retainer / advance apply to tax invoice | ✅ |
| Email share (mailto) + WhatsApp | ✅ |
| Invoice attachments (PDF / image / office) | ✅ |
| MSME / UDYAM on invoice paper | ✅ |
| Progress % + milestone label on invoice | ✅ |
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
| 6 | Doc kinds Tax/PF/CN/DN/RA | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1–4 |
| 7 | E-Invoice IRN + signed QR | ✅ | ✅ | ✅ | — | 🟡 manual IRN | P0 | 2 |
| 8 | E-Way Bill | ✅ | ✅ | ✅ | — | 🟡 field only | P0 | 2 |
| 9 | Recurring invoices | ✅ | 🟡 | 🟡 | ✅ | ✅ | P1 | 3 |
| 10 | Retainer / advance invoices | ✅ | ✅ A/R DP | 🟡 | ✅ | ✅ | P1 | 4 |
| 11 | Progress / milestone invoicing | ✅ | ✅ | ❌ | 🟡 | 🟡 % + label | P1 | 5 |
| 12 | Payment retention | ✅ | ✅ | ❌ | 🟡 | ✅ | P1 | 3 |
| 13 | Sales Orders → DC → Invoice | ✅ | ✅ | ✅ | 🟡 | 🟡 BOM/DC | P1 | 5 |
| 14 | Partial invoice from order/DC | ✅ | ✅ | ✅ | 🟡 | 🟡 DC link | P1 | 5 |
| 15 | Invoice approval workflow | ✅ | ✅ | ❌ | 🟡 | ✅ | P1 | 4 |
| 16 | Shipping charges + GST | ✅ | ✅ | ✅ | ✅ | ✅ | P1 | 2 |
| 17 | Price lists / customer levels | ✅ | ✅ | ✅ | ✅ | 🟡 BOM rate cards | P1 | 5 |
| 18 | Multi-currency + forex | ✅ | ✅ | ✅ | ✅ | ❌ | P2 | 6 |
| 19 | Email invoice + payment link | ✅ | ✅ | 🟡 | ✅ | 🟡 mailto | P1 | 4 |
| 20 | Customer portal | ✅ | 🟡 | ❌ | ✅ | ❌ | P2 | 6 |
| 21 | Invoice templates / branding | ✅ | 🟡 | ✅ | ✅ | 🟡 DocumentPaper | P2 | 5 |
| 22 | Attachments on invoice | ✅ | ✅ | ❌ | ✅ | ✅ | P2 | 5 |
| 23 | Salesperson override | ✅ | ✅ | ✅ | ✅ | ✅ | P2 | 3 |
| 24 | Actual vs billed qty / free qty | ❌ | 🟡 | ✅ | ❌ | ❌ | P2 | 5 |
| 25 | Bulk send / bulk IRP push | ✅ | ✅ Doc Gen Wizard | ✅ | 🟡 | ❌ | P1 | 5 |
| 26 | Apply CN to open invoices | ✅ | ✅ | ✅ | ✅ | ✅ | P0 | 1 |
| 27 | Journal / GL preview | ✅ | ✅ | ✅ | ✅ | 🟡 books | P2 | 5 |
| 28 | Multi-GSTIN / branch series | ✅ | ✅ | ✅ | — | ❌ | P1 | 6 |
| 29 | Scheduled send | ✅ | ❌ | ❌ | ✅ | ❌ | P2 | 6 |
| 30 | Custom fields | ✅ | ✅ UDF | 🟡 | ✅ | ❌ | P2 | 6 |
| 31 | **Dunning wizard / letters** | 🟡 reminders | ✅ | 🟡 | 🟡 | 🟡 print letter | P1 | 5 |
| 32 | **Down-payment / deposit invoice** | ✅ retainer | ✅ A/R DP | 🟡 | ✅ | ✅ retainer | P1 | 4 |
| 33 | **Installment payment plans** | 🟡 | ✅ | ❌ | 🟡 | ❌ | P2 | 6 |
| 34 | **Document generation wizard** (batch invoice from deliveries) | 🟡 | ✅ | 🟡 | ❌ | ❌ | P1 | 5 |
| 35 | **Packing slip from SO** | 🟡 | ✅ | 🟡 | ❌ | 🟡 DC | P2 | 5 |
| 36 | **Reserve invoice** | ❌ | ✅ | ❌ | ❌ | ❌ | P2 | 6 |
| 37 | **Batch print / PDF pack** | ✅ | ✅ | ✅ | ✅ | 🟡 print pack | P2 | 5 |
| 38 | **Invoice from timesheet / project** | ✅ | 🟡 | ❌ | ✅ | ❌ | P2 | 6 |
| 39 | **Split payment on create** | ✅ | ✅ | ✅ | ✅ | 🟡 POS | P2 | 5 |
| 40 | **MSME UDYAM on invoice** | 🟡 | ❌ | ✅ | — | ✅ | P2 | 5 |
| 41 | **Godown / warehouse on line** | 🟡 | ✅ | ✅ | ❌ | 🟡 stock loc | P2 | 5 |
| 42 | **Auto-charge cards on recurring** | ✅ | ❌ | ❌ | ✅ | ❌ | P2 | 6 |
| 43 | **Progress from quote % / amount** | ✅ | 🟡 | ❌ | 🟡 | ❌ | P1 | 5 |
| 44 | **Open amount columns in lists** | ✅ | ✅ | ✅ | ✅ | ✅ balance | P2 | — |
| 45 | **Convert estimate → SO → invoice** | ✅ | ✅ | ✅ | ✅ | 🟡 quote→inv | P1 | 5 |

## Architecture notes (OOTB)

```
ims_invoices.doc_kind ∈ { tax_invoice | proforma | credit_note | debit_note | retainer }
ims_invoices.status ∈ { draft | pending_approval | issued | cancelled }
invoice_approval_limit → Save & issue queues Approvals when ≥ limit
advance_applied on tax invoice; retainer credit_applied tracks consumed advance
ims_recurring_invoices → generates tax invoices (source_tool=recurring)
retention_pct / retention_amount → withheld from invoiceBalance
shipping_* + withShippingTotals()
einv_* / eway_* → IRP-ready stubs + manual associate
```

Shared UI: `DocumentPaper`, `LineEditor`, `InvoicePaper`, Sales SubTabs (`Invoices` · `Recurring` · `POS`), Approvals `Invoices` queue.

## Next waves

1. **5** — Sales Order module; progress from quote; live GSP / batch IRP; dunning letters; document gen wizard; attachments; price lists  
2. **6** — Multi-GSTIN; customer portal; multi-currency; custom fields; auto-charge; installments

## Migrations

- `053_ims_invoice_corporate.sql` — doc kinds, ship-to, UPI settings, e-Invoice stubs  
- `054_ims_invoice_shipping.sql` — shipping GST  
- `055_ims_recurring_invoices.sql` — recurring profiles + retention + recurring_id  
- `056_ims_invoice_approval_retainer.sql` — invoice approval limit, advance_applied, retainer prefix, approval audit columns  
- `057_ims_msme_udyam.sql` — MSME flag + UDYAM number on settings  
- `058_ims_invoice_progress.sql` — progress_pct + progress_label  

## Acceptance (Wave 4)

- [x] Invoice approval limit in Settings  
- [x] Save & issue → pending_approval when over limit; Approvals Invoices tab Approve/Reject  
- [x] Retainer doc kind + apply-advance onto tax invoice  
- [x] Email mailto share from invoice view  
- [x] E2E Sales tabs include Recurring; Approvals tabs include Invoices  
- [x] Unit tests: pending_approval display, advance balance, invoiceNeedsApproval  

## Acceptance (Wave 5a)

- [x] Attachments panel on invoice view (reuse `ims_documents`, sales can upload)  
- [x] MSME registered + UDYAM on Settings → printed on tax invoice paper  

## Acceptance (Wave 5b)

- [x] Progress % + milestone label on editor, map, and invoice paper  

## Acceptance (Wave 5c)

- [x] AR customer **Letter** → printable dunning / payment reminder with overdue lines + bank/UPI  

## Acceptance (Wave 5d)

- [x] Sales invoice list multi-select → **Print pack** (up to 25 papers)  
