"use client";

import { useState, type CSSProperties } from "react";
import {
  AiPill,
  Alert,
  Avatar,
  Badge,
  BarChart,
  Button,
  Card,
  Celebrations,
  ChartCard,
  DataTable,
  DetailsGrid,
  Dialog,
  DonutChart,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  OrgChart,
  Pagination,
  PersonCell,
  ProfileHeader,
  SearchInput,
  Segmented,
  WidgetCard,
  WidgetRow,
  useToast,
  type BosColumn,
  type BosOrgNode,
} from "@/components/bos";
import { ModuleWorkspace, type ModuleWorkspaceApi } from "../modules/ModuleWorkspace";
import { EMPLOYEES, EMPLOYEE_ATTENDANCE, EMPLOYEE_BY_KEY, EMPLOYEE_DEPT_FILTERS, PAYROLL_MONTHS, type EmployeeRecord } from "../data/employees";
import { HR_CELEBRATIONS, HR_DEPT_DATA, HR_DEPT_FILTERS, HR_MODULES, HR_POLICIES, type PolicyRow } from "../data/hrm";

const TOTAL_HEADCOUNT = 214;

const toCelebration = (c: (typeof HR_CELEBRATIONS)[number]) => ({
  initials: c.initials,
  name: c.name,
  tag: c.tag,
  tint: c.tint,
  avatar: { fill: `var(--bos-pastel-${c.pastel})`, ink: `var(--bos-pastel-${c.pastel}-ink)` },
});

/* ---------- HR Dashboard ---------- */

function HrOverview({ api }: { api: ModuleWorkspaceApi }) {
  const [dept, setDept] = useState("all");
  const d = HR_DEPT_DATA[dept] ?? HR_DEPT_DATA.all;
  return (
    <>
      <ModuleToolbar>
        <SearchInput placeholder="Search dashboard…" aria-label="Search dashboard" />
        <AiPill
          action={
            <Button size="sm" variant="ghost" onClick={() => api.notify("Ask AI", "3 Field Ops employees haven't taken leave in 90+ days.")}>
              Ask AI
            </Button>
          }
        >
          Attrition risk in Field Ops — 3 employees, 90+ days no leave
        </AiPill>
      </ModuleToolbar>
      <div className="bos-subtabs">
        <Segmented role="radio" size="sm" scroll aria-label="Department filter" options={HR_DEPT_FILTERS} value={dept} onChange={setDept} />
      </div>
      <div className="bos-stack" style={{ "--bos-gap": "20px" } as CSSProperties}>
        <Grid cols={4} min={140}>
          <KpiCard label="Total headcount" value={d.headcount} chip={{ color: "blue", glyph: "◎" }} delta={d.headcountDelta} />
          <KpiCard label="Present today" value={d.present} chip={{ color: "mint", glyph: "✓" }} delta={d.attendance} />
          <KpiCard label="On leave today" value={d.leave} chip={{ color: "rose", glyph: "◐" }} delta={d.leaveDelta} deltaTone="warn" />
          <KpiCard label="Open positions" value={d.openpos} chip={{ color: "lavender", glyph: "◈" }} delta={d.openposDelta} deltaTone="muted" />
        </Grid>
        <Grid cols={3}>
          <WidgetCard title="🔔 Notifications" dot="blue" note={d.label || undefined}>
            {d.notif.map((n, i) => (
              <WidgetRow key={n} label={n} value={["2h ago", "1d ago", "2d ago"][i]} valueTone="faint" soft />
            ))}
          </WidgetCard>
          <WidgetCard title="⏳ Pending Approvals" dot="rose">
            <WidgetRow label="Leave requests" value={d.apprLeave} valueTone="amber" onClick={() => api.navigate("leave")} />
            <WidgetRow label="Expense reimbursements" value={d.apprExp} valueTone="amber" onClick={() => api.navigate("expenses")} />
            <WidgetRow label="Profile change requests" value={d.apprProfile} valueTone="amber" onClick={() => api.navigate("employees")} />
          </WidgetCard>
          <WidgetCard title="📄 Pending Reports" dot="mint">
            {d.reports.map(([label, badge]) => (
              <WidgetRow key={label} label={label} value={<Badge tone={badge.tone}>{badge.text}</Badge>} onClick={() => api.navigate("reports")} />
            ))}
          </WidgetCard>
        </Grid>
        <Grid template="1.3fr 1fr">
          <ChartCard title="Headcount trend" delta="▲ 190 → 214 since Feb">
            <BarChart
              ariaLabel="Headcount, February to July"
              renderHeight={100}
              data={[
                { label: "Feb", value: 30 },
                { label: "Mar", value: 47 },
                { label: "Apr", value: 57 },
                { label: "May", value: 70 },
                { label: "Jun", value: 90 },
                { label: "Jul", value: 110 },
              ]}
            />
          </ChartCard>
          <ChartCard
            title="By department"
            center
            legend={[
              { label: "Field Ops 42%", tone: "emerald" },
              { label: "Sales 24%", tone: "coral" },
              { label: "Eng. 20%", tone: "blue" },
              { label: "Other 14%", tone: "amber" },
            ]}
          >
            <DonutChart
              ariaLabel="Headcount by department"
              size={90}
              segments={[
                { label: "Field Ops", value: 42, tone: "emerald" },
                { label: "Sales", value: 24, tone: "coral" },
                { label: "Engineering", value: 20, tone: "blue" },
                { label: "Other", value: 14, tone: "amber" },
              ]}
            />
          </ChartCard>
        </Grid>
        <Celebrations items={HR_CELEBRATIONS.map(toCelebration)} />
      </div>
    </>
  );
}

