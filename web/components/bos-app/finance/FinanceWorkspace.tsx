"use client";

import { FINANCE_MODULES } from "@/components/bos-design/data/finance";
import { ActivityLog } from "../ActivityLog";
import { LiveWorkspace, liveOf, previewOf, useBosApp, useWorkspaceModule, type LiveModule } from "../core";
import { FinanceDashboard } from "./FinanceDashboard";
import { Invoices } from "./Invoices";
import { Expenses, GstModule, Payables, Receivables } from "./Money";
import { Parties } from "./Parties";

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
  previewOf(FINANCE_MODULES, "accounting"),
  liveOf(FINANCE_MODULES, "invoices", () => <Invoices />, { sub: "GST tax invoices · CGST/SGST or IGST by place of supply · drafts, issue, payments, print / PDF" }),
  liveOf(FINANCE_MODULES, "receivables", () => <Receivables />, { sub: "Outstanding invoices, aging buckets, top balances and payment collection" }),
  liveOf(FINANCE_MODULES, "payables", () => <Payables />, { sub: "Vendor bills with owner approval, due dates, payment tracking and input GST" }),
  previewOf(FINANCE_MODULES, "salesbilling"),
  previewOf(FINANCE_MODULES, "banking"),
  liveOf(FINANCE_MODULES, "gsttax", () => <GstModule />, { sub: "Monthly output tax, input tax credit and net GST payable — ready for GSTR-1 / 3B" }),
  previewOf(FINANCE_MODULES, "payroll"),
  liveOf(FINANCE_MODULES, "expenses", () => <Expenses />, { sub: "Expense claims, approvals, reimbursements and category spend" }),
  previewOf(FINANCE_MODULES, "budgeting"),
  previewOf(FINANCE_MODULES, "assets"),
  previewOf(FINANCE_MODULES, "reports"),
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
