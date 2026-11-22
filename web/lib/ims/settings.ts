/**
 * Settings vocabulary for the IMS web app: GST states, role descriptions, document
 * numbering previews, pick-list metadata and reminder templates. Mirrors
 * server/src/ims/logic.ts where the server enforces the same rule.
 */
import { ims, type AuditRuleSettings, type AuditSeverityAmount, type BankMatchSettings, type ImsRole, type ImsSettings, type ReminderRuleKey, type Taxonomy } from "./api";
import { commonCurrenciesFor, defaultPayMethodFor, dunningPayWithinDaysFor, installmentDefaultsFor, payMethodsFor, posPayMethodsFor } from "./finance";
import { GST_RATES } from "./format";

export const settingsApi = {
  meta: ims.settings,
  save: ims.saveSettings,
  clearOperational: ims.clearOperational,
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

/** Company code from business name — same rule as Quotation V1. */
export function companyCodeFromName(name: string): string {
  return String(name || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 3) || "JBT";
}

/** What the next document number will look like, e.g. `ZIG-PO-2026/11-0001`. */
export function docNoSample(docType: string, today: string, companyName: string, seq = 1): string {
  const code = companyCodeFromName(companyName);
  const type = String(docType || "DOC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "DOC";
  const yyyy = String(today || "").slice(0, 4) || String(new Date().getFullYear());
  const mm = String(today || "").slice(5, 7) || "01";
  return `${code}-${type}-${yyyy}/${mm}-${String(seq).padStart(4, "0")}`;
}

export const PREFIX_RE = /^[A-Za-z0-9-]{1,12}$/;

export type PrefixKey =
  | "poPrefix"
  | "invoicePrefix"
  | "cnPrefix"
  | "dnPrefix"
  | "proformaPrefix"
  | "retainerPrefix"
  | "soPrefix"
  | "soDcPrefix"
  | "billPrefix"
  | "returnPrefix"
  | "checkPrefix"
  | "ticketPrefix"
  | "bomPrefix"
  | "bomDcPrefix"
  | "bomDcReturnPrefix";
export const PREFIX_FIELDS: ReadonlyArray<{ key: PrefixKey; label: string; hint: string }> = [
  { key: "poPrefix", label: "Purchase orders", hint: "Raised to suppliers" },
  { key: "invoicePrefix", label: "Sales invoices", hint: "GST tax invoices" },
  { key: "cnPrefix", label: "Credit notes", hint: "Issued against tax invoices" },
  { key: "dnPrefix", label: "Debit notes", hint: "Supplier-side adjustments" },
  { key: "proformaPrefix", label: "Proforma invoices", hint: "Non-AR quotes to bill" },
  { key: "retainerPrefix", label: "Retainer / advance", hint: "Customer advances applied later" },
  { key: "soPrefix", label: "Sales orders", hint: "Customer orders before delivery & billing" },
  { key: "soDcPrefix", label: "Sales order delivery challans", hint: "Dispatch against a sales order" },
  { key: "billPrefix", label: "Supplier bills", hint: "Created on goods receipt" },
  { key: "returnPrefix", label: "Returns", hint: "Customer & supplier returns" },
  { key: "checkPrefix", label: "Stock checks", hint: "Physical count sessions" },
  { key: "ticketPrefix", label: "Help desk tickets", hint: "Support requests" },
  { key: "bomPrefix", label: "Bill of Materials", hint: "Confirmed BOM proposals" },
  { key: "bomDcPrefix", label: "BOM delivery challans", hint: "Material issue against a BOM" },
  { key: "bomDcReturnPrefix", label: "BOM DC returns", hint: "Unused materials returned from a DC" },
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

export const DEFAULT_REMINDER_OFFSETS: Record<ReminderRuleKey, number> = {
  "3b": -3,
  due: 0,
  "7d": 7,
  "15d": 15,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};

export function reminderRuleLabel(key: ReminderRuleKey, offset: number): string {
  if (key === "due" || offset === 0) return "On due date";
  if (offset < 0) return `${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} before due date`;
  return `${offset} day${offset === 1 ? "" : "s"} overdue`;
}

export function reminderRulesFromOffsets(offsets: Partial<Record<ReminderRuleKey, number>> | null | undefined = DEFAULT_REMINDER_OFFSETS): ReadonlyArray<{ key: ReminderRuleKey; label: string; offset: number }> {
  const merged = { ...DEFAULT_REMINDER_OFFSETS, ...(offsets ?? {}) };
  merged.due = 0;
  return (Object.keys(DEFAULT_REMINDER_OFFSETS) as ReminderRuleKey[]).map((key) => ({
    key,
    offset: merged[key],
    label: reminderRuleLabel(key, merged[key]),
  }));
}

/** Default catalogue — prefer `reminderRulesFromOffsets(settings.reminders.offsets)`. */
export const REMINDER_RULES = reminderRulesFromOffsets();

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

export const DEFAULT_PAYMENT_TERM_PRESETS: ReadonlyArray<number> = [0, 7, 15, 30, 45, 60];

/** Whole-day term chips: unique, ascending, 0–365, at most 12; empty/invalid → defaults. Mirrors server. */
export function normalizePaymentTermPresets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PAYMENT_TERM_PRESETS];
  const nums = [...new Set(raw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n >= 0 && n <= 365))].sort((a, b) => a - b).slice(0, 12);
  return nums.length ? nums : [...DEFAULT_PAYMENT_TERM_PRESETS];
}

