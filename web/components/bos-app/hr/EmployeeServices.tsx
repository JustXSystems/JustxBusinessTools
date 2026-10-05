"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
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
  type BosColumn,
  type BosPastel,
} from "@/components/bos";
import {
  bos,
  type CertificateKind,
  type ServiceDetail,
  type ServiceLetter,
  type ServicePriority,
  type ServiceRequest,
  type ServicesOverview,
  type ServiceType,
} from "@/lib/bos-app/api";
import { CERTIFICATE_KIND_LABEL, dateLabel, inr, resolutionLabel, SERVICE_TYPE_LABEL, serviceBadge } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Overview = ServicesOverview;
type Show = "open" | "resolved" | "all";

const TYPES: ReadonlyArray<ServiceType> = ["helpdesk", "certificate", "id_card", "kit", "other"];
const KINDS: ReadonlyArray<CertificateKind> = ["employment", "experience", "salary"];
const TYPE_TAG: Record<ServiceType, BosPastel> = { helpdesk: "rose", certificate: "lavender", id_card: "blue", kit: "mint", other: "sage" };
const PRIORITY_LABEL: Record<ServicePriority, string> = { low: "Low", normal: "Normal", high: "High" };
const LETTER_TITLE: Record<CertificateKind, string> = { employment: "EMPLOYMENT CERTIFICATE", experience: "EXPERIENCE LETTER", salary: "SALARY CERTIFICATE" };

