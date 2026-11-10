import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import type { ImsModuleKey } from "../ims/workspace.js";

/** Modules that stay available even when Admin restricts the profile. */
export const IMS_ALWAYS_ON_MODULES: ReadonlyArray<ImsModuleKey> = ["dashboard", "settings", "more", "helpdesk"];

/** Catalog for Admin UI — mirrors web/components/ims/modules.ts (no React). */
export const IMS_MODULE_CATALOG: ReadonlyArray<{
  key: ImsModuleKey;
  label: string;
  section: string;
  required?: boolean;
}> = [
  { key: "dashboard", label: "Dashboard", section: "Inventory", required: true },
  { key: "stockin", label: "Stock In", section: "Inventory" },
  { key: "stockout", label: "Stock Out", section: "Inventory" },
  { key: "stock", label: "Full Stock", section: "Inventory" },
  { key: "checks", label: "Stock Check", section: "Inventory" },
  { key: "lowstock", label: "Restock List", section: "Inventory" },
  { key: "items", label: "Items", section: "Inventory" },
  { key: "parties", label: "Suppliers & Customers", section: "Purchasing" },
  { key: "purchase", label: "Purchase Orders", section: "Purchasing" },
  { key: "approvals", label: "Approvals", section: "Purchasing" },
  { key: "sales", label: "Invoices & Billing", section: "Sales & Finance" },
  { key: "bomPackages", label: "BOM Packages", section: "Sales & Finance" },
  { key: "bom", label: "BILL OF MATERIALS - BOM", section: "Sales & Finance" },
  { key: "receivables", label: "Accounts Receivable", section: "Sales & Finance" },
  { key: "payables", label: "Accounts Payable", section: "Sales & Finance" },
  { key: "ledger", label: "Credit / Debit Ledger", section: "Sales & Finance" },
  { key: "closing", label: "Daily Closing", section: "Sales & Finance" },
  { key: "field", label: "Onsite Track", section: "Operations" },
  { key: "returns", label: "Damage & Returns", section: "Operations" },
  { key: "scanner", label: "QR Stock Scan", section: "Operations" },
  { key: "reports", label: "Reports", section: "Insights" },
  { key: "gst", label: "GST / HSN", section: "Insights" },
  { key: "history", label: "Transactions & Activity", section: "Insights" },
  { key: "audit", label: "Auditing / CA", section: "Auditing" },
  { key: "excise", label: "Excise Records", section: "Auditing" },
  { key: "integrations", label: "Tally & POS", section: "System" },
  { key: "connect", label: "Connected Tools", section: "System" },
  { key: "helpdesk", label: "Help Desk & FAQ", section: "System", required: true },
  { key: "settings", label: "Settings", section: "System", required: true },
  { key: "more", label: "More Actions", section: "System", required: true },
];

const ALL_KEYS = new Set(IMS_MODULE_CATALOG.map((m) => m.key));
const ALWAYS = new Set(IMS_ALWAYS_ON_MODULES);

/**
 * Longest-prefix first. Shared routes list every module that may need them so
 * disabling one nav item does not brick another that still uses the same API.
 */
