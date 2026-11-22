# IMS enhancements — change log & manual verification

**Window:** 2026-11-21 (yesterday) → 2026-11-22 (today)  
**Tenant for checks:** JustTestX Distribution (owner login)  
**App entry:** `/ims`  
**Living delta:** [`IMS_INVOICE_COMPETITIVE_DELTA.md`](./IMS_INVOICE_COMPETITIVE_DELTA.md)

Before verifying finance features, apply migrations **053–058** on the IMS MySQL database (or redeploy so migrate runs).

```text
053_ims_invoice_corporate.sql
054_ims_invoice_shipping.sql
055_ims_recurring_invoices.sql
056_ims_invoice_approval_retainer.sql
057_ims_msme_udyam.sql
058_ims_invoice_progress.sql
```

Automated suite baseline (early 22 Nov): 126 passed / 1 skipped — see Playwright HTML report:

```bash
npx playwright show-report e2e-results/ims-html
```

---

## A. Commit index (newest first)

### 2026-11-22 — invoice competitive waves + E2E depth

| Commit | Summary |
| --- | --- |
| `c2d8a33` | Batch **Print pack** for selected sales invoices |
| `c21243a` | AR printable **dunning / payment reminder** letter |
| `b0747b4` | Invoice **progress %** + milestone label |
| `fcd9e3f` | Invoice **attachments** + **MSME / UDYAM** on paper |
| `fc43e75` | **Invoice approval**, retainer/advance, email share (Wave 4) |
| `f8883a2` | **Recurring**, debit notes, retention, salesperson (Wave 3) |
| `2a2fffd` | Taxable **shipping** + GST |
| `a80547f` | **e-Invoice IRN** associate / mark cancelled |
| `4eb58c4` | Wave 1: ship-to, customer PO, proforma/CN, UPI QR |
| `97606d5` | Deep IMS functional flows covering checklist gaps |
| `e6aa7c7` | Expand IMS E2E (CRUD, tab matrix, draft flows) |

### 2026-11-21 — JustTestX seed, E2E suite, BOM composer UX

| Commit | Summary |
| --- | --- |
| `9605697` | IMS test suite written |
| `f62933e` / `29e3ee0` | JustTestX IMS seed re-prepared (BOM, DC, invoices, reports) |
| `eebda24` | Pack sections insert industry-pack default BOQ headings |
| `8f8fa2b` / `1617759` | Force auto-populate for related fields |
| `207ae2f` | Reference fields → editable select boxes |
| `e460222` / `bc4f1fa` | Redesign composer section (BOM / DC / invoice / return) |

---

## B. Prerequisites for manual checks

1. Sign in as **JustTestX** owner → open IMS (`/ims`).
2. Confirm nav shows **JustTestX Distribution** and role **Owner**.
3. Prefer a throwaway customer (or Cascade) and a seeded SKU (e.g. **JX-CRIMP**) so stock checks stay predictable.
4. After mutating data, note E2E markers if you also re-run Playwright.

---

## C. Detailed verification by enhancement

Work top-down (newer waves first) or follow the order below if validating a fresh deploy.

### 1. Batch print pack (Sales)

**Commit:** `c2d8a33` · **Path:** `/ims?m=sales` → **Invoices**

| Step | Action | Pass if |
| --- | --- | --- |
| 1.1 | Open Invoices & Billing → **Invoices** tab | List loads with seeded invoices |
| 1.2 | Tick **2–3 issued** invoices via row checkboxes | Selection count updates |
| 1.3 | Click **Print pack · N** | Dialog opens; papers load |
| 1.4 | Click **Print** | Browser print preview shows each invoice; page breaks between docs |
| 1.5 | Select **>25** if available, then Print pack | Only first **25** included |
| 1.6 | Clear selection | Print pack disabled |

---

### 2. AR dunning / payment reminder letter

**Commit:** `c21243a` · **Path:** `/ims?m=receivables`

