"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
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
  Textarea,
  WidgetCard,
  type BosColumn,
  type BosPastel,
} from "@/components/bos";
import { bos, type BosPolicy, type PoliciesOverview, type PolicyCategory, type PolicyDetail, type PolicyRosterRow } from "@/lib/bos-app/api";
import { dateLabel, POLICY_CATEGORY_LABEL, policyBadge } from "@/lib/bos-app/format";
import { fromTemplate, POLICY_TEMPLATES } from "@/lib/bos-app/policy-templates";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";
import { AgreementsTab, ComplianceTab } from "./ComplianceAgreements";

type Tab = "policies" | "compliance" | "agreements";
type Overview = PoliciesOverview;

const CATEGORIES: ReadonlyArray<PolicyCategory> = ["hr", "compliance", "finance", "it", "safety", "other"];
const CATEGORY_TAG: Record<PolicyCategory, BosPastel> = { hr: "sage", compliance: "rose", finance: "blue", it: "lavender", safety: "mint", other: "sage" };
const CATEGORY_GLYPH: Record<PolicyCategory, string> = { hr: "📋", compliance: "🛡️", finance: "₹", it: "🔒", safety: "⛑", other: "🔖" };

const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const policies = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const day = (ts: string | null) => (ts ? dateLabel(ts.slice(0, 10)) : "—");
const categoryTag = (c: PolicyCategory) => <Badge tag={CATEGORY_TAG[c]}>{POLICY_CATEGORY_LABEL[c].toUpperCase()}</Badge>;

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

/**
 * HR → Policies & Compliance: the policy library with acknowledgements, the statutory compliance calendar and the
 * agreements register. Managers see everything; everyone else reads published policies and sees their own agreements.
 * Links: `open:<policyId>`, `compliance`, `agreements`.
 */
