"use client";

import { useState, type CSSProperties } from "react";
import {
  Alert,
  ApprovalRow,
  Badge,
  BlockLabel,
  Button,
  Card,
  DataTable,
  DetailsGrid,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  Pagination,
  PersonCell,
  ProfileHeader,
  SearchInput,
  Segmented,
  Select,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import {
  bos,
  type BankDetails,
  type BosDepartment,
  type BosEmployee,
  type EmployeeDetail as Detail,
  type EmployeeInput,
  type EmployeeStatus,
  type EmploymentType,
  type Personal,
  type PersonalField,
} from "@/lib/bos-app/api";
import { attendanceBadge, dateLabel, EMPLOYMENT_LABEL, employeeBadge, inr, leaveBadge, LEAVE_LABEL, todayLocal, dateRange } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ApplyLeaveDialog } from "../dialogs";

export const PERSONAL_LABELS: Record<PersonalField, string> = {
  fatherName: "Father's Name",
  mobile: "Mobile Number",
  personalEmail: "Personal Email ID",
  bloodGroup: "Blood Group",
  address: "Address",
  emergencyName: "Emergency Contact Name",
  emergencyRelation: "Emergency Contact Relation",
  emergencyPhone: "Emergency Contact Phone",
};
const PERSONAL_KEYS = Object.keys(PERSONAL_LABELS) as PersonalField[];
const BALANCE_TONE = { casual: "blue", sick: "emerald", earned: "faint", lop: "coral" } as const;

/* ---------- Form (create / edit) ---------- */

type FormValues = {
  firstName: string;
  lastName: string;
  workEmail: string;
  phone: string;
  designation: string;
  departmentId: string;
  managerId: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinDate: string;
  exitDate: string;
  location: string;
  dob: string;
  ctcAnnual: string;
  personal: Personal;
  bank: BankDetails;
};

