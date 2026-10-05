"use client";

import { useState } from "react";
import {
  ActionTicker,
  Alert,
  AppShell,
  Avatar,
  BosIcon,
  Breadcrumbs,
  Button,
  Celebrations,
  FilterChip,
  Grid,
  IconButton,
  KpiCard,
  NavBrand,
  ProfileHeader,
  TimePill,
  WidgetCard,
  WidgetRow,
  type BosIconName,
  type BosTickerItem,
} from "@/components/bos";
import { bos, type BosEvent } from "@/lib/bos-app/api";
import { dateLabel, dayMonth, EMPLOYMENT_LABEL, greetingFor, inr, inrCompact, LEAVE_LABEL, monthLabel, timeAgo, todayLocal } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, useBosApp, useBosData, useWorkspaceModule, type WorkspaceKey } from "../core";
import { ApplyLeaveDialog, ExpenseDialog } from "../dialogs";
import { toCelebrations } from "../hr/HrOverview";

type HomeKey = "myprofile" | "dashboard";

const NAV: ReadonlyArray<{ key: HomeKey | WorkspaceKey; label: string; icon: BosIconName; section?: string }> = [
  { key: "myprofile", label: "My Profile", icon: "user" },
  { key: "dashboard", label: "Dashboard", icon: "grid" },
  { key: "finance", label: "Finance & Accounts", icon: "wallet", section: "Workspace" },
  { key: "hr", label: "HR Management", icon: "users", section: "Workspace" },
  { key: "projects", label: "Projects", icon: "layers", section: "Workspace" },
  { key: "connect", label: "Connected Tools", icon: "refresh", section: "Workspace" },
  { key: "settings", label: "Settings & Audit", icon: "settings", section: "Workspace" },
];

const TICKER_STYLE: Record<string, { icon: BosIconName; tint: string }> = {
  invoice: { icon: "receipt", tint: "blue" },
  payment: { icon: "wallet", tint: "emerald" },
  bill: { icon: "file", tint: "amber" },
  expense: { icon: "receipt", tint: "coral" },
  party: { icon: "users", tint: "lavender" },
  leave: { icon: "calendar", tint: "pastel-blue" },
  employee: { icon: "user", tint: "lavender" },
  attendance: { icon: "clock", tint: "emerald" },
  project: { icon: "layers", tint: "blue" },
  payroll_run: { icon: "wallet", tint: "emerald" },
  bank_account: { icon: "wallet", tint: "blue" },
  bank_txn: { icon: "refresh", tint: "blue" },
  budget: { icon: "trend", tint: "emerald" },
  asset: { icon: "box", tint: "lavender" },
  journal: { icon: "file", tint: "blue" },
  account: { icon: "layers", tint: "lavender" },
  accounting: { icon: "layers", tint: "lavender" },
  opening: { icon: "users", tint: "blue" },
  candidate: { icon: "user", tint: "emerald" },
  training: { icon: "check", tint: "emerald" },
  certificate: { icon: "check", tint: "blue" },
  kra: { icon: "layers", tint: "blue" },
  promotion: { icon: "user", tint: "lavender" },
  recognition: { icon: "user", tint: "amber" },
  travel: { icon: "calendar", tint: "blue" },
  service: { icon: "user", tint: "rose" },
  policy: { icon: "file", tint: "lavender" },
  compliance: { icon: "calendar", tint: "amber" },
  agreement: { icon: "file", tint: "blue" },
  sales: { icon: "receipt", tint: "mint" },
  sales_item: { icon: "box", tint: "mint" },
  task: { icon: "check", tint: "blue" },
  milestone: { icon: "layers", tint: "emerald" },
};

export const tickerOf = (events: ReadonlyArray<BosEvent>): BosTickerItem[] =>
  events.map((e) => ({ text: e.summary, time: timeAgo(e.createdAt), ...(TICKER_STYLE[e.entityType] ?? { icon: "refresh" as const, tint: "emerald" }) }));