const PATH_MODULE_RULES: ReadonlyArray<{ prefix: string; anyOf: ReadonlyArray<ImsModuleKey> }> = [
  { prefix: "/bom/packages", anyOf: ["bomPackages", "bom"] },
  { prefix: "/bom", anyOf: ["bom", "bomPackages"] },
  { prefix: "/purchase-orders", anyOf: ["purchase", "approvals", "lowstock"] },
  { prefix: "/payment-runs", anyOf: ["payables"] },
  { prefix: "/receivables", anyOf: ["receivables"] },
  { prefix: "/integrations", anyOf: ["integrations"] },
  { prefix: "/inventory", anyOf: ["items", "stock", "stockin", "stockout", "checks", "scanner"] },
  { prefix: "/low-stock", anyOf: ["lowstock", "purchase"] },
  { prefix: "/movements", anyOf: ["stockin", "stockout", "history", "scanner", "stock", "dashboard", "returns"] },
  { prefix: "/invoices", anyOf: ["sales", "receivables", "bom"] },
  { prefix: "/receipts", anyOf: ["sales", "receivables"] },
  { prefix: "/payments", anyOf: ["sales", "receivables", "payables"] },
  { prefix: "/parties", anyOf: ["parties", "purchase", "sales", "receivables", "payables", "ledger"] },
  { prefix: "/closing", anyOf: ["closing"] },
  { prefix: "/expenses", anyOf: ["ledger", "closing"] },
  { prefix: "/ledger", anyOf: ["ledger"] },
  { prefix: "/reports", anyOf: ["reports"] },
  { prefix: "/connect", anyOf: ["connect"] },
  { prefix: "/tickets", anyOf: ["helpdesk"] },
  { prefix: "/checks", anyOf: ["checks", "approvals"] },
  { prefix: "/returns", anyOf: ["returns"] },
  { prefix: "/damage", anyOf: ["returns"] },
  { prefix: "/excise", anyOf: ["excise"] },
  { prefix: "/field", anyOf: ["field"] },
  { prefix: "/audit", anyOf: ["audit"] },
  { prefix: "/items", anyOf: ["items", "stock", "stockin", "stockout", "scanner", "history", "dashboard", "bom", "sales", "lowstock"] },
  { prefix: "/bills", anyOf: ["payables"] },
  { prefix: "/sales", anyOf: ["sales"] },
  { prefix: "/gst", anyOf: ["gst", "audit"] },
  { prefix: "/pos", anyOf: ["sales"] },
];

const OPEN_PATHS = new Set([
  "/session",
  "/notifications",
  "/dashboard",
  "/events",
  "/search",
  "/settings",
  "/settings/map",
  "/team",
  "/assistant/ask",
]);

export function isImsModuleKey(v: unknown): v is ImsModuleKey {
  return typeof v === "string" && ALL_KEYS.has(v as ImsModuleKey);
}

/** Parse DB JSON. `null` means unrestricted (all modules). */
export function parseImsModules(raw: unknown): ImsModuleKey[] | null {
  if (raw == null) return null;
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const keys = arr.filter(isImsModuleKey);
  return keys.length ? normalizeEnabledModules(keys) : null;
}

/** Ensure required modules are present and keys are unique/valid. */
export function normalizeEnabledModules(keys: ReadonlyArray<string>): ImsModuleKey[] {
  const out = new Set<ImsModuleKey>();
  for (const k of IMS_ALWAYS_ON_MODULES) out.add(k);
  for (const k of keys) if (isImsModuleKey(k)) out.add(k);
  return IMS_MODULE_CATALOG.map((m) => m.key).filter((k) => out.has(k));
}

export async function getProfileImsModules(db: Pool, businessProfileId: number): Promise<ImsModuleKey[] | null> {
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ims_modules FROM business_profiles WHERE id = :id LIMIT 1`,
      { id: businessProfileId },
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return parseImsModules(row?.ims_modules);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ER_BAD_FIELD_ERROR") return null;
    throw err;
  }
}

export async function setProfileImsModules(db: Pool, businessProfileId: number, keys: ReadonlyArray<string> | null): Promise<ImsModuleKey[] | null> {
  if (keys === null) {
    await db.query(`UPDATE business_profiles SET ims_modules = NULL, config_version = config_version + 1 WHERE id = :id`, {
      id: businessProfileId,
    });
    return null;
  }
  const normalized = normalizeEnabledModules(keys);
  await db.query(`UPDATE business_profiles SET ims_modules = :modules, config_version = config_version + 1 WHERE id = :id`, {
    id: businessProfileId,
    modules: JSON.stringify(normalized),
  });
  return normalized;
}

export function moduleAllowed(enabled: ReadonlyArray<string> | null | undefined, key: string): boolean {
  if (enabled == null) return true;
  if (ALWAYS.has(key as ImsModuleKey)) return true;
  return enabled.includes(key);
}

/** Whether an `/api/ims` path is allowed under the profile module ceiling. */
export function pathAllowedForModules(path: string, enabled: ReadonlyArray<string> | null | undefined): boolean {
  if (enabled == null) return true;
  const bare = path.split("?")[0] || "/";
  if (OPEN_PATHS.has(bare) || bare.startsWith("/settings/") || bare.startsWith("/team/")) return true;
  for (const rule of PATH_MODULE_RULES) {
    if (bare === rule.prefix || bare.startsWith(`${rule.prefix}/`)) {
      return rule.anyOf.some((k) => moduleAllowed(enabled, k));
    }
  }
  return true;
}
