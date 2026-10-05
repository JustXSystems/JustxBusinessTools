"use client";

import { useState } from "react";
import { Alert, Button, DataTable, Field, Grid, Input, KpiCard, ModuleToolbar, Pagination, Segmented, WidgetCard, WidgetRow, type BosColumn } from "@/components/bos";
import { bos, type HrReport, type HrReportRow, type LeaveType } from "@/lib/bos-app/api";
import { dateLabel, LEAVE_LABEL, monthLabel, todayLocal } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, useBosApp, useBosData } from "../core";

type View = "attendance" | "leave";

const ALLOWANCE_TYPES: ReadonlyArray<Exclude<LeaveType, "lop">> = ["casual", "sick", "earned"];
const SHORT: Record<LeaveType, string> = { casual: "Casual", sick: "Sick", earned: "Earned", lop: "LOP" };

const pctColor = (pct: number) => (pct >= 90 ? "var(--bos-emerald-600)" : pct >= 75 ? "var(--bos-amber-600)" : "var(--bos-coral-600)");

const employeeCell = (e: HrReportRow) => (
  <span>
    {e.name}
    <span className="bos-text-faint"> · {e.empCode}</span>
  </span>
);

const ATTENDANCE_COLUMNS: BosColumn<HrReportRow>[] = [
  { key: "employee", header: "Employee", cell: employeeCell },
  { key: "department", header: "Department", cell: (e) => e.departmentName ?? "—" },
  { key: "working", header: "Working days", align: "right", mono: true, cell: (e) => e.workingDays },
  { key: "present", header: "Present", align: "right", mono: true, cell: (e) => e.present },
  { key: "wfh", header: "WFH", align: "right", mono: true, cell: (e) => e.wfh },
  { key: "half", header: "Half day", align: "right", mono: true, cell: (e) => e.halfDay },
  { key: "absent", header: "Absent", align: "right", mono: true, cell: (e) => e.absent },
  { key: "leave", header: "Leave", align: "right", mono: true, cell: (e) => e.leave },
  { key: "unmarked", header: "Unmarked", align: "right", mono: true, cell: (e) => (e.unmarked ? <span style={{ color: "var(--bos-amber-600)", fontWeight: 650 }}>{e.unmarked}</span> : 0) },
  { key: "pct", header: "Attendance", align: "right", mono: true, cell: (e) => (e.workingDays ? <span style={{ color: pctColor(e.attendancePct), fontWeight: 650 }}>{e.attendancePct}%</span> : "—") },
];

function leaveColumns(r: HrReport): BosColumn<HrReportRow>[] {
  return [
    { key: "employee", header: "Employee", cell: employeeCell },
    { key: "department", header: "Department", cell: (e) => e.departmentName ?? "—" },
    ...ALLOWANCE_TYPES.map<BosColumn<HrReportRow>>((t) => ({
      key: t,
      header: `${SHORT[t]} (of ${r.leavePolicy[t]})`,
      align: "right",
      mono: true,
      cell: (e) => <span style={e.leaveUsed[t] > r.leavePolicy[t] ? { color: "var(--bos-coral-600)", fontWeight: 650 } : undefined}>{e.leaveUsed[t]}</span>,
    })),
    { key: "lop", header: "LOP", align: "right", mono: true, cell: (e) => e.leaveUsed.lop },
  ];
}

function exportReport(r: HrReport, view: View) {
  if (view === "attendance") {
    const headers = ["Employee code", "Employee", "Department", "Working days", "Present", "WFH", "Half day", "Absent", "Leave", "Unmarked", "Attendance %"];
    downloadCsv(
      `attendance_${r.month}.csv`,
      headers,
      r.employees.map((e) => ({
        "Employee code": e.empCode,
        Employee: e.name,
        Department: e.departmentName ?? "",
        "Working days": e.workingDays,
        Present: e.present,
        WFH: e.wfh,
        "Half day": e.halfDay,
        Absent: e.absent,
        Leave: e.leave,
        Unmarked: e.unmarked,
        "Attendance %": e.workingDays ? e.attendancePct : "",
      })),
    );
    return;
  }
  const typeHeaders = ALLOWANCE_TYPES.flatMap((t) => [`${LEAVE_LABEL[t]} used`, `${LEAVE_LABEL[t]} allowed`]);
  const headers = ["Employee code", "Employee", "Department", ...typeHeaders, "Loss of pay used"];
  downloadCsv(
    `leave_FY${r.fiscalYear}_to_${r.month}.csv`,
    headers,
    r.employees.map((e) => ({
      "Employee code": e.empCode,
      Employee: e.name,
      Department: e.departmentName ?? "",
      ...Object.fromEntries(ALLOWANCE_TYPES.flatMap((t) => [[`${LEAVE_LABEL[t]} used`, e.leaveUsed[t]], [`${LEAVE_LABEL[t]} allowed`, r.leavePolicy[t]]])),
      "Loss of pay used": e.leaveUsed.lop,
    })),
  );
}