/* ---------- My Profile ---------- */

function MyProfile() {
  const { session, navigate, canManage } = useBosApp();
  const [dialog, setDialog] = useState<"leave" | "expense" | null>(null);
  const state = useBosData(async () => {
    const [me, projects, events, hr, expenses, payslips, policies, tasks] = await Promise.all([
      bos.me(),
      bos.projects().catch(() => ({ projects: [] })),
      bos.events({ limit: 8 }).catch(() => ({ events: [] })),
      bos.hrOverview().catch(() => null),
      bos.expenses().catch(() => ({ expenses: [], categories: [] as string[] })),
      bos.myPayslips().catch(() => ({ employeeId: null, payslips: [] })),
      bos.pendingPolicies().catch(() => ({ policies: [] })),
      bos.taskSummary().catch(() => null),
    ]);
    return {
      me,
      projects: projects.projects,
      events: events.events,
      hr,
      expenses: expenses.expenses,
      categories: expenses.categories,
      payslips: payslips.payslips,
      pendingPolicies: policies.policies,
      tasks,
    };
  });

  return (
    <Loaded state={state} rows={2}>
      {({ me, projects, events, hr, expenses, categories, payslips, pendingPolicies, tasks }) => {
        const emp = me.employee;
        const month = new Date().toLocaleDateString("en-GB", { month: "short" });
        const stage = (s: string) => projects.filter((p) => p.status === s).length;
        const myExpenses = emp ? expenses.filter((x) => x.employeeId === emp.id) : [];
        const myPendingLeave = emp ? me.leaves.filter((l) => l.status === "pending").length : 0;
        const hasTasks = Boolean(tasks && (tasks.totals.open || tasks.totals.doneRecent));
        const balance = (t: "casual" | "sick") => (emp ? (me.balances.find((b) => b.type === t)?.remaining ?? 0) : 0);
        const quick: Array<{ label: string; onClick: () => void; show?: boolean }> = [
          { label: "Apply Leave", onClick: () => setDialog("leave"), show: Boolean(emp) || canManage },
          { label: "Claim Expense", onClick: () => setDialog("expense") },
          { label: "Holiday Calendar", onClick: () => navigate("hr", "leave", "holidays") },
          { label: "Attendance History", onClick: () => (emp ? navigate("hr", "employees", `open:${emp.id}`) : navigate("hr", "leave", "biometric")), show: Boolean(emp) || canManage },
          { label: "My Tasks", onClick: () => navigate("projects", "tasks", "mine") },
          { label: "Create Invoice", onClick: () => navigate("finance", "invoices", "new") },
          { label: "Sync from Tools", onClick: () => navigate("connect") },
        ];
        return (
          <>
            <ProfileHeader
              avatar={
                emp ? (
                  <PersonAvatar name={emp.name} size="xl" />
                ) : (
                  <Avatar size="xl" tone="var(--bos-blue)">
                    <BosIcon name="user" width={26} height={26} />
                  </Avatar>
                )
              }
              name={emp?.name ?? session.actor.name ?? session.actor.email ?? "Welcome"}
              role={emp ? [emp.designation, emp.departmentName].filter(Boolean).join(" · ") || undefined : `${session.actor.role.toUpperCase()} · ${session.settings.companyName}`}
              corner={
                <>
                  <TimePill />
                  <IconButton icon="bell" dot={events.length > 0} aria-label="Recent activity" onClick={() => navigate("settings", "audit")} />
                </>
              }
              details={
                emp
                  ? [
                      { label: "Employee ID", value: emp.empCode },
                      { label: "Department", value: emp.departmentName ?? "—" },
                      { label: "Designation", value: emp.designation ?? "—" },
                      { label: "Work Email", value: emp.workEmail ?? session.actor.email ?? "—" },
                      { label: "Mobile", value: emp.phone ?? emp.personal.mobile ?? "—" },
                      { label: "Reporting Manager", value: emp.managerName ?? "—" },
                      { label: "Date of Joining", value: dateLabel(emp.joinDate) },
                      { label: "Employment Type", value: EMPLOYMENT_LABEL[emp.employmentType] },
                    ]
                  : [
                      { label: "Signed in as", value: session.actor.email ?? "—" },
                      { label: "Role", value: session.actor.canManage ? "Owner / Admin" : "Team member" },
                      { label: "Company", value: session.settings.companyName },
                      { label: "GSTIN", value: session.settings.gstin ?? "—" },
                    ]
              }
            />
            {!emp ? (
              <div style={{ marginBottom: 16 }}>
                <Alert tone="blue" title="Link your employee record">
                  {canManage
                    ? `Add yourself in HR Management → Employees with the work email ${session.actor.email ?? "you sign in with"} to unlock leave, attendance and self-service.`
                    : "Ask HR to add you as an employee with your sign-in email to unlock leave, attendance and self-service."}
                </Alert>
              </div>
            ) : null}
            {pendingPolicies.length ? (
              <div style={{ marginBottom: 16 }}>
                <Alert tone="amber" title={pendingPolicies.length === 1 ? `Please read and acknowledge the ${pendingPolicies[0].title}` : `${pendingPolicies.length} policies to read and acknowledge`}>
                  {pendingPolicies.some((p) => p.mandatory) ? "Acknowledging is mandatory. " : ""}
                  {pendingPolicies.some((p) => p.updated) ? "Some were updated since you last acknowledged them. " : ""}
                  <Button size="sm" variant="ghost" onClick={() => navigate("hr", "policies", pendingPolicies.length === 1 ? `open:${pendingPolicies[0].id}` : undefined)}>
                    Review {pendingPolicies.length === 1 ? "policy" : "policies"} →
                  </Button>
                </Alert>
              </div>
            ) : null}
            <Grid cols={4} gap={12} style={{ marginBottom: 20 }}>
              <WidgetCard title="My Requests" dot="sage">
                <WidgetRow label="Leave awaiting approval" value={myPendingLeave} valueTone={myPendingLeave ? "amber" : "faint"} onClick={() => navigate("hr", "leave")} />
                <WidgetRow label="Expense claims pending" value={myExpenses.filter((x) => x.status === "submitted").length} valueTone="amber" onClick={() => navigate("finance", "expenses")} />
                <WidgetRow label="Approved, to reimburse" value={inr(myExpenses.filter((x) => x.status === "approved").reduce((s, x) => s + x.amount, 0))} valueTone="blue" />
                {canManage && hr ? <WidgetRow label="Team approvals waiting" value={hr.pending.leave + hr.pending.expenses + hr.pending.profileChanges} valueTone="coral" onClick={() => navigate("hr", "overview")} /> : null}
              </WidgetCard>
              <WidgetCard title="Projects" dot="mint">
                <WidgetRow label="Active Projects" value={stage("active")} valueTone="emerald" onClick={() => navigate("projects")} />
                <WidgetRow label="Completed Projects" value={stage("completed")} valueTone="blue" />
                <WidgetRow label="Upcoming (planned)" value={stage("planned")} valueTone="faint" />
                <WidgetRow label="Leads" value={stage("lead")} valueTone="amber" />
                <WidgetRow label="On Hold" value={stage("on_hold")} valueTone="coral" />
              </WidgetCard>
              <WidgetCard title="Shortcuts" dot="lavender">
                <WidgetRow label="Create GST invoice" chevron onClick={() => navigate("finance", "invoices", "new")} />
                <WidgetRow label="Receivables & collections" chevron onClick={() => navigate("finance", "receivables")} />
                <WidgetRow label="GST summary" chevron onClick={() => navigate("finance", "gsttax")} />
                <WidgetRow label="Quotations & surveys" chevron onClick={() => navigate("connect")} />
              </WidgetCard>
              <WidgetCard title="Leave & Attendance" dot="blue">
                <WidgetRow label={LEAVE_LABEL.casual} value={emp ? balance("casual") : "—"} valueTone="blue" />
                <WidgetRow label={LEAVE_LABEL.sick} value={emp ? balance("sick") : "—"} valueTone="emerald" />
                <WidgetRow label={`Present (${month})`} value={emp ? me.attendance.present : "—"} valueTone="emerald" />
                <WidgetRow label={`Absent (${month})`} value={emp ? me.attendance.absent : "—"} valueTone="coral" />
              </WidgetCard>
            </Grid>
            <div className="bos-row" style={{ gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              {quick
                .filter((q) => q.show !== false)
                .map((q) => (
                  <FilterChip key={q.label} onClick={q.onClick}>
                    {q.label}
                  </FilterChip>
                ))}
            </div>
            {payslips.length || hasTasks ? (
              <Grid cols={2} gap={12} style={{ marginBottom: 20 }}>
                {tasks && hasTasks ? (
                  <WidgetCard title="✅ My Tasks" dot="blue">
                    <WidgetRow label="Overdue" value={tasks.totals.overdue} valueTone={tasks.totals.overdue ? "coral" : "faint"} onClick={() => navigate("projects", "tasks", "mine")} />
                    <WidgetRow label="Due today" value={tasks.totals.dueToday} valueTone={tasks.totals.dueToday ? "amber" : "faint"} />
                    <WidgetRow label="In progress" value={tasks.totals.inProgress} valueTone="blue" />
                    <WidgetRow label="To do" value={tasks.totals.todo} valueTone="faint" />
                    {tasks.upcoming.slice(0, 3).map((t) => (
                      <WidgetRow
                        key={t.id}
                        label={t.title}
                        value={t.dueOn ? (t.state === "due_today" ? "Today" : dayMonth(t.dueOn)) : "—"}
                        valueTone={t.state === "overdue" ? "coral" : "faint"}
                        chevron
                        onClick={() => navigate("projects", "tasks", `open:${t.id}`)}
                      />
                    ))}
                  </WidgetCard>
                ) : null}
                {payslips.length ? (
                  <WidgetCard title="💰 My Payslips" dot="mint">
                    {payslips.slice(0, 4).map((p) => (
                      <WidgetRow key={p.id} label={p.period ? monthLabel(p.period) : "Payslip"} value={inr(p.netPay)} valueTone="emerald" chevron onClick={() => navigate("finance", "payroll", `payslip:${p.id}`)} />
                    ))}
                  </WidgetCard>
                ) : null}
              </Grid>
            ) : null}
            {events.length ? <ActionTicker items={tickerOf(events)} /> : null}
            {hr?.celebrations.length ? <Celebrations items={toCelebrations(hr.celebrations)} /> : null}
            <ApplyLeaveDialog open={dialog === "leave"} onClose={() => setDialog(null)} employeeId={emp?.id} />
            <ExpenseDialog open={dialog === "expense"} onClose={() => setDialog(null)} categories={categories.length ? categories : ["Travel", "Food", "Other"]} />
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- Dashboard ---------- */

function HomeDashboard({ goHome }: { goHome: () => void }) {
  const { session, navigate, canManage } = useBosApp();
  const state = useBosData(async () => {
    const [fin, hr] = await Promise.all([bos.financeOverview().catch(() => null), bos.hrOverview().catch(() => null)]);
    return { fin, hr };
  });
  const first = (session.actor.name ?? "").split(/\s+/)[0] || "there";

  return (
    <>
      <Breadcrumbs items={[{ label: "Justx BOS", onClick: goHome }, { label: "Dashboard" }]} />
      <div className="bos-greeting">
        {greetingFor()}, {first} 👋
      </div>
      <div className="bos-greeting-sub">Here&apos;s what&apos;s waiting for you today · {dateLabel(todayLocal())}</div>
      <Loaded state={state} rows={1}>
        {({ fin, hr }) => {
          const approvals = (fin ? fin.kpis.billsPending + fin.kpis.expensesPending : 0) + (hr ? hr.pending.leave + hr.pending.profileChanges : 0);
          return (
            <>
              <Grid cols={4} min={140} style={{ marginBottom: 16 }}>
                <KpiCard label="Revenue (MTD)" value={fin ? inrCompact(fin.kpis.revenueMtd) : "—"} chip={{ color: "mint", glyph: "₹" }} delta={fin ? `Collected ${inrCompact(fin.kpis.collectedMtd)}` : undefined} />
                <KpiCard
                  label="To collect"
                  value={fin ? inrCompact(fin.kpis.receivable) : "—"}
                  chip={{ color: "rose", glyph: "◐" }}
                  delta={fin && fin.kpis.overdue ? `${inrCompact(fin.kpis.overdue)} overdue` : "Nothing overdue"}
                  deltaTone={fin && fin.kpis.overdue ? "down" : "up"}
                />
                <KpiCard label="Pending approvals" value={approvals} chip={{ color: "blue", glyph: "◎" }} delta={canManage ? "Awaiting your review" : "Across the team"} deltaTone={approvals ? "warn" : "muted"} />
                <KpiCard label="Present today" value={hr ? hr.kpis.present : "—"} chip={{ color: "lavender", glyph: "✓" }} delta={hr ? `${hr.kpis.onLeave} on leave · ${hr.kpis.headcount} people` : undefined} deltaTone="muted" />
              </Grid>
              <Grid cols={2}>
                <WidgetCard title="🧾 Overdue invoices" dot="rose">
                  {fin?.overdueInvoices.length ? (
                    fin.overdueInvoices.slice(0, 4).map((i) => <WidgetRow key={i.id} label={`${i.partyName} · ${i.daysOverdue}d`} value={inr(i.balance)} valueTone="coral" onClick={() => navigate("finance", "invoices", `open:${i.id}`)} />)
                  ) : (
                    <WidgetRow label="All invoices on time" value="✓" valueTone="emerald" />
                  )}
                </WidgetCard>
                <WidgetCard title="🗓️ Leave today & ahead" dot="blue">
                  {hr?.pendingLeave.length ? (
                    hr.pendingLeave.slice(0, 4).map((l) => <WidgetRow key={l.id} label={`${l.employeeName} · ${LEAVE_LABEL[l.leaveType]}`} value={dateLabel(l.fromDate)} valueTone="amber" onClick={() => navigate("hr", "leave")} />)
                  ) : (
                    <WidgetRow label="No leave requests waiting" value="✓" valueTone="emerald" />
                  )}
                </WidgetCard>
              </Grid>
            </>
          );
        }}
      </Loaded>
    </>
  );
}

export function HomeWorkspace() {
  const { navigate, session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("home", "myprofile");
  const active: HomeKey = nav.active === "dashboard" ? "dashboard" : "myprofile";
  return (
    <AppShell
      aria-label="Workspace navigation"
      brand={<NavBrand name={session.brand?.name || session.settings.companyName || "Justx BOS"} logoSrc={logoSrc} />}
      onSearch={openPalette}
      footer={<TimePill />}
      items={NAV.map((n) => ({ key: n.key, label: n.label, section: n.section, icon: <BosIcon name={n.icon} /> }))}
      active={active}
      onSelect={(key) => (key === "myprofile" || key === "dashboard" ? nav.onSelect(key) : navigate(key as WorkspaceKey))}
    >
      <div key={`${active}:${nav.navSeq}`} className="bos-fade-in">
        {active === "myprofile" ? <MyProfile /> : <HomeDashboard goHome={() => nav.onSelect("myprofile")} />}
      </div>
    </AppShell>
  );
}