| Step | Action | Pass if |
| --- | --- | --- |
| 2.1 | Open Accounts Receivable → **Customers** view | Customers with dues listed |
| 2.2 | On a customer with overdue/outstanding, click **Letter** | Dialog “Payment reminder · …” opens |
| 2.3 | Read letter body | Seller details, customer, overdue lines, total due |
| 2.4 | If Settings has bank/UPI, scroll to payment block | Bank / UPI lines present |
| 2.5 | Click **Print letter** | Print preview shows letter (`bos-inv-paper`) |

---

### 3. Progress / milestone billing

**Commit:** `b0747b4` · **Migration:** `058` · **Path:** `/ims?m=sales`

| Step | Action | Pass if |
| --- | --- | --- |
| 3.1 | **New invoice** → pick customer + line | Editor opens |
| 3.2 | Set **Progress %** = `40`, **Progress label** = `Stage 2 — Cabling` | Fields accept values |
| 3.3 | **Save draft** → open invoice | Sidebar/paper meta shows **Progress 40% · Stage 2 — Cabling** |
| 3.4 | Clear progress % → save | Progress meta disappears |

---

### 4. Invoice attachments

**Commit:** `fcd9e3f` · **Path:** invoice detail sidebar

| Step | Action | Pass if |
| --- | --- | --- |
| 4.1 | Open any draft or issued invoice | **Attachments** card visible |
| 4.2 | **Add file** → PDF or PNG under 2 MB | Upload succeeds; row shows title + size |
| 4.3 | **Download** | File downloads |
| 4.4 | **Remove** | Attachment gone from list |
| 4.5 | (Optional) Try >2 MB | Error / blocked with size hint |

---

### 5. MSME / UDYAM on tax invoice paper

**Commit:** `fcd9e3f` · **Migration:** `057` · **Paths:** Settings + Sales

| Step | Action | Pass if |
| --- | --- | --- |
| 5.1 | Settings → **Business** | **MSME registered** toggle + **UDYAM** field |
| 5.2 | Enable MSME; set UDYAM e.g. `UDYAM-KR-00-1234567`; save | Settings save succeeds |
| 5.3 | Open/print an **issued tax invoice** | Footer shows `MSME · UDYAM …` |
| 5.4 | Disable MSME; save; re-open paper | MSME line gone |

---

### 6. Invoice approval workflow

**Commit:** `fc43e75` · **Migration:** `056`

| Step | Action | Pass if |
| --- | --- | --- |
| 6.1 | Settings → Documents → set **Invoice approval limit** to e.g. `10000`; save | Hint explains ≥ limit queues Approvals |
| 6.2 | New tax invoice with total **≥ limit** → **Save & issue** (or Issue) | Status **Pending approval** (not issued); stock not moved |
| 6.3 | Approvals → **Invoices** tab | Invoice appears in queue |
| 6.4 | **Approve** | Becomes issued; stock/AR behave as normal issue |
| 6.5 | Repeat with another draft → Approvals → **Reject…** with reason | Returns to **draft**; can edit & re-submit |
| 6.6 | Or from invoice view: **Withdraw** while pending | Back to draft without reject note |
| 6.7 | Set limit to `0`; issue mid-value invoice | Issues immediately (no queue) |

---

### 7. Retainer / advance invoices

**Commit:** `fc43e75` · **Migration:** `056`

| Step | Action | Pass if |
| --- | --- | --- |
| 7.1 | New invoice → Document = **Retainer / advance** | Kind selectable |
| 7.2 | Save & issue (below approval limit or after approve) | Issued as retainer; **no stock OUT** |
| 7.3 | Record a **payment** on the retainer | Amount paid increases |
| 7.4 | Create/open an **issued tax invoice** for same customer with balance | Balance > 0 |
| 7.5 | Call apply advance (API or UI if exposed): `POST /invoices/{taxId}/apply-advance` with `{ retainerId }` — or use finance client if UI added later | Tax invoice **advance applied** rises; balance falls; retainer credit consumed |

> UI note: Wave 4 shipped API `apply-advance`; if no button yet on the paper, verify via network/API once, then confirm balance and activity timeline on both documents.

---

### 8. Email share (mailto)

**Commit:** `fc43e75` · **Path:** invoice view

