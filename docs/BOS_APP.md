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
web/components/bos-app/           The app: BosApp shell + workspaces (Home loads with the shell; other workspaces and their modules load on first open)
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
| Payroll (migration 012) | `bos_payroll_settings` (one JSON config per tenant), `bos_salary_structures` (per employee), `bos_payroll_runs` (one per month), `bos_payslips` (a frozen snapshot of each employee's month) |
| Banking (migration 013) | `bos_bank_accounts` (bank and cash accounts with an opening balance; only the last four digits of the account number), `bos_bank_txns` (statement lines and manual entries, each with its reconciliation) |
| Budgets (migration 014) | `bos_budgets` (one per financial year and basis), `bos_budget_lines` (one per head, with twelve monthly amounts) |
| Assets (migration 015) | `bos_assets` (the register: cost, purchase date, depreciation method and rate, holder, department, location, status, disposal), `bos_asset_events` (assignments, returns, transfers, maintenance, disposal and reinstatement, with names copied at the time) |
| Accounting (migration 016) | `bos_accounts` (the chart of accounts: code, name, type, the system key BOS posts to, expense categories), `bos_accounting_settings` (books-start date), `bos_opening_balances` (one debit or credit per account), `bos_journals` and `bos_journal_lines` (manual entries; voided, never edited) |
| Recruitment (migration 017) | `bos_job_openings` (roles: department, openings, priority, status, salary range, needed-by date), `bos_candidates` (application, interview, offer, joining date, the onboarding checklist as JSON, and the employee created from it), `bos_candidate_events` (the candidate's history, with names copied at the time) |
| Performance (migration 018) | `bos_training_programs` (the catalog: team, length, certificate and validity, mandatory), `bos_training_enrollments` (who, session date, status, completion), `bos_certifications` (issued by BOS from a completed training, or recorded from outside), `bos_kras` (per employee and period, with status and progress), `bos_promotions` (current role and CTC copied at proposal, the proposal and the decision), `bos_pips` (improvement plans), `bos_recognitions` |
| Travel (migration 019) | `bos_travel_requests` (traveller, purpose, route, dates, mode, estimated cost and advance, optional project, and the decision) |
| Employee services (migration 020) | `bos_service_requests` (requester, type, certificate kind, subject, priority, status, assignee, resolution and letter number) and `bos_service_comments` (the thread, with internal notes) |
| Policies & compliance (migration 021) | `bos_policies` (the text, category, mandatory flag, status and published version), `bos_policy_acks` (one row per employee per version: self or recorded by HR, with the time and IP), `bos_compliance_items` (filings and renewals with recurrence, responsible person, filing reference and the next occurrence), `bos_agreements` (with an employee or an outside party, dates, a link to the signed copy, ended or active) |
| Sales billing (migration 022) | `bos_items` (the product and service catalog: SKU, HSN/SAC, unit, rate, GST rate, active), `bos_sales_docs` (quotations, sales orders and delivery challans in one table: customer, GST lines as JSON with totals, the dates and dispatch details for each kind, the document it was made from and the invoice it became). POS bills are ordinary `bos_invoices` with `source_tool = 'pos'` and a payment |
| Invoice date indexes (migration 023) | No new tables. Adds `(tenant_id, issue_date)` and `(tenant_id, source_tool, issue_date)` indexes on `bos_invoices` for the monthly reports and the POS day list. Built online (`ALGORITHM=INPLACE, LOCK=NONE`), so the table stays readable and writable |

Migrations `012_bos_payroll.sql` to `023_bos_invoice_dates.sql` follow the same rules: they only add tables or indexes and are applied on API start. Deploys take a verified DB backup first whenever a release carries pending migrations (see [DEPLOY.md](DEPLOY.md)).

Every row is partitioned by `tenant_id`. In JBT that is the business profile, so each branch has its own books and HR.

## Modules

**Live (real data):**

- **Home.** My Profile (linked employee record, leave balances, quick actions, activity ticker, celebrations) and a Dashboard.
- **Finance & Accounts.**
  - Dashboard with revenue vs spend, aging, alerts and approvals.
  - Customers & Vendors.
  - GST Invoices: editor with a live paper preview and print. Intra-state invoices get CGST + SGST and inter-state ones get IGST, based on the place of supply.
  - Receivables & payments, Payables (bills with approval), Expenses (claims, approval, reimbursement), GST summary (output, ITC, net payable) and the Audit log.
  - Lists never drop money that's still owed. Invoices and Receivables always load every draft and unpaid invoice; paid and void ones are the latest 1,000, with a note when there are more and a search of all invoices. Customers & Vendors shows the first 5,000 by name, Sales Billing the latest 2,000 documents, and the POS counter the latest 300 bills of the day (its totals still cover the whole day), each with a note when there are more.
  - Sales Billing: quotations, sales orders and delivery challans (part shipments included) that convert into draft GST invoices, a product and service catalog, and a POS counter behind an admin switch. See [Sales Billing](#sales-billing).
  - Banking (owners and admins): bank and cash accounts, CSV statement import and reconciliation against invoices, bills, expense claims and payroll. See [Banking](#banking).
  - Budgeting (owners and admins): an annual budget by spend category or by department, tracked against actual spend month by month, with a projected year-end. See [Budgeting](#budgeting).
  - Accounting (owners and admins): a chart of accounts, a general ledger built from every BOS record, manual journal entries, a trial balance with profit & loss and balance-sheet totals, and opening balances. See [Accounting](#accounting).
  - Assets (owners and admins): the fixed-asset register with who holds each asset and where, maintenance, transfers, disposal, and a WDV or SLM depreciation schedule per financial year. See [Assets](#assets).
  - Payroll (owners and admins): monthly runs, salary structures, PF, ESI, professional tax and TDS, printable payslips, a statutory register and a bank-advice CSV. See [Payroll](#payroll).
  - Reports (owners and admins): month-by-month profit & loss for this month, last month, this quarter, this financial year or a custom period of up to three years. It also has sales, purchase and expense registers, each with a CSV download.
- **HR Management.**
  - Overview.
  - Employees: full profile, a personal-detail change approval flow, bank details that are masked until an audited reveal, and a Payroll tab with the salary and released payslips (managers and the employee only).
  - Org chart & departments.
  - Leave & attendance: requests and approvals, calendar, daily roster, holidays.
  - Recruitment & Onboarding (owners and admins): roles, a candidate pipeline, interviews, offers with a printable offer letter, the new-joiner checklist, and creating the employee record from the hire. See [Recruitment & Onboarding](#recruitment--onboarding).
  - Performance & Learning (owners and admins): the training catalog and schedule, certificates with expiry, KRAs, promotion sign-off, improvement plans and recognition. See [Performance & Learning](#performance--learning).
  - Expenses & Assets: who holds which company asset and returns when people leave, travel requests with approval, and expense claims. Managers see the team; everyone else sees their own. See [Expenses & Assets](#expenses--assets).
  - Employee Services: the HR helpdesk, employment, experience and salary letters, and ID card and kit requests, with a conversation per request. See [Employee Services](#employee-services).
  - Policies & Compliance: the policy library with versioned read-and-acknowledge, the statutory compliance calendar (owners and admins), and the agreements register. Everyone reads published policies and sees their own agreements. See [Policies & Compliance](#policies--compliance).
  - Reports & Analytics (owners and admins): monthly attendance per employee, leave used this financial year, and headcount by department, with CSV downloads.
  - Settings & Access: the HR policy form, plus a table of what each role can do.
- **Projects.** Pipeline kanban (drag to change stage) and an All Projects list.
- **Connected Tools.** Connector overview, per-tool records and imports.
- **Settings & Audit.** Company & GST, invoicing, HR policy, integrations and the audit log.

**Coming next.** Every module from the BOS design is now live; none shows the "Coming next — design preview" banner any more.

Owners, admins and single-user installs are *managers*. Only managers approve, void, archive, edit settings and open reports. Other users get `403` from the API and view-only screens. They can file expense claims only for themselves; a manager can file one on behalf of any employee. Staff can delete pending or rejected bills and draft invoices; with the `bos.finance.own_deletes` switch on, only the ones they created.

Reports and the GST summary are on an accrual basis and exclude GST:

- **Sales:** issued invoices (not draft or void), net of discounts, by issue date.
- **Purchases:** approved or paid bills, by bill date. The GST summary's input-tax credit counts the same bills.
- **Expenses:** approved or reimbursed claims, by the date spent.
- **Payroll:** the employer's cost (gross pay plus employer PF and ESI) of finalised or paid runs, in the payroll month. Profit & loss subtracts it from net.

## Payroll

Finance → Payroll. Nothing runs on its own: a manager reviews the settings, sets salaries and starts each month's run.

- **Settings first.** PF, ESI and professional tax are **off by default**, because they depend on the establishment (PF from 20 employees, ESI by location and wage, PT by state). A run can't start until the settings have been saved once (`409`). The settings also hold the basic % and HRA % used to suggest a structure from the CTC on the employee record, and whether unmarked working days are paid.
- **Statutory rules.**
  - PF is 12% of basic from the employee and from the employer, optionally capped at the ₹15,000 wage.
  - ESI is 0.75% from the employee and 3.25% from the employer, when monthly gross is up to ₹21,000.
  - PT uses the slabs the manager enters.
  - TDS is either a fixed monthly amount from the employee's declarations or an estimate under the new regime (standard deduction, the ₹12 lakh rebate with marginal relief, surcharge and 4% cess), spread over 12 months.
  - A bonus is paid in full and isn't part of the PF or ESI wage. Deductions never exceed gross.
- **Loss of pay** is worked out over the days the person was employed that month. It counts absences, half days that aren't half-day leave, approved LOP leave and, if the settings say so, unmarked working days up to today. A manager can override it per payslip.
- **Lifecycle.**
  1. **Draft:** created for one month (not a future one, one run per month). It can be recalculated after attendance or salary changes, adjusted per payslip (bonus, other deductions, TDS, LOP days, note) or deleted.
  2. **Finalised:** freezes the reviewed figures, as finalising doesn't recalculate. It can be reopened to draft.
  3. **Paid:** records the payment date and is locked.
- **Who sees what.** Only managers see runs, structures and the statutory register. Employees see their own payslips in Home → My Profile and on their employee record once a run is finalised; drafts return `404` to them. Finalising and paying send one notification for the whole run, not one per employee.
- **Bank advice.** A CSV of beneficiary, account, IFSC and amount for finalised or paid runs. Each download is recorded in the audit log, like the bank-detail reveal.
- **Payslips** are snapshots: name, designation, department, PAN and UAN are copied at calculation time, so later edits to the employee don't change a finalised payslip. They print to PDF from the payslip screen.

## Banking

Finance → Banking, for owners and admins. BOS never connects to a bank: the manager imports the statement file and decides what each line is.

- **Accounts.** A bank account or a cash book, with an opening balance on an opening date. The book balance is the opening balance plus every line from that date. Bank accounts store the bank, IFSC and only the **last four digits** of the account number. An account with lines can be archived but not deleted.
- **Statement import.** The browser reads the bank's CSV export, skips any account preamble, guesses the columns (HDFC, SBI, ICICI, Axis, Kotak and generic layouts; separate withdrawal and deposit columns or one amount with Dr/Cr) and shows a preview the manager can correct. Lines go to the API in date order, up to 5,000 at a time.
  - Each line gets a fingerprint (date, amount, narration, reference and its occurrence number), so re-importing the same or an overlapping statement skips lines already there. Two identical payments on the same day stay separate.
  - Lines dated before the opening date are skipped, because the opening balance already covers them.
  - When the file has a balance column, the latest closing balance is shown next to the book balance, with a warning if they differ.
- **Manual entries** cover cash and anything not yet in a statement.
- **Reconciliation.** Each line can be:
  - **matched** to a record that already shows the money: a recorded invoice payment, a paid bill, a reimbursed claim or a paid payroll run (exact amount, close in date);
  - **settled**: BOS records it now, dated the statement date, using the same rules as the module itself. That means a payment against an open invoice (part-payments allowed), paying an approved bill, reimbursing an approved claim, or marking a finalised payroll run paid. Each also writes that module's own audit event;
  - **categorised** (bank charges, interest, transfers, owner's contribution or drawings, tax payments, loans, other), or **excluded** (duplicates, reversals).
- **Suggestions.** For every open line BOS scores candidates by amount, date and whether the party name or document number appears in the narration. It prefers records that already show the money, so nothing is recorded twice, and only proposes one when it is clearly ahead. Accepting is one click; nothing is reconciled automatically. A record can be matched to one line only, except invoices, which can take several part-payments.
- **Undo** returns the line to "to reconcile". A payment, bill payment, reimbursement or payroll payment recorded from it stays, and is reversed in its own module if needed. Only unreconciled or excluded lines can be deleted.
- Categorised lines are for reconciliation only and don't change profit & loss.

## Budgeting

Finance → Budgeting, for owners and admins. A budget is a plan only: it never blocks or changes a bill, claim or payroll run.

- **One budget per financial year and basis.** Pick the year (the financial year in Settings) and the basis:
  - **By category.** Heads are spend categories plus payroll. Bills and expense claims with the same category name count against the same head, ignoring case and spacing. Bills without a category share an "Uncategorised" head.
  - **By department** (cost centres). Expense claims count against the claimant's department, and salaries against the department on the payslip. Vendor bills, and claims or payslips without a known department, are company-wide.
  - A year can have both, as two views of the same spend.
- **Actual spend** uses the same rules as profit & loss, excluding GST: approved or paid bills by bill date, approved or reimbursed claims by the date spent, and the employer cost of finalised or paid payroll runs in the payroll month. A year's total spend equals the profit & loss costs for that year, whichever basis is used.
- **Planning.** Each head has twelve monthly amounts, entered as the same amount every month or month by month. A new budget can start empty, from last year's actual spend, or from last year's budget, optionally adjusted by a percentage (each month rounded to the rupee).
- **Tracking.**
  - **Budget to date** counts finished months in full and the current month by the days gone.
  - **Projected** is what's spent so far plus the plan for the rest of the year.
  - **Status:** *over budget* once spending passes the annual budget, *watch* when the year is projected to end more than 5% over or 90% is already used, otherwise *on track*.
- **Unbudgeted spend** lists recorded spend with no head, so it can be added in one click, pre-filled with last year's amount. The month-by-month view shows spend against budget per head, and the CSV download has both.
- Every change (create, heads added, changed or removed, rename, delete) is recorded in the activity feed and the audit log.

## Assets

Finance → Assets, for owners and admins. The register is a record only: depreciation is calculated when it's viewed and isn't added to Reports → profit & loss, because the purchase is usually already there as a vendor bill. The Accounting ledger does post it (see [Accounting](#accounting)).

- **Register.** Each asset has a tag (numbered `AST-0001` onwards unless one is entered; unique per business profile), name, category, serial or registration number, cost excluding claimable GST, purchase date, salvage value, warranty date, vendor and optionally the purchase bill from Payables. The purchase date can't be in the future.
- **Depreciation.**
  - **WDV** charges the rate on the opening book value each financial year; **SLM** charges the rate on cost; **none** suits land and similar assets.
  - Choosing a category suggests a rate: WDV from the Income-tax blocks (for example computers 40%, furniture 10%, vehicles and plant 15%) and SLM from the Companies Act useful lives with a 5% residual (for example computers 31.67%, furniture 9.5%). The manager can change it.
  - The first year, and the year of disposal, are charged pro-rata by days held. Book value never goes below the salvage value.
  - The financial year follows Settings. The schedule for a year shows opening book value, additions, depreciation, disposals and closing book value per asset and per category, with a CSV download. For the current year, depreciation is shown for the full year.
- **Custody.** Assign an asset to an employee, return it or reassign it. People who have left can't be given assets. Transfers change the department or location.
- **Maintenance.** Sending an asset for maintenance marks it as under maintenance until it's back in use, when the cost can be noted. The repair bill itself goes through Payables as usual.
- **Disposal.** Sold, scrapped or written off, with the sale proceeds. Depreciation stops on the disposal date and the gain or loss against book value is shown. A disposal can be undone (reinstated). Deleting is for entries made by mistake and removes the history too.
- Action dates can't be before the purchase date or in the future. Each asset keeps its own history, and every change is also recorded in the activity feed and the audit log.

## Accounting

Finance → Accounting, for owners and admins. The ledger is **derived on read**: BOS doesn't copy invoices, bills or payroll into journal tables, it posts them every time the ledger is opened. Nothing in the existing modules changes, there is nothing to switch on, and correcting a record in its own module corrects the ledger too.

- **Chart of accounts.** Thirty system accounts are created the first time Accounting is opened (cash 1000, bank 1010, receivables 1100, input GST 1200, fixed assets 1500, payables 2000, salaries payable 2200, PF/ESI/PT/TDS payable 2210, output GST 2300, suspense 2900, capital 3000, retained earnings 3200, sales 4000, purchases 5000, salaries 5200, depreciation 5400 and so on). They can be renamed and renumbered but not retyped, archived or deleted. Managers add their own accounts; an account with entries can be archived but not deleted.
- **Posting rules** (GST always goes to its own accounts):
  - Issued invoice: receivables against sales and output GST. Payment: cash or bank against receivables.
  - Approved or paid bill: purchases (or the expense account that collects its category) and input GST against payables. Payment: payables against bank, or cash when it was reconciled to a cash book.
  - Approved or reimbursed claim: employee expenses (or its category's account) against reimbursements payable, then reimbursements against cash or bank.
  - Finalised payroll run, at the end of the payroll month: gross salaries and employer PF/ESI against net salaries payable, statutory dues and other deductions. Payment: salaries payable against bank or cash.
  - Categorised bank line: the bank or cash account against the category's account (bank charges, interest, transfers, capital, drawings, tax, loans); unknown categories go to suspense.
  - Asset: fixed assets against the linked bill's account when that bill is posted, otherwise **suspense**. Depreciation is posted at each financial-year end and up to today, and disposal removes cost and accumulated depreciation, books the proceeds to suspense and the gain or loss.
  - Manual entries (journal vouchers `JV/<FY>/0001`) cover capital, loans, drawings, corrections and moving amounts out of suspense. Debits must equal credits. An entry is voided with a reason, never edited.
- **Expense categories.** An expense account can list bill, claim and bank categories (matched ignoring case and spacing); each category routes to one account only.
- **Books start and opening balances.** By default the ledger runs from the first BOS record. A manager can set a books-start date: records before it drop out and their effect is carried in the opening balances on the day before. "Fill from BOS records" works those balances out (income and expense roll into retained earnings), and anything kept outside BOS can be added. If opening debits and credits differ, the difference goes to the opening balance adjustment account so the books still balance.
- **Views.** Chart of accounts with balances on each account's normal side and the latest postings; the general ledger of any account with a running balance and links back to the source record; manual entries; the balance summary (trial balance plus profit & loss for the period and the balance sheet at its end, with profit to date because BOS doesn't close years); and opening balances. Ledgers and the trial balance download as CSV.
- **Reports are unchanged.** Reports → Profit & loss still counts invoices, bills, claims and payroll as before. The Accounting summary can differ because it also includes categorised bank lines, depreciation, disposals and manual entries, and bills or claims may sit in their own expense accounts.
- Each business profile has its own books. Account changes, opening balances and manual entries are recorded in the activity feed and the audit log.

## Sales Billing

Finance → Sales Billing, for everyone with write access. Quotations, orders, challans and the catalog are new records (migration 022). Invoices are only ever created when someone clicks **Create invoice**, through the same rules as Finance → Invoices, so nothing existing changes. The POS counter issues real tax invoices, so it stays hidden until an admin turns on its switch.

- **Quotations** (`QT/<FY>/0001`). Customer, GST lines, valid-until (15 days by default) and terms. Draft → **Sent** → **Accepted** or **Declined**; an unanswered quotation past its date shows **Expired**. A decision can be changed until the quotation moves on. **Convert to sales order** (once; a cancelled order frees it again) or **Create invoice** directly; either marks it accepted and shows it as **Converted**.
- **Sales orders** (`SO/<FY>/0001`). Booked directly or from a quotation, with a delivery-by date and the customer's PO number. The stage follows the challans: **Confirmed**, **In transit**, **Part delivered** or **Delivered**, with the delivered share on the order. Editable until the first challan.
- **Delivery challans** (`DC/<FY>/0001`). Made from an order with whatever is still to ship (edit quantities for a part shipment), or on their own for job work, goods on approval or other movements. Ship-to address, transporter and vehicle/LR number. Draft → **Dispatch** (date not in the future) → **Mark delivered** (date and who received it). Lines match the order by description, HSN and unit; cancelled challans give their quantities back.
- **Invoicing.** Any quotation, order or dispatched challan becomes a **draft** invoice dated today, due after the invoicing payment terms, marked as created from `SALES · <number>`, and it opens straight away for review and issue. A document is invoiced once. An order is invoiced either as a whole or challan by challan, never both. Deleting or voiding that invoice frees the document to be invoiced again.
- **Cancel and delete.** Owners and admins cancel orders and challans (an invoiced one needs its invoice voided or deleted first; an order with dispatched challans needs those cancelled first, and its draft challans are cancelled with it). Anyone deletes drafts; documents that have left draft need an owner or admin, and anything with linked documents can't be deleted.
- **Products & Services.** The catalog behind line items: name, SKU (unique), product or service, HSN/SAC, unit, rate before GST and GST rate. Typing a product's name on a line fills its HSN, unit, rate and GST. Lines copy the item, so editing or removing it never changes old documents. Owners and admins maintain it; everyone can read it and download it as CSV.
- **POS counter** (switch `bos.sales.pos`, **off by default**). Tap products (or ring up a quick item) into a bill, take cash (with change worked out), UPI or card, and print the receipt. Each bill is a GST tax invoice in the BOS invoice series, issued and paid in full on the spot, to "Walk-in customer" unless a name or GSTIN is entered, so it appears in receivables, GST, reports and accounting like any invoice; void it from Invoices. Today's bills are listed with totals by payment method. While the switch is off the tab, the KPI and `POST /sales/pos` (`403 FEATURE_OFF`) are unavailable, and managers see where to turn it on.
- **KPIs.** Sales orders this month and their value, open quotations and the pipeline, delivery challans this month (pending dispatch or in transit), and POS billing today, or, while POS is off, what's ready to invoice (accepted quotations, delivered orders, and delivered challans not made from an order).
- Accepting a quotation notifies the owners; nothing else sends notices. Every change is recorded in the activity feed and the audit log.

## Recruitment & Onboarding

HR → Recruitment & Onboarding, for owners and admins. It's a new module with its own tables: nothing in Employees changes until a manager creates an employee record from a hire, so there is nothing to switch on.

- **Roles.** A role has a department, number of openings, priority, employment type, location, salary range and a needed-by date. It starts as a draft, is published (open), can be put on hold and is closed when filled; reopening clears the closed date. Candidates can only be added to roles that aren't closed, and a role with candidates can't be deleted.
- **Pipeline.** Applied → Interview → Shortlisted → Offer → Hired, plus Rejected and Withdrawn with a reason. Cards can be dragged on the kanban or moved from the candidate's page. Scheduling an interview moves an applied candidate to Interview. Rejected or withdrawn candidates can be reopened.
- **Hiring only through an accepted offer.** Making an offer records the CTC, offer date, joining date and terms. A candidate becomes Hired only when the offer is recorded as accepted; a decline closes the application as withdrawn. Dropping a card on Hired opens the same response dialog when an offer is out. A hire can be undone until its employee record exists.
- **Offer letter.** A printable letter on the company's name, address and GSTIN with the role, CTC (and the monthly figure), joining date and terms, and signature lines.
- **Onboarding checklist.** Documents, KYC, IT setup, induction (which can be scheduled) and KRA update, plus the employee record (shown as Sync to HRMS). A joiner is *completed* when all six are done, and *delayed* when the joining date has arrived and the employee record or a pre-joining task (documents, KYC, IT) is still pending.
- **Employee record.** Create employee record opens the HR form prefilled from the candidate and role (probation by default). It uses the same numbering and creates the same `employee.create` event as HR → Employees, and links the hire to the employee so it can't be created twice.
- **KPIs.** Open positions are the openings on published roles minus the hires against them. Average time to hire runs from application to acceptance over the last 365 days. Offer acceptance counts responses this financial year. New joiners are joining dates this month; inductions this week are those scheduled in the next seven days. The onboarding tabs track hires who joined in the last 90 days, are still to join, or aren't completed.
- Every change (roles, candidates, stage moves, interviews, offers, responses, checklist and notes) is in the candidate's history, the activity feed and the audit log. An accepted offer also sends a notification.

## Performance & Learning

HR → Performance & Learning, for owners and admins. It's a new module with its own tables. The only thing that touches an existing record is approving a promotion with **Update the employee record** on, which is an explicit manager action, so there is nothing to switch on.

- **Training catalog.** Each program has a team (everyone, management, technical, operations), a length in days (half days allowed; empty means ongoing), whether it earns a certificate and for how many months it's valid, and whether it's mandatory. Programs with enrollments can be archived but not deleted.
- **Enrollments.** Enroll one or many people at once; anyone already enrolled in that program is skipped, and people who have left or archived programs are refused. Sessions can be scheduled, rescheduled or cleared. **Mark complete** takes the completion date (not before enrollment, not in the future). Cancelled enrollments stay on record.
- **Certificates.** Completing a program that earns a certificate issues one in the same step, numbered `CERT-0001` onwards per business profile, dated the completion day, expiring after the validity months (the day before the anniversary). It prints from the Certifications tab. Certificates from outside (for example a safety licence) can be recorded with issuer, credential number and link. A BOS-issued certificate's name and issuer can't be changed.
- **Expiry.** A certificate is *expiring soon* within 30 days of its expiry date and *expired* after it. **Mandatory certified** counts current employees (everyone who hasn't left) who hold a valid certificate for every mandatory program that earns one.
- **KRAs.** Set the same KRA (target, weight, period of up to three years) for one or many people; it defaults to the financial year. Reviews set status (on track, at risk, off track, achieved, missed), progress and a note, and stamp the review date. The KPIs count KRAs whose period covers today.
- **Promotions.** Proposing copies the person's current designation and CTC, so the record of what changed stays accurate. One pending proposal per person. A manager approves or turns it down; approving with **Update the employee record** sets the new designation (and CTC, if proposed) on the employee and writes the same `employee.update` event as HR → Employees. The payroll salary structure is **not** changed: revise it in Payroll. Pending proposals can be withdrawn.
- **Improvement plans.** One active plan per person, with the concern, goals and support, a start and a review date (after the start). Plans can be extended and are closed as completed, not met or cancelled, with a note. Plans are visible to managers only.
- **Recognition.** Award a category (Employee of the Month, Star Technician, Project Spotlight and nine others, or your own) with an optional reason. **🏆 This Month** groups this month's recognitions per person.
- **KPIs.** Promotions pending sign-off (or approved this financial year), programs in the catalog, people certified out of headcount, people on a plan with the next review date, enrollments and completions this fiscal quarter, and distinct sessions in the next 30 days.
- Every change is recorded in the activity feed and the audit log. No notifications are sent.

## Expenses & Assets

HR → Expenses & Assets, for everyone: managers see the whole team, everyone else sees their own assets, trips and claims. Travel requests are the only new records (migration 019). Assets and expense claims are the same records as Finance → Assets and Finance → Expenses, through the same endpoints and rules, so nothing existing changes and there is nothing to switch on.

- **Asset assignment.** Every asset in the register that hasn't been disposed of, with who holds it, the category, when it was assigned (the latest assignment in its history) and its state. Managers assign assets from store, reassign or record a return (date and condition); each is written to the asset's history exactly as in Finance → Assets. Staff see the assets assigned to them.
- **Returns.** An asset is an **overdue return** when its holder has left (status exited, or the exit date has passed) and **return due** while the holder serves notice or has an exit date ahead. The Returns filter lists both.
- **Travel requests.** Purpose, from and to, departure and return dates, mode, estimated cost, an optional advance (up to the estimate; informational, never posted to the books) and an optional project. Requests are numbered `TRV-0001` onwards per business profile.
  - Anyone with a linked employee record can request travel for themselves; managers can file for anyone who hasn't left. A trip can be up to 90 days, start up to 30 days ago (for trips requested after the fact) and up to a year ahead. Trips for the same person can't overlap a pending or approved one.
  - A request from staff notifies the approvers; a request a manager files doesn't. Managers approve or turn it down, and the traveller is notified.
  - Pending requests can be edited by the traveller or a manager. Pending trips, and approved ones that haven't started, can be cancelled. Approved trips show as approved, on trip, or completed from their dates.
  - **Claim expenses** on a trip that has started opens the usual expense claim, filled in with the Travel category and the trip's reference.
- **Expense claims.** Managers approve or reject claims and mark approved ones reimbursed, as in Finance → Expenses. Staff see their own claims and file new ones.
- **KPIs.** Assets assigned (and in store), pending travel requests with their estimated cost, open expense claims (submitted or approved, not yet reimbursed) and their total, and overdue asset returns.
- Travel requests, decisions, edits and cancellations are recorded in the activity feed and the audit log.

## Employee Services

HR → Employee Services, for everyone: managers see and work every request, everyone else raises and follows their own. The requests are new records (migration 020), so nothing existing changes and there is nothing to switch on.

- **Request types.** Helpdesk, certificate, ID card, kit and other. Requests are numbered `SRV-0001` onwards per business profile, with a subject, details and a priority (low, normal or high).
- **Who can raise.** Anyone with a linked employee record raises requests for themselves. Managers can raise for anyone; for someone who has left, only a certificate.
- **Certificates and letters.** Employment certificate, experience letter or salary certificate, optionally addressed to someone (otherwise "To whom it may concern"), with the purpose printed on the letter. The letter is generated from the employee record on the company letterhead and printed or saved as PDF.
  - An experience letter needs the person to have left, be serving notice or have an exit date. A salary certificate needs a CTC on the record and shows it. Someone who has left can only get an experience letter. A request that breaks these rules is refused when raised.
  - Managers can preview the draft at any time. Resolving the request issues it with a reference number (`LTR-0001` onwards); the requester can then open and download it. Reopening and resolving again keeps the same number.
- **Working a request.** Managers assign it to a colleague (or themselves), which moves it to **In progress** and notifies the assignee; unassigning moves it back to **Unassigned**. Resolving takes an optional note shown to the requester. Resolved requests can be reopened; open ones can be cancelled by the requester or a manager. The requester or a manager can edit an open request.
- **Conversation.** Each request has a thread. Managers can add **internal notes** that staff never see. A manager's reply notifies the requester; a request raised by staff notifies the approvers, and resolving notifies the requester.
- **KPIs.** Open helpdesk tickets (and how many are unassigned), average resolution time for requests resolved in the last 30 days against the 30 days before, open certificate requests, and open ID card and kit requests.
- Every change is recorded in the activity feed and the audit log.

## Policies & Compliance

HR → Policies & Compliance. All records are new (migration 021), and nothing appears for employees until a manager publishes a policy, so there is nothing to switch on.

- **Policies.** A title, category (HR, compliance, finance, IT, safety, other), a short summary, the full text, an optional effective date, and whether acknowledging is mandatory. A new policy can start from one of six templates (Leave, Work From Home, Code of Conduct, POSH, Travel & Expense, IT & Data Security) with the company name filled in. They are a starting point to edit, not legal advice.
  - Drafts are visible to owners and admins only. Publishing makes it version 1 for everyone. Small edits keep the version and its acknowledgements; ticking **Ask everyone to acknowledge again** publishes the next version, and everyone acknowledges again. Earlier acknowledgements stay on record.
  - A policy people have acknowledged can be archived (hidden from employees, restorable) but not deleted. Only drafts nobody has acknowledged can be deleted.
- **Read & acknowledge.** Anyone with a linked employee record who hasn't left reads the policy and acknowledges the current version once. The time and IP address are kept. Home → My Profile shows a reminder while published policies are waiting, which only appears once a policy has been published. No notifications are sent per employee, because every notice also reaches the owners' inbox.
- **Acknowledgement register** (managers, per policy). Everyone who hasn't left, with when and how they acknowledged: signed in, or recorded by HR (for example a signed paper copy, for people without a login). It flags people who signed an earlier version. HR can remove only acknowledgements HR recorded, never an employee's own. Downloads as CSV.
- **Org-wide acknowledgment** is acknowledgements of current versions by people who haven't left, out of published policies × headcount.
- **Compliance calendar** (owners and admins). Filings and renewals with an area (PF, ESI, professional tax, TDS, labour welfare, POSH, Shops & Establishment, gratuity, bonus, other), due date, repeat (one-off, monthly, quarterly, every 6 months, yearly), who's responsible and a note.
  - **Standard filings** adds the usual Indian employer filings in one go: PF ECR and ESI (15th), TDS deposit (7th), professional tax (20th, varies by state), the four quarterly 24Q returns, Form 16 (15 June), the POSH annual report, labour welfare fund and Shops & Establishment renewal, each with its next due date. Dates vary by state, so the screen asks the manager to check and edit them. A filing already open on the calendar isn't added twice.
  - **Mark filed** records the date (not in the future), a challan or acknowledgement reference and a note. A repeating filing then adds the next one, keeping its day of the month (31 Jan, 28 Feb, 31 Mar). Reopening removes that next one if it's still open; if it's already filed, reopen that first.
  - A filing is **overdue** after its due date and **due soon** within 7 days.
- **Agreements.** Employment, NDA, non-compete, consultancy, internship or other, numbered `AGR-0001` onwards, with an employee or an outside party (a contractor or agency), signing, start and end dates, a link to the signed copy (http/https only) and a note. They show as awaiting signature, active, expiring (30 days before the end date), expired or ended. Ending keeps the record and can be undone. Employees see their own agreements; owners and admins manage them.
- **KPIs.** Managers: published policies (mandatory and drafts), org-wide acknowledgment and mandatory sign-offs pending, filings due in 30 days (overdue and due this week), and agreements expiring. Employees: policies to acknowledge, policies acknowledged, and their agreements.
- Every change and acknowledgement is recorded in the activity feed and the audit log.

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

### Switches inside BOS

| Switch | What it turns on |
|--------|------------------|
| `bos.sales.pos` | Finance → Sales Billing → POS Counter: counter bills issued as paid GST invoices |
| `bos.expenses.own_claims` | Finance → Expenses shows staff only their own claims (filed by them or against their employee record), as HR → Expenses & assets already does. While it's off, staff keep today's team-wide list. Owners and admins always see every claim. Recommended for every organization |
| `bos.finance.own_deletes` | Staff can delete only the vendor bills and draft invoices they created (`403` otherwise, and the Delete button is hidden). While it's off, staff can delete anyone's pending or rejected bill and draft invoice, as today. Owners and admins can always delete them |

The BOS API reads these through the optional `BosHost.feature(actor, key)` hook, which JBT answers from the same admin switches (unregistered keys and read errors count as off). A host without the hook allows every feature.

## Deep links

`?ws=<workspace>&m=<module>&open=<id>` opens a workspace, module and record. Examples: `/tools/bos?ws=finance&m=invoices&open=<invoiceId>` and `/bos?ws=hr&m=leave`. The `open` parameter is consumed on load. The URL then tracks navigation, so a refresh lands on the same screen.

## Enabling BOS

BOS is **opt-in and hidden by default**. Existing customers see nothing until an admin enables it.

1. Restart the API once after deploying. Migration 010 is applied on start.
2. Go to Admin → Tools → **Justx BOS** → Placement, set **Visible on home** to **Live**, then **Save placement**. The catalog row is seeded with `available = 0`.
3. Users then find it under *Utilities* (`/tools/bos`), and `/bos` opens the full-screen app.
4. Optional, when the team is ready: turn on automatic sync (BOS Settings → Integrations), the Send to BOS switches, POS counter billing, private expense claims and own-only deletes (Admin → Tools → Justx BOS → Switches).

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
| Parties | `GET/POST /parties` (`truncated` past 5,000), `PATCH/DELETE /parties/:id` |
| Invoices | `GET /invoices` (`partyId`, `status=open` for unpaid only, `q` to search all; every draft and unpaid invoice plus the latest 1,000 paid or void, with `truncated` and this month's issued `month` totals when there are more), `POST /invoices`, `GET/PUT/DELETE /invoices/:id` (`canDelete` on GET), `POST /invoices/:id/issue`, `POST /invoices/:id/void`, `POST /invoices/:id/payments`, `DELETE /invoices/:id/payments/:paymentId` |
| Bills | `GET/POST /bills` (each bill has `canDelete`), `POST /bills/:id/decision`, `POST /bills/:id/pay`, `DELETE /bills/:id` |
| Expenses | `GET/POST /expenses` (with switch `bos.expenses.own_claims`, staff get only their own claims and `ownOnly: true`), `POST /expenses/:id/decision`, `POST /expenses/:id/reimburse` |
| Finance | `GET /finance/overview`, `GET /finance/gst?month=YYYY-MM` |
| HR | `/hr/departments`, `/hr/employees` (+ `/:id`, `/:id/bank`, `/:id/profile-changes`), `/hr/profile-changes` (+ `/:id/decision`), `/hr/leave` (+ `/:id/decision`, `/:id/cancel`), `GET/PUT /hr/attendance`, `/hr/holidays`, `GET /hr/overview`, `GET /hr/me` |
| Projects | `GET/POST /projects`, `PATCH /projects/:id` |
| Reports (managers) | `GET /reports/finance?from&to` (up to 3 years; registers capped at 2,000 rows each), `GET /reports/hr?month=YYYY-MM` |
| Banking (managers) | `GET /banking/overview`, `POST /banking/accounts`, `GET/PATCH/DELETE /banking/accounts/:id`, `POST /banking/accounts/:id/import`, `POST /banking/accounts/:id/transactions`, `GET /banking/transactions/:id/candidates`, `POST /banking/transactions/:id/reconcile` (`match`, `settle`, `categorize`, `exclude`), `POST /banking/transactions/:id/unreconcile`, `DELETE /banking/transactions/:id` |
| Budgets (managers) | `GET/POST /budgets` (`seed`: `blank`, `actuals`, `budget`; `uplift` %), `GET/PATCH/DELETE /budgets/:id`, `POST /budgets/:id/lines`, `PATCH/DELETE /budgets/:id/lines/:lineId` |
| Assets (managers) | `GET/POST /assets`, `GET /assets/depreciation?year`, `GET/PATCH/DELETE /assets/:id`, `POST /assets/:id/assign` (`employeeId: null` returns it), `/transfer`, `/maintenance` (`start`, `end`), `/dispose`, `/reinstate` |
| Accounting (managers) | `GET /accounting/overview`, `GET /accounting/ledger?account&from&to`, `GET /accounting/trial-balance?from&to` (ranges default to this financial year, up to 5 years), `POST /accounting/accounts`, `PATCH/DELETE /accounting/accounts/:id`, `GET /accounting/opening?suggest=date`, `PUT /accounting/opening`, `GET/POST /accounting/journals`, `GET /accounting/journals/:id`, `POST /accounting/journals/:id/void` |
| Recruitment (managers) | `GET /recruitment/overview` (up to 3,000 latest applications), `POST /recruitment/openings`, `PATCH/DELETE /recruitment/openings/:id`, `POST /recruitment/candidates`, `GET/PATCH/DELETE /recruitment/candidates/:id`, `POST /recruitment/candidates/:id/stage`, `/interview`, `/offer`, `/offer-response` (`accepted`, `declined`), `/undo-hire`, `/notes`, `/employee`, `PATCH /recruitment/candidates/:id/onboarding` |
| Performance (managers) | `GET /performance/overview` (up to 3,000 latest records each), `POST /performance/programs`, `PATCH/DELETE /performance/programs/:id`, `POST /performance/enrollments`, `PATCH /performance/enrollments/:id`, `POST /performance/enrollments/:id/complete`, `/cancel`, `POST /performance/certifications`, `PATCH/DELETE /performance/certifications/:id`, `POST /performance/kras`, `PATCH/DELETE /performance/kras/:id`, `POST /performance/promotions`, `POST /performance/promotions/:id/decision` (`apply` updates the employee), `DELETE /performance/promotions/:id`, `POST /performance/pips`, `PATCH /performance/pips/:id`, `POST /performance/pips/:id/close`, `POST /performance/recognitions`, `DELETE /performance/recognitions/:id` |
| Expenses & Assets | `GET /hr/expenses-assets` (managers: the team; others: their own), `POST /travel`, `PATCH /travel/:id` (pending; the traveller or a manager), `POST /travel/:id/decision` (managers), `POST /travel/:id/cancel`. Assets and claims use the Assets and Expenses endpoints |
| Employee Services | `GET /services/overview` (managers: every request; others: their own), `GET /services/requests/:id` (request, thread and letter), `POST /services/requests`, `PATCH /services/requests/:id` (open; the requester or a manager; priority is managers only), `POST /services/requests/:id/assign`, `/resolve` (managers), `/comments` (internal notes: managers), `/reopen`, `/cancel` |
| Policies & Compliance | `GET /policies/overview` (managers: everything; others: published policies and their own agreements), `GET /policies/pending` (the caller's unacknowledged policies, for Home), `GET /policies/:id` (text, and the register for managers), `POST /policies/:id/acknowledge`. Managers: `POST /policies`, `PATCH /policies/:id` (`newVersion` to re-acknowledge), `POST /policies/:id/publish`, `/archive`, `/restore`, `DELETE /policies/:id`, `POST /policies/:id/acknowledgements`, `DELETE /policies/:id/acknowledgements/:employeeId`, `POST /compliance`, `POST /compliance/templates`, `PATCH /compliance/:id`, `POST /compliance/:id/done`, `/reopen`, `DELETE /compliance/:id`, `POST /agreements`, `PATCH /agreements/:id`, `POST /agreements/:id/end`, `/reinstate`, `DELETE /agreements/:id` |
| Sales Billing | `GET /sales/overview`, `GET /sales/docs/:id` (with its linked documents), `POST /sales/docs` (`kind`: `quotation`, `order`, `challan`; `send` for quotations), `PUT /sales/docs/:id`, `POST /sales/docs/:id/send`, `/decide` (`accepted`, `declined`), `/order`, `/challan`, `/invoice`, `/dispatch`, `/deliver`, `/cancel` (managers), `DELETE /sales/docs/:id`, `GET /sales/items`, `POST /sales/items`, `PATCH/DELETE /sales/items/:id` (managers), `GET /sales/pos`, `POST /sales/pos` (switch `bos.sales.pos`) |
| Payroll (managers) | `GET/PUT /payroll/settings`, `GET /payroll/structures`, `PUT /payroll/structures/:employeeId`, `GET /payroll/overview`, `GET/POST /payroll/runs`, `GET/DELETE /payroll/runs/:id`, `POST /payroll/runs/:id/recalculate`, `/finalize`, `/reopen`, `/pay`, `GET /payroll/runs/:id/bank-advice` (audited), `PATCH /payroll/payslips/:id` |
| Payroll (self) | `GET /payroll/me`, `GET /payroll/payslips/:id` and `GET /payroll/employees/:employeeId/payslips` (managers, or the employee for their own finalised payslips) |
| Connect | `GET /connect`, `GET /connect/:tool`, `POST /connect/:tool/:ref/import`, `POST /connect/sync`, `GET /links?sourceTool&sourceRef` |

## Verification

```bash
cd server && npx tsc --noEmit -p . && npx vitest run
cd web && npx tsc --noEmit -p . && npx eslint components/bos-app lib/bos-app app/bos && npx vitest run components/bos-app lib/bos-app
```

`web/components/bos-app/BosApp.test.tsx` renders the whole app against a mocked API. It walks every workspace and module, checks live GST maths in the invoice editor, the deep links (including a project handed off from Site Survey), the pending-migration notice, and that reports render for owners while staff see a notice and never call the report API. It also opens a payroll run from a notification link and drills into the payslip, and checks that staff can open their own payslip from My Profile but not payroll runs. For Banking it imports an HDFC-style CSV through the column preview and accepts a reconciliation suggestion. For Budgeting it opens a budget that's over, then budgets an unbudgeted category from last year's spend. For Assets it checks the register's method and book value, opens an asset and disposes of it. For Accounting it checks the chart's type badges and normal-side balances, then posts a manual entry that must balance before it goes. For Recruitment it checks the KPIs and the new-joiner checklist, then opens a candidate from the pipeline and records an accepted offer. For Performance it marks a training complete (the certificate note and the date sent) and approves a promotion with the employee-record update on. For Expenses & Assets it flags an overdue return, records it, and approves a travel request. For Employee Services it checks the helpdesk KPI and the type filter, opens a certificate request, adds an internal note, previews the letter and resolves the request. For Policies & Compliance it reads and acknowledges a mandatory policy, marks a filing filed with its reference, adds a standard filing, and follows the My Profile reminder to a policy updated since it was last acknowledged and its acknowledgement register. For Sales Billing it filters to what's ready to invoice, opens a delivered sales order and turns it into a draft invoice, and, with the POS switch on, rings up a two-unit UPI bill and shows the receipt. `lib/bos-app/statement.test.ts` covers the CSV reader on HDFC, SBI, ICICI, Dr/Cr and signed-amount layouts, dates and amounts. `SendToBos.test.tsx` covers the button in every state: switch off, BOS not Live, unsaved, draft, sent, already linked and refused. On the server, `server/src/bos/router.test.ts` checks over HTTP the sign-in and enabled gates, the managers-only reports, payroll, banking, budget, asset, accounting, recruitment and performance routes and their input checks, travel-request checks and approval, the managers-only service-request actions (assign, resolve, priority, internal notes) and their input checks, the managers-only policy, compliance and agreement actions and their input checks (including links that aren't http/https), the managers-only catalog and cancel actions, that the POS counter refuses while its switch is off before reading anything, the sales-document, item and counter-bill input checks, and that staff can't claim expenses or request travel for a colleague. `logic.test.ts` covers the pure rules, including the sync summary, report periods, profit & loss, and attendance percentages. `payroll-logic.test.ts` covers the salary split from CTC, PF with and without the wage cap, ESI eligibility, PT slabs, the new-regime tax estimate, loss of pay and the deduction cap. `banking-logic.test.ts` covers statement-line fingerprints and how reconciliation candidates are filtered, ranked and suggested. `budget-logic.test.ts` covers financial-year months, budget to date, status and projection, seeding with an uplift, and how spend is attributed by category and by department. `asset-logic.test.ts` covers SLM and WDV schedules, pro-rata first years (including a leap year), the salvage floor, disposal, calendar financial years and a year's opening, additions, depreciation and closing. `accounting-logic.test.ts` covers every posting rule (GST split, category routing, cash versus bank, payroll deductions, assets funded by a bill or suspense, depreciation and disposal), that every posting balances, period movements, opening balances and their suggestion, the profit & loss and balance-sheet totals, and manual-entry checks. `recruitment-logic.test.ts` covers the allowed stage moves, onboarding progress (not started, on track, delayed, completed), and the hiring KPIs. `performance-logic.test.ts` covers certificate expiry (month-end clamping) and status, fiscal quarters, current KRAs, the training, certification, plan and KRA totals, and promotion checks. `context.test.ts` checks that a partial update (`PATCH`) only changes the fields sent: an omitted field is never reset to its default. `travel-logic.test.ts` covers trip-date checks, trip phases, who can cancel, return states and the Expenses & Assets totals. `services-logic.test.ts` covers resolution time, the letter rules (experience letters only once someone is leaving, salary certificates need a CTC, only experience letters after exit) and the Employee Services totals, including the month-on-month resolution average. `policy-logic.test.ts` covers repeating due dates (keeping the day after a short month), the first due date of each standard filing, filing and agreement states, agreement checks and links, and the acknowledgement, filing and agreement totals. `sales-logic.test.ts` covers matching challan lines to the order (part shipments, repeated lines, cancelled challans), the delivered share, every document stage, the rules that stop double invoicing, a second order or an extra challan, edit locks, the Sales Billing totals, and POS totals by payment method.