/* ---------- Employee directory ---------- */

function EmployeeList({ onOpen, api }: { onOpen: (key: string) => void; api: ModuleWorkspaceApi }) {
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const rows = EMPLOYEES.filter(
    (e) => (dept === "all" || e.dept === dept) && (!q || `${e.name} ${e.role} ${e.dept}`.toLowerCase().includes(q)),
  );

  const columns: BosColumn<EmployeeRecord>[] = [
    { key: "name", header: "Employee", cell: (e) => <PersonCell avatar={<Avatar size="sm" tone={e.tone}>{e.initials}</Avatar>} name={e.name} role={e.role} /> },
    { key: "dept", header: "Department" },
    { key: "role", header: "Designation" },
    { key: "status", header: "Status", cell: (e) => <Badge tone={e.statusTone}>{e.status}</Badge> },
    { key: "doj", header: "Joined", mono: true },
  ];

  const bulk = (label: string) => api.notify(label, `${selected.size} employee(s) — sample action, nothing was changed.`);

  return (
    <>
      <ModuleToolbar>
        <SearchInput placeholder="Search employees…" aria-label="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="bos-spacer" />
        <Button size="sm" variant="primary" icon="plus" onClick={() => api.notify("New employee", "Opens the onboarding form in a live tenant.")}>
          New employee
        </Button>
      </ModuleToolbar>
      <div className="bos-subtabs">
        <Segmented role="radio" size="sm" scroll aria-label="Department filter" options={EMPLOYEE_DEPT_FILTERS} value={dept} onChange={setDept} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(e) => e.key}
        onRowClick={(e) => onOpen(e.key)}
        chevron
        selection={{ selected, onChange: setSelected }}
        bulkActions={() => (
          <>
            <Button size="sm" onClick={() => bulk("Export")}>Export</Button>
            <Button size="sm" onClick={() => bulk("Assign to team")}>Assign to team</Button>
            <Button size="sm" variant="destructive" onClick={() => bulk("Deactivate")}>Deactivate</Button>
          </>
        )}
        empty="No employees match your search or filter."
        caption="Employee directory"
      />
      <Pagination actions={<span className="bos-text-faint">‹ Prev &nbsp; Next ›</span>}>
        Showing {rows.length} of {TOTAL_HEADCOUNT}
      </Pagination>
    </>
  );
}

/* ---------- Employee detail ---------- */

type PersonalFields = {
  father: string;
  mobile: string;
  email: string;
  blood: string;
  address: string;
  ecName: string;
  ecRelation: string;
  ecPhone: string;
};

const PERSONAL_LABELS: Record<keyof PersonalFields, string> = {
  father: "Father's Name",
  mobile: "Mobile Number",
  email: "Personal Email ID",
  blood: "Blood Group",
  address: "Address",
  ecName: "Emergency Contact Name",
  ecRelation: "Emergency Contact Relation",
  ecPhone: "Emergency Contact Phone",
};

const personalFrom = (e: EmployeeRecord): PersonalFields => ({
  father: e.fatherName,
  mobile: e.mobile,
  email: e.personalEmail,
  blood: e.bloodGroup,
  address: e.address,
  ecName: e.emergencyName,
  ecRelation: e.emergencyRelation,
  ecPhone: e.mobile,
});

type DetailTab = "ov" | "att" | "pay" | "bank";

