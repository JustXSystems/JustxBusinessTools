"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ImsModuleKey, ImsPermission, ImsSession } from "@/lib/ims/api";
import StockInScreen from "./inventory/StockIn";
import StockOutScreen from "./inventory/StockOut";

/**
 * Module registry — the single source for the sidebar, the command palette,
 * More actions and deep links (`?m=<key>&open=<id>`). Each module is a lazy,
 * prop-less component that reads the app through `useIms()`.
 *
 * Screens export **default**. Stock In/Out are also imported statically and
 * wrapped with `eager()` so a bad async-chunk/re-export interop cannot leave
 * `default` undefined (production crash: "i is not a function").
 */

export type ImsSection = "Inventory" | "Purchasing" | "Sales & Finance" | "Operations" | "Insights" | "Auditing" | "System";

export type ImsModuleDef = {
  key: ImsModuleKey;
  label: string;
  icon: string;
  section: ImsSection;
  /** One-line purpose, shown in More actions and the palette. */
  desc: string;
  keywords?: string;
  /** Shown when the caller holds any of these (omit = everyone). */
  anyOf?: ReadonlyArray<ImsPermission>;
  /** Only listed when the predicate passes (e.g. excise for liquor businesses). */
  when?: (session: ImsSession) => boolean;
  /** Hidden from the sidebar but reachable from More actions / palette / links. */
  navHidden?: boolean;
  component: LazyExoticComponent<ComponentType>;
};

/** React.lazy over a component already in this chunk — no async export remapping. */
const eager = (Comp: ComponentType, name: string): LazyExoticComponent<ComponentType> =>
  lazy(async () => {
    if (typeof Comp !== "function") throw new Error(`IMS screen "${name}" is not a component`);
    return { default: Comp };
  });

