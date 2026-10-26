"use client";

import "./purchase.css";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Grid, KpiCard, type BosColumn } from "@/components/bos";
import { ims, type ImsEvent, type ImsStockCheck } from "@/lib/ims/api";
import { dateLabel, inr, inrCompact, inrExact, qtyText, stampLabel, timeAgo } from "@/lib/ims/format";
import { purchase, type ApprovalBill, type PurchaseOrder } from "@/lib/ims/purchase";
import { ErrorBlock, LoadingBlock, Loaded, PageHeader, PersonAvatar, RequirePerm, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { KeyValues, ReasonDialog } from "./ui";

type Tab = "pos" | "bills" | "checks" | "history";

const PO_REJECT_REASONS = ["Price too high — renegotiate", "Quantity too large", "Wrong supplier", "Not needed now"];
const CHECK_REJECT_REASONS = ["Recount the mismatched items", "Variance too high — recheck", "Count looks incomplete"];
const DECISION_TYPES = new Set(["po.approved", "po.rejected", "bill.approved", "bill.held", "check.approved", "check.returned"]);

const DECISION_VIEW: Record<string, { label: string; tone: "emerald" | "coral" | "amber" }> = {
  approved: { label: "APPROVED", tone: "emerald" },
  rejected: { label: "REJECTED", tone: "coral" },
  held: { label: "ON HOLD", tone: "amber" },
  returned: { label: "RETURNED", tone: "amber" },
};

export function ApprovalsModule() {
  return (
    <RequirePerm perm="approvals" what="approvals">
      <Inbox />
    </RequirePerm>
  );
}

function Inbox() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("approvals"));
  const [tab, setTab] = useState<Tab>(() => (intent === "bills" || intent === "checks" || intent === "history" ? intent : "pos"));
  const [reviewId, setReviewId] = useState<string | null>(() => (intent?.startsWith("open:") ? intent.slice(5) : null));

  const pos = useImsData(() => purchase.orders({ status: "pending_approval" }), []);
  const bills = useImsData(async () => ({ list: await purchase.pendingBills() }), []);
  const checks = useImsData(async () => (await ims.checks()).checks.filter((c) => c.status === "submitted"), []);

  const billList = bills.data?.list;
  const billsUnavailable = billList === null;
  const poCount = pos.data?.orders.length ?? 0;
  const billCount = billList?.length ?? 0;
  const checkCount = checks.data?.length ?? 0;
  const loading = !pos.data || !bills.data || !checks.data;
  const total = poCount + billCount + checkCount;

  return (
    <Stack>
      <PageHeader title="Approvals" sub={loading ? "Loading what needs your sign-off…" : total ? `${total} item${total === 1 ? "" : "s"} waiting for your decision` : "You're all caught up"} />

      <Grid cols={4} min={150}>
        <KpiCard label="Purchase orders" value={poCount} chip={{ color: "blue", glyph: "🛒" }} delta={poCount ? inrCompact(pos.data?.summary.awaitingValue ?? 0) : "None pending"} deltaTone={poCount ? "warn" : "muted"} />
        <KpiCard label="Supplier bills" value={billsUnavailable ? "—" : billCount} chip={{ color: "rose", glyph: "₹" }} delta={billsUnavailable ? "Not available yet" : billCount ? inrCompact((billList ?? []).reduce((t, b) => t + b.grandTotal, 0)) : "None pending"} deltaTone={billCount ? "warn" : "muted"} />
        <KpiCard label="Stock checks" value={checkCount} chip={{ color: "mint", glyph: "✓" }} delta={checkCount ? `${(checks.data ?? []).reduce((t, c) => t + c.mismatchCount, 0)} mismatches` : "None submitted"} deltaTone={checkCount ? "warn" : "muted"} />
        <KpiCard label="Approval limit" value={inrCompact(pos.data?.approvalLimit ?? 0)} chip={{ color: "lavender", glyph: "🛡" }} delta="POs at or above need sign-off" deltaTone="muted" />
      </Grid>

      <SubTabs<Tab>
        value={tab}
        onChange={setTab}
        label="Approval type"
        options={[
          { value: "pos", label: `Purchase orders${poCount ? ` · ${poCount}` : ""}` },
          { value: "bills", label: `Bills${billCount ? ` · ${billCount}` : ""}` },
          { value: "checks", label: `Stock checks${checkCount ? ` · ${checkCount}` : ""}` },
          { value: "history", label: "History" },
        ]}
      />

      {tab === "pos" ? (
        <Loaded state={pos} rows={3}>
          {(d) => <PoQueue orders={d.orders} onReview={setReviewId} />}
        </Loaded>
      ) : tab === "bills" ? (
        bills.error && !bills.data ? (
          <ErrorBlock error={bills.error} onRetry={bills.reload} />
        ) : !bills.data ? (
          <LoadingBlock rows={3} />
        ) : bills.data.list === null ? (
          <Card interactive={false}>
            <EmptyState icon="file" title="Bill approvals aren't available yet">
              Supplier bills will appear here once the payables module is switched on for your business.
            </EmptyState>
          </Card>
        ) : (
          <BillQueue bills={bills.data.list} />
        )
      ) : tab === "checks" ? (
        <Loaded state={checks} rows={3}>
          {(list) => <CheckQueue checks={list} />}
        </Loaded>
      ) : (
        <History />
      )}

      {reviewId ? <PoReview id={reviewId} onClose={() => setReviewId(null)} /> : null}
    </Stack>
  );
}

