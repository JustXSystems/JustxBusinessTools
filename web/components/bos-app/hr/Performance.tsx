"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  ApprovalRow,
  BlockLabel,
  Button,
  Celebrations,
  Checkbox,
  DataTable,
  Field,
  FilterChip,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  Select,
  Switch,
  Textarea,
  WidgetCard,
  WidgetRow,
  type BosCelebration,
  type BosColumn,
  type BosPastel,
} from "@/components/bos";
import {
  bos,
  type BosCertificate,
  type BosKra,
  type BosPip,
  type BosPromotion,
  type KraStatus,
  type PerfEmployee,
  type PerformanceOverview,
  type ProgramInput,
  type ProgramTeam,
  type TrainingEnrollment,
} from "@/lib/bos-app/api";
import {
  addDaysISO,
  certificateBadge,
  dateLabel,
  dayMonth,
  durationLabel,
  enrollmentBadge,
  initialsOf,
  inr,
  kraBadge,
  KRA_LABEL,
  pipBadge,
  promotionBadge,
  TEAM_LABEL,
} from "@/lib/bos-app/format";
import { Loaded, ManagersOnly, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Tab = "all" | "performance" | "training" | "recognition" | "kras" | "certifications";
type Overview = PerformanceOverview;
type Program = Overview["programs"][number];
type Dialog =
  | { kind: "program"; program: Program | null }
  | { kind: "enroll"; programId?: string }
  | { kind: "complete"; enrollment: TrainingEnrollment }
  | { kind: "schedule"; enrollment: TrainingEnrollment }
  | { kind: "certificate"; certificate: BosCertificate | null }
  | { kind: "kra"; kra: BosKra | null }
  | { kind: "promotion" }
  | { kind: "decide"; promotion: BosPromotion }
  | { kind: "pip"; pip: BosPip | null }
  | { kind: "closePip"; pip: BosPip }
  | { kind: "award"; category?: string };
type Confirm = { title: string; description: string; label: string; key: string; run: () => Promise<unknown>; success: string; detail?: string };

const TEAMS: ReadonlyArray<{ team: ProgramTeam; icon: string; dot: BosPastel }> = [
  { team: "management", icon: "👔", dot: "lavender" },
  { team: "technical", icon: "🛠️", dot: "blue" },
  { team: "operations", icon: "🧰", dot: "sage" },
  { team: "all", icon: "🌐", dot: "mint" },
];
const KRA_STATUSES: ReadonlyArray<KraStatus> = ["on_track", "at_risk", "off_track", "achieved", "missed"];
const PASTELS: ReadonlyArray<string> = ["mint", "rose", "sage", "blue", "lavender"];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Last day of the financial year that starts on `fyStart`. */
const fyEnd = (fyStart: string) => addDaysISO(`${Number(fyStart.slice(0, 4)) + 1}${fyStart.slice(4)}`, -1);
const reviewText = (iso: string | null, today: string) => {
  if (!iso) return "No one on a plan";
  const d = daysUntil(iso, today);
  return d < 0 ? `Review overdue since ${dayMonth(iso)}` : d === 0 ? "Review due today" : `Review in ${plural(d, "day")}`;
};

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

/** HR → Performance & Learning: training, certificates, KRAs, promotions, improvement plans and recognition. Managers only. */
export function Performance() {
  const { canManage } = useBosApp();
  if (!canManage) return <ManagersOnly>Performance, training and recognition records are limited to owners and admins.</ManagersOnly>;
  return <PerformanceHome />;
}

function PerformanceHome() {
  const [tab, setTab] = useState<Tab>("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [printing, setPrinting] = useState<BosCertificate | null>(null);
  const { run, busy } = useBosAction();
  const state = useBosData(() => bos.performance(), []);
  const close = () => setDialog(null);

  return (
    <Loaded state={state}>
      {(o) => {
        if (printing) return <CertificatePaper certificate={printing} program={o.programs.find((p) => p.id === printing.programId) ?? null} onBack={() => setPrinting(null)} />;
        const ask = (c: Confirm) => setConfirm(c);
        const actions = (
          <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="primary" disabled={!o.programs.some((p) => !p.archived)} onClick={() => setDialog({ kind: "enroll" })}>
              Apply For Training
            </Button>
            <Button size="sm" onClick={() => setTab("training")}>
              Training Schedules
            </Button>
            <Button size="sm" onClick={() => setTab("certifications")}>
              ⬇ Training Certificate
            </Button>
          </div>
        );
        return (
          <Stack>
            <ModuleToolbar>
              <Segmented<Tab>
                size="sm"
                aria-label="Performance view"
                options={[
                  { value: "all", label: "All" },
                  { value: "performance", label: "Performance" },
                  { value: "training", label: "Training Programs" },
                  { value: "recognition", label: "Recognition" },
                  { value: "kras", label: "KRAs" },
                  { value: "certifications", label: "Certifications" },
                ]}
                value={tab}
                onChange={setTab}
              />
              <span className="bos-spacer" />
              <ToolbarActions tab={tab} o={o} open={setDialog} />
            </ModuleToolbar>

            {!o.employees.length ? (
              <Alert tone="blue" title="Add your team first">
                Training, KRAs, promotions and recognition are recorded against employees. Add them in HR → Employees, then come back here.
              </Alert>
            ) : null}
            {o.truncated ? <Alert tone="amber" title="Showing the latest 3,000 records">Older training, certificate or KRA records aren&apos;t counted here.</Alert> : null}

            {tab === "all" ? <AllTab o={o} open={setDialog} actions={actions} /> : null}
            {tab === "performance" ? <PromotionsTab o={o} open={setDialog} /> : null}
            {tab === "training" ? <TrainingTab o={o} open={setDialog} ask={ask} actions={actions} /> : null}
            {tab === "recognition" ? <RecognitionTab o={o} open={setDialog} ask={ask} /> : null}
            {tab === "kras" ? <KrasTab o={o} open={setDialog} /> : null}
            {tab === "certifications" ? <CertificatesTab o={o} open={setDialog} onPrint={setPrinting} /> : null}

            {dialog?.kind === "program" ? <ProgramDialog program={dialog.program} onClose={close} ask={ask} /> : null}
            {dialog?.kind === "enroll" ? <EnrollDialog o={o} programId={dialog.programId} onClose={close} /> : null}
            {dialog?.kind === "complete" ? <CompleteDialog o={o} enrollment={dialog.enrollment} onClose={close} /> : null}
            {dialog?.kind === "schedule" ? <ScheduleDialog o={o} enrollment={dialog.enrollment} onClose={close} /> : null}
            {dialog?.kind === "certificate" ? <CertificateDialog o={o} certificate={dialog.certificate} onClose={close} ask={ask} /> : null}
            {dialog?.kind === "kra" ? <KraDialog o={o} kra={dialog.kra} onClose={close} ask={ask} /> : null}
            {dialog?.kind === "promotion" ? <PromotionDialog o={o} onClose={close} /> : null}
            {dialog?.kind === "decide" ? <DecideDialog promotion={dialog.promotion} onClose={close} ask={ask} /> : null}
            {dialog?.kind === "pip" ? <PipDialog o={o} pip={dialog.pip} onClose={close} /> : null}
            {dialog?.kind === "closePip" ? <ClosePipDialog o={o} pip={dialog.pip} onClose={close} /> : null}
            {dialog?.kind === "award" ? <AwardDialog o={o} category={dialog.category} onClose={close} /> : null}
            {confirm ? (
              <ConfirmDialog
                open
                onClose={() => setConfirm(null)}
                destructive
                title={confirm.title}
                description={confirm.description}
                confirmLabel={confirm.label}
                busy={busy === confirm.key}
                onConfirm={async () => {
                  const done = await run(
                    confirm.key,
                    async () => {
                      await confirm.run();
                      return true;
                    },
                    { success: confirm.success, description: confirm.detail },
                  );
                  if (done) {
                    setConfirm(null);
                    close();
                  }
                }}
              />
            ) : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function ToolbarActions({ tab, o, open }: { tab: Tab; o: Overview; open: (d: Dialog) => void }) {
  const none = !o.employees.length;
  if (tab === "performance") {
    return (
      <>
        <Button size="sm" disabled={none} onClick={() => open({ kind: "pip", pip: null })}>
          Start PIP
        </Button>
        <Button size="sm" variant="primary" icon="plus" disabled={none} onClick={() => open({ kind: "promotion" })}>
          Propose promotion
        </Button>
      </>
    );
  }
  if (tab === "training" || tab === "all") {
    return (
      <Button size="sm" variant="primary" icon="plus" onClick={() => open({ kind: "program", program: null })}>
        Add program
      </Button>
    );
  }
  if (tab === "recognition") {
    return (
      <Button size="sm" variant="primary" icon="plus" disabled={none} onClick={() => open({ kind: "award" })}>
        Recognise someone
      </Button>
    );
  }
  if (tab === "kras") {
    return (
      <Button size="sm" variant="primary" icon="plus" disabled={none} onClick={() => open({ kind: "kra", kra: null })}>
        Set KRAs
      </Button>
    );
  }
  return (
    <Button size="sm" variant="primary" icon="plus" disabled={none} onClick={() => open({ kind: "certificate", certificate: null })}>
      Add certificate
    </Button>
  );
}

/* ---------- Tabs ---------- */

function headlineKpis(o: Overview) {
  const t = o.totals;
  return {
    promotions: <KpiCard key="promotions" label="Promotions Details" value={String(t.promotionsPending)} chip={{ color: "blue", glyph: "◈" }} delta={t.promotionsPending ? "Pending sign-off" : `${t.promotionsApproved} approved this year`} deltaTone="muted" />,
    pip: <KpiCard key="pip" label="On PIP" value={String(t.onPip)} chip={{ color: "rose", glyph: "!" }} delta={reviewText(t.nextPipReview, o.today)} deltaTone={t.onPip ? "down" : "muted"} />,
  };
}

function AllTab({ o, open, actions }: { o: Overview; open: (d: Dialog) => void; actions: ReactNode }) {
  const t = o.totals;
  const k = headlineKpis(o);
  const active = o.programs.filter((p) => !p.archived);
  return (
    <Stack>
      <Grid cols={4} min={140}>
        {k.promotions}
        <KpiCard label="Training Programs" value={String(t.programs)} chip={{ color: "mint", glyph: "🎓" }} delta="Company training catalog" deltaTone="muted" />
        <KpiCard
          label="Certifications"
          value={`${t.certifiedEmployees}/${t.headcount}`}
          chip={{ color: "lavender", glyph: "📜" }}
          delta={`${pct(t.certifiedEmployees, t.headcount)}% certified`}
          deltaTone={t.expired ? "warn" : "up"}
        />
        {k.pip}
      </Grid>
      <Grid cols={2} min={260}>
        <WidgetCard title="🎓 Training Programs" dot="mint" note={active.length > 6 ? `${active.length}` : undefined}>
          {active.length ? (
            active.slice(0, 6).map((p) => <WidgetRow key={p.id} label={p.title} value={durationLabel(p.durationDays)} valueTone="faint" onClick={() => open({ kind: "program", program: p })} />)
          ) : (
            <WidgetRow label={faint("No programs yet — add your training catalog")} />
          )}
        </WidgetCard>
        <WidgetCard title="🏆 Rewards & Recognition" dot="rose">
          {o.recognitions.length ? (
            o.recognitions.slice(0, 5).map((g) => <WidgetRow key={g.id} label={`🏆 ${g.category}`} value={g.employeeName} />)
          ) : (
            <WidgetRow label={faint("No recognitions yet")} />
          )}
        </WidgetCard>
      </Grid>
      {actions}
    </Stack>
  );
}

function PromotionsTab({ o, open }: { o: Overview; open: (d: Dialog) => void }) {
  const k = headlineKpis(o);
  const active = o.pips.filter((p) => p.status === "active");
  const past = o.pips.filter((p) => p.status !== "active");
  const columns: BosColumn<BosPromotion>[] = [
    { key: "emp", header: "Employee", cell: (r) => <Described title={r.employeeName} sub={r.reason ?? undefined} width={240} /> },
    { key: "cur", header: "Current Role", cell: (r) => <Described title={r.currentDesignation ?? "—"} sub={r.currentCtc ? inr(r.currentCtc) : undefined} width={200} /> },
    { key: "next", header: "Proposed Role", cell: (r) => <Described title={r.proposedDesignation} sub={r.proposedCtc ? inr(r.proposedCtc) : undefined} width={200} /> },
    { key: "from", header: "Effective", mono: true, cell: (r) => dateLabel(r.effectiveDate) },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="bos-row" style={{ gap: 6 }}>
          <StatusBadge view={promotionBadge(r.status)} />
          {r.status === "approved" && r.applied ? faint("Record updated") : null}
        </span>
      ),
    },
  ];
  const pastColumns: BosColumn<BosPip>[] = [
    { key: "emp", header: "Employee", cell: (p) => <Described title={p.employeeName} sub={p.reason} width={280} /> },
    { key: "start", header: "Started", mono: true, cell: (p) => dateLabel(p.startedOn) },
    { key: "closed", header: "Closed", mono: true, cell: (p) => dateLabel(p.closedOn) },
    { key: "status", header: "Outcome", cell: (p) => <StatusBadge view={pipBadge(p.status)} /> },
    { key: "note", header: "Note", cell: (p) => p.outcomeNote ?? faint() },
  ];
  return (
    <Stack>
      <Grid cols={2} min={200}>
        {k.promotions}
        {k.pip}
      </Grid>
      <DataTable
        caption="Promotion pipeline"
        columns={columns}
        rows={o.promotions}
        rowKey={(r) => r.id}
        onRowClick={(r) => (r.status === "pending" ? open({ kind: "decide", promotion: r }) : undefined)}
        empty="No promotions proposed yet."
      />
      <WidgetCard title="Performance Improvement Plan" dot="rose" note={active.length ? String(active.length) : undefined}>
        {active.length ? (
          active.map((p) => (
            <ApprovalRow
              key={p.id}
              avatar={<PersonAvatar name={p.employeeName} />}
              name={`${p.employeeName}${p.designation ? ` — ${p.designation}` : ""}`}
              meta={`${p.reason} · Review due ${dateLabel(p.reviewOn)}${daysUntil(p.reviewOn, o.today) < 0 ? " (overdue)" : ""}`}
              extra={
                <>
                  <StatusBadge view={pipBadge(p.status)} />
                  <Button size="sm" variant="ghost" onClick={() => open({ kind: "pip", pip: p })}>
                    Extend
                  </Button>
                  <Button size="sm" onClick={() => open({ kind: "closePip", pip: p })}>
                    Close plan
                  </Button>
                </>
              }
            />
          ))
        ) : (
          <WidgetRow label={faint("No one is on an improvement plan.")} />
        )}
      </WidgetCard>
      {past.length ? <DataTable caption="Past improvement plans" columns={pastColumns} rows={past} rowKey={(p) => p.id} compact /> : null}
    </Stack>
  );
}

function TrainingTab({ o, open, ask, actions }: { o: Overview; open: (d: Dialog) => void; ask: (c: Confirm) => void; actions: ReactNode }) {
  const t = o.totals;
  const [show, setShow] = useState<"enrolled" | "completed" | "all">("enrolled");
  const archived = o.programs.filter((p) => p.archived);
  const shown = o.enrollments.filter((n) => show === "all" || n.status === show).sort((a, b) => (show === "enrolled" ? (a.sessionDate ?? "9999").localeCompare(b.sessionDate ?? "9999") : 0));
  const columns: BosColumn<TrainingEnrollment>[] = [
    { key: "emp", header: "Employee", cell: (n) => <span style={{ fontWeight: 600 }}>{n.employeeName}</span> },
    { key: "program", header: "Program", cell: (n) => n.programTitle },
    { key: "session", header: "Session", mono: true, cell: (n) => (n.status === "completed" ? dateLabel(n.completedOn) : n.sessionDate ? dateLabel(n.sessionDate) : faint("To schedule")) },
    { key: "status", header: "Status", cell: (n) => <StatusBadge view={enrollmentBadge(n.status)} /> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (n) =>
        n.status === "enrolled" ? (
          <span className="bos-row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button size="sm" variant="ghost" onClick={() => ask({ title: `Cancel ${n.employeeName}'s enrollment?`, description: `${n.programTitle} — the enrollment stays on record as cancelled.`, label: "Cancel enrollment", key: `cancel-${n.id}`, run: () => bos.cancelEnrollment(n.id), success: "Enrollment cancelled", detail: n.employeeName })}>
              Cancel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => open({ kind: "schedule", enrollment: n })}>
              {n.sessionDate ? "Reschedule" : "Schedule"}
            </Button>
            <Button size="sm" onClick={() => open({ kind: "complete", enrollment: n })}>
              Mark complete
            </Button>
          </span>
        ) : null,
    },
  ];
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Total programs" value={String(t.programs)} chip={{ color: "mint", glyph: "🎓" }} delta="Company training catalog" deltaTone="muted" />
        <KpiCard label="Enrolled this quarter" value={String(t.enrolledQuarter)} chip={{ color: "blue", glyph: "👤" }} delta={`Since ${dayMonth(o.quarterStart)}`} deltaTone="muted" />
        <KpiCard label="Completed" value={String(t.completedQuarter)} chip={{ color: "mint", glyph: "✓" }} delta={t.enrolledQuarter ? `${pct(t.completedQuarter, t.enrolledQuarter)}% completion` : "Nothing enrolled this quarter"} deltaTone="muted" />
        <KpiCard label="Upcoming sessions" value={String(t.upcomingSessions)} chip={{ color: "lavender", glyph: "◷" }} delta="Next 30 days" deltaTone="muted" />
      </Grid>
      {o.programs.length ? (
        <Grid cols={3} min={240}>
          {TEAMS.map(({ team, icon, dot }) => {
            const list = o.programs.filter((p) => p.team === team && !p.archived);
            if (!list.length) return null;
            return (
              <WidgetCard key={team} title={`${icon} ${TEAM_LABEL[team]}`} dot={dot}>
                {list.map((p) => (
                  <WidgetRow key={p.id} label={`${p.title}${p.certificate ? " · CERTIFICATE" : ""}`} value={durationLabel(p.durationDays)} valueTone="faint" onClick={() => open({ kind: "program", program: p })} />
                ))}
              </WidgetCard>
            );
          })}
          {archived.length ? (
            <WidgetCard title="🗄️ Archived" dot="sage">
              {archived.map((p) => (
                <WidgetRow key={p.id} label={faint(p.title)} value={durationLabel(p.durationDays)} valueTone="faint" onClick={() => open({ kind: "program", program: p })} />
              ))}
            </WidgetCard>
          ) : null}
        </Grid>
      ) : (
        <Alert
          tone="blue"
          title="Build your training catalog"
          actions={
            <Button size="sm" variant="primary" icon="plus" onClick={() => open({ kind: "program", program: null })}>
              Add program
            </Button>
          }
        >
          Add each program with its team, length and whether it earns a certificate — for example Solar EPC, BESS, safety or leadership. Then enroll people, schedule sessions and mark them complete; BOS issues and tracks the certificates.
        </Alert>
      )}
      <div className="bos-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Segmented<typeof show>
          size="sm"
          aria-label="Show enrollments"
          options={[
            { value: "enrolled", label: "Upcoming" },
            { value: "completed", label: "Completed" },
            { value: "all", label: "All" },
          ]}
          value={show}
          onChange={setShow}
        />
      </div>
      <DataTable caption="Training schedule" columns={columns} rows={shown} rowKey={(n) => n.id} empty={show === "enrolled" ? "No one is waiting for training." : "No training records yet."} />
      {actions}
    </Stack>
  );
}

function RecognitionTab({ o, open, ask }: { o: Overview; open: (d: Dialog) => void; ask: (c: Confirm) => void }) {
  const month = o.today.slice(0, 7);
  const byPerson = new Map<string, { name: string; tags: string[] }>();
  for (const g of o.recognitions.filter((x) => x.awardedOn.slice(0, 7) === month)) {
    const p = byPerson.get(g.employeeId) ?? { name: g.employeeName, tags: [] };
    p.tags.push(g.category);
    byPerson.set(g.employeeId, p);
  }
  const celebrations: BosCelebration[] = [...byPerson.values()].map((p, i) => {
    const pastel = PASTELS[i % PASTELS.length];
    return {
      initials: initialsOf(p.name),
      name: p.name,
      tag: `${p.tags[0].toUpperCase()}${p.tags.length > 1 ? ` +${p.tags.length - 1}` : ""}`,
      tint: ["blue", "emerald", "amber"][i % 3],
      avatar: { fill: `var(--bos-pastel-${pastel})`, ink: `var(--bos-pastel-${pastel}-ink)` },
    };
  });
  const columns: BosColumn<Overview["recognitions"][number]>[] = [
    { key: "date", header: "Date", mono: true, cell: (g) => dateLabel(g.awardedOn) },
    { key: "emp", header: "Employee", cell: (g) => <span style={{ fontWeight: 600 }}>{g.employeeName}</span> },
    { key: "award", header: "Recognition", cell: (g) => `🏆 ${g.category}` },
    { key: "note", header: "Why", cell: (g) => g.note ?? faint() },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (g) => (
        <Button size="sm" variant="ghost" onClick={() => ask({ title: `Remove ${g.employeeName}'s recognition?`, description: g.category, label: "Remove", key: `award-${g.id}`, run: () => bos.deleteRecognition(g.id), success: "Recognition removed", detail: g.employeeName })}>
          Remove
        </Button>
      ),
    },
  ];
  return (
    <Stack>
      <div>
        <BlockLabel>Recognition categories</BlockLabel>
        <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Recognition categories">
          {o.categories.map((c) => (
            <FilterChip key={c} disabled={!o.employees.length} onClick={() => open({ kind: "award", category: c })}>
              {c}
            </FilterChip>
          ))}
        </div>
      </div>
      <div>
        <BlockLabel>Recent recognitions</BlockLabel>
        {celebrations.length ? <Celebrations items={celebrations} label="🏆 This Month" /> : <p className="bos-text-faint" style={{ margin: 0, fontSize: 13 }}>No one recognised this month yet — pick a category above.</p>}
      </div>
      <DataTable caption="All recognitions" columns={columns} rows={o.recognitions} rowKey={(g) => g.id} compact empty="No recognitions yet." />
    </Stack>
  );
}

function KrasTab({ o, open }: { o: Overview; open: (d: Dialog) => void }) {
  const t = o.totals;
  const [scope, setScope] = useState<"current" | "all">("current");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = o.kras.filter((k) => (scope === "all" || (k.periodStart <= o.today && o.today <= k.periodEnd)) && (!q || `${k.employeeName} ${k.title}`.toLowerCase().includes(q)));
  const columns: BosColumn<BosKra>[] = [
    { key: "emp", header: "Employee", cell: (k) => <Described title={k.employeeName} sub={k.designation ?? undefined} width={220} /> },
    { key: "kra", header: "KRA", cell: (k) => <Described title={k.title} sub={k.note ?? undefined} width={320} /> },
    { key: "target", header: "Target", mono: true, cell: (k) => k.target ?? faint() },
    { key: "period", header: "Period", mono: true, cell: (k) => `${dayMonth(k.periodStart)} – ${dateLabel(k.periodEnd)}` },
    {
      key: "progress",
      header: "Progress",
      cell: (k) => (
        <span className="bos-row" style={{ gap: 6 }}>
          <StatusBadge view={kraBadge(k.status)} />
          {k.progress !== null ? faint(`${k.progress}%`) : null}
        </span>
      ),
    },
  ];
  const share = (n: number) => `${pct(n, t.kras.current)}%`;
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="KRAs set" value={String(t.krasSet)} chip={{ color: "blue", glyph: "🎯" }} delta={`${pct(t.krasSet, t.headcount)}% of headcount`} deltaTone={t.krasSet < t.headcount ? "warn" : "up"} />
        <KpiCard label="On track" value={String(t.kras.onTrack)} chip={{ color: "mint", glyph: "✓" }} delta={share(t.kras.onTrack)} deltaTone="up" />
        <KpiCard label="At risk" value={String(t.kras.atRisk)} chip={{ color: "amber", glyph: "◐" }} delta={share(t.kras.atRisk)} deltaTone={t.kras.atRisk ? "warn" : "muted"} />
        <KpiCard label="Off track" value={String(t.kras.offTrack)} chip={{ color: "rose", glyph: "!" }} delta={share(t.kras.offTrack)} deltaTone={t.kras.offTrack ? "down" : "muted"} />
      </Grid>
      <div className="bos-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Segmented<typeof scope>
          size="sm"
          aria-label="Show KRAs"
          options={[
            { value: "current", label: "Current" },
            { value: "all", label: "All periods" },
          ]}
          value={scope}
          onChange={setScope}
        />
        <SearchInput placeholder="Search employee or KRA…" aria-label="Search KRAs" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <DataTable caption="Key result areas" columns={columns} rows={shown} rowKey={(k) => k.id} onRowClick={(k) => open({ kind: "kra", kra: k })} empty={scope === "current" ? "No KRAs for the current period." : "No KRAs yet."} />
    </Stack>
  );
}

function CertificatesTab({ o, open, onPrint }: { o: Overview; open: (d: Dialog) => void; onPrint: (c: BosCertificate) => void }) {
  const t = o.totals;
  const [show, setShow] = useState<"all" | "attention">("all");
  const shown = o.certificates.filter((c) => show === "all" || c.status !== "valid");
  const columns: BosColumn<BosCertificate>[] = [
    { key: "emp", header: "Employee", cell: (c) => <span style={{ fontWeight: 600 }}>{c.employeeName}</span> },
    { key: "cert", header: "Certification", cell: (c) => <Described title={c.name} sub={c.certNo ?? ([c.issuer, c.credentialNo].filter(Boolean).join(" · ") || undefined)} width={280} /> },
    { key: "issued", header: "Issued", mono: true, cell: (c) => dateLabel(c.issuedOn) },
    { key: "until", header: "Valid until", mono: true, cell: (c) => (c.expiresOn ? dateLabel(c.expiresOn) : faint("No expiry")) },
    { key: "status", header: "Status", cell: (c) => <StatusBadge view={certificateBadge(c.status)} /> },
    {
      key: "dl",
      header: "",
      align: "right",
      cell: (c) =>
        c.enrollmentId ? (
          <Button size="sm" variant="ghost" onClick={() => onPrint(c)}>
            ⬇ Download
          </Button>
        ) : c.link ? (
          <a className="bos-link" href={c.link} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
            Open ↗
          </a>
        ) : null,
    },
  ];
  return (
    <Stack>
      <Grid cols={4} min={140}>
        <KpiCard label="Certified employees" value={`${t.certifiedEmployees}/${t.headcount}`} chip={{ color: "mint", glyph: "✓" }} delta={`${pct(t.certifiedEmployees, t.headcount)}%`} deltaTone="up" />
        <KpiCard
          label="Mandatory certified"
          value={t.mandatoryPrograms ? `${t.mandatoryCompliant}/${t.headcount}` : "—"}
          chip={{ color: "blue", glyph: "🦺" }}
          delta={t.mandatoryPrograms ? `${plural(t.mandatoryPrograms, "mandatory certificate")}` : "No mandatory programs"}
          deltaTone={t.mandatoryPrograms && t.mandatoryCompliant < t.headcount ? "warn" : "muted"}
        />
        <KpiCard label="Expiring in 30 days" value={String(t.expiringSoon)} chip={{ color: "amber", glyph: "◷" }} delta={t.expired ? `${t.expired} already expired` : t.expiringSoon ? "Renewal needed" : "Nothing due"} deltaTone={t.expiringSoon || t.expired ? "warn" : "muted"} />
        <KpiCard label="Certificates issued (FY)" value={String(t.issuedFy)} chip={{ color: "lavender", glyph: "📜" }} delta="Across all programs" deltaTone="muted" />
      </Grid>
      <Segmented<typeof show>
        size="sm"
        aria-label="Show certificates"
        options={[
          { value: "all", label: "All" },
          { value: "attention", label: `Expiring or expired · ${t.expiringSoon + t.expired}` },
        ]}
        value={show}
        onChange={setShow}
      />
      <DataTable caption="Certifications" columns={columns} rows={shown} rowKey={(c) => c.id} onRowClick={(c) => open({ kind: "certificate", certificate: c })} empty="No certificates yet — they're issued when someone completes a certified program." />
    </Stack>
  );
}

/* ---------- Printable certificate ---------- */

function CertificatePaper({ certificate: c, program, onBack }: { certificate: BosCertificate; program: Program | null; onBack: () => void }) {
  const print = usePrint();
  const { session } = useBosApp();
  const company = session.brand?.name || session.settings.companyName || "Our company";
  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={onBack}>
          ‹ Back to certifications
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" onClick={print}>
            Print / PDF
          </Button>
        </div>
      </div>
      <div className="bos-payslip-wrap">
        <article className="bos-inv-paper bos-certificate" aria-label="Training certificate">
          <div className="bos-certificate-company">{company}</div>
          <div className="bos-certificate-title">Certificate of Completion</div>
          <p>This certifies that</p>
          <div className="bos-certificate-name">{c.employeeName}</div>
          <p>
            has successfully completed <strong>{c.name}</strong>
            {program?.durationDays ? ` (${durationLabel(program.durationDays).toLowerCase()})` : ""} on <strong>{dateLabel(c.issuedOn)}</strong>.
          </p>
          <div className="bos-certificate-meta">
            <span>Certificate no. {c.certNo ?? "—"}</span>
            <span>Employee {c.employeeCode}</span>
            <span>{c.expiresOn ? `Valid until ${dateLabel(c.expiresOn)}` : "Does not expire"}</span>
          </div>
          <div className="bos-offer-sign">
            <div>
              <div className="bos-offer-sign-line" />
              For {company}
              <br />
              Authorised signatory
            </div>
            <div>
              <div className="bos-offer-sign-line" />
              Trainer
            </div>
          </div>
          <div className="bos-payslip-note">Generated with Justx BOS.</div>
        </article>
      </div>
    </>
  );
}

/* ---------- Pickers ---------- */

function EmployeeSelect({ employees, value, onChange, id, describedBy }: { employees: ReadonlyArray<PerfEmployee>; value: string; onChange: (id: string) => void; id: string; describedBy?: string }) {
  return (
    <Select id={id} aria-describedby={describedBy} required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick an employee</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
          {e.designation ? ` — ${e.designation}` : ""}
        </option>
      ))}
    </Select>
  );
}

