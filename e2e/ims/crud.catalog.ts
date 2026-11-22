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
    title: "Sales — Invoices + POS counter tabs",
    module: "sales",
    mutates: false,
    manualChecks: ["Invoices list", "POS counter UI"],
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
];
