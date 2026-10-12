/**
 * Settings vocabulary for the IMS web app: GST states, role descriptions, document
 * numbering previews, pick-list metadata and reminder templates. Mirrors
 * server/src/ims/logic.ts where the server enforces the same rule.
 */
import { ims, type ImsRole, type ImsSettings, type ReminderRuleKey, type Taxonomy } from "./api";

export const settingsApi = {
  meta: ims.settings,
  save: ims.saveSettings,
  team: ims.team,
  saveMember: ims.saveMember,
};

/* ---------- GST states ---------- */

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

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isValidGstin = (v: string | null | undefined): boolean => GSTIN_RE.test(String(v ?? "").trim().toUpperCase());

const stateKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

export function stateCodeOf(state: string | null | undefined): string | null {
  const raw = String(state ?? "").trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) {
    const code = raw.padStart(2, "0");
    return GST_STATES.some((s) => s.code === code) ? code : null;
  }
  return GST_STATES.find((s) => stateKey(s.name) === stateKey(raw))?.code ?? null;
}

export const stateNameOf = (code: string | null | undefined): string | null => GST_STATES.find((s) => s.code === code)?.name ?? null;

/** State + code implied by a GSTIN (its first two digits), if valid. */
export function gstinPlace(gstin: string | null | undefined): { state: string; stateCode: string } | null {
  if (!isValidGstin(gstin)) return null;
  const code = String(gstin).trim().slice(0, 2);
  const state = stateNameOf(code);
  return state ? { state, stateCode: code } : null;
}

/* ---------- Roles ---------- */

export const ROLE_INFO: Record<ImsRole, { label: string; desc: string }> = {
  owner: { label: "Owner", desc: "Full access to everything, including settings, team and role permissions. Platform owners and admins are always IMS owners." },
  manager: { label: "Manager", desc: "Runs day-to-day operations: stock, purchasing, approvals, sales and finance. Can't change settings or integrations by default." },
  incharge: { label: "Store incharge", desc: "Looks after the godown: stock in / out, damage, stock checks, purchase orders and field assignments." },
  staff: { label: "Staff", desc: "Counter and warehouse staff: records stock movements, raises purchase orders and bills sales." },
  accountant: { label: "Accountant", desc: "Sales invoices, receivables, payables, daily closing and reports. Manages party records." },
  auditor: { label: "CA / Auditor", desc: "Read-mostly access to reports, GST summaries and the auditor workspace." },
  field: { label: "Field / Technician", desc: "Check-ins, live location and assigned field tasks only." },
  viewer: { label: "Viewer", desc: "Can look at reports. Platform viewers are always IMS viewers." },
};

export const EDITABLE_ROLES: ReadonlyArray<Exclude<ImsRole, "owner">> = ["manager", "incharge", "staff", "accountant", "auditor", "field", "viewer"];

/* ---------- Numbering ---------- */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export function fiscalYearLabel(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= startMonth ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return startMonth === 1 ? String(start) : `${two(start)}-${two(start + 1)}`;
}

/** What the next document number will look like, e.g. `PO/26-27/0001`. */
export function docNoSample(prefix: string, today: string, fyStart: number, seq = 1): string {
  const p = String(prefix || "DOC").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) || "DOC";
  return `${p}/${fiscalYearLabel(today, fyStart)}/${String(seq).padStart(4, "0")}`;
}

export const PREFIX_RE = /^[A-Za-z0-9-]{1,12}$/;

export type PrefixKey = "poPrefix" | "invoicePrefix" | "billPrefix" | "returnPrefix" | "checkPrefix" | "ticketPrefix";
export const PREFIX_FIELDS: ReadonlyArray<{ key: PrefixKey; label: string; hint: string }> = [
  { key: "poPrefix", label: "Purchase orders", hint: "Raised to suppliers" },
  { key: "invoicePrefix", label: "Sales invoices", hint: "GST tax invoices" },
  { key: "billPrefix", label: "Supplier bills", hint: "Created on goods receipt" },
  { key: "returnPrefix", label: "Returns", hint: "Customer & supplier returns" },
  { key: "checkPrefix", label: "Stock checks", hint: "Physical count sessions" },
  { key: "ticketPrefix", label: "Help desk tickets", hint: "Support requests" },
];

/* ---------- Pick-lists ---------- */

export type StringListKey = Exclude<keyof Taxonomy, "categories">;
export const TAXONOMY_LISTS: ReadonlyArray<{ key: StringListKey; label: string; hint: string; placeholder: string }> = [
  { key: "brands", label: "Brands", hint: "Offered when adding items and used in filters.", placeholder: "e.g. Havells" },
  { key: "units", label: "Units", hint: "Units of measure for items and documents.", placeholder: "e.g. pcs" },
  { key: "locations", label: "Locations", hint: "Godowns, racks or bins stock can live in.", placeholder: "e.g. Rack A2" },
  { key: "damageReasons", label: "Damage reasons", hint: "Shown when marking stock damaged.", placeholder: "e.g. Broken in transit" },
  { key: "adjustmentReasons", label: "Adjustment reasons", hint: "Shown for manual stock adjustments.", placeholder: "e.g. Count correction" },
  { key: "returnReasons", label: "Return reasons", hint: "Customer and supplier returns.", placeholder: "e.g. Defective" },
  { key: "holdReasons", label: "Bill hold reasons", hint: "Why a supplier bill is put on hold.", placeholder: "e.g. Pricing issue" },
  { key: "expenseCategories", label: "Expense categories", hint: "Daily closing expenses.", placeholder: "e.g. Fuel" },
];

/* ---------- Reminders ---------- */

export const REMINDER_RULES: ReadonlyArray<{ key: ReminderRuleKey; label: string; offset: number }> = [
  { key: "3b", label: "3 days before due date", offset: -3 },
  { key: "due", label: "On due date", offset: 0 },
  { key: "7d", label: "7 days overdue", offset: 7 },
  { key: "15d", label: "15 days overdue", offset: 15 },
  { key: "30d", label: "30 days overdue", offset: 30 },
  { key: "60d", label: "60 days overdue", offset: 60 },
  { key: "90d", label: "90 days overdue", offset: 90 },
];

export const REMINDER_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
] as const;

export const REMINDER_PLACEHOLDERS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "{customer}", label: "Customer name" },
  { token: "{invoice}", label: "Invoice number" },
  { token: "{amount}", label: "Amount due" },
  { token: "{due}", label: "Due date" },
  { token: "{days}", label: "Days overdue" },
  { token: "{business}", label: "Your business" },
];

export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export const unknownPlaceholders = (body: string): string[] => {
  const known = new Set(REMINDER_PLACEHOLDERS.map((p) => p.token));
  return [...new Set(body.match(/\{\w+\}/g) ?? [])].filter((t) => !known.has(t));
};

/* ---------- Dirty checks ---------- */

export type SettingsPatch = Partial<Omit<ImsSettings, "exciseActive">>;

/** Only the keys whose values differ (deep compare via JSON for lists / matrices). */
export function diffSettings(base: ImsSettings, draft: ImsSettings, keys: ReadonlyArray<keyof SettingsPatch>): SettingsPatch {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (JSON.stringify(base[k]) !== JSON.stringify(draft[k])) out[k] = draft[k];
  return out as SettingsPatch;
}

/* ---------- Workbook export ---------- */

export type SheetSpec = { name: string; rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>> };

/** Multi-sheet Excel download (one sheet per spec). */
export async function downloadWorkbook(filename: string, sheets: ReadonlyArray<SheetSpec>): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((c) => c ?? ""))), s.name.slice(0, 31));
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
