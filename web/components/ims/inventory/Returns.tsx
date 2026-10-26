"use client";

import "./inventory-b.css";
import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterChip,
  FormGrid,
  Grid,
  IconButton,
  Input,
  KpiCard,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  cx,
  type BosColumn,
} from "@/components/bos";
import { ims, type ImsItem, type ImsMovement, type ImsReturn, type RefundStatus } from "@/lib/ims/api";
import { imsB, isRestore, type ReturnsOverview, type ReturnsSummary } from "@/lib/ims/inventory-b";
import { dateLabel, downloadCsv, downloadXlsx, inr, monthLabel, num, qtyText, round2, round3, stampLabel, todayLocal, type BadgeView, type ExportColumn } from "@/lib/ims/format";
import { Loaded, PageHeader, Stack, StatusBadge, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { ItemSearch, PartySelect, useItemCatalog } from "../shared/pickers";
import { isOther, MovementBadge, QtyStepper, ReasonChips, useInventoryMeta } from "./stock-shared";

type Tab = "customer" | "supplier" | "damaged" | "log";
type Kind = "customer" | "supplier";
type Disposition = "restock" | "damaged";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "customer", label: "Customer returns" },
  { value: "supplier", label: "Supplier returns" },
  { value: "damaged", label: "Damaged stock" },
  { value: "log", label: "Damage log" },
];

const REFUND_BADGE: Record<RefundStatus, BadgeView> = {
  none: { text: "NO REFUND", tone: "neutral" },
  pending: { text: "REFUND PENDING", tone: "amber" },
  refunded: { text: "REFUNDED", tone: "emerald" },
  credit_note: { text: "CREDIT NOTE", tone: "blue" },
};
const REFUND_LABEL: Record<Kind, Record<RefundStatus, string>> = {
  customer: { none: "No refund", pending: "Refund pending", refunded: "Refunded", credit_note: "Credit note issued" },
  supplier: { none: "No credit", pending: "Credit pending", refunded: "Refund received", credit_note: "Debit note raised" },
};
const REFUND_STATUSES: ReadonlyArray<RefundStatus> = ["none", "pending", "refunded", "credit_note"];

const units = (r: ImsReturn) => round3(r.lines.reduce((s, l) => s + l.qty, 0));

type Creating = { seq: number; kind: Kind; preset?: { item: ImsItem; disposition: Disposition } };
type QAction = { seq: number; action: "writeoff" | "restore"; item: ImsItem };

