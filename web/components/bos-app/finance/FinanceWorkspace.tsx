"use client";

import { lazy } from "react";
import { FINANCE_MODULES } from "@/components/bos-design/data/finance";
import { ActivityLog } from "../ActivityLog";
import { LiveWorkspace, liveOf, useBosApp, useWorkspaceModule, type LiveModule } from "../core";
import { FinanceDashboard } from "./FinanceDashboard";

const Accounting = lazy(() => import("./Accounting").then((m) => ({ default: m.Accounting })));
const Assets = lazy(() => import("./Assets").then((m) => ({ default: m.Assets })));
const Banking = lazy(() => import("./Banking").then((m) => ({ default: m.Banking })));
const Budgeting = lazy(() => import("./Budgeting").then((m) => ({ default: m.Budgeting })));
const Invoices = lazy(() => import("./Invoices").then((m) => ({ default: m.Invoices })));
const Expenses = lazy(() => import("./Money").then((m) => ({ default: m.Expenses })));
const GstModule = lazy(() => import("./Money").then((m) => ({ default: m.GstModule })));
const Payables = lazy(() => import("./Money").then((m) => ({ default: m.Payables })));
const Receivables = lazy(() => import("./Money").then((m) => ({ default: m.Receivables })));
const Parties = lazy(() => import("./Parties").then((m) => ({ default: m.Parties })));
const Payroll = lazy(() => import("./Payroll").then((m) => ({ default: m.Payroll })));
const FinanceReports = lazy(() => import("./Reports").then((m) => ({ default: m.FinanceReports })));
const SalesBilling = lazy(() => import("./SalesBilling").then((m) => ({ default: m.SalesBilling })));

export const FINANCE_LIVE: ReadonlyArray<LiveModule> = [
  liveOf(FINANCE_MODULES, "dashboard", () => <FinanceDashboard />, {
    sub: "Revenue, spend and net this month · receivables and payables · alerts, approvals and aging",
    compact: true,
  }),
  {
    key: "customers",
    label: "Customers & Vendors",
    icon: "👥",
    title: "Customers & Vendors",
    sub: "One customer and vendor master — synced from Quotation and Site Survey, used by invoices, bills and projects",
    render: () => <Parties />,
  },
  liveOf(FINANCE_MODULES, "accounting", () => <Accounting />, { sub: "Chart of accounts · general ledger built from every BOS record · manual entries · trial balance · opening balances" }),
  liveOf(FINANCE_MODULES, "invoices", () => <Invoices />, { sub: "GST tax invoices · CGST/SGST or IGST by place of supply · drafts, issue, payments, print / PDF" }),
  liveOf(FINANCE_MODULES, "receivables", () => <Receivables />, { sub: "Outstanding invoices, aging buckets, top balances and payment collection" }),
  liveOf(FINANCE_MODULES, "payables", () => <Payables />, { sub: "Vendor bills with owner approval, due dates, payment tracking and input GST" }),
  liveOf(FINANCE_MODULES, "salesbilling", () => <SalesBilling />, { sub: "Quotations, sales orders and delivery challans that convert into GST invoices · product catalog · POS counter" }),
  liveOf(FINANCE_MODULES, "banking", () => <Banking />, { sub: "Bank & cash accounts · statement import · reconciliation against invoices, bills, claims and payroll" }),
  liveOf(FINANCE_MODULES, "gsttax", () => <GstModule />, { sub: "Monthly output tax, input tax credit and net GST payable — ready for GSTR-1 / 3B" }),
  liveOf(FINANCE_MODULES, "payroll", () => <Payroll />, { sub: "Monthly payroll runs, salary structures, PF / ESI / PT / TDS, payslips and bank advice" }),
  liveOf(FINANCE_MODULES, "expenses", () => <Expenses />, { sub: "Expense claims, approvals, reimbursements and category spend" }),
  liveOf(FINANCE_MODULES, "budgeting", () => <Budgeting />, { sub: "Annual budget by category or department · budget vs actual · month-by-month plan · projected year-end" }),
  liveOf(FINANCE_MODULES, "assets", () => <Assets />, { sub: "Asset register · who has what and where · maintenance, transfers and disposal · WDV / SLM depreciation schedule" }),
  liveOf(FINANCE_MODULES, "reports", () => <FinanceReports />, { sub: "Profit & loss for any period, with sales, purchase and expense registers — download as CSV" }),
  liveOf(FINANCE_MODULES, "audit", () => <ActivityLog initialScope="finance" />, { sub: "Append-only trail of every financial action — who, what and when" }),
];

export function FinanceWorkspace() {
  const { session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("finance", "dashboard");
  return (
    <LiveWorkspace
      modules={FINANCE_LIVE}
      active={nav.active}
      onSelect={nav.onSelect}
      navSeq={nav.navSeq}
      accent="emerald"
      brandName={session.brand?.name || session.settings.companyName || "Justx Finance"}
      logoSrc={logoSrc}
      onSearch={openPalette}
      label="Finance modules"
    />
  );
}