export function PoliciesCompliance() {
  const { takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("policies"));
  const [openId, setOpenId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [tab, setTab] = useState<Tab>(intent === "compliance" || intent === "agreements" ? intent : "policies");
  return openId ? <PolicyView id={openId} onBack={() => setOpenId(null)} /> : <PoliciesHome tab={tab} setTab={setTab} onOpen={setOpenId} />;
}

function PoliciesHome({ tab, setTab, onOpen }: { tab: Tab; setTab: (t: Tab) => void; onOpen: (id: string) => void }) {
  const state = useBosData(() => bos.policies(), []);
  return (
    <Loaded state={state}>
      {(o) => {
        const current: Tab = !o.manager && tab === "compliance" ? "policies" : tab;
        return (
          <Stack>
            <Kpis o={o} />
            <ModuleToolbar>
              <Segmented<Tab>
                size="sm"
                aria-label="Policies & Compliance view"
                options={[
                  { value: "policies", label: "HR Policies" },
                  ...(o.manager ? [{ value: "compliance" as const, label: "Compliance Calendar" }] : []),
                  { value: "agreements", label: o.manager ? "Agreements" : "Your Agreements" },
                ]}
                value={current}
                onChange={setTab}
              />
            </ModuleToolbar>
            {o.truncated ? <Alert tone="amber" title="Showing the latest records">Older filings or agreements aren&apos;t listed here.</Alert> : null}
            {current === "policies" ? <PoliciesTab o={o} onOpen={onOpen} /> : null}
            {current === "compliance" ? <ComplianceTab o={o} /> : null}
            {current === "agreements" ? <AgreementsTab o={o} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function Kpis({ o }: { o: Overview }) {
  const a = o.totals.agreements;
  const agreements = (
    <KpiCard
      label={o.manager ? "Agreements expiring" : "Your agreements"}
      value={String(o.manager ? a.expiring : o.agreements.length)}
      chip={{ color: "lavender", glyph: "✍" }}
      delta={a.expired ? `${a.expired} expired` : o.manager ? (a.expiring ? "In the next 30 days" : a.unsigned ? `${a.unsigned} awaiting signature` : `${a.active} active`) : a.expiring ? `${a.expiring} expiring soon` : "On record with HR"}
      deltaTone={a.expired ? "down" : a.expiring || a.unsigned ? "warn" : "muted"}
    />
  );
  if (o.manager && o.totals.policies && o.totals.compliance) {
    const p = o.totals.policies;
    const c = o.totals.compliance;
    return (
      <Grid cols={4} min={140}>
        <KpiCard label="Published policies" value={String(p.published)} chip={{ color: "blue", glyph: "🔖" }} delta={`${p.mandatory} mandatory${p.drafts ? ` · ${p.drafts} draft${p.drafts === 1 ? "" : "s"}` : ""}`} deltaTone="muted" />
        <KpiCard
          label="Org-wide acknowledgment"
          value={p.ackRate === null ? "—" : `${p.ackRate}%`}
          chip={{ color: "mint", glyph: "✓" }}
          delta={!p.published ? "Publish a policy to start" : p.mandatoryPending ? `${p.mandatoryPending} mandatory sign-off${p.mandatoryPending === 1 ? "" : "s"} pending` : "Mandatory policies all signed"}
          deltaTone={p.mandatoryPending ? "warn" : "muted"}
        />
        <KpiCard
          label="Filings due in 30 days"
          value={String(c.due30)}
          chip={{ color: "rose", glyph: "📅" }}
          delta={c.overdue ? `${c.overdue} overdue` : c.dueSoon ? `${c.dueSoon} due this week` : "Nothing overdue"}
          deltaTone={c.overdue ? "down" : c.dueSoon ? "warn" : "muted"}
        />
        {agreements}
      </Grid>
    );
  }
  const m = o.totals.mine;
  return (
    <Grid cols={3} min={140}>
      <KpiCard
        label="Policies to acknowledge"
        value={m ? String(m.toAcknowledge) : "—"}
        chip={{ color: "rose", glyph: "🔖" }}
        delta={!m ? "Link your employee record" : m.mandatoryPending ? `${m.mandatoryPending} mandatory` : "You're up to date"}
        deltaTone={m?.mandatoryPending ? "warn" : "muted"}
      />
      <KpiCard label="Acknowledged" value={m ? String(m.acknowledged) : "—"} chip={{ color: "mint", glyph: "✓" }} delta={`of ${policies(o.policies.length)}`} deltaTone="muted" />
      {agreements}
    </Grid>
  );
}

/* ---------- Policy library ---------- */

function PoliciesTab({ o, onOpen }: { o: Overview; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [category, setCategory] = useState<PolicyCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState<BosPolicy | null>(null);
  const q = query.trim().toLowerCase();
  const shown = o.policies.filter(
    (p) => (p.status === "archived") === archived && (!category || p.category === category) && (!q || `${p.title} ${p.summary ?? ""}`.toLowerCase().includes(q)),
  );
  const used = CATEGORIES.filter((c) => o.policies.some((p) => p.category === c));
  const columns: BosColumn<BosPolicy>[] = [
    {
      key: "name",
      header: "Policy",
      cell: (p) => (
        <Described
          width={360}
          title={
            <>
              {p.title}
              {p.mandatory ? (
                <Badge tone="coral" auto style={{ marginLeft: 6 }}>
                  MANDATORY
                </Badge>
              ) : null}
            </>
          }
          sub={p.summary ?? undefined}
        />
      ),
    },
    { key: "category", header: "Category", cell: (p) => categoryTag(p.category) },
    { key: "updated", header: "Last Updated", mono: true, cell: (p) => day(p.publishedAt ?? p.updatedAt) },
    ...(o.manager
      ? [
          {
            key: "ack",
            header: "Org-wide Acknowledgment",
            mono: true,
            cell: (p: BosPolicy) => (p.status === "published" ? `${pct(p.acknowledged ?? 0, o.headcount)} · ${p.acknowledged ?? 0}/${o.headcount}` : faint()),
          },
          { key: "status", header: "Status", cell: (p: BosPolicy) => <StatusBadge view={policyBadge(p.status)} /> },
        ]
      : []),
    ...(o.me
      ? [
          {
            key: "mine",
            header: "Your Status",
            cell: (p: BosPolicy) =>
              p.status !== "published" ? (
                faint()
              ) : p.acknowledgedAt ? (
                <Badge tone="emerald">✓ ACKNOWLEDGED</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReading(p);
                  }}
                >
                  Read &amp; Acknowledge
                </Button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <ModuleToolbar>
        <SearchInput placeholder="Search policies…" aria-label="Search policies" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="bos-spacer" />
        {o.manager ? (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New policy
          </Button>
        ) : null}
      </ModuleToolbar>
      {used.length > 1 || o.manager ? (
        <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Policy categories">
          {used.map((c) => (
            <FilterChip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
              {POLICY_CATEGORY_LABEL[c]}
            </FilterChip>
          ))}
          {o.manager && o.policies.some((p) => p.status === "archived") ? (
            <FilterChip active={archived} onClick={() => setArchived(!archived)}>
              Archived
            </FilterChip>
          ) : null}
        </div>
      ) : null}
      {!o.manager && !o.me ? (
        <Alert tone="amber" title="Your login isn't linked to an employee record">
          You can read the policies, but ask HR to link your login in HR → Employees before you can acknowledge them.
        </Alert>
      ) : null}
      <DataTable
        caption="HR policies"
        columns={columns}
        rows={shown}
        rowKey={(p) => p.id}
        onRowClick={(p) => onOpen(p.id)}
        empty={o.manager ? (archived ? "No archived policies." : "No policies yet — start one from a template with New policy.") : "No policies have been published yet."}
      />
      {creating ? <PolicyDialog o={o} policy={null} onClose={() => setCreating(false)} onSaved={onOpen} /> : null}
      {reading ? <AcknowledgeDialog policy={reading} onClose={() => setReading(null)} /> : null}
    </>
  );
}

function AcknowledgeDialog({ policy, onClose }: { policy: BosPolicy; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const state = useBosData(() => bos.policy(policy.id), [policy.id]);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={policy.title}
      description={policy.summary ?? undefined}
      icon={{ tone: "blue", glyph: CATEGORY_GLYPH[policy.category] }}
      submitLabel="I've read & acknowledge"
      busy={busy === "ack"}
      wide
      note="Scroll to read the full policy."
      onSubmit={async () => {
        const out = await run("ack", () => bos.acknowledgePolicy(policy.id), { success: "Policy acknowledged", description: policy.title, tone: "emerald" });
        if (out) onClose();
      }}
    >
      <Loaded state={state} rows={3}>
        {(d) => (
          <div className="bos-policy-text is-scroll" tabIndex={0} role="document" aria-label={`${policy.title} — full text`}>
            {d.policy.body}
          </div>
        )}
      </Loaded>
    </FormDialog>
  );
}

/* ---------- One policy ---------- */

type ViewDialog = "edit" | "archive" | "delete" | null;
type RosterShow = "pending" | "done" | "all";

function PolicyView({ id, onBack }: { id: string; onBack: () => void }) {
  const { run, busy } = useBosAction();
  const { session, canManage } = useBosApp();
  const print = usePrint();
  const [dialog, setDialog] = useState<ViewDialog>(null);
  const [section, setSection] = useState<"text" | "acks">("text");
  const state = useBosData(() => bos.policy(id), [id]);
  const lists = useBosData(() => (canManage ? bos.policies() : Promise.resolve(null)), [canManage]);
  const close = () => setDialog(null);
  const company = session.brand?.name || session.settings.companyName || "Our company";

  return (
    <Loaded state={state} rows={2}>
      {(d) => {
        const p = d.policy;
        const acked = p.acknowledged ?? 0;
        const showAcks = canManage && p.status === "published";
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to policies
              </button>
              <div className="bos-app-actions">
                {canManage && p.status === "draft" ? (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("delete")}>
                    Delete
                  </Button>
                ) : null}
                {canManage && p.status !== "archived" ? (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("archive")}>
                    Archive
                  </Button>
                ) : null}
                {canManage && p.status === "archived" ? (
                  <Button size="sm" onClick={() => void run("restore", () => bos.restorePolicy(p.id), { success: "Policy restored", description: p.title })}>
                    Restore
                  </Button>
                ) : null}
                {canManage && p.status !== "archived" ? (
                  <Button size="sm" icon="edit" disabled={!lists.data} onClick={() => setDialog("edit")}>
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" icon="printer" onClick={print}>
                  Print / PDF
                </Button>
                {canManage && p.status === "draft" ? (
                  <Button size="sm" variant="primary" disabled={busy === "publish"} onClick={() => void run("publish", () => bos.publishPolicy(p.id), { success: "Policy published", description: p.title, tone: "emerald" })}>
                    Publish
                  </Button>
                ) : null}
                {d.canAcknowledge && !p.acknowledgedAt ? (
                  <Button size="sm" variant="primary" disabled={busy === "ack"} onClick={() => void run("ack", () => bos.acknowledgePolicy(p.id), { success: "Policy acknowledged", description: p.title, tone: "emerald" })}>
                    I&apos;ve read &amp; acknowledge
                  </Button>
                ) : null}
              </div>
            </div>
            <Stack>
              <div className="bos-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{p.title}</h2>
                {categoryTag(p.category)}
                {canManage ? <StatusBadge view={policyBadge(p.status)} /> : null}
                {p.mandatory ? <Badge tone="coral">MANDATORY</Badge> : null}
                <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                  {p.version ? `Version ${p.version} · published ${day(p.publishedAt)}${p.publishedBy ? ` by ${p.publishedBy}` : ""}` : "Not published yet"}
                  {p.effectiveOn ? ` · effective ${dateLabel(p.effectiveOn)}` : ""}
                </span>
              </div>
              {p.acknowledgedAt ? (
                <Alert tone="emerald" title={`You acknowledged version ${p.version} on ${day(p.acknowledgedAt)}`}>
                  Thank you — it&apos;s on record with HR.
                </Alert>
              ) : p.ackedVersion && p.status === "published" ? (
                <Alert tone="amber" title={`Updated since you acknowledged version ${p.ackedVersion}`}>
                  Please read this version and acknowledge it again.
                </Alert>
              ) : null}
              {canManage && p.status === "draft" ? (
                <Alert tone="blue" title="Draft">
                  Only owners and admins can see it. Publish it to ask everyone to read and acknowledge it.
                </Alert>
              ) : null}

              {showAcks ? (
                <>
                  <Grid cols={3} min={140}>
                    <KpiCard label="Acknowledged" value={pct(acked, d.roster.length)} chip={{ color: "mint", glyph: "✓" }} delta={`${acked} of ${d.roster.length} people`} deltaTone="muted" interactive={false} />
                    <KpiCard
                      label="Pending"
                      value={String(d.roster.length - acked)}
                      chip={{ color: "rose", glyph: "⏳" }}
                      delta={`${d.roster.filter((r) => !r.acknowledgedAt && !r.hasLogin).length} without a login — record on paper`}
                      deltaTone={d.roster.length - acked ? "warn" : "muted"}
                      interactive={false}
                    />
                    <KpiCard label="Version" value={`v${p.version}`} chip={{ color: "blue", glyph: "🔖" }} delta={`Published ${day(p.publishedAt)}`} deltaTone="muted" interactive={false} />
                  </Grid>
                  <ModuleToolbar>
                    <Segmented<"text" | "acks">
                      size="sm"
                      aria-label="Policy view"
                      options={[
                        { value: "text", label: "Policy text" },
                        { value: "acks", label: `Acknowledgements · ${acked}/${d.roster.length}` },
                      ]}
                      value={section}
                      onChange={setSection}
                    />
                  </ModuleToolbar>
                </>
              ) : null}

              {showAcks && section === "acks" ? (
                <Roster detail={d} />
              ) : (
                <div className="bos-payslip-wrap">
                  <article className="bos-inv-paper bos-offer-letter" aria-label={p.title}>
                    <div className="bos-inv-paper-top">
                      <div>
                        <div className="bos-inv-paper-brand">{company}</div>
                        <div className="bos-inv-paper-seller">{POLICY_CATEGORY_LABEL[p.category]} policy</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="bos-inv-paper-title">{p.title.toUpperCase()}</div>
                        <div className="bos-inv-paper-sub">
                          {p.version ? `Version ${p.version}` : "DRAFT"}
                          {p.effectiveOn ? ` · effective ${dateLabel(p.effectiveOn)}` : ""}
                        </div>
                      </div>
                    </div>
                    {p.summary ? (
                      <p>
                        <strong>{p.summary}</strong>
                      </p>
                    ) : null}
                    <div className="bos-policy-text">{p.body}</div>
                  </article>
                </div>
              )}
            </Stack>

            {dialog === "edit" && lists.data ? <PolicyDialog o={lists.data} policy={p} onClose={close} /> : null}
            {dialog === "archive" ? (
              <ConfirmDialog
                open
                onClose={close}
                title={`Archive ${p.title}?`}
                description="It's hidden from employees. Acknowledgements stay on record, and you can restore it later."
                confirmLabel="Archive"
                busy={busy === "archive"}
                onConfirm={async () => {
                  const out = await run("archive", () => bos.archivePolicy(p.id), { success: "Policy archived", description: p.title });
                  if (out) close();
                }}
              />
            ) : null}
            {dialog === "delete" ? (
              <ConfirmDialog
                open
                onClose={close}
                destructive
                title={`Delete ${p.title}?`}
                description="The draft is removed for good."
                confirmLabel="Delete draft"
                busy={busy === "delete"}
                onConfirm={async () => {
                  const out = await run("delete", () => bos.deletePolicy(p.id).then(() => true), { success: "Draft deleted", description: p.title });
                  if (out) onBack();
                }}
              />
            ) : null}
          </>
        );
      }}
    </Loaded>
  );
}

function Roster({ detail }: { detail: PolicyDetail }) {
  const { run, busy } = useBosAction();
  const [show, setShow] = useState<RosterShow>("pending");
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<PolicyRosterRow | null>(null);
  const [removing, setRemoving] = useState<PolicyRosterRow | null>(null);
  const p = detail.policy;
  const q = query.trim().toLowerCase();
  const shown = detail.roster.filter(
    (r) => (show === "all" || (show === "done" ? Boolean(r.acknowledgedAt) : !r.acknowledgedAt)) && (!q || `${r.name} ${r.empCode} ${r.departmentName ?? ""}`.toLowerCase().includes(q)),
  );
  const exportCsv = () =>
    downloadCsv(
      `${p.title.replace(/[^\w-]+/g, "-")}-v${p.version}-acknowledgements.csv`,
      ["Employee", "Code", "Department", "Designation", "Policy", "Version", "Acknowledged", "Acknowledged on", "Method", "Recorded by", "Note"],
      detail.roster.map((r) => ({
        Employee: r.name,
        Code: r.empCode,
        Department: r.departmentName ?? "",
        Designation: r.designation ?? "",
        Policy: p.title,
        Version: p.version,
        Acknowledged: r.acknowledgedAt ? "Yes" : "No",
        "Acknowledged on": r.acknowledgedAt ?? "",
        Method: r.method === "self" ? "Self (signed in)" : r.method === "recorded" ? "Recorded by HR" : "",
        "Recorded by": r.recordedBy ?? "",
        Note: r.note ?? "",
      })),
    );
  const columns: BosColumn<PolicyRosterRow>[] = [
    {
      key: "who",
      header: "Employee",
      cell: (r) => (
        <span className="bos-row" style={{ gap: 8, alignItems: "center" }}>
          <PersonAvatar name={r.name} />
          <Described title={r.name} sub={[r.empCode, r.designation, r.departmentName].filter(Boolean).join(" · ")} width={260} />
        </span>
      ),
    },
    {
      key: "when",
      header: "Acknowledged",
      mono: true,
      cell: (r) =>
        r.acknowledgedAt ? day(r.acknowledgedAt) : <Badge tone="amber">{r.lastVersion ? `PENDING · SIGNED V${r.lastVersion}` : "PENDING"}</Badge>,
    },
    {
      key: "how",
      header: "How",
      cell: (r) =>
        r.method === "self" ? (
          "Signed in"
        ) : r.method === "recorded" ? (
          <Described title={`Recorded by ${r.recordedBy ?? "HR"}`} sub={r.note ?? undefined} width={240} />
        ) : r.hasLogin ? (
          faint("Can acknowledge in BOS")
        ) : (
          faint("No login — record a paper copy")
        ),
    },
    {
      key: "act",
      header: "",
      cell: (r) =>
        !r.acknowledgedAt ? (
          <Button size="sm" onClick={() => setRecording(r)}>
            Record
          </Button>
        ) : r.method === "recorded" ? (
          <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
            Remove
          </Button>
        ) : null,
    },
  ];
  return (
    <WidgetCard title="🖊 Acknowledgement register" dot="mint">
      <ModuleToolbar>
        <Segmented<RosterShow>
          size="sm"
          aria-label="Show people"
          options={[
            { value: "pending", label: `Pending · ${detail.roster.filter((r) => !r.acknowledgedAt).length}` },
            { value: "done", label: "Acknowledged" },
            { value: "all", label: "All" },
          ]}
          value={show}
          onChange={setShow}
        />
        <SearchInput placeholder="Search people…" aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="bos-spacer" />
        <Button size="sm" icon="download" onClick={exportCsv}>
          Download CSV
        </Button>
      </ModuleToolbar>
      <DataTable caption="Acknowledgements" columns={columns} rows={shown} rowKey={(r) => r.employeeId} empty={show === "pending" ? "Everyone has acknowledged this version." : "No one yet."} />
      {recording ? <RecordDialog policy={p} person={recording} onClose={() => setRecording(null)} /> : null}
      {removing ? (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          destructive
          title={`Remove ${removing.name}'s acknowledgement?`}
          description="Only acknowledgements recorded by HR can be removed. They'll show as pending again."
          confirmLabel="Remove"
          busy={busy === "unack"}
          onConfirm={async () => {
            const out = await run("unack", () => bos.removeAcknowledgement(p.id, removing.employeeId).then(() => true), { success: "Acknowledgement removed", description: removing.name });
            if (out) setRemoving(null);
          }}
        />
      ) : null}
    </WidgetCard>
  );
}

/* ---------- Dialogs ---------- */

function RecordDialog({ policy, person, onClose }: { policy: PolicyDetail["policy"]; person: PolicyRosterRow; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [note, setNote] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Record ${person.name}'s acknowledgement`}
      description={`For ${policy.title}, version ${policy.version}. Use this when they signed a paper copy or confirmed in person.`}
      icon={{ tone: "emerald", name: "check" }}
      submitLabel="Record acknowledgement"
      busy={busy === "record"}
      onSubmit={async () => {
        const out = await run("record", () => bos.recordAcknowledgement(policy.id, person.employeeId, note.trim() || null), { success: "Acknowledgement recorded", description: person.name, tone: "emerald" });
        if (out) onClose();
      }}
    >
      <Field label="How it was acknowledged" hint="Optional — kept in the register">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={300} value={note} placeholder="e.g. Signed paper copy at site induction" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function PolicyDialog({ o, policy, onClose, onSaved }: { o: Overview; policy: (BosPolicy & { body?: string }) | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { run, busy } = useBosAction();
  const { session } = useBosApp();
  const company = session.brand?.name || session.settings.companyName || "";
  const [template, setTemplate] = useState("");
  const f = useFormState(() => ({
    title: policy?.title ?? "",
    category: policy?.category ?? ("hr" as PolicyCategory),
    summary: policy?.summary ?? "",
    body: policy?.body ?? "",
    mandatory: policy?.mandatory ?? false,
    effectiveOn: policy?.effectiveOn ?? "",
    publish: false,
    newVersion: false,
  }));
  const v = f.values;
  const published = policy?.status === "published";
  const taken = new Set(o.policies.map((p) => p.title.toLowerCase()));
  const pick = (key: string) => {
    setTemplate(key);
    const t = POLICY_TEMPLATES.find((x) => x.key === key);
    if (t) f.setValues((cur) => ({ ...cur, ...fromTemplate(t, company) }));
  };
  const input = { title: v.title.trim(), category: v.category, summary: v.summary.trim() || null, body: v.body.trim(), mandatory: v.mandatory, effectiveOn: v.effectiveOn || null };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={policy ? `Edit ${policy.title}` : "New policy"}
      description={policy ? undefined : "Start from a template or write your own. Drafts are only visible to owners and admins."}
      icon={{ tone: "blue", glyph: "🔖" }}
      submitLabel={policy ? (published && v.newVersion ? `Save & publish v${policy.version + 1}` : "Save") : v.publish ? "Publish" : "Save draft"}
      busy={busy === "policy"}
      wide
      note={template ? "Templates are a starting point — edit them to fit your business, and check POSH and anything legal with your advisor." : undefined}
      onSubmit={async () => {
        if (policy) {
          const out = await run("policy", () => bos.updatePolicy(policy.id, { ...input, newVersion: published && v.newVersion }), {
            success: published && v.newVersion ? `Version ${policy.version + 1} published` : "Policy saved",
            description: input.title,
          });
          if (out) onClose();
          return;
        }
        const out = await run("policy", () => bos.createPolicy({ ...input, publish: v.publish }), { success: v.publish ? "Policy published" : "Draft saved", description: input.title });
        if (out) {
          onClose();
          onSaved?.(out.policy.id);
        }
      }}
    >
      {!policy ? (
        <Field label="Start from">
          {({ id }) => (
            <Select id={id} value={template} onChange={(e) => pick(e.target.value)}>
              <option value="">A blank policy</option>
              {POLICY_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                  {taken.has(t.title.toLowerCase()) ? " (you have one)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <FormGrid>
        <Field label="Policy name">
          {({ id }) => <Input id={id} required maxLength={160} value={v.title} placeholder="e.g. Leave Policy" onChange={(e) => f.set("title")(e.target.value)} />}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={v.category} onChange={(e) => f.set("category")(e.target.value as PolicyCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {POLICY_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Effective from" hint="Optional">
          {({ id, describedBy }) => <Input id={id} type="date" aria-describedby={describedBy} value={v.effectiveOn} onChange={(e) => f.set("effectiveOn")(e.target.value)} />}
        </Field>
        <div className="bos-field" style={{ justifyContent: "flex-end" }}>
          <label className="bos-row" style={{ gap: 8, alignItems: "center", fontSize: 13 }}>
            <Checkbox checked={v.mandatory} onChange={f.set("mandatory")} aria-label="Mandatory" />
            Mandatory — everyone must acknowledge it
          </label>
        </div>
      </FormGrid>
      <Field label="Summary" hint="Shown in the list and at the top of the acknowledgement">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} maxLength={600} value={v.summary} onChange={(e) => f.set("summary")(e.target.value)} />}
      </Field>
      <Field label="Policy text">
        {({ id }) => <Textarea id={id} required rows={14} maxLength={100000} value={v.body} placeholder="Write the policy — numbered sections and bullet points are kept as you type them." onChange={(e) => f.set("body")(e.target.value)} />}
      </Field>
      {!policy ? (
        <label className="bos-row" style={{ gap: 8, alignItems: "center", fontSize: 13 }}>
          <Checkbox checked={v.publish} onChange={f.set("publish")} aria-label="Publish now" />
          Publish now — everyone can read and acknowledge it
        </label>
      ) : published ? (
        <label className="bos-row" style={{ gap: 8, alignItems: "flex-start", fontSize: 13 }}>
          <Checkbox checked={v.newVersion} onChange={f.set("newVersion")} aria-label="Ask everyone to acknowledge again" />
          <span>
            Ask everyone to acknowledge again (publish as version {policy.version + 1})
            <span className="bos-text-faint" style={{ display: "block", fontSize: 12 }}>
              Leave it off for small fixes; turn it on when the rules change. Earlier acknowledgements stay on record.
            </span>
          </span>
        </label>
      ) : null}
    </FormDialog>
  );
}
