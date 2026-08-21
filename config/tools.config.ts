export type ToolType = "document" | "tracker" | "calculator" | "utility" | "screen";

export type ToolCatalogEntry = {
  id: string;
  name: string;
  category: string;
  icon: string;
  desc: string;
};

export type ToolDefinition = ToolCatalogEntry & {
  type: ToolType;
  subscriptionExempt: boolean;
  route: string;
  showOnHome: boolean;
};

export const TOOL_CATEGORIES = [
  "Sales & Business",
  "Procurement",
  "Inventory",
  "Projects & Service",
  "Solar Solutions",
  "Finance & Calculators",
  "Dealers / Distributors",
  "Utilities",
] as const;

/** Raw catalog (may contain duplicate ids across categories). */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { id: "quotation", name: "Quotation Creator", category: "Sales & Business", icon: "📝", desc: "Send professional quotes fast" },
  { id: "quotationv1", name: "Quotation Generator V1", category: "Sales & Business", icon: "📑", desc: "Category-based quotes with GST, PDF & approval" },
  { id: "salesorder", name: "Sales Order Creator", category: "Sales & Business", icon: "🧾", desc: "Confirm orders with customers" },
  { id: "invoice", name: "Invoice Creator", category: "Sales & Business", icon: "🧮", desc: "GST-ready tax invoices" },
  { id: "paymenttracker", name: "Payment Tracker", category: "Sales & Business", icon: "💰", desc: "Receivables & payables in one list" },
  { id: "po", name: "Purchase Order (PO) Creator", category: "Procurement", icon: "📦", desc: "Order from your suppliers" },
  { id: "vendors", name: "Vendor Directory", category: "Procurement", icon: "🏭", desc: "Vendors & categories, organized" },
  { id: "stock", name: "Stock In / Stock Out", category: "Inventory", icon: "📊", desc: "Track every unit that moves" },
  { id: "projects", name: "Project Creator", category: "Projects & Service", icon: "🗂️", desc: "Track jobs from start to finish" },
  { id: "amc", name: "AMC Tracker", category: "Projects & Service", icon: "🛠️", desc: "Never miss a renewal" },
  { id: "servicetasks", name: "Service Task Creator", category: "Projects & Service", icon: "🔧", desc: "Assign and track service visits" },
  { id: "installation", name: "Installation Report", category: "Projects & Service", icon: "📋", desc: "Document completed installs" },
  { id: "solarroi", name: "Solar ROI Calculator", category: "Solar Solutions", icon: "☀️", desc: "Payback period & savings" },
  { id: "sitesurvey", name: "Solar Site Survey", category: "Solar Solutions", icon: "🏠", desc: "Capture site details on the spot" },
  { id: "gstcalc", name: "GST Calculator", category: "Finance & Calculators", icon: "🧾", desc: "Add or remove GST instantly" },
  { id: "tdscalc", name: "TDS Calculator", category: "Finance & Calculators", icon: "📉", desc: "Work out TDS deductions" },
  { id: "taxcalc", name: "Tax Calculator", category: "Finance & Calculators", icon: "💼", desc: "Old vs new regime, estimated" },
  { id: "profitcalc", name: "Profit Calculator", category: "Finance & Calculators", icon: "📈", desc: "Margin, markup & profit" },
  { id: "emicalc", name: "EMI Calculator", category: "Finance & Calculators", icon: "🏦", desc: "Monthly instalment breakdown" },
  { id: "loancalc", name: "Loan Calculator", category: "Finance & Calculators", icon: "💳", desc: "Total interest & repayment" },
  { id: "po", name: "Purchase Order (PO) Creator", category: "Dealers / Distributors", icon: "📦", desc: "Order stock from your principal" },
  { id: "profitcalc", name: "Profit Calculator", category: "Dealers / Distributors", icon: "📈", desc: "Check margins before you quote" },
  { id: "dealercommission", name: "Commission Calculator", category: "Dealers / Distributors", icon: "🤝", desc: "Work out dealer commission" },
  { id: "pricelist", name: "Price List Manager", category: "Dealers / Distributors", icon: "🏷️", desc: "Keep product pricing current" },
  { id: "creditlimit", name: "Credit Limit Tracker", category: "Dealers / Distributors", icon: "🪪", desc: "Track exposure per customer" },
  { id: "targettracker", name: "Target vs Achievement", category: "Dealers / Distributors", icon: "🎯", desc: "Monthly targets at a glance" },
  { id: "dealerorders", name: "Dealer Order Tracker", category: "Dealers / Distributors", icon: "🚚", desc: "Orders placed with your principal" },
  { id: "visitors", name: "Visitor & Appointment Manager", category: "Utilities", icon: "🗓️", desc: "Log visits & upcoming meetings" },
  { id: "notifications", name: "Notifications", category: "Utilities", icon: "🔔", desc: "Reminders across every tool" },
  { id: "qrscanner", name: "QR Code Scanner", category: "Utilities", icon: "🔳", desc: "Scan or generate QR codes" },
];

