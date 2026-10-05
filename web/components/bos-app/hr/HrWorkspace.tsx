"use client";

import { lazy } from "react";
import { HR_MODULES } from "@/components/bos-design/data/hrm";
import { LiveWorkspace, liveOf, useBosApp, useWorkspaceModule, type LiveModule } from "../core";
import { HrOverview } from "./HrOverview";

const Employees = lazy(() => import("./Employees").then((m) => ({ default: m.Employees })));
const HrAccess = lazy(() => import("./HrAccess").then((m) => ({ default: m.HrAccess })));
const HrReports = lazy(() => import("./HrReports").then((m) => ({ default: m.HrReports })));
const LeaveAttendance = lazy(() => import("./LeaveAttendance").then((m) => ({ default: m.LeaveAttendance })));
const Organization = lazy(() => import("./Organization").then((m) => ({ default: m.Organization })));
const EmployeeServices = lazy(() => import("./EmployeeServices").then((m) => ({ default: m.EmployeeServices })));
const ExpensesAssets = lazy(() => import("./ExpensesAssets").then((m) => ({ default: m.ExpensesAssets })));
const Performance = lazy(() => import("./Performance").then((m) => ({ default: m.Performance })));
const PoliciesCompliance = lazy(() => import("./Policies").then((m) => ({ default: m.PoliciesCompliance })));
const Recruitment = lazy(() => import("./Recruitment").then((m) => ({ default: m.Recruitment })));

const LEAVE_SPEC = HR_MODULES.find((m) => m.key === "leave")!;

export const HR_LIVE: ReadonlyArray<LiveModule> = [
  liveOf(HR_MODULES, "overview", () => <HrOverview />, { sub: "Headcount, attendance today, pending approvals, trends, departments and celebrations" }),
  liveOf(HR_MODULES, "employees", () => <Employees />, { sub: "Employee records, personal & emergency details with HR approval, attendance, leave and protected bank details" }),
  liveOf(HR_MODULES, "orgchart", () => <Organization />, { sub: "Departments, reporting managers and the live org chart" }),
  liveOf(HR_MODULES, "leave", () => <LeaveAttendance spec={LEAVE_SPEC} />, { sub: "Leave requests and approvals, team calendar, daily attendance and the holiday calendar" }),
  liveOf(HR_MODULES, "recruit", () => <Recruitment />, { sub: "Roles you're hiring for · candidate pipeline · interviews and offers · new-joiner checklist and employee records" }),
  liveOf(HR_MODULES, "performance", () => <Performance />, { sub: "Training catalog and schedule · certificates · KRAs · promotions and improvement plans · recognition" }),
  liveOf(HR_MODULES, "expenses", () => <ExpensesAssets />, { sub: "Who holds which asset · returns when people leave · travel requests · expense claims" }),
  liveOf(HR_MODULES, "services", () => <EmployeeServices />, { sub: "HR helpdesk · employment, experience and salary letters · ID cards and kits" }),
  liveOf(HR_MODULES, "policies", () => <PoliciesCompliance />, { sub: "HR policies and acknowledgements · statutory compliance calendar · employee and contractor agreements" }),
  liveOf(HR_MODULES, "reports", () => <HrReports />, { sub: "Monthly attendance, leave used this financial year and headcount by department — download as CSV" }),
  liveOf(HR_MODULES, "settings", () => <HrAccess />, { sub: "Leave allowances, weekly off, employee numbering, who can do what, and the HR masters" }),
];

export function HrWorkspace() {
  const { session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("hr", "overview");
  return (
    <LiveWorkspace
      modules={HR_LIVE}
      active={nav.active}
      onSelect={nav.onSelect}
      navSeq={nav.navSeq}
      brandName={session.brand?.name || session.settings.companyName || "Justx HRM"}
      logoSrc={logoSrc}
      onSearch={openPalette}
      label="HR modules"
    />
  );
}