/* ---------- Purchase orders ---------- */

function PoQueue({ orders, onReview }: { orders: PurchaseOrder[]; onReview: (id: string) => void }) {
  const { run, busy } = useImsAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<PurchaseOrder | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const live = useMemo(() => new Set([...selected].filter((id) => orders.some((o) => o.id === id))), [selected, orders]);

  if (!orders.length)
    return (
      <Card interactive={false}>
        <EmptyState icon="check" title="No purchase orders waiting">
          POs at or above the approval limit land here when they&apos;re submitted.
        </EmptyState>
      </Card>
    );

  const columns: BosColumn<PurchaseOrder>[] = [
    {
      key: "po",
      header: "PO",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span className="ims-strong ims-mono">{o.poNo}</span>
          <small>{o.submittedAt ? `Submitted ${timeAgo(o.submittedAt)}` : dateLabel(o.orderDate)}</small>
        </span>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (o) => (
        <span className="ims-cell-stack">
          <span>{o.supplierName}</span>
          <small>{o.createdByName ? `Raised by ${o.createdByName}` : `${o.lineCount} line${o.lineCount === 1 ? "" : "s"}`}</small>
        </span>
      ),
    },
    { key: "lines", header: "Lines", align: "right", cell: (o) => o.lineCount },
    { key: "expected", header: "Expected", mono: true, cell: (o) => (o.expectedDate ? dateLabel(o.expectedDate) : "—") },
    { key: "total", header: "Total", align: "right", cell: (o) => <span className="ims-num ims-strong">{inr(o.grandTotal)}</span> },
    {
      key: "actions",
      header: <span className="bos-sr-only">Actions</span>,
      align: "right",
      cell: (o) => (
        <span className="ims-row" style={{ gap: 6, flexWrap: "nowrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(o)}>
            Reject
          </Button>
          <Button size="sm" variant="success" icon="check" disabled={Boolean(busy)} onClick={() => run(`approve-${o.id}`, () => purchase.approveOrder(o.id), { success: "Approved", description: `${o.poNo} · ${o.supplierName}` })}>
            Approve
          </Button>
        </span>
      ),
    },
  ];

  const approveSelected = async () => {
    const ids = [...live];
    const out = await run("bulk", () => purchase.bulkApprove(ids), { success: `Approved ${ids.length} PO${ids.length === 1 ? "" : "s"}` });
    if (!out) return;
    setSelected(new Set());
    setBulkErrors(out.errors);
  };

  return (
    <div className="bos-stack" style={{ gap: 12 }}>
      {bulkErrors.length ? (
        <Alert tone="amber" title="Some POs couldn't be approved">
          {bulkErrors.join(" · ")}
        </Alert>
      ) : null}
      <DataTable
        caption="Purchase orders awaiting approval"
        columns={columns}
        rows={orders}
        rowKey={(o) => o.id}
        onRowClick={(o) => onReview(o.id)}
        chevron
        selection={{ selected: live, onChange: setSelected }}
        bulkActions={(n) => (
          <Button size="sm" variant="success" icon="check" disabled={busy === "bulk"} onClick={approveSelected}>
            {busy === "bulk" ? "Approving…" : `Approve ${n} selected`}
          </Button>
        )}
      />
      <ReasonDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.poNo}?` : "Reject"}
        description="The requester is notified with your reason and can edit and resubmit."
        confirmLabel="Reject PO"
        destructive
        busy={Boolean(busy)}
        suggestions={PO_REJECT_REASONS}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await run(`reject-${rejecting.id}`, () => purchase.rejectOrder(rejecting.id, reason), { success: "Rejected", description: rejecting.poNo, tone: "amber" });
          setRejecting(null);
        }}
      />
    </div>
  );
}

/** Quick review of one PO (also the target of approval notifications). */
function PoReview({ id, onClose }: { id: string; onClose: () => void }) {
  const { navigate } = useIms();
  const { run, busy } = useImsAction();
  const state = useImsData(() => purchase.order(id), [id]);
  const [rejecting, setRejecting] = useState(false);
  const o = state.data?.order;
  const pending = o?.status === "pending_approval";

  return (
    <>
      <Dialog
        open={!rejecting}
        onClose={onClose}
        wide
        title={o ? `${o.poNo} · ${o.supplierName}` : "Purchase order"}
        description={o ? `${inrExact(o.grandTotal)} · ${o.lineCount} line${o.lineCount === 1 ? "" : "s"}${o.createdByName ? ` · raised by ${o.createdByName}` : ""}` : undefined}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("purchase", `open:${id}`)}>
              Open full PO
            </Button>
            {pending && o ? (
              <>
                <Button variant="destructive" onClick={() => setRejecting(true)}>
                  Reject
                </Button>
                <Button
                  variant="success"
                  icon="check"
                  disabled={busy === "approve"}
                  onClick={async () => {
                    const out = await run("approve", () => purchase.approveOrder(o.id), { success: "Approved", description: o.poNo });
                    if (out) onClose();
                  }}
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>Close</Button>
            )}
          </>
        }
      >
        <div className="ims-lg bos-stack" style={{ gap: 14 }}>
          <Loaded state={state} rows={3}>
            {(d) => (
              <>
                {!pending ? (
                  <Alert tone="blue" title="Already decided">
                    This PO is {d.order.status.replace(/_/g, " ")}
                    {d.order.decidedByName ? ` — ${d.order.decidedByName}` : ""}.
                  </Alert>
                ) : null}
                <KeyValues
                  rows={[
                    ["Order date", dateLabel(d.order.orderDate)],
                    ["Expected", d.order.expectedDate ? dateLabel(d.order.expectedDate) : null],
                    ["Supplier GSTIN", d.order.supplier.gstin ?? "Unregistered"],
                    ["Supply", d.order.intraState ? "Intra-state (CGST + SGST)" : "Inter-state (IGST)"],
                    ["Payment terms", d.order.paymentTermsDays == null ? null : `${d.order.paymentTermsDays} days`],
                    ["Submitted", d.order.submittedAt ? stampLabel(d.order.submittedAt) : null],
                    ["Notes", d.order.notes],
                  ]}
                />
                <div className="ims-list">
                  {d.order.lines.map((l, i) => (
                    <div key={`${l.itemId ?? l.name}-${i}`} className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span>{l.name}</span>
                        <small>
                          {qtyText(l.qty, l.unit)} × {inrExact(l.rate)}
                          {l.discountPct ? ` · ${l.discountPct}% off` : ""} · GST {l.gstRate}%
                        </small>
                      </span>
                      <span className="ims-num">{inr(l.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="ims-row" style={{ justifyContent: "space-between" }}>
                  <span className="ims-faint">
                    Taxable {inrExact(d.order.taxable)} · GST {inrExact(d.order.taxTotal)}
                  </span>
                  <span className="ims-strong">{inrExact(d.order.grandTotal)}</span>
                </div>
              </>
            )}
          </Loaded>
        </div>
      </Dialog>
      <ReasonDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={o ? `Reject ${o.poNo}?` : "Reject"}
        description="The requester is notified with your reason and can edit and resubmit."
        confirmLabel="Reject PO"
        destructive
        busy={busy === "reject"}
        suggestions={PO_REJECT_REASONS}
        onConfirm={async (reason) => {
          if (!o) return;
          const out = await run("reject", () => purchase.rejectOrder(o.id, reason), { success: "Rejected", description: o.poNo, tone: "amber" });
          setRejecting(false);
          if (out) onClose();
        }}
      />
    </>
  );
}

/* ---------- Bills ---------- */

function BillQueue({ bills }: { bills: ApprovalBill[] }) {
  const { session, can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const [holding, setHolding] = useState<ApprovalBill | null>(null);
  const holdReasons = session.settings.taxonomy?.holdReasons ?? [];

  if (!bills.length)
    return (
      <Card interactive={false}>
        <EmptyState icon="check" title="No bills waiting">
          Supplier bills entered without a matching approved PO show up here for sign-off.
        </EmptyState>
      </Card>
    );

  return (
    <div>
      {bills.map((b) => (
        <div key={b.id} className="ims-approval">
          <span className="ims-approval-ic" aria-hidden="true">
            ₹
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="ims-approval-title">
              {b.billNo} · {b.supplierName}
            </div>
            <div className="ims-approval-meta">
              {[
                `Bill date ${dateLabel(b.billDate)}`,
                b.dueDate ? `due ${dateLabel(b.dueDate)}${b.daysToDue != null && b.daysToDue < 0 ? ` (${-b.daysToDue}d overdue)` : ""}` : null,
                b.supplierBillNo ? `supplier ref ${b.supplierBillNo}` : null,
                b.poNo ? `PO ${b.poNo}` : "No PO",
                b.createdByName ? `entered by ${b.createdByName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="ims-approval-actions">
            <span className="ims-strong ims-num" style={{ alignSelf: "center", marginRight: 6 }}>
              {inrExact(b.grandTotal)}
            </span>
            {can("payables") ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("payables", `open:${b.id}`)}>
                View
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setHolding(b)}>
              Hold
            </Button>
            <Button size="sm" variant="success" icon="check" disabled={Boolean(busy)} onClick={() => run(`bill-${b.id}`, () => purchase.approveBill(b.id), { success: "Bill approved", description: `${b.billNo} · ready to pay` })}>
              Approve
            </Button>
          </div>
        </div>
      ))}
      <ReasonDialog
        open={Boolean(holding)}
        onClose={() => setHolding(null)}
        title={holding ? `Hold ${holding.billNo}?` : "Hold bill"}
        description="Held bills aren't scheduled for payment until released."
        confirmLabel="Put on hold"
        busy={Boolean(busy)}
        minLength={2}
        suggestions={holdReasons.length ? holdReasons : ["Goods not received", "Price mismatch with PO", "Quantity mismatch", "Awaiting credit note"]}
        onConfirm={async (reason) => {
          if (!holding) return;
          await run(`hold-${holding.id}`, () => purchase.holdBill(holding.id, reason), { success: "Bill on hold", description: holding.billNo, tone: "amber" });
          setHolding(null);
        }}
      />
    </div>
  );
}

