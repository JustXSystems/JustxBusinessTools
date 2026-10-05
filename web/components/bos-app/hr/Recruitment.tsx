"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DetailsGrid,
  Field,
  FormGrid,
  Grid,
  Input,
  Kanban,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  WidgetRow,
  useToast,
  type BosColumn,
  type BosKanbanColumn,
  type BosPastel,
} from "@/components/bos";
import {
  bos,
  type Candidate,
  type CandidateDetail,
  type CandidateEvent,
  type CandidateInput,
  type CandidateStage,
  type EmployeeStatus,
  type EmploymentType,
  type HiringPriority,
  type InterviewMode,
  type JobOpening,
  type OnboardingTask,
  type OpeningInput,
  type OpeningStatus,
  type RecruitmentOverview,
} from "@/lib/bos-app/api";
import {
  addDaysISO,
  CANDIDATE_SOURCES,
  dateLabel,
  dayMonth,
  EMPLOYMENT_LABEL,
  inr,
  onboardingBadge,
  ONBOARDING_TASK_LABEL,
  openingBadge,
  priorityBadge,
  stageBadge,
  STAGE_LABEL,
  taskBadge,
  todayLocal,
} from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Tab = "all" | "openings" | "applications" | "onboarding" | "status";
type Opening = RecruitmentOverview["openings"][number];
type Departments = RecruitmentOverview["departments"];

const PIPELINE: ReadonlyArray<{ key: CandidateStage; dot: string }> = [
  { key: "applied", dot: "var(--bos-text-faint)" },
  { key: "interview", dot: "var(--bos-amber)" },
  { key: "shortlisted", dot: "var(--bos-pastel-lavender-ink)" },
  { key: "offer", dot: "var(--bos-blue)" },
  { key: "hired", dot: "var(--bos-emerald)" },
];
const OPEN_STAGES: ReadonlyArray<CandidateStage> = ["applied", "interview", "shortlisted", "offer"];
const isOpen = (s: CandidateStage) => OPEN_STAGES.includes(s);
const TASKS: ReadonlyArray<OnboardingTask> = ["documents", "kyc", "it", "induction", "kra"];
const SOURCE_TAG: Record<string, BosPastel> = { naukri: "sage", linkedin: "rose", referral: "lavender", indeed: "blue", website: "mint" };
const MODES: ReadonlyArray<{ value: InterviewMode; label: string }> = [
  { value: "in_person", label: "In person" },
  { value: "video", label: "Video call" },
  { value: "phone", label: "Phone" },
];
const MODE_LABEL: Record<InterviewMode, string> = { in_person: "In person", video: "Video call", phone: "Phone" };

