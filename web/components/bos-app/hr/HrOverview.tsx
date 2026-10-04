"use client";

import { useState } from "react";
import {
  AiPill,
  Badge,
  BarChart,
  Button,
  Celebrations,
  ChartCard,
  DonutChart,
  Grid,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  WidgetCard,
  WidgetRow,
  type BosCelebration,
  type BosDonutSegment,
} from "@/components/bos";
import { bos, type BosEmployee, type HrOverview as Overview, type RosterRow } from "@/lib/bos-app/api";
import { dayMonth, initialsOf, timeAgo, todayLocal } from "@/lib/bos-app/format";
import { Loaded, Stack, useBosApp, useBosData } from "../core";

const HR_ENTITIES = new Set(["employee", "leave", "attendance", "holiday", "department", "profile_change"]);
const PASTELS = ["rose", "mint", "blue", "lavender", "sage"] as const;
const DONUT_TONES = ["emerald", "coral", "blue", "amber"] as const;

export function toCelebrations(list: Overview["celebrations"]): BosCelebration[] {
  return list.map((c, i) => {
    const pastel = PASTELS[i % PASTELS.length];
    const when = c.inDays === 0 ? "today" : c.inDays === 1 ? "tomorrow" : `in ${c.inDays}d`;
    return {
      initials: initialsOf(c.name),
      name: c.name,
      tag: c.kind === "birthday" ? `🎂 Birthday ${when}` : `🎉 ${c.years ?? ""} yr${c.years === 1 ? "" : "s"} ${when}`,
      tint: c.kind === "birthday" ? "coral" : "amber",
      avatar: { fill: `var(--bos-pastel-${pastel})`, ink: `var(--bos-pastel-${pastel}-ink)` },
    };
  });
}

function departmentDonut(byDept: Overview["byDepartment"]): { segments: BosDonutSegment[]; total: number } {
  const total = byDept.reduce((s, d) => s + d.count, 0);
  if (!total) return { segments: [{ label: "No employees yet", value: 1, tone: "faint" }], total };
  const sorted = [...byDept].sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3).reduce((s, d) => s + d.count, 0);
  const segments: BosDonutSegment[] = top.map((d, i) => ({ label: d.name, value: d.count, tone: DONUT_TONES[i] }));
  if (rest) segments.push({ label: "Other", value: rest, tone: DONUT_TONES[3] });
  return { segments, total };
}

const ON_DUTY = new Set(["present", "wfh", "half_day"]);

