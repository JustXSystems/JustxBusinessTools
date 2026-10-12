/**
 * Pure IMS business rules (no I/O). Every quantity, money, date, aging and
 * permission rule the API persists goes through here so it is unit-tested and
 * identical everywhere.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Finite number or fallback (blank / NaN → fallback). */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ---------- Dates (ISO `YYYY-MM-DD`, timezone-safe) ---------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

const toUTC = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDaysISO(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * 86_400_000);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86_400_000);
}

/** Today in the business timezone (default India), not the server's. */
export function todayISO(now: Date = new Date(), timeZone = process.env.IMS_TIMEZONE || process.env.BOS_TIMEZONE || "Asia/Kolkata"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** `26-27` for the fiscal year containing `iso` (April start by default). */
export function fiscalYearLabel(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= startMonth ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return startMonth === 1 ? String(start) : `${two(start)}-${two(start + 1)}`;
}

export function fiscalYearStart(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

export function monthStartISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function formatDocNo(prefix: string, period: string, seq: number, pad = 4): string {
  const p = String(prefix || "DOC").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) || "DOC";
  return `${p}/${period}/${String(seq).padStart(pad, "0")}`;
}

/** Period presets used by history, reports and dashboards. */
export const PERIODS = ["today", "yesterday", "7d", "30d", "mtd", "lastmonth", "qtd", "fytd", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export function periodRange(period: string, today: string, fyStartMonth = 4, custom?: { from?: string; to?: string }): { from: string; to: string } {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDaysISO(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDaysISO(today, -6), to: today };
    case "mtd":
      return { from: monthStartISO(today), to: today };
    case "lastmonth": {
      const end = addDaysISO(monthStartISO(today), -1);
      return { from: monthStartISO(end), to: end };
    }
    case "qtd": {
      const [y, m] = today.split("-").map(Number);
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qm).padStart(2, "0")}-01`, to: today };
    }
    case "fytd":
      return { from: fiscalYearStart(today, fyStartMonth), to: today };
    case "custom":
      if (isISODate(custom?.from) && isISODate(custom?.to) && custom.from <= custom.to) return { from: custom.from, to: custom.to };
      return { from: addDaysISO(today, -29), to: today };
    case "30d":
    default:
      return { from: addDaysISO(today, -29), to: today };
  }
}

/* ---------- GST documents ---------- */

/** Indian GST: same state (or unknown) → CGST + SGST. Compares names or 2-digit codes, case-insensitively. */
export function isIntraState(sellerState?: string | null, placeOfSupply?: string | null): boolean {
  const a = String(sellerState ?? "").trim().toLowerCase();
  const b = String(placeOfSupply ?? "").trim().toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

export type ImsLineInput = {
  /** Linked catalog item; stock moves only for linked lines. */
  itemId?: string | null;
  name: string;
  sku?: string | null;
  hsn?: string | null;
  unit?: string | null;
  qty: number;
  rate: number;
  discountPct?: number;
  gstRate: number;
  /** Purchase orders: how much has arrived so far. */
  receivedQty?: number;
};

export type ImsLine = Required<Pick<ImsLineInput, "name" | "qty" | "rate" | "gstRate">> &
  Omit<ImsLineInput, "name" | "qty" | "rate" | "gstRate"> & {
    discountPct: number;
    gross: number;
    discount: number;
    taxable: number;
    tax: number;
    amount: number;
  };

export type ImsTotals = {
  lines: ImsLine[];
  subtotal: number;
  discountTotal: number;
  taxable: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  grandTotal: number;
};

/**
 * Line + document totals. Intra-state tax splits evenly into CGST + SGST, inter-state is IGST.
 * With `roundToRupee`, the grand total rounds to the nearest rupee and the difference is `roundOff`.
 */
export function computeTotals(input: ReadonlyArray<ImsLineInput>, intraState: boolean, roundToRupee = false): ImsTotals {
  const lines = input.map<ImsLine>((l) => {
    const qty = round3(Math.max(0, num(l.qty)));
    const rate = round2(num(l.rate));
    const discountPct = clamp(num(l.discountPct), 0, 100);
    const gstRate = clamp(num(l.gstRate), 0, 100);
    const gross = round2(qty * rate);
    const discount = round2((gross * discountPct) / 100);
    const taxable = round2(gross - discount);
    const tax = round2((taxable * gstRate) / 100);
    return {
      itemId: l.itemId || null,
      name: String(l.name ?? "").trim() || "Item",
      sku: l.sku ? String(l.sku) : null,
      hsn: l.hsn ? String(l.hsn) : null,
      unit: l.unit ? String(l.unit) : null,
      qty,
      rate,
      discountPct,
      gstRate,
      ...(l.receivedQty !== undefined ? { receivedQty: round3(Math.max(0, num(l.receivedQty))) } : {}),
      gross,
      discount,
      taxable,
      tax,
      amount: round2(taxable + tax),
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discount, 0));
  const taxable = round2(subtotal - discountTotal);
  const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));
  const cgst = intraState ? round2(taxTotal / 2) : 0;
  const sgst = intraState ? round2(taxTotal - cgst) : 0;
  const igst = intraState ? 0 : taxTotal;
  const exact = round2(taxable + taxTotal);
  const grandTotal = roundToRupee ? Math.round(exact) : exact;
  return { lines, subtotal, discountTotal, taxable, taxTotal, cgst, sgst, igst, roundOff: round2(grandTotal - exact), grandTotal };
}

/** Per-HSN rollup for GST returns (HSN summary of GSTR-1). */
export function hsnSummary(lines: ReadonlyArray<Pick<ImsLine, "hsn" | "unit" | "qty" | "taxable" | "tax" | "gstRate">>): Array<{ hsn: string; unit: string; gstRate: number; qty: number; taxable: number; tax: number }> {
  const map = new Map<string, { hsn: string; unit: string; gstRate: number; qty: number; taxable: number; tax: number }>();
  for (const l of lines) {
    const hsn = l.hsn || "—";
    const key = `${hsn}|${l.gstRate}`;
    const row = map.get(key) ?? { hsn, unit: l.unit || "", gstRate: l.gstRate, qty: 0, taxable: 0, tax: 0 };
    row.qty = round3(row.qty + l.qty);
    row.taxable = round2(row.taxable + l.taxable);
    row.tax = round2(row.tax + l.tax);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.gstRate - b.gstRate);
}

/* ---------- Stock ---------- */

export const STOCK_STATUSES = ["GOOD", "LOW", "OUT_OF_STOCK", "OVERSTOCK"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export function stockStatus(current: number, min: number, max?: number | null): StockStatus {
  if (current <= 0) return "OUT_OF_STOCK";
  if (current <= min) return "LOW";
  if (max != null && max > 0 && current > max) return "OVERSTOCK";
  return "GOOD";
}

/** Suggested reorder quantity: the item's reorder qty, else enough to reach max (or 2× min). */
export function reorderQty(item: { current: number; min: number; max?: number | null; reorderQty?: number | null }): number {
  if (item.reorderQty && item.reorderQty > 0) return item.reorderQty;
  const target = item.max && item.max > 0 ? item.max : Math.max(item.min * 2, 1);
  return round3(Math.max(0, target - item.current));
}

export const MOVEMENT_TYPES = ["OPENING", "IN", "OUT", "DAMAGE", "ADJUSTMENT", "RETURN_IN", "RETURN_OUT", "WRITE_OFF"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * How a movement changes the item's buckets. `qty` is always positive except for ADJUSTMENT,
 * where it is the signed correction. DAMAGE moves saleable units into quarantine; WRITE_OFF
 * removes quarantined units; a damaged customer return lands straight in quarantine.
 */
export function movementEffect(type: MovementType, qty: number, opts: { damaged?: boolean } = {}): { saleable: number; damaged: number } {
  const q = round3(Math.abs(qty));
  switch (type) {
    case "OPENING":
    case "IN":
      return { saleable: q, damaged: 0 };
    case "RETURN_IN":
      return opts.damaged ? { saleable: 0, damaged: q } : { saleable: q, damaged: 0 };
    case "OUT":
    case "RETURN_OUT":
      return opts.damaged ? { saleable: 0, damaged: -q } : { saleable: -q, damaged: 0 };
    case "DAMAGE":
      return { saleable: -q, damaged: q };
    case "WRITE_OFF":
      return { saleable: 0, damaged: -q };
    case "ADJUSTMENT":
      return { saleable: round3(qty), damaged: 0 };
  }
}

/** Movements that reduce saleable stock and so must respect the negative-stock rule. */
export function reducesStock(type: MovementType, qty: number): boolean {
  return movementEffect(type, qty).saleable < 0;
}

/* ---------- Aging ---------- */

export const AGING_BUCKETS = [
  { key: "0-15", label: "0–15 days", min: 0, max: 15, color: "#1FA679" },
  { key: "16-30", label: "16–30 days", min: 16, max: 30, color: "#3A80EE" },
  { key: "31-60", label: "31–60 days", min: 31, max: 60, color: "#D98A1F" },
  { key: "61-90", label: "61–90 days", min: 61, max: 90, color: "#F2711C" },
  { key: "90+", label: "90+ days", min: 91, max: Number.POSITIVE_INFINITY, color: "#E1483F" },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

export function agingBucket(days: number): AgingKey {
  const d = Math.max(0, Math.floor(days));
  return (AGING_BUCKETS.find((b) => d >= b.min && d <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).key;
}

/** Collection priority from days overdue (≥91 critical, ≥61 high, ≥31 medium). */
export type ArPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export function arPriority(daysOverdue: number): ArPriority {
  if (daysOverdue >= 91) return "CRITICAL";
  if (daysOverdue >= 61) return "HIGH";
  if (daysOverdue >= 31) return "MEDIUM";
  return "LOW";
}

/** Payables urgency: overdue / due today / due within 7 days / upcoming. */
export type ApPriority = "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "UPCOMING";
export function apPriority(dueDate: string | null, today: string): ApPriority {
  if (!dueDate) return "UPCOMING";
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return "OVERDUE";
  if (diff === 0) return "DUE_TODAY";
  if (diff <= 7) return "DUE_SOON";
  return "UPCOMING";
}

/* ---------- Sales invoices & bills ---------- */

export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceDisplayStatus = "draft" | "unpaid" | "partial" | "paid" | "overdue" | "cancelled";

export function invoiceBalance(inv: { status: string; grandTotal: number; amountPaid: number }): number {
  if (inv.status !== "issued") return 0;
  return Math.max(0, round2(inv.grandTotal - inv.amountPaid));
}

export function invoiceDisplayStatus(inv: { status: string; grandTotal: number; amountPaid: number; dueDate: string | null }, today: string): InvoiceDisplayStatus {
  if (inv.status === "draft") return "draft";
  if (inv.status === "cancelled") return "cancelled";
  const balance = invoiceBalance(inv);
  if (balance <= 0.005) return "paid";
  if (inv.dueDate && inv.dueDate < today) return "overdue";
  return inv.amountPaid > 0 ? "partial" : "unpaid";
}

export const BILL_STATUSES = ["pending_approval", "approved", "on_hold", "scheduled", "cancelled"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillDisplayStatus = BillStatus | "partial" | "paid" | "overdue";

export function billBalance(bill: { status: string; grandTotal: number; amountPaid: number }): number {
  if (bill.status === "cancelled") return 0;
  return Math.max(0, round2(bill.grandTotal - bill.amountPaid));
}

export function billDisplayStatus(bill: { status: string; grandTotal: number; amountPaid: number; dueDate: string | null }, today: string): BillDisplayStatus {
  if (bill.status === "cancelled") return "cancelled";
  if (billBalance(bill) <= 0.005) return "paid";
  if (bill.status === "pending_approval" || bill.status === "on_hold") return bill.status;
  if (bill.dueDate && bill.dueDate < today) return "overdue";
  if (bill.amountPaid > 0) return "partial";
  return bill.status as BillStatus;
}

/* ---------- Purchase orders ---------- */

export const PO_STATUSES = ["draft", "pending_approval", "approved", "rejected", "sent", "partially_received", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

const PO_FLOW: Record<PoStatus, ReadonlyArray<PoStatus>> = {
  draft: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "rejected", "draft", "cancelled"],
  approved: ["sent", "partially_received", "received", "cancelled"],
  rejected: ["draft", "cancelled"],
  sent: ["partially_received", "received", "cancelled"],
  partially_received: ["partially_received", "received"],
  received: [],
  cancelled: [],
};

export function canMovePo(from: string, to: PoStatus): boolean {
  return (PO_FLOW[from as PoStatus] ?? []).includes(to);
}

/** Below the approval limit a PO is approved on submit; at or above it needs an approver. */
export function poNeedsApproval(grandTotal: number, approvalLimit: number): boolean {
  return approvalLimit > 0 && grandTotal >= approvalLimit;
}

/** Status after receiving: received when every line is fully in, else partially received. */
export function poReceiptStatus(lines: ReadonlyArray<{ qty: number; receivedQty?: number }>): "received" | "partially_received" {
  return lines.every((l) => num(l.receivedQty) + 0.0005 >= num(l.qty)) ? "received" : "partially_received";
}

/* ---------- Roles & permissions ---------- */

export const IMS_ROLES = ["owner", "manager", "incharge", "staff", "accountant", "auditor", "field", "viewer"] as const;
export type ImsRole = (typeof IMS_ROLES)[number];

export const IMS_ROLE_LABELS: Record<ImsRole, string> = {
  owner: "Owner",
  manager: "Manager",
  incharge: "Store incharge",
  staff: "Staff",
  accountant: "Accountant",
  auditor: "CA / Auditor",
  field: "Field / Technician",
  viewer: "Viewer",
};

export const IMS_PERMISSIONS = [
  { key: "stockIn", label: "Stock in" },
  { key: "stockOut", label: "Stock out" },
  { key: "damage", label: "Damage & returns" },
  { key: "stockCheck", label: "Stock check" },
  { key: "items", label: "Add / edit items" },
  { key: "suppliers", label: "Suppliers & customers" },
  { key: "po", label: "Purchase orders" },
  { key: "approvals", label: "Approvals (PO, bills, stock checks)" },
  { key: "sales", label: "Sales invoices" },
  { key: "receivables", label: "Receivables & collections" },
  { key: "payables", label: "Payables & payments" },
  { key: "closing", label: "Daily closing & expenses" },
  { key: "field", label: "Field ops (assign & track)" },
  { key: "reports", label: "Reports & GST" },
  { key: "integrations", label: "Tally / POS integrations" },
  { key: "audit", label: "Auditor workspace" },
  { key: "settings", label: "Settings & team" },
] as const;
export type ImsPermission = (typeof IMS_PERMISSIONS)[number]["key"];
export type PermissionMatrix = Record<Exclude<ImsRole, "owner">, Record<ImsPermission, boolean>>;

const ALL_PERMS = IMS_PERMISSIONS.map((p) => p.key) as ImsPermission[];
const grant = (keys: ReadonlyArray<ImsPermission>): Record<ImsPermission, boolean> =>
  Object.fromEntries(ALL_PERMS.map((k) => [k, keys.includes(k)])) as Record<ImsPermission, boolean>;

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
  manager: grant(ALL_PERMS.filter((k) => k !== "settings" && k !== "integrations")),
  incharge: grant(["stockIn", "stockOut", "damage", "stockCheck", "po", "field"]),
  staff: grant(["stockIn", "stockOut", "damage", "stockCheck", "po", "sales"]),
  accountant: grant(["sales", "receivables", "payables", "closing", "reports", "suppliers"]),
  auditor: grant(["reports", "audit"]),
  field: grant(["field"]),
  viewer: grant(["reports"]),
};

/** Stored matrix merged over defaults; unknown roles/keys dropped, values coerced to booleans. */
export function normalizePermissions(raw: unknown): PermissionMatrix {
  const src = raw && typeof raw === "object" ? (raw as Record<string, Record<string, unknown>>) : {};
  const out = {} as PermissionMatrix;
  for (const role of Object.keys(DEFAULT_PERMISSIONS) as Array<keyof PermissionMatrix>) {
    const row = src[role] && typeof src[role] === "object" ? src[role] : {};
    out[role] = Object.fromEntries(ALL_PERMS.map((k) => [k, typeof row[k] === "boolean" ? row[k] : DEFAULT_PERMISSIONS[role][k]])) as Record<ImsPermission, boolean>;
  }
  return out;
}

export function permissionsFor(role: ImsRole, matrix: PermissionMatrix): ImsPermission[] {
  if (role === "owner") return [...ALL_PERMS];
  return ALL_PERMS.filter((k) => matrix[role]?.[k]);
}

export function isImsRole(value: unknown): value is ImsRole {
  return typeof value === "string" && (IMS_ROLES as readonly string[]).includes(value);
}

/* ---------- Taxonomy (pick-lists) ---------- */

export type Taxonomy = {
  categories: Array<{ name: string; hsn?: string | null; gstRate?: number | null }>;
  brands: string[];
  units: string[];
  locations: string[];
  damageReasons: string[];
  adjustmentReasons: string[];
  returnReasons: string[];
  holdReasons: string[];
  expenseCategories: string[];
};

export const DEFAULT_TAXONOMY: Taxonomy = {
  categories: [
    { name: "Lighting", hsn: "9405", gstRate: 18 },
    { name: "Wiring & Cables", hsn: "8544", gstRate: 18 },
    { name: "Switches & Sockets", hsn: "8536", gstRate: 18 },
    { name: "Switchgear & MCB", hsn: "8536", gstRate: 18 },
    { name: "Fans", hsn: "8414", gstRate: 18 },
    { name: "Home Appliances", hsn: "8516", gstRate: 18 },
    { name: "Industrial Motors & Drives", hsn: "8501", gstRate: 18 },
    { name: "Tools & Equipment", hsn: "8467", gstRate: 18 },
  ],
  brands: [],
  units: ["pcs", "box", "pack", "set", "mtr", "roll", "kg", "ltr", "pair", "nos"],
  locations: ["Main store"],
  damageReasons: ["Broken in transit", "Manufacturing defect", "Water damage", "Expired", "Handling damage", "Other"],
  adjustmentReasons: ["Physical count correction", "Data entry error", "Found stock", "Lost / missing", "Sample / demo", "Other"],
  returnReasons: ["Defective", "Wrong item", "Excess quantity", "Customer changed mind", "Damaged on arrival", "Other"],
  holdReasons: ["Invoice dispute", "Quantity mismatch", "Pricing issue", "PO mismatch", "Goods not received", "Service not completed", "Vendor clarification required", "Other"],
  expenseCategories: ["Salary", "Rent & office", "Utilities", "Transportation", "Fuel", "Travel", "Marketing", "Software", "Professional fees", "Miscellaneous"],
};

const strList = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, 200) : fallback;

export function normalizeTaxonomy(raw: unknown): Taxonomy {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cats = Array.isArray(src.categories)
    ? (src.categories as unknown[])
        .map((c) => (typeof c === "string" ? { name: c } : (c as Record<string, unknown>)))
        .map((c) => ({ name: String(c?.name ?? "").trim(), hsn: c?.hsn ? String(c.hsn) : null, gstRate: c?.gstRate == null ? null : clamp(num(c.gstRate), 0, 100) }))
        .filter((c) => c.name)
        .slice(0, 200)
    : DEFAULT_TAXONOMY.categories;
  return {
    categories: cats,
    brands: strList(src.brands, DEFAULT_TAXONOMY.brands),
    units: strList(src.units, DEFAULT_TAXONOMY.units),
    locations: strList(src.locations, DEFAULT_TAXONOMY.locations),
    damageReasons: strList(src.damageReasons, DEFAULT_TAXONOMY.damageReasons),
    adjustmentReasons: strList(src.adjustmentReasons, DEFAULT_TAXONOMY.adjustmentReasons),
    returnReasons: strList(src.returnReasons, DEFAULT_TAXONOMY.returnReasons),
    holdReasons: strList(src.holdReasons, DEFAULT_TAXONOMY.holdReasons),
    expenseCategories: strList(src.expenseCategories, DEFAULT_TAXONOMY.expenseCategories),
  };
}

/* ---------- Collections reminders ---------- */

export const REMINDER_RULES = [
  { key: "3b", label: "3 days before due date", offset: -3 },
  { key: "due", label: "On due date", offset: 0 },
  { key: "7d", label: "7 days overdue", offset: 7 },
  { key: "15d", label: "15 days overdue", offset: 15 },
  { key: "30d", label: "30 days overdue", offset: 30 },
  { key: "60d", label: "60 days overdue", offset: 60 },
  { key: "90d", label: "90 days overdue", offset: 90 },
] as const;
export type ReminderRuleKey = (typeof REMINDER_RULES)[number]["key"];

export type ReminderTemplate = { key: string; label: string; channel: "whatsapp" | "sms" | "email"; subject?: string; body: string };

export type ReminderSettings = { autoEnabled: boolean; rules: Record<ReminderRuleKey, boolean>; channels: Array<"whatsapp" | "sms" | "email">; templates: ReminderTemplate[] };

export const DEFAULT_REMINDERS: ReminderSettings = {
  autoEnabled: false,
  rules: { "3b": true, due: true, "7d": true, "15d": true, "30d": true, "60d": false, "90d": false },
  channels: ["whatsapp"],
  templates: [
    {
      key: "gentle",
      label: "Gentle reminder",
      channel: "whatsapp",
      body: "Dear {customer}, this is a friendly reminder that invoice {invoice} for {amount} is due on {due}. Kindly arrange the payment. – {business}",
    },
    {
      key: "overdue",
      label: "Overdue notice",
      channel: "whatsapp",
      body: "Dear {customer}, invoice {invoice} for {amount} is overdue by {days} days. Please clear the outstanding at the earliest. – {business}",
    },
    {
      key: "final",
      label: "Final notice",
      channel: "email",
      subject: "Final notice: invoice {invoice} overdue",
      body: "Dear {customer},\n\nDespite earlier reminders, invoice {invoice} for {amount} remains unpaid {days} days past its due date ({due}). Please settle it within 7 days to avoid a hold on further supplies.\n\nRegards,\n{business}",
    },
    {
      key: "sms",
      label: "SMS reminder",
      channel: "sms",
      body: "{business}: Invoice {invoice} of {amount} is due {due}. Pls pay at the earliest. Ignore if paid.",
    },
  ],
};

export function normalizeReminders(raw: unknown): ReminderSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rulesSrc = src.rules && typeof src.rules === "object" ? (src.rules as Record<string, unknown>) : {};
  const rules = Object.fromEntries(REMINDER_RULES.map((r) => [r.key, typeof rulesSrc[r.key] === "boolean" ? rulesSrc[r.key] : DEFAULT_REMINDERS.rules[r.key]])) as Record<ReminderRuleKey, boolean>;
  const channels = Array.isArray(src.channels) ? (src.channels as unknown[]).filter((c): c is "whatsapp" | "sms" | "email" => c === "whatsapp" || c === "sms" || c === "email") : DEFAULT_REMINDERS.channels;
  const templates = Array.isArray(src.templates)
    ? (src.templates as Array<Record<string, unknown>>)
        .filter((t) => t && typeof t.key === "string" && typeof t.body === "string")
        .map((t) => ({
          key: String(t.key).slice(0, 40),
          label: String(t.label ?? t.key).slice(0, 80),
          channel: (t.channel === "sms" || t.channel === "email" ? t.channel : "whatsapp") as ReminderTemplate["channel"],
          ...(t.subject ? { subject: String(t.subject).slice(0, 200) } : {}),
          body: String(t.body).slice(0, 2000),
        }))
        .slice(0, 20)
    : DEFAULT_REMINDERS.templates;
  return { autoEnabled: Boolean(src.autoEnabled), rules, channels: channels.length ? channels : ["whatsapp"], templates: templates.length ? templates : DEFAULT_REMINDERS.templates };
}

/** Fills `{customer}`, `{invoice}`, `{amount}`… placeholders; unknown placeholders are left as typed. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** The reminder rule an open invoice matches today (by days relative to due date), if any. */
export function reminderRuleFor(dueDate: string, today: string): ReminderRuleKey | null {
  const diff = daysBetween(dueDate, today);
  return REMINDER_RULES.find((r) => r.offset === diff)?.key ?? null;
}

export function formatINR(amount: number): string {
  return `₹${round2(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ---------- Field ops ---------- */

export const FIELD_STATUSES = ["active", "at_site", "travelling", "at_travel", "on_leave", "offline"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/** Great-circle distance in km (for travel distance from pings). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return round2(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function travelKm(points: ReadonlyArray<{ lat: number | null; lng: number | null }>): number {
  let km = 0;
  let prev: { lat: number; lng: number } | null = null;
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const cur = { lat: Number(p.lat), lng: Number(p.lng) };
    if (prev) km += haversineKm(prev, cur);
    prev = cur;
  }
  return round2(km);
}

/* ---------- Daily closing ---------- */

export function expectedCash(input: { openingCash: number; cashSales: number; cashCollections: number; cashPaid: number; cashExpenses: number }): number {
  return round2(input.openingCash + input.cashSales + input.cashCollections - input.cashPaid - input.cashExpenses);
}

/* ---------- Business types ---------- */

export const EXCISE_BUSINESS_TYPES = ["liquor_retail", "bar_pub"] as const;
export const BUSINESS_TYPES = [
  { key: "distributor", label: "Distributor" },
  { key: "dealer", label: "Dealer" },
  { key: "wholesaler", label: "Wholesaler" },
  { key: "retailer", label: "Retailer" },
  { key: "trader", label: "Trader" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "liquor_retail", label: "Liquor & beverage retail" },
  { key: "bar_pub", label: "Bar & pub" },
  { key: "other", label: "Other" },
] as const;

export function exciseApplies(businessType: string, exciseEnabled: boolean): boolean {
  return exciseEnabled || (EXCISE_BUSINESS_TYPES as readonly string[]).includes(businessType);
}

/* ---------- Inventory B: stock entry, counts, returns & damage ---------- */

/** Only returns may target the quarantine bucket; every other type moves saleable stock. */
export function honoursDamagedFlag(type: MovementType): boolean {
  return type === "RETURN_IN" || type === "RETURN_OUT";
}

export const RESTORE_REASON = "Restored to saleable";

/**
 * Quarantine → saleable as two ledger rows (out of quarantine, back into saleable stock),
 * because the ledger has no single type that moves units between the buckets.
 */
export function restorePlan(qty: number): Array<{ type: MovementType; qty: number; damaged: boolean }> {
  const q = round3(Math.abs(qty));
  return [
    { type: "RETURN_OUT", qty: q, damaged: true },
    { type: "RETURN_IN", qty: q, damaged: false },
  ];
}

export function isFutureDate(iso: string, today: string): boolean {
  return iso > today;
}

/** Counted minus system quantity; uncounted lines have no difference. */
export function countDifference(systemQty: number, physicalQty: number | null): number {
  return physicalQty === null ? 0 : round3(physicalQty - systemQty);
}

export type CountSheetLine = { systemQty: number; physicalQty: number | null; unitCost: number };

export type CountSummary = {
  counted: number;
  mismatches: number;
  varianceQty: number;
  varianceValue: number;
  shortQty: number;
  shortValue: number;
  excessQty: number;
  excessValue: number;
};

/** Recomputes every line's difference and the sheet's variance (short = missing units, excess = extra units). */
export function summarizeCount<T extends CountSheetLine>(lines: ReadonlyArray<T>): { lines: Array<T & { difference: number }>; summary: CountSummary } {
  const s: CountSummary = { counted: 0, mismatches: 0, varianceQty: 0, varianceValue: 0, shortQty: 0, shortValue: 0, excessQty: 0, excessValue: 0 };
  const next = lines.map((l) => {
    const difference = countDifference(l.systemQty, l.physicalQty);
    if (l.physicalQty !== null) s.counted += 1;
    if (Math.abs(difference) > 0.0005) {
      s.mismatches += 1;
      const value = difference * l.unitCost;
      if (difference < 0) {
        s.shortQty += -difference;
        s.shortValue += -value;
      } else {
        s.excessQty += difference;
        s.excessValue += value;
      }
      s.varianceQty += difference;
      s.varianceValue += value;
    }
    return { ...l, difference };
  });
  return {
    lines: next,
    summary: {
      counted: s.counted,
      mismatches: s.mismatches,
      varianceQty: round3(s.varianceQty),
      varianceValue: round2(s.varianceValue),
      shortQty: round3(s.shortQty),
      shortValue: round2(s.shortValue),
      excessQty: round3(s.excessQty),
      excessValue: round2(s.excessValue),
    },
  };
}

/** Refund owed on a return: the explicit amount, else the full total whenever a refund is expected. */
export function refundAmountFor(status: string, total: number, amount?: number | null): number {
  if (amount != null && Number.isFinite(amount)) return round2(Math.max(0, amount));
  return status === "none" ? 0 : round2(total);
}

/* ---------- Sales & finance ---------- */

export const PAY_METHODS = ["cash", "upi", "card", "bank", "cheque"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export function payMethodOf(value: unknown): PayMethod {
  return (PAY_METHODS as readonly string[]).includes(String(value)) ? (value as PayMethod) : "bank";
}

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

const STATE_ALIASES: Record<string, string> = { orissa: "21", pondicherry: "34", "new delhi": "07", "nct of delhi": "07", "j&k": "01", "jammu & kashmir": "01", "andaman & nicobar islands": "35", "daman and diu": "26", "dadra and nagar haveli": "26" };

/** 2-digit GST state code from a state name, alias or code; null when unknown. */
export function gstStateCode(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^\d{1,2}$/.test(v)) return v.padStart(2, "0");
  return GST_STATES.find((s) => s.name.toLowerCase() === v)?.code ?? STATE_ALIASES[v] ?? null;
}

export function gstStateName(gstinOrCode: string | null | undefined): string | null {
  const code = String(gstinOrCode ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? (GST_STATES.find((s) => s.code === code)?.name ?? null) : null;
}

/** CGST + SGST when the place of supply is the seller's state (matched by name or code); unknown → intra-state. */
export function intraStateFor(seller: { state?: string | null; stateCode?: string | null }, placeOfSupply?: string | null): boolean {
  const pos = String(placeOfSupply ?? "").trim();
  if (!pos) return true;
  const sellerCode = gstStateCode(seller.stateCode) ?? gstStateCode(seller.state);
  const posCode = gstStateCode(pos);
  if (sellerCode && posCode) return sellerCode === posCode;
  return isIntraState(seller.state || seller.stateCode, pos);
}

/** Due date from the party's terms, else the business default. */
export function dueDateFor(invoiceDate: string, partyTermsDays: number | null | undefined, defaultTermsDays: number): string {
  const days = partyTermsDays != null && partyTermsDays >= 0 ? partyTermsDays : Math.max(0, defaultTermsDays);
  return addDaysISO(invoiceDate, days);
}

/** Spreads a receipt over open documents in the given order (oldest first); what's left stays on account. */
export function allocateFifo(amount: number, docs: ReadonlyArray<{ id: string; balance: number }>): { allocations: Array<{ id: string; amount: number }>; remainder: number } {
  let left = round2(Math.max(0, amount));
  const allocations: Array<{ id: string; amount: number }> = [];
  for (const d of docs) {
    if (left <= 0) break;
    const take = round2(Math.min(left, Math.max(0, d.balance)));
    if (take <= 0) continue;
    allocations.push({ id: d.id, amount: take });
    left = round2(left - take);
  }
  return { allocations, remainder: left };
}

/** Days sales outstanding over a trailing window of credit sales. */
export function dsoDays(outstanding: number, salesInWindow: number, windowDays = 90): number {
  if (outstanding <= 0) return 0;
  if (salesInWindow <= 0) return windowDays;
  return Math.round((outstanding / salesInWindow) * windowDays);
}

/** Change to hand back at the counter; null when the tender is blank or short. */
export function posChange(total: number, tendered: number | null | undefined): number | null {
  if (tendered == null || !Number.isFinite(tendered)) return null;
  const diff = round2(tendered - total);
  return diff < 0 ? null : diff;
}

/** Indian mobile → wa.me digits (10-digit numbers get the 91 prefix); null when unusable. */
export function waNumber(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export type ReminderChannel = "whatsapp" | "sms" | "email";

/** Click-to-send link that opens the user's WhatsApp / SMS / mail app with the message filled in. */
export function reminderLink(channel: ReminderChannel, to: string | null | undefined, message: string, subject?: string | null): string {
  const body = encodeURIComponent(message);
  if (channel === "whatsapp") {
    const n = waNumber(to);
    return n ? `https://wa.me/${n}?text=${body}` : `https://wa.me/?text=${body}`;
  }
  if (channel === "sms") {
    const digits = String(to ?? "").replace(/[^\d+]/g, "");
    return `sms:${digits}?body=${body}`;
  }
  const email = String(to ?? "").trim();
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject ?? "")}&body=${body}`;
}

/** Collections status shown on an open invoice: disputes and promises outrank aging. */
export type ArStatus = "disputed" | "promise" | "promise_missed" | "overdue" | "partial" | "due";
export function arStatus(inv: { disputed: boolean; promiseDate: string | null; dueDate: string | null; amountPaid: number }, today: string): ArStatus {
  if (inv.disputed) return "disputed";
  if (inv.promiseDate) return inv.promiseDate < today ? "promise_missed" : "promise";
  if (inv.dueDate && inv.dueDate < today) return "overdue";
  return inv.amountPaid > 0 ? "partial" : "due";
}

/** Bills money can go out against. */
export function billPayable(status: string): boolean {
  return status === "approved" || status === "scheduled";
}

/** Manual "udhaar" ledger entries: credit = the party owes you (+), debit = you owe the party (−). */
export const LEDGER_ENTRY_TYPES = ["credit", "debit"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export function ledgerEntrySigned(type: string, amount: number): number {
  return type === "credit" ? round2(amount) : -round2(amount);
}

/** Running balance (positive = the party owes you) after each row, in the given order. */
export function runningBalance<T extends { debit: number; credit: number }>(opening: number, txns: ReadonlyArray<T>): Array<T & { balance: number }> {
  let bal = round2(opening);
  return txns.map((t) => {
    bal = round2(bal + t.debit - t.credit);
    return { ...t, balance: bal };
  });
}

export type DayPayment = { direction: "in" | "out"; method: string; amount: number; sameDaySale: boolean };
export type DayExpense = { method: string; amount: number };
export type MethodTotals = Record<PayMethod, number>;

const emptyMethodTotals = (): MethodTotals => ({ cash: 0, upi: 0, card: 0, bank: 0, cheque: 0 });
const sumByMethod = <T extends { method: string; amount: number }>(list: ReadonlyArray<T>): MethodTotals => {
  const out = emptyMethodTotals();
  for (const x of list) {
    const m = payMethodOf(x.method);
    out[m] = round2(out[m] + num(x.amount));
  }
  return out;
};
const methodsTotal = (m: MethodTotals) => round2(Object.values(m).reduce((s, v) => s + v, 0));

/**
 * The day's money by method: receipts against that day's sales, collections of older dues,
 * supplier payments and expenses, with the cash the till should hold.
 */
export function dayFigures(payments: ReadonlyArray<DayPayment>, expenses: ReadonlyArray<DayExpense>, openingCash: number) {
  const sales = sumByMethod(payments.filter((p) => p.direction === "in" && p.sameDaySale));
  const collections = sumByMethod(payments.filter((p) => p.direction === "in" && !p.sameDaySale));
  const paid = sumByMethod(payments.filter((p) => p.direction === "out"));
  const spent = sumByMethod(expenses);
  return {
    sales,
    collections,
    paid,
    expenses: spent,
    totals: { sales: methodsTotal(sales), collections: methodsTotal(collections), paid: methodsTotal(paid), expenses: methodsTotal(spent) },
    expectedCash: expectedCash({ openingCash, cashSales: sales.cash, cashCollections: collections.cash, cashPaid: paid.cash, cashExpenses: spent.cash }),
  };
}

/* ---------- Field ops, reports & GST (field.ts / reports.ts) ---------- */

export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
  active: "Active",
  at_site: "At site",
  travelling: "Travelling",
  at_travel: "On a trip",
  on_leave: "On leave",
  offline: "Offline",
};

export function isFieldStatus(value: unknown): value is FieldStatus {
  return typeof value === "string" && (FIELD_STATUSES as readonly string[]).includes(value);
}

export const FIELD_TASK_TYPES = ["delivery", "collection", "visit", "audit", "installation", "service", "other"] as const;
export type FieldTaskType = (typeof FIELD_TASK_TYPES)[number];
export const FIELD_TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type FieldTaskStatus = (typeof FIELD_TASK_STATUSES)[number];
export const FIELD_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type FieldTaskPriority = (typeof FIELD_TASK_PRIORITIES)[number];
export const VISIT_OUTCOMES = ["completed", "follow_up", "order_received", "payment_collected", "customer_unavailable", "rescheduled", "other"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/** Managers may move a task anywhere; the assignee can only work it forward (or pause it) and never cancel. */
export function canMoveFieldTask(from: string, to: FieldTaskStatus, manager: boolean): boolean {
  if (from === to) return false;
  if (manager) return true;
  const allowed: Record<string, ReadonlyArray<FieldTaskStatus>> = {
    open: ["in_progress", "done"],
    in_progress: ["open", "done"],
    done: ["in_progress"],
    cancelled: [],
  };
  return (allowed[from] ?? []).includes(to);
}

/**
 * The day's status: an open visit means at site; otherwise the latest explicit status set that day.
 * Statuses don't carry over midnight, so a member who hasn't checked in today shows offline.
 */
export function effectiveFieldStatus(latest: { status: string; date: string } | null, day: string, hasOpenVisit: boolean): FieldStatus {
  if (hasOpenVisit) return "at_site";
  if (!latest || latest.date !== day) return "offline";
  return isFieldStatus(latest.status) ? latest.status : "active";
}

export type TrackPoint = { lat: number | null; lng: number | null; accuracy?: number | null; at: number };

/**
 * Cleans a GPS trail before measuring it: drops fixes that are too inaccurate, jitter while
 * standing still (steps shorter than `minStepKm` from the last kept fix) and impossible jumps.
 */
export function cleanTrack<T extends TrackPoint>(
  points: ReadonlyArray<T>,
  opts: { maxAccuracyM?: number; minStepKm?: number; maxSpeedKmh?: number } = {},
): T[] {
  const maxAccuracy = opts.maxAccuracyM ?? 250;
  const minStep = opts.minStepKm ?? 0.05;
  const maxSpeed = opts.maxSpeedKmh ?? 160;
  const sorted = points
    .filter((p) => p.lat != null && p.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .filter((p) => p.accuracy == null || Number(p.accuracy) <= maxAccuracy)
    .slice()
    .sort((a, b) => a.at - b.at);
  const out: T[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(p);
      continue;
    }
    const km = haversineKm({ lat: Number(prev.lat), lng: Number(prev.lng) }, { lat: Number(p.lat), lng: Number(p.lng) });
    if (km < minStep) continue;
    const hours = (p.at - prev.at) / 3_600_000;
    if (hours <= 0 || km / hours > maxSpeed) continue;
    out.push(p);
  }
  return out;
}

export function trackKm(points: ReadonlyArray<TrackPoint>): number {
  return travelKm(cleanTrack(points));
}

export function minutesBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.round((toMs - fromMs) / 60_000));
}

/** `2h 05m` / `45m`. */
export function durationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstin(value: unknown): boolean {
  return typeof value === "string" && GSTIN_RE.test(value.trim().toUpperCase());
}

export function gstinStateCode(value: unknown): string | null {
  return isValidGstin(value) ? String(value).trim().slice(0, 2) : null;
}

export function splitTax(tax: number, intraState: boolean): { cgst: number; sgst: number; igst: number } {
  const t = round2(tax);
  if (!intraState) return { cgst: 0, sgst: 0, igst: t };
  const cgst = round2(t / 2);
  return { cgst, sgst: round2(t - cgst), igst: 0 };
}

export type DocLine = { itemId: string | null; name: string; hsn: string | null; unit: string; qty: number; rate: number; gstRate: number; taxable: number; tax: number };

/** A stored document line (invoice / bill / PO JSON, camelCase or snake_case) as numbers, deriving taxable and tax when absent. */
export function normalizeDocLine(raw: unknown): DocLine {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const qty = round3(Math.max(0, num(r.qty)));
  const rate = round2(num(r.rate));
  const gstRate = clamp(num(r.gstRate ?? r.gst_rate), 0, 100);
  const discountPct = clamp(num(r.discountPct ?? r.discount_pct), 0, 100);
  const taxable = r.taxable != null ? round2(num(r.taxable)) : round2(qty * rate * (1 - discountPct / 100));
  const tax = r.tax != null ? round2(num(r.tax)) : round2((taxable * gstRate) / 100);
  const itemId = r.itemId ?? r.item_id;
  return {
    itemId: itemId ? String(itemId) : null,
    name: String(r.name ?? "").trim() || "Item",
    hsn: r.hsn ? String(r.hsn).trim() : null,
    unit: r.unit ? String(r.unit) : "",
    qty,
    rate,
    gstRate,
    taxable,
    tax,
  };
}

export type RateRow = { rate: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number };

/** Rate-wise rollup (GSTR-3B style) with the intra / inter split decided per line. */
export function rateWiseSummary(lines: ReadonlyArray<{ gstRate: number; taxable: number; tax: number; intraState: boolean }>): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const l of lines) {
    const row = map.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    const s = splitTax(l.tax, l.intraState);
    row.taxable = round2(row.taxable + l.taxable);
    row.cgst = round2(row.cgst + s.cgst);
    row.sgst = round2(row.sgst + s.sgst);
    row.igst = round2(row.igst + s.igst);
    row.tax = round2(row.tax + l.tax);
    map.set(l.gstRate, row);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

/** Rates in use under Indian GST (including the 40% slab and the special 0.1% / 0.25% / 1.5% / 3% rates). */
export const GST_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28, 40] as const;

export function itemGstIssues(item: { hsn: string | null; gstRate: number }): string[] {
  const issues: string[] = [];
  const hsn = String(item.hsn ?? "").trim();
  if (!hsn) issues.push("Missing HSN / SAC");
  else if (!/^\d{4}$|^\d{6}$|^\d{8}$/.test(hsn)) issues.push("HSN should be 4, 6 or 8 digits");
  if (!(GST_SLABS as readonly number[]).includes(round2(item.gstRate))) issues.push(`GST ${item.gstRate}% isn't a standard rate`);
  else if (item.gstRate === 0) issues.push("GST 0% — confirm the item is exempt or nil-rated");
  return issues;
}

/** B2C (large): an inter-state supply to an unregistered buyer with invoice value above ₹1 lakh. */
export function isB2CLarge(invoiceValue: number, intraState: boolean, hasGstin: boolean): boolean {
  return !hasGstin && !intraState && invoiceValue > 100_000;
}

type TaxHeads = { cgst: number; sgst: number; igst: number };

/**
 * Set-off of input tax credit against output tax in the statutory order: IGST credit first
 * against IGST, then CGST, then SGST; CGST credit against CGST then IGST; SGST credit against
 * SGST then IGST. CGST and SGST credits never cross. Returns cash payable and credit carried forward.
 */
export function netGstPayable(output: TaxHeads, itc: TaxHeads): { payable: TaxHeads & { total: number }; carryForward: TaxHeads & { total: number } } {
  const out = { cgst: round2(Math.max(0, output.cgst)), sgst: round2(Math.max(0, output.sgst)), igst: round2(Math.max(0, output.igst)) };
  const cr = { cgst: round2(Math.max(0, itc.cgst)), sgst: round2(Math.max(0, itc.sgst)), igst: round2(Math.max(0, itc.igst)) };
  const use = (credit: keyof TaxHeads, liability: keyof TaxHeads) => {
    const n = Math.min(cr[credit], out[liability]);
    cr[credit] = round2(cr[credit] - n);
    out[liability] = round2(out[liability] - n);
  };
  use("igst", "igst");
  use("igst", "cgst");
  use("igst", "sgst");
  use("cgst", "cgst");
  use("cgst", "igst");
  use("sgst", "sgst");
  use("sgst", "igst");
  return {
    payable: { ...out, total: round2(out.cgst + out.sgst + out.igst) },
    carryForward: { ...cr, total: round2(cr.cgst + cr.sgst + cr.igst) },
  };
}

export const REPORT_TYPES = [
  { key: "stockin", label: "Stock in" },
  { key: "stockout", label: "Stock out" },
  { key: "fullstock", label: "Full stock & valuation" },
  { key: "damage", label: "Damage & write-offs" },
  { key: "po", label: "Purchase orders" },
  { key: "sales", label: "Sales register" },
  { key: "receivables", label: "Receivables aging" },
  { key: "payables", label: "Payables aging" },
  { key: "margin", label: "Profit & margin" },
  { key: "suppliers", label: "Supplier performance" },
  { key: "onsite", label: "Onsite staff" },
  { key: "lowstock", label: "Low stock & reorder" },
  { key: "deadstock", label: "Dead stock" },
] as const;
export type ReportType = (typeof REPORT_TYPES)[number]["key"];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && REPORT_TYPES.some((t) => t.key === value);
}

export const REPORT_SCHEDULES = ["none", "daily", "weekly", "monthly"] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];
export const REPORT_APPROVAL_STATUSES = ["draft", "pending_approval", "approved", "sent"] as const;
export type ReportApprovalStatus = (typeof REPORT_APPROVAL_STATUSES)[number];

/** Same day next month, clamped to the month's last day (31 Jan → 28/29 Feb). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** When a scheduled report is next due (never earlier than today); `null` when it isn't scheduled. */
export function nextReportRun(schedule: string, lastRun: string | null, today: string): string | null {
  if (schedule !== "daily" && schedule !== "weekly" && schedule !== "monthly") return null;
  if (!lastRun || !isISODate(lastRun)) return today;
  const next = schedule === "daily" ? addDaysISO(lastRun, 1) : schedule === "weekly" ? addDaysISO(lastRun, 7) : addMonthsISO(lastRun, 1);
  return next < today ? today : next;
}

/** Received ÷ ordered as a percentage (capped at 100). */
export function fillRatePct(ordered: number, received: number): number {
  if (!(ordered > 0)) return 0;
  return round2(clamp((received / ordered) * 100, 0, 100));
}

/** Gross margin on revenue; 0 when there's no revenue. */
export function marginPct(revenue: number, cost: number): number {
  if (!(revenue > 0)) return 0;
  return round2(((revenue - cost) / revenue) * 100);
}

/** Days overdue against the due date (or the document date when there's no due date), never negative. */
export function daysOverdue(dueDate: string | null, docDate: string, today: string): number {
  const ref = dueDate && isISODate(dueDate) ? dueDate : docDate;
  if (!isISODate(ref)) return 0;
  return Math.max(0, daysBetween(ref, today));
}

export function average(values: ReadonlyArray<number>): number {
  const v = values.filter((n) => Number.isFinite(n));
  return v.length ? round2(v.reduce((s, n) => s + n, 0) / v.length) : 0;
}

/* ---------- Purchasing & parties (parties.ts / purchase.ts) ---------- */

/** GST state codes (the first two digits of a GSTIN) → state / union territory. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const stateKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

/** GST state code for a state name or code (`Karnataka`, `karnataka`, `29`, `9` → `29`). */
export function stateCodeOf(state: string | null | undefined): string | null {
  const raw = String(state ?? "").trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, "0");
    return GST_STATE_CODES[code] ? code : null;
  }
  const key = stateKey(raw);
  const hit = Object.entries(GST_STATE_CODES).find(([, name]) => stateKey(name) === key);
  return hit ? hit[0] : null;
}

/** A party's GST place of supply: the GSTIN wins, then an explicit code, then the state name. */
export function resolvePartyState(input: { gstin?: string | null; state?: string | null; stateCode?: string | null }): { state: string | null; stateCode: string | null } {
  const fromGstin = gstinStateCode(input.gstin);
  const explicit = input.stateCode ? stateCodeOf(input.stateCode) : null;
  const code = fromGstin ?? explicit ?? stateCodeOf(input.state);
  const state = String(input.state ?? "").trim() || (code ? (GST_STATE_CODES[code] ?? null) : null);
  return { state, stateCode: code };
}

/** CGST + SGST when both sides resolve to the same GST state; unknown on either side counts as intra-state. */
export function isIntraStateSupply(seller: { state?: string | null; stateCode?: string | null }, party: { state?: string | null; stateCode?: string | null }): boolean {
  const a = stateCodeOf(seller.stateCode) ?? stateCodeOf(seller.state);
  const b = stateCodeOf(party.stateCode) ?? stateCodeOf(party.state);
  if (a && b) return a === b;
  return isIntraState(seller.state, party.state);
}

/** The PAN embedded in a GSTIN (characters 3–12). */
export function panFromGstin(gstin: string | null | undefined): string | null {
  return isValidGstin(gstin) ? String(gstin).trim().toUpperCase().slice(2, 12) : null;
}

/** What is still to arrive on a PO line. */
export function poRemaining(line: { qty: number; receivedQty?: number }): number {
  return round3(Math.max(0, num(line.qty) - num(line.receivedQty)));
}

/** Unit cost after the line discount — what a received unit is valued at. */
export function netUnitCost(line: { rate: number; discountPct?: number }): number {
  return round2(num(line.rate) * (1 - clamp(num(line.discountPct), 0, 100) / 100));
}

export type PoReceipt = { lineIndex: number; qty: number; unitCost?: number | null };

/**
 * Applies a goods receipt to PO lines. Unknown lines, non-positive quantities and over-receipts
 * are reported as errors; repeated lines in one receipt are added together first.
 */
export function applyPoReceipt<L extends { name?: string; qty: number; receivedQty?: number }>(lines: ReadonlyArray<L>, receipts: ReadonlyArray<PoReceipt>): { lines: L[]; errors: string[] } {
  const errors: string[] = [];
  const add = new Map<number, number>();
  for (const r of receipts) {
    if (!Number.isInteger(r.lineIndex) || r.lineIndex < 0 || r.lineIndex >= lines.length) {
      errors.push(`Line ${r.lineIndex + 1} isn't on this purchase order`);
      continue;
    }
    if (!(num(r.qty) > 0)) {
      errors.push(`Line ${r.lineIndex + 1}: quantity must be more than zero`);
      continue;
    }
    add.set(r.lineIndex, round3((add.get(r.lineIndex) ?? 0) + num(r.qty)));
  }
  for (const [idx, qty] of add) {
    const left = poRemaining(lines[idx]);
    if (qty > left + 0.0005) errors.push(`${lines[idx].name || `Line ${idx + 1}`}: only ${left} left to receive`);
  }
  if (!add.size && !errors.length) errors.push("Enter the quantity received for at least one line");
  const next = lines.map((l, idx) => (add.has(idx) ? { ...l, receivedQty: round3(num(l.receivedQty) + (add.get(idx) ?? 0)) } : { ...l, receivedQty: round3(num(l.receivedQty)) }));
  return { lines: next, errors };
}

/** Bill lines for a receipt: received quantity at the receipt cost (else the PO rate), keeping the PO discount and GST. */
export function receiptBillLines(lines: ReadonlyArray<ImsLineInput>, receipts: ReadonlyArray<PoReceipt>): ImsLineInput[] {
  const out: ImsLineInput[] = [];
  for (const r of receipts) {
    const l = lines[r.lineIndex];
    if (!l || !(num(r.qty) > 0)) continue;
    const customCost = r.unitCost != null && Number.isFinite(Number(r.unitCost));
    out.push({
      itemId: l.itemId ?? null,
      name: l.name,
      sku: l.sku ?? null,
      hsn: l.hsn ?? null,
      unit: l.unit ?? null,
      qty: round3(num(r.qty)),
      rate: customCost ? round2(num(r.unitCost)) : round2(num(l.rate)),
      discountPct: customCost ? 0 : clamp(num(l.discountPct), 0, 100),
      gstRate: clamp(num(l.gstRate), 0, 100),
    });
  }
  return out;
}

export const OPEN_PO_STATUSES = ["pending_approval", "approved", "sent", "partially_received"] as const;

/** Approved or sent but not fully received by the expected date. */
export function poOverdue(po: { status: string; expectedDate: string | null }, today: string): boolean {
  return Boolean(po.expectedDate) && (po.status === "approved" || po.status === "sent" || po.status === "partially_received") && String(po.expectedDate) < today;
}

/** Drafts untouched for `purgeDays` days are auto-deleted (0 keeps them forever). */
export function isStaleDraft(status: string, lastTouchedISO: string, today: string, purgeDays: number): boolean {
  if (status !== "draft" || !(purgeDays > 0) || !isISODate(lastTouchedISO)) return false;
  return daysBetween(lastTouchedISO, today) >= purgeDays;
}

const shareDate = (iso: string | null | undefined): string => {
  if (!iso || !isISODate(iso)) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** Plain-text purchase order for WhatsApp / email. */
export function poShareText(po: {
  poNo: string;
  orderDate: string;
  expectedDate?: string | null;
  businessName: string;
  businessGstin?: string | null;
  supplierName: string;
  lines: ReadonlyArray<{ name: string; qty: number; unit?: string | null; rate: number; amount: number }>;
  grandTotal: number;
  deliveryAddress?: string | null;
  paymentTermsDays?: number | null;
}): string {
  const out = [`*PURCHASE ORDER — ${po.poNo}*`, `Date: ${shareDate(po.orderDate)}${po.expectedDate ? ` · Deliver by: ${shareDate(po.expectedDate)}` : ""}`, ""];
  out.push(`From: ${po.businessName || "—"}${po.businessGstin ? ` (GSTIN ${po.businessGstin})` : ""}`);
  out.push(`To: ${po.supplierName}`, "");
  po.lines.forEach((l, i) => out.push(`${i + 1}. ${l.name} — ${round3(l.qty)}${l.unit ? ` ${l.unit}` : ""} × ${formatINR(l.rate)} = ${formatINR(l.amount)}`));
  out.push("", `*Total: ${formatINR(po.grandTotal)}* (incl. GST)`);
  if (po.paymentTermsDays != null) out.push(`Payment terms: ${po.paymentTermsDays === 0 ? "Immediate" : `${po.paymentTermsDays} days`}`);
  if (po.deliveryAddress) out.push(`Deliver to: ${po.deliveryAddress}`);
  out.push("", "Please confirm this order and the delivery date. Thank you.");
  return out.join("\n");
}

/* ---------- System, compliance & interop (Tally, POS, excise, audit, bank reconciliation, helpdesk) ---------- */

export function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const tallyDate = (iso: string): string => String(iso ?? "").replace(/-/g, "").slice(0, 8);
const tallyAmount = (n: number): string => round2(n).toFixed(2);
const tallyQty = (qty: number, unit: string): string => ` ${round3(qty)} ${unit || "Nos"}`;

/** Ledger names IMS posts to. They're created by the masters export, so a fresh Tally company imports cleanly. */
export const TALLY_LEDGERS = {
  debtors: "Sundry Debtors",
  creditors: "Sundry Creditors",
  sales: "Sales Account",
  purchase: "Purchase Account",
  outputCgst: "Output CGST",
  outputSgst: "Output SGST",
  outputIgst: "Output IGST",
  inputCgst: "Input CGST",
  inputSgst: "Input SGST",
  inputIgst: "Input IGST",
  roundOff: "Round Off",
  /** Tally's built-in Cash-in-Hand ledger; exists in every company. */
  cash: "Cash",
  bank: "Bank Account",
} as const;

export type TallyLedgerMaster = {
  name: string;
  parent: string;
  gstin?: string | null;
  state?: string | null;
  address?: string | null;
  mobile?: string | null;
  email?: string | null;
  /** Positive = debit balance (they owe us). */
  openingBalance?: number;
  taxType?: "CGST" | "SGST" | "IGST" | null;
};

export function tallyLedgerXml(l: TallyLedgerMaster): string {
  const opening = round2(num(l.openingBalance));
  const parts = [
    `<LEDGER NAME="${xmlEscape(l.name)}" ACTION="Create">`,
    `<NAME.LIST><NAME>${xmlEscape(l.name)}</NAME></NAME.LIST>`,
    `<PARENT>${xmlEscape(l.parent)}</PARENT>`,
    l.parent === TALLY_LEDGERS.debtors || l.parent === TALLY_LEDGERS.creditors ? "<ISBILLWISEON>Yes</ISBILLWISEON>" : "",
    l.address ? `<ADDRESS.LIST TYPE="String"><ADDRESS>${xmlEscape(l.address)}</ADDRESS></ADDRESS.LIST>` : "",
    l.state ? `<LEDSTATENAME>${xmlEscape(l.state)}</LEDSTATENAME><STATENAME>${xmlEscape(l.state)}</STATENAME>` : "",
    l.gstin ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${xmlEscape(l.gstin.toUpperCase())}</PARTYGSTIN>` : "",
    l.mobile ? `<LEDGERMOBILE>${xmlEscape(l.mobile)}</LEDGERMOBILE>` : "",
    l.email ? `<EMAIL>${xmlEscape(l.email)}</EMAIL>` : "",
    l.taxType ? `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${l.taxType === "IGST" ? "Integrated Tax" : l.taxType === "CGST" ? "Central Tax" : "State Tax"}</GSTDUTYHEAD>` : "",
    opening ? `<OPENINGBALANCE>${tallyAmount(-opening)}</OPENINGBALANCE>` : "",
    "</LEDGER>",
  ];
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF">${parts.join("")}</TALLYMESSAGE>`;
}

export function tallyUnitXml(unit: string): string {
  const u = xmlEscape(unit || "Nos");
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="${u}" ACTION="Create"><NAME>${u}</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT></TALLYMESSAGE>`;
}

export function tallyStockGroupXml(name: string): string {
  const n = xmlEscape(name);
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKGROUP NAME="${n}" ACTION="Create"><NAME.LIST><NAME>${n}</NAME></NAME.LIST><PARENT></PARENT><ISADDABLE>Yes</ISADDABLE></STOCKGROUP></TALLYMESSAGE>`;
}

export type TallyStockMaster = { name: string; unit: string; hsn?: string | null; gstRate: number; sku?: string | null; category?: string | null };

export function tallyStockItemXml(i: TallyStockMaster): string {
  const rate = clamp(num(i.gstRate), 0, 100);
  const half = round2(rate / 2);
  const parts = [
    `<STOCKITEM NAME="${xmlEscape(i.name)}" ACTION="Create">`,
    `<NAME.LIST><NAME>${xmlEscape(i.name)}</NAME>${i.sku ? `<NAME>${xmlEscape(i.sku)}</NAME>` : ""}</NAME.LIST>`,
    `<PARENT>${xmlEscape(i.category || "")}</PARENT>`,
    `<BASEUNITS>${xmlEscape(i.unit || "Nos")}</BASEUNITS>`,
    "<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>",
    "<GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>",
    "<GSTDETAILS.LIST>",
    "<APPLICABLEFROM>20170701</APPLICABLEFROM>",
    "<CALCULATIONTYPE>On Value</CALCULATIONTYPE>",
    i.hsn ? `<HSNCODE>${xmlEscape(i.hsn)}</HSNCODE>` : "",
    "<TAXABILITY>Taxable</TAXABILITY>",
    `<STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>`,
    `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD><GSTRATE>${half}</GSTRATE></RATEDETAILS.LIST>`,
    `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>State Tax</GSTRATEDUTYHEAD><GSTRATE>${half}</GSTRATE></RATEDETAILS.LIST>`,
    `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>${rate}</GSTRATE></RATEDETAILS.LIST>`,
    "</STATEWISEDETAILS.LIST>",
    "</GSTDETAILS.LIST>",
    "</STOCKITEM>",
  ];
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF">${parts.join("")}</TALLYMESSAGE>`;
}

export type TallyVoucherLine = {
  name: string;
  unit: string;
  qty: number;
  /** Taxable value of the line (after discount). */
  amount: number;
  /** False for free-text lines with no stock item in Tally; they post to the sales / purchase ledger instead. */
  stock: boolean;
};

export type TallyVoucher = {
  /** Credit Note = customer return (reverses a sale); Debit Note = return to supplier (reverses a purchase). */
  kind: "Sales" | "Purchase" | "Credit Note" | "Debit Note";
  number: string;
  date: string;
  partyName: string;
  partyGstin?: string | null;
  placeOfSupply?: string | null;
  reference?: string | null;
  narration?: string | null;
  lines: ReadonlyArray<TallyVoucherLine>;
  /** Taxable value when there are no lines (bills captured as totals only). */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
};

/** Credit amounts are positive, debits negative (Tally's own convention); ISDEEMEDPOSITIVE follows the sign. */
function tallyEntry(tag: "LEDGERENTRIES.LIST" | "ACCOUNTINGALLOCATIONS.LIST", ledger: string, amount: number, party = false): string {
  return `<${tag}><LEDGERNAME>${xmlEscape(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${amount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>${party ? "<ISPARTYLEDGER>Yes</ISPARTYLEDGER>" : ""}<AMOUNT>${tallyAmount(amount)}</AMOUNT></${tag}>`;
}

/**
 * A GST sales / purchase invoice (or credit / debit note) voucher that balances to zero
 * (party = total, other side = taxable + tax + round-off). Notes post the mirror image of the document they reverse.
 */
export function tallyVoucherXml(v: TallyVoucher): string {
  const sales = v.kind === "Sales" || v.kind === "Credit Note";
  const sign = v.kind === "Sales" || v.kind === "Debit Note" ? 1 : -1;
  const goodsLedger = sales ? TALLY_LEDGERS.sales : TALLY_LEDGERS.purchase;
  const stockLines = v.lines.filter((l) => l.stock && l.qty > 0);
  const otherLines = v.lines.filter((l) => !(l.stock && l.qty > 0));
  const otherTaxable = v.lines.length ? round2(otherLines.reduce((s, l) => s + l.amount, 0)) : round2(v.taxable);
  const inventory = stockLines.map((l) => {
    const amount = round2(l.amount) * sign;
    const rate = l.qty ? round2(l.amount / l.qty) : 0;
    return [
      "<ALLINVENTORYENTRIES.LIST>",
      `<STOCKITEMNAME>${xmlEscape(l.name)}</STOCKITEMNAME>`,
      `<ISDEEMEDPOSITIVE>${amount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
      `<RATE>${tallyAmount(rate)}/${xmlEscape(l.unit || "Nos")}</RATE>`,
      `<AMOUNT>${tallyAmount(amount)}</AMOUNT>`,
      `<ACTUALQTY>${xmlEscape(tallyQty(l.qty, l.unit))}</ACTUALQTY>`,
      `<BILLEDQTY>${xmlEscape(tallyQty(l.qty, l.unit))}</BILLEDQTY>`,
      tallyEntry("ACCOUNTINGALLOCATIONS.LIST", goodsLedger, amount),
      "</ALLINVENTORYENTRIES.LIST>",
    ].join("");
  });
  const taxLedgers = sales
    ? [TALLY_LEDGERS.outputCgst, TALLY_LEDGERS.outputSgst, TALLY_LEDGERS.outputIgst]
    : [TALLY_LEDGERS.inputCgst, TALLY_LEDGERS.inputSgst, TALLY_LEDGERS.inputIgst];
  const ledgers = [
    tallyEntry("LEDGERENTRIES.LIST", v.partyName, -round2(v.total) * sign, true),
    otherTaxable ? tallyEntry("LEDGERENTRIES.LIST", goodsLedger, otherTaxable * sign) : "",
    v.cgst ? tallyEntry("LEDGERENTRIES.LIST", taxLedgers[0], round2(v.cgst) * sign) : "",
    v.sgst ? tallyEntry("LEDGERENTRIES.LIST", taxLedgers[1], round2(v.sgst) * sign) : "",
    v.igst ? tallyEntry("LEDGERENTRIES.LIST", taxLedgers[2], round2(v.igst) * sign) : "",
    v.roundOff ? tallyEntry("LEDGERENTRIES.LIST", TALLY_LEDGERS.roundOff, round2(v.roundOff) * sign) : "",
  ];
  const view = stockLines.length ? "Invoice Voucher View" : "Accounting Voucher View";
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<VOUCHER VCHTYPE="${v.kind}" ACTION="Create" OBJVIEW="${view}">`,
    `<DATE>${tallyDate(v.date)}</DATE>`,
    `<EFFECTIVEDATE>${tallyDate(v.date)}</EFFECTIVEDATE>`,
    `<VOUCHERTYPENAME>${v.kind}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${xmlEscape(v.number)}</VOUCHERNUMBER>`,
    v.reference ? `<REFERENCE>${xmlEscape(v.reference)}</REFERENCE>` : "",
    `<PARTYLEDGERNAME>${xmlEscape(v.partyName)}</PARTYLEDGERNAME>`,
    `<PARTYNAME>${xmlEscape(v.partyName)}</PARTYNAME>`,
    v.partyGstin ? `<PARTYGSTIN>${xmlEscape(v.partyGstin.toUpperCase())}</PARTYGSTIN>` : "",
    v.placeOfSupply ? `<PLACEOFSUPPLY>${xmlEscape(v.placeOfSupply)}</PLACEOFSUPPLY>` : "",
    v.narration ? `<NARRATION>${xmlEscape(v.narration)}</NARRATION>` : "",
    `<ISINVOICE>${stockLines.length ? "Yes" : "No"}</ISINVOICE>`,
    `<PERSISTEDVIEW>${view}</PERSISTEDVIEW>`,
    ledgers.join(""),
    inventory.join(""),
    "</VOUCHER>",
    "</TALLYMESSAGE>",
  ].join("");
}

/** Sum of every AMOUNT a voucher posts at ledger level; 0 means it balances. */
export function tallyVoucherBalance(v: TallyVoucher): number {
  const lines = v.lines.length ? v.lines.reduce((s, l) => s + l.amount, 0) : v.taxable;
  return round2(lines + v.cgst + v.sgst + v.igst + v.roundOff - v.total);
}

export type TallyCashVoucher = {
  /** Receipt = money in from a customer; Payment = money out to a supplier. */
  kind: "Receipt" | "Payment";
  number: string;
  date: string;
  partyName: string;
  amount: number;
  /** Cash goes to Tally's Cash ledger; UPI, card, cheque and transfers to the bank ledger. */
  method: string;
  reference?: string | null;
  narration?: string | null;
};

export function tallyCashLedger(method: string): string {
  return method === "cash" ? TALLY_LEDGERS.cash : TALLY_LEDGERS.bank;
}

/** A receipt / payment voucher: the party against cash or bank, balancing to zero. */
export function tallyCashVoucherXml(v: TallyCashVoucher): string {
  const amount = round2(Math.abs(num(v.amount)));
  const receipt = v.kind === "Receipt";
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<VOUCHER VCHTYPE="${v.kind}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `<DATE>${tallyDate(v.date)}</DATE>`,
    `<EFFECTIVEDATE>${tallyDate(v.date)}</EFFECTIVEDATE>`,
    `<VOUCHERTYPENAME>${v.kind}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${xmlEscape(v.number)}</VOUCHERNUMBER>`,
    v.reference ? `<REFERENCE>${xmlEscape(v.reference)}</REFERENCE>` : "",
    `<PARTYLEDGERNAME>${xmlEscape(v.partyName)}</PARTYLEDGERNAME>`,
    v.narration ? `<NARRATION>${xmlEscape(v.narration)}</NARRATION>` : "",
    "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
    tallyEntry("LEDGERENTRIES.LIST", v.partyName, receipt ? amount : -amount, true),
    tallyEntry("LEDGERENTRIES.LIST", tallyCashLedger(v.method), receipt ? -amount : amount),
    "</VOUCHER>",
    "</TALLYMESSAGE>",
  ].join("");
}

export function tallyEnvelope(company: string, report: "All Masters" | "Vouchers", messages: ReadonlyArray<string>): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "<BODY><IMPORTDATA>",
    `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME>`,
    company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "",
    "</REQUESTDESC>",
    `<REQUESTDATA>\n${messages.join("\n")}\n</REQUESTDATA>`,
    "</IMPORTDATA></BODY>",
    "</ENVELOPE>",
  ].join("\n");
}

/** Smallest request Tally's XML server answers: the list of open companies. */
export function tallyPingEnvelope(): string {
  return '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>';
}

export function parseTallyCompanies(xml: string): string[] {
  const names = new Set<string>();
  for (const m of String(xml ?? "").matchAll(/<COMPANY\b[^>]*\bNAME="([^"]+)"/gi)) names.add(m[1].trim());
  for (const m of String(xml ?? "").matchAll(/<COMPANY\b[^>]*>[\s\S]*?<NAME[^>]*>([^<]+)<\/NAME>/gi)) names.add(m[1].trim());
  return [...names].filter(Boolean);
}

export type TallyImportResult = { created: number; altered: number; errors: number; exceptions: number; ignored: number; lineErrors: string[] };

export function parseTallyResponse(xml: string): TallyImportResult {
  const text = String(xml ?? "");
  const count = (tag: string) => {
    const m = text.match(new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`, "i"));
    return m ? Number(m[1]) : 0;
  };
  const lineErrors = [...text.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map((m) => m[1].trim()).filter(Boolean).slice(0, 20);
  return { created: count("CREATED"), altered: count("ALTERED"), errors: count("ERRORS"), exceptions: count("EXCEPTIONS"), ignored: count("IGNORED"), lineErrors };
}

/** Host for the Tally XML server: a hostname or IPv4 / IPv6 literal, no scheme, path or credentials. */
export function isTallyHost(host: unknown): boolean {
  const h = String(host ?? "").trim();
  if (!h || h.length > 253) return false;
  if (/^\[?[0-9a-f:]+\]?$/i.test(h) && h.includes(":")) return true;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(h);
}

/* POS */

/** Pre-tax unit rate from a POS price (POS prices are usually tax-inclusive MRP). */
export function posExclusiveRate(rate: number, gstRate: number, inclusive: boolean): number {
  const r = Math.max(0, num(rate));
  return inclusive ? round2(r / (1 + clamp(num(gstRate), 0, 100) / 100)) : round2(r);
}

/* Excise register */

export const EXCISE_STATUSES = ["received", "in_transit", "verified", "issued"] as const;
export type ExciseStatus = (typeof EXCISE_STATUSES)[number];

export function exciseBottles(cases: number, perCase: number, loose: number): number {
  return round3(Math.max(0, num(cases)) * Math.max(0, num(perCase)) + Math.max(0, num(loose)));
}

export function exciseClosing(opening: number, received: number, issued: number): number {
  return round3(num(opening) + num(received) - num(issued));
}

export function exciseBulkLitres(bottles: number, volumeMl: number | null | undefined): number {
  return round3((Math.max(0, num(bottles)) * Math.max(0, num(volumeMl))) / 1000);
}

/* Bank reconciliation */

export type BankTxnInput = { date: string; description: string; amount: number; direction: "in" | "out"; reference: string | null };

/** Excel serial, `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YY`, `DD-Mon-YYYY` or `DD Mon YYYY` → ISO; null when unreadable. */
export function parseBankDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  if (!s) return null;
  const iso = s.slice(0, 10);
  if (isISODate(iso)) return iso;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const m = s.match(/^(\d{1,2})[\s/.-]+([A-Za-z]{3,9}|\d{1,2})[\s/.-]+(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : months.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const out = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isISODate(out) ? out : null;
}

/** `1,23,456.50`, `₹ 500`, `(500)`, `500 Dr`, `-500` → signed number (brackets / Dr are negative). */
export function parseBankAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : 0;
  const s = String(value ?? "").trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || /\bdr\.?$/i.test(s) || s.startsWith("-");
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return round2(negative ? -n : n);
}

const BANK_COLUMNS = {
  date: ["txndate", "transactiondate", "date", "valuedate", "postingdate", "trandate"],
  description: ["description", "narration", "particulars", "transactiondetails", "details", "remarks", "transactionremarks"],
  debit: ["withdrawalamt", "withdrawalamount", "withdrawal", "withdrawals", "debitamount", "debit", "paidout", "dr"],
  credit: ["depositamt", "depositamount", "deposit", "deposits", "creditamount", "credit", "paidin", "cr"],
  amount: ["transactionamount", "txnamount", "amount"],
  type: ["drcr", "crdr", "transactiontype", "type"],
  reference: ["chqrefno", "chequerefno", "refno", "referenceno", "reference", "chequeno", "chqno", "utr", "ref"],
} as const;

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function findColumn(headers: ReadonlyArray<string>, candidates: ReadonlyArray<string>, taken: ReadonlySet<string>): string | null {
  const keyed = headers.filter((h) => !taken.has(h)).map((h) => ({ h, k: headerKey(h) }));
  for (const c of candidates) {
    const exact = keyed.find((x) => x.k === c);
    if (exact) return exact.h;
  }
  for (const c of candidates) {
    if (c.length < 3) continue;
    const partial = keyed.find((x) => x.k.includes(c) && !x.k.includes("balance"));
    if (partial) return partial.h;
  }
  return null;
}

/**
 * Bank statement rows (CSV / Excel parsed into objects keyed by header) → normalized transactions.
 * Understands separate withdrawal / deposit columns, a signed amount column, or amount + Dr/Cr type.
 */
export function normalizeBankRows(input: ReadonlyArray<Record<string, unknown>>): { txns: BankTxnInput[]; skipped: number; errors: string[] } {
  const headers = [...new Set(input.flatMap((r) => Object.keys(r)))];
  const taken = new Set<string>();
  const pick = (key: keyof typeof BANK_COLUMNS) => {
    const col = findColumn(headers, BANK_COLUMNS[key], taken);
    if (col) taken.add(col);
    return col;
  };
  const date = pick("date");
  const debit = pick("debit");
  const credit = pick("credit");
  const amount = debit || credit ? null : pick("amount");
  const type = pick("type");
  const reference = pick("reference");
  const description = pick("description");
  const errors: string[] = [];
  if (!date) errors.push("No date column found (expected Date / Txn Date / Value Date)");
  if (!debit && !credit && !amount) errors.push("No amount columns found (expected Withdrawal / Deposit, Debit / Credit or Amount)");
  if (errors.length) return { txns: [], skipped: input.length, errors };
  const txns: BankTxnInput[] = [];
  let skipped = 0;
  input.forEach((row, i) => {
    const d = parseBankDate(row[date!]);
    let signed = 0;
    if (debit || credit) {
      const dr = Math.abs(parseBankAmount(debit ? row[debit] : 0));
      const cr = Math.abs(parseBankAmount(credit ? row[credit] : 0));
      signed = round2(cr - dr);
    } else {
      signed = parseBankAmount(row[amount!]);
      const t = String(type ? row[type] ?? "" : "").trim().toLowerCase();
      if (t.startsWith("d") || t === "withdrawal") signed = -Math.abs(signed);
      else if (t.startsWith("c") || t === "deposit") signed = Math.abs(signed);
    }
    if (!d || !signed) {
      skipped += 1;
      if (d === null && Object.values(row).some((v) => String(v ?? "").trim()) && errors.length < 10) errors.push(`Row ${i + 2}: unreadable date`);
      return;
    }
    const ref = reference ? String(row[reference] ?? "").trim() : "";
    txns.push({
      date: d,
      description: (description ? String(row[description] ?? "").trim() : "").slice(0, 255) || "Bank transaction",
      amount: Math.abs(signed),
      direction: signed > 0 ? "in" : "out",
      reference: ref && ref !== "0" ? ref.slice(0, 80) : null,
    });
  });
  return { txns, skipped, errors };
}

export type BankCandidate = {
  id: string;
  type: "payment" | "expense";
  direction: "in" | "out";
  amount: number;
  date: string;
  label: string;
  reference: string | null;
  partyName: string | null;
};

export type BankSuggestion = { candidate: BankCandidate; score: number; dayGap: number; reasons: string[] };

export const BANK_MATCH_DEFAULTS = { windowDays: 5, minAutoScore: 75, amountTolerance: 0.5 } as const;

/** Same direction, amount within 50 paise and dated within the window; nearer dates and matching references score higher. */
export function scoreBankMatch(txn: BankTxnInput, c: BankCandidate, windowDays: number = BANK_MATCH_DEFAULTS.windowDays): BankSuggestion | null {
  if (txn.direction !== c.direction) return null;
  if (Math.abs(round2(txn.amount) - round2(c.amount)) > BANK_MATCH_DEFAULTS.amountTolerance) return null;
  if (!isISODate(txn.date) || !isISODate(c.date)) return null;
  const dayGap = Math.abs(daysBetween(c.date, txn.date));
  if (dayGap > windowDays) return null;
  const reasons = ["Amount matches"];
  let score = 60 + (windowDays ? ((windowDays - dayGap) / windowDays) * 20 : 20);
  reasons.push(dayGap === 0 ? "Same date" : `${dayGap} day${dayGap === 1 ? "" : "s"} apart`);
  const hay = `${txn.description} ${txn.reference ?? ""}`.toLowerCase();
  const ref = String(c.reference ?? "").trim().toLowerCase();
  if (ref.length >= 4 && hay.includes(ref)) {
    score += 15;
    reasons.push("Reference matches");
  }
  const tokens = String(c.partyName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !["traders", "trading", "enterprises", "private", "limited", "agency", "agencies", "store", "stores"].includes(t));
  if (tokens.some((t) => hay.includes(t))) {
    score += 10;
    reasons.push("Party name in narration");
  }
  return { candidate: c, score: Math.round(clamp(score, 0, 100)), dayGap, reasons };
}

export function suggestBankMatches(txn: BankTxnInput, candidates: ReadonlyArray<BankCandidate>, limit = 3, windowDays?: number): BankSuggestion[] {
  return candidates
    .map((c) => scoreBankMatch(txn, c, windowDays))
    .filter((s): s is BankSuggestion => s !== null)
    .sort((a, b) => b.score - a.score || a.dayGap - b.dayGap)
    .slice(0, limit);
}

/**
 * One-to-one auto-match: each statement line takes its best candidate when that score clears the bar and
 * isn't tied with the runner-up; a candidate is never used twice (highest score wins it).
 */
export function autoMatchBank(
  txns: ReadonlyArray<BankTxnInput & { id: string }>,
  candidates: ReadonlyArray<BankCandidate>,
  opts: { minScore?: number; windowDays?: number } = {},
): Array<{ txnId: string; candidateId: string; type: BankCandidate["type"]; score: number }> {
  const minScore = opts.minScore ?? BANK_MATCH_DEFAULTS.minAutoScore;
  const proposals: Array<{ txnId: string; candidate: BankCandidate; score: number }> = [];
  for (const t of txns) {
    const [best, second] = suggestBankMatches(t, candidates, 2, opts.windowDays);
    if (!best || best.score < minScore) continue;
    if (second && second.score === best.score) continue;
    proposals.push({ txnId: t.id, candidate: best.candidate, score: best.score });
  }
  proposals.sort((a, b) => b.score - a.score);
  const usedTxn = new Set<string>();
  const usedCand = new Set<string>();
  const out: Array<{ txnId: string; candidateId: string; type: BankCandidate["type"]; score: number }> = [];
  for (const p of proposals) {
    const key = `${p.candidate.type}:${p.candidate.id}`;
    if (usedTxn.has(p.txnId) || usedCand.has(key)) continue;
    usedTxn.add(p.txnId);
    usedCand.add(key);
    out.push({ txnId: p.txnId, candidateId: p.candidate.id, type: p.candidate.type, score: p.score });
  }
  return out;
}

/* Audit rules */

export const AUDIT_CATEGORIES = [
  { key: "gst", label: "GST mismatches", icon: "％", fix: "Correct the tax on the invoice or the party's GSTIN, then re-issue." },
  { key: "bank", label: "Unreconciled bank entries", icon: "🏦", fix: "Match the statement line to a receipt / payment, or record the missing entry." },
  { key: "ar", label: "Overdue receivables", icon: "💰", fix: "Follow up for collection or provide for doubtful debt." },
  { key: "ap", label: "Overdue payables", icon: "📤", fix: "Schedule the payment or record the reason it's on hold." },
  { key: "duplicates", label: "Duplicate transactions", icon: "⧉", fix: "Confirm both entries are genuine; cancel the duplicate if not." },
  { key: "documents", label: "Missing documents", icon: "📎", fix: "Attach the supplier invoice / supporting document in Documents." },
  { key: "stock", label: "Negative & mismatched stock", icon: "📦", fix: "Recount the item and post an adjustment with a reason." },
  { key: "unusual", label: "Unusual entries", icon: "⚑", fix: "Ask for the reason and supporting evidence." },
  { key: "changed", label: "Modified after approval", icon: "✎", fix: "Confirm the change was authorised; re-approve if needed." },
  { key: "tally", label: "Doesn't match Tally", icon: "⇄", fix: "Re-run the Tally sync or fix the rejected vouchers." },
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]["key"];

export const AUDIT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_RULES = {
  overdueReceivableDays: 90,
  overduePayableDays: 30,
  largeAdjustmentValue: 25_000,
  largeWriteOffValue: 10_000,
  gstTolerance: 1,
  unreconciledAfterDays: 7,
  b2cLargeLimit: 100_000,
} as const;

export type AuditIssue = {
  /** Stable rule key (`gst-tax:<invoiceId>`) so a reviewer's verdict sticks across runs. */
  key: string;
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  detail: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  amount: number | null;
  date: string | null;
};

const AUDIT_GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type AuditInvoice = {
  id: string;
  invoiceNo: string;
  date: string;
  customerName: string;
  customerGstin: string | null;
  /** GSTIN on the customer's party master, if linked. */
  partyGstin: string | null;
  intraState: boolean;
  lines: ReadonlyArray<ImsLineInput>;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
};

export function invoiceGstIssues(inv: AuditInvoice, tolerance: number = AUDIT_RULES.gstTolerance): AuditIssue[] {
  const out: AuditIssue[] = [];
  const base = { category: "gst" as const, entityType: "invoice", entityId: inv.id, entityLabel: inv.invoiceNo, amount: round2(inv.grandTotal), date: inv.date };
  const fmt = (n: number) => `₹${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (inv.lines.length) {
    const expected = computeTotals(inv.lines, inv.intraState);
    const diff = round2(inv.taxTotal - expected.taxTotal);
    if (Math.abs(diff) > tolerance) {
      out.push({ ...base, key: `gst-tax:${inv.id}`, severity: Math.abs(diff) >= 1000 ? "high" : "medium", title: `Tax on ${inv.invoiceNo} doesn't add up`, detail: `Invoice shows ${fmt(inv.taxTotal)} tax; the lines work out to ${fmt(expected.taxTotal)} (difference ${fmt(diff)}).` });
    }
  }
  const splitTotal = round2(inv.cgst + inv.sgst);
  if (inv.intraState && inv.igst > 0.005) {
    out.push({ ...base, key: `gst-head:${inv.id}`, severity: "high", title: `IGST charged on an intra-state sale`, detail: `${inv.invoiceNo} is within the state but charges ${fmt(inv.igst)} IGST instead of CGST + SGST.` });
  } else if (!inv.intraState && splitTotal > 0.005) {
    out.push({ ...base, key: `gst-head:${inv.id}`, severity: "high", title: `CGST + SGST charged on an inter-state sale`, detail: `${inv.invoiceNo} goes out of state but charges ${fmt(splitTotal)} CGST + SGST instead of IGST.` });
  }
  const gstin = String(inv.customerGstin ?? "").trim().toUpperCase();
  if (gstin && !AUDIT_GSTIN_RE.test(gstin)) {
    out.push({ ...base, key: `gst-gstin:${inv.id}`, severity: "medium", title: `Invalid GSTIN on ${inv.invoiceNo}`, detail: `"${gstin}" isn't a valid 15-character GSTIN, so the buyer can't claim input credit.` });
  } else if (!gstin && String(inv.partyGstin ?? "").trim()) {
    out.push({ ...base, key: `gst-b2b:${inv.id}`, severity: "medium", title: `B2B invoice without GSTIN`, detail: `${inv.customerName} is registered (${String(inv.partyGstin).toUpperCase()}) but ${inv.invoiceNo} was issued without their GSTIN.` });
  } else if (!gstin && !inv.intraState && inv.grandTotal > AUDIT_RULES.b2cLargeLimit) {
    out.push({ ...base, key: `gst-b2cl:${inv.id}`, severity: "low", title: `Large inter-state B2C invoice`, detail: `${inv.invoiceNo} (${fmt(inv.grandTotal)}) to an unregistered buyer out of state is reported as B2C (Large) in GSTR-1 — confirm the buyer has no GSTIN.` });
  }
  const noHsn = inv.lines.filter((l) => !String(l.hsn ?? "").trim()).length;
  if (noHsn) {
    out.push({ ...base, key: `gst-hsn:${inv.id}`, severity: "low", title: `HSN missing on ${inv.invoiceNo}`, detail: `${noHsn} of ${inv.lines.length} line${inv.lines.length === 1 ? "" : "s"} have no HSN code, which GSTR-1's HSN summary requires.` });
  }
  return out;
}

/** Groups of two or more rows sharing party, amount and date (likely double entry). */
export function findDuplicateGroups<T extends { id: string; partyKey: string; amount: number; date: string }>(list: ReadonlyArray<T>): T[][] {
  const map = new Map<string, T[]>();
  for (const r of list) {
    if (!(r.amount > 0)) continue;
    const key = `${r.partyKey.trim().toLowerCase()}|${round2(r.amount).toFixed(2)}|${r.date}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/** Current stock minus what the movement ledger adds up to; non-zero means the ledger and the item disagree. */
export function stockLedgerGap(currentStock: number, movementDeltaSum: number): number {
  return round3(num(currentStock) - num(movementDeltaSum));
}

/** Edits recorded after a document was approved (approval / payment events don't count). */
export function editsAfterApproval<T extends { type: string; at: string }>(decidedAt: string | null, events: ReadonlyArray<T>): T[] {
  if (!decidedAt) return [];
  const cutoff = Date.parse(String(decidedAt).replace(" ", "T"));
  if (!Number.isFinite(cutoff)) return [];
  return events.filter((e) => /(updat|edit|chang|amend)/i.test(e.type) && Date.parse(String(e.at).replace(" ", "T")) > cutoff + 1000);
}

const SEVERITY_WEIGHT: Record<AuditSeverity, number> = { low: 1, medium: 3, high: 6, critical: 10 };

export function auditSeverityRank(s: AuditSeverity): number {
  return AUDIT_SEVERITIES.indexOf(s);
}

/** 0–100 books-health score: each open issue costs by severity, with diminishing returns so one bad area can't zero it. */
export function auditHealth(issues: ReadonlyArray<Pick<AuditIssue, "severity">>): { score: number; grade: "A" | "B" | "C" | "D" | "E"; bySeverity: Record<AuditSeverity, number> } {
  const bySeverity: Record<AuditSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const i of issues) bySeverity[i.severity] += 1;
  const penalty = AUDIT_SEVERITIES.reduce((s, sev) => s + SEVERITY_WEIGHT[sev] * Math.sqrt(bySeverity[sev]) * 4, 0);
  const score = Math.round(clamp(100 - penalty, 0, 100));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "E";
  return { score, grade, bySeverity };
}

export const AUDIT_ITEM_STATUSES = ["open", "responded", "resolved", "dismissed"] as const;
export type AuditItemStatus = (typeof AUDIT_ITEM_STATUSES)[number];
export const AUDIT_AREAS = ["sales", "purchases", "banking", "gst", "inventory", "expenses", "aging", "other"] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

/** Where an auto-detected category files when it's raised as a flag. */
export const AUDIT_CATEGORY_AREA: Record<AuditCategory, AuditArea> = {
  gst: "gst",
  bank: "banking",
  ar: "aging",
  ap: "aging",
  duplicates: "sales",
  documents: "purchases",
  stock: "inventory",
  unusual: "inventory",
  changed: "purchases",
  tally: "other",
};

/* Threads (audit queries, helpdesk tickets) */

export type ThreadEntry = { id: string; authorId: number | null; author: string; role: string | null; at: string; text: string };

export function appendThread(thread: unknown, entry: ThreadEntry, max = 200): ThreadEntry[] {
  const list = Array.isArray(thread) ? (thread as ThreadEntry[]).filter((t) => t && typeof t.text === "string") : [];
  return [...list, entry].slice(-max);
}

export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_CATEGORIES = [
  { key: "general", label: "General question" },
  { key: "stock", label: "Stock & items" },
  { key: "purchase", label: "Purchasing & suppliers" },
  { key: "sales", label: "Invoices & billing" },
  { key: "finance", label: "Receivables & payables" },
  { key: "gst", label: "GST & reports" },
  { key: "integrations", label: "Tally / POS / connected tools" },
  { key: "access", label: "Login, team & permissions" },
  { key: "bug", label: "Something isn't working" },
  { key: "feature", label: "Feature request" },
] as const;

/* Cross-tool matching */

/** Last 10 digits of an Indian phone number, or null. */
export function mobileKey(value: unknown): string | null {
  const d = String(value ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export const nameKey = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* ---------- Books: a double-entry view of IMS records (trial balance, P&L, balance sheet, day book) ---------- */

export type BookAccountType = "asset" | "liability" | "income" | "expense";
export type BookAccountMeta = { name: string; group: string; type: BookAccountType };

export const BOOK_ACCOUNTS = {
  cash: { name: "Cash in hand", group: "Cash-in-hand", type: "asset" },
  bank: { name: "Bank accounts", group: "Bank accounts", type: "asset" },
  debtors: { name: "Sundry Debtors", group: "Current assets", type: "asset" },
  stock: { name: "Opening stock", group: "Current assets", type: "asset" },
  inputCgst: { name: "Input CGST", group: "Duties & taxes", type: "asset" },
  inputSgst: { name: "Input SGST", group: "Duties & taxes", type: "asset" },
  inputIgst: { name: "Input IGST", group: "Duties & taxes", type: "asset" },
  inputGstExpenses: { name: "Input GST on expenses", group: "Duties & taxes", type: "asset" },
  creditors: { name: "Sundry Creditors", group: "Current liabilities", type: "liability" },
  outputCgst: { name: "Output CGST", group: "Duties & taxes", type: "liability" },
  outputSgst: { name: "Output SGST", group: "Duties & taxes", type: "liability" },
  outputIgst: { name: "Output IGST", group: "Duties & taxes", type: "liability" },
  suspense: { name: "Manual ledger entries (suspense)", group: "Suspense", type: "liability" },
  capital: { name: "Capital & reserves", group: "Capital", type: "liability" },
  sales: { name: "Sales", group: "Sales accounts", type: "income" },
  salesReturns: { name: "Sales returns", group: "Sales accounts", type: "income" },
  purchases: { name: "Purchases", group: "Purchase accounts", type: "expense" },
  purchaseReturns: { name: "Purchase returns", group: "Purchase accounts", type: "expense" },
  roundOff: { name: "Round off", group: "Indirect expenses", type: "expense" },
} as const satisfies Record<string, BookAccountMeta>;

export type BookAccountKey = keyof typeof BOOK_ACCOUNTS | `exp:${string}`;

export function bookAccount(key: BookAccountKey): BookAccountMeta {
  if (key.startsWith("exp:")) return { name: key.slice(4) || "Other expenses", group: "Indirect expenses", type: "expense" };
  return BOOK_ACCOUNTS[key as keyof typeof BOOK_ACCOUNTS];
}

export type BookVoucherType = "Opening" | "Sales" | "Purchase" | "Receipt" | "Payment" | "Credit note" | "Debit note" | "Expense" | "Journal";
export type BookLine = { account: BookAccountKey; dr: number; cr: number };
export type BookVoucher = {
  date: string;
  type: BookVoucherType;
  ref: string | null;
  party: string | null;
  narration: string;
  amount: number;
  lines: BookLine[];
  /** Where the voucher came from, so the UI can open the record. */
  source: { type: "invoice" | "bill" | "payment" | "return" | "expense" | "ledger" | "party"; id: string | null };
};

export type BookSources = {
  homeState: string | null;
  parties: ReadonlyArray<{ id: string; name: string; opening: number }>;
  invoices: ReadonlyArray<{ id: string; no: string; date: string; party: string; taxable: number; cgst: number; sgst: number; igst: number; total: number }>;
  bills: ReadonlyArray<{ id: string; no: string; supplierBillNo: string | null; date: string; party: string; partyState: string | null; taxable: number; tax: number; total: number }>;
  payments: ReadonlyArray<{ id: string; direction: string; date: string; party: string; amount: number; method: string; docNo: string | null; reference: string | null }>;
  notes: ReadonlyArray<{ id: string; no: string; kind: "Credit Note" | "Debit Note"; date: string; party: string; against: string | null; taxable: number; cgst: number; sgst: number; igst: number; total: number }>;
  expenses: ReadonlyArray<{ id: string; date: string; category: string; description: string | null; vendor: string | null; amount: number; gst: number; method: string }>;
  entries: ReadonlyArray<{ id: string; date: string; party: string; type: string; category: string; amount: number; refNo: string | null; settledOn: string | null; settleMethod: string | null }>;
};

/** Party opening balances sit before any real date. */
export const BOOKS_EPOCH = "1900-01-01";

const cashOrBank = (method: string | null | undefined): BookAccountKey => (method === "cash" ? "cash" : "bank");

function bookVoucher(v: Omit<BookVoucher, "lines" | "amount"> & { lines: BookLine[] }): BookVoucher | null {
  const lines = v.lines.map((l) => ({ ...l, dr: round2(l.dr), cr: round2(l.cr) })).filter((l) => Math.abs(l.dr) >= 0.005 || Math.abs(l.cr) >= 0.005);
  if (!lines.length) return null;
  const amount = round2(lines.reduce((s, l) => s + l.dr, 0));
  return { ...v, amount, lines };
}

/** Taxable + taxes + any rounding, posted so every voucher balances exactly. */
function taxedLines(goods: BookAccountKey, taxes: ReadonlyArray<[BookAccountKey, number]>, taxable: number, total: number, side: "dr" | "cr"): BookLine[] {
  const taxSum = taxes.reduce((s, [, a]) => s + a, 0);
  const roundOff = round2(total - taxable - taxSum);
  const put = (account: BookAccountKey, amount: number): BookLine => (side === "dr" ? { account, dr: amount, cr: 0 } : { account, dr: 0, cr: amount });
  const lines = [put(goods, taxable), ...taxes.map(([a, amt]) => put(a, amt))];
  if (Math.abs(roundOff) >= 0.005) lines.push(side === "dr" ? { account: "roundOff", dr: roundOff, cr: 0 } : { account: "roundOff", dr: -roundOff, cr: 0 });
  return lines;
}

/**
 * Every IMS record as a balanced voucher. Payments go to Cash when paid in cash, otherwise to Bank.
 * Manual ledger entries post against a suspense account (opening entries against capital) because
 * IMS doesn't know what the money was for.
 */
export function buildBookVouchers(src: BookSources): BookVoucher[] {
  const out: Array<BookVoucher | null> = [];
  for (const p of src.parties) {
    const amt = round2(p.opening);
    if (Math.abs(amt) < 0.005) continue;
    out.push(
      bookVoucher({
        date: BOOKS_EPOCH,
        type: "Opening",
        ref: null,
        party: p.name,
        narration: "Opening balance",
        source: { type: "party", id: p.id },
        lines: amt > 0 ? [{ account: "debtors", dr: amt, cr: 0 }, { account: "capital", dr: 0, cr: amt }] : [{ account: "capital", dr: -amt, cr: 0 }, { account: "creditors", dr: 0, cr: -amt }],
      }),
    );
  }
  for (const i of src.invoices) {
    out.push(
      bookVoucher({
        date: i.date,
        type: "Sales",
        ref: i.no,
        party: i.party,
        narration: `Sales invoice ${i.no}`,
        source: { type: "invoice", id: i.id },
        lines: [{ account: "debtors", dr: i.total, cr: 0 }, ...taxedLines("sales", [["outputCgst", i.cgst], ["outputSgst", i.sgst], ["outputIgst", i.igst]], i.taxable, i.total, "cr")],
      }),
    );
  }
  for (const b of src.bills) {
    const intra = isIntraState(src.homeState, b.partyState);
    const cgst = intra ? round2(b.tax / 2) : 0;
    const sgst = intra ? round2(b.tax - cgst) : 0;
    const igst = intra ? 0 : round2(b.tax);
    out.push(
      bookVoucher({
        date: b.date,
        type: "Purchase",
        ref: b.no,
        party: b.party,
        narration: `Purchase bill ${b.no}${b.supplierBillNo ? ` (supplier invoice ${b.supplierBillNo})` : ""}`,
        source: { type: "bill", id: b.id },
        lines: [...taxedLines("purchases", [["inputCgst", cgst], ["inputSgst", sgst], ["inputIgst", igst]], b.taxable, b.total, "dr"), { account: "creditors", dr: 0, cr: b.total }],
      }),
    );
  }
  for (const p of src.payments) {
    const amt = round2(p.amount);
    const receipt = p.direction === "in";
    out.push(
      bookVoucher({
        date: p.date,
        type: receipt ? "Receipt" : "Payment",
        ref: p.reference || p.docNo,
        party: p.party,
        narration: `${receipt ? "Received" : "Paid"}${p.docNo ? ` against ${p.docNo}` : " on account"} (${p.method.toUpperCase()})`,
        source: { type: "payment", id: p.id },
        lines: receipt ? [{ account: cashOrBank(p.method), dr: amt, cr: 0 }, { account: "debtors", dr: 0, cr: amt }] : [{ account: "creditors", dr: amt, cr: 0 }, { account: cashOrBank(p.method), dr: 0, cr: amt }],
      }),
    );
  }
  for (const n of src.notes) {
    const credit = n.kind === "Credit Note";
    out.push(
      bookVoucher({
        date: n.date,
        type: credit ? "Credit note" : "Debit note",
        ref: n.no,
        party: n.party,
        narration: `${credit ? "Credit note — customer return" : "Debit note — return to supplier"}${n.against ? ` against ${n.against}` : ""}`,
        source: { type: "return", id: n.id },
        lines: credit
          ? [...taxedLines("salesReturns", [["outputCgst", n.cgst], ["outputSgst", n.sgst], ["outputIgst", n.igst]], n.taxable, n.total, "dr"), { account: "debtors", dr: 0, cr: n.total }]
          : [{ account: "creditors", dr: n.total, cr: 0 }, ...taxedLines("purchaseReturns", [["inputCgst", n.cgst], ["inputSgst", n.sgst], ["inputIgst", n.igst]], n.taxable, n.total, "cr")],
      }),
    );
  }
  for (const e of src.expenses) {
    const gst = round2(Math.min(Math.max(0, e.gst), e.amount));
    out.push(
      bookVoucher({
        date: e.date,
        type: "Expense",
        ref: null,
        party: e.vendor,
        narration: `${e.category}${e.description ? ` — ${e.description}` : ""}`,
        source: { type: "expense", id: e.id },
        lines: [
          { account: `exp:${e.category.trim() || "Other expenses"}`, dr: e.amount - gst, cr: 0 },
          { account: "inputGstExpenses", dr: gst, cr: 0 },
          { account: cashOrBank(e.method), dr: 0, cr: e.amount },
        ],
      }),
    );
  }
  for (const e of src.entries) {
    const amt = round2(e.amount);
    const theyOwe = e.type === "credit";
    const counter: BookAccountKey = e.category === "opening" ? "capital" : "suspense";
    out.push(
      bookVoucher({
        date: e.date,
        type: "Journal",
        ref: e.refNo,
        party: e.party,
        narration: `Manual ${theyOwe ? "credit (they owe you)" : "debit (you owe them)"} — ${e.category.replace(/_/g, " ")}`,
        source: { type: "ledger", id: e.id },
        lines: theyOwe ? [{ account: "debtors", dr: amt, cr: 0 }, { account: counter, dr: 0, cr: amt }] : [{ account: counter, dr: amt, cr: 0 }, { account: "creditors", dr: 0, cr: amt }],
      }),
    );
    if (e.settledOn) {
      out.push(
        bookVoucher({
          date: e.settledOn,
          type: theyOwe ? "Receipt" : "Payment",
          ref: e.refNo,
          party: e.party,
          narration: `Settled manual ${theyOwe ? "credit" : "debit"} entry (${(e.settleMethod ?? "cash").toUpperCase()})`,
          source: { type: "ledger", id: e.id },
          lines: theyOwe ? [{ account: cashOrBank(e.settleMethod ?? "cash"), dr: amt, cr: 0 }, { account: "debtors", dr: 0, cr: amt }] : [{ account: "creditors", dr: amt, cr: 0 }, { account: cashOrBank(e.settleMethod ?? "cash"), dr: 0, cr: amt }],
        }),
      );
    }
  }
  const order: Record<BookVoucherType, number> = { Opening: 0, Sales: 1, Purchase: 1, "Credit note": 2, "Debit note": 2, Journal: 2, Expense: 3, Receipt: 4, Payment: 4 };
  return out.filter((v): v is BookVoucher => v !== null).sort((a, b) => (a.date === b.date ? order[a.type] - order[b.type] : a.date < b.date ? -1 : 1));
}

export type TrialBalanceRow = { account: BookAccountKey; name: string; group: string; type: BookAccountType; dr: number; cr: number };
export type StatementRow = { name: string; amount: number; account?: BookAccountKey };

export type BookStatements = {
  range: { from: string; to: string };
  trialBalance: { rows: TrialBalanceRow[]; dr: number; cr: number; difference: number };
  profitLoss: {
    sales: number;
    salesReturns: number;
    netSales: number;
    openingStock: number;
    purchases: number;
    purchaseReturns: number;
    netPurchases: number;
    closingStock: number;
    cogs: number;
    grossProfit: number;
    expenses: StatementRow[];
    totalExpenses: number;
    netProfit: number;
  };
  balanceSheet: { assets: StatementRow[]; liabilities: StatementRow[]; totalAssets: number; totalLiabilities: number; difference: number };
};

const TYPE_ORDER: Record<BookAccountType, number> = { asset: 0, liability: 1, income: 2, expense: 3 };

/**
 * Statements for `from`..`to`. Income and expenses before `from` are carried into capital
 * (profit brought forward); stock uses the valuation passed in, not the purchase postings.
 */
export function bookStatements(vouchers: ReadonlyArray<BookVoucher>, opts: { from: string; to: string; openingStock: number; closingStock: number }): BookStatements {
  const bal = new Map<BookAccountKey, { dr: number; cr: number }>();
  const add = (account: BookAccountKey, dr: number, cr: number) => {
    const b = bal.get(account) ?? { dr: 0, cr: 0 };
    b.dr += dr;
    b.cr += cr;
    bal.set(account, b);
  };
  for (const v of vouchers) {
    if (v.date > opts.to) continue;
    for (const l of v.lines) {
      const t = bookAccount(l.account).type;
      const pl = t === "income" || t === "expense";
      add(pl && v.date < opts.from ? "capital" : l.account, l.dr, l.cr);
    }
  }
  const openingStock = round2(Math.max(0, opts.openingStock));
  const closingStock = round2(Math.max(0, opts.closingStock));
  if (openingStock) {
    add("stock", openingStock, 0);
    add("capital", 0, openingStock);
  }
  const net = (a: BookAccountKey) => {
    const b = bal.get(a);
    return b ? round2(b.dr - b.cr) : 0;
  };

  const tbRows: TrialBalanceRow[] = [...bal.keys()]
    .map((account) => {
      const n = net(account);
      const meta = bookAccount(account);
      return { account, name: meta.name, group: meta.group, type: meta.type, dr: n > 0 ? n : 0, cr: n < 0 ? -n : 0 };
    })
    .filter((r) => r.dr >= 0.005 || r.cr >= 0.005)
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const tbDr = round2(tbRows.reduce((s, r) => s + r.dr, 0));
  const tbCr = round2(tbRows.reduce((s, r) => s + r.cr, 0));

  const sales = round2(-net("sales"));
  const salesReturns = round2(net("salesReturns"));
  const purchases = round2(net("purchases"));
  const purchaseReturns = round2(-net("purchaseReturns"));
  const netSales = round2(sales - salesReturns);
  const netPurchases = round2(purchases - purchaseReturns);
  const cogs = round2(openingStock + netPurchases - closingStock);
  const grossProfit = round2(netSales - cogs);
  const expenses: StatementRow[] = [...bal.keys()]
    .filter((a) => a.startsWith("exp:") || a === "roundOff")
    .map((a) => ({ account: a, name: bookAccount(a).name, amount: net(a) }))
    .filter((r) => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  const netProfit = round2(grossProfit - totalExpenses);

  const inputGst = round2(net("inputCgst") + net("inputSgst") + net("inputIgst") + net("inputGstExpenses"));
  const outputGst = round2(-(net("outputCgst") + net("outputSgst") + net("outputIgst")));
  const assets: StatementRow[] = [
    { account: "cash", name: BOOK_ACCOUNTS.cash.name, amount: net("cash") },
    { account: "bank", name: BOOK_ACCOUNTS.bank.name, amount: net("bank") },
    { account: "debtors", name: BOOK_ACCOUNTS.debtors.name, amount: net("debtors") },
    { name: "Closing stock", amount: closingStock },
    { name: "GST input credit", amount: inputGst },
  ];
  const liabilities: StatementRow[] = [
    { account: "creditors", name: BOOK_ACCOUNTS.creditors.name, amount: round2(-net("creditors")) },
    { name: "GST output payable", amount: outputGst },
    { account: "suspense", name: BOOK_ACCOUNTS.suspense.name, amount: round2(-net("suspense")) },
    { account: "capital", name: BOOK_ACCOUNTS.capital.name, amount: round2(-net("capital")) },
    { name: netProfit >= 0 ? "Profit for the period" : "Loss for the period", amount: netProfit },
  ];
  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  return {
    range: { from: opts.from, to: opts.to },
    trialBalance: { rows: tbRows, dr: tbDr, cr: tbCr, difference: round2(tbDr - tbCr) },
    profitLoss: { sales, salesReturns, netSales, openingStock, purchases, purchaseReturns, netPurchases, closingStock, cogs, grossProfit, expenses, totalExpenses, netProfit },
    balanceSheet: {
      assets: assets.filter((r) => Math.abs(r.amount) >= 0.005 || r.name === "Closing stock"),
      liabilities: liabilities.filter((r) => Math.abs(r.amount) >= 0.005 || r.account === "capital"),
      totalAssets,
      totalLiabilities,
      difference: round2(totalAssets - totalLiabilities),
    },
  };
}

/**
 * A GST-inclusive note amount split back into taxable value and tax, using each line's GST rate.
 * Line amounts are scaled so they add up to the taxable value exactly.
 */
export function splitInclusiveNote(
  input: ReadonlyArray<ImsLineInput>,
  amount: number,
  intraState: boolean,
): { lines: Array<{ itemId: string | null; name: string; unit: string; qty: number; amount: number }>; taxable: number; cgst: number; sgst: number; igst: number; total: number } {
  const total = round2(Math.max(0, num(amount)));
  const totals = computeTotals(input, intraState);
  const gross = round2(totals.taxable + totals.taxTotal);
  const factor = gross > 0 ? total / gross : 0;
  const tax = gross > 0 ? round2(totals.taxTotal * factor) : 0;
  const cgst = intraState ? round2(tax / 2) : 0;
  const sgst = intraState ? round2(tax - cgst) : 0;
  const igst = intraState ? 0 : tax;
  const taxable = round2(total - tax);
  const lines = totals.lines.map((l) => ({ itemId: l.itemId ?? null, name: l.name, unit: l.unit || "pcs", qty: l.qty, amount: round2(l.taxable * factor) }));
  if (lines.length) {
    const drift = round2(taxable - lines.reduce((s, l) => s + l.amount, 0));
    lines[lines.length - 1].amount = round2(lines[lines.length - 1].amount + drift);
  }
  return { lines, taxable, cgst, sgst, igst, total };
}