| Step | Action | Pass if |
| --- | --- | --- |
| 8.1 | Ensure customer has an **email** on the party | Party saved with email |
| 8.2 | Open issued invoice for that customer | **Email** button visible next to WhatsApp |
| 8.3 | Click **Email** | Mail client opens with subject/body (invoice text, plain) |
| 8.4 | Customer without email | Email button hidden |

---

### 9. Recurring invoices

**Commit:** `f8883a2` · **Migration:** `055` · **Path:** `/ims?m=sales` → **Recurring**

| Step | Action | Pass if |
| --- | --- | --- |
| 9.1 | Sales tabs show **Invoices · Recurring · POS** | All three tabs present |
| 9.2 | Recurring → create profile (customer, lines, frequency months, next run) | Profile listed **active** |
| 9.3 | **Run now** | New tax invoice draft/issued appears; link opens |
| 9.4 | Pause profile | Status paused; Run still possible or blocked per UI rules |
| 9.5 | **Process due** (tick) when next-run ≤ today | Due profiles generate invoices |

---

### 10. Debit notes & proforma convert

**Commit:** `f8883a2` (+ Wave 1 proforma/CN)

| Step | Action | Pass if |
| --- | --- | --- |
| 10.1 | Open **issued tax invoice** → **Debit note** | DN draft opens linked “against” original |
| 10.2 | Issue DN | DN issued; **no stock OUT** |
| 10.3 | New doc kind **Proforma** → issue | Proforma issued; not in AR outstanding |
| 10.4 | Proforma → **Convert to tax invoice** | New tax draft created from PF |

---

### 11. Payment retention & salesperson

**Commit:** `f8883a2`

| Step | Action | Pass if |
| --- | --- | --- |
| 11.1 | Invoice editor → **Retention %** = `10` | Hint shows withheld amount |
| 11.2 | Issue invoice (₹1000 example) | Balance = total − retention (collectible lower) |
| 11.3 | Set **Salesperson** from dropdown → save/issue | Account manager name on invoice |
| 11.4 | AR filters by account manager (if used) | Invoice appears under that AM |

---

### 12. Shipping charges + GST

**Commit:** `2a2fffd` · **Migration:** `054`

| Step | Action | Pass if |
| --- | --- | --- |
| 12.1 | Editor → Shipping charges `50`, Shipping GST `%` `18` | Totals include freight + tax |
| 12.2 | Issue & open paper | Shipping line on paper / HSN area note |
| 12.3 | Intra-state vs inter-state customer | CGST+SGST vs IGST on shipping tax |

---

### 13. e-Invoice IRN associate

**Commit:** `a80547f`

| Step | Action | Pass if |
| --- | --- | --- |
| 13.1 | Issue **B2B** tax invoice (customer with GSTIN) | e-Invoice status shows yet-to-push / N/A area |
| 13.2 | **Associate IRN** → paste dummy IRN + optional ack | IRN stored; status pushed/associated |
| 13.3 | **Mark IRN cancelled** | Status marked cancelled (portal cancel still manual) |

---

### 14. Wave 1 corporate foundations

**Commit:** `4eb58c4` · **Migration:** `053`

| Step | Action | Pass if |
| --- | --- | --- |
| 14.1 | Editor → different **Ship-to** (uncheck same as bill-to) | Ship-to on paper |
| 14.2 | **Customer PO / order ref** filled | Printed on paper meta |
| 14.3 | Document **Proforma** / **Credit note** from issued tax | CN draft against original; issue applies credit to AR |
| 14.4 | Settings → **UPI ID** set; issue unpaid tax invoice | Payment QR on paper when balance due |

---

### 15. Sales tab matrix / Approvals invoices (E2E-aligned UI)

**Commits:** `fc43e75`, `e6aa7c7`, `97606d5`

| Step | Action | Pass if |
| --- | --- | --- |
| 15.1 | `/ims?m=sales` tabs | **Invoices**, **Recurring**, **POS counter** |
| 15.2 | `/ims?m=approvals` tabs | **Purchase orders**, **Invoices**, **Bills**, **Stock checks**, **Delivery challans**, **History** |
| 15.3 | Walk each Approvals tab | No module crash |

