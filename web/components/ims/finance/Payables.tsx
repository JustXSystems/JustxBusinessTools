"use client";

import "./finance.css";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Card, DataTable, EmptyState, Grid, KpiCard, SearchInput, Segmented, Select, WidgetCard, type BosColumn } from "@/components/bos";
import { AP_PRIORITY_BADGE, BILL_BADGE, billPayable, finance, gstStateName, intraStateFor, methodLabel, RUN_BADGE, type ApPriority, type BillDetail, type ImsBill, type PaymentRun, type PayMethod } from "@/lib/ims/finance";
import { computeTotals, dateLabel, downloadCsv, inrCompact, inrExact, stampLabel } from "@/lib/ims/format";
import { Loaded, PageHeader, RequirePerm, Stack, StatusBadge, SubTabs, useIms, useImsAction, useImsData, usePrint } from "../core";
import { DocumentPaper } from "../shared/DocumentPaper";
import { usePartyOptions } from "../shared/pickers";
import { BillEditorDialog, CreateRunDialog, RunDetailDialog, ScheduleDialog } from "./BillDialogs";
import { BackLink, ConfirmDialog, KeyValues, PaymentDialog, ReasonDialog, sellerOf, Stats, Timeline } from "./shared";

type View = { kind: "list" } | { kind: "view"; id: string };
type Tab = "bills" | "runs";

const STATUS_TABS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open", label: "Open" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "on_hold", label: "On hold" },
  { value: "overdue", label: "Overdue" },
  { value: "partial", label: "Partly paid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export function PayablesModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("payables"));
  const [view, setView] = useState<View>(() => (intent?.startsWith("open:") ? { kind: "view", id: intent.slice(5) } : { kind: "list" }));
  const [tab, setTab] = useState<Tab>("bills");
  const [adding, setAdding] = useState(intent === "new");

  return (
    <RequirePerm perm={["payables", "approvals"]} what="accounts payable">
      {view.kind === "view" ? (
        <BillView id={view.id} onBack={() => setView({ kind: "list" })} />
      ) : (
        <Stack>
          <PageHeader
            title="Accounts Payable"
            sub="Supplier bills, approvals and payment runs."
            actions={
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add bill
              </Button>
            }
          />
          <SubTabs
            label="Payables sections"
            value={tab}
            onChange={setTab}
            options={[
              { value: "bills", label: "Bills" },
              { value: "runs", label: "Payment runs" },
            ]}
          />
          {tab === "bills" ? <BillList onOpen={(id) => setView({ kind: "view", id })} /> : <RunList onOpenBill={(id) => setView({ kind: "view", id })} />}
        </Stack>
      )}
      {adding ? <AddBill onClose={() => setAdding(false)} onSaved={(id) => setView({ kind: "view", id })} /> : null}
    </RequirePerm>
  );
}

