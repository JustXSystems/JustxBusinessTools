"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ImsModuleKey, ImsPermission, ImsSession } from "@/lib/ims/api";

/**
 * Module registry — the single source for the sidebar, the command palette,
 * More actions and deep links (`?m=<key>&open=<id>`). Each module is a lazy,
 * prop-less component that reads the app through `useIms()`.
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

const m = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((mod) => ({ default: mod[name] })));

export const IMS_MODULES: ReadonlyArray<ImsModuleDef> = [
  /* Inventory */
  { key: "dashboard", label: "Dashboard", icon: "◧", section: "Inventory", desc: "Stock health, movements and what needs attention", keywords: "home overview kpi", component: m(() => import("./inventory/Dashboard"), "DashboardModule") },
  { key: "stockin", label: "Stock In", icon: "⬇", section: "Inventory", desc: "Receive goods into stock", keywords: "goods received inward grn", anyOf: ["stockIn"], component: m(() => import("./inventory/StockEntry"), "StockInModule") },
  { key: "stockout", label: "Stock Out", icon: "⬆", section: "Inventory", desc: "Issue or sell goods from stock", keywords: "outward dispatch issue", anyOf: ["stockOut"], component: m(() => import("./inventory/StockEntry"), "StockOutModule") },
  { key: "stock", label: "Full Stock", icon: "▦", section: "Inventory", desc: "Every item with stock, value and aging", keywords: "inventory valuation aging", component: m(() => import("./inventory/FullStock"), "FullStockModule") },
  { key: "checks", label: "Stock Check", icon: "☑", section: "Inventory", desc: "Count physical stock and reconcile", keywords: "audit count physical verification", anyOf: ["stockCheck", "approvals"], component: m(() => import("./inventory/StockChecks"), "StockChecksModule") },
  { key: "lowstock", label: "Restock List", icon: "⚠", section: "Inventory", desc: "Items below minimum and reorder suggestions", keywords: "low stock reorder", component: m(() => import("./inventory/LowStock"), "LowStockModule") },
  { key: "items", label: "Items", icon: "📦", section: "Inventory", desc: "Products master — add, edit, import", keywords: "product catalog sku barcode", component: m(() => import("./inventory/Items"), "ItemsModule") },

  /* Purchasing */
  { key: "parties", label: "Suppliers & Customers", icon: "🚚", section: "Purchasing", desc: "Vendors, customers, GSTIN and credit", keywords: "vendor supplier customer party", anyOf: ["suppliers", "po", "sales", "receivables", "payables"], component: m(() => import("./purchase/Parties"), "PartiesModule") },
  { key: "purchase", label: "Purchase Orders", icon: "🛒", section: "Purchasing", desc: "Create, send and receive purchase orders", keywords: "po order copy buy", anyOf: ["po", "approvals"], component: m(() => import("./purchase/PurchaseOrders"), "PurchaseModule") },
  { key: "approvals", label: "Approvals", icon: "🛡", section: "Purchasing", desc: "POs, bills and stock checks awaiting sign-off", keywords: "approve reject pending", anyOf: ["approvals"], component: m(() => import("./purchase/Approvals"), "ApprovalsModule") },

  /* Sales & finance */
  { key: "sales", label: "Invoices & Billing", icon: "🧾", section: "Sales & Finance", desc: "GST invoices, bills and POS counter", keywords: "invoice bill pos sale gst", anyOf: ["sales"], component: m(() => import("./finance/Sales"), "SalesModule") },
  { key: "receivables", label: "Accounts Receivable", icon: "💰", section: "Sales & Finance", desc: "Collections, aging, reminders and promises", keywords: "ar collection outstanding dues reminder", anyOf: ["receivables"], component: m(() => import("./finance/Receivables"), "ReceivablesModule") },
  { key: "payables", label: "Accounts Payable", icon: "📤", section: "Sales & Finance", desc: "Supplier bills, approvals and payment runs", keywords: "ap vendor bill payment", anyOf: ["payables", "approvals"], component: m(() => import("./finance/Payables"), "PayablesModule") },
  { key: "ledger", label: "Credit / Debit Ledger", icon: "📒", section: "Sales & Finance", desc: "Party ledgers and running balances", keywords: "khata ledger statement credit debit", anyOf: ["receivables", "payables", "reports"], component: m(() => import("./finance/Ledger"), "LedgerModule") },
  { key: "closing", label: "Daily Closing", icon: "🗓", section: "Sales & Finance", desc: "Close the day: sales, cash and expenses", keywords: "day end cash register expense", anyOf: ["closing"], component: m(() => import("./finance/Closing"), "ClosingModule") },

  /* Operations */
  { key: "field", label: "Onsite Track", icon: "🧭", section: "Operations", desc: "Field staff check-ins, live location and tasks", keywords: "gps location technician visit", component: m(() => import("./field/Onsite"), "FieldModule") },
  { key: "returns", label: "Damage & Returns", icon: "🔧", section: "Operations", desc: "Customer / supplier returns and damaged stock", keywords: "return damage write off quarantine", anyOf: ["damage"], component: m(() => import("./inventory/Returns"), "ReturnsModule") },
  { key: "scanner", label: "QR Stock Scan", icon: "⌗", section: "Operations", desc: "Scan barcodes / QR to look up and move stock", keywords: "qr barcode scan camera", anyOf: ["stockIn", "stockOut", "stockCheck", "items"], component: m(() => import("./inventory/Scanner"), "ScannerModule") },

  /* Insights */
  { key: "reports", label: "Reports", icon: "📊", section: "Insights", desc: "Stock, sales, purchase and staff reports", keywords: "analytics export excel csv", anyOf: ["reports"], component: m(() => import("./insights/Reports"), "ReportsModule") },
  { key: "gst", label: "GST / HSN", icon: "％", section: "Insights", desc: "GSTR-1 / 3B ready summaries and HSN", keywords: "gstr tax hsn return", anyOf: ["reports", "audit"], component: m(() => import("./insights/Gst"), "GstModule") },
  { key: "history", label: "Transactions & Activity", icon: "🕘", section: "Insights", desc: "Every stock movement and change, searchable", keywords: "history log audit trail movement", component: m(() => import("./inventory/History"), "HistoryModule") },

  /* Auditing */
  { key: "audit", label: "Auditing / CA", icon: "✔", section: "Auditing", desc: "Auditor workspace, flags, queries and bank recon", keywords: "ca auditor compliance bank reconcile", anyOf: ["audit", "reports"], component: m(() => import("./system/Audit"), "AuditModule") },
  { key: "excise", label: "Excise Records", icon: "🍷", section: "Auditing", desc: "Permits, batches and duty paid", keywords: "excise liquor permit duty", when: (s) => s.settings.exciseActive, component: m(() => import("./system/Excise"), "ExciseModule") },

  /* System */
  { key: "integrations", label: "Tally & POS", icon: "🔌", section: "System", desc: "Tally ERP sync and POS integration", keywords: "tally pos sync integration xml", anyOf: ["integrations"], component: m(() => import("./system/Integrations"), "IntegrationsModule") },
  { key: "connect", label: "Connected Tools", icon: "⧉", section: "System", desc: "Quotations, BOS catalog and other JBT tools", keywords: "quotation bos import link", component: m(() => import("./system/Connect"), "ConnectModule") },
  { key: "helpdesk", label: "Help Desk & FAQ", icon: "🛟", section: "System", desc: "Raise a ticket or browse common questions", keywords: "support ticket help faq", component: m(() => import("./system/Helpdesk"), "HelpdeskModule") },
  { key: "settings", label: "Settings", icon: "⚙", section: "System", desc: "Business profile, team, roles and preferences", keywords: "preferences team roles permissions prefix", component: m(() => import("./settings/Settings"), "SettingsModule") },
  { key: "more", label: "More Actions", icon: "⊞", section: "System", desc: "Every action in one place, with favourites", keywords: "all actions launcher", component: m(() => import("./MoreActions"), "MoreActionsModule") },
];

export const MODULE_KEYS: ReadonlySet<string> = new Set(IMS_MODULES.map((x) => x.key));

/** Modules this caller can see (permission + business-type gates). */
export function visibleModules(session: ImsSession): ImsModuleDef[] {
  const perms = new Set(session.access.perms);
  return IMS_MODULES.filter((x) => (!x.anyOf || x.anyOf.some((p) => perms.has(p))) && (!x.when || x.when(session)));
}

export const moduleDef = (key: string): ImsModuleDef | undefined => IMS_MODULES.find((x) => x.key === key);