const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isOpen = (r: ServiceRequest) => r.status === "open" || r.status === "in_progress";
const typeTag = (r: Pick<ServiceRequest, "type">) => <Badge tag={TYPE_TAG[r.type]}>{SERVICE_TYPE_LABEL[r.type].toUpperCase()}</Badge>;
const stamp = (ts: string) => {
  const d = new Date(ts.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
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

/** HR → Employee Services: helpdesk tickets, certificate and letter requests, ID cards and kits. Managers see every request; everyone else sees their own. */
export function EmployeeServices() {
  const [openId, setOpenId] = useState<string | null>(null);
  return openId ? <RequestView id={openId} onBack={() => setOpenId(null)} /> : <ServicesHome onOpen={setOpenId} />;
}

function ServicesHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [show, setShow] = useState<Show>("open");
  const [type, setType] = useState<ServiceType | null>(null);
  const [query, setQuery] = useState("");
  const [raising, setRaising] = useState(false);
  const state = useBosData(() => bos.services(), []);
  return (
    <Loaded state={state}>
      {(o) => {
        const t = o.totals;
        const q = query.trim().toLowerCase();
        const shown = o.requests.filter(
          (r) =>
            (show === "all" || (show === "open" ? isOpen(r) : !isOpen(r))) &&
            (!type || r.type === type) &&
            (!q || `${r.subject} ${r.requestNo} ${r.employeeName} ${r.assigneeName ?? ""}`.toLowerCase().includes(q)),
        );
        const trend = t.avgResolutionDays !== null && t.avgResolutionPrevDays !== null ? Math.round((t.avgResolutionDays - t.avgResolutionPrevDays) * 10) / 10 : null;
        const columns: BosColumn<ServiceRequest>[] = [
          {
            key: "req",
            header: "Request",
            cell: (r) => (
              <Described
                title={
                  <>
                    {r.subject}
                    {r.priority === "high" ? (
                      <>
                        {" "}
                        <Badge tone="coral">HIGH</Badge>
                      </>
                    ) : null}
                  </>
                }
                sub={[r.requestNo, r.addressedTo, r.comments ? plural(r.comments, "reply") : null].filter(Boolean).join(" · ")}
              />
            ),
          },
          ...(o.manager ? [{ key: "by", header: "Raised By", cell: (r: ServiceRequest) => <Described title={r.employeeName} sub={r.designation ?? undefined} width={200} /> }] : []),
          { key: "type", header: "Type", cell: typeTag },
          { key: "on", header: "Raised On", mono: true, cell: (r) => dateLabel(r.createdAt.slice(0, 10)) },
          ...(o.manager ? [{ key: "who", header: "Assignee", cell: (r: ServiceRequest) => r.assigneeName ?? faint() }] : []),
          { key: "status", header: "Status", cell: (r) => <StatusBadge view={serviceBadge(r.status)} /> },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard
                label="Open helpdesk tickets"
                value={String(t.helpdeskOpen)}
                chip={{ color: "rose", glyph: "🎧" }}
                delta={t.helpdeskUnassigned ? `${t.helpdeskUnassigned} unassigned` : "All assigned"}
                deltaTone={t.helpdeskUnassigned ? "warn" : "muted"}
              />
              <KpiCard
                label="Avg. resolution time"
                value={resolutionLabel(t.avgResolutionDays)}
                chip={{ color: "mint", glyph: "⏱" }}
                delta={trend === null ? `${plural(t.resolvedRecent, "request")} resolved in 30 days` : `${trend <= 0 ? "▼" : "▲"} ${Math.abs(trend)}d vs last month`}
                deltaTone={trend === null ? "muted" : trend <= 0 ? "up" : "down"}
              />
              <KpiCard label="Certificate requests" value={String(t.certificatesOpen)} chip={{ color: "blue", glyph: "📄" }} delta="Experience letters, employment, salary" deltaTone="muted" />
              <KpiCard label="ID card / kit requests" value={String(t.kitsOpen)} chip={{ color: "lavender", glyph: "🪪" }} delta="Cards, welcome kits, T-shirts" deltaTone="muted" />
            </Grid>
            <ModuleToolbar>
              <Segmented<Show>
                size="sm"
                aria-label="Show requests"
                options={[
                  { value: "open", label: `Open${t.open ? ` · ${t.open}` : ""}` },
                  { value: "resolved", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
                value={show}
                onChange={setShow}
              />
              <SearchInput placeholder="Search request, number or person…" aria-label="Search requests" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" disabled={!o.manager && !o.me} onClick={() => setRaising(true)}>
                New request
              </Button>
            </ModuleToolbar>
            <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }} role="group" aria-label="Request types">
              {TYPES.map((k) => (
                <FilterChip key={k} active={type === k} onClick={() => setType(type === k ? null : k)}>
                  {SERVICE_TYPE_LABEL[k]}
                </FilterChip>
              ))}
            </div>
            {!o.manager && !o.me ? (
              <Alert tone="amber" title="Your login isn't linked to an employee record">
                Ask HR to link it in HR → Employees, then you can raise requests here.
              </Alert>
            ) : null}
            {o.truncated ? <Alert tone="amber" title="Showing the latest 2,000 requests">Older requests aren&apos;t listed here.</Alert> : null}
            <DataTable
              caption={o.manager ? "Service requests" : "Your requests"}
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              onRowClick={(r) => onOpen(r.id)}
              empty={show === "open" ? "Nothing waiting — every request is resolved." : "No requests yet."}
            />
            {raising ? <RaiseDialog o={o} onClose={() => setRaising(false)} onRaised={onOpen} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- One request ---------- */

type ViewDialog = "edit" | "resolve" | "cancel" | "letter" | null;

function RequestView({ id, onBack }: { id: string; onBack: () => void }) {
  const { run, busy } = useBosAction();
  const [dialog, setDialog] = useState<ViewDialog>(null);
  const state = useBosData(() => bos.serviceRequest(id), [id]);
  const lists = useBosData(() => bos.services(), []);
  const close = () => setDialog(null);
  const o = lists.data;

  if (dialog === "letter" && state.data?.letter) return <LetterView detail={state.data} letter={state.data.letter} onBack={close} />;

  return (
    <Loaded state={state} rows={2}>
      {(detail) => {
        const r = detail.request;
        const open = isOpen(r);
        const manager = Boolean(o?.manager);
        const canEdit = open && (r.mine || manager);
        const assignees = (o?.employees ?? []).filter((e) => e.status !== "exited");
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to requests
              </button>
              <div className="bos-app-actions">
                {open && (r.mine || manager) ? (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>
                    Cancel request
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button size="sm" icon="edit" onClick={() => setDialog("edit")}>
                    Edit
                  </Button>
                ) : null}
                {detail.letter ? (
                  <Button size="sm" icon="printer" onClick={() => setDialog("letter")}>
                    {r.letterNo ? "⬇ Letter" : "Preview letter"}
                  </Button>
                ) : null}
                {r.status === "resolved" ? (
                  <Button size="sm" onClick={() => void run("reopen", () => bos.reopenRequest(r.id), { success: "Request reopened", description: r.requestNo })}>
                    Reopen
                  </Button>
                ) : null}
                {open && manager ? (
                  <Button size="sm" variant="primary" onClick={() => setDialog("resolve")}>
                    {r.type === "certificate" ? "Resolve & issue letter" : "Resolve"}
                  </Button>
                ) : null}
              </div>
            </div>
            <Stack>
              <div className="bos-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <PersonAvatar name={r.employeeName} size="md" />
                <h2 style={{ margin: 0, fontSize: 18 }}>{r.subject}</h2>
                {typeTag(r)}
                <StatusBadge view={serviceBadge(r.status)} />
                <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                  {r.requestNo} · {r.employeeName}
                  {r.designation ? ` — ${r.designation}` : ""}
                </span>
              </div>
              {r.status === "resolved" ? (
                <Alert tone="emerald" title={`Resolved${r.resolvedBy ? ` by ${r.resolvedBy}` : ""}${r.resolutionDays !== null ? ` in ${resolutionLabel(r.resolutionDays)}` : ""}`}>
                  {r.resolutionNote ?? (r.letterNo ? `Letter ${r.letterNo} issued on ${dateLabel(r.letterOn)}.` : "No note.")}
                </Alert>
              ) : null}
              {r.status === "cancelled" ? <Alert tone="amber" title="Cancelled">This request was cancelled.</Alert> : null}

              <Grid cols={4} min={140}>
                <KpiCard label="Raised" value={dateLabel(r.createdAt.slice(0, 10))} chip={{ color: "blue", glyph: "📋" }} delta={r.mine ? "By you" : `For ${r.employeeName}`} deltaTone="muted" interactive={false} />
                <KpiCard label="Priority" value={PRIORITY_LABEL[r.priority]} chip={{ color: r.priority === "high" ? "rose" : "mint", glyph: "!" }} delta={r.type === "certificate" && r.certificateKind ? CERTIFICATE_KIND_LABEL[r.certificateKind] : SERVICE_TYPE_LABEL[r.type]} deltaTone="muted" interactive={false} />
                <KpiCard label="Assignee" value={r.assigneeName ?? "Unassigned"} chip={{ color: "lavender", glyph: "👤" }} delta={open ? (r.assigneeName ? "Working on it" : "Waiting for HR") : ""} deltaTone={!r.assigneeName && open ? "warn" : "muted"} interactive={false} />
                <KpiCard label={r.type === "certificate" ? "Letter" : "Replies"} value={r.type === "certificate" ? (r.letterNo ?? "Not issued") : String(detail.comments.length)} chip={{ color: "sage", glyph: "✉" }} delta={r.letterOn ? `Issued ${dateLabel(r.letterOn)}` : (r.addressedTo ?? "")} deltaTone="muted" interactive={false} />
              </Grid>

              {manager && open ? (
                <div className="bos-row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <Field label="Assigned to">
                    {({ id: fid }) => (
                      <Select id={fid} value={r.assigneeId ?? ""} disabled={busy === "assign"} onChange={(e) => void run("assign", () => bos.assignRequest(r.id, e.target.value || null), { success: e.target.value ? "Request assigned" : "Request unassigned", description: r.requestNo })}>
                        <option value="">Unassigned</option>
                        {assignees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {o?.me && r.assigneeId !== o.me.id ? (
                    <Button size="sm" variant="ghost" disabled={busy === "assign"} onClick={() => void run("assign", () => bos.assignRequest(r.id, o.me!.id), { success: "Assigned to you", description: r.requestNo })}>
                      Assign to me
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {r.details ? (
                <WidgetCard title="📝 Details" dot="blue">
                  <p style={{ margin: 0, whiteSpace: "pre-line", fontSize: 13.5 }}>{r.details}</p>
                </WidgetCard>
              ) : null}

              <Thread detail={detail} manager={manager} />
            </Stack>

            {dialog === "edit" ? <EditDialog request={r} manager={manager} onClose={close} /> : null}
            {dialog === "resolve" ? <ResolveDialog request={r} onClose={close} /> : null}
            {dialog === "cancel" ? (
              <ConfirmDialog
                open
                onClose={close}
                destructive
                title={`Cancel ${r.requestNo}?`}
                description="It stays on record as cancelled."
                confirmLabel="Cancel request"
                busy={busy === "cancel"}
                onConfirm={async () => {
                  const out = await run("cancel", () => bos.cancelRequest(r.id), { success: "Request cancelled", description: r.requestNo });
                  if (out) close();
                }}
              />
            ) : null}
          </>
        );
      }}
    </Loaded>
  );
}

function Thread({ detail, manager }: { detail: ServiceDetail; manager: boolean }) {
  const { run, busy } = useBosAction();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const r = detail.request;
  const send = async () => {
    const text = body.trim();
    if (!text) return;
    const out = await run("comment", () => bos.commentOnRequest(r.id, text, internal), { success: internal ? "Note added" : "Reply sent", description: r.requestNo });
    if (out) {
      setBody("");
      setInternal(false);
    }
  };
  return (
    <WidgetCard title="💬 Conversation" dot="mint" note={detail.comments.length ? String(detail.comments.length) : undefined}>
      <div className="bos-thread" aria-label="Conversation">
        {detail.comments.length ? (
          detail.comments.map((c) => (
            <div key={c.id} className={`bos-thread-item${c.internal ? " is-internal" : ""}${c.mine ? " is-mine" : ""}`}>
              <div className="bos-thread-meta">
                <strong>{c.author ?? "Someone"}</strong>
                <span>{stamp(c.createdAt)}</span>
                {c.internal ? <Badge tone="amber">INTERNAL</Badge> : null}
              </div>
              <p>{c.body}</p>
            </div>
          ))
        ) : (
          <p className="bos-text-faint" style={{ margin: 0, fontSize: 13 }}>
            No messages yet.
          </p>
        )}
      </div>
      {r.status !== "cancelled" ? (
        <div className="bos-thread-compose">
          <Textarea rows={2} maxLength={5000} value={body} aria-label={internal ? "Internal note" : "Reply"} placeholder={internal ? "Only owners and admins see this note" : manager && !r.mine ? `Reply to ${r.employeeName}…` : "Add a message for HR…"} onChange={(e) => setBody(e.target.value)} />
          <div className="bos-row" style={{ gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
            {manager ? (
              <label className="bos-row" style={{ gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <Switch checked={internal} onChange={setInternal} aria-label="Internal note" />
                Internal note
              </label>
            ) : null}
            <Button size="sm" variant="primary" disabled={!body.trim() || busy === "comment"} onClick={() => void send()}>
              {internal ? "Add note" : "Send"}
            </Button>
          </div>
        </div>
      ) : null}
    </WidgetCard>
  );
}

/* ---------- Letter ---------- */

function LetterView({ detail, letter: l, onBack }: { detail: ServiceDetail; letter: ServiceLetter; onBack: () => void }) {
  const print = usePrint();
  const { session } = useBosApp();
  const r = detail.request;
  const s = session.settings;
  const company = session.brand?.name || s.companyName || "Our company";
  const address = [s.address, [s.gstin && `GSTIN ${s.gstin}`, s.state].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  const role = `${l.designation ? `as ${l.designation}` : "with us"}${l.departmentName ? ` in the ${l.departmentName} team` : ""}`;
  const leaving = l.status === "notice" || (l.exitDate !== null && l.status !== "exited");
  const purpose = r.details ? ` for ${r.details.replace(/^for\s+/i, "").replace(/\.$/, "")}` : "";
  let body: ReactNode;
  if (l.kind === "experience") {
    body = (
      <>
        <p>
          This is to certify that <strong>{l.name}</strong> (employee code {l.empCode}) worked with {company} {role} from <strong>{dateLabel(l.joinDate)}</strong> to{" "}
          <strong>{l.exitDate ? dateLabel(l.exitDate) : "date"}</strong>.
        </p>
        <p>We thank {l.name} for their contribution and wish them every success in the future.</p>
      </>
    );
  } else {
    body = (
      <>
        <p>
          This is to certify that <strong>{l.name}</strong> (employee code {l.empCode}) is employed with {company} {role} since <strong>{dateLabel(l.joinDate)}</strong>
          {leaving && l.exitDate ? `, with the last working day on ${dateLabel(l.exitDate)}` : ""}.
        </p>
        {l.kind === "salary" && l.ctcAnnual ? (
          <p>
            Their annual cost to company is <strong>{inr(l.ctcAnnual)}</strong> (about {inr(l.ctcAnnual / 12)} a month).
          </p>
        ) : null}
        <p>This certificate is issued at the employee&apos;s request{purpose}.</p>
      </>
    );
  }
  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={onBack}>
          ‹ Back to {r.requestNo}
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" onClick={print}>
            Print / PDF
          </Button>
        </div>
      </div>
      {!r.letterNo ? (
        <Alert tone="amber" title="Draft">
          Resolve the request to issue this letter with a reference number.
        </Alert>
      ) : null}
      <div className="bos-payslip-wrap">
        <article className="bos-inv-paper bos-offer-letter" aria-label={CERTIFICATE_KIND_LABEL[l.kind]}>
          <div className="bos-inv-paper-top">
            <div>
              <div className="bos-inv-paper-brand">{company}</div>
              {address ? <div className="bos-inv-paper-seller">{address}</div> : null}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="bos-inv-paper-title">{LETTER_TITLE[l.kind]}</div>
              <div className="bos-inv-paper-sub">
                {r.letterNo ? `Ref ${r.letterNo}` : "DRAFT"} · {dateLabel(r.letterOn ?? undefined)}
              </div>
            </div>
          </div>
          <p>{r.addressedTo ? `To ${r.addressedTo}` : "To whom it may concern"}</p>
          {body}
          <div className="bos-offer-sign">
            <div>
              <div className="bos-offer-sign-line" />
              For {company}
              <br />
              Authorised signatory
            </div>
            <div />
          </div>
          <div className="bos-payslip-note">Generated with Justx BOS.</div>
        </article>
      </div>
    </>
  );
}

/* ---------- Dialogs ---------- */

function RaiseDialog({ o, onClose, onRaised }: { o: Overview; onClose: () => void; onRaised: (id: string) => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    employeeId: "",
    type: "helpdesk" as ServiceType,
    certificateKind: "employment" as CertificateKind,
    subject: "",
    details: "",
    addressedTo: "",
    priority: "normal" as ServicePriority,
  }));
  const v = f.values;
  const certificate = v.type === "certificate";
  const people = o.employees.filter((e) => e.id !== o.me?.id && (certificate || e.status !== "exited"));
  return (
    <FormDialog
      open
      onClose={onClose}
      title="New request"
      description={o.manager ? "Raise it for yourself or on someone's behalf." : "HR is notified and replies here."}
      icon={{ tone: "blue", glyph: "🎧" }}
      submitLabel="Raise request"
      busy={busy === "raise"}
      wide
      onSubmit={async () => {
        const out = await run(
          "raise",
          () =>
            bos.raiseRequest({
              employeeId: v.employeeId || null,
              type: v.type,
              certificateKind: certificate ? v.certificateKind : null,
              subject: v.subject.trim() || undefined,
              details: v.details.trim() || null,
              addressedTo: certificate ? v.addressedTo.trim() || null : null,
              priority: v.priority,
            }),
          { success: "Request raised", description: v.subject.trim() || (certificate ? CERTIFICATE_KIND_LABEL[v.certificateKind] : SERVICE_TYPE_LABEL[v.type]) },
        );
        if (out) {
          onClose();
          onRaised(out.request.id);
        }
      }}
    >
      <FormGrid>
        {o.manager ? (
          <Field label="For">
            {({ id }) => (
              <Select id={id} required={!o.me} value={v.employeeId} onChange={(e) => f.set("employeeId")(e.target.value)}>
                <option value="">{o.me ? "Myself" : "Pick an employee"}</option>
                {people.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.status === "exited" ? " (left)" : e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.type} onChange={(e) => f.set("type")(e.target.value as ServiceType)}>
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {SERVICE_TYPE_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {certificate ? (
          <>
            <Field label="Certificate" hint={v.certificateKind === "experience" ? "For someone who has left or is serving notice" : v.certificateKind === "salary" ? "Shows the CTC on the employee record" : "Confirms current employment"}>
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={v.certificateKind} onChange={(e) => f.set("certificateKind")(e.target.value as CertificateKind)}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CERTIFICATE_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Addressed to" hint="Optional — otherwise “To whom it may concern”">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={200} value={v.addressedTo} placeholder="e.g. The Visa Officer, German Consulate" onChange={(e) => f.set("addressedTo")(e.target.value)} />}
            </Field>
          </>
        ) : (
          <Field label="Subject" full={!o.manager}>
            {({ id }) => <Input id={id} required maxLength={200} value={v.subject} placeholder="e.g. Replacement ID card" onChange={(e) => f.set("subject")(e.target.value)} />}
          </Field>
        )}
        <Field label="Priority">
          {({ id }) => (
            <Select id={id} value={v.priority} onChange={(e) => f.set("priority")(e.target.value as ServicePriority)}>
              {(["low", "normal", "high"] as const).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FormGrid>
      <Field label={certificate ? "Purpose" : "Details"}>
        {({ id }) => (
          <Textarea id={id} rows={3} maxLength={5000} value={v.details} placeholder={certificate ? "e.g. a visa application — shown on the letter" : "What happened, what you need…"} onChange={(e) => f.set("details")(e.target.value)} />
        )}
      </Field>
    </FormDialog>
  );
}

function EditDialog({ request: r, manager, onClose }: { request: ServiceRequest; manager: boolean; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ subject: r.subject, details: r.details ?? "", addressedTo: r.addressedTo ?? "", priority: r.priority }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Edit ${r.requestNo}`}
      icon={{ tone: "blue", name: "edit" }}
      submitLabel="Save"
      busy={busy === "edit"}
      wide
      onSubmit={async () => {
        const out = await run(
          "edit",
          () =>
            bos.updateRequest(r.id, {
              subject: v.subject.trim(),
              details: v.details.trim() || null,
              ...(r.type === "certificate" ? { addressedTo: v.addressedTo.trim() || null } : {}),
              ...(manager ? { priority: v.priority } : {}),
            }),
          { success: "Request updated", description: r.requestNo },
        );
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Subject" full={!manager}>
          {({ id }) => <Input id={id} required maxLength={200} value={v.subject} onChange={(e) => f.set("subject")(e.target.value)} />}
        </Field>
        {manager ? (
          <Field label="Priority">
            {({ id }) => (
              <Select id={id} value={v.priority} onChange={(e) => f.set("priority")(e.target.value as ServicePriority)}>
                {(["low", "normal", "high"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {r.type === "certificate" ? (
          <Field label="Addressed to" full>
            {({ id }) => <Input id={id} maxLength={200} value={v.addressedTo} placeholder="To whom it may concern" onChange={(e) => f.set("addressedTo")(e.target.value)} />}
          </Field>
        ) : null}
      </FormGrid>
      <Field label={r.type === "certificate" ? "Purpose" : "Details"}>
        {({ id }) => <Textarea id={id} rows={3} maxLength={5000} value={v.details} onChange={(e) => f.set("details")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function ResolveDialog({ request: r, onClose }: { request: ServiceRequest; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [note, setNote] = useState("");
  const letter = r.type === "certificate";
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Resolve ${r.requestNo}`}
      description={
        letter
          ? `Issues the ${r.certificateKind ? CERTIFICATE_KIND_LABEL[r.certificateKind].toLowerCase() : "letter"}${r.letterNo ? ` (${r.letterNo})` : " with the next reference number"}. ${r.employeeName} can then download it here.`
          : `${r.employeeName} is notified.`
      }
      icon={{ tone: "emerald", name: "check" }}
      submitLabel={letter ? "Resolve & issue" : "Resolve"}
      busy={busy === "resolve"}
      onSubmit={async () => {
        const out = await run("resolve", () => bos.resolveRequest(r.id, note.trim() || null), { success: letter ? "Letter issued" : "Request resolved", description: r.requestNo });
        if (out) onClose();
      }}
    >
      <Field label="Note" hint="Optional — shown to the requester">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