/** HR → Reports & Analytics: monthly attendance, leave used this financial year and headcount by department. */
export function HrReports() {
  const { canManage } = useBosApp();
  return canManage ? <ReportsBody /> : <ManagersOnly>HR reports show everyone&apos;s attendance and leave, so they&apos;re limited to owners and admins. Your own record is under Home → My Profile.</ManagersOnly>;
}

function ReportsBody() {
  const { navigate } = useBosApp();
  const thisMonth = todayLocal().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<View>("attendance");
  const state = useBosData(() => bos.hrReport(month), [month]);

  return (
    <Stack>
      <ModuleToolbar>
        <Field label="Month">{({ id }) => <Input id={id} type="month" size="sm" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
      </ModuleToolbar>
      <Loaded state={state}>
        {(r) => {
          const unmarked = r.employees.reduce((s, e) => s + e.unmarked, 0);
          return (
            <Stack>
              <Grid cols={4} min={140}>
                <KpiCard label="Headcount" value={r.totals.headcount} chip={{ color: "blue", glyph: "👥" }} delta={`${r.totals.joiners} joined · ${r.totals.exits} left`} deltaTone="muted" />
                <KpiCard label="Working days" value={r.workingDays} chip={{ color: "lavender", glyph: "▦" }} delta={`${dateLabel(r.from)} – ${dateLabel(r.to)}`} deltaTone="muted" />
                <KpiCard
                  label="Average attendance"
                  value={`${r.totals.attendancePct}%`}
                  chip={{ color: "mint", glyph: "✓" }}
                  delta="Present + WFH + ½ half days"
                  deltaTone={r.totals.attendancePct >= 90 ? "up" : "warn"}
                />
                <KpiCard
                  label="Unmarked days"
                  value={unmarked}
                  valueTone={unmarked ? "amber" : undefined}
                  chip={{ color: "amber", glyph: "?" }}
                  delta={unmarked ? "Mark them in Leave & Attendance" : "Every working day is marked"}
                  deltaTone={unmarked ? "warn" : "up"}
                />
              </Grid>
              <Grid template="1.6fr 1fr">
                <div>
                  <ModuleToolbar>
                    <Segmented<View>
                      role="tabs"
                      size="sm"
                      aria-label="HR report"
                      options={[
                        { value: "attendance", label: `Attendance · ${monthLabel(r.month)}` },
                        { value: "leave", label: `Leave used · FY ${r.fiscalYear}` },
                      ]}
                      value={view}
                      onChange={setView}
                    />
                  </ModuleToolbar>
                  <div style={{ marginTop: 12 }}>
                    <DataTable
                      caption={view === "attendance" ? `Attendance, ${monthLabel(r.month)}` : `Leave used, FY ${r.fiscalYear}`}
                      columns={view === "attendance" ? ATTENDANCE_COLUMNS : leaveColumns(r)}
                      rows={r.employees}
                      rowKey={(e) => e.employeeId}
                      onRowClick={(e) => navigate("hr", "employees", `open:${e.employeeId}`)}
                      empty="No employees on the rolls this month."
                      compact
                    />
                    <Pagination
                      actions={
                        <Button size="sm" disabled={!r.employees.length} onClick={() => exportReport(r, view)}>
                          Download CSV
                        </Button>
                      }
                    >
                      {r.employees.length} employee{r.employees.length === 1 ? "" : "s"}
                    </Pagination>
                  </div>
                </div>
                <Stack>
                  <WidgetCard title="🏢 Headcount by department" dot="blue" note={monthLabel(r.month)}>
                    {r.departments.length ? (
                      r.departments.map((d) => (
                        <WidgetRow
                          key={d.name}
                          label={
                            <span>
                              {d.name}
                              {d.joiners || d.exits ? <span className="bos-text-faint"> · +{d.joiners} / −{d.exits}</span> : null}
                            </span>
                          }
                          value={d.headcount}
                        />
                      ))
                    ) : (
                      <WidgetRow label={<span className="bos-text-faint">No departments yet</span>} />
                    )}
                  </WidgetCard>
                  <WidgetCard title="📚 Related" dot="lavender">
                    <WidgetRow label="Mark attendance" chevron onClick={() => navigate("hr", "leave", "biometric")} />
                    <WidgetRow label="Holiday calendar" chevron onClick={() => navigate("hr", "leave", "holidays")} />
                    <WidgetRow label="Expense claims" chevron onClick={() => navigate("finance", "expenses")} />
                  </WidgetCard>
                </Stack>
              </Grid>
              <Alert tone="blue" title="How attendance is counted">
                Working days skip your weekly off and holidays, start on the joining date and stop at today or the exit date. Approved leave is marked automatically. Leave used covers approved requests from the start of the financial year to the end of this month.
              </Alert>
            </Stack>
          );
        }}
      </Loaded>
    </Stack>
  );
}