function EmployeeForm({ employee, onDone }: { employee: BosEmployee | null; onDone: (id: string | null) => void }) {
  const { run, busy } = useBosAction();
  const lookups = useBosData(async () => {
    const [d, e] = await Promise.all([bos.departments(), bos.employees()]);
    return { departments: d.departments, employees: e.employees };
  });
  const [v, setV] = useState<FormValues>(() => ({
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    workEmail: employee?.workEmail ?? "",
    phone: employee?.phone ?? "",
    designation: employee?.designation ?? "",
    departmentId: employee?.departmentId ?? "",
    managerId: employee?.managerId ?? "",
    employmentType: employee?.employmentType ?? "full_time",
    status: employee?.status ?? "probation",
    joinDate: employee?.joinDate ?? todayLocal(),
    exitDate: employee?.exitDate ?? "",
    location: employee?.location ?? "",
    dob: employee?.dob ?? "",
    ctcAnnual: employee?.ctcAnnual ? String(employee.ctcAnnual) : "",
    personal: { ...(employee?.personal ?? {}) },
    bank: {},
  }));
  const set = <K extends keyof FormValues>(k: K) => (value: FormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const opt = (s: string) => (s.trim() ? s.trim() : null);

  const submit = async () => {
    const bank = Object.fromEntries(Object.entries(v.bank).filter(([, x]) => String(x ?? "").trim())) as BankDetails;
    const body: EmployeeInput = {
      firstName: v.firstName.trim(),
      lastName: opt(v.lastName),
      workEmail: opt(v.workEmail),
      phone: opt(v.phone),
      designation: opt(v.designation),
      departmentId: v.departmentId || null,
      managerId: v.managerId || null,
      employmentType: v.employmentType,
      status: v.status,
      joinDate: v.joinDate,
      exitDate: v.exitDate || null,
      location: opt(v.location),
      dob: v.dob || null,
      ctcAnnual: v.ctcAnnual ? Number(v.ctcAnnual) : null,
      personal: Object.fromEntries(Object.entries(v.personal).filter(([, x]) => String(x ?? "").trim())) as Personal,
      ...(Object.keys(bank).length ? { bank } : {}),
    };
    const out = await run("employee", () => (employee ? bos.updateEmployee(employee.id, body) : bos.createEmployee(body)), {
      success: employee ? "Employee updated" : "Employee onboarded",
      description: `${body.firstName} ${body.lastName ?? ""}`.trim(),
    });
    if (out) onDone(out.employee.id);
  };

  const text = (k: "firstName" | "lastName" | "workEmail" | "phone" | "designation" | "location", label: string, extra: { type?: string; required?: boolean } = {}) => (
    <Field label={label}>{({ id }) => <Input id={id} type={extra.type ?? "text"} required={extra.required} value={v[k]} onChange={(e) => set(k)(e.target.value)} />}</Field>
  );
  const departments: BosDepartment[] = lookups.data?.departments ?? [];
  const managers = (lookups.data?.employees ?? []).filter((e) => e.id !== employee?.id && e.status !== "exited");

  return (
    <>
      <button type="button" className="bos-back-link" onClick={() => onDone(employee?.id ?? null)}>
        ‹ {employee ? `Back to ${employee.name}` : "Back to Employees"}
      </button>
      <Card interactive={false} style={{ maxWidth: 900 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <BlockLabel>{employee ? `Edit ${employee.empCode}` : "New employee"}</BlockLabel>
          <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
            {text("firstName", "First name", { required: true })}
            {text("lastName", "Last name")}
            {text("designation", "Designation")}
            <Field label="Department">
              {({ id }) => (
                <Select id={id} value={v.departmentId} onChange={(e) => set("departmentId")(e.target.value)}>
                  <option value="">Unassigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Reporting manager">
              {({ id }) => (
                <Select id={id} value={v.managerId} onChange={(e) => set("managerId")(e.target.value)}>
                  <option value="">None</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.designation ?? m.empCode}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Employment type">
              {({ id }) => (
                <Select id={id} value={v.employmentType} onChange={(e) => set("employmentType")(e.target.value as EmploymentType)}>
                  {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYMENT_LABEL[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {({ id }) => (
                <Select id={id} value={v.status} onChange={(e) => set("status")(e.target.value as EmployeeStatus)}>
                  <option value="probation">Probation</option>
                  <option value="active">Active</option>
                  <option value="notice">Notice period</option>
                  <option value="exited">Exited</option>
                </Select>
              )}
            </Field>
            <Field label="Date of joining">{({ id }) => <Input id={id} type="date" required value={v.joinDate} onChange={(e) => set("joinDate")(e.target.value)} />}</Field>
            {v.status === "exited" || v.status === "notice" ? (
              <Field label="Last working day">{({ id }) => <Input id={id} type="date" min={v.joinDate} value={v.exitDate} onChange={(e) => set("exitDate")(e.target.value)} />}</Field>
            ) : null}
            {text("workEmail", "Work email", { type: "email" })}
            {text("phone", "Work phone", { type: "tel" })}
            {text("location", "Location")}
            <Field label="Date of birth">{({ id }) => <Input id={id} type="date" value={v.dob} max={todayLocal()} onChange={(e) => set("dob")(e.target.value)} />}</Field>
            <Field label="Annual CTC (₹)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={0} value={v.ctcAnnual} onChange={(e) => set("ctcAnnual")(e.target.value)} />}</Field>
          </FormGrid>

          <div style={{ marginTop: 22 }}>
            <BlockLabel>Personal &amp; emergency details</BlockLabel>
          </div>
          <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
            {PERSONAL_KEYS.map((k) => (
              <Field key={k} label={PERSONAL_LABELS[k]}>
                {({ id }) => <Input id={id} value={v.personal[k] ?? ""} onChange={(e) => setV((s) => ({ ...s, personal: { ...s.personal, [k]: e.target.value } }))} />}
              </Field>
            ))}
          </FormGrid>

          <div style={{ marginTop: 22 }}>
            <BlockLabel>🔒 Bank details {employee ? <span className="bos-text-faint">— leave blank to keep the current details</span> : null}</BlockLabel>
          </div>
          <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
            {(
              [
                ["name", "Bank name"],
                ["holder", "Account holder"],
                ["account", "Account number"],
                ["ifsc", "IFSC code"],
                ["branch", "Branch"],
              ] as Array<[keyof BankDetails, string]>
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                {({ id }) => (
                  <Input
                    id={id}
                    autoComplete="off"
                    value={v.bank[k] ?? ""}
                    placeholder={employee?.bank?.[k] || undefined}
                    onChange={(e) => setV((s) => ({ ...s, bank: { ...s.bank, [k]: k === "ifsc" ? e.target.value.toUpperCase() : e.target.value } }))}
                  />
                )}
              </Field>
            ))}
          </FormGrid>

          <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 20, gap: 8 }}>
            <Button size="sm" onClick={() => onDone(employee?.id ?? null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" icon="check" disabled={busy !== null}>
              {busy ? "Saving…" : employee ? "Save changes" : "Onboard employee"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

/* ---------- Detail ---------- */

type DetailTab = "ov" | "att" | "leave" | "pay" | "bank";

function PersonalCard({ detail, canManage }: { detail: Detail; canManage: boolean }) {
  const { run, busy } = useBosAction();
  const e = detail.employee;
  const [draft, setDraft] = useState<Personal | null>(null);
  const pending = detail.pendingChange;
  const canEdit = detail.isSelf || canManage;

  return (
    <Card interactive={false} style={{ maxWidth: 760 }}>
      <div className="bos-row-between" style={{ marginBottom: 10 }}>
        <div className="bos-kpi-label">
          Personal &amp; Emergency Details <span className="bos-text-faint">— self-editable, changes need HR approval</span>
        </div>
        {!draft && !pending && canEdit ? (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setDraft({ ...e.personal })}>
            Edit
          </Button>
        ) : null}
      </div>
      {draft ? (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            const ok = await run("profile", () => bos.requestProfileChange(e.id, draft), { success: "Submitted for HR approval", description: "Current values stay active until HR reviews." });
            if (ok) setDraft(null);
          }}
        >
          <FormGrid columns="repeat(auto-fit, minmax(160px, 1fr))">
            {PERSONAL_KEYS.map((k) => (
              <Field key={k} label={PERSONAL_LABELS[k]}>
                {({ id }) => <Input id={id} size="sm" value={draft[k] ?? ""} onChange={(ev) => setDraft({ ...draft, [k]: ev.target.value })} />}
              </Field>
            ))}
          </FormGrid>
          <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <Button size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={busy === "profile"}>
              Submit for approval
            </Button>
          </div>
        </form>
      ) : (
        <DetailsGrid items={PERSONAL_KEYS.map((k) => ({ label: PERSONAL_LABELS[k], value: e.personal[k] || "—" }))} />
      )}
      {pending ? (
        <div style={{ marginTop: 12 }}>
          <Alert
            tone="amber"
            title="⏳ Pending HR approval"
            actions={
              canManage ? (
                <>
                  <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => run("decide", () => bos.decideProfileChange(pending.id, "approved"), { success: "Changes approved", description: e.name })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => run("decide", () => bos.decideProfileChange(pending.id, "rejected"), { success: "Changes rejected", tone: "coral", description: e.name })}>
                    Reject
                  </Button>
                </>
              ) : undefined
            }
          >
            {(Object.keys(pending.changes) as PersonalField[]).map((k) => `${PERSONAL_LABELS[k]} → ${pending.changes[k] || "(cleared)"}`).join(" · ")} — old values stay active until HR reviews.
          </Alert>
        </div>
      ) : null}
    </Card>
  );
}

function BankCard({ employee }: { employee: BosEmployee }) {
  const [full, setFull] = useState<BankDetails | null>(null);
  const { run, busy } = useBosAction();
  const b = full ?? employee.bank;
  return (
    <Card interactive={false} style={{ maxWidth: 460 }}>
      <div className="bos-row-between" style={{ marginBottom: 10 }}>
        <div className="bos-kpi-label">Bank Details</div>
        <Badge tone="blue" auto>
          🔒 Visible to you, HR &amp; Payroll only
        </Badge>
      </div>
      <DetailsGrid
        cols={2}
        items={[
          { label: "Bank Name", value: b.name || "—" },
          { label: "Account Holder", value: b.holder || "—" },
          { label: "Account Number", value: b.account || "—" },
          { label: "IFSC Code", value: b.ifsc || "—" },
          { label: "Branch Name", value: b.branch || "—" },
        ]}
      />
      {employee.bank.account ? (
        <div style={{ marginTop: 10 }}>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={full !== null}
            disabled={busy !== null}
            onClick={async () => {
              if (full) return setFull(null);
              const out = await run("bank", () => bos.employeeBank(employee.id), { refresh: false });
              if (out) setFull(out.bank);
            }}
          >
            {full ? "Hide account number" : "Show account number"}
          </Button>
          <span className="bos-text-faint" style={{ fontSize: 11, marginLeft: 8 }}>
            Every reveal is written to the audit log.
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function EmployeeDetailView({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: (e: BosEmployee) => void }) {
  const { canManage } = useBosApp();
  const [tab, setTab] = useState<DetailTab>("ov");
  const [applying, setApplying] = useState(false);
  const state = useBosData(() => bos.employee(id), [id]);

  return (
    <Loaded state={state} rows={2}>
      {(d) => {
        const e = d.employee;
        const canSeeBank = canManage || d.isSelf;
        const tabs: Array<{ value: DetailTab; label: string; ariaLabel?: string }> = [
          { value: "ov", label: "Overview" },
          { value: "att", label: "Attendance" },
          { value: "leave", label: "Leave" },
          { value: "pay", label: "Payroll" },
          ...(canSeeBank ? [{ value: "bank" as const, label: "🔒 Bank Details", ariaLabel: "Bank Details (restricted)" }] : []),
        ];
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to Employees
              </button>
              <div className="bos-app-actions">
                {d.isSelf || canManage ? (
                  <Button size="sm" icon="calendar" onClick={() => setApplying(true)}>
                    Apply leave
                  </Button>
                ) : null}
                {canManage ? (
                  <Button size="sm" variant="primary" icon="edit" onClick={() => onEdit(e)}>
                    Edit record
                  </Button>
                ) : null}
              </div>
            </div>
            <ProfileHeader
              avatar={<PersonAvatar name={e.name} size="xl" />}
              name={e.name}
              status={<StatusBadge view={employeeBadge(e.status)} />}
              role={[e.designation, e.departmentName].filter(Boolean).join(" · ") || undefined}
              details={[
                { label: "Employee ID", value: e.empCode },
                { label: "Designation", value: e.designation ?? "—" },
                { label: "Department", value: e.departmentName ?? "—" },
                { label: "Employment Type", value: EMPLOYMENT_LABEL[e.employmentType] },
                { label: "Reporting Manager", value: e.managerName ?? "—" },
                { label: "Date of Joining", value: dateLabel(e.joinDate) },
                { label: "Mobile", value: e.phone ?? e.personal.mobile ?? "—" },
                { label: "Work Email", value: e.workEmail ?? "—" },
              ]}
            />
            <div className="bos-subtabs">
              <Segmented<DetailTab> aria-label="Employee record sections" scroll options={tabs} value={tab} onChange={setTab} />
            </div>

            {tab === "ov" ? (
              <div className="bos-stack" style={{ "--bos-gap": "16px" } as CSSProperties}>
                <Grid cols={4}>
                  <WidgetCard title="Leave Balance" dot="sage">
                    {d.balances.map((b) => (
                      <WidgetRow key={b.type} label={LEAVE_LABEL[b.type]} value={b.type === "lop" ? b.used : b.remaining} valueTone={BALANCE_TONE[b.type]} />
                    ))}
                  </WidgetCard>
                  <WidgetCard title="This Month" dot="mint">
                    <WidgetRow label="Present" value={d.attendance.present} valueTone="emerald" />
                    <WidgetRow label="Absent" value={d.attendance.absent} valueTone="coral" />
                    <WidgetRow label="On leave" value={d.attendance.leave} valueTone="amber" />
                    <WidgetRow label="Work from home" value={d.attendance.wfh} valueTone="blue" />
                  </WidgetCard>
                  <WidgetCard title="Employment" dot="lavender">
                    <WidgetRow label="Location" value={e.location ?? "—"} />
                    <WidgetRow label="Date of birth" value={dateLabel(e.dob)} />
                    <WidgetRow label="Annual CTC" value={e.ctcAnnual ? inr(e.ctcAnnual) : "—"} />
                    <WidgetRow label="Tenure since" value={dateLabel(e.joinDate)} valueTone="faint" />
                  </WidgetCard>
                  <WidgetCard title="Emergency Contact" dot="blue">
                    <WidgetRow label="Name" value={e.personal.emergencyName || "—"} />
                    <WidgetRow label="Relation" value={e.personal.emergencyRelation || "—"} />
                    <WidgetRow label="Phone" value={e.personal.emergencyPhone || "—"} />
                    <WidgetRow label="Blood Group" value={e.personal.bloodGroup || "—"} valueTone="coral" />
                  </WidgetCard>
                </Grid>
                <PersonalCard detail={d} canManage={canManage} />
              </div>
            ) : null}

            {tab === "att" ? (
              <div className="bos-stack" style={{ "--bos-gap": "16px" } as CSSProperties}>
                <Grid cols={4} min={130}>
                  <KpiCard label="Present" value={d.attendance.present} chip={{ color: "mint", glyph: "✓" }} delta="days this month" />
                  <KpiCard label="Absent" value={d.attendance.absent} chip={{ color: "rose", glyph: "✕" }} delta="days this month" deltaTone="down" />
                  <KpiCard label="On leave" value={d.attendance.leave} chip={{ color: "amber", glyph: "◐" }} delta="days this month" deltaTone="warn" />
                  <KpiCard label="WFH" value={d.attendance.wfh} chip={{ color: "blue", glyph: "⌂" }} delta="days this month" deltaTone="info" />
                </Grid>
                <DataTable
                  caption="Attendance this month"
                  rowKey={(r) => r.date}
                  rows={d.attendance.records}
                  empty="No attendance marked this month."
                  columns={[
                    { key: "date", header: "Date", mono: true, cell: (r) => dateLabel(r.date) },
                    { key: "in", header: "Check-in", mono: true, cell: (r) => r.checkIn?.slice(0, 5) ?? "—" },
                    { key: "out", header: "Check-out", mono: true, cell: (r) => r.checkOut?.slice(0, 5) ?? "—" },
                    { key: "status", header: "Status", cell: (r) => <StatusBadge view={attendanceBadge(r.status)} /> },
                  ]}
                />
              </div>
            ) : null}

            {tab === "leave" ? (
              <DataTable
                caption="Leave history"
                rowKey={(l) => l.id}
                rows={d.leaves}
                empty="No leave requests yet."
                columns={[
                  { key: "type", header: "Type", cell: (l) => LEAVE_LABEL[l.leaveType] },
                  { key: "dates", header: "Dates", mono: true, cell: (l) => dateRange(l.fromDate, l.toDate) },
                  { key: "days", header: "Days", align: "right", mono: true, cell: (l) => l.days },
                  { key: "reason", header: "Reason", cell: (l) => l.reason ?? "—" },
                  { key: "status", header: "Status", cell: (l) => <StatusBadge view={leaveBadge(l.status)} /> },
                ]}
              />
            ) : null}

            {tab === "pay" ? (
              <Stack gap={16}>
                <Alert tone="blue" title="Payroll is coming next">
                  Salary runs, payslips and statutory deductions arrive with the Payroll module. The CTC on this record will seed the salary structure.
                </Alert>
                <Grid cols={3} min={150}>
                  <KpiCard label="Annual CTC" value={e.ctcAnnual ? inr(e.ctcAnnual) : "—"} chip={{ color: "mint", glyph: "₹" }} delta="On record" deltaTone="muted" interactive={false} />
                  <KpiCard label="Monthly gross (est.)" value={e.ctcAnnual ? inr(Math.round(e.ctcAnnual / 12)) : "—"} chip={{ color: "blue", glyph: "◎" }} delta="CTC ÷ 12" deltaTone="muted" interactive={false} />
                  <KpiCard label="Loss of pay this year" value={`${d.balances.find((b) => b.type === "lop")?.used ?? 0} d`} chip={{ color: "rose", glyph: "−" }} delta="From approved LOP leave" deltaTone="muted" interactive={false} />
                </Grid>
              </Stack>
            ) : null}

            {tab === "bank" && canSeeBank ? <BankCard employee={e} /> : null}
            <ApplyLeaveDialog open={applying} onClose={() => setApplying(false)} employees={canManage ? [e] : []} employeeId={e.id} />
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- Directory ---------- */

function EmployeeList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const state = useBosData(async () => {
    const [list, changes] = await Promise.all([bos.employees(), canManage ? bos.profileChanges().catch(() => ({ changes: [] })) : Promise.resolve({ changes: [] })]);
    return { employees: list.employees, changes: changes.changes };
  }, [canManage]);

  return (
    <Loaded state={state}>
      {({ employees, changes }) => {
        const q = query.trim().toLowerCase();
        const depts = Array.from(new Set(employees.map((e) => e.departmentName ?? "Unassigned"))).sort();
        const rows = employees.filter((e) => (dept === "all" || (e.departmentName ?? "Unassigned") === dept) && (!q || `${e.name} ${e.empCode} ${e.designation ?? ""} ${e.departmentName ?? ""} ${e.phone ?? ""}`.toLowerCase().includes(q)));
        const columns: BosColumn<BosEmployee>[] = [
          { key: "name", header: "Employee", cell: (e) => <PersonCell avatar={<PersonAvatar name={e.name} />} name={e.name} role={e.designation ?? undefined} /> },
          { key: "empCode", header: "ID", mono: true, cell: (e) => e.empCode },
          { key: "dept", header: "Department", cell: (e) => e.departmentName ?? "—" },
          { key: "manager", header: "Manager", cell: (e) => e.managerName ?? "—" },
          { key: "status", header: "Status", cell: (e) => <StatusBadge view={employeeBadge(e.status)} /> },
          { key: "doj", header: "Joined", mono: true, cell: (e) => dateLabel(e.joinDate) },
        ];
        const bulkStatus = (status: EmployeeStatus, label: string) =>
          run("bulk", async () => {
            for (const empId of selected) await bos.updateEmployee(empId, { status });
            setSelected(new Set());
          }, { success: label, description: `${selected.size} employee(s) updated` });
        return (
          <Stack gap={16}>
            {canManage && changes.length ? (
              <WidgetCard title="⏳ Profile changes awaiting review" dot="rose" note={`${changes.length}`}>
                {changes.map((c) => (
                  <ApprovalRow
                    key={c.id}
                    avatar={<PersonAvatar name={c.employeeName} />}
                    name={c.employeeName}
                    meta={(Object.keys(c.changes) as PersonalField[]).map((k) => `${PERSONAL_LABELS[k]} → ${c.changes[k] || "(cleared)"}`).join(" · ")}
                    onDecide={(dec) => run(`pc-${c.id}`, () => bos.decideProfileChange(c.id, dec), { success: dec === "approved" ? "Changes approved" : "Changes rejected", tone: dec === "approved" ? "emerald" : "coral", description: c.employeeName })}
                  />
                ))}
              </WidgetCard>
            ) : null}
            <div>
              <ModuleToolbar>
                <SearchInput placeholder="Search employees…" aria-label="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} />
                <span className="bos-spacer" />
                {canManage ? (
                  <Button size="sm" variant="primary" icon="plus" onClick={onNew}>
                    New employee
                  </Button>
                ) : null}
              </ModuleToolbar>
              {depts.length > 1 ? (
                <div className="bos-subtabs">
                  <Segmented role="radio" size="sm" scroll aria-label="Department filter" options={[{ value: "all", label: "All" }, ...depts.map((d) => ({ value: d, label: d }))]} value={dept} onChange={setDept} />
                </div>
              ) : (
                <div style={{ height: 16 }} />
              )}
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(e) => e.id}
                onRowClick={(e) => onOpen(e.id)}
                chevron
                selection={canManage ? { selected, onChange: setSelected } : undefined}
                bulkActions={() => (
                  <>
                    <Button size="sm" disabled={busy !== null} onClick={() => bulkStatus("active", "Confirmed as active")}>
                      Confirm active
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => bulkStatus("exited", "Marked as exited")}>
                      Mark exited
                    </Button>
                  </>
                )}
                empty={employees.length ? "No employees match your search or filter." : canManage ? "No employees yet — onboard your first team member." : "No employee records yet."}
                caption="Employee directory"
              />
              <Pagination>
                Showing {rows.length} of {employees.length}
              </Pagination>
            </div>
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Controller ---------- */

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "form"; employee: BosEmployee | null };

export function Employees() {
  const { takeIntent } = useBosApp();
  const [view, setView] = useState<View>(() => {
    const intent = takeIntent("employees");
    if (intent === "new") return { kind: "form", employee: null };
    if (intent?.startsWith("open:")) return { kind: "detail", id: intent.slice(5) };
    return { kind: "list" };
  });
  if (view.kind === "form") return <EmployeeForm employee={view.employee} onDone={(id) => setView(id ? { kind: "detail", id } : { kind: "list" })} />;
  if (view.kind === "detail") return <EmployeeDetailView id={view.id} onBack={() => setView({ kind: "list" })} onEdit={(employee) => setView({ kind: "form", employee })} />;
  return <EmployeeList onOpen={(id) => setView({ kind: "detail", id })} onNew={() => setView({ kind: "form", employee: null })} />;
}
