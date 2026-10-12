"use client";

import "./insights.css";
import { useEffect, useState } from "react";
import { Alert, Button, Card, DataTable, Dialog, EmptyState, Field, FilterChip, FormGrid, Input, Segmented, Select, Switch, Textarea, type BosColumn } from "@/components/bos";
import { ErrorBlock, Loaded, StatusBadge, useIms, useImsAction, useImsData } from "../core";
import type { Period } from "@/lib/ims/api";
import {
  APPROVAL_META,
  REPORT_CATALOG,
  REPORT_SCHEDULES,
  SCHEDULE_LABEL,
  catalogEntry,
  reports,
  type ReportApprovalStatus,
  type ReportFilterKey,
  type ReportFilters,
  type ReportMeta,
  type ReportResult,
  type ReportSchedule,
  type ReportType,
  type SavedReport,
  type SavedReportInput,
} from "@/lib/ims/reports";
import { addDaysISO, dateLabel, dateRange, downloadCsv, downloadXlsx, PERIOD_OPTIONS, timeAgo } from "@/lib/ims/format";
import { cellText, exportColumns, filterControls, filtersText, periodText, useDialog } from "./report-view";

export type SavedDraft = { type: ReportType; period: Period; from: string | null; to: string | null; filters: ReportFilters };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitEmails = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const PERIOD_CHOICES: ReadonlyArray<{ value: Period; label: string }> = [...PERIOD_OPTIONS, { value: "custom", label: "Custom range" }];
const periodLabel = (r: { period: Period; from: string | null; to: string | null }) =>
  r.period === "custom" && r.from && r.to ? dateRange(r.from, r.to) : (PERIOD_CHOICES.find((p) => p.value === r.period)?.label ?? r.period);

const approvalBadge = (s: ReportApprovalStatus) => ({ text: APPROVAL_META[s]?.label ?? s.toUpperCase(), tone: APPROVAL_META[s]?.tone ?? "neutral" });

/* ---------- Tab ---------- */

type Filter = ReportApprovalStatus | "all" | "due";