/** GST rate list: unique, ascending, 0–100 (2 dp), at most 20; empty/invalid → standard slabs. Mirrors server. */
export function normalizeGstRateOptions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...GST_RATES];
  const nums = [...new Set(raw.map((x) => Math.round(Number(x) * 100) / 100).filter((n) => Number.isFinite(n) && n >= 0 && n <= 100))].sort((a, b) => a - b).slice(0, 20);
  return nums.length ? nums : [...GST_RATES];
}

/** Parse “0, 7, 15” style input; invalid tokens are dropped. */
export const parseNumberList = (text: string): number[] =>
  text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

/** Parse “INR, usd  EUR” style input into unique upper-case tokens (shape is checked by validation, not here). */
export const parseCodeList = (text: string): string[] => [
  ...new Set(
    text
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean),
  ),
];

/** Label for a payment-term chip. */
export const termChipLabel = (days: number): string => (days === 0 ? "On receipt" : `${days} days`);

type Wave3Keys =
  | "paymentTermPresets"
  | "defaultRoundToRupee"
  | "defaultRetentionPct"
  | "gstRateOptions"
  | "payMethods"
  | "defaultPayMethod"
  | "posPayMethods"
  | "posRoundToRupee"
  | "defaultInstallmentCount"
  | "installmentEveryMonths"
  | "maxInstallments";

/** Fill Wave-3 sales / payment defaults when an older API payload omits them. */
export function withSalesDefaults<T extends Partial<ImsSettings>>(settings: T): T & Pick<ImsSettings, Wave3Keys> {
  return { ...settings, ...salesDefaultFields(settings) };
}

function salesDefaultFields(settings: Partial<ImsSettings>): Pick<ImsSettings, Wave3Keys> {
  const inst = installmentDefaultsFor(settings);
  return {
    paymentTermPresets: normalizePaymentTermPresets(settings.paymentTermPresets),
    defaultRoundToRupee: settings.defaultRoundToRupee ?? true,
    defaultRetentionPct: Math.max(0, Math.min(100, Number(settings.defaultRetentionPct) || 0)),
    gstRateOptions: normalizeGstRateOptions(settings.gstRateOptions),
    payMethods: payMethodsFor(settings),
    defaultPayMethod: defaultPayMethodFor(settings),
    posPayMethods: posPayMethodsFor(settings),
    posRoundToRupee: settings.posRoundToRupee ?? true,
    ...inst,
  };
}

/* ---------- Settings Wave 4: ops thresholds (mirrors server/src/ims/logic.ts + wave6-logic.ts) ---------- */

export const DEFAULT_REORDER_FALLBACK_FACTOR = 2;
export const DEFAULT_BANK_MATCH_SETTINGS: Readonly<BankMatchSettings> = { windowDays: 5, autoScore: 75, amountTolerance: 0.5 };
export const DEFAULT_AUDIT_RULE_SETTINGS: Readonly<AuditRuleSettings> = {
  overdueArDays: 90,
  overdueApDays: 30,
  largeAdjustment: 25_000,
  largeWriteOff: 10_000,
  gstTolerance: 1,
  unreconciledDays: 7,
  b2cLargeLimit: 100_000,
};
export const DEFAULT_AUDIT_SEVERITY_AMOUNT: Readonly<AuditSeverityAmount> = { critical: 500_000, high: 100_000 };

/** Number clamped to [min, max]; missing / non-numeric → fallback. `int` floors, otherwise rounds to 2 dp. */
export function boundedNumber(raw: unknown, min: number, max: number, fallback: number, int = false): number {
  if (raw == null || raw === "" || typeof raw === "boolean") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = int ? Math.floor(n) : Math.round(n * 100) / 100;
  return Math.min(max, Math.max(min, v));
}

const objectOf = (raw: unknown): Record<string, unknown> | null => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null);

/** Factor 1–20 (2 dp); missing / non-positive → 2. */
export function normalizeReorderFallbackFactor(raw: unknown): number {
  if (raw == null || raw === "" || typeof raw === "boolean") return DEFAULT_REORDER_FALLBACK_FACTOR;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REORDER_FALLBACK_FACTOR;
  return Math.round(Math.min(20, Math.max(1, n)) * 100) / 100;
}