function EmployeeDetail({ employee: e, onBack, api }: { employee: EmployeeRecord; onBack: () => void; api: ModuleWorkspaceApi }) {
  const { show } = useToast();
  const [tab, setTab] = useState<DetailTab>("ov");
  const [certsOpen, setCertsOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [personal, setPersonal] = useState<PersonalFields>(() => personalFrom(e));
  const [draft, setDraft] = useState<PersonalFields | null>(null);
  const [pending, setPending] = useState<PersonalFields | null>(null);

  const pendingDesc = (() => {
    if (!pending) return "";
    const changed = (Object.keys(PERSONAL_LABELS) as Array<keyof PersonalFields>).filter((k) => pending[k] !== personal[k]);
    return changed.length
      ? `${changed.map((k) => PERSONAL_LABELS[k]).join(", ")} updated by employee — old values stay active until HR reviews.`
      : "Submitted — old values stay active until HR reviews.";
  })();

  const resolve = (approve: boolean) => {
    if (approve && pending) setPersonal(pending);
    setPending(null);
    show({ tone: approve ? "emerald" : "coral", title: approve ? "Changes approved" : "Changes rejected", description: e.name });
  };

  return (
    <>
      <button type="button" className="bos-back-link" onClick={onBack}>
        ‹ Back to Employees
      </button>
      <ProfileHeader
        avatar={
          <Avatar size="xl" tone={e.tone}>
            {e.initials}
          </Avatar>
        }
        name={e.name}
        status={<Badge tone={e.statusTone}>{e.status}</Badge>}
        role={`${e.role} · ${e.dept}`}
        details={[
          { label: "Employee ID", value: e.empId },
          { label: "Designation", value: e.role },
          { label: "Department", value: e.dept },
          { label: "Employment Type", value: e.type },
          { label: "Reporting Manager", value: e.manager },
          { label: "Date of Joining", value: e.doj },
          { label: "Mobile", value: personal.mobile },
          { label: "Work Email", value: e.email },
        ]}
      />
      <div className="bos-subtabs">
        <Segmented<DetailTab>
          aria-label="Employee record sections"
          options={[
            { value: "ov", label: "Overview" },
            { value: "att", label: "Attendance" },
            { value: "pay", label: "Payroll" },
            { value: "bank", label: "🔒 Bank Details", ariaLabel: "Bank Details (restricted)" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "ov" ? (
        <div className="bos-stack" style={{ "--bos-gap": "16px" } as CSSProperties}>
          <Grid cols={4}>
            <WidgetCard title="Leave Balance" dot="sage">
              <WidgetRow label="Casual Leave" value={e.cl} valueTone="blue" />
              <WidgetRow label="Sick Leave" value={e.sl} valueTone="emerald" />
              <WidgetRow label="Earned Leave" value={e.el} valueTone="faint" />
              <WidgetRow label="Loss of Pay (LOP)" value={e.lop} valueTone="coral" />
            </WidgetCard>
            <WidgetCard title="This Month" dot="mint">
              <WidgetRow label="Present" value={e.present} valueTone="emerald" />
              <WidgetRow label="Absent" value={e.absent} valueTone="coral" />
              <WidgetRow label="Late" value={e.late} valueTone="amber" />
              <WidgetRow
                label={
                  <>
                    Punchout Requests <span className="bos-text-faint">(field visit)</span>
                  </>
                }
                value={e.punchout}
                valueTone="blue"
              />
            </WidgetCard>
            <WidgetCard title="Documents" dot="lavender">
              {e.documents.map((doc) => (
                <WidgetRow key={doc} label={doc} chevron onClick={() => api.notify(doc, "Document preview opens in a live tenant.")} />
              ))}
              <button type="button" className="bos-widget-row bos-widget-link" aria-expanded={certsOpen} onClick={() => setCertsOpen((o) => !o)}>
                <span>
                  Certificates <span className="bos-text-faint">({e.certificates.length})</span>
                </span>
                <span className="bos-widget-chev" aria-hidden="true">
                  {certsOpen ? "⌄" : "›"}
                </span>
              </button>
              {certsOpen ? (
                <div style={{ paddingLeft: 10 }}>
                  {e.certificates.length ? (
                    e.certificates.map((cert) => <WidgetRow key={cert} label={`📄 ${cert}`} value={<Badge tone="emerald">VERIFIED</Badge>} />)
                  ) : (
                    <WidgetRow label={<em className="bos-text-faint">No certificates on file yet</em>} />
                  )}
                  <div className="bos-widget-row">
                    <Button size="sm" onClick={() => api.notify("Add certificate", "HR-only action in a live tenant.")}>
                      + Add certificate <span className="bos-text-faint">(HR)</span>
                    </Button>
                  </div>
                </div>
              ) : null}
            </WidgetCard>
            <WidgetCard title="Emergency Contact" dot="blue">
              <WidgetRow label="Name" value={personal.ecName} />
              <WidgetRow label="Relation" value={personal.ecRelation} />
              <WidgetRow label="Phone" value={personal.ecPhone} />
              <WidgetRow label="Blood Group" value={personal.blood} valueTone="coral" />
            </WidgetCard>
          </Grid>

          <Card interactive={false} style={{ maxWidth: 760 }}>
            <div className="bos-row-between" style={{ marginBottom: 10 }}>
              <div className="bos-kpi-label">
                Personal &amp; Emergency Details <span className="bos-text-faint">— self-editable, changes need HR approval</span>
              </div>
              {!draft && !pending ? (
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setDraft(personal)}>
                  Edit
                </Button>
              ) : null}
            </div>
            {draft ? (
              <>
                <FormGrid columns="repeat(auto-fit, minmax(160px, 1fr))">
                  {(Object.keys(PERSONAL_LABELS) as Array<keyof PersonalFields>).map((k) => (
                    <Field key={k} label={PERSONAL_LABELS[k]}>
                      {({ id }) => <Input id={id} size="sm" value={draft[k]} onChange={(ev) => setDraft({ ...draft, [k]: ev.target.value })} />}
                    </Field>
                  ))}
                </FormGrid>
                <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                  <Button size="sm" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setPending(draft);
                      setDraft(null);
                    }}
                  >
                    Submit for approval
                  </Button>
                </div>
              </>
            ) : (
              <DetailsGrid items={(Object.keys(PERSONAL_LABELS) as Array<keyof PersonalFields>).map((k) => ({ label: PERSONAL_LABELS[k], value: personal[k] }))} />
            )}
            {pending ? (
              <div style={{ marginTop: 12 }}>
                <Alert
                  tone="amber"
                  title="⏳ Pending HR approval"
                  actions={
                    <>
                      <Button size="sm" variant="primary" onClick={() => resolve(true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => resolve(false)}>
                        Reject
                      </Button>
                    </>
                  }
                >
                  {pendingDesc}
                </Alert>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "att" ? (
        <div className="bos-stack" style={{ "--bos-gap": "16px" } as CSSProperties}>
          <Grid cols={3} min={140}>
            <KpiCard label="Present" value={e.present} chip={{ color: "mint", glyph: "✓" }} delta="days this month" />
            <KpiCard label="Absent" value={e.absent} chip={{ color: "rose", glyph: "✕" }} delta="days this month" deltaTone="down" />
            <KpiCard label="Late arrivals" value={e.late} chip={{ color: "blue", glyph: "◐" }} delta="days this month" deltaTone="warn" />
          </Grid>
          <DataTable
            caption="Recent attendance"
            rowKey={(r) => r.date}
            rows={EMPLOYEE_ATTENDANCE}
            columns={[
              { key: "date", header: "Date", mono: true },
              { key: "in", header: "Check-in", mono: true },
              { key: "out", header: "Check-out", mono: true },
              { key: "status", header: "Status", cell: (r) => <Badge tone={r.tone}>{r.status}</Badge> },
            ]}
          />
        </div>
      ) : null}

      {tab === "pay" ? (
        <DataTable
          caption="Payroll history"
          rowKey={(m) => m}
          rows={PAYROLL_MONTHS}
          columns={[
            { key: "month", header: "Month", cell: (m) => m },
            { key: "gross", header: "Gross", mono: true, cell: () => e.gross },
            { key: "ded", header: "Deductions", mono: true, cell: (m) => (m === PAYROLL_MONTHS[0] && e.gross === e.net ? "₹0" : "—") },
            { key: "net", header: "Net Pay", mono: true, cell: () => e.net },
            { key: "status", header: "Status", cell: () => <Badge tone="emerald">PAID</Badge> },
            {
              key: "slip",
              header: "Payslip",
              cell: (m) => (
                <Button size="sm" variant="ghost" icon="download" onClick={() => api.notify("Payslip", `${e.name} — ${m}`)}>
                  Download
                </Button>
              ),
            },
          ]}
        />
      ) : null}

      {tab === "bank" ? (
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
              { label: "Bank Name", value: e.bank.name },
              { label: "Account Holder", value: e.bank.holder },
              { label: "Account Number", value: revealed ? e.bank.acct : `•••• •••• ${e.bank.acct.slice(-4)}` },
              { label: "IFSC Code", value: e.bank.ifsc },
              { label: "Branch Name", value: e.bank.branch },
              { label: "Pin Code", value: e.bank.pin },
            ]}
          />
          <div style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
              {revealed ? "Hide account number" : "Show account number"}
            </Button>
          </div>
        </Card>
      ) : null}
    </>
  );
}

/* ---------- Org chart ---------- */

const person = (key: string, role?: string): BosOrgNode => {
  const e = EMPLOYEE_BY_KEY[key];
  return { id: key, name: e.name, role: role ?? e.role, initials: e.initials, tone: e.tone };
};

const ORG_ROOT: BosOrgNode = {
  id: "ceo",
  name: "CEO Office",
  role: "Executive",
  initials: "CEO",
  virtual: true,
  children: [
    { ...person("jw", "Field Operations"), children: [person("rk"), person("vs")] },
    person("ps", "Sales"),
    { id: "vr", name: "Vivek Rao", role: "Engineering", initials: "VR", virtual: true, children: [person("an")] },
    person("ad"),
  ],
};

/* ---------- Policies ---------- */

function HrPolicies() {
  const { show } = useToast();
  const [acked, setAcked] = useState<Set<string>>(() => new Set(HR_POLICIES.filter((p) => p.acknowledged).map((p) => p.key)));
  const [open, setOpen] = useState<PolicyRow | null>(null);
  const [lastOpened, setLastOpened] = useState<PolicyRow | null>(null);
  const shown = open ?? lastOpened;

  const close = () => setOpen(null);
  return (
    <>
      <DataTable
        caption="HR policies"
        rowKey={(p) => p.key}
        rows={HR_POLICIES}
        columns={[
          {
            key: "name",
            header: "Policy",
            cell: (p) => (
              <>
                {p.name}
                {p.mandatory ? (
                  <Badge tone="coral" auto style={{ marginLeft: 6 }}>
                    MANDATORY
                  </Badge>
                ) : null}
              </>
            ),
          },
          { key: "category", header: "Category", cell: (p) => <Badge tag={p.category.tag}>{p.category.text}</Badge> },
          { key: "updated", header: "Last Updated", mono: true },
          { key: "ack", header: "Org-wide Acknowledgment", mono: true },
          {
            key: "status",
            header: "Your Status",
            cell: (p) =>
              acked.has(p.key) ? (
                <Badge tone="emerald">✓ ACKNOWLEDGED</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setOpen(p);
                    setLastOpened(p);
                  }}
                >
                  Read &amp; Acknowledge
                </Button>
              ),
          },
        ]}
      />
      <Dialog
        open={open !== null}
        onClose={close}
        icon={{ tone: "blue", glyph: shown?.dialog?.icon ?? "📋" }}
        title={shown?.name ?? ""}
        description={shown?.dialog?.summary}
        actionsNote="Scroll to read the full policy in the handbook."
        actions={
          <>
            <Button size="sm" onClick={close}>
              Not now
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (open) {
                  setAcked((cur) => new Set(cur).add(open.key));
                  show({ tone: "emerald", title: "Policy acknowledged", description: open.name });
                }
                close();
              }}
            >
              I&apos;ve read &amp; acknowledge
            </Button>
          </>
        }
      />
    </>
  );
}