const TOOL_TYPES: Record<string, ToolType> = {
  quotation: "document",
  quotationv1: "utility",
  salesorder: "document",
  invoice: "document",
  po: "document",
  paymenttracker: "tracker",
  vendors: "tracker",
  stock: "tracker",
  projects: "tracker",
  amc: "tracker",
  servicetasks: "tracker",
  installation: "tracker",
  sitesurvey: "tracker",
  pricelist: "tracker",
  creditlimit: "tracker",
  targettracker: "tracker",
  dealerorders: "tracker",
  visitors: "tracker",
  gstcalc: "calculator",
  tdscalc: "calculator",
  taxcalc: "calculator",
  profitcalc: "calculator",
  emicalc: "calculator",
  loancalc: "calculator",
  solarroi: "calculator",
  dealercommission: "calculator",
  qrscanner: "utility",
  notifications: "screen",
};

export function uniqueTools(): ToolCatalogEntry[] {
  const seen = new Set<string>();
  return TOOL_CATALOG.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export function getToolDefinition(id: string): ToolDefinition | undefined {
  const entry = uniqueTools().find((t) => t.id === id);
  if (!entry) return undefined;
  const type = TOOL_TYPES[id] ?? "utility";
  const subscriptionExempt =
    id !== "quotationv1" &&
    (type === "calculator" || type === "utility" || id === "notifications");
  return {
    ...entry,
    type,
    subscriptionExempt,
    route: id === "notifications" ? "/notifications" : `/tools/${id}`,
    showOnHome: id !== "notifications",
  };
}

export function toolsByCategory(): Array<{ category: string; tools: ToolDefinition[] }> {
  const map = new Map<string, ToolDefinition[]>();
  for (const cat of TOOL_CATEGORIES) {
    map.set(cat, []);
  }
  for (const entry of TOOL_CATALOG) {
    const def = getToolDefinition(entry.id);
    if (!def || !def.showOnHome) continue;
    const list = map.get(entry.category);
    if (list && !list.some((t) => t.id === def.id)) {
      list.push(def);
    }
  }
  return TOOL_CATEGORIES.map((category) => ({
    category,
    tools: map.get(category) ?? [],
  })).filter((g) => g.tools.length > 0);
}

export const DOCUMENT_TOOL_IDS = ["quotation", "salesorder", "invoice", "po"] as const;
export const TRACKER_TOOL_IDS = [
  "paymenttracker", "vendors", "stock", "projects", "amc", "servicetasks",
  "installation", "sitesurvey", "pricelist", "creditlimit", "targettracker",
  "dealerorders", "visitors",
] as const;

export type DocumentToolId = (typeof DOCUMENT_TOOL_IDS)[number];

export type DocumentConfig = {
  key: DocumentToolId;
  title: string;
  docLabel: string;
  prefix: string;
  partyLabel: string;
  partyIcon: string;
  dateLabel: string;
  extraDateLabel: string;
  subtitle: string;
  showTax: boolean;
};

export const DOCUMENT_CONFIGS: Record<DocumentToolId, DocumentConfig> = {
  quotation: {
    key: "quotation", title: "Quotation Creator", docLabel: "QUOTATION", prefix: "QTN",
    partyLabel: "Customer", partyIcon: "🙍", dateLabel: "Quotation Date", extraDateLabel: "Valid Till",
    subtitle: "Send a professional quote in under a minute.", showTax: true,
  },
  salesorder: {
    key: "salesorder", title: "Sales Order Creator", docLabel: "SALES ORDER", prefix: "SO",
    partyLabel: "Customer", partyIcon: "🙍", dateLabel: "Order Date", extraDateLabel: "Expected Delivery",
    subtitle: "Confirm what the customer has agreed to buy.", showTax: true,
  },
  invoice: {
    key: "invoice", title: "Invoice Creator", docLabel: "TAX INVOICE", prefix: "INV",
    partyLabel: "Customer", partyIcon: "🙍", dateLabel: "Invoice Date", extraDateLabel: "Due Date",
    subtitle: "GST-ready tax invoice, saved to Payment Tracker automatically.", showTax: true,
  },
  po: {
    key: "po", title: "Purchase Order (PO) Creator", docLabel: "PURCHASE ORDER", prefix: "PO",
    partyLabel: "Vendor", partyIcon: "🏭", dateLabel: "PO Date", extraDateLabel: "Expected By",
    subtitle: "Order stock or materials from a vendor.", showTax: true,
  },
};

export type TrackerFieldType = "text" | "number" | "date" | "select" | "textarea" | "computed";

export type TrackerField = {
  key: string;
  label: string;
  type: TrackerFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  /** For type === "computed" */
  formula?: string;
};

export type TrackerConfig = {
  key: string;
  title: string;
  icon: string;
  subtitle: string;
  addLabel: string;
  fields: TrackerField[];
  titleField: string;
  subtitleFields: string[];
  metaFields: Array<{ key: string; label: string; money?: boolean; date?: boolean }>;
  statusField: string | null;
  statusColors?: Record<string, string>;
};

export const TRACKER_CONFIGS: Record<string, TrackerConfig> = {
  paymenttracker: {
    key: "paymenttracker", title: "Payment Tracker", icon: "💰",
    subtitle: "Accounts Receivable & Accounts Payable, together.",
    addLabel: "+ Add Entry",
    fields: [
      { key: "kind", label: "Type", type: "select", options: ["Receivable", "Payable"], required: true },
      { key: "party", label: "Party Name", type: "text", required: true, placeholder: "e.g. Shiv Engineering" },
      { key: "ref", label: "Reference No.", type: "text", placeholder: "Invoice / Bill No." },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "amount", label: "Amount (₹)", type: "number", required: true },
      { key: "status", label: "Status", type: "select", options: ["Pending", "Partially Paid", "Paid", "Overdue"], required: true },
    ],
    titleField: "party", subtitleFields: ["ref", "date"], metaFields: [{ key: "amount", label: "Amount", money: true }], statusField: "status",
    statusColors: { Paid: "success", Pending: "warning", "Partially Paid": "warning", Overdue: "danger" },
  },
  vendors: {
    key: "vendors", title: "Vendor Directory", icon: "🏭",
    subtitle: "Vendors and categories, organized in one place.",
    addLabel: "+ Add Vendor",
    fields: [
      { key: "name", label: "Vendor Name", type: "text", required: true },
      { key: "category", label: "Category", type: "text", placeholder: "e.g. Solar Panels, Cabling" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "gstin", label: "GSTIN", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    titleField: "name", subtitleFields: ["category", "phone"], metaFields: [], statusField: null,
  },
  stock: {
    key: "stock", title: "Stock In / Stock Out", icon: "📊",
    subtitle: "Track every unit that comes in or goes out.",
    addLabel: "+ Add Entry",
    fields: [
      { key: "direction", label: "Direction", type: "select", options: ["Stock In", "Stock Out"], required: true },
      { key: "item", label: "Item Name", type: "text", required: true },
      { key: "qty", label: "Quantity", type: "number", required: true },
      { key: "unit", label: "Unit", type: "text", placeholder: "e.g. NOS, KG, BOX" },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "reference", label: "Reference", type: "text", placeholder: "PO / Invoice / Note" },
    ],
    titleField: "item", subtitleFields: ["reference", "date"], metaFields: [{ key: "qty", label: "Qty" }], statusField: "direction",
    statusColors: { "Stock In": "success", "Stock Out": "warning" },
  },
  projects: {
    key: "projects", title: "Project Creator", icon: "🗂️",
    subtitle: "Track jobs from kickoff to completion.",
    addLabel: "+ New Project",
    fields: [
      { key: "name", label: "Project Name", type: "text", required: true },
      { key: "client", label: "Client", type: "text" },
      { key: "startDate", label: "Start Date", type: "date" },
      { key: "endDate", label: "Target End Date", type: "date" },
      { key: "budget", label: "Budget (₹)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Planning", "In Progress", "On Hold", "Completed"], required: true },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    titleField: "name", subtitleFields: ["client", "endDate"], metaFields: [{ key: "budget", label: "Budget", money: true }], statusField: "status",
    statusColors: { Completed: "success", "In Progress": "warning", Planning: "neutral", "On Hold": "danger" },
  },
  amc: {
    key: "amc", title: "AMC Tracker", icon: "🛠️",
    subtitle: "Never miss an annual maintenance renewal.",
    addLabel: "+ Add AMC",
    fields: [
      { key: "client", label: "Client Name", type: "text", required: true },
      { key: "contractNo", label: "Contract No.", type: "text" },
      { key: "startDate", label: "Start Date", type: "date" },
      { key: "renewalDate", label: "Renewal Due", type: "date", required: true },
      { key: "value", label: "Contract Value (₹)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Active", "Due for Renewal", "Expired"], required: true },
    ],
    titleField: "client", subtitleFields: ["contractNo", "renewalDate"], metaFields: [{ key: "value", label: "Value", money: true }], statusField: "status",
    statusColors: { Active: "success", "Due for Renewal": "warning", Expired: "danger" },
  },
  servicetasks: {
    key: "servicetasks", title: "Service Task Creator", icon: "🔧",
    subtitle: "Assign and track every service visit.",
    addLabel: "+ New Task",
    fields: [
      { key: "title", label: "Task Title", type: "text", required: true },
      { key: "client", label: "Client", type: "text" },
      { key: "assignedTo", label: "Assigned To", type: "text" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High", "Urgent"] },
      { key: "status", label: "Status", type: "select", options: ["Open", "In Progress", "Completed"], required: true },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    titleField: "title", subtitleFields: ["client", "assignedTo"], metaFields: [{ key: "dueDate", label: "Due", date: true }], statusField: "status",
    statusColors: { Completed: "success", "In Progress": "warning", Open: "neutral" },
  },
  installation: {
    key: "installation", title: "Installation Report", icon: "📋",
    subtitle: "Document completed installations.",
    addLabel: "+ New Report",
    fields: [
      { key: "client", label: "Client Name", type: "text", required: true },
      { key: "site", label: "Site Address", type: "text" },
      { key: "installDate", label: "Installation Date", type: "date", required: true },
      { key: "capacity", label: "System / Scope", type: "text", placeholder: "e.g. 5kW Solar System" },
      { key: "engineer", label: "Engineer / Technician", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["Completed", "Pending Handover", "Needs Revisit"], required: true },
      { key: "notes", label: "Remarks", type: "textarea" },
    ],
    titleField: "client", subtitleFields: ["site", "capacity"], metaFields: [{ key: "installDate", label: "Date", date: true }], statusField: "status",
    statusColors: { Completed: "success", "Pending Handover": "warning", "Needs Revisit": "danger" },
  },
  sitesurvey: {
    key: "sitesurvey", title: "Solar Site Survey", icon: "🏠",
    subtitle: "Capture site details on the spot.",
    addLabel: "+ New Survey",
    fields: [
      { key: "client", label: "Client Name", type: "text", required: true },
      { key: "site", label: "Site Address", type: "text", required: true },
      { key: "surveyDate", label: "Survey Date", type: "date", required: true },
      { key: "roofType", label: "Roof Type", type: "select", options: ["RCC Flat", "Metal Sheet", "Tile", "Ground Mount", "Other"] },
      { key: "roofArea", label: "Available Roof Area (sq.ft)", type: "number" },
      { key: "shading", label: "Shading Observed", type: "select", options: ["None", "Minor", "Significant"] },
      { key: "sanctionedLoad", label: "Sanctioned Load (kW)", type: "number" },
      { key: "surveyor", label: "Surveyor Name", type: "text" },
      { key: "notes", label: "Site Notes", type: "textarea" },
    ],
    titleField: "client", subtitleFields: ["site", "roofType"], metaFields: [{ key: "roofArea", label: "Roof (sq.ft)" }], statusField: null,
  },
  pricelist: {
    key: "pricelist", title: "Price List Manager", icon: "🏷️",
    subtitle: "Keep product pricing current for your team.",
    addLabel: "+ Add Product",
    fields: [
      { key: "product", label: "Product Name", type: "text", required: true },
      { key: "sku", label: "SKU / Code", type: "text" },
      { key: "costPrice", label: "Cost Price (₹)", type: "number" },
      { key: "sellPrice", label: "Selling Price (₹)", type: "number", required: true },
      { key: "unit", label: "Unit", type: "text", placeholder: "e.g. NOS, KG" },
      { key: "updated", label: "Last Updated", type: "date" },
    ],
    titleField: "product", subtitleFields: ["sku", "unit"], metaFields: [{ key: "sellPrice", label: "Price", money: true }], statusField: null,
  },
  creditlimit: {
    key: "creditlimit", title: "Credit Limit Tracker", icon: "🪪",
    subtitle: "Track credit exposure per customer.",
    addLabel: "+ Add Customer",
    fields: [
      { key: "customer", label: "Customer Name", type: "text", required: true },
      { key: "creditLimit", label: "Approved Credit Limit (₹)", type: "number", required: true },
      { key: "outstanding", label: "Current Outstanding (₹)", type: "number", required: true },
      { key: "reviewDate", label: "Next Review Date", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    titleField: "customer", subtitleFields: ["reviewDate"], metaFields: [
      { key: "outstanding", label: "Outstanding", money: true },
      { key: "creditLimit", label: "Limit", money: true },
    ], statusField: null,
  },
  targettracker: {
    key: "targettracker", title: "Target vs Achievement", icon: "🎯",
    subtitle: "Monthly sales targets at a glance.",
    addLabel: "+ Add Month",
    fields: [
      { key: "period", label: "Month / Period", type: "text", required: true, placeholder: "e.g. August 2026" },
      { key: "salesperson", label: "Salesperson / Dealer", type: "text" },
      { key: "target", label: "Target (₹)", type: "number", required: true },
      { key: "achieved", label: "Achieved (₹)", type: "number", required: true },
    ],
    titleField: "period", subtitleFields: ["salesperson"], metaFields: [
      { key: "achieved", label: "Achieved", money: true },
      { key: "target", label: "Target", money: true },
    ], statusField: null,
  },
  dealerorders: {
    key: "dealerorders", title: "Dealer Order Tracker", icon: "🚚",
    subtitle: "Orders placed with your principal, tracked to delivery.",
    addLabel: "+ Add Order",
    fields: [
      { key: "orderNo", label: "Order No.", type: "text", required: true },
      { key: "supplier", label: "Principal / Supplier", type: "text", required: true },
      { key: "orderDate", label: "Order Date", type: "date", required: true },
      { key: "expectedDate", label: "Expected Delivery", type: "date" },
      { key: "amount", label: "Order Value (₹)", type: "number" },
      { key: "status", label: "Status", type: "select", options: ["Placed", "Dispatched", "Delivered", "Delayed"], required: true },
    ],
    titleField: "orderNo", subtitleFields: ["supplier", "expectedDate"], metaFields: [{ key: "amount", label: "Value", money: true }], statusField: "status",
    statusColors: { Delivered: "success", Dispatched: "warning", Placed: "neutral", Delayed: "danger" },
  },
  visitors: {
    key: "visitors", title: "Visitor & Appointment Manager", icon: "🗓️",
    subtitle: "Log visits and keep upcoming meetings organized.",
    addLabel: "+ Add Visitor / Appointment",
    fields: [
      { key: "name", label: "Visitor Name", type: "text", required: true },
      { key: "purpose", label: "Purpose", type: "text", placeholder: "e.g. Site visit, Demo, Meeting" },
      { key: "date", label: "Date", type: "date", required: true },
      { key: "time", label: "Time", type: "text", placeholder: "e.g. 3:00 PM" },
      { key: "contact", label: "Contact Number", type: "text" },
      { key: "status", label: "Status", type: "select", options: ["Scheduled", "Completed", "Cancelled"], required: true },
    ],
    titleField: "name", subtitleFields: ["purpose", "time"], metaFields: [{ key: "date", label: "Date", date: true }], statusField: "status",
    statusColors: { Completed: "success", Scheduled: "warning", Cancelled: "danger" },
  },
};
