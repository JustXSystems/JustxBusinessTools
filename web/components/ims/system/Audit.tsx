"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, FilterChip, FormGrid, Grid, Input, KpiCard, SearchInput, Segmented, Select, Textarea, cx, type BosColumn } from "@/components/bos";
import { ims, type ImsEvent, type ImsMember, type ImsModuleKey, type ImsRole, type Period } from "@/lib/ims/api";
import { dateLabel, dateRange, downloadCsv, downloadXlsx, inr, qtyText, readSheet, stampLabel, timeAgo, todayLocal, type ExportColumn } from "@/lib/ims/format";
import {
  AUDIT_AREA_LABEL,
  AUDIT_STATUS_LABEL,
  AUDIT_STATUS_TONE,
  DOC_CATEGORY_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  SYNC_TONE,
  fileSize,
  imsSystem,
  isTraceType,
  readAsDataUrl,
  saveBlob,
  type AgingLedgerRow,
  type AuditArea,
  type AuditCategory,
  type AuditDocCategory,
  type AuditDocument,
  type AuditEntity,
  type AuditEntityType,
  type AuditHealth,
  type AuditIssue,
  type AuditItem,
  type AuditItemInput,
  type AuditItemStatus,
  type AuditSeverity,
  type BankImportResult,
  type BankSuggestion,
  type BankTxn,
  type BookVoucher,
  type BookVoucherType,
  type BooksReport,
  type ExpenseLedgerRow,
  type Gstr2bResult,
  type Gstr2bRow,
  type Gstr2bStatus,
  type InventoryLedgerRow,
  type LedgerKind,
  type LedgerResponse,
  type PurchaseLedgerRow,
  type SalesLedgerRow,
  type SyncLogEntry,
  type SyncStatus,
  type TallyExportType,
  type TraceState,
  type TraceType,
} from "@/lib/ims/system";
import { askGemini, auditSystem, dataPrompt, type GeminiTurn } from "@/lib/ims/assistant";
import { readGstr2bFile } from "@/lib/ims/gstr2b";
import { AskDialog, geminiFailNote, useGemini, type AskResult } from "../AskAi";
import { Loaded, PageHeader, PeriodPicker, PersonAvatar, RequirePerm, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { ConfirmDialog, KeyValues, ReplyBox, Thread, ToolHead, useDebounced } from "./shared";

type Tab = "overview" | "issues" | "ledgers" | "statements" | "banking" | "gst" | "documents" | "queries" | "trail" | "integrations" | "access";
type Opener = (type: string | null, id: string | null) => void;
type Tracer = (type: string | null, id: string | null) => void;
type Prefill = Partial<AuditItemInput>;

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "issues", label: "Findings" },
  { value: "ledgers", label: "Ledgers" },
  { value: "statements", label: "Financial statements" },
  { value: "banking", label: "Bank reconciliation" },
  { value: "gst", label: "GST" },
  { value: "documents", label: "Documents" },
  { value: "queries", label: "Flags & queries" },
  { value: "trail", label: "Audit trail" },
  { value: "integrations", label: "Integrations" },
  { value: "access", label: "Access" },
];
const PERIOD_TABS: ReadonlyArray<Tab> = ["overview", "issues", "ledgers", "statements", "gst"];
const SEVERITIES: ReadonlyArray<AuditSeverity> = ["critical", "high", "medium", "low"];
const ITEM_STATUSES: ReadonlyArray<AuditItemStatus> = ["open", "responded", "resolved", "dismissed"];
const AREAS = Object.keys(AUDIT_AREA_LABEL) as AuditArea[];
const DOC_CATEGORIES = Object.keys(DOC_CATEGORY_LABEL) as AuditDocCategory[];
const LINKABLE: ReadonlyArray<{ value: AuditEntityType; label: string }> = [
  { value: "invoice", label: "Sales invoice" },
  { value: "bill", label: "Purchase bill" },
  { value: "po", label: "Purchase order" },
  { value: "payment", label: "Payment / receipt" },
  { value: "expense", label: "Expense" },
  { value: "party", label: "Customer / supplier" },
  { value: "item", label: "Item" },
];
const ROLE_LABEL: Record<ImsRole, string> = {
  owner: "Owner",
  manager: "Manager",
  incharge: "Store in-charge",
  staff: "Staff",
  accountant: "Accountant",
  auditor: "Auditor / CA",
  field: "Field staff",
  viewer: "Viewer",
};
const GRADE_TEXT: Record<AuditHealth["grade"], string> = {
  A: "Books look clean",
  B: "A few items to tidy up",
  C: "Several items need attention",
  D: "Significant gaps to fix",
  E: "Books need urgent attention",
};

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function entityTarget(type: string | null, id: string | null): { module: ImsModuleKey; intent?: string } | null {
  const open = id ? `open:${id}` : undefined;
  switch (type) {
    case "invoice":
      return { module: "sales", intent: open };
    case "bill":
      return { module: "payables", intent: open };
    case "po":
      return { module: "purchase", intent: open };
    case "item":
      return id ? { module: "items", intent: open } : null;
    case "party":
      return id ? { module: "parties", intent: open } : null;
    case "payment":
      return { module: "receivables" };
    case "expense":
      return { module: "closing" };
    case "return":
      return { module: "returns", intent: open };
    case "ledger":
      return { module: "ledger" };
    case "integration":
      return { module: "integrations" };
    default:
      return null;
  }
}
const canOpenEntity = (type: string | null, id: string | null) => type === "bank" || (type === "audit" && Boolean(id)) || entityTarget(type, id) !== null;

function areaForIssue(i: AuditIssue): AuditArea {
  if (i.category === "gst") return "gst";
  if (i.category === "bank") return "banking";
  if (i.category === "ar" || i.category === "ap") return "aging";
  if (i.category === "stock") return "inventory";
  switch (i.entityType) {
    case "invoice":
      return "sales";
    case "bill":
    case "po":
      return "purchases";
    case "expense":
      return "expenses";
    case "payment":
    case "party":
      return "aging";
    case "item":
      return "inventory";
    default:
      return "other";
  }
}

function cell(main: ReactNode, sub?: ReactNode, strong?: boolean) {
  return (
    <span className="ims-cell-stack">
      <span className={strong ? "ims-strong" : undefined}>{main}</span>
      {sub ? <small>{sub}</small> : null}
    </span>
  );
}

export function AuditModule() {
  return (
    <RequirePerm perm={["audit", "reports"]} what="the auditor workspace">
      <AuditWorkspace />
    </RequirePerm>
  );
}

function AuditWorkspace() {
  const { takeIntent, can, navigate } = useIms();
  const [intent] = useState(() => takeIntent("audit"));
  const [tab, setTab] = useState<Tab>(() => (intent?.startsWith("open:") ? "queries" : TABS.some((t) => t.value === intent) ? (intent as Tab) : "overview"));
  const [period, setPeriod] = useState<Period>("fytd");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [openItem, setOpenItem] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [raising, setRaising] = useState<{ seq: number; prefill: Prefill } | null>(null);
  const [asking, setAsking] = useState(false);
  const [tracing, setTracing] = useState<{ type: TraceType; id: string } | null>(null);
  const canWrite = can("audit");
  const trace: Tracer = (type, id) => {
    if (isTraceType(type) && id) setTracing({ type, id });
  };

  const openEntity: Opener = (type, id) => {
    if (type === "bank") {
      setTab("banking");
      return;
    }
    if (type === "audit" && id) {
      setOpenItem(id);
      return;
    }
    const target = entityTarget(type, id);
    if (target) navigate(target.module, target.intent);
  };
  const raise = (prefill: Prefill) => setRaising({ seq: Date.now(), prefill });

  return (
    <Stack>
      <PageHeader
        title="Auditing / CA"
        sub="One workspace for your accountant or CA: automated checks, registers, bank reconciliation, GST, documents and queries — with a full audit trail."
        actions={
          <>
            <Button icon="sparkle" onClick={() => setAsking(true)}>
              Ask Audit AI
            </Button>
            {canWrite ? (
              <Button variant="primary" icon="plus" onClick={() => raise({ kind: "query" })}>
                New flag or query
              </Button>
            ) : null}
          </>
        }
      />
      <SubTabs label="Auditor workspace" value={tab} onChange={setTab} options={TABS} />
      {PERIOD_TABS.includes(tab) ? (
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          {!canWrite ? <span className="ims-sys-mini">Read-only — verifying findings and raising flags needs the Auditor permission.</span> : null}
        </div>
      ) : null}
      {tab === "overview" ? (
        <OverviewTab
          period={period}
          onCategory={(c) => {
            setCategory(c);
            setTab("issues");
          }}
          onTab={setTab}
        />
      ) : null}
      {tab === "issues" ? <IssuesTab period={period} category={category} onCategory={setCategory} canWrite={canWrite} onRaise={raise} onOpenEntity={openEntity} onTrace={trace} /> : null}
      {tab === "ledgers" ? <LedgersTab period={period} onOpenEntity={openEntity} /> : null}
      {tab === "statements" ? <StatementsTab period={period} onOpenEntity={openEntity} /> : null}
      {tab === "banking" ? <BankingTab onOpenEntity={openEntity} /> : null}
      {tab === "gst" ? <GstTab period={period} onTrace={trace} /> : null}
      {tab === "documents" ? <DocumentsTab onOpenEntity={openEntity} /> : null}
      {tab === "queries" ? <QueriesTab canWrite={canWrite} onOpen={setOpenItem} onNew={() => raise({ kind: "query" })} /> : null}
      {tab === "trail" ? <TrailTab onOpenEntity={openEntity} /> : null}
      {tab === "integrations" ? <IntegrationsTab period={period} /> : null}
      {tab === "access" ? <AccessTab /> : null}
      <AuditAskAi
        open={asking}
        period={period}
        onClose={() => setAsking(false)}
        onOpenEntity={(type, id) => {
          setAsking(false);
          openEntity(type, id);
        }}
        onTrace={(type, id) => {
          setAsking(false);
          trace(type, id);
        }}
      />
      <TraceDialog
        target={tracing}
        period={period}
        canWrite={canWrite}
        onClose={() => setTracing(null)}
        onTrace={trace}
        onOpenEntity={(type, id) => {
          setTracing(null);
          openEntity(type, id);
        }}
        onRaise={(p) => {
          setTracing(null);
          raise(p);
        }}
      />
      <ItemDialog id={openItem} canWrite={canWrite} onClose={() => setOpenItem(null)} onOpenEntity={openEntity} />
      <NewItemDialog
        key={raising?.seq ?? 0}
        open={raising !== null}
        prefill={raising?.prefill ?? {}}
        onClose={() => setRaising(null)}
        onCreated={(item) => {
          setRaising(null);
          setOpenItem(item.id);
        }}
      />
    </Stack>
  );
}

/* ---------- Document trail ---------- */

const TRACE_MARK: Record<TraceState, { glyph: string; label: string }> = {
  ok: { glyph: "✓", label: "In order" },
  warn: { glyph: "!", label: "Needs a look" },
  bad: { glyph: "✕", label: "Problem" },
  na: { glyph: "–", label: "Not applicable" },
};

function TraceDialog({
  target,
  period,
  canWrite,
  onClose,
  onTrace,
  onOpenEntity,
  onRaise,
}: {
  target: { type: TraceType; id: string } | null;
  period: Period;
  canWrite: boolean;
  onClose: () => void;
  onTrace: Tracer;
  onOpenEntity: Opener;
  onRaise: (p: Prefill) => void;
}) {
  return (
    <Dialog open={target !== null} onClose={onClose} wide title="Document trail" description="Follows the record from order to stock, bill or invoice, payment, bank, GST and Tally." icon={{ tone: "blue", name: "layers" }}>
      {target ? <TraceBody key={`${target.type}:${target.id}`} target={target} period={period} canWrite={canWrite} onTrace={onTrace} onOpenEntity={onOpenEntity} onRaise={onRaise} /> : null}
    </Dialog>
  );
}