export function normalizeBankMatchDefaults(raw: unknown): BankMatchSettings {
  const o = objectOf(raw);
  const d = DEFAULT_BANK_MATCH_SETTINGS;
  return {
    windowDays: boundedNumber(o?.windowDays, 1, 30, d.windowDays, true),
    autoScore: boundedNumber(o?.autoScore, 50, 100, d.autoScore, true),
    amountTolerance: boundedNumber(o?.amountTolerance, 0, 10, d.amountTolerance),
  };
}

export function normalizeAuditRules(raw: unknown): AuditRuleSettings {
  const o = objectOf(raw);
  const d = DEFAULT_AUDIT_RULE_SETTINGS;
  return {
    overdueArDays: boundedNumber(o?.overdueArDays, 1, 3650, d.overdueArDays, true),
    overdueApDays: boundedNumber(o?.overdueApDays, 1, 3650, d.overdueApDays, true),
    largeAdjustment: boundedNumber(o?.largeAdjustment, 1, 1e9, d.largeAdjustment),
    largeWriteOff: boundedNumber(o?.largeWriteOff, 1, 1e9, d.largeWriteOff),
    gstTolerance: boundedNumber(o?.gstTolerance, 0, 100, d.gstTolerance),
    unreconciledDays: boundedNumber(o?.unreconciledDays, 0, 365, d.unreconciledDays, true),
    b2cLargeLimit: boundedNumber(o?.b2cLargeLimit, 1, 1e9, d.b2cLargeLimit),
  };
}

export function normalizeAuditSeverityAmount(raw: unknown): AuditSeverityAmount {
  const o = objectOf(raw);
  const d = DEFAULT_AUDIT_SEVERITY_AMOUNT;
  const high = boundedNumber(o?.high, 1, 1e9 - 1, d.high);
  const critical = Math.min(1e9, Math.max(high + 1, boundedNumber(o?.critical, 1, 1e9, d.critical)));
  return { critical, high };
}

type Wave4Keys = "reorderFallbackFactor" | "bankMatchDefaults" | "auditRules" | "auditSeverityAmount" | "dunningFirmPayWithinDays" | "commonCurrencies";

/** Fill Wave-4 ops thresholds when an older API payload omits them. */
function opsThresholdFields(settings: Partial<ImsSettings>): Pick<ImsSettings, Wave4Keys> {
  return {
    reorderFallbackFactor: normalizeReorderFallbackFactor(settings.reorderFallbackFactor),
    bankMatchDefaults: normalizeBankMatchDefaults(settings.bankMatchDefaults),
    auditRules: normalizeAuditRules(settings.auditRules),
    auditSeverityAmount: normalizeAuditSeverityAmount(settings.auditSeverityAmount),
    dunningFirmPayWithinDays: dunningPayWithinDaysFor(settings.dunningFirmPayWithinDays),
    commonCurrencies: commonCurrenciesFor(settings),
  };
}

/** Fill Wave-1+ ops fields when an older API payload omits them. */
export function withOpsSettingsDefaults<T extends Partial<ImsSettings>>(
  settings: T,
): T &
  Pick<ImsSettings, "bomPrefix" | "bomDcPrefix" | "bomDcReturnPrefix" | "printPackMax" | "attachmentMaxBytes" | "agingBreaks" | "arPriority" | "apDueSoonDays" | Wave3Keys | Wave4Keys> {
  const reminders = settings.reminders
    ? {
        ...settings.reminders,
        offsets: { ...DEFAULT_REMINDER_OFFSETS, ...(settings.reminders.offsets ?? {}), due: 0 as const },
      }
    : settings.reminders;
  return {
    ...settings,
    ...(reminders ? { reminders } : {}),
    bomPrefix: settings.bomPrefix || "BOM",
    bomDcPrefix: settings.bomDcPrefix || "DC",
    bomDcReturnPrefix: settings.bomDcReturnPrefix || "RTN",
    printPackMax: Math.max(1, Math.min(200, Number(settings.printPackMax) || 25)),
    attachmentMaxBytes: Math.max(256 * 1024, Math.min(20 * 1024 * 1024, Number(settings.attachmentMaxBytes) || 2 * 1024 * 1024)),
    agingBreaks:
      Array.isArray(settings.agingBreaks) && settings.agingBreaks.length === 4
        ? settings.agingBreaks.map((n) => Math.floor(Number(n)))
        : [15, 30, 60, 90],
    arPriority: {
      critical: Math.max(2, Math.floor(Number(settings.arPriority?.critical) || 91)),
      high: Math.max(1, Math.floor(Number(settings.arPriority?.high) || 61)),
      medium: Math.max(1, Math.floor(Number(settings.arPriority?.medium) || 31)),
    },
    apDueSoonDays: Math.max(1, Math.min(365, Math.floor(Number(settings.apDueSoonDays) || 7))),
    ...salesDefaultFields(settings),
    ...opsThresholdFields(settings),
  };
}

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