export function SavedReportsTab({
  meta,
  openId,
  today,
  onRun,
  onCreate,
}: {
  meta: ReportMeta | null;
  openId: string | null;
  today: string;
  onRun: (saved: SavedReport) => void;
  onCreate: () => void;
}) {
  const { can, session } = useIms();
  const state = useImsData(() => reports.saved(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [detailId, setDetailId] = useState<string | null>(openId);
  const edit = useDialog<SavedReport | null>(null);
  const send = useDialog<SavedReport | null>(null);
  const reject = useDialog<SavedReport | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedReport | null>(null);
  const { run, isBusy } = useImsAction();
  const meId = session.actor.userId;
  const canWrite = can("reports");

  return (
    <Loaded state={state} rows={2}>
      {({ reports: list, canApprove }) => {
        const pending = list.filter((r) => r.approvalStatus === "pending_approval");
        const due = list.filter((r) => r.nextRunOn && r.nextRunOn <= today);
        const shown = filter === "all" ? list : filter === "due" ? due : list.filter((r) => r.approvalStatus === filter);
        const detail = list.find((r) => r.id === detailId) ?? null;
        const mayEdit = (r: SavedReport) => canWrite && (r.createdBy === meId || canApprove);
        const columns: BosColumn<SavedReport>[] = [
          {
            key: "name",
            header: "Report",
            cell: (r) => (
              <div className="ims-cell-stack">
                <span className="ims-strong">{r.name}</span>
                <small>{r.typeLabel}</small>
              </div>
            ),
          },
          { key: "period", header: "Period", cell: (r) => periodLabel(r) },
          {
            key: "schedule",
            header: "Schedule",
            cell: (r) =>
              r.schedule === "none" ? (
                <span className="ims-faint">On demand</span>
              ) : !r.active ? (
                <span className="ims-faint">{SCHEDULE_LABEL[r.schedule]} · paused</span>
              ) : (
                <div className="ims-cell-stack">
                  <span>{SCHEDULE_LABEL[r.schedule]}</span>
                  <small style={r.nextRunOn && r.nextRunOn <= today ? { color: "var(--bos-amber-600, var(--bos-amber))" } : undefined}>
                    {r.nextRunOn ? (r.nextRunOn <= today ? "Due now" : `Next ${dateLabel(r.nextRunOn)}`) : ""}
                  </small>
                </div>
              ),
          },
          { key: "to", header: "Recipients", align: "right", cell: (r) => (r.recipients.length ? r.recipients.length : <span className="ims-faint">—</span>) },
          { key: "status", header: "Status", cell: (r) => <StatusBadge view={approvalBadge(r.approvalStatus)} auto /> },
          { key: "last", header: "Last run", mono: true, cell: (r) => (r.lastRunAt ? timeAgo(r.lastRunAt) : "Never") },
          { key: "by", header: "Owner", cell: (r) => r.createdByName ?? "—" },
        ];
        return (
          <div className="bos-stack" style={{ gap: 16 }}>
            {canApprove && pending.length ? (
              <Alert
                tone="amber"
                title={`${pending.length} report${pending.length === 1 ? "" : "s"} waiting on your approval`}
                actions={
                  <Button size="sm" onClick={() => setFilter("pending_approval")}>
                    Review
                  </Button>
                }
              >
                Approved reports can be shared with their recipients.
              </Alert>
            ) : null}
            {due.length ? (
              <Alert
                tone="blue"
                title={`${due.length} scheduled report${due.length === 1 ? " is" : "s are"} due`}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => setFilter("due")}>
                    Show
                  </Button>
                }
              >
                Schedules are reminders — automatic emailing isn&apos;t configured, so run and send them from here.
              </Alert>
            ) : null}
            <Card interactive={false}>
              <div className="ims-toolbar">
                <div className="ims-row ims-grow" role="group" aria-label="Filter saved reports">
                  {(
                    [
                      ["all", `All · ${list.length}`],
                      ["draft", "Draft"],
                      ["pending_approval", `Pending · ${pending.length}`],
                      ["approved", "Approved"],
                      ["sent", "Sent"],
                      ["due", `Due · ${due.length}`],
                    ] as Array<[Filter, string]>
                  ).map(([k, label]) => (
                    <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}>
                      {label}
                    </FilterChip>
                  ))}
                </div>
                {canWrite ? (
                  <Button size="sm" variant="primary" icon="plus" onClick={onCreate}>
                    New saved report
                  </Button>
                ) : null}
              </div>
              {list.length ? (
                <DataTable columns={columns} rows={shown} rowKey={(r) => r.id} onRowClick={(r) => setDetailId(r.id)} chevron compact empty="No reports in this view." caption="Saved reports" />
              ) : (
                <EmptyState
                  icon="file"
                  title="No saved reports yet"
                  actions={
                    canWrite ? (
                      <Button variant="primary" icon="plus" onClick={onCreate}>
                        Save a report
                      </Button>
                    ) : undefined
                  }
                >
                  Save a report with its period and filters, schedule it, get it approved and share it with your CA or partners.
                </EmptyState>
              )}
            </Card>

            <SavedDetailDialog
              report={detailId ? detail : null}
              loading={Boolean(detailId && !detail)}
              onClose={() => setDetailId(null)}
              canApprove={canApprove}
              canWrite={canWrite}
              mayEdit={detail ? mayEdit(detail) : false}
              busy={isBusy}
              onRun={(r) => {
                setDetailId(null);
                onRun(r);
              }}
              onEdit={(r) => {
                setDetailId(null);
                edit.show(r);
              }}
              onSubmit={(r) => void run("submit", () => reports.submit(r.id), { success: "Sent for approval" })}
              onApprove={(r) => void run("approve", () => reports.approve(r.id), { success: `Approved “${r.name}”` })}
              onReject={(r) => reject.show(r)}
              onSend={(r) => send.show(r)}
              onToggle={(r) => void run("toggle", () => reports.updateSaved(r.id, { active: !r.active }), { success: r.active ? "Schedule paused" : "Schedule resumed" })}
              onDelete={(r) => setConfirmDelete(r)}
            />
            <SavedReportDialog key={`ed-${edit.seq}`} open={edit.open} onClose={edit.hide} meta={meta} saved={edit.value} draft={null} today={today} />
            <SendDialog key={`sd-${send.seq}`} open={send.open} onClose={send.hide} saved={send.value} meta={meta} />
            <RejectDialog key={`rj-${reject.seq}`} open={reject.open} onClose={reject.hide} saved={reject.value} />
            <Dialog
              open={Boolean(confirmDelete)}
              onClose={() => setConfirmDelete(null)}
              title="Delete saved report?"
              description={confirmDelete ? `“${confirmDelete.name}” and its schedule will be removed. Past exports aren't affected.` : undefined}
              icon={{ tone: "coral", name: "warning" }}
              actions={
                <>
                  <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isBusy("delete")}
                    onClick={async () => {
                      if (!confirmDelete) return;
                      const id = confirmDelete.id;
                      const ok = await run("delete", () => reports.deleteSaved(id).then(() => true), { success: "Report deleted" });
                      if (ok) {
                        setConfirmDelete(null);
                        setDetailId(null);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </>
              }
            />
          </div>
        );
      }}
    </Loaded>
  );
}

/* ---------- Detail ---------- */

function SavedDetailDialog({
  report: r,
  loading,
  onClose,
  canApprove,
  canWrite,
  mayEdit,
  busy,
  onRun,
  onEdit,
  onSubmit,
  onApprove,
  onReject,
  onSend,
  onToggle,
  onDelete,
}: {
  report: SavedReport | null;
  loading: boolean;
  onClose: () => void;
  canApprove: boolean;
  canWrite: boolean;
  mayEdit: boolean;
  busy: (key: string) => boolean;
  onRun: (r: SavedReport) => void;
  onEdit: (r: SavedReport) => void;
  onSubmit: (r: SavedReport) => void;
  onApprove: (r: SavedReport) => void;
  onReject: (r: SavedReport) => void;
  onSend: (r: SavedReport) => void;
  onToggle: (r: SavedReport) => void;
  onDelete: (r: SavedReport) => void;
}) {
  const facts: Array<[string, string]> = r
    ? [
        ["Report", r.typeLabel],
        ["Period", periodLabel(r)],
        ["Format", r.format.toUpperCase()],
        ["Schedule", r.schedule === "none" ? "On demand" : `${SCHEDULE_LABEL[r.schedule]}${r.active ? "" : " (paused)"}${r.nextRunOn ? ` · next ${dateLabel(r.nextRunOn)}` : ""}`],
        ["Recipients", r.recipients.length ? r.recipients.join(", ") : "None yet"],
        ["Owner", r.createdByName ?? "—"],
        ["Last run", r.lastRunAt ? `${dateLabel(r.lastRunAt)} (${timeAgo(r.lastRunAt)})` : "Never"],
        ...(r.approvedByName ? ([["Approved by", `${r.approvedByName}${r.approvedAt ? ` · ${dateLabel(r.approvedAt)}` : ""}`]] as Array<[string, string]>) : []),
        ...(r.sentAt ? ([["Last shared", `${dateLabel(r.sentAt)} → ${r.sentTo ?? ""}`]] as Array<[string, string]>) : []),
      ]
    : [];
  return (
    <Dialog
      open={Boolean(r) || loading}
      onClose={onClose}
      title={r?.name ?? "Saved report"}
      description={r ? <StatusBadge view={approvalBadge(r.approvalStatus)} auto /> : undefined}
      icon={{ tone: "blue", name: "file" }}
      wide
      actionsNote={
        r && mayEdit ? (
          <span className="ims-row" style={{ gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={() => onDelete(r)}>
              Delete
            </Button>
            {r.schedule !== "none" ? (
              <Button size="sm" variant="ghost" onClick={() => onToggle(r)} disabled={busy("toggle")}>
                {r.active ? "Pause schedule" : "Resume schedule"}
              </Button>
            ) : null}
          </span>
        ) : undefined
      }
      actions={
        r ? (
          <>
            {mayEdit ? (
              <Button size="sm" icon="edit" onClick={() => onEdit(r)}>
                Edit
              </Button>
            ) : null}
            <Button size="sm" icon="refresh" onClick={() => onRun(r)}>
              Run now
            </Button>
            {mayEdit && r.approvalStatus === "draft" ? (
              <Button size="sm" variant="primary" onClick={() => onSubmit(r)} disabled={busy("submit")}>
                Submit for approval
              </Button>
            ) : null}
            {canApprove && r.approvalStatus === "pending_approval" ? (
              <>
                <Button size="sm" variant="destructive" onClick={() => onReject(r)}>
                  Send back
                </Button>
                <Button size="sm" variant="success" icon="check" onClick={() => onApprove(r)} disabled={busy("approve")}>
                  Approve
                </Button>
              </>
            ) : null}
            {canWrite && (r.approvalStatus === "approved" || r.approvalStatus === "sent") ? (
              <Button size="sm" variant="primary" onClick={() => onSend(r)}>
                {r.approvalStatus === "sent" ? "Send again" : "Send"}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {!r ? (
        <div className="ims-muted">This report was deleted or isn&apos;t available.</div>
      ) : (
        <div className="bos-stack" style={{ gap: 14 }}>
          {r.approvalStatus === "draft" && r.reviewNote ? (
            <Alert tone="amber" title="Sent back by the approver">
              {r.reviewNote}
            </Alert>
          ) : null}
          {r.approvalStatus === "pending_approval" && !canApprove ? (
            <Alert tone="blue" title="Waiting for approval">
              Someone with the Approvals permission needs to approve it before it can be sent.
            </Alert>
          ) : null}
          <dl className="ims-rp-kv">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd style={{ textAlign: "right", overflowWrap: "anywhere" }}>{v}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(r.filters).length ? <div className="ims-faint">Filters: {Object.entries(r.filters).map(([k, v]) => `${k} = ${v}`).join(" · ")}</div> : null}
        </div>
      )}
    </Dialog>
  );
}

/* ---------- Create / edit ---------- */

export function SavedReportDialog({
  open,
  onClose,
  meta,
  saved,
  draft,
  today,
}: {
  open: boolean;
  onClose: () => void;
  meta: ReportMeta | null;
  saved: SavedReport | null;
  draft: SavedDraft | null;
  today: string;
}) {
  const { run, isBusy } = useImsAction();
  const base = saved ?? draft;
  const [name, setName] = useState(saved?.name ?? (draft ? `${catalogEntry(draft.type).label} — ${PERIOD_CHOICES.find((p) => p.value === draft.period)?.label ?? ""}` : ""));
  const [type, setType] = useState<ReportType>(base?.type ?? "fullstock");
  const [period, setPeriod] = useState<Period>(base?.period ?? "30d");
  const [from, setFrom] = useState(base?.from ?? addDaysISO(today, -29));
  const [to, setTo] = useState(base?.to ?? today);
  const [filters, setFilters] = useState<ReportFilters>(base?.filters ?? {});
  const [format, setFormat] = useState<"csv" | "xlsx">(saved?.format ?? "xlsx");
  const [schedule, setSchedule] = useState<ReportSchedule>(saved?.schedule ?? "none");
  const [recipients, setRecipients] = useState((saved?.recipients ?? []).join(", "));
  const [active, setActive] = useState(saved?.active ?? true);
  const [touched, setTouched] = useState(false);

  const entry = catalogEntry(type);
  const emails = splitEmails(recipients);
  const badEmails = emails.filter((e) => !EMAIL_RE.test(e));
  const errors = {
    name: name.trim().length < 2 ? "Give the report a name" : undefined,
    range: period === "custom" && (!from || !to || from > to) ? "Pick a valid date range" : undefined,
    recipients: badEmails.length ? `Check: ${badEmails.join(", ")}` : emails.length > 20 ? "Up to 20 recipients" : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const resets = Boolean(saved && (saved.approvalStatus === "approved" || saved.approvalStatus === "sent"));

  const setF = (key: ReportFilterKey, value: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  const changeType = (t: ReportType) => {
    setType(t);
    const allowed = new Set<string>(catalogEntry(t).filters);
    setFilters((f) => Object.fromEntries(Object.entries(f).filter(([k]) => allowed.has(k))) as ReportFilters);
  };

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const body: SavedReportInput = {
      name: name.trim(),
      type,
      period,
      from: period === "custom" ? from : null,
      to: period === "custom" ? to : null,
      filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => Boolean(v))) as ReportFilters,
      format,
      schedule,
      recipients: [...new Set(emails)],
      active,
    };
    const ok = saved
      ? await run("save-report", () => reports.updateSaved(saved.id, body), { success: "Report updated" })
      : await run("save-report", () => reports.createSaved(body), { success: "Report saved as draft", description: "Submit it for approval when it's ready to share." });
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={saved ? "Edit saved report" : "Save & schedule a report"}
      icon={{ tone: "blue", name: "file" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={isBusy("save-report") || (touched && invalid)}>
            {saved ? "Save changes" : "Save report"}
          </Button>
        </>
      }
    >
      <div className="bos-stack" style={{ gap: 14 }}>
        {resets ? (
          <Alert tone="amber" title="This report is approved">
            Changing its name, report, period, filters or format sends it back to draft for re-approval. Schedule and recipient changes don&apos;t.
          </Alert>
        ) : null}
        <FormGrid>
          <Field label="Name *" error={show("name")} full>
            {({ id, describedBy, invalid: bad }) => <Input id={id} aria-describedby={describedBy} aria-invalid={bad} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="e.g. Monthly stock valuation for CA" />}
          </Field>
          <Field label="Report">
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => changeType(e.target.value as ReportType)}>
                {REPORT_CATALOG.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.group} · {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Period" hint={entry.usesPeriod ? undefined : "This report is a point-in-time snapshot; the period is ignored."} error={show("range")}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {PERIOD_CHOICES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {period === "custom" ? (
            <>
              <Field label="From">{({ id }) => <Input id={id} type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label="To">{({ id }) => <Input id={id} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />}</Field>
            </>
          ) : null}
          {filterControls(entry, meta, filters, setF, "md").map((c) => (
            <Field key={c.key} label={c.label}>
              {({ id }) => c.render(id)}
            </Field>
          ))}
          <Field label="File format">
            {() => (
              <Segmented
                size="sm"
                role="radio"
                aria-label="File format"
                value={format}
                onChange={setFormat}
                options={[
                  { value: "xlsx", label: "Excel" },
                  { value: "csv", label: "CSV" },
                ]}
              />
            )}
          </Field>
          <Field label="Schedule" hint="A reminder to run and send — automatic emailing isn't configured.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={schedule} onChange={(e) => setSchedule(e.target.value as ReportSchedule)}>
                {REPORT_SCHEDULES.map((s) => (
                  <option key={s} value={s}>
                    {s === "none" ? "On demand (no schedule)" : SCHEDULE_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Recipients" hint="Email addresses, separated by commas" error={show("recipients")} full>
            {({ id, describedBy, invalid: bad }) => (
              <Textarea id={id} aria-describedby={describedBy} aria-invalid={bad} rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ca@firm.in, partner@business.in" />
            )}
          </Field>
          {schedule !== "none" ? (
            <div className="ims-row bos-form-grid-full" style={{ gap: 10 }}>
              <Switch checked={active} onChange={setActive} aria-label="Schedule active" />
              <span>{active ? "Schedule active" : "Schedule paused"}</span>
            </div>
          ) : null}
        </FormGrid>
      </div>
    </Dialog>
  );
}

/* ---------- Send back ---------- */

function RejectDialog({ open, onClose, saved }: { open: boolean; onClose: () => void; saved: SavedReport | null }) {
  const { run, isBusy } = useImsAction();
  const [note, setNote] = useState("");
  const submit = async () => {
    if (!saved) return;
    const ok = await run("reject", () => reports.reject(saved.id, note.trim() || undefined), { success: "Sent back to draft", tone: "amber" });
    if (ok) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send back · ${saved?.name ?? ""}`}
      description="The owner sees your note and can resubmit."
      icon={{ tone: "amber", name: "edit" }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={isBusy("reject")}>
            Send back
          </Button>
        </>
      }
    >
      <Field label="What needs to change?">
        {({ id }) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus placeholder="e.g. Use last month instead of 30 days and filter to Paints only" />}
      </Field>
    </Dialog>
  );
}

/* ---------- Send (mailto) ---------- */

function composeBody(saved: SavedReport, report: ReportResult, filters: string[], sender: string | null, file: string): string {
  const lines = [
    `${saved.name} — ${report.title}`,
    `Period: ${periodText(report)}`,
    ...(filters.length ? [`Filters: ${filters.join(" · ")}`] : []),
    `Generated: ${new Date(report.generatedAt).toLocaleString("en-IN")}`,
    "",
    "Highlights",
    ...report.summary.map((s) => `• ${s.label}: ${typeof s.value === "number" ? cellText(s.value, s.kind, true) : s.value}`),
    "",
    `${report.rows.length.toLocaleString("en-IN")} rows — full detail in the attached ${file}.`,
    ...(saved.approvedByName ? [`Approved by ${saved.approvedByName}.`] : []),
    "",
    `— ${sender ?? "Sent"} via Justx IMS`,
  ];
  return lines.join("\n");
}

function SendDialog({ open, onClose, saved, meta }: { open: boolean; onClose: () => void; saved: SavedReport | null; meta: ReportMeta | null }) {
  const { session } = useIms();
  const { run, isBusy } = useImsAction();
  const [to, setTo] = useState((saved?.recipients ?? []).join(", "));
  const [touched, setTouched] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [mailed, setMailed] = useState(false);
  const [result, setResult] = useState<{ report: ReportResult | null; error: unknown }>({ report: null, error: null });

  useEffect(() => {
    if (!open || !saved) return;
    let alive = true;
    reports
      .run({ type: saved.type, period: saved.period, from: saved.from ?? undefined, to: saved.to ?? undefined, ...saved.filters })
      .then(
        (r) => {
          if (alive) setResult({ report: r.report, error: null });
        },
        (error: unknown) => {
          if (alive) setResult({ report: null, error });
        },
      );
    return () => {
      alive = false;
    };
  }, [open, saved]);

  const emails = splitEmails(to);
  const bad = emails.filter((e) => !EMAIL_RE.test(e));
  const toError = touched && (!emails.length ? "Add at least one recipient" : bad.length ? `Check: ${bad.join(", ")}` : undefined);
  const report = result.report;
  const file = saved ? `${saved.name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "report"}.${saved.format}` : "report";
  const filters = saved && report ? filtersText(catalogEntry(saved.type), meta, saved.filters) : [];
  const body = saved && report ? composeBody(saved, report, filters, session.actor.name, file) : "";
  const subject = saved && report ? `${saved.name} · ${periodText(report)}` : "";
  const mailto = emails.length && !bad.length && body ? `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}` : null;

  const download = async () => {
    if (!saved || !report) return;
    const cols = exportColumns(report);
    if (saved.format === "csv") downloadCsv(file, report.rows, cols);
    else await downloadXlsx(file, report.title, report.rows, cols);
    setDownloaded(true);
  };

  const markSent = async () => {
    setTouched(true);
    if (!saved || !emails.length || bad.length) return;
    const ok = await run("mark-sent", () => reports.markSent(saved.id, [...new Set(emails)]), { success: "Marked as sent", description: `Shared with ${emails.join(", ")}` });
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send · ${saved?.name ?? ""}`}
      icon={{ tone: "blue", name: "file" }}
      wide
      actionsNote={mailed ? "Sent it? Record it so the team knows." : undefined}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="check" onClick={markSent} disabled={isBusy("mark-sent") || !report}>
            Mark as sent
          </Button>
        </>
      }
    >
      <div className="bos-stack" style={{ gap: 14 }}>
        <Alert tone="amber" title="Automatic emailing isn't configured">
          Justx IMS doesn&apos;t send email on its own yet. Download the file, open the pre-filled email in your mail app, attach the file and send — then mark it as sent here.
        </Alert>
        <Field label="To" error={toError || undefined} hint="Comma-separated email addresses">
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={to} onChange={(e) => setTo(e.target.value)} placeholder="ca@firm.in" />}
        </Field>
        {result.error ? (
          <ErrorBlock error={result.error} />
        ) : !report ? (
          <div className="ims-muted">Preparing the report summary…</div>
        ) : (
          <>
            <div>
              <div className="ims-faint" style={{ marginBottom: 6 }}>
                Subject: {subject}
              </div>
              <div className="ims-rp-mail" aria-label="Email body preview">
                {body}
              </div>
            </div>
            <ol className="ims-rp-steps">
              <li>
                <Button size="sm" variant={downloaded ? "ghost" : "secondary"} icon={downloaded ? "check" : "download"} onClick={download}>
                  {downloaded ? `Downloaded ${file}` : `Download ${saved?.format === "csv" ? "CSV" : "Excel"} file`}
                </Button>
              </li>
              <li>
                {mailto ? (
                  <a className="bos-btn bos-btn-secondary bos-btn-sm" href={mailto} onClick={() => setMailed(true)}>
                    Open in email app
                  </a>
                ) : (
                  <span className="ims-faint">Add valid recipients to open the email.</span>
                )}
              </li>
              <li>Attach the downloaded file, send it, then click “Mark as sent”.</li>
            </ol>
          </>
        )}
      </div>
    </Dialog>
  );
}