const daysSince = (iso: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
const agoLabel = (iso: string, today: string) => {
  const d = daysSince(iso, today);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};
const whenLabel = (at: string) => `${dayMonth(at.slice(0, 10))}, ${at.slice(11, 16)}`;
const num = (v: string) => (v.trim() === "" ? null : Number(v));
/** Last word is the last name, as the server does. */
const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length < 2 ? { firstName: parts[0] ?? "", lastName: "" } : { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
};
const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const salaryText = (o: Pick<JobOpening, "salaryMin" | "salaryMax">) =>
  o.salaryMin && o.salaryMax ? `${inr(o.salaryMin)} – ${inr(o.salaryMax)}` : o.salaryMin ? `From ${inr(o.salaryMin)}` : o.salaryMax ? `Up to ${inr(o.salaryMax)}` : "—";

/** New joiners still being onboarded, or who joined in the last 90 days. */
const joinersOf = (candidates: ReadonlyArray<Candidate>, today: string) =>
  candidates.filter((c) => c.stage === "hired" && (c.progress?.state !== "completed" || (c.joiningDate ?? today) >= addDaysISO(today, -90))).sort((a, b) => (a.joiningDate ?? "").localeCompare(b.joiningDate ?? ""));

function Described({ title, sub, width = 300 }: { title: ReactNode; sub?: ReactNode; width?: number }) {
  return (
    <span style={{ display: "block", maxWidth: width }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {sub ? (
        <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/** HR → Recruitment & Onboarding: roles, the hiring pipeline, offers and the new-joiner checklist. Managers only. */
export function Recruitment() {
  const { canManage, takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("recruit"));
  const [candidateId, setCandidateId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  if (!canManage) return <ManagersOnly>Hiring and onboarding are limited to owners and admins.</ManagersOnly>;
  return candidateId ? <CandidateView id={candidateId} onBack={() => setCandidateId(null)} /> : <RecruitmentHome onOpen={setCandidateId} />;
}

/* ---------- Home ---------- */

function RecruitmentHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("all");
  const [dialog, setDialog] = useState<"opening" | "candidate" | null>(null);
  const [editing, setEditing] = useState<Opening | null>(null);
  const [responding, setResponding] = useState<Candidate | null>(null);
  const { run } = useBosAction();
  const { show } = useToast();
  const state = useBosData(() => bos.recruitment(), []);

  return (
    <Loaded state={state}>
      {(o) => {
        const live = o.openings.filter((x) => x.status !== "closed");
        const move = (c: Candidate, to: CandidateStage) => {
          if (to === "hired") {
            if (c.stage === "offer" && c.offerStatus === "sent") return setResponding(c);
            return show({ tone: "amber", title: "Send an offer first", description: "A candidate is hired when they accept an offer." });
          }
          void run(`move-${c.id}`, () => bos.moveCandidate(c.id, to), { success: `Moved to ${STAGE_LABEL[to]}`, description: c.name });
        };
        return (
          <Stack>
            <ModuleToolbar>
              <Segmented<Tab>
                size="sm"
                aria-label="Recruitment view"
                options={[
                  { value: "all", label: "All" },
                  { value: "openings", label: "Open positions" },
                  { value: "applications", label: "Applications" },
                  { value: "onboarding", label: "Onboarding" },
                  { value: "status", label: "Status" },
                ]}
                value={tab}
                onChange={setTab}
              />
              <span className="bos-spacer" />
              <Button size="sm" icon="plus" onClick={() => setDialog("opening")}>
                Add role
              </Button>
              <Button size="sm" variant="primary" icon="plus" disabled={!live.length} onClick={() => setDialog("candidate")}>
                Add candidate
              </Button>
            </ModuleToolbar>

            {!o.openings.length ? (
              <Alert
                tone="blue"
                title="Start with a role you're hiring for"
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog("opening")}>
                    Add role
                  </Button>
                }
              >
                Add each open role with its department and how many people you need. Then add candidates as applications come in — from Naukri, LinkedIn, referrals or walk-ins — and move them through interview, shortlist and offer. When an
                offer is accepted, BOS tracks the joiner&apos;s documents, KYC, IT setup, induction and KRAs, and creates their employee record when you&apos;re ready.
              </Alert>
            ) : null}
            {o.truncated ? <Alert tone="amber" title="Showing the latest 3,000 applications">Older applications aren&apos;t counted here.</Alert> : null}

            {tab === "all" ? <AllTab o={o} onOpen={onOpen} onMove={move} /> : null}
            {tab === "openings" ? <OpeningsTab o={o} onEdit={setEditing} /> : null}
            {tab === "applications" ? <ApplicationsTab o={o} onOpen={onOpen} /> : null}
            {tab === "onboarding" ? <OnboardingTab o={o} onOpen={onOpen} /> : null}
            {tab === "status" ? <StatusTab o={o} onOpen={onOpen} /> : null}

            {dialog === "opening" ? <OpeningDialog opening={null} departments={o.departments} onClose={() => setDialog(null)} /> : null}
            {editing ? <OpeningDialog opening={editing} departments={o.departments} onClose={() => setEditing(null)} /> : null}
            {dialog === "candidate" ? <CandidateDialog candidate={null} openings={live} today={o.today} onClose={() => setDialog(null)} onSaved={(c) => onOpen(c.id)} /> : null}
            {responding ? <ResponseDialog candidate={responding} today={o.today} onClose={() => setResponding(null)} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function AllTab({ o, onOpen, onMove }: { o: RecruitmentOverview; onOpen: (id: string) => void; onMove: (c: Candidate, to: CandidateStage) => void }) {
  const t = o.totals;
  const recentHire = addDaysISO(o.today, -60);
  const responded = t.offersAccepted + t.offersDeclined;
  const columns: BosKanbanColumn[] = PIPELINE.map((s) => {
    const list = o.candidates.filter((c) => c.stage === s.key && (s.key !== "hired" || (c.hiredOn ?? o.today) >= recentHire || c.progress?.state !== "completed"));
    return {
      id: s.key,
      title: STAGE_LABEL[s.key],
      dot: s.dot,
      highlightCount: { value: String(list.length), color: s.dot },
      cards: list.map((c) => ({
        id: c.id,
        title: (
          <button type="button" className="bos-link" style={{ textAlign: "left", font: "inherit", color: "inherit" }} onClick={() => onOpen(c.id)}>
            <Described title={c.name} sub={c.openingTitle} width={220} />
          </button>
        ),
        tag: <Badge tag={SOURCE_TAG[c.source.toLowerCase()] ?? "mint"}>{c.source.toUpperCase()}</Badge>,
        people: <PersonAvatar name={c.name} size="xs" />,
        due:
          c.stage === "applied"
            ? `Applied ${agoLabel(c.appliedOn, o.today)}`
            : c.stage === "interview"
              ? c.interviewAt
                ? whenLabel(c.interviewAt)
                : "To schedule"
              : c.stage === "shortlisted"
                ? "Ready for an offer"
                : c.stage === "offer"
                  ? c.offerStatus === "sent"
                    ? "Offer sent"
                    : "Offer to send"
                  : c.joiningDate
                    ? c.joiningDate > o.today
                      ? `Starts ${dayMonth(c.joiningDate)}`
                      : `Joined ${dayMonth(c.joiningDate)}`
                    : "Hired",
      })),
    };
  });
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Open positions" value={t.openPositions.toLocaleString("en-IN")} chip={{ color: "blue", glyph: "◈" }} delta={`Across ${t.departmentsHiring} department${t.departmentsHiring === 1 ? "" : "s"}`} deltaTone="muted" />
        <KpiCard label="Active applicants" value={t.activeApplicants.toLocaleString("en-IN")} chip={{ color: "lavender", glyph: "👤" }} delta="In the pipeline now" deltaTone="muted" />
        <KpiCard
          label="Avg. time to hire"
          value={t.avgDaysToHire === null ? "—" : `${t.avgDaysToHire} day${t.avgDaysToHire === 1 ? "" : "s"}`}
          chip={{ color: "amber", glyph: "◷" }}
          delta={t.hiresCounted ? `Application to acceptance · ${t.hiresCounted} hire${t.hiresCounted === 1 ? "" : "s"} in the last year` : "No hires in the last year"}
          deltaTone="muted"
        />
        <KpiCard
          label="Offer acceptance rate"
          value={responded ? `${Math.round((t.offersAccepted / responded) * 100)}%` : "—"}
          chip={{ color: "mint", glyph: "✓" }}
          delta={responded ? `${t.offersAccepted} of ${responded} offers accepted` : "No responses this financial year"}
          deltaTone="muted"
        />
      </Grid>
      <div>
        <p className="bos-text-faint" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Hiring pipeline — drag a card to move it. Dropping on Hired records an accepted offer.
        </p>
        <Kanban aria-label="Hiring pipeline" columns={columns} onMove={(cardId, _from, to) => {
          const c = o.candidates.find((x) => x.id === cardId);
          if (c) onMove(c, to as CandidateStage);
        }} />
      </div>
      <JoinersTable o={o} onOpen={onOpen} caption="Onboarding — New Joiners" columns={["docs", "it", "induction"]} />
    </Stack>
  );
}

function JoinersTable({ o, onOpen, caption, columns: keys }: { o: RecruitmentOverview; onOpen: (id: string) => void; caption: string; columns: ReadonlyArray<"offer" | "docs" | "it" | "kyc" | "induction" | "kra" | "sync"> }) {
  const joiners = joinersOf(o.candidates, o.today);
  const cell: Record<(typeof keys)[number], BosColumn<Candidate>> = {
    offer: { key: "offer", header: "Offer Letter", cell: () => <StatusBadge view={{ text: "ACCEPTED", tone: "emerald" }} /> },
    docs: { key: "docs", header: "Documents", cell: (c) => <StatusBadge view={taskBadge("documents", c.onboarding.documents)} /> },
    it: { key: "it", header: "IT Setup", cell: (c) => <StatusBadge view={taskBadge("it", c.onboarding.it)} /> },
    kyc: { key: "kyc", header: "KYC", cell: (c) => <StatusBadge view={taskBadge("kyc", c.onboarding.kyc)} /> },
    induction: { key: "induction", header: "Induction", cell: (c) => <StatusBadge view={taskBadge("induction", c.onboarding.induction)} /> },
    kra: { key: "kra", header: "KRA Update", cell: (c) => <StatusBadge view={taskBadge("kra", c.onboarding.kra)} /> },
    sync: { key: "sync", header: "Employee Record", cell: (c) => <StatusBadge view={c.employeeId ? { text: `SYNCED · ${c.employeeCode ?? ""}`, tone: "emerald" } : { text: "PENDING", tone: "amber" }} /> },
  };
  const columns: BosColumn<Candidate>[] = [
    { key: "emp", header: "Employee", cell: (c) => <Described title={c.name} sub={keys.includes("offer") || keys.includes("docs") ? undefined : c.openingTitle} width={220} /> },
    ...(keys.includes("docs") || keys.includes("offer")
      ? ([
          { key: "role", header: "Role", cell: (c) => c.openingTitle },
          { key: "start", header: "Start Date", mono: true, cell: (c) => dateLabel(c.joiningDate) },
        ] as BosColumn<Candidate>[])
      : []),
    ...keys.map((k) => cell[k]),
    { key: "status", header: "Status", cell: (c) => (c.progress ? <StatusBadge view={onboardingBadge(c.progress.state)} /> : null) },
  ];
  return <DataTable caption={caption} columns={columns} rows={joiners} rowKey={(c) => c.id} onRowClick={(c) => onOpen(c.id)} empty="No new joiners yet — accepted offers appear here." />;
}

function OpeningsTab({ o, onEdit }: { o: RecruitmentOverview; onEdit: (x: Opening) => void }) {
  const [filter, setFilter] = useState<"active" | "closed" | "all">("active");
  const t = o.totals;
  const shown = o.openings.filter((x) => (filter === "all" ? true : filter === "closed" ? x.status === "closed" : x.status !== "closed"));
  const hiringDepts = [...new Set(o.openings.filter((x) => x.status === "open" && x.hired < x.openings).map((x) => x.departmentName ?? "No department"))];
  const columns: BosColumn<Opening>[] = [
    { key: "pos", header: "Position", cell: (x) => <Described title={x.title} sub={[EMPLOYMENT_LABEL[x.employmentType], x.location].filter(Boolean).join(" · ")} /> },
    { key: "dept", header: "Department", cell: (x) => x.departmentName ?? faint() },
    { key: "open", header: "Openings", align: "right", mono: true, cell: (x) => (x.hired ? `${x.hired}/${x.openings} filled` : x.openings) },
    { key: "applicants", header: "In Pipeline", align: "right", mono: true, cell: (x) => x.active },
    { key: "salary", header: "Salary (CTC)", cell: (x) => salaryText(x) },
    { key: "pri", header: "Priority", cell: (x) => <StatusBadge view={priorityBadge(x.priority)} /> },
    { key: "post", header: "Job Post", cell: (x) => <StatusBadge view={openingBadge(x.status)} /> },
  ];
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Total open positions" value={t.openPositions.toLocaleString("en-IN")} chip={{ color: "blue", glyph: "◈" }} delta={`Across ${t.departmentsHiring} department${t.departmentsHiring === 1 ? "" : "s"}`} deltaTone="muted" />
        <KpiCard label="Departments hiring" value={String(t.departmentsHiring)} chip={{ color: "lavender", glyph: "🏢" }} delta={hiringDepts.slice(0, 3).join(", ") || "None right now"} deltaTone="muted" />
        <KpiCard label="Roles published" value={String(t.openRoles)} chip={{ color: "mint", glyph: "✓" }} delta="Open and taking candidates" deltaTone="muted" />
        <KpiCard label="Roles in draft" value={String(t.draftRoles)} chip={{ color: "amber", glyph: "◷" }} delta={t.draftRoles ? "Not yet open" : "Nothing waiting"} deltaTone={t.draftRoles ? "warn" : "muted"} />
      </Grid>
      <ModuleToolbar>
        <Segmented<"active" | "closed" | "all">
          role="radio"
          size="sm"
          aria-label="Show roles"
          options={[
            { value: "active", label: "Active" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </ModuleToolbar>
      <DataTable caption="Position details" columns={columns} rows={shown} rowKey={(x) => x.id} onRowClick={onEdit} empty={filter === "closed" ? "No closed roles." : "No roles yet."} />
    </Stack>
  );
}

function ApplicationsTab({ o, onOpen }: { o: RecruitmentOverview; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<"pipeline" | "hired" | "closed" | "all">("pipeline");
  const [roleId, setRoleId] = useState("");
  const [query, setQuery] = useState("");
  const t = o.totals;
  const q = query.trim().toLowerCase();
  const inFilter = (c: Candidate) => (filter === "all" ? true : filter === "pipeline" ? isOpen(c.stage) : filter === "hired" ? c.stage === "hired" : c.stage === "rejected" || c.stage === "withdrawn");
  const shown = o.candidates.filter((c) => inFilter(c) && (!roleId || c.openingId === roleId) && (!q || [c.name, c.email, c.phone, c.source, c.openingTitle].some((s) => s?.toLowerCase().includes(q))));
  const columns: BosColumn<Candidate>[] = [
    { key: "cand", header: "Candidate", cell: (c) => <Described title={c.name} sub={[c.email, c.phone].filter(Boolean).join(" · ")} width={240} /> },
    { key: "for", header: "Applying For", cell: (c) => c.openingTitle },
    { key: "src", header: "Source", cell: (c) => c.source },
    { key: "on", header: "Applied On", mono: true, cell: (c) => dateLabel(c.appliedOn) },
    { key: "stage", header: "Stage", cell: (c) => <StatusBadge view={stageBadge(c.stage)} /> },
  ];
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Active applications" value={t.activeApplicants.toLocaleString("en-IN")} chip={{ color: "blue", glyph: "👤" }} delta={`${o.candidates.length} on record`} deltaTone="muted" />
        <KpiCard label="To review" value={String(t.byStage.applied)} chip={{ color: "lavender", glyph: "📋" }} delta="Awaiting first review" deltaTone={t.byStage.applied ? "warn" : "muted"} />
        <KpiCard label="Interview" value={String(t.byStage.interview)} chip={{ color: "amber", glyph: "🎤" }} delta="Scheduled or in progress" deltaTone="muted" />
        <KpiCard label="Shortlisted" value={String(t.byStage.shortlisted)} chip={{ color: "mint", glyph: "★" }} delta="Moving to offer stage" deltaTone="muted" />
      </Grid>
      <ModuleToolbar>
        <Segmented<"pipeline" | "hired" | "closed" | "all">
          role="radio"
          size="sm"
          aria-label="Show applications"
          options={[
            { value: "pipeline", label: `In pipeline (${t.activeApplicants})` },
            { value: "hired", label: `Hired (${t.byStage.hired})` },
            { value: "closed", label: `Closed (${t.byStage.rejected + t.byStage.withdrawn})` },
            { value: "all", label: "All" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <Select size="sm" aria-label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)} style={{ width: "auto", maxWidth: 240 }}>
          <option value="">All roles</option>
          {o.openings.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </Select>
        <span className="bos-spacer" />
        <SearchInput placeholder="Search name, email, phone…" aria-label="Search candidates" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button size="sm" icon="download" disabled={!shown.length} onClick={() => exportCandidates(shown)}>
          Download CSV
        </Button>
      </ModuleToolbar>
      <DataTable caption="Applications" columns={columns} rows={shown} rowKey={(c) => c.id} onRowClick={(c) => onOpen(c.id)} empty="No applications match." />
    </Stack>
  );
}

function exportCandidates(list: ReadonlyArray<Candidate>) {
  const headers = ["Candidate", "Email", "Phone", "Role", "Department", "Source", "Referred by", "Applied on", "Stage", "Expected CTC", "Notice (days)", "Interview", "Offer CTC", "Joining date", "Reason"];
  downloadCsv(
    "applications.csv",
    headers,
    list.map((c) => ({
      Candidate: c.name,
      Email: c.email ?? "",
      Phone: c.phone ?? "",
      Role: c.openingTitle,
      Department: c.departmentName ?? "",
      Source: c.source,
      "Referred by": c.referredBy ?? "",
      "Applied on": c.appliedOn,
      Stage: STAGE_LABEL[c.stage],
      "Expected CTC": c.expectedCtc ?? "",
      "Notice (days)": c.noticeDays ?? "",
      Interview: c.interviewAt?.replace("T", " ") ?? "",
      "Offer CTC": c.offerCtc ?? "",
      "Joining date": c.joiningDate ?? "",
      Reason: c.closedReason ?? "",
    })),
  );
}

function OnboardingTab({ o, onOpen }: { o: RecruitmentOverview; onOpen: (id: string) => void }) {
  const t = o.totals;
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Offer letters sent" value={String(t.offersSent)} chip={{ color: "blue", glyph: "✉" }} delta={`${t.offersAccepted} accepted, ${t.offersPending} pending · this year`} deltaTone="muted" />
        <KpiCard label="New joiners (this month)" value={String(t.joinersThisMonth)} chip={{ color: "mint", glyph: "＋" }} delta="Joining dates this month" deltaTone="muted" />
        <KpiCard label="Documents pending" value={String(t.documentsPending)} chip={{ color: "amber", glyph: "📄" }} delta={t.documentsPending ? "Awaiting submission" : "All in"} deltaTone={t.documentsPending ? "warn" : "muted"} />
        <KpiCard label="Inductions this week" value={String(t.inductionsSoon)} chip={{ color: "lavender", glyph: "🎓" }} delta="Scheduled in the next 7 days" deltaTone="muted" />
      </Grid>
      <JoinersTable o={o} onOpen={onOpen} caption="Onboarding" columns={["offer", "docs", "induction"]} />
    </Stack>
  );
}

function StatusTab({ o, onOpen }: { o: RecruitmentOverview; onOpen: (id: string) => void }) {
  const ob = o.totals.onboarding;
  const of = (n: number) => `${n}/${ob.total}`;
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="IT setup done" value={of(ob.it)} chip={{ color: "blue", glyph: "💻" }} delta={ob.total - ob.it ? `${ob.total - ob.it} pending` : "All set up"} deltaTone={ob.total - ob.it ? "warn" : "muted"} />
        <KpiCard label="KYC verified" value={of(ob.kyc)} chip={{ color: "mint", glyph: "✓" }} delta="Aadhaar & PAN checked" deltaTone="muted" />
        <KpiCard label="KRA updated" value={of(ob.kra)} chip={{ color: "amber", glyph: "🎯" }} delta={ob.total - ob.kra ? "Awaiting manager input" : "All updated"} deltaTone={ob.total - ob.kra ? "warn" : "muted"} />
        <KpiCard label="Employee record" value={of(ob.synced)} chip={{ color: "lavender", glyph: "🔄" }} delta="Synced to HR" deltaTone="muted" />
      </Grid>
      <JoinersTable o={o} onOpen={onOpen} caption="Onboarding status" columns={["it", "kyc", "kra", "sync"]} />
    </Stack>
  );
}

/* ---------- One candidate ---------- */

type Dialog = "edit" | "interview" | "offer" | "response" | "close" | "reopen" | "note" | "induction" | "employee" | "undo" | "delete" | "letter";

function CandidateView({ id, onBack }: { id: string; onBack: () => void }) {
  const { run, busy } = useBosAction();
  const { navigate } = useBosApp();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const state = useBosData(() => bos.candidate(id), [id]);
  const lists = useBosData(() => bos.recruitment(), []);
  const close = () => setDialog(null);
  const today = todayLocal();

  if (dialog === "letter" && state.data) return <OfferLetterView detail={state.data} onBack={close} />;

  return (
    <Loaded state={state} rows={2}>
      {(detail) => {
        const { candidate: c, opening, events } = detail;
        const open = isOpen(c.stage);
        const closed = c.stage === "rejected" || c.stage === "withdrawn";
        const hired = c.stage === "hired";
        const setTask = (task: OnboardingTask, done: boolean) =>
          run(`task-${task}`, () => bos.updateOnboarding(c.id, { task, done }), { success: `${ONBOARDING_TASK_LABEL[task]} ${done ? "done" : "marked pending"}`, description: c.name });
        const eventColumns: BosColumn<CandidateEvent>[] = [
          { key: "date", header: "Date", mono: true, cell: (e) => dateLabel(e.date) },
          { key: "event", header: "Event", cell: (e) => <Described title={eventTitle(e)} sub={e.kind === "note" ? undefined : (e.note ?? undefined)} width={420} /> },
          { key: "by", header: "By", cell: (e) => e.actorName ?? faint() },
        ];
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to recruitment
              </button>
              <div className="bos-app-actions">
                {!c.employeeId ? (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("delete")}>
                    Delete
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setDialog("note")}>
                  Add note
                </Button>
                <Button size="sm" icon="edit" onClick={() => setDialog("edit")}>
                  Edit
                </Button>
                {open ? (
                  <>
                    <Button size="sm" onClick={() => setDialog("close")}>
                      Reject / withdraw
                    </Button>
                    <Button size="sm" onClick={() => setDialog("interview")}>
                      {c.interviewAt ? "Reschedule interview" : "Schedule interview"}
                    </Button>
                    {c.stage === "offer" && c.offerStatus === "sent" ? (
                      <>
                        <Button size="sm" onClick={() => setDialog("offer")}>
                          Revise offer
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => setDialog("response")}>
                          Record response
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => setDialog("offer")}>
                        Make offer
                      </Button>
                    )}
                  </>
                ) : null}
                {closed ? (
                  <Button size="sm" variant="primary" onClick={() => setDialog("reopen")}>
                    Reopen
                  </Button>
                ) : null}
                {hired ? (
                  <>
                    {!c.employeeId ? (
                      <Button size="sm" variant="ghost" onClick={() => setDialog("undo")}>
                        Undo hire
                      </Button>
                    ) : null}
                    <Button size="sm" icon="printer" onClick={() => setDialog("letter")}>
                      Offer letter
                    </Button>
                    {c.employeeId ? (
                      <Button size="sm" variant="primary" onClick={() => navigate("hr", "employees", `open:${c.employeeId}`)}>
                        Open employee
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => setDialog("employee")}>
                        Create employee record
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
            <Stack>
              <div className="bos-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <PersonAvatar name={c.name} size="md" />
                <h2 style={{ margin: 0, fontSize: 18 }}>{c.name}</h2>
                <StatusBadge view={stageBadge(c.stage)} />
                <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                  {opening.title}
                  {opening.departmentName ? ` · ${opening.departmentName}` : ""}
                </span>
              </div>
              {open ? (
                <Segmented<CandidateStage>
                  role="radio"
                  size="sm"
                  aria-label="Pipeline stage"
                  options={OPEN_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
                  value={c.stage}
                  onChange={(to) => void run("stage", () => bos.moveCandidate(c.id, to), { success: `Moved to ${STAGE_LABEL[to]}`, description: c.name })}
                />
              ) : null}
              {closed ? (
                <Alert tone="amber" title={c.stage === "rejected" ? "Rejected" : "Withdrawn"}>
                  {c.closedReason ?? "No reason recorded."} · {dateLabel(c.stageOn)}
                </Alert>
              ) : null}
              {hired && c.progress?.state === "delayed" ? (
                <Alert tone="coral" title="Onboarding is behind">
                  The joining date has arrived with documents, KYC, IT setup or the employee record still pending.
                </Alert>
              ) : null}

              <Grid cols={4} min={140}>
                {hired ? (
                  <>
                    <KpiCard label="Joining date" value={dateLabel(c.joiningDate)} chip={{ color: "mint", glyph: "＋" }} delta={c.hiredOn ? `Accepted ${dateLabel(c.hiredOn)}` : ""} deltaTone="muted" interactive={false} />
                    <KpiCard label="Offered CTC" value={c.offerCtc ? inr(c.offerCtc) : "—"} chip={{ color: "blue", glyph: "₹" }} delta={c.offerCtc ? `${inr(c.offerCtc / 12)} a month` : ""} deltaTone="muted" interactive={false} />
                    <KpiCard label="Onboarding" value={c.progress ? `${c.progress.done}/${c.progress.total}` : "—"} chip={{ color: "lavender", glyph: "✓" }} delta={c.progress ? onboardingBadge(c.progress.state).text.toLowerCase() : ""} deltaTone="muted" interactive={false} />
                    <KpiCard label="Employee record" value={c.employeeCode ?? "Not yet"} chip={{ color: "sage", glyph: "🔄" }} delta={c.employeeId ? "Synced to HR" : "Create it when ready"} deltaTone={c.employeeId ? "muted" : "warn"} interactive={false} />
                  </>
                ) : (
                  <>
                    <KpiCard label="Applied" value={dateLabel(c.appliedOn)} chip={{ color: "blue", glyph: "📋" }} delta={`via ${c.source} · ${agoLabel(c.appliedOn, today)}`} deltaTone="muted" interactive={false} />
                    <KpiCard label="Expected CTC" value={c.expectedCtc ? inr(c.expectedCtc) : "—"} chip={{ color: "mint", glyph: "₹" }} delta={c.currentCtc ? `Current ${inr(c.currentCtc)}` : "Current not noted"} deltaTone="muted" interactive={false} />
                    <KpiCard label="Notice period" value={c.noticeDays === null ? "—" : `${c.noticeDays} days`} chip={{ color: "amber", glyph: "◷" }} delta={opening.targetDate ? `Role needed by ${dateLabel(opening.targetDate)}` : ""} deltaTone="muted" interactive={false} />
                    <KpiCard
                      label={c.offerStatus === "sent" ? "Offer" : "Interview"}
                      value={c.offerStatus === "sent" && c.offerCtc ? inr(c.offerCtc) : c.interviewAt ? whenLabel(c.interviewAt) : "—"}
                      chip={{ color: "lavender", glyph: c.offerStatus === "sent" ? "✉" : "🎤" }}
                      delta={
                        c.offerStatus === "sent"
                          ? `Sent ${dateLabel(c.offerSentOn)} · joining ${dateLabel(c.joiningDate)}`
                          : c.interviewAt
                            ? [c.interviewMode ? MODE_LABEL[c.interviewMode] : null, c.interviewer].filter(Boolean).join(" · ")
                            : "Not scheduled"
                      }
                      deltaTone="muted"
                      interactive={false}
                    />
                  </>
                )}
              </Grid>

              {hired ? (
                <WidgetCard title="🧭 Onboarding checklist" dot="mint">
                  {TASKS.map((task) => {
                    const s = c.onboarding[task];
                    return (
                      <WidgetRow
                        key={task}
                        label={
                          <span className="bos-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ minWidth: 96, fontWeight: 600 }}>{ONBOARDING_TASK_LABEL[task]}</span>
                            <StatusBadge view={taskBadge(task, s)} />
                            {s?.done && s.date ? <span className="bos-text-faint" style={{ fontSize: 11.5 }}>{dateLabel(s.date)}</span> : null}
                          </span>
                        }
                        value={
                          <span className="bos-row" style={{ gap: 6 }}>
                            {task === "induction" && !s?.done ? (
                              <Button size="sm" variant="ghost" onClick={() => setDialog("induction")}>
                                {s?.date ? "Reschedule" : "Schedule"}
                              </Button>
                            ) : null}
                            <Button size="sm" variant={s?.done ? "ghost" : "secondary"} disabled={busy === `task-${task}`} onClick={() => void setTask(task, !s?.done)}>
                              {s?.done ? "Undo" : "Mark done"}
                            </Button>
                          </span>
                        }
                      />
                    );
                  })}
                  <WidgetRow
                    label={
                      <span className="bos-row" style={{ gap: 10, alignItems: "center" }}>
                        <span style={{ minWidth: 96, fontWeight: 600 }}>Employee record</span>
                        <StatusBadge view={c.employeeId ? { text: `SYNCED · ${c.employeeCode ?? ""}`, tone: "emerald" } : { text: "PENDING", tone: "amber" }} />
                      </span>
                    }
                    value={
                      c.employeeId ? null : (
                        <Button size="sm" onClick={() => setDialog("employee")}>
                          Create
                        </Button>
                      )
                    }
                  />
                </WidgetCard>
              ) : null}

              <WidgetCard title="🪪 Application" dot="blue">
                <DetailsGrid
                  items={[
                    { label: "Email", value: c.email || "—" },
                    { label: "Phone", value: c.phone || "—" },
                    { label: "Source", value: c.referredBy ? `${c.source} · referred by ${c.referredBy}` : c.source },
                    { label: "Rating", value: c.rating ? `${"★".repeat(c.rating)}${"☆".repeat(5 - c.rating)}` : "—" },
                    {
                      label: "Résumé",
                      value: c.resumeLink ? (
                        <a href={c.resumeLink} target="_blank" rel="noopener noreferrer" className="bos-link">
                          Open link ↗
                        </a>
                      ) : (
                        "—"
                      ),
                    },
                    { label: "Role", value: [opening.title, EMPLOYMENT_LABEL[opening.employmentType], opening.location].filter(Boolean).join(" · ") },
                    { label: "Salary range", value: salaryText(opening) },
                    ...(c.offerCtc ? [{ label: "Offer", value: `${inr(c.offerCtc)} a year · ${c.offerStatus === "accepted" ? "accepted" : c.offerStatus === "declined" ? "declined" : "sent"} ${dateLabel(c.offerRespondedOn ?? c.offerSentOn)}` }] : []),
                    ...(c.notes ? [{ label: "Notes", value: c.notes }] : []),
                  ]}
                />
              </WidgetCard>
              <DataTable caption={`History, ${c.name}`} columns={eventColumns} rows={events} rowKey={(e) => e.id} compact empty="No history yet." />
            </Stack>

            {dialog === "edit" ? <CandidateDialog candidate={c} openings={(lists.data?.openings ?? []).filter((x) => x.status !== "closed" || x.id === c.openingId)} today={today} onClose={close} /> : null}
            {dialog === "interview" ? <InterviewDialog candidate={c} today={today} onClose={close} /> : null}
            {dialog === "offer" ? <OfferDialog candidate={c} opening={opening} today={today} onClose={close} /> : null}
            {dialog === "response" ? <ResponseDialog candidate={c} today={today} onClose={close} /> : null}
            {dialog === "close" ? <CloseDialog candidate={c} onClose={close} /> : null}
            {dialog === "note" ? <NoteDialog candidate={c} onClose={close} /> : null}
            {dialog === "induction" ? <InductionDialog candidate={c} today={today} onClose={close} /> : null}
            {dialog === "employee" ? <EmployeeDialog detail={detail} departments={lists.data?.departments ?? []} onClose={close} /> : null}
            <ConfirmDialog
              open={dialog === "reopen"}
              onClose={close}
              title={`Reopen ${c.name}'s application?`}
              description="The candidate goes back to Applied, ready for review."
              confirmLabel="Reopen"
              busy={busy === "reopen"}
              onConfirm={async () => {
                const out = await run("reopen", () => bos.moveCandidate(c.id, "applied"), { success: "Application reopened", description: c.name });
                if (out) close();
              }}
            />
            <ConfirmDialog
              open={dialog === "undo"}
              onClose={close}
              title={`Undo ${c.name}'s hire?`}
              description="The offer goes back to awaiting a response. Use this if the acceptance was recorded by mistake."
              confirmLabel="Undo hire"
              busy={busy === "undo"}
              onConfirm={async () => {
                const out = await run("undo", () => bos.undoHire(c.id), { success: "Hire undone", description: c.name });
                if (out) close();
              }}
            />
            <ConfirmDialog
              open={dialog === "delete"}
              onClose={close}
              destructive
              title={`Delete ${c.name}'s application?`}
              description="The application and its history are removed. To keep a record, reject it instead."
              confirmLabel="Delete"
              busy={busy === "delete"}
              onConfirm={async () => {
                const done = await run(
                  "delete",
                  async () => {
                    await bos.deleteCandidate(c.id);
                    return true;
                  },
                  { success: "Application deleted", description: c.name, refresh: false },
                );
                if (!done) return;
                close();
                onBack();
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function eventTitle(e: CandidateEvent): string {
  switch (e.kind) {
    case "applied":
      return "Applied";
    case "stage":
      return e.fromStage && e.toStage ? `${STAGE_LABEL[e.fromStage]} → ${STAGE_LABEL[e.toStage]}` : "Stage changed";
    case "interview":
      return "Interview scheduled";
    case "offer":
      return "Offer sent";
    case "offer_response":
      return e.toStage === "hired" ? "Offer accepted" : "Offer declined";
    case "onboarding":
      return e.note ?? "Onboarding";
    case "employee":
      return e.note ?? "Employee record created";
    case "note":
      return e.note ?? "Note";
    default:
      return e.kind;
  }
}

/* ---------- Offer letter ---------- */

function OfferLetterView({ detail, onBack }: { detail: CandidateDetail; onBack: () => void }) {
  const print = usePrint();
  const { session } = useBosApp();
  const { candidate: c, opening } = detail;
  const s = session.settings;
  const company = session.brand?.name || s.companyName || "Our company";
  const address = [s.address, [s.gstin && `GSTIN ${s.gstin}`, s.state].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  const ctc = c.offerCtc ?? 0;
  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={onBack}>
          ‹ Back to {c.name}
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" onClick={print}>
            Print / PDF
          </Button>
        </div>
      </div>
      <div className="bos-payslip-wrap">
        <article className="bos-inv-paper bos-offer-letter" aria-label="Offer letter">
          <div className="bos-inv-paper-top">
            <div>
              <div className="bos-inv-paper-brand">{company}</div>
              {address ? <div className="bos-inv-paper-seller">{address}</div> : null}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="bos-inv-paper-title">OFFER LETTER</div>
              <div className="bos-inv-paper-sub">{dateLabel(c.offerSentOn)}</div>
            </div>
          </div>
          <p>
            Dear {c.name},
          </p>
          <p>
            We are pleased to offer you the position of <strong>{opening.title}</strong>
            {opening.departmentName ? ` in our ${opening.departmentName} team` : ""} at {company}, on a {EMPLOYMENT_LABEL[opening.employmentType].toLowerCase()} basis
            {opening.location ? `, based at ${opening.location}` : ""}.
          </p>
          <p>
            Your annual cost to company will be <strong>{inr(ctc)}</strong> (about {inr(ctc / 12)} a month), and we look forward to you joining us on <strong>{dateLabel(c.joiningDate)}</strong>.
          </p>
          {c.offerTerms ? <p style={{ whiteSpace: "pre-line" }}>{c.offerTerms}</p> : null}
          <p>Please confirm your acceptance by signing and returning a copy of this letter. We&apos;re excited to have you on the team.</p>
          <div className="bos-offer-sign">
            <div>
              <div className="bos-offer-sign-line" />
              For {company}
              <br />
              Authorised signatory
            </div>
            <div>
              <div className="bos-offer-sign-line" />
              Accepted by {c.name}
              <br />
              Date
            </div>
          </div>
          <div className="bos-payslip-note">Generated with Justx BOS.</div>
        </article>
      </div>
    </>
  );
}

/* ---------- Dialogs ---------- */

function OpeningDialog({ opening, departments, onClose }: { opening: Opening | null; departments: Departments; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const f = useFormState(() => ({
    title: opening?.title ?? "",
    departmentId: opening?.departmentId ?? "",
    location: opening?.location ?? "",
    employmentType: opening?.employmentType ?? ("full_time" as EmploymentType),
    openings: String(opening?.openings ?? 1),
    priority: opening?.priority ?? ("medium" as HiringPriority),
    status: opening?.status ?? ("open" as OpeningStatus),
    salaryMin: opening?.salaryMin ? String(opening.salaryMin) : "",
    salaryMax: opening?.salaryMax ? String(opening.salaryMax) : "",
    targetDate: opening?.targetDate ?? "",
    description: opening?.description ?? "",
  }));
  const v = f.values;

  if (opening && confirmingDelete) {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        destructive
        title={`Delete the role ${opening.title}?`}
        description="It has no candidates, so it's removed completely."
        confirmLabel="Delete"
        busy={busy === "delete-role"}
        onConfirm={async () => {
          const done = await run(
            "delete-role",
            async () => {
              await bos.deleteOpening(opening.id);
              return true;
            },
            { success: "Role deleted", description: opening.title },
          );
          if (done) onClose();
        }}
      />
    );
  }

  const submit = async () => {
    const input: OpeningInput = {
      title: v.title.trim(),
      departmentId: v.departmentId || null,
      location: v.location.trim() || null,
      employmentType: v.employmentType,
      openings: Number(v.openings) || 1,
      priority: v.priority,
      status: v.status,
      salaryMin: num(v.salaryMin),
      salaryMax: num(v.salaryMax),
      targetDate: v.targetDate || null,
      description: v.description.trim() || null,
    };
    const out = await run("role", () => (opening ? bos.updateOpening(opening.id, input) : bos.createOpening(input)), { success: opening ? "Role updated" : "Role added", description: input.title });
    if (out) onClose();
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={opening ? `Edit ${opening.title}` : "Add a role"}
      description="A position you're hiring for. Drafts aren't counted as open positions until you publish them."
      icon={{ tone: "blue", name: "users" }}
      submitLabel={opening ? "Save" : "Add role"}
      busy={busy === "role"}
      onSubmit={submit}
      wide
      note={
        opening && !opening.applicants ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        ) : undefined
      }
    >
      <FormGrid>
        <Field label="Job title">{({ id }) => <Input id={id} required maxLength={160} value={v.title} placeholder="e.g. Solar Installation Technician" onChange={(e) => f.set("title")(e.target.value)} />}</Field>
        <Field label="Department">
          {({ id }) => (
            <Select id={id} value={v.departmentId} onChange={(e) => f.set("departmentId")(e.target.value)}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Openings">{({ id }) => <Input id={id} type="number" required min={1} max={500} step={1} value={v.openings} onChange={(e) => f.set("openings")(e.target.value)} />}</Field>
        <Field label="Employment type">
          {({ id }) => (
            <Select id={id} value={v.employmentType} onChange={(e) => f.set("employmentType")(e.target.value as EmploymentType)}>
              {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => (
                <option key={k} value={k}>
                  {EMPLOYMENT_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {({ id }) => (
            <Select id={id} value={v.priority} onChange={(e) => f.set("priority")(e.target.value as HiringPriority)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          )}
        </Field>
        <Field label="Job post">
          {({ id }) => (
            <Select id={id} value={v.status} onChange={(e) => f.set("status")(e.target.value as OpeningStatus)}>
              <option value="open">Published — taking candidates</option>
              <option value="draft">Draft</option>
              <option value="on_hold">On hold</option>
              <option value="closed">Closed</option>
            </Select>
          )}
        </Field>
        <Field label="Location">{({ id }) => <Input id={id} maxLength={120} value={v.location} placeholder="e.g. Mysuru" onChange={(e) => f.set("location")(e.target.value)} />}</Field>
        <Field label="Needed by">{({ id }) => <Input id={id} type="date" value={v.targetDate} onChange={(e) => f.set("targetDate")(e.target.value)} />}</Field>
        <Field label="Salary from (₹ a year)">{({ id }) => <Input id={id} type="number" min={0} step="1000" inputMode="numeric" value={v.salaryMin} placeholder="Optional" onChange={(e) => f.set("salaryMin")(e.target.value)} />}</Field>
        <Field label="Salary up to (₹ a year)">{({ id }) => <Input id={id} type="number" min={0} step="1000" inputMode="numeric" value={v.salaryMax} placeholder="Optional" onChange={(e) => f.set("salaryMax")(e.target.value)} />}</Field>
      </FormGrid>
      <Field label="Description">{({ id }) => <Textarea id={id} rows={3} maxLength={5000} value={v.description} placeholder="Responsibilities, skills, experience…" onChange={(e) => f.set("description")(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function CandidateDialog({ candidate, openings, today, onClose, onSaved }: { candidate: Candidate | null; openings: ReadonlyArray<JobOpening>; today: string; onClose: () => void; onSaved?: (c: Candidate) => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    openingId: candidate?.openingId ?? openings.find((o) => o.status === "open")?.id ?? openings[0]?.id ?? "",
    name: candidate?.name ?? "",
    email: candidate?.email ?? "",
    phone: candidate?.phone ?? "",
    source: candidate?.source ?? "Naukri",
    referredBy: candidate?.referredBy ?? "",
    appliedOn: candidate?.appliedOn ?? today,
    rating: candidate?.rating ? String(candidate.rating) : "",
    currentCtc: candidate?.currentCtc ? String(candidate.currentCtc) : "",
    expectedCtc: candidate?.expectedCtc ? String(candidate.expectedCtc) : "",
    noticeDays: candidate?.noticeDays !== null && candidate?.noticeDays !== undefined ? String(candidate.noticeDays) : "",
    resumeLink: candidate?.resumeLink ?? "",
    notes: candidate?.notes ?? "",
  }));
  const v = f.values;
  const submit = async () => {
    const input: CandidateInput = {
      openingId: v.openingId,
      name: v.name.trim(),
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
      source: v.source.trim() || "Direct",
      referredBy: v.referredBy.trim() || null,
      appliedOn: v.appliedOn,
      rating: num(v.rating),
      currentCtc: num(v.currentCtc),
      expectedCtc: num(v.expectedCtc),
      noticeDays: num(v.noticeDays),
      resumeLink: v.resumeLink.trim() || null,
      notes: v.notes.trim() || null,
    };
    const out = await run("candidate", () => (candidate ? bos.updateCandidate(candidate.id, input) : bos.createCandidate(input)), { success: candidate ? "Application updated" : "Candidate added", description: input.name });
    if (!out) return;
    onClose();
    onSaved?.(out.candidate);
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={candidate ? `Edit ${candidate.name}` : "Add a candidate"}
      description="New candidates start at Applied, ready for review."
      icon={{ tone: "blue", name: "user" }}
      submitLabel={candidate ? "Save" : "Add candidate"}
      busy={busy === "candidate"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Full name">{({ id }) => <Input id={id} required maxLength={160} value={v.name} onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <Field label="Applying for">
          {({ id }) => (
            <Select id={id} required value={v.openingId} onChange={(e) => f.set("openingId")(e.target.value)}>
              {openings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                  {o.status !== "open" ? ` (${openingBadge(o.status).text.toLowerCase()})` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Email">{({ id }) => <Input id={id} type="email" maxLength={180} value={v.email} onChange={(e) => f.set("email")(e.target.value)} />}</Field>
        <Field label="Phone">{({ id }) => <Input id={id} type="tel" maxLength={40} value={v.phone} onChange={(e) => f.set("phone")(e.target.value)} />}</Field>
        <Field label="Source">
          {({ id }) => (
            <>
              <Input id={id} list="bos-candidate-sources" required maxLength={40} value={v.source} onChange={(e) => f.set("source")(e.target.value)} />
              <datalist id="bos-candidate-sources">
                {CANDIDATE_SOURCES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        {v.source.trim().toLowerCase() === "referral" ? (
          <Field label="Referred by">{({ id }) => <Input id={id} maxLength={160} value={v.referredBy} placeholder="Employee or contact" onChange={(e) => f.set("referredBy")(e.target.value)} />}</Field>
        ) : null}
        <Field label="Applied on">{({ id }) => <Input id={id} type="date" required max={today} value={v.appliedOn} onChange={(e) => f.set("appliedOn")(e.target.value)} />}</Field>
        <Field label="Rating">
          {({ id }) => (
            <Select id={id} value={v.rating} onChange={(e) => f.set("rating")(e.target.value)}>
              <option value="">Not rated</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Current CTC (₹ a year)">{({ id }) => <Input id={id} type="number" min={0} step="1000" inputMode="numeric" value={v.currentCtc} onChange={(e) => f.set("currentCtc")(e.target.value)} />}</Field>
        <Field label="Expected CTC (₹ a year)">{({ id }) => <Input id={id} type="number" min={0} step="1000" inputMode="numeric" value={v.expectedCtc} onChange={(e) => f.set("expectedCtc")(e.target.value)} />}</Field>
        <Field label="Notice period (days)">{({ id }) => <Input id={id} type="number" min={0} max={365} step={1} value={v.noticeDays} onChange={(e) => f.set("noticeDays")(e.target.value)} />}</Field>
        <Field label="Résumé link" hint="Google Drive, Naukri profile, LinkedIn…">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="url" maxLength={500} value={v.resumeLink} placeholder="https://" onChange={(e) => f.set("resumeLink")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Notes">{({ id }) => <Textarea id={id} rows={2} maxLength={5000} value={v.notes} onChange={(e) => f.set("notes")(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function InterviewDialog({ candidate: c, today, onClose }: { candidate: Candidate; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ at: c.interviewAt ?? `${addDaysISO(today, 1)}T11:00`, mode: c.interviewMode ?? ("in_person" as InterviewMode), interviewer: c.interviewer ?? "", note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Interview · ${c.name}`}
      description={c.stage === "applied" ? "Scheduling moves the candidate to Interview." : undefined}
      icon={{ tone: "amber", name: "calendar" }}
      submitLabel="Schedule"
      busy={busy === "interview"}
      onSubmit={async () => {
        const out = await run("interview", () => bos.scheduleInterview(c.id, { at: v.at, mode: v.mode, interviewer: v.interviewer.trim() || null, note: v.note.trim() || null }), { success: "Interview scheduled", description: `${c.name} · ${whenLabel(v.at)}` });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Date & time">{({ id }) => <Input id={id} type="datetime-local" required min={`${c.appliedOn}T00:00`} value={v.at} onChange={(e) => f.set("at")(e.target.value)} />}</Field>
        <Field label="Mode">
          {({ id }) => (
            <Select id={id} value={v.mode} onChange={(e) => f.set("mode")(e.target.value as InterviewMode)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Interviewer">{({ id }) => <Input id={id} maxLength={160} value={v.interviewer} placeholder="Optional" onChange={(e) => f.set("interviewer")(e.target.value)} />}</Field>
        <Field label="Note">{({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

function OfferDialog({ candidate: c, opening, today, onClose }: { candidate: Candidate; opening: JobOpening; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    ctc: c.offerCtc ? String(c.offerCtc) : c.expectedCtc ? String(c.expectedCtc) : opening.salaryMax ? String(opening.salaryMax) : "",
    sentOn: c.offerSentOn ?? today,
    joiningDate: c.joiningDate ?? addDaysISO(today, Math.max(15, c.noticeDays ?? 30)),
    terms: c.offerTerms ?? "",
  }));
  const v = f.values;
  const ctc = Number(v.ctc) || 0;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${c.offerStatus === "sent" ? "Revise the offer" : "Make an offer"} · ${c.name}`}
      description="The candidate moves to Offer. Print the offer letter once they accept, or record their response here when they reply."
      icon={{ tone: "blue", name: "file" }}
      submitLabel={c.offerStatus === "sent" ? "Save offer" : "Send offer"}
      busy={busy === "offer"}
      onSubmit={async () => {
        const out = await run("offer", () => bos.sendOffer(c.id, { ctc, sentOn: v.sentOn, joiningDate: v.joiningDate, terms: v.terms.trim() || null }), { success: "Offer recorded", description: `${c.name} · ${inr(ctc)} a year` });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Annual CTC (₹)" hint={ctc ? `About ${inr(ctc / 12)} a month` : opening.salaryMin || opening.salaryMax ? `Role range ${salaryText(opening)}` : undefined}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" required min={1} step="1000" inputMode="numeric" value={v.ctc} onChange={(e) => f.set("ctc")(e.target.value)} />}
        </Field>
        <Field label="Offer date">{({ id }) => <Input id={id} type="date" required min={c.appliedOn} max={today} value={v.sentOn} onChange={(e) => f.set("sentOn")(e.target.value)} />}</Field>
        <Field label="Joining date">{({ id }) => <Input id={id} type="date" required min={v.sentOn} value={v.joiningDate} onChange={(e) => f.set("joiningDate")(e.target.value)} />}</Field>
      </FormGrid>
      <Field label="Terms for the letter" hint="Probation, working hours, benefits — printed on the offer letter">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={5000} value={v.terms} onChange={(e) => f.set("terms")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function ResponseDialog({ candidate: c, today, onClose }: { candidate: Candidate; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ response: "accepted" as "accepted" | "declined", date: today, joiningDate: c.joiningDate ?? today, note: "" }));
  const v = f.values;
  const accepted = v.response === "accepted";
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Offer response · ${c.name}`}
      description={accepted ? "Accepting hires the candidate and starts their onboarding checklist." : "Declining closes the application as withdrawn."}
      icon={{ tone: accepted ? "emerald" : "amber", name: accepted ? "check" : "alert" }}
      submitLabel={accepted ? "Record acceptance" : "Record decline"}
      busy={busy === "response"}
      onSubmit={async () => {
        const out = await run(
          "response",
          () => bos.offerResponse(c.id, { response: v.response, date: v.date, joiningDate: accepted ? v.joiningDate : undefined, note: v.note.trim() || null }),
          { success: accepted ? "Offer accepted — hired" : "Offer declined", description: c.name },
        );
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Response">
          {({ id }) => (
            <Select id={id} value={v.response} onChange={(e) => f.set("response")(e.target.value as "accepted" | "declined")}>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
            </Select>
          )}
        </Field>
        <Field label="Date">{({ id }) => <Input id={id} type="date" required min={c.offerSentOn ?? undefined} max={today} value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        {accepted ? <Field label="Joining date">{({ id }) => <Input id={id} type="date" required min={v.date} value={v.joiningDate} onChange={(e) => f.set("joiningDate")(e.target.value)} />}</Field> : null}
        <Field label={accepted ? "Note" : "Reason"}>{({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder={accepted ? "Optional" : "e.g. Took another offer"} onChange={(e) => f.set("note")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

function CloseDialog({ candidate: c, onClose }: { candidate: Candidate; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [stage, setStage] = useState<"rejected" | "withdrawn">("rejected");
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Close ${c.name}'s application`}
      description="The application stays on record and can be reopened later."
      icon={{ tone: "coral", name: "x" }}
      submitLabel={stage === "rejected" ? "Reject" : "Mark withdrawn"}
      busy={busy === "close"}
      onSubmit={async () => {
        const out = await run("close", () => bos.moveCandidate(c.id, stage, reason.trim()), { success: stage === "rejected" ? "Candidate rejected" : "Marked as withdrawn", description: c.name });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Outcome">
          {({ id }) => (
            <Select id={id} value={stage} onChange={(e) => setStage(e.target.value as "rejected" | "withdrawn")}>
              <option value="rejected">Rejected by us</option>
              <option value="withdrawn">Withdrawn by the candidate</option>
            </Select>
          )}
        </Field>
        <Field label="Reason">{({ id }) => <Input id={id} required maxLength={300} value={reason} placeholder="e.g. Not enough site experience" onChange={(e) => setReason(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

function NoteDialog({ candidate: c, onClose }: { candidate: Candidate; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Note · ${c.name}`}
      icon={{ tone: "blue", name: "edit" }}
      submitLabel="Add note"
      busy={busy === "note"}
      onSubmit={async () => {
        const out = await run("note", () => bos.candidateNote(c.id, note.trim()), { success: "Note added", description: c.name });
        if (out) onClose();
      }}
    >
      <Field label="Note">{({ id }) => <Textarea id={id} required rows={3} maxLength={500} value={note} placeholder="Interview feedback, call summary…" onChange={(e) => setNote(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function InductionDialog({ candidate: c, today, onClose }: { candidate: Candidate; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [date, setDate] = useState(c.onboarding.induction?.date ?? c.joiningDate ?? today);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Schedule induction · ${c.name}`}
      icon={{ tone: "blue", name: "calendar" }}
      submitLabel="Schedule"
      busy={busy === "induction"}
      onSubmit={async () => {
        const out = await run("induction", () => bos.updateOnboarding(c.id, { task: "induction", done: false, date }), { success: "Induction scheduled", description: `${c.name} · ${dateLabel(date)}` });
        if (out) onClose();
      }}
    >
      <Field label="Induction date">{({ id }) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function EmployeeDialog({ detail, departments, onClose }: { detail: CandidateDetail; departments: Departments; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const { candidate: c, opening } = detail;
  const f = useFormState(() => ({
    ...splitName(c.name),
    workEmail: "",
    phone: c.phone ?? "",
    designation: opening.title,
    departmentId: opening.departmentId ?? "",
    employmentType: opening.employmentType,
    status: "probation" as EmployeeStatus,
    joinDate: c.joiningDate ?? todayLocal(),
    location: opening.location ?? "",
    ctcAnnual: c.offerCtc ? String(c.offerCtc) : "",
  }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Create employee record · ${c.name}`}
      description="Adds them to HR → Employees with the next employee number. Personal and bank details can be completed on their profile."
      icon={{ tone: "emerald", name: "user" }}
      submitLabel="Create employee"
      busy={busy === "employee"}
      onSubmit={async () => {
        const out = await run(
          "employee",
          () =>
            bos.hireAsEmployee(c.id, {
              firstName: v.firstName.trim(),
              lastName: v.lastName.trim() || null,
              workEmail: v.workEmail.trim() || null,
              phone: v.phone.trim() || null,
              designation: v.designation.trim() || null,
              departmentId: v.departmentId || null,
              employmentType: v.employmentType,
              status: v.status,
              joinDate: v.joinDate,
              location: v.location.trim() || null,
              ctcAnnual: num(v.ctcAnnual),
              personal: { ...(c.email ? { personalEmail: c.email } : {}), ...(c.phone ? { mobile: c.phone } : {}) },
            }),
          { success: "Employee record created", description: c.name },
        );
        if (out) onClose();
      }}
      wide
    >
      <FormGrid>
        <Field label="First name">{({ id }) => <Input id={id} required maxLength={80} value={v.firstName} onChange={(e) => f.set("firstName")(e.target.value)} />}</Field>
        <Field label="Last name">{({ id }) => <Input id={id} maxLength={80} value={v.lastName} onChange={(e) => f.set("lastName")(e.target.value)} />}</Field>
        <Field label="Work email" hint="Links their JBT login to this record">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="email" maxLength={180} value={v.workEmail} placeholder="Optional" onChange={(e) => f.set("workEmail")(e.target.value)} />}
        </Field>
        <Field label="Phone">{({ id }) => <Input id={id} type="tel" maxLength={40} value={v.phone} onChange={(e) => f.set("phone")(e.target.value)} />}</Field>
        <Field label="Designation">{({ id }) => <Input id={id} maxLength={120} value={v.designation} onChange={(e) => f.set("designation")(e.target.value)} />}</Field>
        <Field label="Department">
          {({ id }) => (
            <Select id={id} value={v.departmentId} onChange={(e) => f.set("departmentId")(e.target.value)}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Employment type">
          {({ id }) => (
            <Select id={id} value={v.employmentType} onChange={(e) => f.set("employmentType")(e.target.value as EmploymentType)}>
              {(Object.keys(EMPLOYMENT_LABEL) as EmploymentType[]).map((k) => (
                <option key={k} value={k}>
                  {EMPLOYMENT_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={v.status} onChange={(e) => f.set("status")(e.target.value as EmployeeStatus)}>
              <option value="probation">Probation</option>
              <option value="active">Active</option>
            </Select>
          )}
        </Field>
        <Field label="Joining date">{({ id }) => <Input id={id} type="date" required value={v.joinDate} onChange={(e) => f.set("joinDate")(e.target.value)} />}</Field>
        <Field label="Location">{({ id }) => <Input id={id} maxLength={120} value={v.location} onChange={(e) => f.set("location")(e.target.value)} />}</Field>
        <Field label="Annual CTC (₹)">{({ id }) => <Input id={id} type="number" min={0} step="1000" inputMode="numeric" value={v.ctcAnnual} onChange={(e) => f.set("ctcAnnual")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}