/** Dynamic import with a hard check that `default` is actually callable. */
const screen = (name: string, load: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> =>
  lazy(async () => {
    const mod = await load();
    const Comp = mod.default;
    if (typeof Comp !== "function") {
      throw new Error(`IMS screen "${name}" failed to load (default export is ${typeof Comp})`);
    }
    return { default: Comp };
  });

export const IMS_MODULES: ReadonlyArray<ImsModuleDef> = [
  /* Inventory */
  { key: "dashboard", label: "Dashboard", icon: "◧", section: "Inventory", desc: "Stock health, movements and what needs attention", keywords: "home overview kpi", component: screen("dashboard", () => import("./inventory/Dashboard")) },
  { key: "stockin", label: "Stock In", icon: "⬇", section: "Inventory", desc: "Receive goods into stock", keywords: "goods received inward grn", anyOf: ["stockIn"], component: eager(StockInScreen, "stockin") },
  { key: "stockout", label: "Stock Out", icon: "⬆", section: "Inventory", desc: "Issue or sell goods from stock", keywords: "outward dispatch issue", anyOf: ["stockOut"], component: eager(StockOutScreen, "stockout") },
  { key: "stock", label: "Full Stock", icon: "▦", section: "Inventory", desc: "Every item with stock, value and aging", keywords: "inventory valuation aging", component: screen("stock", () => import("./inventory/FullStock")) },
  { key: "checks", label: "Stock Check", icon: "☑", section: "Inventory", desc: "Count physical stock and reconcile", keywords: "audit count physical verification", anyOf: ["stockCheck", "approvals"], component: screen("checks", () => import("./inventory/StockChecks")) },
  { key: "lowstock", label: "Restock List", icon: "⚠", section: "Inventory", desc: "Items below minimum and reorder suggestions", keywords: "low stock reorder", component: screen("lowstock", () => import("./inventory/LowStock")) },
  { key: "items", label: "Items", icon: "📦", section: "Inventory", desc: "Products master — add, edit, import", keywords: "product catalog sku barcode", component: screen("items", () => import("./inventory/Items")) },

  /* Purchasing */
  { key: "parties", label: "Suppliers & Customers", icon: "🚚", section: "Purchasing", desc: "Vendors, customers, GSTIN and credit", keywords: "vendor supplier customer party", anyOf: ["suppliers", "po", "sales", "receivables", "payables"], component: screen("parties", () => import("./purchase/Parties")) },
  { key: "purchase", label: "Purchase Orders", icon: "🛒", section: "Purchasing", desc: "Create, send and receive purchase orders", keywords: "po order copy buy", anyOf: ["po", "approvals"], component: screen("purchase", () => import("./purchase/PurchaseOrders")) },
  { key: "approvals", label: "Approvals", icon: "🛡", section: "Purchasing", desc: "POs, bills and stock checks awaiting sign-off", keywords: "approve reject pending", anyOf: ["approvals"], component: screen("approvals", () => import("./purchase/Approvals")) },

  /* Sales & finance */
  { key: "sales", label: "Invoices & Billing", icon: "🧾", section: "Sales & Finance", desc: "GST invoices, bills and POS counter", keywords: "invoice bill pos sale gst", anyOf: ["sales"], component: screen("sales", () => import("./finance/Sales")) },
  { key: "receivables", label: "Accounts Receivable", icon: "💰", section: "Sales & Finance", desc: "Collections, aging, reminders and promises", keywords: "ar collection outstanding dues reminder", anyOf: ["receivables"], component: screen("receivables", () => import("./finance/Receivables")) },
  { key: "payables", label: "Accounts Payable", icon: "📤", section: "Sales & Finance", desc: "Supplier bills, approvals and payment runs", keywords: "ap vendor bill payment", anyOf: ["payables", "approvals"], component: screen("payables", () => import("./finance/Payables")) },
  { key: "ledger", label: "Credit / Debit Ledger", icon: "📒", section: "Sales & Finance", desc: "Party ledgers and running balances", keywords: "khata ledger statement credit debit", anyOf: ["receivables", "payables", "reports"], component: screen("ledger", () => import("./finance/Ledger")) },
  { key: "closing", label: "Daily Closing", icon: "🗓", section: "Sales & Finance", desc: "Close the day: sales, cash and expenses", keywords: "day end cash register expense", anyOf: ["closing"], component: screen("closing", () => import("./finance/Closing")) },

  /* Operations */
  { key: "field", label: "Onsite Track", icon: "🧭", section: "Operations", desc: "Field staff check-ins, live location and tasks", keywords: "gps location technician visit", component: screen("field", () => import("./field/Onsite")) },
  { key: "returns", label: "Damage & Returns", icon: "🔧", section: "Operations", desc: "Customer / supplier returns and damaged stock", keywords: "return damage write off quarantine", anyOf: ["damage"], component: screen("returns", () => import("./inventory/Returns")) },
  { key: "scanner", label: "QR Stock Scan", icon: "⌗", section: "Operations", desc: "Scan barcodes / QR to look up and move stock", keywords: "qr barcode scan camera", anyOf: ["stockIn", "stockOut", "stockCheck", "items"], component: screen("scanner", () => import("./inventory/Scanner")) },

  /* Insights */
  { key: "reports", label: "Reports", icon: "📊", section: "Insights", desc: "Stock, sales, purchase and staff reports", keywords: "analytics export excel csv", anyOf: ["reports"], component: screen("reports", () => import("./insights/Reports")) },
  { key: "gst", label: "GST / HSN", icon: "％", section: "Insights", desc: "GSTR-1 / 3B ready summaries and HSN", keywords: "gstr tax hsn return", anyOf: ["reports", "audit"], component: screen("gst", () => import("./insights/Gst")) },
  { key: "history", label: "Transactions & Activity", icon: "🕘", section: "Insights", desc: "Every stock movement and change, searchable", keywords: "history log audit trail movement", component: screen("history", () => import("./inventory/History")) },

  /* Auditing */
  { key: "audit", label: "Auditing / CA", icon: "✔", section: "Auditing", desc: "Auditor workspace, flags, queries and bank recon", keywords: "ca auditor compliance bank reconcile", anyOf: ["audit", "reports"], component: screen("audit", () => import("./system/Audit")) },
  { key: "excise", label: "Excise Records", icon: "🍷", section: "Auditing", desc: "Permits, batches and duty paid", keywords: "excise liquor permit duty", when: (s) => s.settings.exciseActive, component: screen("excise", () => import("./system/Excise")) },

  /* System */
  { key: "integrations", label: "Tally & POS", icon: "🔌", section: "System", desc: "Tally ERP sync and POS integration", keywords: "tally pos sync integration xml", anyOf: ["integrations"], component: screen("integrations", () => import("./system/Integrations")) },
  { key: "connect", label: "Connected Tools", icon: "⧉", section: "System", desc: "Quotations, BOS catalog and other JBT tools", keywords: "quotation bos import link", component: screen("connect", () => import("./system/Connect")) },
  { key: "helpdesk", label: "Help Desk & FAQ", icon: "🛟", section: "System", desc: "Raise a ticket or browse common questions", keywords: "support ticket help faq", component: screen("helpdesk", () => import("./system/Helpdesk")) },
  { key: "settings", label: "Settings", icon: "⚙", section: "System", desc: "Business profile, team, roles and preferences", keywords: "preferences team roles permissions prefix", component: screen("settings", () => import("./settings/Settings")) },
  { key: "more", label: "More Actions", icon: "⊞", section: "System", desc: "Every action in one place, with favourites", keywords: "all actions launcher", component: screen("more", () => import("./MoreActions")) },
];

export const MODULE_KEYS: ReadonlySet<string> = new Set(IMS_MODULES.map((x) => x.key));

/** Modules this caller can see (permission + business-type gates). */
export function visibleModules(session: ImsSession): ImsModuleDef[] {
  const perms = new Set(session.access.perms);
  return IMS_MODULES.filter((x) => (!x.anyOf || x.anyOf.some((p) => perms.has(p))) && (!x.when || x.when(session)));
}

export const moduleDef = (key: string): ImsModuleDef | undefined => IMS_MODULES.find((x) => x.key === key);
