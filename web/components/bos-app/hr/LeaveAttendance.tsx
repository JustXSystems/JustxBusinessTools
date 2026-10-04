"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  ApprovalRow,
  Badge,
  BalanceRow,
  Button,
  DataTable,
  Field,
  FilterChip,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  MonthCalendar,
  PersonCell,
  Segmented,
  Select,
  WidgetCard,
  type BosCalendarEvent,
  type BosColumn,
} from "@/components/bos";
import type { ModuleSpec } from "@/components/bos-design/modules/schema";
import { bos, type AttendanceStatus, type BosHoliday, type BosLeave, type LeaveType, type RosterRow } from "@/lib/bos-app/api";
import { addDaysISO, attendanceBadge, dateLabel, dateRange, LEAVE_LABEL, leaveBadge, todayLocal } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, PreviewBlocks, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ApplyLeaveDialog, ConfirmDialog, HolidayDialog } from "../dialogs";

const SHORT: Record<LeaveType, string> = { casual: "CL", sick: "SL", earned: "EL", lop: "LOP" };
const TINT: Record<LeaveType, string> = { casual: "blue", sick: "emerald", earned: "pastel-blue", lop: "coral" };
const shortName = (name: string) => {
  const [first, ...rest] = name.split(/\s+/);
  return rest.length ? `${first[0]}. ${rest[rest.length - 1]}` : first;
};

/* ---------- Requests ---------- */

