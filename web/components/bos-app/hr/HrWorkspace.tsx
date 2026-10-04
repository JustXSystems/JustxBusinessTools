"use client";

import { HR_MODULES } from "@/components/bos-design/data/hrm";
import { LiveWorkspace, liveOf, previewOf, useBosApp, useWorkspaceModule, type LiveModule } from "../core";
import { Employees } from "./Employees";
import { HrOverview } from "./HrOverview";
import { LeaveAttendance } from "./LeaveAttendance";
import { Organization } from "./Organization";

const LEAVE_SPEC = HR_MODULES.find((m) => m.key === "leave")!;

export const HR_LIVE: ReadonlyArray<LiveModule> = [
  liveOf(HR_MODULES, "overview", () => <HrOverview />, { sub: "Headcount, attendance today, pending approvals, trends, departments and celebrations" }),
  liveOf(HR_MODULES, "employees", () => <Employees />, { sub: "Employee records, personal & emergency details with HR approval, attendance, leave and protected bank details" }),
  liveOf(HR_MODULES, "orgchart", () => <Organization />, { sub: "Departments, reporting managers and the live org chart" }),
  liveOf(HR_MODULES, "leave", () => <LeaveAttendance spec={LEAVE_SPEC} />, { sub: "Leave requests and approvals, team calendar, daily attendance and the holiday calendar" }),
  ...["recruit", "performance", "expenses", "services", "policies", "reports", "settings"].filter((k) => HR_MODULES.some((m) => m.key === k)).map((k) => previewOf(HR_MODULES, k)),
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