function AddBill({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const { can } = useIms();
  return (
    <BillEditorDialog
      bill={null}
      canApprove={can("approvals")}
      onClose={onClose}
      onSaved={(id) => {
        onClose();
        onSaved(id);
      }}
    />
  );
}

function BillList({ onOpen }: { onOpen: (id: string) => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState<"" | ApPriority>("");
  const [supplierId, setSupplierId] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runBills, setRunBills] = useState<ImsBill[] | null>(null);
  const [createdRun, setCreatedRun] = useState<PaymentRun | null>(null);
  const suppliers = usePartyOptions("supplier");
  const state = useImsData(() => finance.bills({ status, priority: priority || undefined, supplierId: supplierId || undefined, q: q.trim() || undefined }), [status, priority, supplierId, q]);

  const columns: BosColumn<ImsBill>[] = [
    {
      key: "bill",
      header: "Bill",
      cell: (b) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{b.billNo}</span>
          <small>{[b.supplierBillNo, dateLabel(b.billDate)].filter(Boolean).join(" · ")}</small>
        </span>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (b) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{b.supplierName}</span>
          <small>{[b.poNo ? `PO ${b.poNo}` : null, b.category].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      cell: (b) =>
        b.balance <= 0.005 || b.status === "cancelled" ? (
          <span className="ims-faint">{dateLabel(b.dueDate)}</span>
        ) : (
          <span className="ims-cell-stack">
            <span className={b.priority === "OVERDUE" ? "ims-neg" : undefined}>{dateLabel(b.dueDate)}</span>
            <small>{b.scheduledOn ? `Scheduled ${dateLabel(b.scheduledOn)}` : AP_PRIORITY_BADGE[b.priority].text}</small>
          </span>
        ),
    },
    { key: "total", header: "Total", align: "right", mono: true, cell: (b) => inrExact(b.grandTotal) },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (b) => (b.balance > 0.005 ? inrExact(b.balance) : <span className="ims-faint">—</span>) },
    {
      key: "status",
      header: "Status",
      cell: (b) => (
        <span className="ims-cell-stack">
          <StatusBadge view={BILL_BADGE[b.displayStatus]} />
          {b.holdReason && b.status === "on_hold" ? <small>{b.holdReason}</small> : null}
        </span>
      ),
    },
  ];

  return (
    <Loaded state={state}>
      {(data) => {
        const k = data.kpis;
        const chosen = data.bills.filter((b) => selected.has(b.id));
        const payable = chosen.filter((b) => billPayable(b.status) && b.balance > 0.005);
        const approvable = chosen.filter((b) => b.status === "pending_approval");
        return (
          <Stack gap={16}>
            <Grid cols={3} min={170}>
              <KpiCard label="Total payable" value={inrCompact(k.totalPayable)} chip={{ color: "blue", glyph: "📤" }} delta={k.pendingApprovalCount ? `${k.pendingApprovalCount} awaiting approval (${inrCompact(k.pendingApproval)})` : "Open supplier bills"} deltaTone={k.pendingApprovalCount ? "warn" : "muted"} />
              <KpiCard label="Overdue" value={inrCompact(k.overdue)} valueTone={k.overdue > 0 ? "coral" : undefined} chip={{ color: "rose", glyph: "⏰" }} delta={`${k.overdueCount} bill${k.overdueCount === 1 ? "" : "s"} past due`} deltaTone={k.overdueCount ? "down" : "up"} />
              <KpiCard label="Due this week" value={inrCompact(k.dueThisWeek)} chip={{ color: "amber", glyph: "📅" }} delta={`${k.dueThisWeekCount} bill${k.dueThisWeekCount === 1 ? "" : "s"}`} deltaTone="info" />
              <KpiCard label="Scheduled" value={inrCompact(k.scheduled)} chip={{ color: "lavender", glyph: "🗓" }} delta={`${k.scheduledCount} in payment runs`} deltaTone="muted" />
              <KpiCard label="On hold" value={inrCompact(k.onHold)} chip={{ color: "sage", glyph: "⏸" }} delta={`${k.onHoldCount} bill${k.onHoldCount === 1 ? "" : "s"}`} deltaTone={k.onHoldCount ? "warn" : "muted"} />
              <KpiCard label="Paid this month" value={inrCompact(k.paidThisMonth)} valueTone="emerald" chip={{ color: "mint", glyph: "✓" }} delta={`${k.paidThisMonthCount} payments`} deltaTone="up" />
            </Grid>

            <Card interactive={false}>
              <div className="ims-toolbar">
                <SearchInput wrapperClassName="ims-grow" placeholder="Search bill no., supplier bill no., supplier, PO…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
                <Select size="sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier" style={{ maxWidth: 220 }}>
                  <option value="">All suppliers</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Select size="sm" value={priority} onChange={(e) => setPriority(e.target.value as "" | ApPriority)} aria-label="Urgency" style={{ maxWidth: 160 }}>
                  <option value="">Any urgency</option>
                  {(["OVERDUE", "DUE_TODAY", "DUE_SOON", "UPCOMING"] as const).map((p) => (
                    <option key={p} value={p}>
                      {AP_PRIORITY_BADGE[p].text}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  icon="download"
                  disabled={!data.bills.length}
                  onClick={() =>
                    downloadCsv("payables", data.bills, [
                      { header: "Bill no", value: (b) => b.billNo },
                      { header: "Supplier bill no", value: (b) => b.supplierBillNo },
                      { header: "Supplier", value: (b) => b.supplierName },
                      { header: "Bill date", value: (b) => b.billDate },
                      { header: "Due date", value: (b) => b.dueDate },
                      { header: "Taxable", value: (b) => b.subtotal },
                      { header: "GST", value: (b) => b.taxTotal },
                      { header: "Total", value: (b) => b.grandTotal },
                      { header: "Paid", value: (b) => b.amountPaid },
                      { header: "Balance", value: (b) => b.balance },
                      { header: "Status", value: (b) => BILL_BADGE[b.displayStatus].text },
                      { header: "Hold reason", value: (b) => b.holdReason },
                    ])
                  }
                >
                  Export
                </Button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <Segmented
                  size="sm"
                  scroll
                  role="tabs"
                  aria-label="Bill status"
                  value={status}
                  onChange={(v) => {
                    setStatus(v);
                    setSelected(new Set());
                  }}
                  options={STATUS_TABS.map((t) => ({ value: t.value, label: t.value === "open" ? t.label : `${t.label} · ${data.counts[t.value] ?? 0}` }))}
                />
              </div>
              <DataTable
                caption="Supplier bills"
                columns={columns}
                rows={data.bills}
                rowKey={(b) => b.id}
                onRowClick={(b) => onOpen(b.id)}
                chevron
                selection={{ selected, onChange: setSelected }}
                bulkActions={() => (
                  <div className="fin-bulk">
                    {data.canPay ? (
                      <Button size="sm" variant="primary" icon="wallet" disabled={!payable.length} onClick={() => setRunBills(payable)}>
                        Payment run ({payable.length})
                      </Button>
                    ) : null}
                    {data.canApprove && approvable.length ? (
                      <Button
                        size="sm"
                        icon="check"
                        disabled={busy === "bulk-approve"}
                        onClick={async () => {
                          const out = await run(
                            "bulk-approve",
                            async () => {
                              for (const b of approvable) await finance.approveBill(b.id);
                              return true;
                            },
                            { success: `Approved ${approvable.length} bill${approvable.length === 1 ? "" : "s"}` },
                          );
                          if (out) setSelected(new Set());
                        }}
                      >
                        Approve ({approvable.length})
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      Clear
                    </Button>
                    {chosen.length > payable.length && data.canPay ? <span className="fin-note">Only approved / scheduled bills with a balance go into a run.</span> : null}
                  </div>
                )}
                empty={
                  <EmptyState glyph="📤" title={status === "open" && !q && !supplierId && !priority ? "No open bills" : "No bills match these filters"}>
                    Bills appear here when goods are received against a purchase order, or when you add one manually.
                  </EmptyState>
                }
              />
            </Card>

            {runBills ? (
              <CreateRunDialog
                bills={runBills}
                today={session.today}
                onClose={() => setRunBills(null)}
                onCreated={(r) => {
                  setRunBills(null);
                  setSelected(new Set());
                  setCreatedRun(r);
                }}
              />
            ) : null}
            {createdRun ? <RunDetailDialog runId={createdRun.id} today={session.today} canPay={data.canPay} onClose={() => setCreatedRun(null)} onOpenBill={onOpen} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function RunList({ onOpenBill }: { onOpenBill: (id: string) => void }) {
  const { session, can } = useIms();
  const state = useImsData(() => finance.paymentRuns(), []);
  const [open, setOpen] = useState<string | null>(null);
  const columns: BosColumn<PaymentRun>[] = [
    {
      key: "run",
      header: "Run",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{r.runNo}</span>
          <small>
            {dateLabel(r.runDate)} · {methodLabel(r.method)}
          </small>
        </span>
      ),
    },
    { key: "bills", header: "Bills", align: "right", cell: (r) => r.billCount },
    { key: "total", header: "Total", align: "right", mono: true, cell: (r) => inrExact(r.total) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge view={RUN_BADGE[r.status]} /> },
    { key: "by", header: "Created", cell: (r) => <span className="ims-cell-stack"><span>{r.createdByName ?? "—"}</span><small>{stampLabel(r.createdAt)}</small></span> },
  ];
  return (
    <Card interactive={false}>
      <Loaded state={state} rows={1}>
        {(d) => (
          <DataTable
            caption="Payment runs"
            columns={columns}
            rows={d.runs}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpen(r.id)}
            chevron
            empty={
              <EmptyState glyph="🗓" title="No payment runs yet">
                Select approved bills on the Bills tab and choose “Payment run” to pay or schedule them together.
              </EmptyState>
            }
          />
        )}
      </Loaded>
      {open ? (
        <RunDetailDialog
          runId={open}
          today={session.today}
          canPay={can("payables")}
          onClose={() => setOpen(null)}
          onOpenBill={(id) => {
            setOpen(null);
            onOpenBill(id);
          }}
        />
      ) : null}
    </Card>
  );
}

/* ---------- Bill document view ---------- */

type Dlg = null | "pay" | "hold" | "cancel" | "schedule" | "edit" | "approve" | { voidId: string; amount: number };

function BillView({ id, onBack }: { id: string; onBack: () => void }) {
  const state = useImsData(() => finance.bill(id), [id]);
  return (
    <Stack gap={16}>
      <BackLink onClick={onBack}>All bills</BackLink>
      <Loaded state={state} rows={3}>
        {(d) => <BillBody detail={d} />}
      </Loaded>
    </Stack>
  );
}

function BillBody({ detail }: { detail: BillDetail }) {
  const { session, can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const [dlg, setDlg] = useState<Dlg>(null);
  const b = detail.bill;
  const canPay = can("payables");
  const canApprove = can("approvals");
  const intraState = intraStateFor(session.settings, gstStateName(b.supplierGstin));
  const totals = useMemo(() => computeTotals(b.lines, intraState), [b.lines, intraState]);
  const open = b.status !== "cancelled" && b.balance > 0.005;
  const editable = b.status !== "cancelled" && b.amountPaid <= 0.005 && b.status !== "scheduled";

  const actions: ReactNode[] = [];
  if (b.status === "pending_approval" && canApprove) {
    actions.push(
      <Button key="approve" variant="success" icon="check" disabled={busy === "approve"} onClick={() => run("approve", () => finance.approveBill(b.id), { success: "Bill approved for payment" })}>
        Approve
      </Button>,
    );
  }
  if (open && billPayable(b.status) && canPay) {
    actions.push(
      <Button key="pay" variant="success" icon="wallet" onClick={() => setDlg("pay")}>
        Pay
      </Button>,
    );
    if (b.status === "approved") {
      actions.push(
        <Button key="schedule" icon="calendar" onClick={() => setDlg("schedule")}>
          Schedule
        </Button>,
      );
    } else {
      actions.push(
        <Button key="unschedule" variant="ghost" disabled={busy === "unschedule"} onClick={() => run("unschedule", () => finance.unscheduleBill(b.id), { success: "Removed from schedule" })}>
          Unschedule
        </Button>,
      );
    }
  }
  if (open && b.status !== "on_hold" && (canApprove || canPay)) {
    actions.push(
      <Button key="hold" variant="ghost" onClick={() => setDlg("hold")}>
        Put on hold
      </Button>,
    );
  }
  if (b.status === "on_hold" && (canApprove || canPay)) {
    actions.push(
      <Button key="release" icon="refresh" disabled={busy === "release"} onClick={() => run("release", () => finance.releaseBill(b.id), { success: "Hold released" })}>
        Release hold
      </Button>,
    );
  }

  return (
    <>
      <div className="fin-doc-page">
        <div style={{ minWidth: 0 }}>
          {b.lines.length ? (
            <DocumentPaper
              title="PURCHASE BILL"
              seller={{ label: "From", name: b.supplierName, gstin: b.supplierGstin, phone: b.supplierMobile, email: b.supplierEmail }}
              party={{ ...sellerOf(session), label: "Billed to" }}
              meta={[
                { label: "Bill no.", value: b.billNo },
                { label: "Supplier bill", value: b.supplierBillNo || "—" },
                { label: "Bill date", value: dateLabel(b.billDate) },
                { label: "Due date", value: dateLabel(b.dueDate) },
                ...(b.poNo ? [{ label: "PO", value: b.poNo }] : []),
              ]}
              totals={totals}
              intraState={intraState}
              notes={b.notes}
              stamp={b.displayStatus === "paid" ? { text: "PAID", color: "#1FA679" } : b.displayStatus === "on_hold" ? { text: "ON HOLD", color: "#7C5CD6" } : b.displayStatus === "overdue" ? { text: "OVERDUE", color: "#E1483F" } : null}
            />
          ) : (
            <Card interactive={false}>
              <div className="fin-section-title">Amount-only bill</div>
              <KeyValues
                rows={[
                  ["Supplier", b.supplierName],
                  ["Supplier bill no.", b.supplierBillNo],
                  ["Bill date", dateLabel(b.billDate)],
                  ["Due date", dateLabel(b.dueDate)],
                  ["Category", b.category ?? "Purchase"],
                  ["Taxable", inrExact(b.subtotal)],
                  ["GST", inrExact(b.taxTotal)],
                  ["Total", inrExact(b.grandTotal)],
                  ["Notes", b.notes],
                ]}
              />
            </Card>
          )}
        </div>

        <aside className="fin-doc-side" aria-label="Bill actions">
          <Card interactive={false}>
            <div className="ims-between" style={{ marginBottom: 10 }}>
              <span className="ims-strong" style={{ fontSize: 16 }}>
                {b.billNo}
              </span>
              <StatusBadge view={BILL_BADGE[b.displayStatus]} />
            </div>
            <Stats
              items={[
                { label: "Total", value: inrExact(b.grandTotal) },
                { label: "Paid", value: inrExact(b.amountPaid), tone: b.amountPaid > 0 ? "emerald" : null },
                { label: "Balance", value: inrExact(b.balance), tone: b.priority === "OVERDUE" && open ? "coral" : open ? "amber" : null },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <KeyValues
                rows={[
                  ["Supplier", b.supplierName],
                  ["Due", open ? `${dateLabel(b.dueDate)} · ${AP_PRIORITY_BADGE[b.priority].text}` : dateLabel(b.dueDate)],
                  ["Scheduled", b.scheduledOn ? `${dateLabel(b.scheduledOn)} · ${methodLabel(b.payMethod)}` : null],
                  ["Hold reason", b.status === "on_hold" ? b.holdReason : null],
                  ["Approved by", b.decidedByName ? `${b.decidedByName} · ${stampLabel(b.decidedAt)}` : null],
                  ["Added by", b.createdByName],
                ]}
              />
            </div>
            {b.status === "pending_approval" && !canApprove ? (
              <div style={{ marginTop: 12 }}>
                <Alert tone="amber" title="Waiting for approval">
                  An approver has been notified. It can be paid once approved.
                </Alert>
              </div>
            ) : null}
            <div className="ims-row" style={{ marginTop: 14 }}>
              {actions}
              <Button icon="printer" onClick={print} disabled={!b.lines.length}>
                Print
              </Button>
            </div>
            <div className="ims-row" style={{ marginTop: 8 }}>
              {editable && (canPay || canApprove) ? (
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setDlg("edit")}>
                  Edit
                </Button>
              ) : null}
              {b.poId && can("po") ? (
                <Button size="sm" variant="ghost" onClick={() => navigate("purchase", `open:${b.poId}`)}>
                  View PO
                </Button>
              ) : null}
              {b.status !== "cancelled" && b.amountPaid <= 0.005 && (canPay || canApprove) ? (
                <Button size="sm" variant="ghost" onClick={() => setDlg("cancel")}>
                  Cancel bill
                </Button>
              ) : null}
            </div>
          </Card>

          {detail.payments.length ? (
            <WidgetCard title="Payments" note={`${detail.payments.length}`}>
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <span className="ims-cell-stack">
                            <span>{dateLabel(p.paidOn)}</span>
                            <small>
                              {methodLabel(p.method)}
                              {p.reference ? ` · ${p.reference}` : ""}
                            </small>
                          </span>
                        </td>
                        <td className="is-num">{inrExact(p.amount)}</td>
                        <td style={{ width: 1 }}>
                          {canPay ? (
                            <Button size="sm" variant="ghost" onClick={() => setDlg({ voidId: p.id, amount: p.amount })}>
                              Void
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </WidgetCard>
          ) : null}

          <WidgetCard title="History">
            <Timeline
              items={detail.events.map((e) => ({
                key: String(e.id),
                text: e.summary,
                meta: `${e.actorName ?? "System"} · ${stampLabel(e.createdAt)}`,
                tone: /approved|paid|payment|released/.test(e.type) ? "good" : /cancel|hold/.test(e.type) ? "bad" : /approval_requested|created/.test(e.type) ? "warn" : null,
              }))}
            />
          </WidgetCard>
        </aside>
      </div>

      <PaymentDialog
        open={dlg === "pay"}
        onClose={() => setDlg(null)}
        title={`Pay ${b.supplierName}`}
        description={`${b.billNo}${b.supplierBillNo ? ` · ${b.supplierBillNo}` : ""}`}
        balance={b.balance}
        today={session.today}
        defaultMethod={(b.payMethod as PayMethod | null) ?? "bank"}
        confirmLabel="Record payment"
        busy={busy === "pay"}
        onSubmit={(input) => run("pay", () => finance.payBill(b.id, input), { success: `Paid ${inrExact(input.amount)} to ${b.supplierName}` })}
      />
      {dlg === "schedule" ? <ScheduleDialog bill={b} today={session.today} onClose={() => setDlg(null)} /> : null}
      {dlg === "edit" ? <BillEditorDialog bill={b} canApprove={canApprove} onClose={() => setDlg(null)} onSaved={() => setDlg(null)} /> : null}
      <ReasonDialog
        open={dlg === "hold"}
        onClose={() => setDlg(null)}
        title={`Put ${b.billNo} on hold`}
        description="Held bills can't be paid or scheduled until released."
        confirmLabel="Put on hold"
        minLength={2}
        busy={busy === "hold"}
        suggestions={session.settings.taxonomy.holdReasons}
        onConfirm={async (reason) => {
          const out = await run("hold", () => finance.holdBill(b.id, reason), { success: "Bill on hold" });
          if (out) setDlg(null);
        }}
      />
      <ReasonDialog
        open={dlg === "cancel"}
        onClose={() => setDlg(null)}
        title={`Cancel ${b.billNo}?`}
        description="The bill stops counting towards payables. This can't be undone."
        confirmLabel="Cancel bill"
        destructive
        busy={busy === "cancel"}
        suggestions={["Duplicate bill", "Entered by mistake", "Supplier issued a credit note", "Goods returned"]}
        onConfirm={async (reason) => {
          const out = await run("cancel", () => finance.cancelBill(b.id, reason), { success: "Bill cancelled" });
          if (out) setDlg(null);
        }}
      />
      <ConfirmDialog
        open={typeof dlg === "object" && dlg !== null}
        onClose={() => setDlg(null)}
        title="Void this payment?"
        description={typeof dlg === "object" && dlg ? `${inrExact(dlg.amount)} will be removed and the bill balance goes back up.` : undefined}
        confirmLabel="Void payment"
        destructive
        busy={busy === "void"}
        onConfirm={async () => {
          if (typeof dlg !== "object" || !dlg) return;
          const out = await run("void", () => finance.voidPayment(dlg.voidId).then(() => true), { success: "Payment voided" });
          if (out) setDlg(null);
        }}
      />
    </>
  );
}

export default PayablesModule;
