/** Tracker field metadata — shared between admin schema designer, API validation, and forms. */
export type TrackerFieldMeta = {
  key: string;
  type: string;
  required?: boolean;
  options?: string[];
  /** Expression for type === "computed", e.g. qty * rate * (1 + gst/100) */
  formula?: string;
};

export const BUILTIN_TRACKER_FIELDS: Record<string, TrackerFieldMeta[]> = {
  paymenttracker: [
    { key: "kind", type: "select", required: true, options: ["Receivable", "Payable"] },
    { key: "party", type: "text", required: true },
    { key: "ref", type: "text" },
    { key: "date", type: "date", required: true },
    { key: "amount", type: "number", required: true },
    { key: "status", type: "select", required: true },
  ],
  vendors: [
    { key: "name", type: "text", required: true },
    { key: "category", type: "text" },
    { key: "phone", type: "text" },
    { key: "email", type: "text" },
    { key: "gstin", type: "text" },
    { key: "notes", type: "textarea" },
  ],
  stock: [
    { key: "direction", type: "select", required: true },
    { key: "item", type: "text", required: true },
    { key: "qty", type: "number", required: true },
    { key: "unit", type: "text" },
    { key: "date", type: "date", required: true },
    { key: "reference", type: "text" },
  ],
  projects: [
    { key: "name", type: "text", required: true },
    { key: "client", type: "text" },
    { key: "startDate", type: "date" },
    { key: "endDate", type: "date" },
    { key: "budget", type: "number" },
    { key: "status", type: "select", required: true },
    { key: "notes", type: "textarea" },
  ],
  amc: [
    { key: "client", type: "text", required: true },
    { key: "contractNo", type: "text" },
    { key: "startDate", type: "date" },
    { key: "renewalDate", type: "date", required: true },
    { key: "value", type: "number" },
    { key: "status", type: "select", required: true },
  ],
  servicetasks: [
    { key: "title", type: "text", required: true },
    { key: "client", type: "text" },
    { key: "assignedTo", type: "text" },
    { key: "dueDate", type: "date" },
    { key: "priority", type: "select" },
    { key: "status", type: "select", required: true },
    { key: "notes", type: "textarea" },
  ],
  installation: [
    { key: "client", type: "text", required: true },
    { key: "site", type: "text" },
    { key: "installDate", type: "date", required: true },
    { key: "capacity", type: "text" },
    { key: "engineer", type: "text" },
    { key: "status", type: "select", required: true },
    { key: "notes", type: "textarea" },
  ],
  sitesurvey: [
    { key: "client", type: "text", required: true },
    { key: "site", type: "text" },
    { key: "surveyDate", type: "date", required: true },
    { key: "roofType", type: "text" },
    { key: "roofArea", type: "number" },
    { key: "shading", type: "text" },
    { key: "sanctionedLoad", type: "text" },
    { key: "surveyor", type: "text" },
    { key: "notes", type: "textarea" },
  ],
  pricelist: [
    { key: "product", type: "text", required: true },
    { key: "sku", type: "text" },
    { key: "costPrice", type: "number" },
    { key: "sellPrice", type: "number" },
    { key: "unit", type: "text" },
    { key: "updated", type: "date" },
  ],
  creditlimit: [
    { key: "customer", type: "text", required: true },
    { key: "creditLimit", type: "number" },
    { key: "outstanding", type: "number" },
    { key: "reviewDate", type: "date" },
    { key: "notes", type: "textarea" },
  ],
  targettracker: [
    { key: "period", type: "text", required: true },
    { key: "salesperson", type: "text" },
    { key: "target", type: "number" },
    { key: "achieved", type: "number" },
  ],
  dealerorders: [
    { key: "orderNo", type: "text", required: true },
    { key: "supplier", type: "text" },
    { key: "orderDate", type: "date" },
    { key: "expectedDate", type: "date" },
    { key: "amount", type: "number" },
    { key: "status", type: "select", required: true },
  ],
  visitors: [
    { key: "name", type: "text", required: true },
    { key: "purpose", type: "text" },
    { key: "date", type: "date", required: true },
    { key: "time", type: "text" },
    { key: "contact", type: "text" },
    { key: "status", type: "select", required: true },
  ],
};