/* ---------- Stock checks ---------- */

function CheckQueue({ checks }: { checks: ImsStockCheck[] }) {
  const { navigate } = useIms();
  const { run, busy } = useImsAction();
  const [returning, setReturning] = useState<ImsStockCheck | null>(null);

  if (!checks.length)
    return (
      <Card interactive={false}>
        <EmptyState icon="check" title="No stock checks waiting">
          Counts submitted by your team appear here; approving one adjusts stock to the physical count.
        </EmptyState>
      </Card>
    );

  return (
    <div>
      {checks.map((c) => (
        <div key={c.id} className="ims-approval">
          <span className="ims-approval-ic" aria-hidden="true">
            ✓
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="ims-approval-title">
              {c.checkNo} · {c.title}
            </div>
            <div className="ims-approval-meta">
              {[
                `${c.countedCount}/${c.itemCount} counted`,
                c.mismatchCount ? `${c.mismatchCount} mismatch${c.mismatchCount === 1 ? "" : "es"}` : "no mismatches",
                c.varianceQty ? `variance ${c.varianceQty > 0 ? "+" : ""}${qtyText(c.varianceQty)} units` : null,
                c.countedByName ? `counted by ${c.countedByName}` : null,
                c.updatedAt ? timeAgo(c.updatedAt) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="ims-approval-actions">
            {c.varianceValue ? (
              <span className="ims-num" style={{ alignSelf: "center", marginRight: 6, color: c.varianceValue < 0 ? "var(--bos-coral-600, #c2410c)" : undefined }}>
                {c.varianceValue > 0 ? "+" : ""}
                {inrExact(c.varianceValue)}
              </span>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => navigate("checks", `open:${c.id}`)}>
              View
            </Button>
            <Button size="sm" onClick={() => setReturning(c)}>
              Send back
            </Button>
            <Button size="sm" variant="success" icon="check" disabled={Boolean(busy)} onClick={() => run(`check-${c.id}`, () => ims.approveCheck(c.id), { success: "Stock check approved", description: `${c.checkNo} · stock adjusted` })}>
              Approve
            </Button>
          </div>
        </div>
      ))}
      <ReasonDialog
        open={Boolean(returning)}
        onClose={() => setReturning(null)}
        title={returning ? `Send ${returning.checkNo} back for recount?` : "Send back"}
        description="The counter is asked to recount; stock is not changed."
        label="Note"
        confirmLabel="Send back"
        busy={Boolean(busy)}
        minLength={0}
        suggestions={CHECK_REJECT_REASONS}
        onConfirm={async (note) => {
          if (!returning) return;
          await run(`return-${returning.id}`, () => ims.rejectCheck(returning.id, note || undefined), { success: "Sent back for recount", description: returning.checkNo, tone: "amber" });
          setReturning(null);
        }}
      />
    </div>
  );
}

/* ---------- History ---------- */

function History() {
  const { navigate } = useIms();
  const state = useImsData(async () => {
    const lists = await Promise.all(["approved", "rejected", "held", "returned"].map((q) => ims.events({ q, limit: 100 })));
    const byId = new Map<number, ImsEvent>();
    for (const l of lists) for (const e of l.events) if (DECISION_TYPES.has(e.type)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, []);

  const open = (e: ImsEvent) => {
    if (!e.entityId) return;
    if (e.entityType === "po") navigate("purchase", `open:${e.entityId}`);
    else if (e.entityType === "bill") navigate("payables", `open:${e.entityId}`);
    else if (e.entityType === "check") navigate("checks", `open:${e.entityId}`);
  };

  return (
    <Loaded state={state} rows={4}>
      {(events) =>
        events.length === 0 ? (
          <Card interactive={false}>
            <EmptyState icon="clock" title="No decisions yet">
              Approvals, rejections and holds are listed here once made.
            </EmptyState>
          </Card>
        ) : (
          <Card interactive={false}>
            <div className="ims-list">
              {events.map((e) => {
                const verb = e.type.split(".")[1] ?? "";
                const view = DECISION_VIEW[verb];
                return (
                  <button key={e.id} type="button" className="ims-list-row" onClick={() => open(e)} disabled={!e.entityId}>
                    <span className="ims-row" style={{ gap: 10, minWidth: 0, flexWrap: "nowrap" }}>
                      <PersonAvatar name={e.actorName} />
                      <span className="ims-cell-stack" style={{ minWidth: 0 }}>
                        <span>{e.summary}</span>
                        <small>
                          {e.actorName ?? "System"} · {e.createdAt ? stampLabel(e.createdAt) : ""}
                        </small>
                      </span>
                    </span>
                    {view ? (
                      <Badge tone={view.tone} auto>
                        {view.label}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>
        )
      }
    </Loaded>
  );
}

export default ApprovalsModule;