---

### 16. JustTestX seed & deep flows (21–22 Nov)

**Commits:** `f62933e`, `29e3ee0`, `97606d5`, `e6aa7c7`, `9605697`

Spot-check seeded world (full catalog also in `e2e-results/ims/MANUAL_VERIFY.md`):

| Step | Action | Pass if |
| --- | --- | --- |
| 16.1 | Dashboard KPIs | Non-zero seeded volumes; chart renders |
| 16.2 | Items search **JX-CRIMP** | Found; detail opens |
| 16.3 | Parties **Havells** / **Cascade** | GSTIN / credit visible |
| 16.4 | BOM list → open seeded BOM | Builder / paper |
| 16.5 | DC & Returns | Status badges from seed |
| 16.6 | Sales seeded invoices across FY | List + open print |
| 16.7 | Reports 24-month range | Runs / export controls |

---

### 17. BOM composer UX (21 Nov)

**Commits:** `bc4f1fa`, `e460222`, `207ae2f`, `8f8fa2b`, `1617759`, `eebda24`  
**Paths:** `/ims?m=bom`, `/ims?m=bomDc`, sales convert from BOM

| Step | Action | Pass if |
| --- | --- | --- |
| 17.1 | Open BOM builder | Redesigned composer section readable; lines editable |
| 17.2 | Reference fields | Editable **select** boxes (not dead text) |
| 17.3 | Related party/item pick | Auto-populate fills GSTIN/address/terms as designed; force-fill when re-picking |
| 17.4 | Pack / industry pack → **Add pack sections** (or equivalent) | Inserts pack default BOQ headings missing from sheet (e.g. Supply / Installation) — does **not** invent random sections |
| 17.5 | DC / return composer | Same UX patterns; cancel safe |

### 18. Wave 6 — portal, multi-currency, installments, dunning levels

**Migration:** `059` · **Routes:** `/api/public/invoice-portal/:token`, `/api/ims/invoices/:id/{installments,portal}`, `/api/ims/receivables/dunning-runs`

| Step | Action | Pass if |
| --- | --- | --- |
| 18.1 | Settings → Business → **Base currency** = `inr`, then `INRR` | Uppercases; invalid length blocks Save with an inline error |
| 18.2 | New invoice → Currency **USD**, FX rate empty → Save draft | Blocked: FX rate required |
| 18.3 | FX 83.2, one line totalling 100.10 → Save & issue | Total shows `USD 100.10 · ≈ ₹8,328.32`; list/detail/paper show `USD` amounts; paper meta has Currency, FX rate, Total in INR; no UPI QR |
| 18.4 | Set currency back to **INR** | FX field disappears; saved rate is 1 |
| 18.5 | Duplicate / Credit note from the USD invoice | Currency + rate inherited and locked on the credit note |
| 18.6 | Add supplier bill in **EUR** with rate | Bill list/detail show `EUR …`, with a base total row |
| 18.7 | Issued INR tax invoice → **Customer portal** → Enable | Link appears; **Copy link** works |
| 18.8 | Open the link in a private window (not signed in) | Invoice, balance, bank details and UPI QR render; no phone/e-mail; **Print / save PDF** works; no pay button |
| 18.9 | **Disable** (or **New link**) then reload the old link | "This link is no longer active" / not valid |
| 18.10 | Open portal link of a draft, proforma or cancelled invoice | Not served (404) |
| 18.11 | Invoice with balance → **Payment plan → Create plan** (3 monthly) | Rows sum to the balance; **Save plan** disabled while sum ≠ balance |
| 18.12 | Record a part payment | Earliest installment shows Paid / Part paid; Remove plan disabled |
| 18.13 | Void that payment | Allocation released; plan removable again |
| 18.14 | Settings → Reminders → **Dunning letter levels** → edit L2 to 10 days, add L4, Save | Persists after reload; duplicate keys / empty list blocked |
| 18.15 | AR → Customers → **Letter** | Opens on L1; chips for every level, "(suggested)" on the level matching oldest overdue days |
| 18.16 | Pick **L3** → **Print L3 letter** | Subject "FINAL NOTICE…"; run logged; history lists L3; customer row shows "Last letter L3 · just now"; invoice activity gets a letter reminder |
| 18.17 | Reopen **Letter** for that customer | Opens on the level after the last sent (or L3 if already last) |
| 18.18 | **Print only** | Prints without adding a history row |
| 18.19 | Regression: GSP push, Sales Orders, bill attachments, invoice attachments | Unchanged |