function TraceBody({
  target,
  period,
  canWrite,
  onTrace,
  onOpenEntity,
  onRaise,
}: {
  target: { type: TraceType; id: string };
  period: Period;
  canWrite: boolean;
  onTrace: Tracer;
  onOpenEntity: Opener;
  onRaise: (p: Prefill) => void;
}) {
  const state = useImsData(() => imsSystem.trace(target.type, target.id, { period }), [target.type, target.id, period]);
  return (
    <Loaded state={state} rows={6}>
      {({ trace: t, findings }) => {
        const problems = t.steps.filter((s) => s.state === "bad").length;
        const checks = t.steps.filter((s) => s.state === "warn").length;
        return (
          <Stack gap={16}>
            <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="ims-strong" style={{ fontSize: 16 }}>
                  {t.title}
                </div>
                <span className="ims-sys-mini">{t.subtitle}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {problems ? <Badge tone="coral">{plural(problems, "problem")}</Badge> : null}
                {checks ? <Badge tone="amber">{plural(checks, "check")}</Badge> : null}
                {!problems && !checks ? <Badge tone="emerald">All in order</Badge> : null}
              </div>
            </div>
            <ol className="ims-trace" aria-label="Document trail">
              {t.steps.map((s, i) => (
                <li key={`${s.label}-${i}`} className={`ims-trace-step is-${s.state}`}>
                  <span className="ims-trace-dot" aria-label={TRACE_MARK[s.state].label} title={TRACE_MARK[s.state].label}>
                    {TRACE_MARK[s.state].glyph}
                  </span>
                  <div className="ims-trace-body">
                    <span className="ims-trace-label">{s.label}</span>
                    <span className="ims-trace-title">{s.title}</span>
                    <span className="ims-trace-detail">{s.detail}</span>
                  </div>
                  {s.link ? (
                    <Button size="sm" variant="ghost" onClick={() => (isTraceType(s.link?.type ?? null) ? onTrace(s.link?.type ?? null, s.link?.id ?? null) : onOpenEntity(s.link?.type ?? null, s.link?.id ?? null))}>
                      {isTraceType(s.link.type) ? "Trace" : "Open"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
            {findings.length ? (
              <Stack gap={8}>
                <b className="ims-strong">Audit findings on this record</b>
                <div className="ims-sys-issues">
                  {findings.map((i) => (
                    <div key={i.key} className={cx("ims-sys-issue", !i.open && "is-closed")}>
                      <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
                      <div style={{ minWidth: 0 }}>
                        <div className="ims-sys-issue-title">{i.title}</div>
                        <div className="ims-sys-issue-detail">{i.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Stack>
            ) : null}
            <Grid cols={2} min={260}>
              <Card interactive={false}>
                <Stack gap={8}>
                  <b className="ims-strong">Details</b>
                  <KeyValues rows={t.details} />
                </Stack>
              </Card>
              <Card interactive={false}>
                <Stack gap={8}>
                  <b className="ims-strong">Activity</b>
                  {t.events.length ? (
                    <ul className="ims-trace-events">
                      {t.events.slice(0, 12).map((e, i) => (
                        <li key={i}>
                          <span>{e.summary}</span>
                          <small>
                            {e.by ?? "System"} · {e.at ? timeAgo(e.at) : "—"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="ims-sys-mini">No recorded activity.</span>
                  )}
                </Stack>
              </Card>
            </Grid>
            <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
              {canWrite ? (
                <Button
                  icon="plus"
                  onClick={() =>
                    onRaise({
                      kind: "query",
                      title: `Query on ${t.title}`,
                      entityType: t.type,
                      entityId: t.id,
                      entityLabel: t.title.slice(0, 120),
                      area: t.type === "invoice" ? "sales" : t.type === "expense" ? "expenses" : t.type === "payment" ? "aging" : "purchases",
                    })
                  }
                >
                  Raise a query
                </Button>
              ) : (
                <span />
              )}
              {canOpenEntity(t.type, t.id) ? (
                <Button variant="primary" onClick={() => onOpenEntity(t.type, t.id)}>
                  Open record
                </Button>
              ) : null}
            </div>
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- GSTR-2B reconciliation ---------- */

const GSTR2B_LABEL: Record<Gstr2bStatus, { label: string; tone: "emerald" | "amber" | "coral" | "blue" }> = {
  matched: { label: "Matched", tone: "emerald" },
  mismatch: { label: "Differs", tone: "amber" },
  missing_2b: { label: "Not in 2B", tone: "coral" },
  missing_books: { label: "Not in books", tone: "blue" },
};

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { period: "custom" as const, from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};

function Gstr2bCard({ onTrace }: { onTrace: Tracer }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const [y, m] = todayLocal().split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  });
  const [upload, setUpload] = useState<{ file: string; rows: Gstr2bRow[]; detected: string | null } | null>(null);
  const [result, setResult] = useState<Gstr2bResult | null>(null);
  const [filter, setFilter] = useState<Gstr2bStatus | "">("");

  const match = async (rows: Gstr2bRow[], forMonth: string) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await imsSystem.gstr2b(rows, monthRange(forMonth)));
      setFilter("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't match the invoices.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const { rows, period: detected } = await readGstr2bFile(file);
      if (!rows.length) throw new Error("No B2B invoices found. Use the GSTR-2B JSON or Excel download from the GST portal.");
      const forMonth = detected ?? month;
      setMonth(forMonth);
      setUpload({ file: file.name, rows, detected });
      await match(rows, forMonth);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onMonth = (value: string) => {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    setMonth(value);
    if (upload) void match(upload.rows, value);
  };

  const d = result;
  const list = d ? (filter ? d.rows.filter((r) => r.status === filter) : d.rows) : [];
  const exportCols: ReadonlyArray<ExportColumn<Gstr2bResult["rows"][number]>> = [
    { header: "Status", value: (r) => GSTR2B_LABEL[r.status].label },
    { header: "Supplier GSTIN", value: (r) => r.gstin },
    { header: "Supplier", value: (r) => r.supplier },
    { header: "Invoice no", value: (r) => r.invoiceNo },
    { header: "Date", value: (r) => r.date ?? "" },
    { header: "Bill", value: (r) => r.bill?.no ?? "" },
    { header: "GST in books", value: (r) => r.bill?.tax ?? "" },
    { header: "GST in 2B", value: (r) => r.portal?.tax ?? "" },
    { header: "Difference", value: (r) => r.taxDiff },
    { header: "Note", value: (r) => r.note },
  ];

  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <ToolHead glyph="⇆" title="GSTR-2B reconciliation" sub="Upload the GSTR-2B JSON or Excel from the GST portal. Each supplier invoice is matched to your bills by GSTIN and invoice number (or amount and date). The file is read in your browser and nothing is saved." />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Input size="sm" type="month" aria-label="GSTR-2B return month" title="GSTR-2B return month" value={month} max={todayLocal().slice(0, 7)} disabled={busy} style={{ maxWidth: 170 }} onChange={(e) => onMonth(e.target.value)} />
            {d ? (
              <Button size="sm" variant="ghost" icon="download" onClick={() => downloadCsv(`GSTR2B_reconciliation_${d.range.from}_${d.range.to}.csv`, d.rows, exportCols)}>
                Export
              </Button>
            ) : null}
            <Button variant="primary" icon="file" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Matching…" : d ? "Upload another file" : "Upload GSTR-2B"}
            </Button>
            <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,.csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
        </div>
        {error ? <Alert tone="coral" title="Couldn't reconcile">{error}</Alert> : null}
        {d ? (
          <>
            <span className="ims-sys-mini">
              {upload?.file} · bills dated {dateRange(d.range.from, d.range.to)} (and earlier bills that 2B lists)
              {upload?.detected && upload.detected !== month ? " · this file is for a different month than the one selected" : ""}
            </span>
            <Grid cols={4} min={160}>
              <KpiCard interactive={false} label="Credit in your books" value={inr(d.summary.itcBooks)} chip={{ color: "blue", glyph: "📒" }} />
              <KpiCard interactive={false} label="Credit in GSTR-2B" value={inr(d.summary.itcPortal)} chip={{ color: "lavender", glyph: "🏛" }} />
              <KpiCard interactive={false} label="Credit at risk" value={inr(d.summary.itcAtRisk)} valueTone={d.summary.itcAtRisk > 0 ? "coral" : "emerald"} delta="Missing from 2B or lower in 2B" deltaTone="muted" chip={{ color: "amber", glyph: "!" }} />
              <KpiCard interactive={false} label="In 2B, not in books" value={inr(d.summary.itcNotBooked)} delta={plural(d.summary.counts.missing_books, "invoice")} deltaTone="muted" chip={{ color: "mint", glyph: "+" }} />
            </Grid>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <FilterChip active={filter === ""} onClick={() => setFilter("")}>
                All · {d.rows.length}
              </FilterChip>
              {(Object.keys(GSTR2B_LABEL) as Gstr2bStatus[]).map((s) => (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
                  {GSTR2B_LABEL[s].label} · {d.summary.counts[s]}
                </FilterChip>
              ))}
            </div>
            {list.length ? (
              <div className="ims-sys-issues">
                {list.slice(0, 200).map((r, i) => (
                  <div key={`${r.gstin}-${r.invoiceNo}-${r.bill?.id ?? i}`} className="ims-sys-issue">
                    <Badge tone={GSTR2B_LABEL[r.status].tone}>{GSTR2B_LABEL[r.status].label}</Badge>
                    <div style={{ minWidth: 0 }}>
                      <div className="ims-sys-issue-title">
                        {r.supplier || r.gstin} · {r.invoiceNo}
                      </div>
                      <div className="ims-sys-issue-detail">{r.note}</div>
                      <div className="ims-sys-issue-meta">
                        <span>{r.gstin}</span>
                        {r.date ? <span>{dateLabel(r.date)}</span> : null}
                        {r.bill ? <span>Books GST {inr(r.bill.tax)}</span> : null}
                        {r.portal ? <span>2B GST {inr(r.portal.tax)}</span> : null}
                      </div>
                    </div>
                    <div className="ims-sys-issue-actions">
                      {r.bill ? (
                        <Button size="sm" variant="ghost" onClick={() => onTrace("bill", r.bill?.id ?? null)}>
                          Trace bill
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {list.length > 200 ? <span className="ims-sys-mini">Showing 200 of {list.length}. Export for the full list.</span> : null}
              </div>
            ) : (
              <EmptyState title="Nothing in this group" />
            )}
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

/* ---------- Ask Audit AI: plain-language questions over the rule engine's findings ---------- */

const AUDIT_SUGGESTIONS = [
  "Give me a summary of open findings",
  "Why is GST different on these invoices?",
  "Show duplicate entries",
  "Which purchases are missing documents?",
  "Invoices without payment pending more than 60 days",
  "Unreconciled bank entries",
  "What changed after approval?",
  "Findings above ₹1,00,000",
];

function AuditAskAi({ open, period, onClose, onOpenEntity, onTrace }: { open: boolean; period: Period; onClose: () => void; onOpenEntity: Opener; onTrace: Tracer }) {
  const { session } = useIms();
  const gemini = useGemini();
  const [cfg, setCfg] = gemini;
  const business = session.settings.businessName || session.brand?.name || "this business";

  const findings = (rows: ReadonlyArray<AuditIssue>, matched: number) =>
    rows.length ? (
      <div className="ims-sys-issues ims-ai-findings">
        {rows.slice(0, 12).map((i) => (
          <div key={i.key} className="ims-sys-issue">
            <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
            <div style={{ minWidth: 0 }}>
              <div className="ims-sys-issue-title">{i.title}</div>
              <div className="ims-sys-issue-meta">
                {i.entityLabel ? <span>{i.entityLabel}</span> : null}
                {i.amount !== null ? <span>{inr(i.amount)}</span> : null}
                {i.date ? <span>{dateLabel(i.date)}</span> : null}
              </div>
            </div>
            <div className="ims-sys-issue-actions">
              {isTraceType(i.entityType) ? (
                <Button size="sm" variant="ghost" onClick={() => onTrace(i.entityType, i.entityId)}>
                  Trace
                </Button>
              ) : null}
              {canOpenEntity(i.entityType, i.entityId) ? (
                <Button size="sm" variant="ghost" onClick={() => onOpenEntity(i.entityType, i.entityId)}>
                  Open
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {matched > 12 ? <span className="ims-sys-mini">Showing 12 of {matched}. See Findings for the full list.</span> : null}
      </div>
    ) : null;

  const onAsk = async (question: string, history: GeminiTurn[]): Promise<AskResult> => {
    const r = await imsSystem.auditAsk(question, { period });
    const extra = findings(r.rows, r.matched);
    if (cfg && r.rows.length) {
      try {
        const data = [
          `PERIOD: ${r.range.from} to ${r.range.to}. Findings matching the question: ${r.matched}.`,
          `ENGINE SUMMARY: ${r.answer}`,
          `FINDINGS (record | category | severity | title | detail | amount | date):`,
          ...r.rows.map((i) => `${i.entityLabel} | ${i.category} | ${i.severity} | ${i.title} | ${i.detail} | ${i.amount ?? "-"} | ${i.date ?? "-"}`),
        ].join("\n");
        const g = await askGemini(cfg, setCfg, { system: auditSystem(business, todayLocal()), history, prompt: dataPrompt(data, question) });
        return { text: g.text, source: "gemini", extra, note: g.truncated ? "The answer was cut short — ask a narrower question." : undefined };
      } catch (err) {
        return { text: r.answer, source: "built-in", extra, note: geminiFailNote(err) };
      }
    }
    return { text: r.answer, source: "built-in", extra };
  };

  return (
    <AskDialog
      open={open}
      onClose={onClose}
      title="Ask Audit AI"
      description="Plain-language questions answered from the automated checks for the selected period. Open any record straight from the answer."
      suggestions={AUDIT_SUGGESTIONS}
      onAsk={onAsk}
      gemini={gemini}
    />
  );
}

/* ---------- Overview ---------- */

function HealthRing({ health }: { health: AuditHealth }) {
  const ring = health.score >= 85 ? "var(--bos-emerald)" : health.score >= 65 ? "var(--bos-amber)" : "var(--bos-coral)";
  return (
    <div className="ims-sys-ring" style={{ "--pct": health.score, "--ring": ring } as CSSProperties} role="img" aria-label={`Books health score ${health.score} out of 100, grade ${health.grade}`}>
      <div>
        <span>
          <b>{health.score}</b>
          <small>Grade {health.grade}</small>
        </span>
      </div>
    </div>
  );
}

function OverviewTab({ period, onCategory, onTab }: { period: Period; onCategory: (c: AuditCategory) => void; onTab: (t: Tab) => void }) {
  const state = useImsData(() => imsSystem.auditOverview({ period }), [period]);
  return (
    <Loaded state={state} rows={4}>
      {(d) => {
        const t = d.totals;
        const severities = SEVERITIES.filter((s) => d.health.bySeverity[s] > 0);
        return (
          <>
            <Card interactive={false}>
              <div className="ims-row" style={{ gap: 20, flexWrap: "wrap", alignItems: "center" }}>
                <HealthRing health={d.health} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <Stack gap={8}>
                    <b style={{ fontSize: 16 }}>{GRADE_TEXT[d.health.grade]}</b>
                    <span className="ims-muted" style={{ fontSize: 13 }}>
                      {d.openIssues ? `${plural(d.openIssues, "open finding")} from automated checks across sales, purchases, banking, GST and stock.` : "No open findings — every automated check passed or was verified."}
                    </span>
                    {severities.length ? (
                      <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }}>
                        {severities.map((s) => (
                          <Badge key={s} tone={SEVERITY_TONE[s]}>
                            {d.health.bySeverity[s]} {SEVERITY_LABEL[s].toLowerCase()}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <span className="ims-sys-mini">Checked {dateRange(d.range.from, d.range.to)} · rules re-run each time this page loads</span>
                  </Stack>
                </div>
                <Button size="sm" variant="primary" onClick={() => onTab("issues")}>
                  Review findings
                </Button>
              </div>
            </Card>
            <Grid cols={4} min={160}>
              <KpiCard interactive={false} label="Sales" value={inr(t.sales)} delta={`${plural(t.salesCount, "invoice")} · output tax ${inr(t.outputTax)}`} deltaTone="muted" chip={{ color: "mint", glyph: "₹" }} />
              <KpiCard interactive={false} label="Purchases" value={inr(t.purchases)} delta={`${plural(t.purchaseCount, "bill")} · input tax ${inr(t.inputTax)}`} deltaTone="muted" chip={{ color: "lavender", glyph: "🧾" }} />
              <KpiCard interactive={false} label="Receivable" value={inr(t.receivable)} delta={t.overdueReceivable ? `${inr(t.overdueReceivable)} overdue` : "Nothing overdue"} deltaTone={t.overdueReceivable ? "warn" : "muted"} chip={{ color: "blue", glyph: "↘" }} />
              <KpiCard interactive={false} label="Payable" value={inr(t.payable)} delta={t.overduePayable ? `${inr(t.overduePayable)} overdue` : "Nothing overdue"} deltaTone={t.overduePayable ? "warn" : "muted"} chip={{ color: "amber", glyph: "↗" }} />
              <KpiCard interactive={false} label="Expenses" value={inr(t.expenses)} delta="Recorded in the period" deltaTone="muted" chip={{ color: "rose", glyph: "💸" }} />
              <KpiCard interactive={false} label="Stock value" value={inr(t.stockValue)} delta={`${plural(t.items, "item")} at cost`} deltaTone="muted" chip={{ color: "sage", glyph: "📦" }} />
              <KpiCard interactive={false} label="Cash in / out" value={`${inr(t.cashIn)} / ${inr(t.cashOut)}`} delta="Cash receipts and cash payments" deltaTone="muted" chip={{ color: "mint", glyph: "💵" }} />
              <KpiCard interactive={false} label="Bank in / out" value={`${inr(t.bankIn)} / ${inr(t.bankOut)}`} delta="UPI, card, bank and cheque" deltaTone="muted" chip={{ color: "blue", glyph: "🏦" }} />
            </Grid>
            <Card interactive={false}>
              <Stack gap={12}>
                <div className="ims-between">
                  <b className="ims-strong">Checks by area</b>
                  <span className="ims-sys-mini">Click an area to see its findings</span>
                </div>
                <div className="ims-sys-cats">
                  {d.categories.map((c) => (
                    <button key={c.key} type="button" className="ims-sys-cat" aria-pressed={false} onClick={() => onCategory(c.key)}>
                      <span className="ims-sys-cat-ic" aria-hidden="true">
                        {c.icon}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <b>{c.label}</b>
                        <small>{c.open ? `${c.open} open${c.amount ? ` · ${inr(c.amount)}` : ""}` : "All clear"}</small>
                      </span>
                      {c.open && c.worst ? <Badge tone={SEVERITY_TONE[c.worst]}>{SEVERITY_LABEL[c.worst]}</Badge> : <span className="ims-pos" aria-label="All clear">✓</span>}
                    </button>
                  ))}
                </div>
              </Stack>
            </Card>
            <Grid cols={2} min={300}>
              <Card interactive={false}>
                <Stack gap={12}>
                  <b className="ims-strong">What stands out</b>
                  {d.insights.length ? (
                    <ul className="ims-sys-insights">
                      {d.insights.map((i, n) => (
                        <li key={n}>
                          <span className={cx("ims-sys-dot", i.tone !== "blue" && `is-${i.tone}`)} aria-hidden="true" />
                          <span>{i.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="ims-muted" style={{ fontSize: 13 }}>
                      Nothing unusual in this period.
                    </span>
                  )}
                </Stack>
              </Card>
              <Card interactive={false}>
                <Stack gap={12}>
                  <b className="ims-strong">Workspace status</b>
                  <KeyValues
                    rows={[
                      ["Bank reconciliation", d.bank.total ? `${d.bank.matched} of ${d.bank.total} lines matched${d.bank.unmatched ? ` · ${d.bank.unmatched} unmatched (${inr(d.bank.unmatchedValue)})` : ""}` : "No bank statement imported yet"],
                      ["Flags & queries", `${d.workload.openFlags} open flags · ${d.workload.openQueries} open queries · ${d.workload.answered} answered`],
                      ["Documents", plural(d.documents, "document") + " on file"],
                      ...d.integrations.map((i): [ReactNode, ReactNode] => [
                        humanize(i.provider === "pos" ? "POS" : i.provider),
                        i.enabled ? (
                          <span className="ims-row" style={{ gap: 6 }}>
                            Connected{i.lastSyncAt ? ` · synced ${timeAgo(i.lastSyncAt)}` : " · never synced"}
                            {i.lastStatus && i.lastStatus in SYNC_TONE ? <Badge tone={SYNC_TONE[i.lastStatus as SyncStatus]}>{humanize(i.lastStatus)}</Badge> : null}
                          </span>
                        ) : (
                          "Not connected"
                        ),
                      ]),
                    ]}
                  />
                  <div className="ims-row" style={{ flexWrap: "wrap", gap: 8 }}>
                    <Button size="sm" onClick={() => onTab("banking")}>
                      Reconcile bank
                    </Button>
                    <Button size="sm" onClick={() => onTab("queries")}>
                      Flags & queries
                    </Button>
                    <Button size="sm" onClick={() => onTab("documents")}>
                      Documents
                    </Button>
                  </div>
                </Stack>
              </Card>
            </Grid>
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- Findings ---------- */

type VerdictTarget = { issue: AuditIssue; verdict: "resolved" | "dismissed" };

function IssuesTab({
  period,
  category,
  onCategory,
  canWrite,
  onRaise,
  onOpenEntity,
  onTrace,
}: {
  period: Period;
  category: AuditCategory | "";
  onCategory: (c: AuditCategory | "") => void;
  canWrite: boolean;
  onRaise: (p: Prefill) => void;
  onOpenEntity: Opener;
  onTrace: Tracer;
}) {
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [q, setQ] = useState("");
  const [verdict, setVerdict] = useState<VerdictTarget | null>(null);
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.auditIssues({ period, category: category || undefined, show }), [period, category, show]);
  const reopen = (i: AuditIssue) => run(`reopen:${i.key}`, () => imsSystem.auditVerdict({ ...verdictBase(i), verdict: "open" }), { success: "Finding reopened" });

  return (
    <Loaded state={state} rows={5}>
      {(d) => {
        const needle = q.trim().toLowerCase();
        const list = needle ? d.issues.filter((i) => `${i.title} ${i.detail} ${i.entityLabel}`.toLowerCase().includes(needle)) : d.issues;
        const labels = new Map(d.categories.map((c) => [c.key, c.label]));
        const exportCols: ReadonlyArray<ExportColumn<AuditIssue>> = [
          { header: "Area", value: (i) => labels.get(i.category) ?? i.category },
          { header: "Severity", value: (i) => SEVERITY_LABEL[i.severity] },
          { header: "Finding", value: (i) => i.title },
          { header: "Detail", value: (i) => i.detail },
          { header: "Record", value: (i) => i.entityLabel },
          { header: "Amount", value: (i) => i.amount },
          { header: "Date", value: (i) => i.date },
          { header: "Status", value: (i) => (i.verdict ? AUDIT_STATUS_LABEL[i.verdict.status] : "Open") },
        ];
        return (
          <>
            <Card interactive={false}>
              <Stack gap={12}>
                <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
                  <SearchInput wrapperClassName="ims-grow" placeholder="Search findings…" aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Segmented
                    size="sm"
                    role="radio"
                    aria-label="Show"
                    options={[
                      { value: "open", label: "Open" },
                      { value: "closed", label: "Verified / dismissed" },
                      { value: "all", label: "All" },
                    ]}
                    value={show}
                    onChange={setShow}
                  />
                  <Button size="sm" icon="download" disabled={!list.length} onClick={() => downloadCsv(`audit-findings-${d.range.from}-to-${d.range.to}`, list, exportCols)}>
                    CSV
                  </Button>
                </div>
                <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Area">
                  <FilterChip active={!category} onClick={() => onCategory("")}>
                    All areas
                  </FilterChip>
                  {d.categories.map((c) => (
                    <FilterChip key={c.key} active={category === c.key} onClick={() => onCategory(c.key)}>
                      {c.icon} {c.label}
                      {c.open ? ` · ${c.open}` : ""}
                    </FilterChip>
                  ))}
                </div>
                {category ? <span className="ims-sys-mini">How to fix: {d.categories.find((c) => c.key === category)?.fix}</span> : null}
              </Stack>
            </Card>
            {list.length ? (
              <div className="ims-sys-issues">
                {list.map((i) => (
                  <div key={i.key} className={cx("ims-sys-issue", !i.open && "is-closed")}>
                    <Badge tone={SEVERITY_TONE[i.severity]}>{SEVERITY_LABEL[i.severity]}</Badge>
                    <div style={{ minWidth: 0 }}>
                      <div className="ims-sys-issue-title">{i.title}</div>
                      <div className="ims-sys-issue-detail">{i.detail}</div>
                      <div className="ims-sys-issue-meta">
                        <span>{labels.get(i.category) ?? i.category}</span>
                        {i.entityLabel ? <span>{i.entityLabel}</span> : null}
                        {i.amount !== null ? <span>{inr(i.amount)}</span> : null}
                        {i.date ? <span>{dateLabel(i.date)}</span> : null}
                        {i.verdict ? (
                          <Badge tone={AUDIT_STATUS_TONE[i.verdict.status]}>
                            {i.verdict.kind === "query" ? "Query · " : ""}
                            {AUDIT_STATUS_LABEL[i.verdict.status]}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="ims-sys-issue-actions">
                      {isTraceType(i.entityType) ? (
                        <Button size="sm" variant="ghost" onClick={() => onTrace(i.entityType, i.entityId)}>
                          Trace
                        </Button>
                      ) : null}
                      {canOpenEntity(i.entityType, i.entityId) ? (
                        <Button size="sm" variant="ghost" onClick={() => onOpenEntity(i.entityType, i.entityId)}>
                          Open record
                        </Button>
                      ) : null}
                      {i.verdict ? (
                        <Button size="sm" variant="ghost" onClick={() => onOpenEntity("audit", i.verdict?.id ?? null)}>
                          History
                        </Button>
                      ) : null}
                      {canWrite && i.open ? (
                        <>
                          <Button size="sm" icon="check" onClick={() => setVerdict({ issue: i, verdict: "resolved" })}>
                            Verified
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setVerdict({ issue: i, verdict: "dismissed" })}>
                            Dismiss
                          </Button>
                          {!i.verdict ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                onRaise({
                                  kind: "query",
                                  area: areaForIssue(i),
                                  title: i.title,
                                  detail: i.detail,
                                  severity: i.severity,
                                  entityType: i.entityType || null,
                                  entityId: i.entityId || null,
                                  entityLabel: i.entityLabel || null,
                                  amount: i.amount,
                                  ruleKey: i.key,
                                })
                              }
                            >
                              Ask the business
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {canWrite && !i.open ? (
                        <Button size="sm" variant="ghost" disabled={isBusy(`reopen:${i.key}`)} onClick={() => void reopen(i)}>
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Card interactive={false}>
                <EmptyState glyph="✓" title={show === "open" ? "No open findings" : "Nothing here"}>
                  {show === "open" ? "Every automated check in this area and period passed, or the findings were verified." : "Try another area, period or filter."}
                </EmptyState>
              </Card>
            )}
            <VerdictDialog key={verdict ? `${verdict.issue.key}:${verdict.verdict}` : "none"} target={verdict} onClose={() => setVerdict(null)} />
          </>
        );
      }}
    </Loaded>
  );
}

function verdictBase(i: AuditIssue) {
  return {
    ruleKey: i.key,
    category: i.category,
    title: i.title,
    detail: i.detail,
    severity: i.severity,
    entityType: i.entityType || null,
    entityId: i.entityId || null,
    entityLabel: i.entityLabel || null,
    amount: i.amount,
  };
}

function VerdictDialog({ target, onClose }: { target: VerdictTarget | null; onClose: () => void }) {
  const { run, isBusy } = useImsAction();
  const [note, setNote] = useState("");
  const resolved = target?.verdict === "resolved";
  const submit = async () => {
    if (!target) return;
    const r = await run("verdict", () => imsSystem.auditVerdict({ ...verdictBase(target.issue), verdict: target.verdict, note: note.trim() || null }), {
      success: resolved ? "Marked as verified" : "Finding dismissed",
    });
    if (r) onClose();
  };
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={resolved ? "Mark finding as verified" : "Dismiss finding"}
      description={target?.issue.title}
      icon={{ tone: resolved ? "emerald" : "amber", name: resolved ? "check" : "x" }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={isBusy("verdict")} onClick={() => void submit()}>
            {isBusy("verdict") ? "Saving…" : resolved ? "Mark verified" : "Dismiss"}
          </Button>
        </>
      }
    >
      <Stack gap={10}>
        <span className="ims-muted" style={{ fontSize: 13 }}>
          {resolved ? "Use this once you have checked the record and it is correct (or has been corrected)." : "Use this when the rule doesn't apply here — for example an intentional adjustment."} The finding stays closed while the
          underlying record is unchanged, and the decision is kept in the audit trail.
        </span>
        <Field label="Note (optional)">
          {({ id }) => <Textarea id={id} rows={3} maxLength={2000} placeholder="What did you check?" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </Stack>
    </Dialog>
  );
}

/* ---------- Ledgers ---------- */

const LEDGERS: ReadonlyArray<{ value: LedgerKind; label: string }> = [
  { value: "sales", label: "Sales register" },
  { value: "purchases", label: "Purchase register" },
  { value: "inventory", label: "Stock summary" },
  { value: "receivables", label: "Receivables" },
  { value: "payables", label: "Payables" },
  { value: "expenses", label: "Expenses" },
];

const num = (v: number) => <span className="ims-num">{inr(v)}</span>;

const SALES_COLS: ReadonlyArray<BosColumn<SalesLedgerRow>> = [
  { key: "no", header: "Invoice", cell: (r) => cell(r.no, `${dateLabel(r.date)}${r.source ? ` · ${humanize(r.source)}` : ""}`, true) },
  { key: "party", header: "Customer", cell: (r) => cell(r.party, r.gstin ?? "Unregistered") },
  { key: "taxable", header: "Taxable", align: "right", cell: (r) => num(r.taxable) },
  { key: "tax", header: "GST", align: "right", cell: (r) => cell(inr(r.tax), r.igst ? `IGST ${inr(r.igst)}` : `CGST+SGST ${inr(r.cgst + r.sgst)}`) },
  { key: "total", header: "Total", align: "right", cell: (r) => num(r.total) },
  { key: "balance", header: "Balance", align: "right", cell: (r) => <span className={r.balance > 0 ? "ims-neg" : "ims-faint"}>{inr(r.balance)}</span> },
  { key: "status", header: "Status", cell: (r) => <Badge tone="neutral">{humanize(r.status)}</Badge> },
];
const SALES_EXPORT: ReadonlyArray<ExportColumn<SalesLedgerRow>> = [
  { header: "Date", value: (r) => r.date },
  { header: "Invoice", value: (r) => r.no },
  { header: "Customer", value: (r) => r.party },
  { header: "GSTIN", value: (r) => r.gstin },
  { header: "Taxable", value: (r) => r.taxable },
  { header: "CGST", value: (r) => r.cgst },
  { header: "SGST", value: (r) => r.sgst },
  { header: "IGST", value: (r) => r.igst },
  { header: "Total", value: (r) => r.total },
  { header: "Paid", value: (r) => r.paid },
  { header: "Balance", value: (r) => r.balance },
  { header: "Status", value: (r) => r.status },
  { header: "Source", value: (r) => r.source },
];

const PURCHASE_COLS: ReadonlyArray<BosColumn<PurchaseLedgerRow>> = [
  { key: "no", header: "Bill", cell: (r) => cell(r.no, [dateLabel(r.date), r.supplierBillNo ? `Supplier # ${r.supplierBillNo}` : null].filter(Boolean).join(" · "), true) },
  { key: "party", header: "Supplier", cell: (r) => cell(r.party, r.poNo ? `PO ${r.poNo}` : "No PO") },
  { key: "taxable", header: "Taxable", align: "right", cell: (r) => num(r.taxable) },
  { key: "tax", header: "GST", align: "right", cell: (r) => num(r.tax) },
  { key: "total", header: "Total", align: "right", cell: (r) => num(r.total) },
  { key: "balance", header: "Balance", align: "right", cell: (r) => <span className={r.balance > 0 ? "ims-neg" : "ims-faint"}>{inr(r.balance)}</span> },
  { key: "docs", header: "Docs", cell: (r) => (r.documents ? <Badge tone="emerald">{r.documents}</Badge> : <Badge tone="amber">None</Badge>) },
];
const PURCHASE_EXPORT: ReadonlyArray<ExportColumn<PurchaseLedgerRow>> = [
  { header: "Date", value: (r) => r.date },
  { header: "Bill", value: (r) => r.no },
  { header: "Supplier bill no", value: (r) => r.supplierBillNo },
  { header: "PO", value: (r) => r.poNo },
  { header: "Supplier", value: (r) => r.party },
  { header: "Taxable", value: (r) => r.taxable },
  { header: "GST", value: (r) => r.tax },
  { header: "Total", value: (r) => r.total },
  { header: "Paid", value: (r) => r.paid },
  { header: "Balance", value: (r) => r.balance },
  { header: "Status", value: (r) => r.status },
  { header: "Documents", value: (r) => r.documents },
];

const INVENTORY_COLS: ReadonlyArray<BosColumn<InventoryLedgerRow>> = [
  { key: "name", header: "Item", cell: (r) => cell(r.name, [r.sku, r.category].filter(Boolean).join(" · ") || "—", true) },
  { key: "opening", header: "Opening", align: "right", cell: (r) => qtyText(r.opening, r.unit) },
  { key: "in", header: "In", align: "right", cell: (r) => <span className="ims-pos">{qtyText(r.inQty, r.unit)}</span> },
  { key: "out", header: "Out", align: "right", cell: (r) => qtyText(r.outQty, r.unit) },
  { key: "closing", header: "Closing", align: "right", cell: (r) => <span className={r.closing < 0 ? "ims-neg" : "ims-strong"}>{qtyText(r.closing, r.unit)}</span> },
  { key: "value", header: "Value at cost", align: "right", cell: (r) => cell(inr(r.value), `@ ${inr(r.cost)}`) },
];
const INVENTORY_EXPORT: ReadonlyArray<ExportColumn<InventoryLedgerRow>> = [
  { header: "Item", value: (r) => r.name },
  { header: "SKU", value: (r) => r.sku },
  { header: "Category", value: (r) => r.category },
  { header: "Unit", value: (r) => r.unit },
  { header: "Opening", value: (r) => r.opening },
  { header: "In", value: (r) => r.inQty },
  { header: "Out", value: (r) => r.outQty },
  { header: "Closing", value: (r) => r.closing },
  { header: "Cost", value: (r) => r.cost },
  { header: "Value", value: (r) => r.value },
];

const AGING_COLS: ReadonlyArray<BosColumn<AgingLedgerRow>> = [
  { key: "no", header: "Document", cell: (r) => cell(r.no, dateLabel(r.date), true) },
  { key: "party", header: "Party", cell: (r) => r.party },
  { key: "due", header: "Due", cell: (r) => cell(<span className={r.daysOverdue > 0 ? "ims-neg" : undefined}>{dateLabel(r.dueDate)}</span>, r.daysOverdue > 0 ? `${r.daysOverdue}d overdue` : "Not due") },
  { key: "total", header: "Total", align: "right", cell: (r) => num(r.total) },
  { key: "balance", header: "Balance", align: "right", cell: (r) => <span className="ims-strong">{inr(r.balance)}</span> },
  { key: "bucket", header: "Bucket", cell: (r) => <Badge tone={r.daysOverdue > 90 ? "coral" : r.daysOverdue > 30 ? "amber" : r.daysOverdue > 0 ? "blue" : "neutral"}>{r.bucket}</Badge> },
];
const AGING_EXPORT: ReadonlyArray<ExportColumn<AgingLedgerRow>> = [
  { header: "Document", value: (r) => r.no },
  { header: "Party", value: (r) => r.party },
  { header: "Date", value: (r) => r.date },
  { header: "Due", value: (r) => r.dueDate },
  { header: "Total", value: (r) => r.total },
  { header: "Paid", value: (r) => r.paid },
  { header: "Balance", value: (r) => r.balance },
  { header: "Days overdue", value: (r) => r.daysOverdue },
  { header: "Bucket", value: (r) => r.bucket },
];

const EXPENSE_COLS: ReadonlyArray<BosColumn<ExpenseLedgerRow>> = [
  { key: "date", header: "Date", mono: true, cell: (r) => dateLabel(r.date) },
  { key: "category", header: "Expense", cell: (r) => cell(r.category, [r.description, r.vendor].filter(Boolean).join(" · ") || "—", true) },
  { key: "method", header: "Paid by", cell: (r) => cell(humanize(r.method), r.reference ?? r.by ?? undefined) },
  { key: "amount", header: "Amount", align: "right", cell: (r) => cell(inr(r.amount), r.gst ? `GST ${inr(r.gst)}` : undefined) },
  { key: "docs", header: "Docs", cell: (r) => (r.documents ? <Badge tone="emerald">{r.documents}</Badge> : <Badge tone={r.amount >= 10000 ? "amber" : "neutral"}>None</Badge>) },
];
const EXPENSE_EXPORT: ReadonlyArray<ExportColumn<ExpenseLedgerRow>> = [
  { header: "Date", value: (r) => r.date },
  { header: "Category", value: (r) => r.category },
  { header: "Description", value: (r) => r.description },
  { header: "Vendor", value: (r) => r.vendor },
  { header: "Amount", value: (r) => r.amount },
  { header: "GST", value: (r) => r.gst },
  { header: "Method", value: (r) => r.method },
  { header: "Reference", value: (r) => r.reference },
  { header: "Recorded by", value: (r) => r.by },
  { header: "Documents", value: (r) => r.documents },
];

function LedgersTab({ period, onOpenEntity }: { period: Period; onOpenEntity: Opener }) {
  const [kind, setKind] = useState<LedgerKind>("sales");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => imsSystem.ledger(kind, { period, q: dq || undefined }), [kind, period, dq]);
  return (
    <>
      <Card interactive={false}>
        <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
          <Segmented size="sm" scroll role="radio" aria-label="Register" options={LEDGERS} value={kind} onChange={setKind} />
          <SearchInput wrapperClassName="ims-grow" placeholder="Search number, party, item…" aria-label="Search register" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>
      <Loaded state={state} rows={6}>
        {(d) => <LedgerView d={d} onOpenEntity={onOpenEntity} />}
      </Loaded>
    </>
  );
}

function LedgerView({ d, onOpenEntity }: { d: LedgerResponse; onOpenEntity: Opener }) {
  const file = `${d.kind}-register-${d.range.from}-to-${d.range.to}`;
  const range = dateRange(d.range.from, d.range.to);
  switch (d.kind) {
    case "sales":
      return (
        <LedgerTable
          file={file}
          sheet="Sales"
          range={range}
          rows={d.rows}
          columns={SALES_COLS}
          exportCols={SALES_EXPORT}
          onRow={(r) => onOpenEntity("invoice", r.id)}
          kpis={
            <>
              <KpiCard interactive={false} label="Invoices" value={d.totals.count} chip={{ color: "blue", glyph: "#" }} />
              <KpiCard interactive={false} label="Taxable value" value={inr(d.totals.taxable)} chip={{ color: "mint", glyph: "₹" }} />
              <KpiCard interactive={false} label="Output GST" value={inr(d.totals.tax)} chip={{ color: "lavender", glyph: "%" }} />
              <KpiCard interactive={false} label="Outstanding" value={inr(d.totals.balance)} delta={`of ${inr(d.totals.total)} billed`} deltaTone="muted" chip={{ color: "amber", glyph: "⏳" }} />
            </>
          }
        />
      );
    case "purchases":
      return (
        <LedgerTable
          file={file}
          sheet="Purchases"
          range={range}
          rows={d.rows}
          columns={PURCHASE_COLS}
          exportCols={PURCHASE_EXPORT}
          onRow={(r) => onOpenEntity("bill", r.id)}
          kpis={
            <>
              <KpiCard interactive={false} label="Bills" value={d.totals.count} chip={{ color: "blue", glyph: "#" }} />
              <KpiCard interactive={false} label="Taxable value" value={inr(d.totals.taxable)} chip={{ color: "mint", glyph: "₹" }} />
              <KpiCard interactive={false} label="Input GST" value={inr(d.totals.tax)} chip={{ color: "lavender", glyph: "%" }} />
              <KpiCard interactive={false} label="Unpaid" value={inr(d.totals.balance)} delta={`of ${inr(d.totals.total)} billed`} deltaTone="muted" chip={{ color: "amber", glyph: "⏳" }} />
            </>
          }
        />
      );
    case "inventory":
      return (
        <LedgerTable
          file={file}
          sheet="Stock"
          range={range}
          rows={d.rows}
          columns={INVENTORY_COLS}
          exportCols={INVENTORY_EXPORT}
          onRow={(r) => onOpenEntity("item", r.id)}
          kpis={
            <>
              <KpiCard interactive={false} label="Items" value={d.totals.count} chip={{ color: "blue", glyph: "#" }} />
              <KpiCard interactive={false} label="Opening value" value={inr(d.totals.openingValue)} chip={{ color: "sage", glyph: "◐" }} />
              <KpiCard interactive={false} label="Closing value" value={inr(d.totals.value)} chip={{ color: "mint", glyph: "●" }} />
              <KpiCard interactive={false} label="Negative stock" value={d.totals.negative} delta={d.totals.negative ? "Items below zero — check entries" : "None"} deltaTone={d.totals.negative ? "warn" : "muted"} chip={{ color: "rose", glyph: "!" }} />
            </>
          }
        />
      );
    case "receivables":
    case "payables":
      return (
        <LedgerTable
          file={file}
          sheet={d.kind === "receivables" ? "Receivables" : "Payables"}
          range={`as of ${dateLabel(d.range.to)}`}
          rows={d.rows}
          columns={AGING_COLS}
          exportCols={AGING_EXPORT}
          onRow={(r) => onOpenEntity(d.kind === "receivables" ? "invoice" : "bill", r.id)}
          kpis={
            <>
              <KpiCard interactive={false} label={d.kind === "receivables" ? "Open invoices" : "Open bills"} value={d.totals.count} chip={{ color: "blue", glyph: "#" }} />
              <KpiCard interactive={false} label="Outstanding" value={inr(d.totals.balance)} chip={{ color: "mint", glyph: "₹" }} />
              <KpiCard interactive={false} label="Overdue" value={inr(d.totals.overdue)} valueTone={d.totals.overdue ? "coral" : undefined} chip={{ color: "rose", glyph: "⏰" }} />
              <KpiCard
                interactive={false}
                label="Ageing"
                value={d.buckets.filter((b) => b.count).length ? `${d.buckets.filter((b) => b.count).length} buckets` : "—"}
                delta={d.buckets.filter((b) => b.value > 0).map((b) => `${b.key}: ${inr(b.value)}`).join(" · ") || "Nothing outstanding"}
                deltaTone="muted"
                chip={{ color: "amber", glyph: "⏳" }}
              />
            </>
          }
        />
      );
    case "expenses":
      return (
        <LedgerTable
          file={file}
          sheet="Expenses"
          range={range}
          rows={d.rows}
          columns={EXPENSE_COLS}
          exportCols={EXPENSE_EXPORT}
          onRow={() => onOpenEntity("expense", null)}
          kpis={
            <>
              <KpiCard interactive={false} label="Entries" value={d.totals.count} chip={{ color: "blue", glyph: "#" }} />
              <KpiCard interactive={false} label="Total spent" value={inr(d.totals.amount)} chip={{ color: "rose", glyph: "💸" }} />
              <KpiCard interactive={false} label="GST on expenses" value={inr(d.totals.gst)} chip={{ color: "lavender", glyph: "%" }} />
              <KpiCard
                interactive={false}
                label="Paid in cash"
                value={inr(d.totals.cash)}
                delta={d.byCategory.slice(0, 2).map((c) => `${c.category} ${inr(c.amount)}`).join(" · ") || undefined}
                deltaTone="muted"
                chip={{ color: "mint", glyph: "💵" }}
              />
            </>
          }
        />
      );
  }
}

function LedgerTable<T extends { id: string }>({
  file,
  sheet,
  range,
  rows,
  columns,
  exportCols,
  onRow,
  kpis,
}: {
  file: string;
  sheet: string;
  range: string;
  rows: ReadonlyArray<T>;
  columns: ReadonlyArray<BosColumn<T>>;
  exportCols: ReadonlyArray<ExportColumn<T>>;
  onRow: (row: T) => void;
  kpis: ReactNode;
}) {
  return (
    <>
      <Grid cols={4} min={150}>
        {kpis}
      </Grid>
      <Card interactive={false}>
        <Stack gap={10}>
          <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="ims-sys-mini">
              {plural(rows.length, "row")} · {range}
            </span>
            <span className="ims-row">
              <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(file, rows, exportCols)}>
                CSV
              </Button>
              <Button size="sm" icon="file" disabled={!rows.length} onClick={() => void downloadXlsx(file, sheet, rows, exportCols)}>
                Excel
              </Button>
            </span>
          </div>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRow} compact chevron empty={<EmptyState glyph="∅" title="No entries">Nothing recorded for this period or search.</EmptyState>} />
        </Stack>
      </Card>
    </>
  );
}

/* ---------- Financial statements ---------- */

type StatementView = "tb" | "pl" | "bs" | "daybook";
const STATEMENT_VIEWS: ReadonlyArray<{ value: StatementView; label: string }> = [
  { value: "tb", label: "Trial balance" },
  { value: "pl", label: "Profit & loss" },
  { value: "bs", label: "Balance sheet" },
  { value: "daybook", label: "Day book" },
];
const VOUCHER_TONE: Record<BookVoucherType, "blue" | "emerald" | "amber" | "coral" | "neutral"> = {
  Opening: "neutral",
  Sales: "blue",
  Purchase: "amber",
  Receipt: "emerald",
  Payment: "coral",
  "Credit note": "amber",
  "Debit note": "amber",
  Expense: "coral",
  Journal: "neutral",
};

type StatementLine = { label: string; group?: string; dr?: number | null; cr?: number | null; amount?: number | null; strong?: boolean; indent?: boolean };
const STATEMENT_EXPORT: ReadonlyArray<ExportColumn<StatementLine>> = [
  { header: "Particulars", value: (r) => r.label },
  { header: "Group", value: (r) => r.group ?? "" },
  { header: "Debit", value: (r) => r.dr ?? "" },
  { header: "Credit", value: (r) => r.cr ?? "" },
  { header: "Amount", value: (r) => r.amount ?? "" },
];

function trialBalanceLines(d: BooksReport): StatementLine[] {
  return [...d.trialBalance.rows.map((r) => ({ label: r.name, group: r.group, dr: r.dr || null, cr: r.cr || null })), { label: "Total", dr: d.trialBalance.dr, cr: d.trialBalance.cr, strong: true }];
}

function profitLossLines(d: BooksReport): StatementLine[] {
  const p = d.profitLoss;
  return [
    { label: "Sales", amount: p.sales },
    { label: "Less: sales returns", amount: -p.salesReturns, indent: true },
    { label: "Net sales", amount: p.netSales, strong: true },
    { label: "Opening stock", amount: p.openingStock },
    { label: "Add: purchases", amount: p.purchases, indent: true },
    { label: "Less: purchase returns", amount: -p.purchaseReturns, indent: true },
    { label: "Less: closing stock", amount: -p.closingStock, indent: true },
    { label: "Cost of goods sold", amount: p.cogs, strong: true },
    { label: "Gross profit", amount: p.grossProfit, strong: true },
    ...p.expenses.map((e) => ({ label: e.name, amount: e.amount, indent: true })),
    { label: "Total expenses", amount: p.totalExpenses, strong: true },
    { label: p.netProfit >= 0 ? "Net profit" : "Net loss", amount: p.netProfit, strong: true },
  ];
}

function balanceSheetLines(d: BooksReport): StatementLine[] {
  const b = d.balanceSheet;
  return [
    { label: "Assets", strong: true },
    ...b.assets.map((r) => ({ label: r.name, amount: r.amount, indent: true })),
    { label: "Total assets", amount: b.totalAssets, strong: true },
    { label: "Liabilities & capital", strong: true },
    ...b.liabilities.map((r) => ({ label: r.name, amount: r.amount, indent: true })),
    { label: "Total liabilities & capital", amount: b.totalLiabilities, strong: true },
  ];
}

const ACCOUNT_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  debtors: "Debtors",
  creditors: "Creditors",
  stock: "Stock",
  inputCgst: "Input CGST",
  inputSgst: "Input SGST",
  inputIgst: "Input IGST",
  inputGstExpenses: "Input GST",
  outputCgst: "Output CGST",
  outputSgst: "Output SGST",
  outputIgst: "Output IGST",
  suspense: "Suspense",
  capital: "Capital",
  sales: "Sales",
  salesReturns: "Sales returns",
  purchases: "Purchases",
  purchaseReturns: "Purchase returns",
  roundOff: "Round off",
};
const accountLabel = (key: string) => (key.startsWith("exp:") ? key.slice(4) : (ACCOUNT_LABEL[key] ?? key));

type DayBookRow = BookVoucher & { id: string };
const DAY_BOOK_COLS: ReadonlyArray<BosColumn<DayBookRow>> = [
  { key: "date", header: "Date", cell: (r) => dateLabel(r.date) },
  { key: "type", header: "Voucher", cell: (r) => <Badge tone={VOUCHER_TONE[r.type]}>{r.type}</Badge> },
  { key: "ref", header: "Reference", cell: (r) => cell(r.ref ?? "—", r.party ?? undefined, true) },
  { key: "narration", header: "Narration", cell: (r) => cell(r.narration, r.lines.map((l) => `${l.dr ? "Dr" : "Cr"} ${accountLabel(l.account)}`).join(" · ")) },
  { key: "amount", header: "Amount", align: "right", cell: (r) => num(r.amount) },
];
const DAY_BOOK_EXPORT: ReadonlyArray<ExportColumn<DayBookRow>> = [
  { header: "Date", value: (r) => r.date },
  { header: "Voucher", value: (r) => r.type },
  { header: "Reference", value: (r) => r.ref },
  { header: "Party", value: (r) => r.party },
  { header: "Narration", value: (r) => r.narration },
  { header: "Entries", value: (r) => r.lines.map((l) => `${l.dr ? `Dr ${accountLabel(l.account)} ${l.dr}` : `Cr ${accountLabel(l.account)} ${l.cr}`}`).join("; ") },
  { header: "Amount", value: (r) => r.amount },
];

function StatementsTab({ period, onOpenEntity }: { period: Period; onOpenEntity: Opener }) {
  const [view, setView] = useState<StatementView>("tb");
  const state = useImsData(() => imsSystem.books({ period }), [period]);
  return (
    <>
      <Card interactive={false}>
        <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
          <Segmented size="sm" scroll role="radio" aria-label="Statement" options={STATEMENT_VIEWS} value={view} onChange={setView} />
          <span className="ims-sys-mini">Built from IMS records as double-entry vouchers · stock valued at current purchase price</span>
        </div>
      </Card>
      <Loaded state={state} rows={6}>
        {(d) => {
          const p = d.profitLoss;
          const balanced = Math.abs(d.trialBalance.difference) < 0.01 && Math.abs(d.balanceSheet.difference) < 0.01;
          const range = dateRange(d.range.from, d.range.to);
          return (
            <>
              <Grid cols={4} min={160}>
                <KpiCard interactive={false} label="Net sales" value={inr(p.netSales)} delta={p.salesReturns ? `after ${inr(p.salesReturns)} returns` : undefined} deltaTone="muted" chip={{ color: "blue", glyph: "₹" }} />
                <KpiCard interactive={false} label="Gross profit" value={inr(p.grossProfit)} delta={p.netSales ? `${Math.round((p.grossProfit / p.netSales) * 100)}% margin` : undefined} deltaTone="muted" chip={{ color: "mint", glyph: "◔" }} />
                <KpiCard interactive={false} label={p.netProfit >= 0 ? "Net profit" : "Net loss"} value={inr(p.netProfit)} valueTone={p.netProfit < 0 ? "coral" : "emerald"} chip={{ color: p.netProfit < 0 ? "rose" : "mint", glyph: "=" }} />
                <KpiCard
                  interactive={false}
                  label="Books"
                  value={balanced ? "Balanced" : "Out of balance"}
                  valueTone={balanced ? "emerald" : "coral"}
                  delta={balanced ? `Dr = Cr = ${inr(d.trialBalance.dr)}` : `Difference ${inr(d.trialBalance.difference || d.balanceSheet.difference)}`}
                  deltaTone={balanced ? "muted" : "warn"}
                  chip={{ color: balanced ? "mint" : "rose", glyph: balanced ? "✓" : "!" }}
                />
              </Grid>
              {view === "tb" ? <StatementTable title={`Trial balance · ${range}`} file={`trial-balance-${d.range.from}-to-${d.range.to}`} lines={trialBalanceLines(d)} columns="drcr" /> : null}
              {view === "pl" ? (
                <StatementTable
                  title={`Profit & loss · ${range}`}
                  file={`profit-and-loss-${d.range.from}-to-${d.range.to}`}
                  lines={profitLossLines(d)}
                  columns="amount"
                  note="Cost of goods sold uses opening and closing stock valued at each item's current purchase price."
                />
              ) : null}
              {view === "bs" ? (
                <StatementTable
                  title={`Balance sheet · as on ${dateLabel(d.range.to)}`}
                  file={`balance-sheet-${d.range.to}`}
                  lines={balanceSheetLines(d)}
                  columns="amount"
                  note={
                    d.balanceSheet.liabilities.some((r) => r.account === "suspense")
                      ? "Manual credit / debit ledger entries are held in a suspense account until your accountant classifies them."
                      : "Capital & reserves includes party opening balances, opening stock and profit brought forward from earlier periods."
                  }
                />
              ) : null}
              {view === "daybook" ? <DayBook d={d} onOpenEntity={onOpenEntity} /> : null}
            </>
          );
        }}
      </Loaded>
    </>
  );
}

function StatementTable({ title, file, lines, columns, note }: { title: string; file: string; lines: StatementLine[]; columns: "drcr" | "amount"; note?: string }) {
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "" : inr(v));
  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <b className="ims-strong">{title}</b>
          <span className="ims-row">
            <Button size="sm" icon="download" onClick={() => downloadCsv(file, lines, STATEMENT_EXPORT)}>
              CSV
            </Button>
            <Button size="sm" icon="file" onClick={() => void downloadXlsx(file, "Statement", lines, STATEMENT_EXPORT)}>
              Excel
            </Button>
          </span>
        </div>
        <div className="ims-matrix-wrap">
          <table className="bos-inv-paper-table">
            <thead>
              <tr>
                <th>Particulars</th>
                {columns === "drcr" ? (
                  <>
                    <th>Group</th>
                    <th className="ims-num">Debit</th>
                    <th className="ims-num">Credit</th>
                  </>
                ) : (
                  <th className="ims-num">Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.label}:${i}`} className={l.strong ? "ims-strong" : undefined}>
                  <td style={l.indent ? { paddingLeft: 24 } : undefined}>{l.label}</td>
                  {columns === "drcr" ? (
                    <>
                      <td className="ims-faint">{l.group ?? ""}</td>
                      <td className="ims-num">{money(l.dr)}</td>
                      <td className="ims-num">{money(l.cr)}</td>
                    </>
                  ) : (
                    <td className={cx("ims-num", typeof l.amount === "number" && l.amount < 0 && "ims-neg")}>{money(l.amount)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note ? <span className="ims-sys-mini">{note}</span> : null}
      </Stack>
    </Card>
  );
}

function DayBook({ d, onOpenEntity }: { d: BooksReport; onOpenEntity: Opener }) {
  const rows = useMemo<DayBookRow[]>(() => d.dayBook.rows.map((v, i) => ({ ...v, id: String(i) })).reverse(), [d.dayBook.rows]);
  const totals = Object.entries(d.dayBook.totals) as Array<[BookVoucherType, { count: number; amount: number }]>;
  const file = `day-book-${d.range.from}-to-${d.range.to}`;
  return (
    <Card interactive={false}>
      <Stack gap={10}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="ims-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {totals.map(([type, t]) => (
              <Badge key={type} tone={VOUCHER_TONE[type]}>
                {type} · {t.count} · {inr(t.amount)}
              </Badge>
            ))}
          </span>
          <span className="ims-row">
            <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(file, rows, DAY_BOOK_EXPORT)}>
              CSV
            </Button>
            <Button size="sm" icon="file" disabled={!rows.length} onClick={() => void downloadXlsx(file, "Day book", rows, DAY_BOOK_EXPORT)}>
              Excel
            </Button>
          </span>
        </div>
        {d.dayBook.truncated ? <span className="ims-sys-mini">Showing the latest {rows.length} vouchers — pick a shorter period to see them all.</span> : null}
        <DataTable
          columns={DAY_BOOK_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => onOpenEntity(r.source.type, r.source.id)}
          compact
          chevron
          empty={<EmptyState glyph="∅" title="No vouchers">Nothing was recorded in this period.</EmptyState>}
        />
      </Stack>
    </Card>
  );
}

/* ---------- Bank reconciliation ---------- */

type BankStatus = "unmatched" | "matched" | "ignored" | "all";

function BankingTab({ onOpenEntity }: { onOpenEntity: Opener }) {
  const [status, setStatus] = useState<BankStatus>("unmatched");
  const [q, setQ] = useState("");
  const [autoMatch, setAutoMatch] = useState(true);
  const [result, setResult] = useState<BankImportResult | null>(null);
  const [matching, setMatching] = useState<BankTxn | null>(null);
  const [deleting, setDeleting] = useState<BankTxn | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.bank({ status }), [status]);

  const importFile = async (file: File) => {
    const r = await run("import", async () => imsSystem.importBank(await readSheet(file), autoMatch), { success: "Statement imported" });
    if (r) setResult(r);
  };
  const accept = (t: BankTxn, s: BankSuggestion) => run(`row:${t.id}`, () => imsSystem.matchBank(t.id, { type: s.type, id: s.id }), { success: "Matched", description: s.label });
  const act = (t: BankTxn, action: "unmatch" | "ignore" | "restore") =>
    run(`row:${t.id}`, () => (action === "unmatch" ? imsSystem.unmatchBank(t.id) : action === "ignore" ? imsSystem.ignoreBank(t.id) : imsSystem.restoreBank(t.id)), {
      success: action === "unmatch" ? "Match removed" : action === "ignore" ? "Line ignored" : "Line restored",
    });

  return (
    <Loaded state={state} rows={5}>
      {(d) => {
        const s = d.summary;
        const needle = q.trim().toLowerCase();
        const rows = needle ? d.txns.filter((t) => `${t.description} ${t.reference ?? ""} ${t.matchedLabel ?? ""} ${t.amount}`.toLowerCase().includes(needle)) : d.txns;
        const pct = s.total ? Math.round((s.matched / Math.max(1, s.total - s.ignored)) * 100) : 0;
        const columns: ReadonlyArray<BosColumn<BankTxn>> = [
          { key: "date", header: "Date", mono: true, cell: (t) => dateLabel(t.date) },
          { key: "desc", header: "Narration", cell: (t) => cell(t.description, t.reference ?? undefined) },
          { key: "amount", header: "Amount", align: "right", cell: (t) => <span className={t.direction === "in" ? "ims-pos" : "ims-neg"}>{`${t.direction === "in" ? "+" : "−"}${inr(t.amount)}`}</span> },
          {
            key: "match",
            header: "Match",
            cell: (t) => {
              if (t.status === "matched")
                return cell(
                  <span className="ims-row" style={{ gap: 6 }}>
                    <Badge tone="emerald">Matched</Badge>
                    {t.matchedLabel}
                  </span>,
                  t.matchedBy ? `${t.matchedBy === "auto" ? "Auto-matched" : `By ${t.matchedBy}`}${t.matchScore !== null ? ` · ${t.matchScore}% confidence` : ""}` : undefined,
                );
              if (t.status === "ignored") return <Badge tone="neutral">Ignored</Badge>;
              const best = t.suggestions[0];
              return best ? cell(`Suggested: ${best.label}`, `${best.score}% · ${best.reasons.join(", ")}`) : <span className="ims-faint">No likely match</span>;
            },
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (t) =>
              d.canWrite ? (
                <span className="ims-row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                  {t.status === "unmatched" && t.suggestions[0] ? (
                    <Button size="sm" variant="primary" disabled={isBusy(`row:${t.id}`)} onClick={() => void accept(t, t.suggestions[0])}>
                      Accept
                    </Button>
                  ) : null}
                  {t.status === "unmatched" ? (
                    <>
                      <Button size="sm" onClick={() => setMatching(t)}>
                        Find…
                      </Button>
                      <Button size="sm" variant="ghost" disabled={isBusy(`row:${t.id}`)} onClick={() => void act(t, "ignore")}>
                        Ignore
                      </Button>
                    </>
                  ) : null}
                  {t.status === "matched" ? (
                    <Button size="sm" variant="ghost" disabled={isBusy(`row:${t.id}`)} onClick={() => void act(t, "unmatch")}>
                      Unmatch
                    </Button>
                  ) : null}
                  {t.status === "ignored" ? (
                    <Button size="sm" variant="ghost" disabled={isBusy(`row:${t.id}`)} onClick={() => void act(t, "restore")}>
                      Restore
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-label="Delete line" onClick={() => setDeleting(t)}>
                    ✕
                  </Button>
                </span>
              ) : null,
          },
        ];
        const exportCols: ReadonlyArray<ExportColumn<BankTxn>> = [
          { header: "Date", value: (t) => t.date },
          { header: "Narration", value: (t) => t.description },
          { header: "Reference", value: (t) => t.reference },
          { header: "In", value: (t) => (t.direction === "in" ? t.amount : null) },
          { header: "Out", value: (t) => (t.direction === "out" ? t.amount : null) },
          { header: "Status", value: (t) => t.status },
          { header: "Matched to", value: (t) => t.matchedLabel },
          { header: "Confidence", value: (t) => t.matchScore },
        ];
        return (
          <>
            <Grid cols={4} min={150}>
              <KpiCard interactive={false} label="Reconciled" value={`${pct}%`} delta={`${s.matched} of ${s.total - s.ignored} lines`} deltaTone={pct >= 90 ? "up" : "warn"} chip={{ color: "mint", glyph: "✓" }} />
              <KpiCard interactive={false} label="Unmatched" value={s.unmatched} delta={s.unmatched ? inr(s.unmatchedValue) : "All lines accounted for"} deltaTone={s.unmatched ? "warn" : "muted"} chip={{ color: "amber", glyph: "?" }} />
              <KpiCard interactive={false} label="Money in" value={inr(s.inflow)} chip={{ color: "blue", glyph: "↘" }} />
              <KpiCard interactive={false} label="Money out" value={inr(s.outflow)} delta={s.lastImportAt ? `Last import ${timeAgo(s.lastImportAt)}` : "No statement yet"} deltaTone="muted" chip={{ color: "rose", glyph: "↗" }} />
            </Grid>
            {d.canWrite ? (
              <Card interactive={false}>
                <Stack gap={12}>
                  <ToolHead
                    glyph="🏦"
                    title="Import a bank statement"
                    sub="CSV or Excel export from your bank. Columns are detected automatically: Date, Narration / Description, Withdrawal / Debit, Deposit / Credit (or a signed Amount) and Reference / Cheque no. Lines already imported are skipped."
                  />
                  <div className="ims-row" style={{ flexWrap: "wrap", gap: 10 }}>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void importFile(f);
                      }}
                    />
                    <Button variant="primary" icon="download" disabled={isBusy("import")} onClick={() => fileRef.current?.click()}>
                      {isBusy("import") ? "Importing…" : "Choose statement file"}
                    </Button>
                    <label className="ims-row" style={{ gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={autoMatch} onChange={(e) => setAutoMatch(e.target.checked)} />
                      Auto-match confident lines after import
                    </label>
                    <Button
                      size="sm"
                      icon="refresh"
                      disabled={isBusy("auto") || !s.unmatched}
                      onClick={() => void run("auto", () => imsSystem.autoMatchBank(), { success: "Auto-match finished" }).then((r) => r && setResult(null))}
                    >
                      Auto-match now
                    </Button>
                  </div>
                  {result ? (
                    <Alert tone={result.errors.length ? "amber" : "emerald"} title={`Imported ${plural(result.imported, "line")}${result.from ? ` (${dateRange(result.from, result.to)})` : ""}`}>
                      {[result.matched ? `${result.matched} auto-matched` : null, result.duplicates ? `${result.duplicates} already imported` : null, result.skipped ? `${result.skipped} skipped` : null].filter(Boolean).join(" · ") ||
                        "Review the unmatched lines below."}
                      {result.errors.length ? (
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {result.errors.slice(0, 5).map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : null}
                    </Alert>
                  ) : null}
                </Stack>
              </Card>
            ) : null}
            <Card interactive={false}>
              <Stack gap={12}>
                <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
                  <Segmented
                    size="sm"
                    role="radio"
                    aria-label="Status"
                    options={[
                      { value: "unmatched", label: `Unmatched (${s.unmatched})` },
                      { value: "matched", label: `Matched (${s.matched})` },
                      { value: "ignored", label: `Ignored (${s.ignored})` },
                      { value: "all", label: "All" },
                    ]}
                    value={status}
                    onChange={setStatus}
                  />
                  <SearchInput wrapperClassName="ims-grow" placeholder="Search narration, reference, amount…" aria-label="Search bank lines" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(`bank-reconciliation-${todayLocal()}`, rows, exportCols)}>
                    CSV
                  </Button>
                </div>
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(t) => t.id}
                  onRowClick={(t) => (t.status === "matched" ? onOpenEntity(t.matchedType, t.matchedId) : d.canWrite && t.status === "unmatched" ? setMatching(t) : undefined)}
                  compact
                  empty={
                    <EmptyState glyph="🏦" title={s.total ? "Nothing in this view" : "No bank lines yet"}>
                      {s.total ? "Switch the filter to see other lines." : "Import a statement to reconcile it against receipts, supplier payments and expenses."}
                    </EmptyState>
                  }
                />
              </Stack>
            </Card>
            <MatchDialog key={matching?.id ?? "none"} txn={matching} onClose={() => setMatching(null)} />
            <ConfirmDialog
              open={deleting !== null}
              onClose={() => setDeleting(null)}
              destructive
              title="Delete this bank line?"
              description={deleting ? `${dateLabel(deleting.date)} · ${deleting.description} · ${inr(deleting.amount)}. Re-importing the statement brings it back.` : undefined}
              confirmLabel="Delete line"
              busy={isBusy("delete")}
              onConfirm={() => {
                const t = deleting;
                if (!t) return;
                void run("delete", () => imsSystem.deleteBank(t.id), { success: "Bank line deleted" }).then(() => setDeleting(null));
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function MatchDialog({ txn, onClose }: { txn: BankTxn | null; onClose: () => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => (txn ? imsSystem.bankCandidates(txn.id, dq || undefined).then((r) => r.candidates) : Promise.resolve([])), [txn?.id, dq]);
  const pick = async (c: BankSuggestion) => {
    if (!txn) return;
    const r = await run("match", () => imsSystem.matchBank(txn.id, { type: c.type, id: c.id }), { success: "Matched", description: c.label });
    if (r) onClose();
  };
  return (
    <Dialog
      open={txn !== null}
      onClose={onClose}
      wide
      title="Match bank line"
      description={txn ? `${dateLabel(txn.date)} · ${txn.description} · ${txn.direction === "in" ? "+" : "−"}${inr(txn.amount)}` : undefined}
      icon={{ tone: "blue", name: "search" }}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <Stack gap={12}>
        <SearchInput placeholder={txn?.direction === "in" ? "Search customer receipts by party, reference or amount…" : "Search supplier payments and expenses…"} aria-label="Search candidates" value={q} onChange={(e) => setQ(e.target.value)} />
        <Loaded state={state} rows={3}>
          {(list) =>
            list.length ? (
              <div className="ims-sys-issues">
                {list.map((c) => (
                  <div key={`${c.type}:${c.id}`} className="ims-sys-issue" style={{ gridTemplateColumns: "1fr auto" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ims-sys-issue-title">{c.label}</div>
                      <div className="ims-sys-issue-meta">
                        <span>{c.type === "payment" ? "Payment" : "Expense"}</span>
                        <span>{dateLabel(c.date)}</span>
                        <span>{inr(c.amount)}</span>
                        <span>{c.score}% match</span>
                        {c.reasons.length ? <span>{c.reasons.join(", ")}</span> : null}
                      </div>
                    </div>
                    <div className="ims-sys-issue-actions">
                      <Button size="sm" variant="primary" disabled={isBusy("match")} onClick={() => void pick(c)}>
                        Match
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState glyph="∅" title="No candidates">
                Nothing unmatched in the same direction within the date window. Record the payment or expense first, then match it here.
              </EmptyState>
            )
          }
        </Loaded>
      </Stack>
    </Dialog>
  );
}

/* ---------- GST ---------- */

function GstTab({ period, onTrace }: { period: Period; onTrace: Tracer }) {
  const { navigate } = useIms();
  const state = useImsData(() => imsSystem.auditGst({ period }), [period]);
  return (
    <Loaded state={state} rows={4}>
      {(d) => (
        <>
          <Grid cols={4} min={160}>
            <KpiCard interactive={false} label="Output GST" value={inr(d.output.total)} delta={`On ${inr(d.output.taxable)} taxable · ${plural(d.invoices, "invoice")}`} deltaTone="muted" chip={{ color: "lavender", glyph: "↑" }} />
            <KpiCard interactive={false} label="Input tax credit" value={inr(d.input.total)} delta={`Bills ${inr(d.input.fromBills)} · expenses ${inr(d.input.fromExpenses)}`} deltaTone="muted" chip={{ color: "mint", glyph: "↓" }} />
            <KpiCard interactive={false} label={d.net >= 0 ? "Net GST payable" : "Credit carried forward"} value={inr(Math.abs(d.net))} valueTone={d.net > 0 ? "amber" : "emerald"} chip={{ color: "amber", glyph: "=" }} />
            <KpiCard interactive={false} label="B2B / B2C" value={`${d.b2b.count} / ${d.b2c.count}`} delta={`${inr(d.b2b.value)} / ${inr(d.b2c.value)}`} deltaTone="muted" chip={{ color: "blue", glyph: "⇄" }} />
          </Grid>
          {d.missingHsnLines ? (
            <Alert tone="amber" title={`${plural(d.missingHsnLines, "invoice line")} without an HSN / SAC code`}>
              HSN codes are mandatory on tax invoices and in GSTR-1. Add them on the items, then re-issue or amend the affected invoices.
            </Alert>
          ) : null}
          <Grid cols={2} min={300}>
            <Card interactive={false}>
              <Stack gap={12}>
                <b className="ims-strong">Tax split · {dateRange(d.range.from, d.range.to)}</b>
                <table className="bos-inv-paper-table">
                  <thead>
                    <tr>
                      <th />
                      <th className="ims-num">CGST</th>
                      <th className="ims-num">SGST</th>
                      <th className="ims-num">IGST</th>
                      <th className="ims-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Output (sales)</td>
                      <td className="ims-num">{inr(d.output.cgst)}</td>
                      <td className="ims-num">{inr(d.output.sgst)}</td>
                      <td className="ims-num">{inr(d.output.igst)}</td>
                      <td className="ims-num ims-strong">{inr(d.output.total)}</td>
                    </tr>
                    <tr>
                      <td>Input (purchases + expenses)</td>
                      <td className="ims-num">{inr(d.input.cgst)}</td>
                      <td className="ims-num">{inr(d.input.sgst)}</td>
                      <td className="ims-num">{inr(d.input.igst)}</td>
                      <td className="ims-num ims-strong">{inr(d.input.total)}</td>
                    </tr>
                  </tbody>
                </table>
                <span className="ims-sys-mini">{plural(d.bills, "purchase bill")} counted for input credit. Figures are from issued invoices and recorded bills; reconcile with GSTR-2B before claiming.</span>
              </Stack>
            </Card>
            <Card interactive={false}>
              <Stack gap={12}>
                <b className="ims-strong">Rate-wise summary</b>
                {d.byRate.length ? (
                  <table className="bos-inv-paper-table">
                    <thead>
                      <tr>
                        <th>Rate</th>
                        <th className="ims-num">Taxable</th>
                        <th className="ims-num">Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byRate.map((r) => (
                        <tr key={r.rate}>
                          <td>{r.rate}%</td>
                          <td className="ims-num">{inr(r.taxable)}</td>
                          <td className="ims-num">{inr(r.tax)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <span className="ims-muted" style={{ fontSize: 13 }}>
                    No sales in this period.
                  </span>
                )}
              </Stack>
            </Card>
          </Grid>
          <Gstr2bCard onTrace={onTrace} />
          <Card interactive={false}>
            <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
              <ToolHead glyph="🧮" title="GST returns workspace" sub="GSTR-1 and GSTR-3B summaries, HSN summary and JSON / Excel exports live in the GST module." />
              <Button variant="primary" onClick={() => navigate("gst")}>
                Open GST module
              </Button>
            </div>
          </Card>
        </>
      )}
    </Loaded>
  );
}

/* ---------- Documents ---------- */

function DocumentsTab({ onOpenEntity }: { onOpenEntity: Opener }) {
  const { can, session } = useIms();
  const [category, setCategory] = useState<AuditDocCategory | "">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [adding, setAdding] = useState(0);
  const [deleting, setDeleting] = useState<AuditDocument | null>(null);
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.documents({ category: category || undefined, q: dq || undefined }), [category, dq]);
  const me = session.actor.userId;
  const canDelete = (doc: AuditDocument) => can("settings") || (can("audit") && doc.uploadedBy === me);
  const openDoc = async (doc: AuditDocument) => {
    if (!doc.hasFile && doc.url) {
      window.open(doc.url, "_blank", "noopener,noreferrer");
      return;
    }
    const file = await run(`file:${doc.id}`, () => imsSystem.documentFile(doc.id, doc.fileName ?? `${doc.title}`), { refresh: false });
    if (file) saveBlob(file);
  };
  return (
    <Loaded state={state} rows={4}>
      {(d) => {
        const columns: ReadonlyArray<BosColumn<AuditDocument>> = [
          { key: "title", header: "Document", cell: (doc) => cell(doc.title, doc.hasFile ? `${doc.fileName ?? "File"} · ${fileSize(doc.sizeBytes)}` : (doc.url ?? "—"), true) },
          { key: "category", header: "Type", cell: (doc) => cell(DOC_CATEGORY_LABEL[doc.category], doc.period ?? undefined) },
          {
            key: "entity",
            header: "Linked to",
            cell: (doc) =>
              doc.entityLabel && canOpenEntity(doc.entityType, doc.entityId) ? (
                <button
                  type="button"
                  style={{ background: "none", border: 0, padding: 0, color: "var(--bos-blue-600)", cursor: "pointer", font: "inherit" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenEntity(doc.entityType, doc.entityId);
                  }}
                >
                  {doc.entityLabel} ↗
                </button>
              ) : (
                <span className="ims-faint">{doc.entityLabel ?? "—"}</span>
              ),
          },
          { key: "by", header: "Added", cell: (doc) => cell(doc.uploadedByName ?? "—", doc.createdAt ? timeAgo(doc.createdAt) : undefined) },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (doc) => (
              <span className="ims-row" style={{ gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                <Button size="sm" disabled={isBusy(`file:${doc.id}`)} onClick={() => void openDoc(doc)}>
                  {doc.hasFile ? "Download" : "Open ↗"}
                </Button>
                {canDelete(doc) ? (
                  <Button size="sm" variant="ghost" aria-label={`Delete ${doc.title}`} onClick={() => setDeleting(doc)}>
                    ✕
                  </Button>
                ) : null}
              </span>
            ),
          },
        ];
        return (
          <>
            <Card interactive={false}>
              <Stack gap={12}>
                <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
                  <SearchInput wrapperClassName="ims-grow" placeholder="Search title, file, notes…" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button variant="primary" icon="plus" onClick={() => setAdding((n) => n + 1)}>
                    Add document
                  </Button>
                </div>
                <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Document type">
                  <FilterChip active={!category} onClick={() => setCategory("")}>
                    All types
                  </FilterChip>
                  {DOC_CATEGORIES.map((c) => (
                    <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                      {DOC_CATEGORY_LABEL[c]}
                    </FilterChip>
                  ))}
                </div>
              </Stack>
            </Card>
            <Card interactive={false}>
              <DataTable
                columns={columns}
                rows={d.documents}
                rowKey={(doc) => doc.id}
                onRowClick={(doc) => void openDoc(doc)}
                compact
                empty={
                  <EmptyState glyph="📁" title="No documents yet">
                    Keep bills, bank statements, GST returns, TDS certificates and agreements here so your CA has everything in one place.
                  </EmptyState>
                }
              />
            </Card>
            <DocumentDialog key={adding} open={adding > 0} maxBytes={d.maxBytes} onClose={() => setAdding(0)} />
            <ConfirmDialog
              open={deleting !== null}
              onClose={() => setDeleting(null)}
              destructive
              title="Delete this document?"
              description={deleting ? `“${deleting.title}” will be removed for everyone. This is recorded in the audit trail.` : undefined}
              confirmLabel="Delete"
              busy={isBusy("delete")}
              onConfirm={() => {
                const doc = deleting;
                if (!doc) return;
                void run("delete", () => imsSystem.deleteDocument(doc.id), { success: "Document deleted" }).then(() => setDeleting(null));
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function DocumentDialog({ open, maxBytes, onClose }: { open: boolean; maxBytes: number; onClose: () => void }) {
  const { run, isBusy } = useImsAction();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AuditDocCategory>("bill");
  const [period, setPeriod] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [entityType, setEntityType] = useState<AuditEntityType | "">("");
  const [entity, setEntity] = useState<AuditEntity | null>(null);
  const tooBig = file !== null && file.size > maxBytes;
  const urlOk = /^https?:\/\/\S+$/i.test(url.trim());
  const valid = title.trim().length > 0 && (mode === "file" ? file !== null && !tooBig : urlOk);
  const submit = async () => {
    const r = await run(
      "add",
      async () =>
        imsSystem.addDocument({
          title: title.trim(),
          category,
          period: period.trim() || null,
          notes: notes.trim() || null,
          url: mode === "link" ? url.trim() : null,
          content: mode === "file" && file ? await readAsDataUrl(file) : null,
          fileName: mode === "file" && file ? file.name : null,
          entityType: entityType && entity ? entityType : null,
          entityId: entityType && entity ? entity.id : null,
          entityLabel: entityType && entity ? entity.label : null,
        }),
      { success: "Document added" },
    );
    if (r) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add document"
      description="Attach a file (up to 2 MB) or link to one stored in Drive, Dropbox or your DMS."
      icon={{ tone: "blue", name: "file" }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || isBusy("add")} onClick={() => void submit()}>
            {isBusy("add") ? "Uploading…" : "Add document"}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        <Segmented
          size="sm"
          role="radio"
          aria-label="Source"
          options={[
            { value: "file", label: "Upload file" },
            { value: "link", label: "Link" },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "file" ? (
          <label className="ims-sys-drop">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls,.doc,.docx,.txt,.json,.xml,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
            <b>{file ? file.name : "Choose a file"}</b>
            <span className={tooBig ? "ims-neg" : "ims-sys-mini"}>{file ? `${fileSize(file.size)}${tooBig ? ` — larger than ${fileSize(maxBytes)}, use a link instead` : ""}` : `PDF, image, Excel, Word, CSV, XML or ZIP · max ${fileSize(maxBytes)}`}</span>
          </label>
        ) : (
          <Field label="Link" error={url && !urlOk ? "Enter a full http(s) link" : null}>
            {({ id }) => <Input id={id} type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
        )}
        <FormGrid>
          <Field label="Title">{({ id }) => <Input id={id} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as AuditDocCategory)}>
                {DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {DOC_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Period" hint="e.g. Apr 2026 or FY 2025-26">
            {({ id }) => <Input id={id} maxLength={40} value={period} onChange={(e) => setPeriod(e.target.value)} />}
          </Field>
          <Field label="Link to a record">
            {({ id }) => (
              <Select
                id={id}
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value as AuditEntityType | "");
                  setEntity(null);
                }}
              >
                <option value="">Not linked</option>
                {LINKABLE.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
        {entityType ? <EntityPicker type={entityType} value={entity} onChange={setEntity} /> : null}
        <Field label="Notes (optional)">{({ id }) => <Textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </Stack>
    </Dialog>
  );
}

function EntityPicker({ type, value, onChange }: { type: AuditEntityType; value: AuditEntity | null; onChange: (e: AuditEntity | null) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => (value ? Promise.resolve([]) : imsSystem.auditEntities(type, dq).then((r) => r.entities)), [type, dq, value?.id]);
  if (value)
    return (
      <div className="ims-sys-flow">
        <span className="ims-grow">
          <b>{value.label}</b>
          {value.sub ? <span className="ims-faint"> · {value.sub}</span> : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  return (
    <Stack gap={8}>
      <SearchInput placeholder="Search by number, name or amount…" aria-label="Search records to link" value={q} onChange={(e) => setQ(e.target.value)} />
      <Loaded state={state} rows={2}>
        {(list) =>
          list.length ? (
            <div className="ims-sys-steps" role="listbox" aria-label="Matching records">
              {list.slice(0, 8).map((e) => (
                <button key={e.id} type="button" role="option" aria-selected={false} className="ims-sys-cat" onClick={() => onChange(e)}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b>{e.label}</b>
                    {e.sub ? <small>{e.sub}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <span className="ims-sys-mini">No matching records.</span>
          )
        }
      </Loaded>
    </Stack>
  );
}

/* ---------- Flags & queries ---------- */

type KindFilter = "" | "flag" | "query";
type StatusFilter = AuditItemStatus | "active" | "";

function QueriesTab({ canWrite, onOpen, onNew }: { canWrite: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const [kind, setKind] = useState<KindFilter>("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [manual, setManual] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => imsSystem.auditItems({ kind: kind || undefined, status: status || undefined, manual: manual || undefined, q: dq || undefined }), [kind, status, manual, dq]);
  const columns: ReadonlyArray<BosColumn<AuditItem>> = [
    {
      key: "title",
      header: "Item",
      cell: (it) =>
        cell(
          <span className="ims-row" style={{ gap: 6 }}>
            <Badge tone={it.kind === "query" ? "lavender" : "coral"}>{it.kind === "query" ? "Query" : "Flag"}</Badge>
            <span className="ims-strong">{it.title}</span>
          </span>,
          [AUDIT_AREA_LABEL[it.area], it.entityLabel, it.amount !== null ? inr(it.amount) : null].filter(Boolean).join(" · "),
        ),
    },
    { key: "severity", header: "Severity", cell: (it) => <Badge tone={SEVERITY_TONE[it.severity]}>{SEVERITY_LABEL[it.severity]}</Badge> },
    { key: "status", header: "Status", cell: (it) => <Badge tone={AUDIT_STATUS_TONE[it.status]}>{AUDIT_STATUS_LABEL[it.status]}</Badge> },
    { key: "assignee", header: "With", cell: (it) => cell(it.assigneeName ?? "Unassigned", it.dueDate ? `Due ${dateLabel(it.dueDate)}` : undefined) },
    { key: "updated", header: "Activity", cell: (it) => cell(it.replies ? `${it.replies} repl${it.replies === 1 ? "y" : "ies"}` : "No replies", it.updatedAt ? timeAgo(it.updatedAt) : undefined) },
  ];
  const exportCols: ReadonlyArray<ExportColumn<AuditItem>> = [
    { header: "Type", value: (it) => it.kind },
    { header: "Title", value: (it) => it.title },
    { header: "Area", value: (it) => AUDIT_AREA_LABEL[it.area] },
    { header: "Record", value: (it) => it.entityLabel },
    { header: "Amount", value: (it) => it.amount },
    { header: "Severity", value: (it) => SEVERITY_LABEL[it.severity] },
    { header: "Status", value: (it) => AUDIT_STATUS_LABEL[it.status] },
    { header: "Raised by", value: (it) => it.raisedByName },
    { header: "Assigned to", value: (it) => it.assigneeName },
    { header: "Due", value: (it) => it.dueDate },
    { header: "Replies", value: (it) => it.replies },
    { header: "Raised", value: (it) => it.createdAt },
    { header: "Resolved", value: (it) => it.resolvedAt },
  ];
  return (
    <>
      <Card interactive={false}>
        <Stack gap={12}>
          <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
            <SearchInput wrapperClassName="ims-grow" placeholder="Search flags and queries…" aria-label="Search flags and queries" value={q} onChange={(e) => setQ(e.target.value)} />
            <Segmented
              size="sm"
              role="radio"
              aria-label="Type"
              options={[
                { value: "", label: "All" },
                { value: "flag", label: "Flags" },
                { value: "query", label: "Queries" },
              ]}
              value={kind}
              onChange={setKind}
            />
            <Button size="sm" icon="download" disabled={!state.data?.items.length} onClick={() => state.data && downloadCsv(`audit-flags-queries-${todayLocal()}`, state.data.items, exportCols)}>
              CSV
            </Button>
            {canWrite ? (
              <Button size="sm" variant="primary" icon="plus" onClick={onNew}>
                New
              </Button>
            ) : null}
          </div>
          <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Status">
            <FilterChip active={status === "active"} onClick={() => setStatus("active")}>
              Needs action
            </FilterChip>
            {ITEM_STATUSES.map((s) => (
              <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
                {AUDIT_STATUS_LABEL[s]}
              </FilterChip>
            ))}
            <FilterChip active={!status} onClick={() => setStatus("")}>
              Everything
            </FilterChip>
            <FilterChip active={manual} onClick={() => setManual((m) => !m)}>
              Raised manually only
            </FilterChip>
          </div>
        </Stack>
      </Card>
      <Loaded state={state} rows={5}>
        {(d) => (
          <Card interactive={false}>
            <DataTable
              columns={columns}
              rows={d.items}
              rowKey={(it) => it.id}
              onRowClick={(it) => onOpen(it.id)}
              chevron
              empty={
                <EmptyState glyph="💬" title="Nothing here">
                  {status === "active" ? "No open flags or queries. Raise one from a finding, a ledger entry or the New button." : "Try another filter."}
                </EmptyState>
              }
            />
          </Card>
        )}
      </Loaded>
    </>
  );
}

function useTeam() {
  return useImsData(() => ims.team().then((r) => r.members.filter((m) => m.active)), []);
}
const memberName = (m: ImsMember) => m.name ?? m.email ?? `User ${m.userId}`;

function ItemDialog({ id, canWrite, onClose, onOpenEntity }: { id: string | null; canWrite: boolean; onClose: () => void; onOpenEntity: Opener }) {
  const { session } = useIms();
  const { run, isBusy } = useImsAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = useImsData(() => (id ? imsSystem.auditItem(id).then((r) => r.item) : Promise.resolve(null)), [id]);
  const team = useTeam();
  const it = state.data && state.data.id === id ? state.data : null;
  const update = (patch: Parameters<typeof imsSystem.updateAuditItem>[1], success: string) => (it ? run("update", () => imsSystem.updateAuditItem(it.id, patch), { success }) : Promise.resolve(undefined));
  const closed = it ? it.status === "resolved" || it.status === "dismissed" : false;
  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      wide
      title={it ? it.title : "Flag / query"}
      description={it ? `${it.kind === "query" ? "Query" : "Flag"} · ${AUDIT_AREA_LABEL[it.area]} · raised by ${it.raisedByName ?? "—"}${it.createdAt ? ` ${timeAgo(it.createdAt)}` : ""}` : undefined}
      icon={{ tone: it?.kind === "flag" ? "coral" : "blue", name: it?.kind === "flag" ? "alert" : "tasks" }}
      actionsNote={
        it && canWrite ? (
          <span className="ims-row" style={{ gap: 6 }}>
            {closed ? (
              <Button size="sm" variant="ghost" disabled={isBusy("update")} onClick={() => void update({ status: "open" }, "Reopened")}>
                Reopen
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon="check" disabled={isBusy("update")} onClick={() => void update({ status: "resolved" }, "Marked resolved")}>
                Mark resolved
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </span>
        ) : null
      }
      actions={<Button onClick={onClose}>Done</Button>}
    >
      {it ? (
        <Stack gap={14}>
          {it.detail ? (
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {it.detail}
            </p>
          ) : null}
          <KeyValues
            rows={[
              ["Status", <Badge key="s" tone={AUDIT_STATUS_TONE[it.status]}>{AUDIT_STATUS_LABEL[it.status]}</Badge>],
              [
                "Record",
                it.entityLabel ? (
                  canOpenEntity(it.entityType, it.entityId) ? (
                    <button
                      key="e"
                      type="button"
                      style={{ background: "none", border: 0, padding: 0, color: "var(--bos-blue-600)", cursor: "pointer", font: "inherit" }}
                      onClick={() => {
                        onClose();
                        onOpenEntity(it.entityType, it.entityId);
                      }}
                    >
                      {it.entityLabel} ↗
                    </button>
                  ) : (
                    it.entityLabel
                  )
                ) : (
                  "—"
                ),
              ],
              ["Amount", it.amount !== null ? inr(it.amount) : "—"],
              ["Resolved", it.resolvedAt ? stampLabel(it.resolvedAt) : "—"],
            ]}
          />
          {canWrite ? (
            <FormGrid columns="repeat(auto-fit, minmax(150px, 1fr))">
              <Field label="Status">
                {({ id: fid }) => (
                  <Select id={fid} size="sm" value={it.status} disabled={isBusy("update")} onChange={(e) => void update({ status: e.target.value as AuditItemStatus }, "Status updated")}>
                    {ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {AUDIT_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Severity">
                {({ id: fid }) => (
                  <Select id={fid} size="sm" value={it.severity} disabled={isBusy("update")} onChange={(e) => void update({ severity: e.target.value as AuditSeverity }, "Severity updated")}>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Assigned to">
                {({ id: fid }) => (
                  <Select
                    id={fid}
                    size="sm"
                    value={it.assigneeUserId ?? ""}
                    disabled={isBusy("update")}
                    onChange={(e) => {
                      const uid = e.target.value ? Number(e.target.value) : null;
                      const m = team.data?.find((x) => x.userId === uid);
                      void update({ assigneeUserId: uid, assigneeName: m ? memberName(m) : null }, uid ? "Assigned" : "Unassigned");
                    }}
                  >
                    <option value="">Unassigned</option>
                    {(team.data ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {memberName(m)} · {ROLE_LABEL[m.imsRole]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Due">
                {({ id: fid }) => <Input id={fid} size="sm" type="date" value={it.dueDate ?? ""} disabled={isBusy("update")} onChange={(e) => void update({ dueDate: e.target.value || null }, "Due date updated")} />}
              </Field>
            </FormGrid>
          ) : (
            <KeyValues
              rows={[
                ["Severity", SEVERITY_LABEL[it.severity]],
                ["Assigned to", it.assigneeName ?? "Unassigned"],
                ["Due", it.dueDate ? dateLabel(it.dueDate) : "—"],
              ]}
            />
          )}
          <b className="ims-strong">Conversation</b>
          <Thread entries={it.thread} meId={session.actor.userId} empty="No replies yet." />
          <ReplyBox
            busy={isBusy("reply")}
            label={canWrite ? "Send" : "Answer"}
            placeholder={canWrite ? "Ask a follow-up or note what you checked…" : "Answer the auditor — explain, or say what you corrected…"}
            onSend={async (text) => Boolean(await run("reply", () => imsSystem.replyAuditItem(it.id, text), { success: "Reply sent" }))}
          />
        </Stack>
      ) : (
        <Loaded state={{ ...state, data: null }} rows={3}>
          {() => null}
        </Loaded>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title="Delete this item?"
        description="The flag or query and its conversation are removed. The deletion stays in the audit trail."
        confirmLabel="Delete"
        busy={isBusy("delete")}
        onConfirm={() => {
          if (!it) return;
          void run(
            "delete",
            async () => {
              await imsSystem.deleteAuditItem(it.id);
              return true;
            },
            { success: "Deleted" },
          ).then((ok) => {
            setConfirmDelete(false);
            if (ok) onClose();
          });
        }}
      />
    </Dialog>
  );
}

function NewItemDialog({ open, prefill, onClose, onCreated }: { open: boolean; prefill: Prefill; onClose: () => void; onCreated: (item: AuditItem) => void }) {
  const { run, isBusy } = useImsAction();
  const team = useTeam();
  const [kind, setKind] = useState<"flag" | "query">(prefill.kind ?? "query");
  const [title, setTitle] = useState(prefill.title ?? "");
  const [detail, setDetail] = useState(prefill.detail ?? "");
  const [area, setArea] = useState<AuditArea>(prefill.area ?? "other");
  const [severity, setSeverity] = useState<AuditSeverity>(prefill.severity ?? "medium");
  const [amount, setAmount] = useState(prefill.amount !== null && prefill.amount !== undefined ? String(prefill.amount) : "");
  const [dueDate, setDueDate] = useState(prefill.dueDate ?? "");
  const [assignee, setAssignee] = useState<number | null>(prefill.assigneeUserId ?? null);
  const fixedEntity = prefill.entityLabel ? { type: prefill.entityType ?? null, id: prefill.entityId ?? null, label: prefill.entityLabel } : null;
  const [entityType, setEntityType] = useState<AuditEntityType | "">("");
  const [entity, setEntity] = useState<AuditEntity | null>(null);
  const amountNum = amount.trim() ? Number(amount) : null;
  const valid = title.trim().length >= 3 && (amountNum === null || (Number.isFinite(amountNum) && amountNum >= 0));
  const owners = useMemo(() => (team.data ?? []).filter((m) => m.imsRole !== "viewer"), [team.data]);
  const submit = async () => {
    const m = owners.find((x) => x.userId === assignee);
    const r = await run(
      "create",
      () =>
        imsSystem.createAuditItem({
          kind,
          area,
          title: title.trim(),
          detail: detail.trim() || null,
          severity,
          amount: amountNum,
          dueDate: dueDate || null,
          assigneeUserId: assignee,
          assigneeName: m ? memberName(m) : null,
          ruleKey: prefill.ruleKey ?? null,
          entityType: fixedEntity ? fixedEntity.type : entityType && entity ? entityType : null,
          entityId: fixedEntity ? fixedEntity.id : entityType && entity ? entity.id : null,
          entityLabel: fixedEntity ? fixedEntity.label : entityType && entity ? entity.label : null,
        }),
      { success: kind === "query" ? "Query sent" : "Flag raised", description: m ? `${memberName(m)} has been notified.` : undefined },
    );
    if (r) onCreated(r.item);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={kind === "query" ? "Ask the business a question" : "Raise a flag"}
      description={kind === "query" ? "Queries are answered by the business in a thread here; you're notified when they reply." : "Flags record something that needs correcting. Assign it so the right person fixes it."}
      icon={{ tone: kind === "query" ? "blue" : "coral", name: kind === "query" ? "tasks" : "alert" }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || isBusy("create")} onClick={() => void submit()}>
            {isBusy("create") ? "Saving…" : kind === "query" ? "Send query" : "Raise flag"}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        <Segmented
          size="sm"
          role="radio"
          aria-label="Type"
          options={[
            { value: "query", label: "Query" },
            { value: "flag", label: "Flag" },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Field label="Title" error={title && title.trim().length < 3 ? "A few more characters, please" : null}>
          {({ id }) => <Input id={id} maxLength={255} placeholder={kind === "query" ? "e.g. Please share the supplier invoice for this bill" : "e.g. Cash receipt above ₹2 lakh"} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Details">
          {({ id }) => <Textarea id={id} rows={3} maxLength={4000} value={detail} onChange={(e) => setDetail(e.target.value)} />}
        </Field>
        <FormGrid columns="repeat(auto-fit, minmax(160px, 1fr))">
          <Field label="Area">
            {({ id }) => (
              <Select id={id} value={area} onChange={(e) => setArea(e.target.value as AuditArea)}>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {AUDIT_AREA_LABEL[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Severity">
            {({ id }) => (
              <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value as AuditSeverity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount (optional)" error={amountNum !== null && !(Number.isFinite(amountNum) && amountNum >= 0) ? "Enter a valid amount" : null}>
            {({ id }) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Due (optional)">{({ id }) => <Input id={id} type="date" min={todayLocal()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Assign to">
            {({ id }) => (
              <Select id={id} value={assignee ?? ""} onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Owner / managers</option>
                {owners.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)} · {ROLE_LABEL[m.imsRole]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!fixedEntity ? (
            <Field label="Related record">
              {({ id }) => (
                <Select
                  id={id}
                  value={entityType}
                  onChange={(e) => {
                    setEntityType(e.target.value as AuditEntityType | "");
                    setEntity(null);
                  }}
                >
                  <option value="">None</option>
                  {LINKABLE.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </FormGrid>
        {fixedEntity ? (
          <div className="ims-sys-flow">
            <span>Related record:</span>
            <b>{fixedEntity.label}</b>
          </div>
        ) : entityType ? (
          <EntityPicker type={entityType} value={entity} onChange={setEntity} />
        ) : null}
      </Stack>
    </Dialog>
  );
}

/* ---------- Audit trail ---------- */

const TRAIL_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All records" },
  { value: "invoice", label: "Invoices" },
  { value: "bill", label: "Bills" },
  { value: "po", label: "Purchase orders" },
  { value: "payment", label: "Payments" },
  { value: "expense", label: "Expenses" },
  { value: "item", label: "Items" },
  { value: "party", label: "Parties" },
  { value: "audit", label: "Audit findings & queries" },
  { value: "bank", label: "Bank reconciliation" },
  { value: "document", label: "Documents" },
  { value: "integration", label: "Integrations" },
  { value: "settings", label: "Settings & team" },
];

function TrailTab({ onOpenEntity }: { onOpenEntity: Opener }) {
  const [entityType, setEntityType] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => ims.events({ entityType: entityType || undefined, q: dq || undefined, from: from || undefined, to: to || undefined, limit: 500 }), [entityType, dq, from, to]);
  const columns: ReadonlyArray<BosColumn<ImsEvent>> = [
    { key: "when", header: "When", cell: (e) => cell(e.createdAt ? stampLabel(e.createdAt) : "—", e.createdAt ? timeAgo(e.createdAt) : undefined) },
    {
      key: "who",
      header: "Who",
      cell: (e) => (
        <span className="ims-row" style={{ gap: 8 }}>
          <PersonAvatar name={e.actorName ?? "System"} size="xs" />
          {e.actorName ?? "System"}
        </span>
      ),
    },
    { key: "what", header: "What happened", cell: (e) => cell(e.summary, humanize(e.type.replace(/\./g, " · "))) },
    { key: "entity", header: "Record", cell: (e) => (e.entityType ? <Badge tone="neutral">{humanize(e.entityType)}</Badge> : null) },
  ];
  const exportCols: ReadonlyArray<ExportColumn<ImsEvent>> = [
    { header: "When", value: (e) => e.createdAt },
    { header: "Who", value: (e) => e.actorName ?? "System" },
    { header: "Event", value: (e) => e.type },
    { header: "Summary", value: (e) => e.summary },
    { header: "Record type", value: (e) => e.entityType },
    { header: "Record id", value: (e) => e.entityId },
  ];
  return (
    <>
      <Card interactive={false}>
        <Stack gap={12}>
          <span className="ims-sys-mini">Every create, edit, approval, payment, deletion and sync in IMS is written here with who did it and when. Entries cannot be edited or deleted.</span>
          <div className="ims-toolbar" style={{ marginBottom: 0, flexWrap: "wrap" }}>
            <SearchInput wrapperClassName="ims-grow" placeholder="Search activity…" aria-label="Search activity" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select size="sm" aria-label="Record type" value={entityType} style={{ maxWidth: 220 }} onChange={(e) => setEntityType(e.target.value)}>
              {TRAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Input size="sm" type="date" aria-label="From" value={from} max={to || undefined} style={{ maxWidth: 160 }} onChange={(e) => setFrom(e.target.value)} />
            <Input size="sm" type="date" aria-label="To" value={to} min={from || undefined} style={{ maxWidth: 160 }} onChange={(e) => setTo(e.target.value)} />
            <Button size="sm" icon="download" disabled={!state.data?.events.length} onClick={() => state.data && downloadCsv(`audit-trail-${todayLocal()}`, state.data.events, exportCols)}>
              CSV
            </Button>
          </div>
        </Stack>
      </Card>
      <Loaded state={state} rows={6}>
        {(d) => (
          <Card interactive={false}>
            <DataTable
              columns={columns}
              rows={d.events}
              rowKey={(e) => String(e.id)}
              onRowClick={(e) => (canOpenEntity(e.entityType, e.entityId) ? onOpenEntity(e.entityType, e.entityId) : undefined)}
              compact
              caption={d.events.length >= 500 ? "Showing the latest 500 entries — narrow the dates or search to see older ones." : undefined}
              empty={<EmptyState glyph="🕘" title="No activity">Nothing matches these filters.</EmptyState>}
            />
          </Card>
        )}
      </Loaded>
    </>
  );
}

/* ---------- Integrations status ---------- */

const EXPORTS: ReadonlyArray<{ value: TallyExportType; label: string }> = [
  { value: "masters", label: "Masters" },
  { value: "sales", label: "Sales vouchers" },
  { value: "purchases", label: "Purchase vouchers" },
  { value: "notes", label: "Credit / debit notes" },
  { value: "receipts", label: "Receipts & payments" },
  { value: "all", label: "Everything" },
];

function IntegrationsTab({ period }: { period: Period }) {
  const { can, navigate } = useIms();
  const allowed = can("integrations") || can("audit");
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => (allowed ? imsSystem.integrations() : Promise.resolve(null)), [allowed]);
  if (!allowed)
    return (
      <Alert tone="blue" title="Integration details need the Auditor or Integrations permission">
        Ask the owner to give you the Auditor role in Settings → Team & access to see Tally and POS sync status and export Tally XML.
      </Alert>
    );
  const exportXml = async (type: TallyExportType) => {
    const file = await run(`xml:${type}`, () => imsSystem.exportTally(type, { period }), { refresh: false });
    if (file) saveBlob(file);
  };
  const logCols: ReadonlyArray<BosColumn<SyncLogEntry>> = [
    { key: "when", header: "When", cell: (l) => cell(l.createdAt ? stampLabel(l.createdAt) : "—", l.actorName ?? undefined) },
    { key: "what", header: "Sync", cell: (l) => cell(`${l.provider === "pos" ? "POS" : "Tally"} · ${humanize(l.entity)}`, `${humanize(l.direction)} · ${plural(l.records, "record")}`) },
    { key: "status", header: "Result", cell: (l) => cell(<Badge tone={SYNC_TONE[l.status]}>{humanize(l.status)}</Badge>, l.message ?? undefined) },
  ];
  return (
    <Loaded state={state} rows={4}>
      {(d) =>
        d ? (
          <>
            <Grid cols={2} min={300}>
              <Card interactive={false}>
                <Stack gap={12}>
                  <ToolHead glyph="📒" title="Tally" sub={d.tally.enabled ? `Connected${d.tally.config ? ` to ${d.tally.config.company}` : ""}` : "Not connected — use XML export below"} aside={d.tally.lastStatus && d.tally.lastStatus in SYNC_TONE ? <Badge tone={SYNC_TONE[d.tally.lastStatus as SyncStatus]}>{humanize(d.tally.lastStatus)}</Badge> : null} />
                  <KeyValues
                    rows={[
                      ["Last sync", d.tally.lastSyncAt ? `${stampLabel(d.tally.lastSyncAt)} (${timeAgo(d.tally.lastSyncAt)})` : "Never"],
                      ["Mode", d.tally.config ? humanize(d.tally.config.syncMode) : "—"],
                      ["Rhythm", humanize(d.tally.sync.frequency)],
                      ["Masters", `${plural(d.counts.parties, "party")} · ${plural(d.counts.items, "item")}`],
                      ["Vouchers", `${plural(d.counts.invoices, "invoice")} · ${plural(d.counts.bills, "bill")}`],
                    ]}
                  />
                </Stack>
              </Card>
              <Card interactive={false}>
                <Stack gap={12}>
                  <ToolHead glyph="🧾" title="POS" sub={d.pos.enabled ? `Connected${d.pos.config ? ` · ${d.pos.config.provider}` : ""}` : "Not connected"} aside={d.pos.lastStatus && d.pos.lastStatus in SYNC_TONE ? <Badge tone={SYNC_TONE[d.pos.lastStatus as SyncStatus]}>{humanize(d.pos.lastStatus)}</Badge> : null} />
                  <KeyValues
                    rows={[
                      ["Last sale received", d.pos.lastSyncAt ? `${stampLabel(d.pos.lastSyncAt)} (${timeAgo(d.pos.lastSyncAt)})` : "Never"],
                      ["POS bills today", d.counts.posToday],
                      ["Store", d.pos.config?.storeId ?? "—"],
                    ]}
                  />
                </Stack>
              </Card>
            </Grid>
            <Card interactive={false}>
              <Stack gap={12}>
                <ToolHead glyph="⤓" title="Tally XML for the selected period" sub="Import into Tally via Gateway of Tally → Import Data. Uses the period chosen on the Overview tab." />
                <div className="ims-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {EXPORTS.map((x) => (
                    <Button key={x.value} size="sm" icon="download" disabled={isBusy(`xml:${x.value}`)} onClick={() => void exportXml(x.value)}>
                      {x.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => navigate("integrations")}>
                    Open Tally & POS →
                  </Button>
                </div>
              </Stack>
            </Card>
            <Card interactive={false}>
              <Stack gap={10}>
                <b className="ims-strong">Recent sync log</b>
                <DataTable columns={logCols} rows={d.log.slice(0, 25)} rowKey={(l) => String(l.id)} compact empty={<EmptyState glyph="⇄" title="No syncs yet">Tally and POS activity will appear here.</EmptyState>} />
              </Stack>
            </Card>
          </>
        ) : null
      }
    </Loaded>
  );
}

/* ---------- Access ---------- */

function AccessTab() {
  const { navigate } = useIms();
  const state = useImsData(() => ims.team(), []);
  const columns: ReadonlyArray<BosColumn<ImsMember>> = [
    {
      key: "name",
      header: "Member",
      cell: (m) => (
        <span className="ims-row" style={{ gap: 8 }}>
          <PersonAvatar name={memberName(m)} size="xs" />
          {cell(memberName(m), m.email ?? undefined, true)}
        </span>
      ),
    },
    { key: "role", header: "IMS role", cell: (m) => <Badge tone={m.imsRole === "auditor" ? "lavender" : m.imsRole === "accountant" ? "blue" : m.imsRole === "owner" ? "emerald" : "neutral"}>{ROLE_LABEL[m.imsRole]}</Badge> },
    { key: "access", header: "Auditor workspace", cell: (m) => (["owner", "auditor"].includes(m.imsRole) ? "Full (can verify & raise)" : m.imsRole === "accountant" || m.imsRole === "manager" ? "Depends on role permissions" : "No access by default") },
    { key: "active", header: "", cell: (m) => (m.active ? null : <Badge tone="neutral">Inactive</Badge>) },
  ];
  return (
    <>
      <Card interactive={false}>
        <Stack gap={12}>
          <ToolHead glyph="🔐" title="Give your CA or auditor access" sub="Auditors work inside your business account with read-only access to your books, plus the ability to verify findings and raise flags and queries." />
          <ol className="ims-sys-steps">
            <li>
              <b>1</b>
              <span>Add the CA to your Justx business as a team member (they sign in with their own account — never share passwords).</span>
            </li>
            <li>
              <b>2</b>
              <span>
                In <b>Settings → Team & access</b>, set their IMS role to <b>Auditor / CA</b>. Fine-tune what each role sees in <b>Role permissions</b>.
              </span>
            </li>
            <li>
              <b>3</b>
              <span>They land here: findings, ledgers, bank reconciliation, GST and documents. Every action they take is recorded in the audit trail.</span>
            </li>
            <li>
              <b>4</b>
              <span>When the audit is done, mark the member inactive — their history and queries stay on record.</span>
            </li>
          </ol>
          <div className="ims-row" style={{ gap: 8 }}>
            <Button variant="primary" onClick={() => navigate("settings", "team")}>
              Open Team & access
            </Button>
            <Button onClick={() => navigate("settings", "permissions")}>Role permissions</Button>
          </div>
        </Stack>
      </Card>
      <Loaded state={state} rows={4}>
        {(d) => {
          const auditors = d.members.filter((m) => m.active && m.imsRole === "auditor").length;
          return (
            <Card interactive={false}>
              <Stack gap={10}>
                <div className="ims-between">
                  <b className="ims-strong">Team</b>
                  <span className="ims-sys-mini">{auditors ? `${plural(auditors, "active auditor")}` : "No auditor added yet"}</span>
                </div>
                <DataTable columns={columns} rows={d.members} rowKey={(m) => String(m.userId)} compact />
              </Stack>
            </Card>
          );
        }}
      </Loaded>
    </>
  );
}

export default AuditModule;