/* ---------- View ---------- */

export function HrmView({ logoSrc, onSearch }: { logoSrc?: string; onSearch?: () => void }) {
  const [employeeKey, setEmployeeKey] = useState<string | null>(null);
  const employee = employeeKey ? EMPLOYEE_BY_KEY[employeeKey] : null;

  return (
    <ModuleWorkspace
      aria-label="HR Management modules"
      modules={HR_MODULES}
      brandName="Justx Systems"
      logoSrc={logoSrc}
      onSearch={onSearch}
      onModuleChange={() => setEmployeeKey(null)}
      renderCustom={(id, api) => {
        switch (id) {
          case "hr-overview":
            return <HrOverview api={api} />;
          case "hr-employees":
            return employee ? (
              <EmployeeDetail key={employee.key} employee={employee} onBack={() => setEmployeeKey(null)} api={api} />
            ) : (
              <EmployeeList onOpen={setEmployeeKey} api={api} />
            );
          case "hr-orgchart":
            return (
              <OrgChart
                root={ORG_ROOT}
                onSelect={(node) => {
                  if (!EMPLOYEE_BY_KEY[node.id]) return;
                  setEmployeeKey(node.id);
                  api.navigate("employees");
                }}
              />
            );
          case "hr-policies":
            return <HrPolicies />;
          default:
            return null;
        }
      }}
    />
  );
}