function LeaveRequests() {
  const { canManage, session } = useBosApp();
  const { run, busy } = useBosAction();
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState<BosLeave | null>(null);
  const state = useBosData(async () => {
    const [list, me, staff] = await Promise.all([bos.leave(), bos.me().catch(() => ({ employee: null }) as const), canManage ? bos.employees() : Promise.resolve({ employees: [] })]);
    return { leave: list.leave, me, employees: staff.employees };
  }, [canManage]);

  return (
    <Loaded state={state}>
      {({ leave, me, employees }) => {
        const today = todayLocal();
        const pending = leave.filter((l) => l.status === "pending");
        const myId = me.employee?.id;
        const columns: BosColumn<BosLeave>[] = [
          { key: "employee", header: "Employee", cell: (l) => <PersonCell avatar={<PersonAvatar name={l.employeeName} />} name={l.employeeName} /> },
          { key: "type", header: "Type", cell: (l) => LEAVE_LABEL[l.leaveType] },
          { key: "dates", header: "Dates", mono: true, cell: (l) => dateRange(l.fromDate, l.toDate) },
          { key: "days", header: "Days", align: "right", mono: true, cell: (l) => (l.halfDay ? "½" : l.days) },
          { key: "reason", header: "Reason", cell: (l) => l.reason ?? <span className="bos-text-faint">—</span> },
          { key: "status", header: "Status", cell: (l) => <StatusBadge view={leaveBadge(l.status)} /> },
          {
            key: "actions",
            header: "",
            cell: (l) =>
              (l.status === "pending" || (l.status === "approved" && l.fromDate > today)) && (canManage || l.employeeId === myId) ? (
                <Button size="sm" variant="ghost" onClick={() => setCancelling(l)}>
                  Cancel
                </Button>
              ) : null,
          },
        ];
        const balances = me.employee
          ? me.balances
              .filter((b) => b.type !== "lop")
              .map((b) => ({ label: `${LEAVE_LABEL[b.type]} (you)`, value: b.remaining, unit: `of ${b.allowed} left` }))
          : [
              { label: "Pending requests", value: pending.length, unit: "to review" },
              { label: "Approved this month", value: leave.filter((l) => l.status === "approved" && l.fromDate.startsWith(today.slice(0, 7))).reduce((s, l) => s + l.days, 0), unit: "days" },
              { label: "Annual policy", value: session.settings.leavePolicy.casual + session.settings.leavePolicy.sick + session.settings.leavePolicy.earned, unit: "paid days" },
            ];
        return (
          <Stack>
            <BalanceRow items={balances} />
            {canManage && pending.length ? (
              <WidgetCard title="⏳ Pending approvals" dot="rose" note={`${pending.length}`}>
                {pending.map((l) => (
                  <ApprovalRow
                    key={l.id}
                    avatar={<PersonAvatar name={l.employeeName} />}
                    name={l.employeeName}
                    meta={`${LEAVE_LABEL[l.leaveType]} · ${dateRange(l.fromDate, l.toDate)} · ${l.halfDay ? "half day" : `${l.days} day${l.days === 1 ? "" : "s"}`}${l.reason ? ` · ${l.reason}` : ""}`}
                    onDecide={(d) => run(`leave-${l.id}`, () => bos.decideLeave(l.id, d), { success: d === "approved" ? "Leave approved" : "Leave rejected", tone: d === "approved" ? "emerald" : "coral", description: l.employeeName })}
                  />
                ))}
              </WidgetCard>
            ) : null}
            <ModuleToolbar>
              <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                {canManage ? "All leave requests" : "Your leave requests"}
              </span>
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" onClick={() => setApplying(true)} disabled={!canManage && !me.employee}>
                Apply leave
              </Button>
            </ModuleToolbar>
            {!canManage && !me.employee ? (
              <Alert tone="blue" title="No employee record linked">
                Ask HR to add you as an employee with your login email to apply for leave.
              </Alert>
            ) : null}
            <DataTable caption="Leave requests" columns={columns} rows={leave} rowKey={(l) => l.id} empty="No leave requests yet." />
            <ApplyLeaveDialog open={applying} onClose={() => setApplying(false)} employees={employees} />
            <ConfirmDialog
              open={cancelling !== null}
              onClose={() => setCancelling(null)}
              destructive
              title="Cancel this leave?"
              description={cancelling ? `${cancelling.employeeName} · ${LEAVE_LABEL[cancelling.leaveType]} · ${dateRange(cancelling.fromDate, cancelling.toDate)}` : undefined}
              confirmLabel="Cancel leave"
              busy={busy === "cancel"}
              onConfirm={async () => {
                if (!cancelling) return;
                await run("cancel", () => bos.cancelLeave(cancelling.id), { success: "Leave cancelled" });
                setCancelling(null);
              }}
            />
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Calendar ---------- */

export function leaveEvents(leave: ReadonlyArray<BosLeave>, holidays: ReadonlyArray<Pick<BosHoliday, "date" | "name">>, monthKey: string): BosCalendarEvent[] {
  const byDay = new Map<string, BosLeave[]>();
  for (const l of leave) {
    if (l.status !== "approved" && l.status !== "pending") continue;
    for (let d = l.fromDate; d <= l.toDate; d = addDaysISO(d, 1)) {
      if (d.startsWith(monthKey)) byDay.set(d, [...(byDay.get(d) ?? []), l]);
    }
  }
  const events: BosCalendarEvent[] = holidays.filter((h) => h.date.startsWith(monthKey)).map((h) => ({ date: h.date, label: `🎉 ${h.name}`, tint: "emerald" }));
  for (const [date, list] of byDay) {
    if (list.length > 2) events.push({ date, label: `${list.length} on leave`, tint: "amber" });
    else for (const l of list) events.push({ date, label: `${shortName(l.employeeName)} – ${SHORT[l.leaveType]}${l.status === "pending" ? " ?" : ""}`, tint: l.status === "pending" ? "amber" : TINT[l.leaveType] });
  }
  return events;
}

function LeaveCalendar() {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const state = useBosData(async () => {
    const [list, hol] = await Promise.all([bos.leave(), bos.holidays(ym.year)]);
    return { leave: list.leave, holidays: hol.holidays };
  }, [ym.year]);
  const monthKey = `${ym.year}-${String(ym.month + 1).padStart(2, "0")}`;

  return (
    <Loaded state={state} rows={1}>
      {({ leave, holidays }) => (
        <Stack gap={12}>
          <MonthCalendar
            year={ym.year}
            month={ym.month}
            today={now}
            events={leaveEvents(leave, holidays, monthKey)}
            onNavigate={setYm}
            title={`${new Date(ym.year, ym.month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} — Team leave`}
          />
          <div className="bos-row" style={{ gap: 8, flexWrap: "wrap", fontSize: 11.5 }}>
            {(Object.keys(SHORT) as LeaveType[]).map((t) => (
              <span key={t} className={`bos-cal-event bos-tint-${TINT[t]}`} style={{ display: "inline-block" }}>
                {SHORT[t]} · {LEAVE_LABEL[t]}
              </span>
            ))}
            <span className="bos-cal-event bos-tint-amber" style={{ display: "inline-block" }}>
              ? · Awaiting approval
            </span>
          </div>
        </Stack>
      )}
    </Loaded>
  );
}

/* ---------- Attendance roster ---------- */

const MARKS: ReadonlyArray<{ status: AttendanceStatus; label: string }> = [
  { status: "present", label: "Present" },
  { status: "wfh", label: "WFH" },
  { status: "half_day", label: "Half day" },
  { status: "absent", label: "Absent" },
];

function AttendanceRoster() {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const [date, setDate] = useState(todayLocal());
  const state = useBosData(() => bos.attendance(date), [date]);

  const mark = (entries: Array<{ employeeId: string; status: AttendanceStatus }>, label: string) => run("mark", () => bos.markAttendance(date, entries), { success: label, description: dateLabel(date) });

  return (
    <Stack>
      <ModuleToolbar>
        <Field label="Date">{({ id }) => <Input id={id} type="date" size="sm" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} />}</Field>
      </ModuleToolbar>
      <Loaded state={state}>
        {(day) => {
          const count = (s: AttendanceStatus | null) => day.roster.filter((r) => r.status === s).length;
          const unmarked = day.roster.filter((r) => !r.status);
          const columns: BosColumn<RosterRow>[] = [
            { key: "name", header: "Employee", cell: (r) => <PersonCell avatar={<PersonAvatar name={r.name} />} name={r.name} role={[r.designation, r.departmentName].filter(Boolean).join(" · ") || undefined} /> },
            { key: "in", header: "In", mono: true, cell: (r) => r.checkIn?.slice(0, 5) ?? "—" },
            { key: "status", header: "Status", cell: (r) => <StatusBadge view={attendanceBadge(r.status)} /> },
            ...(canManage
              ? [
                  {
                    key: "mark",
                    header: "Mark",
                    cell: (r: RosterRow) =>
                      r.status === "leave" || r.status === "holiday" ? (
                        <span className="bos-text-faint" style={{ fontSize: 11.5 }}>
                          {r.status === "leave" ? "On approved leave" : "Holiday"}
                        </span>
                      ) : (
                        <span className="bos-app-mark" role="group" aria-label={`Mark ${r.name}`}>
                          {MARKS.map((m) => (
                            <FilterChip key={m.status} active={r.status === m.status} disabled={busy !== null} onClick={() => mark([{ employeeId: r.employeeId, status: m.status }], `${r.name}: ${m.label}`)}>
                              {m.label}
                            </FilterChip>
                          ))}
                        </span>
                      ),
                  },
                ]
              : []),
          ];
          return (
            <Stack>
              {day.holiday || day.weekend ? (
                <Alert tone="blue" title={day.holiday ? `Holiday — ${day.holiday}` : "Weekly off"}>
                  Attendance is optional today; anyone marked will still be recorded.
                </Alert>
              ) : null}
              <Grid cols={4} min={140}>
                <KpiCard label="Present" value={count("present") + count("wfh") + count("half_day")} chip={{ color: "mint", glyph: "✓" }} delta={`${count("wfh")} WFH · ${count("half_day")} half day`} deltaTone="muted" />
                <KpiCard label="Absent" value={count("absent")} chip={{ color: "rose", glyph: "✕" }} delta="Unplanned" deltaTone={count("absent") ? "down" : "muted"} />
                <KpiCard label="On leave" value={count("leave")} chip={{ color: "amber", glyph: "◐" }} delta="Approved leave" deltaTone="muted" />
                <KpiCard label="Unmarked" value={unmarked.length} chip={{ color: "blue", glyph: "?" }} delta={`of ${day.roster.length} people`} deltaTone={unmarked.length ? "warn" : "up"} />
              </Grid>
              {canManage && unmarked.length ? (
                <div className="bos-row" style={{ justifyContent: "flex-end" }}>
                  <Button size="sm" variant="primary" icon="check" disabled={busy !== null} onClick={() => mark(unmarked.map((r) => ({ employeeId: r.employeeId, status: "present" })), `Marked ${unmarked.length} present`)}>
                    Mark {unmarked.length} unmarked as present
                  </Button>
                </div>
              ) : null}
              <DataTable caption="Attendance roster" columns={columns} rows={day.roster} rowKey={(r) => r.employeeId} empty="No employees yet." />
            </Stack>
          );
        }}
      </Loaded>
    </Stack>
  );
}

/* ---------- Holidays ---------- */

const KIND_BADGE = { public: { text: "MANDATORY", tone: "emerald" }, optional: { text: "RESTRICTED", tone: "blue" }, company: { text: "COMPANY", tone: "amber" } } as const;

function Holidays() {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BosHoliday | null>(null);
  const state = useBosData(() => bos.holidays(year), [year]);

  return (
    <Stack>
      <ModuleToolbar>
        <Field label="Year">
          {({ id }) => (
            <Select id={id} value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <span className="bos-spacer" />
        {canManage ? (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add holiday
          </Button>
        ) : null}
      </ModuleToolbar>
      <Loaded state={state} rows={1}>
        {({ holidays }) => (
          <DataTable
            caption={`Holidays ${year}`}
            rows={holidays}
            rowKey={(h) => h.id}
            empty={canManage ? "No holidays yet — add this year's calendar." : "No holidays published yet."}
            columns={[
              { key: "date", header: "Date", mono: true, cell: (h) => dateLabel(h.date) },
              { key: "day", header: "Day", cell: (h) => new Date(`${h.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }) },
              { key: "name", header: "Holiday", cell: (h) => h.name },
              { key: "type", header: "Type", cell: (h) => <Badge tone={KIND_BADGE[h.kind].tone}>{KIND_BADGE[h.kind].text}</Badge> },
              {
                key: "actions",
                header: "",
                cell: (h) =>
                  canManage ? (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>
                      Remove
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Loaded>
      <HolidayDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        destructive
        title={`Remove ${removing?.name ?? "holiday"}?`}
        confirmLabel="Remove"
        busy={busy === "hol-del"}
        onConfirm={async () => {
          if (!removing) return;
          await run("hol-del", () => bos.deleteHoliday(removing.id), { success: "Holiday removed" });
          setRemoving(null);
        }}
      />
    </Stack>
  );
}

/* ---------- Module ---------- */

const LIVE_TABS: Record<string, { label?: string; render: () => ReactNode }> = {
  requests: { render: () => <LeaveRequests /> },
  calendar: { render: () => <LeaveCalendar /> },
  holidays: { render: () => <Holidays /> },
  biometric: { label: "Attendance", render: () => <AttendanceRoster /> },
};

export function LeaveAttendance({ spec }: { spec: ModuleSpec }) {
  const { takeIntent } = useBosApp();
  const subtabs = spec.subtabs ?? [];
  const [tab, setTab] = useState(() => {
    const intent = takeIntent("leave");
    return intent && subtabs.some((s) => s.key === intent) ? intent : (subtabs[0]?.key ?? "requests");
  });
  const current = subtabs.find((s) => s.key === tab) ?? subtabs[0];
  const live = current ? LIVE_TABS[current.key] : undefined;

  return (
    <>
      <div className="bos-subtabs" style={{ paddingTop: 0, marginBottom: 20 }}>
        <Segmented role="tabs" size="sm" scroll aria-label="Leave and attendance sections" options={subtabs.map((s) => ({ value: s.key, label: LIVE_TABS[s.key]?.label ?? s.label }))} value={current?.key ?? tab} onChange={setTab} />
      </div>
      <div key={current?.key} className="bos-fade-in">
        {live ? live.render() : current ? <PreviewBlocks blocks={current.blocks} name={current.label} /> : null}
      </div>
    </>
  );
}