export function HrOverview() {
  const { navigate, openPalette } = useBosApp();
  const [dept, setDept] = useState("all");
  const state = useBosData(async () => {
    const [overview, staff, day, events] = await Promise.all([
      bos.hrOverview(),
      bos.employees(),
      bos.attendance(todayLocal()).catch(() => null),
      bos.events({ limit: 40 }).catch(() => ({ events: [] })),
    ]);
    return { overview, employees: staff.employees, roster: day?.roster ?? null, events: events.events.filter((e) => HR_ENTITIES.has(e.entityType)) };
  });

  return (
    <Loaded state={state} rows={3}>
      {({ overview: o, employees, roster, events }) => {
        const inDept = <T extends { departmentName: string | null }>(list: ReadonlyArray<T>) => (dept === "all" ? list : list.filter((x) => (x.departmentName ?? "Unassigned") === dept));
        const people: BosEmployee[] = inDept(employees).filter((e) => e.status !== "exited");
        const day: ReadonlyArray<RosterRow> | null = roster ? inDept(roster) : null;
        const present = day ? day.filter((r) => r.status && ON_DUTY.has(r.status)).length : o.kpis.present;
        const marked = day ? day.filter((r) => r.status).length : o.kpis.attendanceMarked;
        const onLeave = day ? day.filter((r) => r.status === "leave").length : o.kpis.onLeave;
        const month = todayLocal().slice(0, 7);
        const joiners = people.filter((e) => e.joinDate.startsWith(month)).length;
        const probation = people.filter((e) => e.status === "probation").length;
        const notice = people.filter((e) => e.status === "notice").length;
        const pendingTotal = o.pending.leave + o.pending.expenses + o.pending.profileChanges;
        const donut = departmentDonut(o.byDepartment);
        const trendFirst = o.trend[0];
        const trendLast = o.trend[o.trend.length - 1];
        const deptOptions = [{ value: "all", label: "All" }, ...o.byDepartment.map((d) => ({ value: d.name, label: d.name }))];

        return (
          <>
            <ModuleToolbar>
              <SearchInput readOnly placeholder="Search or jump to…" aria-label="Open command palette" onClick={openPalette} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPalette()} />
              <AiPill
                action={
                  <Button size="sm" variant="ghost" onClick={() => navigate("hr", "leave")}>
                    Review
                  </Button>
                }
              >
                {pendingTotal
                  ? `${pendingTotal} request${pendingTotal === 1 ? "" : "s"} waiting on HR — ${o.pending.leave} leave, ${o.pending.profileChanges} profile, ${o.pending.expenses} expense`
                  : marked < people.length
                    ? `Attendance marked for ${marked} of ${people.length} today`
                    : "All caught up — no pending HR approvals"}
              </AiPill>
            </ModuleToolbar>
            {deptOptions.length > 2 ? (
              <div className="bos-subtabs">
                <Segmented role="radio" size="sm" scroll aria-label="Department filter" options={deptOptions} value={dept} onChange={setDept} />
              </div>
            ) : null}
            <Stack>
              <Grid cols={4} min={140}>
                <KpiCard label="Total headcount" value={people.length} chip={{ color: "blue", glyph: "◎" }} delta={joiners ? `+${joiners} joined this month` : "No joiners this month"} deltaTone={joiners ? "up" : "muted"} />
                <KpiCard label="Present today" value={present} chip={{ color: "mint", glyph: "✓" }} delta={people.length ? `${marked} of ${people.length} marked` : "—"} deltaTone={marked < people.length ? "warn" : "up"} />
                <KpiCard label="On leave today" value={onLeave} chip={{ color: "rose", glyph: "◐" }} delta={`${o.pending.leave} request${o.pending.leave === 1 ? "" : "s"} pending`} deltaTone="warn" />
                <KpiCard label="On probation" value={probation} chip={{ color: "lavender", glyph: "◈" }} delta={notice ? `${notice} serving notice` : "None on notice"} deltaTone="muted" />
              </Grid>
              <Grid cols={3}>
                <WidgetCard title="🔔 Notifications" dot="blue" note={dept !== "all" ? dept : undefined}>
                  {events.length ? (
                    events.slice(0, 3).map((e) => <WidgetRow key={e.id} label={e.summary} value={timeAgo(e.createdAt)} valueTone="faint" soft />)
                  ) : (
                    <WidgetRow label={<span className="bos-text-faint">No HR activity yet</span>} />
                  )}
                </WidgetCard>
                <WidgetCard title="⏳ Pending Approvals" dot="rose">
                  <WidgetRow label="Leave requests" value={o.pending.leave} valueTone={o.pending.leave ? "amber" : "faint"} onClick={() => navigate("hr", "leave")} />
                  <WidgetRow label="Expense reimbursements" value={o.pending.expenses} valueTone={o.pending.expenses ? "amber" : "faint"} onClick={() => navigate("finance", "expenses")} />
                  <WidgetRow label="Profile change requests" value={o.pending.profileChanges} valueTone={o.pending.profileChanges ? "amber" : "faint"} onClick={() => navigate("hr", "employees")} />
                </WidgetCard>
                <WidgetCard title="📅 Upcoming Holidays" dot="mint">
                  {o.holidays.length ? (
                    o.holidays.slice(0, 3).map((h) => <WidgetRow key={h.date} label={h.name} value={<Badge tone="blue">{dayMonth(h.date).toUpperCase()}</Badge>} onClick={() => navigate("hr", "leave", "holidays")} />)
                  ) : (
                    <WidgetRow label="Add this year's holidays" chevron onClick={() => navigate("hr", "leave", "holidays")} />
                  )}
                </WidgetCard>
              </Grid>
              <Grid template="1.3fr 1fr">
                <ChartCard title="Headcount trend" delta={trendFirst && trendLast ? `▲ ${trendFirst.headcount} → ${trendLast.headcount} since ${trendFirst.label}` : undefined} deltaTone={trendLast && trendFirst && trendLast.headcount < trendFirst.headcount ? "down" : "up"}>
                  <BarChart ariaLabel="Headcount, last six months" renderHeight={100} data={o.trend.map((t) => ({ label: t.label, value: t.headcount }))} />
                </ChartCard>
                <ChartCard
                  title="By department"
                  center
                  legend={donut.segments.map((s) => ({ label: donut.total ? `${s.label} ${Math.round((s.value / donut.total) * 100)}%` : s.label, tone: s.tone }))}
                >
                  <DonutChart ariaLabel="Headcount by department" size={90} segments={donut.segments} centerValue={donut.total} centerLabel="PEOPLE" />
                </ChartCard>
              </Grid>
              {o.celebrations.length ? <Celebrations items={toCelebrations(o.celebrations)} /> : null}
            </Stack>
          </>
        );
      }}
    </Loaded>
  );
}
