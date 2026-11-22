/**
 * IMS CRUD + tab-flow catalog for JustTestX production E2E.
 * IDs feed MANUAL_VERIFY via the IMS scenario reporter.
 */

export type ImsCrudScenario = {
  id: string;
  title: string;
  module: string;
  mutates: boolean;
  manualChecks: string[];
};

export const IMS_CRUD_SCENARIOS: ReadonlyArray<ImsCrudScenario> = [
  // ── Inventory ──────────────────────────────────────────────────────────
  {
    id: "CRUD-ITEMS-C",
    title: "Items — create item with E2E marker",
    module: "items",
    mutates: true,
    manualChecks: ["E2E item appears in list", "SKU searchable", "Opening stock optional"],
  },
  {
    id: "CRUD-ITEMS-R",
    title: "Items — search / read seeded SKU",
    module: "items",
    mutates: false,
    manualChecks: ["JX-CRIMP or seeded SKU found", "Row opens detail"],
  },
  {
    id: "CRUD-ITEMS-U",
    title: "Items — open editor for update path",
    module: "items",
    mutates: false,
    manualChecks: ["Edit dialog / Save changes visible", "Cancel closes without crash"],
  },
  {
    id: "FLOW-STOCK-IN",
    title: "Stock In — post with E2E note",
    module: "stockin",
    mutates: true,
    manualChecks: ["Toast Stock received", "History shows E2E note"],
  },
  {
    id: "FLOW-STOCK-OUT",
    title: "Stock Out — post with E2E note",
    module: "stockout",
    mutates: true,
    manualChecks: ["Toast Stock issued", "Qty decreased for SKU"],
  },
  {
    id: "FLOW-STOCK-CHECK",
    title: "Stock Check — open New stock check / start UI",
    module: "checks",
    mutates: false,
    manualChecks: ["New stock check dialog", "Start counting CTA"],
  },
  {
    id: "FLOW-RETURNS-CREATE",
    title: "Damage & Returns — open Customer return form",
    module: "returns",
    mutates: false,
    manualChecks: ["Customer return dialog", "Record return CTA"],
  },
  {
    id: "TAB-STOCK-EXPORT",
    title: "Full Stock — filter + CSV/Excel export controls",
    module: "stock",
    mutates: false,
    manualChecks: ["Search stock works", "CSV and Excel buttons present"],
  },
  {
    id: "TAB-LOW-STOCK",
    title: "Restock List — walk supplier / items / dead tabs",
    module: "lowstock",
    mutates: false,
    manualChecks: ["By supplier tab", "All low items", "Dead stock"],
  },
  {
    id: "TAB-HISTORY",
    title: "History — Stock movements + Activity log tabs",
    module: "history",
    mutates: false,
    manualChecks: ["Movement type filters", "Activity entity filters"],
  },
  {
    id: "FLOW-SCANNER",
    title: "QR Stock Scan — manual code lookup",
    module: "scanner",
    mutates: false,
    manualChecks: ["Item code field", "Lookup finds seeded SKU"],
  },

  // ── Purchasing ─────────────────────────────────────────────────────────
  {
    id: "CRUD-PARTY-SUP",
    title: "Parties — add supplier with E2E marker",
    module: "parties",
    mutates: true,
    manualChecks: ["Supplier added toast", "Name searchable in list"],
  },
  {
    id: "CRUD-PARTY-CUS",
    title: "Parties — add customer with E2E marker",
    module: "parties",
    mutates: true,
    manualChecks: ["Customer added toast", "Customers tab lists E2E party"],
  },
  {
    id: "FLOW-PO-DRAFT",
    title: "Purchase Orders — new PO draft save",
    module: "purchase",
    mutates: true,
    manualChecks: ["New purchase order editor", "Save draft succeeds"],
  },
  {
    id: "TAB-APPROVALS",
    title: "Approvals — walk PO / bills / checks / history tabs",
    module: "approvals",
    mutates: false,
    manualChecks: ["Each queue loads", "No crash on tab switch"],
  },

  // ── Sales & Finance ────────────────────────────────────────────────────
  {
    id: "FLOW-INV-DRAFT",
    title: "Sales — new invoice draft save",
    module: "sales",
    mutates: true,
    manualChecks: ["Customer * required", "Save draft toast"],
  },
  {
    id: "TAB-SALES-POS",
    title: "Sales — Invoices + Recurring + POS counter tabs",
    module: "sales",
    mutates: false,
    manualChecks: ["Invoices list", "Recurring profiles", "POS counter UI"],
  },
  {
    id: "UI-AR-RECORD",
    title: "Accounts Receivable — record payment UI visible",
    module: "receivables",
    mutates: false,
    manualChecks: ["Record payment control", "Aging / promises UI"],
  },
  {
    id: "TAB-AP",
    title: "Accounts Payable — Bills + Payment runs tabs",
    module: "payables",
    mutates: false,
    manualChecks: ["Bills list", "Payment runs tab"],
  },
  {
    id: "UI-LEDGER-PARTY",
    title: "Ledger — open party statement",
    module: "ledger",
    mutates: false,
    manualChecks: ["Find party Cascade", "Statement dialog opens"],
  },
  {
    id: "UI-CLOSING-FORM",
    title: "Daily Closing — day close form open",
    module: "closing",
    mutates: false,
    manualChecks: ["Day close tab", "History tab"],
  },

  // ── BOM ────────────────────────────────────────────────────────────────
  {
    id: "UI-BOM-LIST",
    title: "BOM Create / Maintain — list open",
    module: "bom",
    mutates: false,
    manualChecks: ["BOM list / empty state", "New BOM CTA"],
  },
  {
    id: "UI-BOM-NEW",
    title: "BOM — New BOM builder open",
    module: "bom",
    mutates: false,
    manualChecks: ["New BOM title", "Compose lines UI"],
  },
  {
    id: "UI-PKG-NEW",
    title: "Packages — New package open",
    module: "bomPackages",
    mutates: false,
    manualChecks: ["New package editor", "Cancel safe"],
  },
  {
    id: "UI-RATE-CARDS",
    title: "Rate Cards — list + New rate card",
    module: "bomRateCards",
    mutates: false,
    manualChecks: ["Rate cards list", "New rate card dialog"],
  },
  {
    id: "TAB-BOM-DC",
    title: "DC & Returns — Delivery challans + Returns tabs",
    module: "bomDc",
    mutates: false,
    manualChecks: ["Challans list", "Returns tab"],
  },
  {
    id: "UI-BOM-COMPARE",
    title: "Compare — pickers visible",
    module: "bomCompare",
    mutates: false,
    manualChecks: ["Packages / Customer BOMs mode", "Left/right pickers"],
  },

  // ── Ops / System ───────────────────────────────────────────────────────
  {
    id: "TAB-FIELD",
    title: "Onsite Track — Today / Tasks / Visit history / Day timeline",
    module: "field",
    mutates: false,
    manualChecks: ["Each field tab loads", "No crash"],
  },
  {
    id: "TAB-HELPDESK-FAQ",
    title: "Helpdesk — Tickets + FAQ tabs",
    module: "helpdesk",
    mutates: false,
    manualChecks: ["FAQ accordion", "New ticket CTA"],
  },
  {
    id: "TAB-SETTINGS-ALL",
    title: "Settings — all subtabs",
    module: "settings",
    mutates: false,
    manualChecks: ["Business / Team / Permissions / Catalog / Reminders / Map / Data"],
  },
  {
    id: "TAB-INTEGRATIONS",
    title: "Integrations — Tally / POS / Sync log",
    module: "integrations",
    mutates: false,
    manualChecks: ["Tally ERP", "POS", "Sync log"],
  },
  {
    id: "UI-CONNECT-TILES",
    title: "Connected Tools — tiles visible",
    module: "connect",
    mutates: false,
    manualChecks: ["Tools tab tiles", "Linked records tab"],
  },
  {
    id: "UI-MORE-FAVS",
    title: "More Actions — favourites toggle visible",
    module: "more",
    mutates: false,
    manualChecks: ["Edit favourites", "Show favourites only switch"],
  },

  // ── Insights ───────────────────────────────────────────────────────────
  {
    id: "FLOW-REPORTS-RUN",
    title: "Reports — catalog / run UI",
    module: "reports",
    mutates: false,
    manualChecks: ["All reports catalog", "Saved & scheduled tab"],
  },
  {
    id: "TAB-GST",
    title: "GST / HSN — all GST section tabs",
    module: "gst",
    mutates: false,
    manualChecks: ["GSTR-1 / 3B / HSN / Rate-wise / Item HSN"],
  },
  {
    id: "TAB-AUDIT",
    title: "Auditing / CA — walk auditor workspace tabs",
    module: "audit",
    mutates: false,
    manualChecks: ["Overview through Access tabs load"],
  },

  // ── Deep functional flows ──────────────────────────────────────────────
  { id: "FLOW-DASH-QA", title: "Dashboard — KPIs and quick actions", module: "dashboard", mutates: false, manualChecks: ["KPI cards", "Create invoice", "Stock in", "Create PO"] },
  { id: "FLOW-STOCKIN-PARTY", title: "Stock In — reason chips and supplier suggest", module: "stockin", mutates: false, manualChecks: ["Reason chips", "Havells suggest"] },
  { id: "FLOW-STOCKOUT-PARTY", title: "Stock Out — customer suggest Cascade", module: "stockout", mutates: false, manualChecks: ["Cascade suggest"] },
  { id: "FLOW-STOCK-AGING", title: "Full Stock — aging columns and seeded SKU", module: "stock", mutates: false, manualChecks: ["Aging", "JX-CRIMP"] },
  { id: "FLOW-ITEMS-IMPORT", title: "Items — import path visible", module: "items", mutates: false, manualChecks: ["Import CTA"] },
  { id: "FLOW-PARTY-GST", title: "Parties — GSTIN / credit visible", module: "parties", mutates: false, manualChecks: ["Havells", "GSTIN"] },
  { id: "FLOW-PO-OPEN", title: "Purchase Orders — open seeded PO", module: "purchase", mutates: false, manualChecks: ["PO document"] },
  { id: "FLOW-APPR-ACTION", title: "Approvals — Approve/Reject controls", module: "approvals", mutates: false, manualChecks: ["Approve", "Reject"] },
  { id: "FLOW-RESTOCK-PO", title: "Restock — Create PO from suggestion", module: "lowstock", mutates: false, manualChecks: ["Create PO CTA"] },
  { id: "FLOW-BOM-OPEN", title: "BOM — open seeded document", module: "bom", mutates: false, manualChecks: ["BOM opens"] },
  { id: "FLOW-BOMDC-OPEN", title: "DC — challan statuses from seed", module: "bomDc", mutates: false, manualChecks: ["DC statuses"] },
  { id: "FLOW-COMPARE-PICK", title: "Compare — pickers interact", module: "bomCompare", mutates: false, manualChecks: ["Pickers"] },
  { id: "FLOW-INV-OPEN", title: "Sales — open seeded invoice", module: "sales", mutates: false, manualChecks: ["Invoice document"] },
  { id: "FLOW-AR-PAY-UI", title: "AR — Record payment dialog", module: "receivables", mutates: false, manualChecks: ["Payment dialog"] },
  { id: "FLOW-AP-BILL-UI", title: "AP — bill / payment run UI", module: "payables", mutates: false, manualChecks: ["Bills", "Payment runs"] },
  { id: "FLOW-CLOSE-FIELDS", title: "Daily Closing — form fields", module: "closing", mutates: false, manualChecks: ["Cash/bank fields"] },
  { id: "FLOW-RETURNS-SUP", title: "Returns — supplier return form", module: "returns", mutates: false, manualChecks: ["Supplier return"] },
  { id: "FLOW-DAMAGE-UI", title: "Returns — damaged stock UI", module: "returns", mutates: false, manualChecks: ["Quarantine UI"] },
  { id: "FLOW-HIST-FILTER", title: "History — filter movements", module: "history", mutates: false, manualChecks: ["Type filter"] },
  { id: "FLOW-GST-GSTR1", title: "GST — GSTR-1 summary", module: "gst", mutates: false, manualChecks: ["GSTR-1"] },
  { id: "FLOW-AUDIT-FLAGS", title: "Auditing — overview / flags", module: "audit", mutates: false, manualChecks: ["Flags"] },
  { id: "FLOW-SETTINGS-BIZ", title: "Settings — JustTestX business name", module: "settings", mutates: false, manualChecks: ["JustTestX Distribution"] },
  { id: "FLOW-TALLY-PERIOD", title: "Integrations — Tally period picker", module: "integrations", mutates: false, manualChecks: ["Export period"] },
  { id: "FLOW-REPORT-EXPORT", title: "Reports — export control", module: "reports", mutates: false, manualChecks: ["Export"] },
  { id: "FLOW-FIELD-TODAY", title: "Onsite — Today check-in UI", module: "field", mutates: false, manualChecks: ["Check-in"] },
  { id: "FLOW-INV-ISSUE-UI", title: "Sales — Save & issue visible", module: "sales", mutates: false, manualChecks: ["Save & issue"] },
  { id: "FLOW-PO-SUBMIT-UI", title: "PO — submit/approve CTAs", module: "purchase", mutates: false, manualChecks: ["Submit/approve"] },
  { id: "MUT-AR-PROMISE", title: "AR — promises UI", module: "receivables", mutates: false, manualChecks: ["Promises due"] },
  { id: "MUT-APPR-REJECT-UI", title: "Approvals — Reject reason dialog", module: "approvals", mutates: false, manualChecks: ["Reject reason"] },
  { id: "MUT-STOCKCHECK-START", title: "Stock Check — Start counting", module: "checks", mutates: false, manualChecks: ["Start counting"] },
  { id: "MUT-ITEM-UPDATE", title: "Items — edit Save changes path", module: "items", mutates: false, manualChecks: ["Edit editor"] },
  { id: "FLOW-SHELL-BIZ", title: "Shell — JustTestX Distribution", module: "dashboard", mutates: false, manualChecks: ["Business name", "Owner"] },
];