function EmployeePicker({ employees, value, onChange, label }: { employees: ReadonlyArray<PerfEmployee>; value: ReadonlyArray<string>; onChange: (ids: string[]) => void; label: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = employees.filter((e) => !q || `${e.name} ${e.designation ?? ""} ${e.departmentName ?? ""}`.toLowerCase().includes(q));
  const all = shown.length > 0 && shown.every((e) => value.includes(e.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="bos-field bos-form-grid-full">
      <span className="bos-field-label">
        {label} · {value.length} selected
      </span>
      <div className="bos-row" style={{ gap: 8, marginBottom: 6 }}>
        <SearchInput placeholder="Filter by name, role or department" aria-label={`Filter ${label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={() => onChange(all ? value.filter((id) => !shown.some((e) => e.id === id)) : [...new Set([...value, ...shown.map((e) => e.id)])])}>
          {all ? "Clear" : "Select all"}
        </Button>
      </div>
      <div className="bos-pick-list" role="group" aria-label={label}>
        {shown.map((e) => (
          <label key={e.id} className="bos-pick-row">
            <Checkbox checked={value.includes(e.id)} onChange={() => toggle(e.id)} aria-label={e.name} />
            <span style={{ fontWeight: 600 }}>{e.name}</span>
            <span className="bos-text-faint">{[e.designation, e.departmentName].filter(Boolean).join(" · ")}</span>
          </label>
        ))}
        {!shown.length ? <span className="bos-text-faint">No one matches.</span> : null}
      </div>
    </div>
  );
}

/* ---------- Dialogs ---------- */

function ProgramDialog({ program, onClose, ask }: { program: Program | null; onClose: () => void; ask: (c: Confirm) => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    title: program?.title ?? "",
    team: program?.team ?? ("all" as ProgramTeam),
    durationDays: program?.durationDays ? String(program.durationDays) : "",
    certificate: program?.certificate ?? false,
    validityMonths: program?.validityMonths ? String(program.validityMonths) : "",
    mandatory: program?.mandatory ?? false,
    description: program?.description ?? "",
  }));
  const v = f.values;
  const submit = async () => {
    const input: ProgramInput = {
      title: v.title.trim(),
      team: v.team,
      durationDays: num(v.durationDays),
      certificate: v.certificate,
      validityMonths: v.certificate ? num(v.validityMonths) : null,
      mandatory: v.mandatory,
      description: v.description.trim() || null,
    };
    const out = await run("program", () => (program ? bos.updateProgram(program.id, input) : bos.createProgram(input)), { success: program ? "Program updated" : "Program added", description: input.title });
    if (out) onClose();
  };
  const used = program ? program.enrolled + program.completed > 0 : false;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={program ? `Edit ${program.title}` : "Add a training program"}
      description="A course in your training catalog. Programs that earn a certificate issue one to each person who completes them."
      icon={{ tone: "emerald", glyph: "🎓" }}
      submitLabel={program ? "Save" : "Add program"}
      busy={busy === "program"}
      onSubmit={submit}
      wide
      note={
        program ? (
          <span className="bos-row" style={{ gap: 6 }}>
            {!used ? (
              <Button size="sm" variant="ghost" onClick={() => ask({ title: `Delete ${program.title}?`, description: "No one has enrolled, so it's removed completely.", label: "Delete", key: "delete-program", run: () => bos.deleteProgram(program.id), success: "Program deleted", detail: program.title })}>
                Delete
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={async () => {
                const out = await run("archive", () => bos.updateProgram(program.id, { archived: !program.archived }), { success: program.archived ? "Program restored" : "Program archived", description: program.title });
                if (out) onClose();
              }}
            >
              {program.archived ? "Restore" : "Archive"}
            </Button>
          </span>
        ) : undefined
      }
    >
      <FormGrid>
        <Field label="Program" full>
          {({ id }) => <Input id={id} required maxLength={160} value={v.title} placeholder="e.g. Solar EPC Training" onChange={(e) => f.set("title")(e.target.value)} />}
        </Field>
        <Field label="Team">
          {({ id }) => (
            <Select id={id} value={v.team} onChange={(e) => f.set("team")(e.target.value as ProgramTeam)}>
              {TEAMS.map((t) => (
                <option key={t.team} value={t.team}>
                  {TEAM_LABEL[t.team]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Length (days)" hint="Leave empty for ongoing sessions">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0.5} max={365} step={0.5} value={v.durationDays} onChange={(e) => f.set("durationDays")(e.target.value)} />}
        </Field>
        <Field label="Earns a certificate">{({ id }) => <Switch id={id} checked={v.certificate} onChange={(c) => f.set("certificate")(c)} aria-label="Earns a certificate" />}</Field>
        {v.certificate ? (
          <Field label="Valid for (months)" hint="Leave empty if it doesn't expire">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={120} step={1} value={v.validityMonths} onChange={(e) => f.set("validityMonths")(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="Mandatory for everyone" hint={v.certificate ? "Counted in the mandatory-certified figure" : "Tracked once the program earns a certificate"}>
          {({ id }) => <Switch id={id} checked={v.mandatory} onChange={(c) => f.set("mandatory")(c)} aria-label="Mandatory for everyone" />}
        </Field>
      </FormGrid>
      <Field label="Description">{({ id }) => <Textarea id={id} rows={3} maxLength={5000} value={v.description} placeholder="What it covers, who runs it…" onChange={(e) => f.set("description")(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function EnrollDialog({ o, programId, onClose }: { o: Overview; programId?: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const active = o.programs.filter((p) => !p.archived);
  const f = useFormState(() => ({ programId: programId ?? active[0]?.id ?? "", employeeIds: [] as string[], sessionDate: "", note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Apply for training"
      description="Enroll people in a program. Anyone already waiting for the same program is skipped."
      icon={{ tone: "blue", glyph: "🎓" }}
      submitLabel={v.employeeIds.length === 1 ? "Enroll 1 person" : v.employeeIds.length ? `Enroll ${v.employeeIds.length} people` : "Enroll"}
      busy={busy === "enroll"}
      onSubmit={async () => {
        const out = await run("enroll", () => bos.enroll({ programId: v.programId, employeeIds: v.employeeIds, sessionDate: v.sessionDate || null, note: v.note.trim() || null }), {
          success: "Enrolled",
          description: active.find((p) => p.id === v.programId)?.title,
        });
        if (out) onClose();
      }}
      wide
    >
      <FormGrid>
        <Field label="Program">
          {({ id }) => (
            <Select id={id} required value={v.programId} onChange={(e) => f.set("programId")(e.target.value)}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {durationLabel(p.durationDays)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Session date" hint="Optional — schedule it later">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" value={v.sessionDate} onChange={(e) => f.set("sessionDate")(e.target.value)} />}
        </Field>
        <EmployeePicker employees={o.employees} value={v.employeeIds} onChange={f.set("employeeIds")} label="People" />
        <Field label="Note" full>
          {({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional — venue, trainer…" onChange={(e) => f.set("note")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function CompleteDialog({ o, enrollment: n, onClose }: { o: Overview; enrollment: TrainingEnrollment; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const program = o.programs.find((p) => p.id === n.programId);
  const [date, setDate] = useState(n.sessionDate && n.sessionDate <= o.today && n.sessionDate >= n.enrolledOn ? n.sessionDate : o.today);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${n.employeeName} completed ${n.programTitle}`}
      description={
        program?.certificate
          ? `BOS issues a certificate dated the completion day${program.validityMonths ? `, valid for ${plural(program.validityMonths, "month")}` : ""}.`
          : "This program doesn't earn a certificate."
      }
      icon={{ tone: "emerald", name: "check" }}
      submitLabel="Mark complete"
      busy={busy === "complete"}
      onSubmit={async () => {
        const out = await run("complete", () => bos.completeEnrollment(n.id, date), { success: program?.certificate ? "Completed — certificate issued" : "Training completed", description: n.employeeName });
        if (out) onClose();
      }}
    >
      <Field label="Completed on">{({ id }) => <Input id={id} type="date" required min={n.enrolledOn} max={o.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function ScheduleDialog({ o, enrollment: n, onClose }: { o: Overview; enrollment: TrainingEnrollment; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [date, setDate] = useState(n.sessionDate ?? "");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Schedule ${n.employeeName}`}
      description={n.programTitle}
      icon={{ tone: "blue", name: "calendar" }}
      submitLabel={date ? "Save" : "Clear date"}
      busy={busy === "schedule"}
      onSubmit={async () => {
        const out = await run("schedule", () => bos.rescheduleEnrollment(n.id, date || null), { success: date ? `Scheduled for ${dateLabel(date)}` : "Session date cleared", description: n.employeeName });
        if (out) onClose();
      }}
    >
      <Field label="Session date" hint={`Today is ${dateLabel(o.today)}`}>
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function CertificateDialog({ o, certificate: c, onClose, ask }: { o: Overview; certificate: BosCertificate | null; onClose: () => void; ask: (c: Confirm) => void }) {
  const { run, busy } = useBosAction();
  const issued = Boolean(c?.enrollmentId);
  const f = useFormState(() => ({
    employeeId: c?.employeeId ?? "",
    name: c?.name ?? "",
    issuer: c?.issuer ?? "",
    credentialNo: c?.credentialNo ?? "",
    link: c?.link ?? "",
    issuedOn: c?.issuedOn ?? o.today,
    expiresOn: c?.expiresOn ?? "",
  }));
  const v = f.values;
  const submit = async () => {
    const dates = { issuedOn: v.issuedOn, expiresOn: v.expiresOn || null };
    const details = { name: v.name.trim(), issuer: v.issuer.trim() || null, credentialNo: v.credentialNo.trim() || null, link: v.link.trim() || null };
    const out = await run(
      "certificate",
      () => (c ? bos.updateCertificate(c.id, issued ? { ...dates, credentialNo: details.credentialNo, link: details.link } : { ...details, ...dates }) : bos.createCertificate({ employeeId: v.employeeId, ...details, ...dates })),
      { success: c ? "Certificate updated" : "Certificate added", description: details.name },
    );
    if (out) onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={c ? `${c.employeeName} · ${c.name}` : "Add a certificate"}
      description={issued ? `Issued by BOS (${c?.certNo ?? ""}) when the training was completed. Renew it by moving the dates.` : "A certificate from an outside body — safety, electrical licence, OEM training and so on."}
      icon={{ tone: "blue", glyph: "📜" }}
      submitLabel={c ? "Save" : "Add certificate"}
      busy={busy === "certificate"}
      onSubmit={submit}
      wide
      note={
        c ? (
          <Button size="sm" variant="ghost" onClick={() => ask({ title: `Delete ${c.employeeName}'s certificate?`, description: c.name, label: "Delete", key: "delete-cert", run: () => bos.deleteCertificate(c.id), success: "Certificate deleted", detail: c.name })}>
            Delete
          </Button>
        ) : undefined
      }
    >
      <FormGrid>
        {!c ? <Field label="Employee">{({ id }) => <EmployeeSelect id={id} employees={o.employees} value={v.employeeId} onChange={f.set("employeeId")} />}</Field> : null}
        <Field label="Certification">{({ id }) => <Input id={id} required disabled={issued} maxLength={160} value={v.name} placeholder="e.g. Working at Height" onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        {!issued ? <Field label="Issued by">{({ id }) => <Input id={id} maxLength={160} value={v.issuer} placeholder="Optional" onChange={(e) => f.set("issuer")(e.target.value)} />}</Field> : null}
        <Field label="Credential no.">{({ id }) => <Input id={id} maxLength={80} value={v.credentialNo} placeholder="Optional" onChange={(e) => f.set("credentialNo")(e.target.value)} />}</Field>
        <Field label="Issued on">{({ id }) => <Input id={id} type="date" required max={o.today} value={v.issuedOn} onChange={(e) => f.set("issuedOn")(e.target.value)} />}</Field>
        <Field label="Valid until" hint="Leave empty if it doesn't expire">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="date" min={v.issuedOn} value={v.expiresOn} onChange={(e) => f.set("expiresOn")(e.target.value)} />}
        </Field>
        <Field label="Link" full>
          {({ id }) => <Input id={id} type="url" maxLength={500} value={v.link} placeholder="Optional — https://…" onChange={(e) => f.set("link")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function KraDialog({ o, kra: k, onClose, ask }: { o: Overview; kra: BosKra | null; onClose: () => void; ask: (c: Confirm) => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    employeeIds: [] as string[],
    title: k?.title ?? "",
    target: k?.target ?? "",
    weight: k?.weight ? String(k.weight) : "",
    periodStart: k?.periodStart ?? o.fyStart,
    periodEnd: k?.periodEnd ?? fyEnd(o.fyStart),
    status: k?.status ?? ("on_track" as KraStatus),
    progress: k?.progress !== null && k?.progress !== undefined ? String(k.progress) : "",
    note: k?.note ?? "",
  }));
  const v = f.values;
  const submit = async () => {
    const base = { title: v.title.trim(), target: v.target.trim() || null, weight: num(v.weight), periodStart: v.periodStart, periodEnd: v.periodEnd };
    const out = await run<unknown>(
      "kra",
      () => (k ? bos.updateKra(k.id, { ...base, status: v.status, progress: num(v.progress), note: v.note.trim() || null }) : bos.createKras({ ...base, employeeIds: v.employeeIds })),
      { success: k ? "KRA updated" : v.employeeIds.length > 1 ? `KRA set for ${v.employeeIds.length} people` : "KRA set", description: base.title },
    );
    if (out) onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={k ? `${k.employeeName} · KRA` : "Set KRAs"}
      description={k ? "Review progress against the target. The review date is recorded." : "Give one or more people the same key result area for a period — the financial year by default."}
      icon={{ tone: "blue", glyph: "🎯" }}
      submitLabel={k ? "Save" : "Set KRA"}
      busy={busy === "kra"}
      onSubmit={submit}
      wide
      note={
        k ? (
          <Button size="sm" variant="ghost" onClick={() => ask({ title: `Remove ${k.employeeName}'s KRA?`, description: k.title, label: "Remove", key: "delete-kra", run: () => bos.deleteKra(k.id), success: "KRA removed", detail: k.title })}>
            Remove
          </Button>
        ) : undefined
      }
    >
      <FormGrid>
        <Field label="KRA" full>
          {({ id }) => <Input id={id} required maxLength={200} value={v.title} placeholder="e.g. Field project delivery SLA" onChange={(e) => f.set("title")(e.target.value)} />}
        </Field>
        <Field label="Target">{({ id }) => <Input id={id} maxLength={80} value={v.target} placeholder="e.g. 95% or ₹40L" onChange={(e) => f.set("target")(e.target.value)} />}</Field>
        <Field label="Weight (%)">{({ id }) => <Input id={id} type="number" min={1} max={100} step={1} value={v.weight} placeholder="Optional" onChange={(e) => f.set("weight")(e.target.value)} />}</Field>
        <Field label="From">{({ id }) => <Input id={id} type="date" required value={v.periodStart} onChange={(e) => f.set("periodStart")(e.target.value)} />}</Field>
        <Field label="To">{({ id }) => <Input id={id} type="date" required min={v.periodStart} value={v.periodEnd} onChange={(e) => f.set("periodEnd")(e.target.value)} />}</Field>
        {k ? (
          <>
            <Field label="Status">
              {({ id }) => (
                <Select id={id} value={v.status} onChange={(e) => f.set("status")(e.target.value as KraStatus)}>
                  {KRA_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {KRA_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Progress (%)">{({ id }) => <Input id={id} type="number" min={0} max={100} step={1} value={v.progress} placeholder="Optional" onChange={(e) => f.set("progress")(e.target.value)} />}</Field>
            <Field label="Review note" full>
              {({ id }) => <Input id={id} maxLength={500} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}
            </Field>
          </>
        ) : (
          <EmployeePicker employees={o.employees} value={v.employeeIds} onChange={f.set("employeeIds")} label="Employees" />
        )}
      </FormGrid>
    </FormDialog>
  );
}

function PromotionDialog({ o, onClose }: { o: Overview; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ employeeId: "", proposedDesignation: "", proposedCtc: "", effectiveDate: o.today, reason: "" }));
  const v = f.values;
  const person = o.employees.find((e) => e.id === v.employeeId);
  const ctc = num(v.proposedCtc);
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Propose a promotion"
      description="It waits for sign-off. Approving it can update the employee's designation and CTC."
      icon={{ tone: "blue", glyph: "◈" }}
      submitLabel="Propose"
      busy={busy === "promotion"}
      onSubmit={async () => {
        const out = await run(
          "promotion",
          () => bos.proposePromotion({ employeeId: v.employeeId, proposedDesignation: v.proposedDesignation.trim(), proposedCtc: ctc, effectiveDate: v.effectiveDate, reason: v.reason.trim() || null }),
          { success: "Promotion proposed", description: person?.name },
        );
        if (out) onClose();
      }}
      wide
    >
      <FormGrid>
        <Field label="Employee" hint={person ? `Now ${person.designation ?? "no designation"}${person.ctcAnnual ? ` · ${inr(person.ctcAnnual)} a year` : ""}` : undefined}>
          {({ id, describedBy }) => <EmployeeSelect id={id} describedBy={describedBy} employees={o.employees} value={v.employeeId} onChange={f.set("employeeId")} />}
        </Field>
        <Field label="Effective from">{({ id }) => <Input id={id} type="date" required value={v.effectiveDate} onChange={(e) => f.set("effectiveDate")(e.target.value)} />}</Field>
        <Field label="Proposed designation">{({ id }) => <Input id={id} required maxLength={120} value={v.proposedDesignation} placeholder="e.g. Senior Technician" onChange={(e) => f.set("proposedDesignation")(e.target.value)} />}</Field>
        <Field label="New CTC (₹ a year)" hint={ctc ? `About ${inr(ctc / 12)} a month` : "Optional"}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1000" inputMode="numeric" value={v.proposedCtc} onChange={(e) => f.set("proposedCtc")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Why">{({ id }) => <Textarea id={id} rows={3} maxLength={2000} value={v.reason} placeholder="Achievements, KRAs met, feedback…" onChange={(e) => f.set("reason")(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function DecideDialog({ promotion: r, onClose, ask }: { promotion: BosPromotion; onClose: () => void; ask: (c: Confirm) => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ decision: "approved" as "approved" | "rejected", apply: true, note: "" }));
  const v = f.values;
  const approving = v.decision === "approved";
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${r.employeeName} → ${r.proposedDesignation}`}
      description={`${r.currentDesignation ?? "No designation"}${r.currentCtc ? ` · ${inr(r.currentCtc)}` : ""} → ${r.proposedDesignation}${r.proposedCtc ? ` · ${inr(r.proposedCtc)}` : ""}, from ${dateLabel(r.effectiveDate)}.${r.reason ? ` ${r.reason}` : ""}`}
      icon={{ tone: approving ? "emerald" : "amber", name: approving ? "check" : "alert" }}
      submitLabel={approving ? "Approve" : "Turn down"}
      busy={busy === "decide"}
      onSubmit={async () => {
        const out = await run("decide", () => bos.decidePromotion(r.id, { decision: v.decision, apply: approving && v.apply, note: v.note.trim() || null }), {
          success: approving ? (v.apply ? "Approved — employee record updated" : "Promotion approved") : "Promotion turned down",
          description: r.employeeName,
        });
        if (out) onClose();
      }}
      note={
        <Button size="sm" variant="ghost" onClick={() => ask({ title: `Withdraw ${r.employeeName}'s promotion?`, description: "It hasn't been decided, so it's removed.", label: "Withdraw", key: "withdraw-promotion", run: () => bos.withdrawPromotion(r.id), success: "Promotion withdrawn", detail: r.employeeName })}>
          Withdraw
        </Button>
      }
    >
      <FormGrid>
        <Field label="Decision">
          {({ id }) => (
            <Select id={id} value={v.decision} onChange={(e) => f.set("decision")(e.target.value as "approved" | "rejected")}>
              <option value="approved">Approve</option>
              <option value="rejected">Turn down</option>
            </Select>
          )}
        </Field>
        {approving ? (
          <Field label="Update the employee record" hint={`Sets the designation${r.proposedCtc ? " and CTC" : ""} now. Revise the salary structure in Payroll separately.`}>
            {({ id }) => <Switch id={id} checked={v.apply} onChange={(c) => f.set("apply")(c)} aria-label="Update the employee record" />}
          </Field>
        ) : null}
        <Field label="Note" full>
          {({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function PipDialog({ o, pip: p, onClose }: { o: Overview; pip: BosPip | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ employeeId: p?.employeeId ?? "", reason: p?.reason ?? "", goals: p?.goals ?? "", startedOn: p?.startedOn ?? o.today, reviewOn: p?.reviewOn ?? addDaysISO(o.today, 30) }));
  const v = f.values;
  const person = p?.employeeName ?? o.employees.find((e) => e.id === v.employeeId)?.name;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={p ? `${p.employeeName} · improvement plan` : "Start an improvement plan"}
      description={p ? "Change the goals or move the review date to extend the plan." : "Agree what needs to improve and when you'll review it. Only owners and admins can see plans."}
      icon={{ tone: "coral", name: "alert" }}
      submitLabel={p ? "Save" : "Start plan"}
      busy={busy === "pip"}
      onSubmit={async () => {
        const out = await run(
          "pip",
          () => (p ? bos.updatePip(p.id, { reason: v.reason.trim(), goals: v.goals.trim() || null, reviewOn: v.reviewOn }) : bos.startPip({ employeeId: v.employeeId, reason: v.reason.trim(), goals: v.goals.trim() || null, startedOn: v.startedOn, reviewOn: v.reviewOn })),
          { success: p ? "Plan updated" : "Plan started", description: person },
        );
        if (out) onClose();
      }}
      wide
    >
      <FormGrid>
        {!p ? <Field label="Employee">{({ id }) => <EmployeeSelect id={id} employees={o.employees} value={v.employeeId} onChange={f.set("employeeId")} />}</Field> : null}
        <Field label="Concern" full={Boolean(p)}>
          {({ id }) => <Input id={id} required maxLength={300} value={v.reason} placeholder="e.g. Attendance & quality concerns" onChange={(e) => f.set("reason")(e.target.value)} />}
        </Field>
        {!p ? <Field label="Starts">{({ id }) => <Input id={id} type="date" required value={v.startedOn} onChange={(e) => f.set("startedOn")(e.target.value)} />}</Field> : null}
        <Field label="Review on">{({ id }) => <Input id={id} type="date" required min={addDaysISO(v.startedOn, 1)} value={v.reviewOn} onChange={(e) => f.set("reviewOn")(e.target.value)} />}</Field>
      </FormGrid>
      <Field label="Goals and support">{({ id }) => <Textarea id={id} rows={4} maxLength={5000} value={v.goals} placeholder="What good looks like, how it's measured, the help on offer…" onChange={(e) => f.set("goals")(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function ClosePipDialog({ o, pip: p, onClose }: { o: Overview; pip: BosPip; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ outcome: "passed" as "passed" | "failed" | "cancelled", date: o.today, note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Close ${p.employeeName}'s plan`}
      description={p.reason}
      icon={{ tone: v.outcome === "passed" ? "emerald" : "amber", name: v.outcome === "passed" ? "check" : "alert" }}
      submitLabel="Close plan"
      busy={busy === "close-pip"}
      onSubmit={async () => {
        const out = await run("close-pip", () => bos.closePip(p.id, { outcome: v.outcome, date: v.date, note: v.note.trim() || null }), { success: "Plan closed", description: p.employeeName });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Outcome">
          {({ id }) => (
            <Select id={id} value={v.outcome} onChange={(e) => f.set("outcome")(e.target.value as typeof v.outcome)}>
              <option value="passed">Completed successfully</option>
              <option value="failed">Not met</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          )}
        </Field>
        <Field label="Closed on">{({ id }) => <Input id={id} type="date" required min={p.startedOn} max={o.today} value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        <Field label="Note" full>
          {({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function AwardDialog({ o, category, onClose }: { o: Overview; category?: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ employeeId: "", category: category ?? "", awardedOn: o.today, note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Recognise someone"
      description="Shown on the Recognition tab and in the activity feed."
      icon={{ tone: "amber", glyph: "🏆" }}
      submitLabel="Recognise"
      busy={busy === "award"}
      onSubmit={async () => {
        const out = await run("award", () => bos.recognize({ employeeId: v.employeeId, category: v.category.trim(), awardedOn: v.awardedOn, note: v.note.trim() || null }), {
          success: `🏆 ${v.category.trim()}`,
          description: o.employees.find((e) => e.id === v.employeeId)?.name,
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Employee">{({ id }) => <EmployeeSelect id={id} employees={o.employees} value={v.employeeId} onChange={f.set("employeeId")} />}</Field>
        <Field label="Recognition">
          {({ id }) => (
            <>
              <Input id={id} required list="bos-award-categories" maxLength={80} value={v.category} placeholder="e.g. Star Technician" onChange={(e) => f.set("category")(e.target.value)} />
              <datalist id="bos-award-categories">
                {o.categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Date">{({ id }) => <Input id={id} type="date" required max={o.today} value={v.awardedOn} onChange={(e) => f.set("awardedOn")(e.target.value)} />}</Field>
        <Field label="Why">{({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}