export function ReturnsModule() {
  const { takeIntent, can } = useIms();
  const [intent] = useState(() => takeIntent("returns"));
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.value === intent) ? (intent as Tab) : intent === "new:supplier" ? "supplier" : "customer"));
  const [openId, setOpenId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [creating, setCreating] = useState<Creating | null>(() =>
    can("damage") && (intent === "new:customer" || intent === "new:supplier" || intent === "new") ? { seq: 1, kind: intent === "new:supplier" ? "supplier" : "customer" } : null,
  );
  const [qAction, setQAction] = useState<QAction | null>(null);
  const [reportSeq, setReportSeq] = useState(0);
  const [reporting, setReporting] = useState(intent === "report" && can("damage"));
  const state = useImsData(() => imsB.returnsOverview(), []);
  const meta = useInventoryMeta();
  const canAct = can("damage");
  const canSeeCost = meta.data?.canSeeCost ?? false;

  const startReturn = (kind: Kind, preset?: Creating["preset"]) => setCreating((c) => ({ seq: (c?.seq ?? 0) + 1, kind, preset }));

  return (
    <Stack>
      <PageHeader
        title="Damage & Returns"
        sub="Customer and supplier returns, quarantined (damaged) stock, write-offs and restores."
        actions={
          canAct ? (
            <>
              <Button
                size="sm"
                icon="warning"
                onClick={() => {
                  setReportSeq((s) => s + 1);
                  setReporting(true);
                }}
              >
                Report damage
              </Button>
              <Button size="sm" onClick={() => startReturn("supplier")}>
                Return to supplier
              </Button>
              <Button size="sm" variant="primary" icon="plus" onClick={() => startReturn("customer")}>
                Customer return
              </Button>
            </>
          ) : null
        }
      />
      <Loaded state={state}>
        {(d) => {
          const open = openId ? d.returns.find((r) => r.id === openId) : null;
          return (
            <Stack>
              <ReturnKpis data={d} canSeeCost={canSeeCost} />
              <SubTabs label="Returns sections" value={tab} onChange={setTab} options={TABS} />
              {tab === "customer" || tab === "supplier" ? (
                <ReturnsTable key={tab} kind={tab} returns={d.returns.filter((r) => r.kind === tab)} onOpen={(r) => setOpenId(r.id)} onNew={canAct ? () => startReturn(tab) : undefined} />
              ) : tab === "damaged" ? (
                <QuarantineView data={d} canAct={canAct} canSeeCost={canSeeCost} onAction={(action, item) => setQAction((q) => ({ seq: (q?.seq ?? 0) + 1, action, item }))} onReturn={(item) => startReturn("supplier", { item, disposition: "damaged" })} />
              ) : (
                <DamageLog damage={d.damage} canSeeCost={canSeeCost} />
              )}
              {open ? <ReturnDetailDialog key={open.id} ret={open} onClose={() => setOpenId(null)} /> : null}
              {openId && !open && !state.loading ? (
                <Alert tone="amber" title="Return not found" actions={<Button size="sm" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                  It may have been removed or belongs to another business.
                </Alert>
              ) : null}
            </Stack>
          );
        }}
      </Loaded>
      {creating ? <NewReturnDialog key={creating.seq} kind={creating.kind} preset={creating.preset} onClose={() => setCreating(null)} /> : null}
      {qAction ? <QuarantineDialog key={qAction.seq} action={qAction.action} item={qAction.item} onClose={() => setQAction(null)} /> : null}
      {reporting ? <ReportDamageDialog key={reportSeq} onClose={() => setReporting(false)} /> : null}
    </Stack>
  );
}

/* ---------- KPIs ---------- */

function ReturnKpis({ data, canSeeCost }: { data: ReturnsOverview; canSeeCost: boolean }) {
  const s: ReturnsSummary = data.summary ?? fallbackSummary(data);
  return (
    <Grid cols={4} min={150}>
      <KpiCard
        label={`Returns · ${monthLabel(s.monthStart.slice(0, 7))}`}
        value={s.customerReturns + s.supplierReturns}
        chip={{ color: "blue", glyph: "↺" }}
        delta={`${s.customerReturns} from customers (${inr(s.customerValue)}) · ${s.supplierReturns} to suppliers`}
        deltaTone="info"
        interactive={false}
      />
      <KpiCard
        label="Refunds pending"
        value={inr(s.refundPending)}
        valueTone={s.refundPending ? "amber" : undefined}
        chip={{ color: "amber", glyph: "₹" }}
        delta={s.refundPendingCount ? `${s.refundPendingCount} return${s.refundPendingCount === 1 ? "" : "s"} awaiting settlement` : "All settled"}
        deltaTone={s.refundPendingCount ? "warn" : "up"}
        interactive={false}
      />
      <KpiCard
        label="Damaged units (quarantine)"
        value={qtyText(s.damagedUnits)}
        valueTone={s.damagedUnits ? "coral" : undefined}
        chip={{ color: "rose", glyph: "⚠" }}
        delta={canSeeCost ? `${inr(s.damagedValue)} at cost · ${data.quarantine.length} items` : `${data.quarantine.length} items`}
        deltaTone={s.damagedUnits ? "down" : "muted"}
        interactive={false}
      />
      <KpiCard
        label="Written off this month"
        value={canSeeCost ? inr(s.writeOffMtdValue) : qtyText(s.writeOffMtdUnits)}
        chip={{ color: "lavender", glyph: "✕" }}
        delta={canSeeCost ? `${qtyText(s.writeOffMtdUnits)} units · ${inr(s.damageMtdValue)} newly damaged` : `${qtyText(s.damageMtdUnits)} units newly damaged`}
        deltaTone="muted"
        interactive={false}
      />
    </Grid>
  );
}

function fallbackSummary(d: ReturnsOverview): ReturnsSummary {
  const monthStart = `${todayLocal().slice(0, 7)}-01`;
  const live = d.returns.filter((r) => r.status !== "cancelled");
  const mtd = live.filter((r) => r.date >= monthStart);
  const dmg = d.damage.filter((m) => m.date >= monthStart);
  return {
    monthStart,
    customerReturns: mtd.filter((r) => r.kind === "customer").length,
    customerValue: round2(mtd.filter((r) => r.kind === "customer").reduce((s, r) => s + r.total, 0)),
    supplierReturns: mtd.filter((r) => r.kind === "supplier").length,
    supplierValue: round2(mtd.filter((r) => r.kind === "supplier").reduce((s, r) => s + r.total, 0)),
    refundPending: round2(live.filter((r) => r.refundStatus === "pending").reduce((s, r) => s + r.refundAmount, 0)),
    refundPendingCount: live.filter((r) => r.refundStatus === "pending").length,
    damagedUnits: round3(d.quarantine.reduce((s, i) => s + i.damagedStock, 0)),
    damagedValue: round2(d.quarantine.reduce((s, i) => s + i.damagedStock * i.purchasePrice, 0)),
    damageMtdValue: round2(dmg.filter((m) => m.type === "DAMAGE").reduce((s, m) => s + m.value, 0)),
    damageMtdUnits: round3(dmg.filter((m) => m.type === "DAMAGE").reduce((s, m) => s + m.qty, 0)),
    writeOffMtdValue: round2(dmg.filter((m) => m.type === "WRITE_OFF").reduce((s, m) => s + m.value, 0)),
    writeOffMtdUnits: round3(dmg.filter((m) => m.type === "WRITE_OFF").reduce((s, m) => s + m.qty, 0)),
  };
}

/* ---------- Return lists ---------- */

const RETURN_EXPORT: ReadonlyArray<ExportColumn<ImsReturn>> = [
  { header: "Return no", value: (r) => r.returnNo },
  { header: "Date", value: (r) => r.date },
  { header: "Type", value: (r) => (r.kind === "customer" ? "Customer return" : "Supplier return") },
  { header: "Party", value: (r) => r.partyName },
  { header: "Reference", value: (r) => r.refDocNo },
  { header: "Items", value: (r) => r.lines.map((l) => `${l.name} × ${l.qty}`).join("; ") },
  { header: "Units", value: (r) => units(r) },
  { header: "Total", value: (r) => r.total },
  { header: "Reason", value: (r) => r.reason },
  { header: "Disposition", value: (r) => (r.disposition === "damaged" ? "Damaged" : "Restocked") },
  { header: "Refund status", value: (r) => REFUND_LABEL[r.kind][r.refundStatus] ?? r.refundStatus },
  { header: "Refund amount", value: (r) => r.refundAmount },
  { header: "Status", value: (r) => r.status },
  { header: "Created by", value: (r) => r.createdByName },
  { header: "Notes", value: (r) => r.notes },
];

function ReturnsTable({ kind, returns, onOpen, onNew }: { kind: Kind; returns: ImsReturn[]; onOpen: (r: ImsReturn) => void; onNew?: () => void }) {
  const [q, setQ] = useState("");
  const [refund, setRefund] = useState<RefundStatus | "all">("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const term = q.trim().toLowerCase();
  const rows = returns.filter(
    (r) =>
      (showCancelled || r.status !== "cancelled") &&
      (refund === "all" || r.refundStatus === refund) &&
      (!term || [r.returnNo, r.partyName, r.refDocNo, r.reason, ...r.lines.map((l) => l.name)].some((v) => v && v.toLowerCase().includes(term))),
  );
  const columns: BosColumn<ImsReturn>[] = [
    {
      key: "no",
      header: "Return",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{r.returnNo}</span>
          <small>{dateLabel(r.date)}</small>
        </span>
      ),
    },
    {
      key: "party",
      header: kind === "customer" ? "Customer" : "Supplier",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span>{r.partyName}</span>
          <small>{r.refDocNo ? `${kind === "customer" ? "Invoice" : "Bill"} ${r.refDocNo}` : "No reference"}</small>
        </span>
      ),
    },
    {
      key: "items",
      header: "Items",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span>{r.lines.length === 1 ? r.lines[0].name : `${r.lines.length} items`}</span>
          <small>
            {qtyText(units(r))} units{r.reason ? ` · ${r.reason}` : ""}
          </small>
        </span>
      ),
    },
    { key: "total", header: "Value", align: "right", cell: (r) => <span className="ims-num ims-strong">{inr(r.total)}</span> },
    { key: "disp", header: kind === "customer" ? "Goes to" : "Taken from", cell: (r) => <Badge tone={r.disposition === "damaged" ? "coral" : "emerald"}>{r.disposition === "damaged" ? "QUARANTINE" : "SALEABLE"}</Badge> },
    {
      key: "refund",
      header: kind === "customer" ? "Refund" : "Credit",
      cell: (r) =>
        r.status === "cancelled" ? (
          <Badge tone="neutral">CANCELLED</Badge>
        ) : (
          <span className="ims-cell-stack">
            <StatusBadge view={REFUND_BADGE[r.refundStatus] ?? REFUND_BADGE.none} />
            {r.refundStatus !== "none" ? <small>{inr(r.refundAmount)}</small> : null}
          </span>
        ),
    },
  ];
  const fileBase = `${kind}-returns-${todayLocal()}`;
  return (
    <Card interactive={false}>
      <div className="ims-toolbar">
        <SearchInput wrapperClassName="ims-grow" placeholder={`Search return no, ${kind}, item…`} aria-label="Search returns" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(fileBase, rows, RETURN_EXPORT)}>
          CSV
        </Button>
        <Button size="sm" icon="file" disabled={!rows.length} onClick={() => void downloadXlsx(fileBase, "Returns", rows, RETURN_EXPORT)}>
          Excel
        </Button>
      </div>
      <div className="ims-b-filters" style={{ marginBottom: 12 }}>
        <FilterChip active={refund === "all"} onClick={() => setRefund("all")}>
          All ({returns.filter((r) => showCancelled || r.status !== "cancelled").length})
        </FilterChip>
        {REFUND_STATUSES.map((s) => (
          <FilterChip key={s} active={refund === s} onClick={() => setRefund(s)}>
            {REFUND_LABEL[kind][s]} ({returns.filter((r) => r.refundStatus === s && (showCancelled || r.status !== "cancelled")).length})
          </FilterChip>
        ))}
        <FilterChip active={showCancelled} onClick={() => setShowCancelled((v) => !v)}>
          Show cancelled
        </FilterChip>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        chevron
        caption={kind === "customer" ? "Customer returns" : "Supplier returns"}
        empty={
          returns.length ? (
            "No returns match these filters."
          ) : (
            <EmptyState
              icon="refresh"
              title={kind === "customer" ? "No customer returns yet" : "No supplier returns yet"}
              actions={
                onNew ? (
                  <Button variant="primary" icon="plus" onClick={onNew}>
                    {kind === "customer" ? "Record a customer return" : "Return goods to a supplier"}
                  </Button>
                ) : undefined
              }
            >
              {kind === "customer" ? "Goods coming back go to saleable stock or straight to quarantine if damaged." : "Send faulty or excess goods back from saleable stock or quarantine."}
            </EmptyState>
          )
        }
      />
      {rows.length ? (
        <div className="ims-b-totals">
          <div className="ims-b-total">
            <span className="ims-muted">Returns</span>
            <b>{rows.length}</b>
          </div>
          <div className="ims-b-total">
            <span className="ims-muted">Units</span>
            <b>{qtyText(round3(rows.reduce((s, r) => s + units(r), 0)))}</b>
          </div>
          <div className="ims-b-total">
            <span className="ims-muted">Value</span>
            <b>{inr(round2(rows.reduce((s, r) => s + r.total, 0)))}</b>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------- Return detail ---------- */

function ReturnDetailDialog({ ret, onClose }: { ret: ImsReturn; onClose: () => void }) {
  const { can, navigate } = useIms();
  const { run, isBusy } = useImsAction();
  const [status, setStatus] = useState<RefundStatus>(ret.refundStatus);
  const [amount, setAmount] = useState(String(ret.refundAmount || (ret.refundStatus === "none" ? "" : ret.total)));
  const [notes, setNotes] = useState(ret.notes ?? "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const canEdit = ret.status !== "cancelled" && (can("damage") || can("receivables") || can("payables"));
  const canCancel = ret.status !== "cancelled" && can("damage");
  const amountNum = amount.trim() === "" ? 0 : num(amount, Number.NaN);
  const amountError = !Number.isFinite(amountNum) || amountNum < 0 ? "Enter a valid amount" : null;
  const changed = status !== ret.refundStatus || amountNum !== ret.refundAmount || (notes.trim() || null) !== (ret.notes ?? null);

  const save = async () => {
    if (amountError) return;
    const res = await run("save", () => ims.updateReturn(ret.id, { refundStatus: status, refundAmount: status === "none" ? 0 : amountNum, notes: notes.trim() || null }), { success: "Return updated" });
    if (res) onClose();
  };
  const cancel = async () => {
    const res = await run("cancel", () => ims.cancelReturn(ret.id), { success: `Return ${ret.returnNo} cancelled`, description: "Stock movements were reversed", tone: "amber" });
    if (res) onClose();
  };

  const lineCols: BosColumn<ImsReturn["lines"][number]>[] = [
    { key: "name", header: "Item", cell: (l) => <span className="ims-strong">{l.name}</span> },
    { key: "qty", header: "Qty", align: "right", cell: (l) => <span className="ims-num">{qtyText(l.qty, l.unit)}</span> },
    { key: "rate", header: "Rate", align: "right", cell: (l) => <span className="ims-num">{inr(l.rate)}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (l) => <span className="ims-num ims-strong">{inr(l.amount)}</span> },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={
        <span className="ims-row" style={{ gap: 8 }}>
          {ret.returnNo}
          {ret.status === "cancelled" ? <Badge tone="neutral">CANCELLED</Badge> : <StatusBadge view={REFUND_BADGE[ret.refundStatus] ?? REFUND_BADGE.none} />}
        </span>
      }
      description={`${ret.kind === "customer" ? "Customer return from" : "Returned to supplier"} ${ret.partyName} · ${dateLabel(ret.date)}`}
      actionsNote={ret.createdByName ? `Recorded by ${ret.createdByName} · ${stampLabel(ret.createdAt)}` : undefined}
      actions={
        <>
          {canCancel && !confirmCancel ? (
            <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
              Cancel return
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {canEdit ? (
            <Button variant="primary" disabled={!changed || Boolean(amountError) || isBusy("save")} onClick={() => void save()}>
              {isBusy("save") ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={14}>
        <div className="ims-paper-meta" style={{ margin: 0 }}>
          <div>
            <b>{ret.kind === "customer" ? "Original invoice" : "Supplier bill / GRN"}</b>
            {ret.refDocNo ?? "—"}
          </div>
          <div>
            <b>Reason</b>
            {ret.reason ?? "—"}
          </div>
          <div>
            <b>{ret.kind === "customer" ? "Goods went to" : "Taken from"}</b>
            {ret.disposition === "damaged" ? "Quarantine (damaged)" : "Saleable stock"}
          </div>
        </div>
        <DataTable compact columns={lineCols} rows={ret.lines} rowKey={(l) => l.itemId} onRowClick={(l) => navigate("items", `open:${l.itemId}`)} caption="Returned items" />
        <dl className="ims-totals">
          <dt>Units</dt>
          <dd>{qtyText(units(ret))}</dd>
          <dt className="is-grand">Total</dt>
          <dd className="is-grand">{inr(ret.total)}</dd>
        </dl>
        {canEdit ? (
          <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
            <Field label={ret.kind === "customer" ? "Refund status" : "Supplier credit"}>
              {({ id }) => (
                <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as RefundStatus)}>
                  {REFUND_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {REFUND_LABEL[ret.kind][s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {status !== "none" ? (
              <Field label="Amount (₹)" error={amountError}>
                {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" value={amount} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(ret.total)} />}
              </Field>
            ) : null}
            <Field label="Notes" full>
              {({ id }) => <Textarea id={id} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </FormGrid>
        ) : ret.notes ? (
          <p className="ims-muted" style={{ whiteSpace: "pre-line", margin: 0 }}>
            {ret.notes}
          </p>
        ) : null}
        {confirmCancel ? (
          <Alert
            tone="coral"
            title="Cancel this return?"
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                  Keep
                </Button>
                <Button size="sm" variant="destructive" disabled={isBusy("cancel")} onClick={() => void cancel()}>
                  {isBusy("cancel") ? "Reversing…" : "Cancel & reverse stock"}
                </Button>
              </>
            }
          >
            {ret.kind === "customer"
              ? `${qtyText(units(ret))} units will be taken back out of ${ret.disposition === "damaged" ? "quarantine" : "saleable stock"}.`
              : `${qtyText(units(ret))} units will be put back into ${ret.disposition === "damaged" ? "quarantine" : "saleable stock"}.`}
          </Alert>
        ) : null}
      </Stack>
    </Dialog>
  );
}

/* ---------- New return ---------- */

type RLine = { key: string; item: ImsItem; qty: string; rate: string };
let rlineSeq = 0;

function NewReturnDialog({ kind, preset, onClose }: { kind: Kind; preset?: Creating["preset"]; onClose: () => void }) {
  const { session } = useIms();
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const catalog = useItemCatalog();
  const [today] = useState(() => todayLocal());
  const [party, setParty] = useState<{ id: string | null; name: string }>(() =>
    preset && kind === "supplier" && preset.item.supplierName ? { id: preset.item.supplierId, name: preset.item.supplierName } : { id: null, name: "" },
  );
  const [refDocNo, setRefDocNo] = useState("");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<Disposition>(preset?.disposition ?? "restock");
  const [lines, setLines] = useState<RLine[]>(() =>
    preset ? [{ key: `r${++rlineSeq}`, item: preset.item, qty: String(preset.disposition === "damaged" ? preset.item.damagedStock : 1), rate: String(kind === "customer" ? preset.item.sellingPrice : preset.item.purchasePrice) }] : [],
  );
  const [refund, setRefund] = useState<RefundStatus>(kind === "customer" ? "pending" : "none");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const reasons = meta.data?.taxonomy.returnReasons ?? [];
  const reasonValue = reason || reasons[0] || "";
  const allowNegative = meta.data?.allowNegativeStock ?? session.settings.allowNegativeStock;
  const live = useMemo(() => new Map((catalog.data ?? []).map((i) => [i.id, i])), [catalog.data]);
  const fromQuarantine = kind === "supplier" && disposition === "damaged";
  const exclude = useMemo(() => new Set((catalog.data ?? []).filter((i) => fromQuarantine && i.damagedStock <= 0).map((i) => i.id)), [catalog.data, fromQuarantine]);

  const rows = lines.map((l) => {
    const item = live.get(l.item.id) ?? l.item;
    const qty = num(l.qty, Number.NaN);
    const rate = l.rate.trim() === "" ? 0 : num(l.rate, Number.NaN);
    const available = fromQuarantine ? item.damagedStock : item.currentStock;
    let error: string | null = null;
    if (!Number.isFinite(qty) || qty <= 0) error = "Enter a quantity";
    else if (!Number.isFinite(rate) || rate < 0) error = "Enter a valid rate";
    else if (kind === "supplier" && qty > available && (fromQuarantine || !allowNegative)) error = `Only ${qtyText(available, item.unit)} ${fromQuarantine ? "damaged" : "in stock"}`;
    return { l, item, qty, rate, amount: Number.isFinite(qty) && Number.isFinite(rate) ? round2(qty * rate) : 0, available, error };
  });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const amountNum = amount.trim() === "" ? null : num(amount, Number.NaN);
  const errors = [
    !party.name.trim() ? (kind === "customer" ? "Who is returning the goods?" : "Pick the supplier") : null,
    !rows.length ? "Add at least one item" : null,
    rows.some((r) => r.error) ? "Fix the highlighted lines" : null,
    date > today ? "The date can't be in the future" : null,
    amountNum !== null && (!Number.isFinite(amountNum) || amountNum < 0) ? "Enter a valid refund amount" : null,
    isOther(reasonValue) && !notes.trim() ? "Add a note when the reason is “Other”" : null,
  ].filter((e): e is string => Boolean(e));

  const add = (item: ImsItem) =>
    setLines((ls) =>
      ls.some((l) => l.item.id === item.id)
        ? ls.map((l) => (l.item.id === item.id ? { ...l, qty: String(round3(num(l.qty, 0) + 1)) } : l))
        : [...ls, { key: `r${++rlineSeq}`, item, qty: "1", rate: String(kind === "customer" ? item.sellingPrice : item.purchasePrice) }],
    );
  const patch = (key: string, p: Partial<RLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const submit = async () => {
    setTouched(true);
    if (errors.length) return;
    const res = await run(
      "create",
      () =>
        ims.createReturn({
          kind,
          partyId: party.id,
          partyName: party.name.trim(),
          refDocNo: refDocNo.trim() || null,
          date,
          lines: rows.map((r) => ({ itemId: r.item.id, qty: round3(r.qty), rate: round2(r.rate) })),
          reason: reasonValue || null,
          disposition,
          refundStatus: refund,
          refundAmount: refund === "none" ? 0 : (amountNum ?? undefined),
          notes: notes.trim() || null,
        }),
      { success: kind === "customer" ? "Customer return recorded" : "Supplier return recorded", description: `${rows.length} item${rows.length === 1 ? "" : "s"} · ${inr(total)}` },
    );
    if (res) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      dismissible={false}
      title={kind === "customer" ? "Customer return" : "Return to supplier"}
      description={kind === "customer" ? "Goods coming back from a customer. Restock them or send damaged units to quarantine." : "Goods going back to a supplier, from saleable stock or from quarantine."}
      actionsNote={rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"} · ${inr(total)}` : undefined}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" disabled={isBusy("create")} onClick={() => void submit()}>
            {isBusy("create") ? "Saving…" : "Record return"}
          </Button>
        </>
      }
    >
      <Stack gap={16}>
        <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
          <Field label={kind === "customer" ? "Customer" : "Supplier"} error={touched && !party.name.trim() ? "Required" : null}>
            {({ id }) => <PartySelect id={id} kind={kind} value={party} onChange={(v) => setParty({ id: v.id, name: v.name })} />}
          </Field>
          <Field label={kind === "customer" ? "Original invoice no." : "Supplier bill / GRN no."} hint="Optional">
            {({ id }) => <Input id={id} maxLength={64} value={refDocNo} onChange={(e) => setRefDocNo(e.target.value)} />}
          </Field>
          <Field label="Date" error={touched && date > today ? "Can't be in the future" : null}>
            {({ id }) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </FormGrid>

        <div className="ims-between">
          <span className="bos-field-label">{kind === "customer" ? "Returned goods go to" : "Take goods from"}</span>
          <Segmented
            size="sm"
            role="radio"
            aria-label="Disposition"
            value={disposition}
            onChange={(v) => {
              setDisposition(v);
              if (kind === "supplier") setLines([]);
            }}
            options={
              kind === "customer"
                ? [
                    { value: "restock", label: "Saleable stock" },
                    { value: "damaged", label: "Quarantine (damaged)" },
                  ]
                : [
                    { value: "restock", label: "Saleable stock" },
                    { value: "damaged", label: "Damaged stock" },
                  ]
            }
          />
        </div>

        <div>
          <div className="bos-field-label" style={{ marginBottom: 8 }}>
            Items
          </div>
          <ItemSearch onPick={add} price={kind === "customer" ? "selling" : "purchase"} exclude={exclude} placeholder={fromQuarantine ? "Search items with damaged stock…" : "Search or scan items…"} />
        </div>

        {rows.length ? (
          <div>
            {rows.map((r) => (
              <div key={r.l.key} className="ims-b-rline" style={touched && r.error ? { boxShadow: "inset 3px 0 0 var(--bos-coral)" } : undefined}>
                <span className="ims-cell-stack" style={{ paddingLeft: 6 }}>
                  <span className="ims-strong">{r.item.name}</span>
                  <small className={touched && r.error ? "ims-b-err" : undefined}>
                    {touched && r.error ? r.error : kind === "supplier" ? `${qtyText(r.available, r.item.unit)} ${fromQuarantine ? "damaged" : "in stock"}` : `${qtyText(r.item.currentStock, r.item.unit)} in stock`}
                  </small>
                </span>
                <QtyStepper value={r.l.qty} onChange={(qty) => patch(r.l.key, { qty })} label={`Quantity of ${r.item.name}`} min={0} invalid={touched && Boolean(r.error)} />
                <Input size="sm" inputMode="decimal" aria-label={`Rate for ${r.item.name}`} value={r.l.rate} onChange={(e) => patch(r.l.key, { rate: e.target.value.replace(/[^\d.]/g, "") })} />
                <span className="ims-num ims-strong">{inr(r.amount)}</span>
                <IconButton icon="x" aria-label={`Remove ${r.item.name}`} onClick={() => setLines((ls) => ls.filter((l) => l.key !== r.l.key))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="ims-faint">{fromQuarantine ? "Only items with damaged stock are listed." : "Search above or scan barcodes to add items."}</p>
        )}

        <div>
          <div className="bos-field-label" style={{ marginBottom: 8 }}>
            Reason
          </div>
          {reasons.length ? <ReasonChips label="Return reason" options={reasons} value={reasonValue} onChange={setReason} /> : <p className="ims-faint">Loading reasons…</p>}
        </div>

        <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
          <Field label={kind === "customer" ? "Refund" : "Supplier credit"}>
            {({ id }) => (
              <Select id={id} value={refund} onChange={(e) => setRefund(e.target.value as RefundStatus)}>
                {REFUND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REFUND_LABEL[kind][s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {refund !== "none" ? (
            <Field label="Amount (₹)" hint={`Leave blank for the full ${inr(total)}`}>
              {({ id }) => <Input id={id} inputMode="decimal" value={amount} placeholder={String(total)} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />}
            </Field>
          ) : null}
          <Field label="Notes" full hint={isOther(reasonValue) ? "Required for “Other”" : "Optional"}>
            {({ id }) => <Textarea id={id} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </FormGrid>

        {touched && errors.length ? (
          <Alert tone="coral" title="Can't record this return yet">
            {errors.join(" · ")}
          </Alert>
        ) : null}
      </Stack>
    </Dialog>
  );
}

/* ---------- Quarantine ---------- */

function QuarantineView({
  data,
  canAct,
  canSeeCost,
  onAction,
  onReturn,
}: {
  data: ReturnsOverview;
  canAct: boolean;
  canSeeCost: boolean;
  onAction: (action: "writeoff" | "restore", item: ImsItem) => void;
  onReturn: (item: ImsItem) => void;
}) {
  const { navigate } = useIms();
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const rows = data.quarantine.filter((i) => !term || [i.name, i.sku, i.category, i.supplierName].some((v) => v && v.toLowerCase().includes(term)));
  const monthStart = data.summary?.monthStart ?? `${todayLocal().slice(0, 7)}-01`;
  const damages = data.damage.filter((m) => m.type === "DAMAGE");
  const recent = damages.filter((m) => m.date >= monthStart);
  const basis = recent.length ? recent : damages;
  const byReason = [...basis.reduce((map, m) => map.set(m.reason || "Unspecified", { qty: (map.get(m.reason || "Unspecified")?.qty ?? 0) + m.qty, value: (map.get(m.reason || "Unspecified")?.value ?? 0) + m.value }), new Map<string, { qty: number; value: number }>())].sort(
    (a, b) => b[1].value - a[1].value || b[1].qty - a[1].qty,
  );
  const max = Math.max(1, ...byReason.map(([, v]) => (canSeeCost ? v.value : v.qty)));

  const columns: BosColumn<ImsItem>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{i.name}</span>
          <small>{[i.sku, i.category].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    { key: "damaged", header: "Damaged", align: "right", cell: (i) => <span className="ims-num ims-strong ims-neg">{qtyText(i.damagedStock, i.unit)}</span> },
    ...(canSeeCost ? [{ key: "value", header: "Value at cost", align: "right" as const, cell: (i: ImsItem) => <span className="ims-num">{inr(i.damagedStock * i.purchasePrice)}</span> }] : []),
    { key: "saleable", header: "Saleable", align: "right", cell: (i) => <span className="ims-num ims-muted">{qtyText(i.currentStock)}</span> },
    { key: "supplier", header: "Supplier", cell: (i) => <span className="ims-muted">{i.supplierName ?? "—"}</span> },
    ...(canAct
      ? [
          {
            key: "act",
            header: "",
            cell: (i: ImsItem) => (
              <span className="ims-row" style={{ gap: 4, justifyContent: "flex-end", flexWrap: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => onAction("restore", i)}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onReturn(i)}>
                  Return
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onAction("writeoff", i)}>
                  Write off
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="ims-split">
      <Card interactive={false}>
        <div className="ims-toolbar">
          <SearchInput wrapperClassName="ims-grow" placeholder="Search damaged items…" aria-label="Search damaged items" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate("items", `open:${i.id}`)}
          caption="Damaged stock in quarantine"
          empty={
            data.quarantine.length ? (
              "No damaged items match."
            ) : (
              <EmptyState icon="check" title="Quarantine is empty">
                Damaged units reported from stock entry or customer returns appear here until they&apos;re written off, restored or returned.
              </EmptyState>
            )
          }
        />
      </Card>
      <Stack gap={16}>
        <WidgetCard title={recent.length ? "Damage by reason · this month" : "Damage by reason"} dot="rose">
          {byReason.length ? (
            <div className="ims-bars">
              {byReason.slice(0, 8).map(([reason, v]) => (
                <div key={reason} className="ims-b-reason">
                  <span className="ims-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {reason}
                  </span>
                  <span className="ims-bar-track">
                    <span className="ims-bar-fill" style={{ display: "block", width: `${((canSeeCost ? v.value : v.qty) / max) * 100}%` }} />
                  </span>
                  <span className="ims-num ims-strong">{canSeeCost ? inr(v.value) : qtyText(v.qty)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ims-faint">No damage reported yet.</p>
          )}
        </WidgetCard>
        <WidgetCard title="How quarantine works" dot="lavender">
          <div className="ims-b-list" style={{ fontSize: 12.5 }}>
            <span className="ims-muted">
              <b>Restore</b> moves units judged saleable back into stock.
            </span>
            <span className="ims-muted">
              <b>Return</b> sends them back to the supplier as a supplier return.
            </span>
            <span className="ims-muted">
              <b>Write off</b> removes them permanently as a loss.
            </span>
          </div>
        </WidgetCard>
      </Stack>
    </div>
  );
}

function QuarantineDialog({ action, item, onClose }: { action: "writeoff" | "restore"; item: ImsItem; onClose: () => void }) {
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const [today] = useState(() => todayLocal());
  const [qty, setQty] = useState(String(item.damagedStock));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  const [touched, setTouched] = useState(false);
  const reasons = meta.data?.taxonomy.damageReasons ?? [];
  const reasonValue = reason || reasons[0] || "";
  const n = num(qty, Number.NaN);
  const error = !Number.isFinite(n) || n <= 0 ? "Enter a quantity" : n > item.damagedStock ? `Only ${qtyText(item.damagedStock, item.unit)} damaged` : date > today ? "The date can't be in the future" : null;
  const writeOff = action === "writeoff";

  const submit = async () => {
    setTouched(true);
    if (error) return;
    const q = round3(n);
    const res = await run(
      writeOff ? "writeoff" : "restore",
      () =>
        writeOff
          ? ims.postMovements({ type: "WRITE_OFF", lines: [{ itemId: item.id, qty: q }], reason: reasonValue || null, notes: notes.trim() || null, date })
          : imsB.restoreDamaged({ itemId: item.id, qty: q, notes: notes.trim() || null, date }),
      { success: writeOff ? "Written off" : "Restored to saleable stock", description: `${qtyText(q, item.unit)} × ${item.name}` },
    );
    if (res) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      icon={{ tone: writeOff ? "coral" : "emerald", name: writeOff ? "x" : "refresh" }}
      title={writeOff ? `Write off ${item.name}` : `Restore ${item.name}`}
      description={writeOff ? "Removes damaged units permanently and records the loss at cost." : "Moves units from quarantine back into saleable stock."}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={writeOff ? "destructive" : "success"} disabled={isBusy("writeoff") || isBusy("restore")} onClick={() => void submit()}>
            {writeOff ? "Write off" : "Restore"}
          </Button>
        </>
      }
    >
      <Stack gap={14}>
        <div className="ims-between">
          <span className="ims-muted">
            {qtyText(item.damagedStock, item.unit)} damaged · {qtyText(item.currentStock, item.unit)} saleable
          </span>
          <QtyStepper value={qty} onChange={setQty} label="Quantity" min={0} invalid={touched && Boolean(error)} />
        </div>
        {writeOff ? (
          <div>
            <div className="bos-field-label" style={{ marginBottom: 8 }}>
              Reason
            </div>
            <ReasonChips label="Write-off reason" options={reasons} value={reasonValue} onChange={setReason} />
          </div>
        ) : null}
        <FormGrid>
          <Field label="Date">{({ id }) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Notes" hint="Optional">
            {({ id }) => <Input id={id} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={writeOff ? "e.g. Disposed via scrap dealer" : "e.g. Repaired and tested"} />}
          </Field>
        </FormGrid>
        {touched && error ? (
          <Alert tone="coral" title="Check the quantity">
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Dialog>
  );
}

function ReportDamageDialog({ onClose }: { onClose: () => void }) {
  const { session } = useIms();
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const catalog = useItemCatalog();
  const [today] = useState(() => todayLocal());
  const [lines, setLines] = useState<RLine[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  const [touched, setTouched] = useState(false);
  const reasons = meta.data?.taxonomy.damageReasons ?? [];
  const reasonValue = reason || reasons[0] || "";
  const allowNegative = meta.data?.allowNegativeStock ?? session.settings.allowNegativeStock;
  const live = useMemo(() => new Map((catalog.data ?? []).map((i) => [i.id, i])), [catalog.data]);
  const rows = lines.map((l) => {
    const item = live.get(l.item.id) ?? l.item;
    const n = num(l.qty, Number.NaN);
    const error = !Number.isFinite(n) || n <= 0 ? "Enter a quantity" : n > item.currentStock && !allowNegative ? `Only ${qtyText(item.currentStock, item.unit)} in stock` : null;
    return { l, item, n, error };
  });
  const errors = [
    !rows.length ? "Add at least one item" : null,
    rows.some((r) => r.error) ? "Fix the highlighted lines" : null,
    isOther(reasonValue) && !notes.trim() ? "Add a note when the reason is “Other”" : null,
    date > today ? "The date can't be in the future" : null,
  ].filter((e): e is string => Boolean(e));

  const submit = async () => {
    setTouched(true);
    if (errors.length) return;
    const res = await run("damage", () => ims.postMovements({ type: "DAMAGE", lines: rows.map((r) => ({ itemId: r.item.id, qty: round3(r.n) })), reason: reasonValue || null, notes: notes.trim() || null, date }), {
      success: "Damage recorded",
      description: `${rows.length} item${rows.length === 1 ? "" : "s"} moved to quarantine`,
    });
    if (res) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      dismissible={false}
      icon={{ tone: "coral", name: "warning" }}
      title="Report damage"
      description="Moves units out of saleable stock into quarantine."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isBusy("damage")} onClick={() => void submit()}>
            {isBusy("damage") ? "Saving…" : "Report damage"}
          </Button>
        </>
      }
    >
      <Stack gap={14}>
        <ItemSearch
          onPick={(item) =>
            setLines((ls) => (ls.some((l) => l.item.id === item.id) ? ls.map((l) => (l.item.id === item.id ? { ...l, qty: String(round3(num(l.qty, 0) + 1)) } : l)) : [...ls, { key: `r${++rlineSeq}`, item, qty: "1", rate: "" }]))
          }
          price="purchase"
        />
        {rows.map((r) => (
          <div key={r.l.key} className="ims-between" style={{ padding: "6px 0", borderBottom: "1px solid var(--bos-border-soft)" }}>
            <span className="ims-cell-stack">
              <span className="ims-strong">{r.item.name}</span>
              <small className={cx(touched && r.error && "ims-b-err")}>{touched && r.error ? r.error : `${qtyText(r.item.currentStock, r.item.unit)} in stock · ${qtyText(r.item.damagedStock)} damaged`}</small>
            </span>
            <span className="ims-row" style={{ flexWrap: "nowrap" }}>
              <QtyStepper value={r.l.qty} onChange={(qty) => setLines((ls) => ls.map((l) => (l.key === r.l.key ? { ...l, qty } : l)))} label={`Damaged quantity of ${r.item.name}`} invalid={touched && Boolean(r.error)} />
              <IconButton icon="x" aria-label={`Remove ${r.item.name}`} onClick={() => setLines((ls) => ls.filter((l) => l.key !== r.l.key))} />
            </span>
          </div>
        ))}
        <div>
          <div className="bos-field-label" style={{ marginBottom: 8 }}>
            Reason
          </div>
          <ReasonChips label="Damage reason" options={reasons} value={reasonValue} onChange={setReason} />
        </div>
        <FormGrid>
          <Field label="Date">{({ id }) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Notes" hint={isOther(reasonValue) ? "Required for “Other”" : "Optional"}>
            {({ id }) => <Input id={id} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </FormGrid>
        {touched && errors.length ? (
          <Alert tone="coral" title="Can't save yet">
            {errors.join(" · ")}
          </Alert>
        ) : null}
      </Stack>
    </Dialog>
  );
}

/* ---------- Damage log ---------- */

function DamageLog({ damage, canSeeCost }: { damage: ImsMovement[]; canSeeCost: boolean }) {
  const { navigate } = useIms();
  const [kind, setKind] = useState<"all" | "DAMAGE" | "WRITE_OFF" | "RESTORE">("all");
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const rows = damage.filter(
    (m) =>
      (kind === "all" || (kind === "RESTORE" ? isRestore(m) : m.type === kind)) && (!term || [m.itemName, m.reason, m.notes, m.actorName].some((v) => v && v.toLowerCase().includes(term))),
  );
  const columns: BosColumn<ImsMovement>[] = [
    {
      key: "date",
      header: "Date",
      cell: (m) => (
        <span className="ims-cell-stack">
          <span>{dateLabel(m.date)}</span>
          <small>{stampLabel(m.createdAt)}</small>
        </span>
      ),
    },
    {
      key: "item",
      header: "Item",
      cell: (m) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{m.itemName}</span>
          <small>{m.sku ?? ""}</small>
        </span>
      ),
    },
    { key: "type", header: "Action", cell: (m) => <MovementBadge m={m} /> },
    { key: "qty", header: "Qty", align: "right", cell: (m) => <span className="ims-num ims-strong">{qtyText(m.qty, m.unit)}</span> },
    ...(canSeeCost ? [{ key: "value", header: "Value", align: "right" as const, cell: (m: ImsMovement) => <span className="ims-num">{inr(m.value)}</span> }] : []),
    {
      key: "reason",
      header: "Reason",
      cell: (m) => (
        <span className="ims-cell-stack">
          <span>{m.reason ?? "—"}</span>
          {m.notes ? <small>{m.notes}</small> : null}
        </span>
      ),
    },
    { key: "by", header: "By", cell: (m) => <span className="ims-muted">{m.actorName ?? "—"}</span> },
  ];
  const exportCols: ReadonlyArray<ExportColumn<ImsMovement>> = [
    { header: "Date", value: (m) => m.date },
    { header: "Item", value: (m) => m.itemName },
    { header: "SKU", value: (m) => m.sku },
    { header: "Action", value: (m) => (isRestore(m) ? "Restored" : m.type === "WRITE_OFF" ? "Write-off" : "Damage") },
    { header: "Qty", value: (m) => m.qty },
    ...(canSeeCost ? [{ header: "Value", value: (m: ImsMovement) => m.value }] : []),
    { header: "Reason", value: (m) => m.reason },
    { header: "Notes", value: (m) => m.notes },
    { header: "By", value: (m) => m.actorName },
  ];
  const file = `damage-log-${todayLocal()}`;
  return (
    <Card interactive={false}>
      <div className="ims-toolbar">
        <SearchInput wrapperClassName="ims-grow" placeholder="Search item, reason, person…" aria-label="Search damage log" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented
          size="sm"
          role="radio"
          aria-label="Action"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "DAMAGE", label: "Damaged" },
            { value: "WRITE_OFF", label: "Written off" },
            { value: "RESTORE", label: "Restored" },
          ]}
        />
        <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(file, rows, exportCols)}>
          CSV
        </Button>
        <Button size="sm" icon="file" disabled={!rows.length} onClick={() => void downloadXlsx(file, "Damage log", rows, exportCols)}>
          Excel
        </Button>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} onRowClick={(m) => navigate("items", `open:${m.itemId}`)} caption="Damage log" empty={damage.length ? "Nothing matches these filters." : "No damage, write-offs or restores recorded yet."} />
      {damage.length >= 300 ? (
        <p className="ims-faint" style={{ marginTop: 10 }}>
          Showing the latest 300 entries. Use{" "}
          <button type="button" className="ims-b-link" onClick={() => navigate("history", "type:DAMAGE,WRITE_OFF")}>
            Transactions
          </button>{" "}
          for older history.
        </p>
      ) : null}
    </Card>
  );
}

export default ReturnsModule;