**Automated:** `server/src/ims/wave6-logic.test.ts` (fx base total, installment sum + allocation, dunning level pick, portal token/UPI), `web/lib/ims/__tests__/wave6.test.ts`, `public-paths.test.ts` (`/api/public/invoice-portal`).

---

## D. Settings checklist (finance-related)

| Setting | Where | Verify |
| --- | --- | --- |
| UPI VPA | Business | QR on unpaid tax invoices |
| Bank account / IFSC | Business | On paper + dunning letter |
| MSME + UDYAM | Business | On tax invoice paper |
| Invoice / CN / DN / Proforma / Retainer prefixes | Documents & numbering | Next sample updates |
| **BOM / DC / RTN prefixes** | Documents & numbering | New BOM/DC/return numbers use Settings prefixes (migration **060**) |
| **Print pack max** | Documents → Print & attachments | Sales Print pack caps at this count (default 25) |
| **Attachment max size** | Documents → Print & attachments | Invoice/bill/audit uploads enforce MB limit |
| **Invoice approval limit** | Documents | Queues large invoices |
| PO approval limit | Documents | Unchanged PO behaviour |
| Reminder rules | Reminders | AR “Send reminders” still works |
| **Reminder day offsets** | Reminders | Editable day deltas; matching uses Settings offsets (migration **061**) |
| **Aging breaks (4 caps)** | Reminders → Aging & priority | AR/stock charts rename buckets from caps |
| **AR priority days** | Reminders → Aging & priority | Critical/high/medium thresholds |
| **AP due soon days** | Reminders → Aging & priority | Payables Due soon window |
| **Base currency** | Business | Foreign documents lock FX against it |
| **Dunning letter levels** | Reminders | AR Letter offers each level |

---

## E. Suggested smoke path (30–40 min)

1. Apply migrations 053–059.  
2. Settings: UPI, MSME+UDYAM, invoice approval limit ₹10,000.  
3. Sales: Recurring tab → Run now once.  
4. New tax invoice ≥ limit → pending → Approvals Invoices → Approve.  
5. New invoice with shipping + retention + progress % → issue → print.  
6. Attach a PDF; Email + WhatsApp buttons.  
7. Retainer issue + payment (apply-advance if testing API).  
8. AR → Letter on overdue customer → Print.  
9. Sales → select 2 invoices → Print pack.  
10. BOM → pack sections + composer selects.  
11. Wave 6: create a USD invoice (FX), enable its portal link (INR invoice for QR), add a 3-part payment plan, send an L2 letter (section 18).  
12. Optional: `npx playwright test` IMS suite / spot-check MANUAL_VERIFY IDs for Sales/Approvals tabs.

---

## F. Known gaps (not shipped in this window)

**Shipped in Wave 6:** live GSP IRP push (Integrations → GSP sandbox/live + invoice Push to IRP), Sales Order module + SO→DC→Invoice wizard (`/ims?m=salesOrders`), bill attachments, customer portal (magic link + UPI QR), multi-currency (document currency + locked FX), installment plans, multi-level dunning letters (see section 18).

**Skipped on purpose:** auto-charge on recurring invoices (no card capture — portal remains view + UPI instructions only).

**Still open / partial from competitive delta:** multi-GSTIN / branch series, custom fields, bulk IRP push, e-Way Bill live generation, progress amount from quote %.

**Wave 6 known limits:** credit notes / advances applied after an installment plan is created do not re-cut it; AR aging and KPI totals still add document-currency balances unconverted; portal UPI QR is INR-only.

---

*Generated for manual QA of 2026-11-21 / 2026-11-22 IMS work. Update this file when a wave lands or a check fails.*
