"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ImsModuleKey, ImsPermission, ImsSession } from "@/lib/ims/api";

/**
 * Module registry — the single source for the sidebar, the command palette,
 * More actions and deep links (`?m=<key>&open=<id>`). Each module is a lazy,
 * prop-less component that reads the app through `useIms()`.
 *
 * Named exports must be referenced with **static** property access inside the
 * same `.then((m) => …)` as the import (same pattern as BOS). A helper that
 * takes `(mod) => mod.X` or `mod[name]` can be tree-shaken by webpack/Turbopack
 * so `default` is undefined and production crashes as "i is not a function".
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

export const IMS_MODULES: ReadonlyArray<ImsModuleDef> = [
  /* Inventory */
  { key: "dashboard", label: "Dashboard", icon: "◧", section: "Inventory", desc: "Stock health, movements and what needs attention", keywords: "home overview kpi", component: lazy(() => import("./inventory/Dashboard").then((m) => ({ default: m.DashboardModule }))) },
  { key: "stockin", label: "Stock In", icon: "⬇", section: "Inventory", desc: "Receive goods into stock", keywords: "goods received inward grn", anyOf: ["stockIn"], component: lazy(() => import("./inventory/StockEntry").then((m) => ({ default: m.StockInModule }))) },
  { key: "stockout", label: "Stock Out", icon: "⬆", section: "Inventory", desc: "Issue or sell goods from stock", keywords: "outward dispatch issue", anyOf: ["stockOut"], component: lazy(() => import("./inventory/StockEntry").then((m) => ({ default: m.StockOutModule }))) },
  { key: "stock", label: "Full Stock", icon: "▦", section: "Inventory", desc: "Every item with stock, value and aging", keywords: "inventory valuation aging", component: lazy(() => import("./inventory/FullStock").then((m) => ({ default: m.FullStockModule }))) },
  { key: "checks", label: "Stock Check", icon: "☑", section: "Inventory", desc: "Count physical stock and reconcile", keywords: "audit count physical verification", anyOf: ["stockCheck", "approvals"], component: lazy(() => import("./inventory/StockChecks").then((m) => ({ default: m.StockChecksModule }))) },
  { key: "lowstock", label: "Restock List", icon: "⚠", section: "Inventory", desc: "Items below minimum and reorder suggestions", keywords: "low stock reorder", component: lazy(() => import("./inventory/LowStock").then((m) => ({ default: m.LowStockModule }))) },
  { key: "items", label: "Items", icon: "📦", section: "Inventory", desc: "Products master — add, edit, import", keywords: "product catalog sku barcode", component: lazy(() => import("./inventory/Items").then((m) => ({ default: m.ItemsModule }))) },

  /* Purchasing */
  { key: "parties", label: "Suppliers & Customers", icon: "🚚", section: "Purchasing", desc: "Vendors, customers, GSTIN and credit", keywords: "vendor supplier customer party", anyOf: ["suppliers", "po", "sales", "receivables", "payables"], component: lazy(() => import("./purchase/Parties").then((m) => ({ default: m.PartiesModule }))) },
  { key: "purchase", label: "Purchase Orders", icon: "🛒", section: "Purchasing", desc: "Create, send and receive purchase orders", keywords: "po order copy buy", anyOf: ["po", "approvals"], component: lazy(() => import("./purchase/PurchaseOrders").then((m) => ({ default: m.PurchaseModule }))) },
  { key: "approvals", label: "Approvals", icon: "🛡", section: "Purchasing", desc: "POs, bills and stock checks awaiting sign-off", keywords: "approve reject pending", anyOf: ["approvals"], component: lazy(() => import("./purchase/Approvals").then((m) => ({ default: m.ApprovalsModule }))) },

  /* Sales & finance */
  { key: "sales", label: "Invoices & Billing", icon: "🧾", section: "Sales & Finance", desc: "GST invoices, bills and POS counter", keywords: "invoice bill pos sale gst", anyOf: ["sales"], component: lazy(() => import("./finance/Sales").then((m) => ({ default: m.SalesModule }))) },
  { key: "receivables", label: "Accounts Receivable", icon: "💰", section: "Sales & Finance", desc: "Collections, aging, reminders and promises", keywords: "ar collection outstanding dues reminder", anyOf: ["receivables"], component: lazy(() => import("./finance/Receivables").then((m) => ({ default: m.ReceivablesModule }))) },
  { key: "payables", label: "Accounts Payable", icon: "📤", section: "Sales & Finance", desc: "Supplier bills, approvals and payment runs", keywords: "ap vendor bill payment", anyOf: ["payables", "approvals"], component: lazy(() => import("./finance/Payables").then((m) => ({ default: m.PayablesModule }))) },
  { key: "ledger", label: "Credit / Debit Ledger", icon: "📒", section: "Sales & Finance", desc: "Party ledgers and running balances", keywords: "khata ledger statement credit debit", anyOf: ["receivables", "payables", "reports"], component: lazy(() => import("./finance/Ledger").then((m) => ({ default: m.LedgerModule }))) },
  { key: "closing", label: "Daily Closing", icon: "🗓", section: "Sales & Finance", desc: "Close the day: sales, cash and expenses", keywords: "day end cash register expense", anyOf: ["closing"], component: lazy(() => import("./finance/Closing").then((m) => ({ default: m.ClosingModule }))) },

  /* Operations */
  { key: "field", label: "Onsite Track", icon: "🧭", section: "Operations", desc: "Field staff check-ins, live location and tasks", keywords: "gps location technician visit", component: lazy(() => import("./field/Onsite").then((m) => ({ default: m.FieldModule }))) },
  { key: "returns", label: "Damage & Returns", icon: "🔧", section: "Operations", desc: "Customer / supplier returns and damaged stock", keywords: "return damage write off quarantine", anyOf: ["damage"], component: lazy(() => import("./inventory/Returns").then((m) => ({ default: m.ReturnsModule }))) },
  { key: "scanner", label: "QR Stock Scan", icon: "⌗", section: "Operations", desc: "Scan barcodes / QR to look up and move stock", keywords: "qr barcode scan camera", anyOf: ["stockIn", "stockOut", "stockCheck", "items"], component: lazy(() => import("./inventory/Scanner").then((m) => ({ default: m.ScannerModule }))) },

  /* Insights */
  { key: "reports", label: "Reports", icon: "📊", section: "Insights", desc: "Stock, sales, purchase and staff reports", keywords: "analytics export excel csv", anyOf: ["reports"], component: lazy(() => import("./insights/Reports").then((m) => ({ default: m.ReportsModule }))) },
  { key: "gst", label: "GST / HSN", icon: "％", section: "Insights", desc: "GSTR-1 / 3B ready summaries and HSN", keywords: "gstr tax hsn return", anyOf: ["reports", "audit"], component: lazy(() => import("./insights/Gst").then((m) => ({ default: m.GstModule }))) },
  { key: "history", label: "Transactions & Activity", icon: "🕘", section: "Insights", desc: "Every stock movement and change, searchable", keywords: "history log audit trail movement", component: lazy(() => import("./inventory/History").then((m) => ({ default: m.HistoryModule }))) },

  /* Auditing */
  { key: "audit", label: "Auditing / CA", icon: "✔", section: "Auditing", desc: "Auditor workspace, flags, queries and bank recon", keywords: "ca auditor compliance bank reconcile", anyOf: ["audit", "reports"], component: lazy(() => import("./system/Audit").then((m) => ({ default: m.AuditModule }))) },
  { key: "excise", label: "Excise Records", icon: "🍷", section: "Auditing", desc: "Permits, batches and duty paid", keywords: "excise liquor permit duty", when: (s) => s.settings.exciseActive, component: lazy(() => import("./system/Excise").then((m) => ({ default: m.ExciseModule }))) },

  /* System */
  { key: "integrations", label: "Tally & POS", icon: "🔌", section: "System", desc: "Tally ERP sync and POS integration", keywords: "tally pos sync integration xml", anyOf: ["integrations"], component: lazy(() => import("./system/Integrations").then((m) => ({ default: m.IntegrationsModule }))) },
  { key: "connect", label: "Connected Tools", icon: "⧉", section: "System", desc: "Quotations, BOS catalog and other JBT tools", keywords: "quotation bos import link", component: lazy(() => import("./system/Connect").then((m) => ({ default: m.ConnectModule }))) },
  { key: "helpdesk", label: "Help Desk & FAQ", icon: "🛟", section: "System", desc: "Raise a ticket or browse common questions", keywords: "support ticket help faq", component: lazy(() => import("./system/Helpdesk").then((m) => ({ default: m.HelpdeskModule }))) },
  { key: "settings", label: "Settings", icon: "⚙", section: "System", desc: "Business profile, team, roles and preferences", keywords: "preferences team roles permissions prefix", component: lazy(() => import("./settings/Settings").then((m) => ({ default: m.SettingsModule }))) },
  { key: "more", label: "More Actions", icon: "⊞", section: "System", desc: "Every action in one place, with favourites", keywords: "all actions launcher", component: lazy(() => import("./MoreActions").then((m) => ({ default: m.MoreActionsModule }))) },
];

export const MODULE_KEYS: ReadonlySet<string> = new Set(IMS_MODULES.map((x) => x.key));

/** Modules this caller can see (permission + business-type gates). */
export function visibleModules(session: ImsSession): ImsModuleDef[] {
  const perms = new Set(session.access.perms);
  return IMS_MODULES.filter((x) => (!x.anyOf || x.anyOf.some((p) => perms.has(p))) && (!x.when || x.when(session)));
}

export const moduleDef = (key: string): ImsModuleDef | undefined => IMS_MODULES.find((x) => x.key === key);
