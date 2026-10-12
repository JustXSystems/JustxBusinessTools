"use client";

import "./inventory-b.css";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, FormGrid, IconButton, Input, Segmented, Textarea, WidgetCard, cx, type BosColumn, type BosTone } from "@/components/bos";
import { ImsApiError, ims, type ImsItem, type ImsModuleKey, type ImsPermission, type MovementInput, type PostedMovement } from "@/lib/ims/api";
import { dateLabel, inr, num, qtyText, round2, round3, signedQty, timeAgo, todayLocal } from "@/lib/ims/format";
import { Loaded, NoAccess, PageHeader, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { ItemSearch, PartySelect, useItemCatalog } from "../shared/pickers";
import { isOther, QtyStepper, ReasonChips, useInventoryMeta } from "./stock-shared";

type Mode = "IN" | "OUT" | "DAMAGE" | "ADJUSTMENT";
const MODES: ReadonlyArray<Mode> = ["IN", "OUT", "DAMAGE", "ADJUSTMENT"];

const MODE: Record<Mode, { tab: string; title: string; perm: ImsPermission; glyph: string; tone: BosTone; sub: string; submit: string; done: string }> = {
  IN: { tab: "Stock in", title: "Stock In", perm: "stockIn", glyph: "⬇", tone: "emerald", sub: "Receive goods from suppliers, transfers or found stock.", submit: "Post stock in", done: "Stock received" },
  OUT: { tab: "Stock out", title: "Stock Out", perm: "stockOut", glyph: "⬆", tone: "blue", sub: "Issue goods for sales, transfers, samples or internal use.", submit: "Post stock out", done: "Stock issued" },
  DAMAGE: { tab: "Damage", title: "Report Damage", perm: "damage", glyph: "⚠", tone: "coral", sub: "Moves units out of saleable stock into quarantine. Write off, restore or return them from Damage & Returns.", submit: "Report damage", done: "Damage recorded" },
  ADJUSTMENT: { tab: "Adjustment", title: "Stock Adjustment", perm: "stockCheck", glyph: "±", tone: "amber", sub: "Correct the system quantity of a few items. For a full count, run a Stock Check.", submit: "Post adjustment", done: "Stock adjusted" },
};

const IN_REASONS = ["Purchase", "Transfer in", "Found stock", "Replacement received", "Other"];
const OUT_REASONS = ["Sale", "Transfer out", "Sample", "Internal use", "Promotion / gift", "Other"];
const INTENT_MODE: Record<string, Mode> = { in: "IN", out: "OUT", damage: "DAMAGE", adjust: "ADJUSTMENT" };

export function StockInModule() {
  return <StockEntry module="stockin" initial="IN" />;
}

export function StockOutModule() {
  return <StockEntry module="stockout" initial="OUT" />;
}

function StockEntry({ module, initial }: { module: ImsModuleKey; initial: Mode }) {
  const { can, takeIntent, navigate } = useIms();
  const [intent] = useState(() => takeIntent(module));
  const allowed = MODES.filter((m) => can(MODE[m].perm));
  const wanted = (intent && INTENT_MODE[intent]) || initial;
  const [mode, setMode] = useState<Mode>(() => (allowed.includes(wanted) ? wanted : (allowed[0] ?? initial)));
  const [presetItemId] = useState(() => (intent?.startsWith("item:") ? intent.slice(5) : null));
  const [presetMode] = useState(mode);

  if (!allowed.length) {
    return (
      <Stack>
        <PageHeader title={MODE[initial].title} />
        <NoAccess what="stock entries" />
      </Stack>
    );
  }
  const active = allowed.includes(mode) ? mode : allowed[0];
  return (
    <Stack>
      <PageHeader
        title={MODE[active].title}
        sub={MODE[active].sub}
        actions={
          <Button size="sm" icon="clock" onClick={() => navigate("history", `type:${active}`)}>
            History
          </Button>
        }
      />
      {allowed.length > 1 ? <SubTabs label="Entry type" value={active} onChange={setMode} options={allowed.map((m) => ({ value: m, label: MODE[m].tab }))} /> : null}
      <EntryForm key={active} mode={active} presetItemId={active === presetMode ? presetItemId : null} />
    </Stack>
  );
}

/* ---------- Entry form ---------- */

type Line = { key: string; itemId: string; qty: string; rate: string; duty: string };

type Computed = {
  line: Line;
  item: ImsItem;
  qty: number;
  delta: number;
  before: number;
  after: number;
  rate: number | null;
  value: number;
  error: string | null;
  warn: string | null;
};

let lineSeq = 0;
const newLine = (item: ImsItem, mode: Mode, adjustBy: "count" | "delta"): Line => ({
  key: `l${++lineSeq}`,
  itemId: item.id,
  qty: mode === "ADJUSTMENT" ? (adjustBy === "count" ? String(item.currentStock) : "0") : "1",
  rate: mode === "IN" ? String(item.purchasePrice) : mode === "OUT" ? String(item.sellingPrice) : "",
  duty: "",
});

function compute(mode: Mode, line: Line, item: ImsItem, adjustBy: "count" | "delta", allowNegative: boolean): Computed {
  const raw = line.qty.trim();
  const v = num(raw, Number.NaN);
  const before = item.currentStock;
  let error: string | null = null;
  let warn: string | null = null;
  let delta = 0;
  if (!raw || !Number.isFinite(v)) error = "Enter a quantity";
  else if (mode === "ADJUSTMENT") {
    if (adjustBy === "count" && v < 0) error = "A count can't be negative";
    delta = adjustBy === "count" ? round3(v - before) : round3(v);
    if (!error && delta === 0) error = "No change from current stock";
  } else if (v <= 0) error = "Quantity must be more than zero";
  else delta = mode === "IN" ? round3(v) : round3(-v);
  const after = round3(before + delta);
  const rateRaw = line.rate.trim();
  const rate = rateRaw === "" ? null : num(rateRaw, Number.NaN);
  if (!error && rate !== null && (!Number.isFinite(rate) || rate < 0)) error = "Enter a valid rate";
  if (!error && after < 0) {
    if (!allowNegative) error = `Only ${qtyText(before, item.unit)} in stock`;
    else warn = "Stock will go negative";
  }
  if (!error && !warn && delta < 0) {
    if (after === 0) warn = "Item will be out of stock";
    else if (item.minStock > 0 && after <= item.minStock) warn = `Below minimum (${qtyText(item.minStock)})`;
  }
  if (!error && !warn && delta > 0 && item.maxStock && after > item.maxStock) warn = `Above maximum (${qtyText(item.maxStock)})`;
  const qty = Math.abs(delta);
  const unit = rate !== null && Number.isFinite(rate) ? rate : mode === "OUT" ? item.sellingPrice : item.purchasePrice;
  return { line, item, qty, delta, before, after, rate: rate !== null && Number.isFinite(rate) ? rate : null, value: round2(qty * unit), error, warn };
}

function EntryForm({ mode, presetItemId }: { mode: Mode; presetItemId: string | null }) {
  const { session, navigate } = useIms();
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const catalog = useItemCatalog();
  const [today] = useState(() => todayLocal());
  const [lines, setLines] = useState<Line[]>([]);
  const [party, setParty] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  const [refNo, setRefNo] = useState("");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [adjustBy, setAdjustBy] = useState<"count" | "delta">("count");
  const [touched, setTouched] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ movements: PostedMovement[]; date: string; refNo: string; party: string } | null>(null);
  const [presetDone, setPresetDone] = useState(!presetItemId);

  const items = useMemo(() => new Map((catalog.data ?? []).map((i) => [i.id, i])), [catalog.data]);
  if (!presetDone && catalog.data) {
    setPresetDone(true);
    const it = items.get(presetItemId ?? "");
    if (it) setLines([newLine(it, mode, adjustBy)]);
  }

  const taxonomy = meta.data?.taxonomy;
  const allowNegative = meta.data?.allowNegativeStock ?? session.settings.allowNegativeStock;
  const canSeeCost = meta.data?.canSeeCost ?? false;
  const reasons = mode === "IN" ? IN_REASONS : mode === "OUT" ? OUT_REASONS : mode === "DAMAGE" ? (taxonomy?.damageReasons ?? []) : (taxonomy?.adjustmentReasons ?? []);
  const reasonValue = reason || reasons[0] || "";
  const hasRate = mode === "OUT" || (mode === "IN" && canSeeCost);
  const showDuty = mode === "IN" && session.settings.exciseActive;
  const hasParty = mode === "IN" || mode === "OUT";

  const computed = lines.flatMap((l) => {
    const item = items.get(l.itemId);
    return item ? [compute(mode, l, item, adjustBy, allowNegative)] : [];
  });
  const errors = computed.filter((c) => c.error).length;
  const units = round3(computed.reduce((s, c) => s + (c.error ? 0 : c.delta), 0));
  const value = round2(computed.reduce((s, c) => s + (c.error ? 0 : c.value), 0));
  const noteNeeded = isOther(reasonValue) && !notes.trim();
  const dateError = date > today ? "The date can't be in the future" : !date ? "Pick a date" : null;

  const addItem = (item: ImsItem) => {
    setStockError(null);
    setLines((ls) => {
      const existing = ls.find((l) => l.itemId === item.id);
      if (!existing) return [...ls, newLine(item, mode, adjustBy)];
      if (mode === "ADJUSTMENT") return ls;
      return ls.map((l) => (l === existing ? { ...l, qty: String(round3(num(l.qty, 0) + 1)) } : l));
    });
  };
  const patchLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const switchAdjust = (by: "count" | "delta") => {
    setAdjustBy(by);
    setLines((ls) => ls.map((l) => ({ ...l, qty: by === "count" ? String(items.get(l.itemId)?.currentStock ?? 0) : "0" })));
  };

  const reset = () => {
    setLines([]);
    setRefNo("");
    setNotes("");
    setTouched(false);
    setStockError(null);
    setPosted(null);
  };

  const submit = async () => {
    setTouched(true);
    if (!computed.length || errors || noteNeeded || dateError) return;
    setStockError(null);
    const input: MovementInput = {
      type: mode,
      lines: computed.map((c) => ({
        itemId: c.item.id,
        qty: mode === "ADJUSTMENT" ? c.delta : c.qty,
        unitCost: mode === "IN" && canSeeCost && c.rate !== null ? c.rate : undefined,
        unitPrice: mode === "OUT" && c.rate !== null ? c.rate : undefined,
        exciseDuty: showDuty && c.line.duty.trim() ? num(c.line.duty) : undefined,
      })),
      partyId: hasParty ? party.id : null,
      partyName: hasParty ? party.name.trim() || null : null,
      refNo: refNo.trim() || null,
      reason: reasonValue || null,
      notes: notes.trim() || null,
      date,
    };
    const res = await run(
      "post",
      async () => {
        try {
          return await ims.postMovements(input);
        } catch (err) {
          if (err instanceof ImsApiError && err.insufficientStock) setStockError(err.message);
          throw err;
        }
      },
      { success: MODE[mode].done, description: `${computed.length} item${computed.length === 1 ? "" : "s"} · ${signedQty(units)} units` },
    );
    if (res) setPosted({ movements: res.movements, date, refNo: refNo.trim(), party: party.name.trim() });
  };

  const onFormKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  if (posted) return <PostedSummary mode={mode} posted={posted} onNew={reset} showValue={mode === "OUT" || canSeeCost} />;

  const rateLabel = mode === "IN" ? "Unit cost" : "Unit price";
  return (
    <div className="ims-split">
      <Card interactive={false}>
        <div onKeyDown={onFormKey}>
          <Stack gap={18}>
            <div className="ims-b-mode">
              <span className={cx("ims-b-mode-ic", `bos-tint-${MODE[mode].tone}`)} aria-hidden="true">
                {MODE[mode].glyph}
              </span>
              <div>
                <div className="ims-b-mode-title">{MODE[mode].title}</div>
                <div className="ims-b-mode-sub">{MODE[mode].sub}</div>
              </div>
            </div>

            {meta.error && !meta.data ? <Alert tone="amber" title="Couldn't load reasons and settings">Stock rules fall back to your saved settings. You can still post entries.</Alert> : null}

            <FormGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
              {hasParty ? (
                <Field label={mode === "IN" ? "Supplier" : "Customer"} hint="Optional — pick a saved party or type a name">
                  {({ id }) => <PartySelect id={id} kind={mode === "IN" ? "supplier" : "customer"} value={party} onChange={(v) => setParty({ id: v.id, name: v.name })} />}
                </Field>
              ) : null}
              <Field label={mode === "IN" ? "Bill / GRN no." : mode === "OUT" ? "Invoice / challan no." : "Reference"} hint="Optional">
                {({ id }) => <Input id={id} value={refNo} maxLength={64} onChange={(e) => setRefNo(e.target.value)} placeholder={mode === "IN" ? "e.g. INV-2041" : mode === "OUT" ? "e.g. DC-118" : "e.g. Shelf audit"} />}
              </Field>
              <Field label="Date" error={touched ? dateError : null}>
                {({ id, describedBy, invalid }) => <Input id={id} type="date" max={today} value={date} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setDate(e.target.value)} />}
              </Field>
            </FormGrid>

            <div>
              <div className="bos-field-label" style={{ marginBottom: 8 }}>
                Reason
              </div>
              {reasons.length ? <ReasonChips label="Reason" options={reasons} value={reasonValue} onChange={setReason} /> : <p className="ims-faint">Loading reasons…</p>}
            </div>

            {mode === "ADJUSTMENT" ? (
              <div className="ims-between">
                <span className="ims-muted" style={{ fontSize: 13 }}>
                  {adjustBy === "count" ? "Enter the quantity you physically counted; the difference is posted." : "Enter a signed change, e.g. −2 or 5."}
                </span>
                <Segmented
                  size="sm"
                  role="radio"
                  aria-label="Adjustment input"
                  value={adjustBy}
                  onChange={switchAdjust}
                  options={[
                    { value: "count", label: "Set counted qty" },
                    { value: "delta", label: "Change by ±" },
                  ]}
                />
              </div>
            ) : null}

            <div>
              <div className="bos-field-label" style={{ marginBottom: 8 }}>
                Add items
              </div>
              <ItemSearch onPick={addItem} price={mode === "IN" ? "purchase" : "selling"} placeholder="Search name, SKU or scan a barcode, then press Enter…" />
            </div>

            {stockError ? (
              <Alert tone="coral" title="Not enough stock">
                {stockError}
              </Alert>
            ) : null}

            {computed.length ? (
              <div className={cx("ims-b-cart", !hasRate && "is-norate")}>
                <div className="ims-b-cart-head" aria-hidden="true">
                  <span>Item</span>
                  <span>{mode === "ADJUSTMENT" ? (adjustBy === "count" ? "Counted" : "Change") : "Quantity"}</span>
                  {hasRate ? <span>{rateLabel}</span> : null}
                  <span>Stock after</span>
                  <span />
                </div>
                {computed.map((c) => (
                  <CartLine
                    key={c.line.key}
                    c={c}
                    mode={mode}
                    adjustBy={adjustBy}
                    hasRate={hasRate}
                    rateLabel={rateLabel}
                    showDuty={showDuty}
                    showErrors={touched}
                    onChange={(patch) => patchLine(c.line.key, patch)}
                    onRemove={() => setLines((ls) => ls.filter((l) => l.key !== c.line.key))}
                  />
                ))}
                <div className="ims-b-cart-foot">
                  <span className="ims-muted">
                    {computed.length} item{computed.length === 1 ? "" : "s"} · <b>{signedQty(units)}</b> units
                    {mode === "OUT" || canSeeCost ? (
                      <>
                        {" "}
                        · <b>{inr(value)}</b>
                      </>
                    ) : null}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setLines([])}>
                    Clear all
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState icon="box" title="No items yet">
                Search above or scan barcodes — scanning the same item again adds one more.
              </EmptyState>
            )}

            <Field label="Notes" error={touched && noteNeeded ? "Add a note when the reason is “Other”" : null} hint={!noteNeeded ? "Optional" : undefined}>
              {({ id, describedBy, invalid }) => <Textarea id={id} rows={2} maxLength={500} value={notes} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setNotes(e.target.value)} />}
            </Field>

            {touched && errors ? (
              <Alert tone="coral" title={`Fix ${errors} line${errors === 1 ? "" : "s"} before posting`}>
                Lines with problems are outlined in red.
              </Alert>
            ) : null}

            <div className="ims-between">
              <span className="ims-faint">Ctrl + Enter to post</span>
              <div className="ims-row">
                {computed.length ? (
                  <Button variant="ghost" onClick={reset}>
                    Reset
                  </Button>
                ) : null}
                <Button variant="primary" icon="check" disabled={!computed.length || isBusy("post")} onClick={() => void submit()}>
                  {isBusy("post") ? "Posting…" : MODE[mode].submit}
                </Button>
              </div>
            </div>
          </Stack>
        </div>
      </Card>

      <Stack gap={16}>
        <RecentEntries mode={mode} showValue={mode === "OUT" || canSeeCost} />
        <WidgetCard title="Shortcuts" dot="lavender">
          <div className="ims-b-list">
            {mode === "DAMAGE" ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("returns", "damaged")}>
                Open damaged stock (quarantine) ›
              </Button>
            ) : null}
            {mode === "ADJUSTMENT" ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("checks", "new")}>
                Start a full stock check ›
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => navigate("lowstock")}>
              Restock list ›
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate("history", `type:${mode}`)}>
              All {MODE[mode].tab.toLowerCase()} entries ›
            </Button>
          </div>
        </WidgetCard>
      </Stack>
    </div>
  );
}

function CartLine({
  c,
  mode,
  adjustBy,
  hasRate,
  rateLabel,
  showDuty,
  showErrors,
  onChange,
  onRemove,
}: {
  c: Computed;
  mode: Mode;
  adjustBy: "count" | "delta";
  hasRate: boolean;
  rateLabel: string;
  showDuty: boolean;
  showErrors: boolean;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const { item } = c;
  const liveError = c.error && (showErrors || c.after < 0) ? c.error : null;
  const qtyLabel = mode === "ADJUSTMENT" ? (adjustBy === "count" ? `Counted quantity of ${item.name}` : `Change in ${item.name}`) : `Quantity of ${item.name}`;
  return (
    <div className={cx("ims-b-cart-line", liveError && "is-error", !liveError && c.warn && "is-warn")}>
      <div className="ims-cell-stack">
        <span className="ims-strong">{item.name}</span>
        <small>
          {[item.sku, item.location].filter(Boolean).join(" · ") || item.category || "—"} · {qtyText(item.currentStock, item.unit)} in stock
          {mode === "DAMAGE" && item.damagedStock > 0 ? ` · ${qtyText(item.damagedStock)} damaged` : ""}
        </small>
      </div>
      <div>
        <QtyStepper value={c.line.qty} onChange={(qty) => onChange({ qty })} label={qtyLabel} min={mode === "ADJUSTMENT" && adjustBy === "delta" ? null : 0} invalid={Boolean(liveError)} />
      </div>
      {hasRate ? (
        <div className="ims-cell-stack" style={{ gap: 4 }}>
          <Input size="sm" inputMode="decimal" aria-label={`${rateLabel} for ${item.name}`} value={c.line.rate} onChange={(e) => onChange({ rate: e.target.value.replace(/[^\d.]/g, "") })} placeholder="₹" />
          {showDuty ? <Input size="sm" inputMode="decimal" aria-label={`Excise duty for ${item.name}`} value={c.line.duty} onChange={(e) => onChange({ duty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Excise ₹" /> : null}
        </div>
      ) : null}
      <div className="ims-b-after" aria-live="polite">
        <span className="ims-muted">
          {qtyText(c.before)} →{" "}
          <b className={c.after < 0 ? "ims-neg" : c.delta > 0 ? "ims-pos" : undefined}>{qtyText(c.after, item.unit)}</b>
        </span>
        {liveError ? (
          <small className="ims-b-err">{liveError}</small>
        ) : c.warn ? (
          <small className="ims-b-warn">{c.warn}</small>
        ) : mode === "ADJUSTMENT" && !c.error ? (
          <small className={c.delta > 0 ? "ims-pos" : "ims-neg"}>{signedQty(c.delta)} adjustment</small>
        ) : hasRate && !c.error ? (
          <small className="ims-faint">{inr(c.value)}</small>
        ) : null}
      </div>
      <IconButton icon="x" aria-label={`Remove ${item.name}`} onClick={onRemove} />
    </div>
  );
}

/* ---------- Success ---------- */

function PostedSummary({
  mode,
  posted,
  onNew,
  showValue,
}: {
  mode: Mode;
  posted: { movements: PostedMovement[]; date: string; refNo: string; party: string };
  onNew: () => void;
  showValue: boolean;
}) {
  const { navigate } = useIms();
  const ms = posted.movements;
  const units = round3(ms.reduce((s, m) => s + m.delta, 0));
  const value = round2(ms.reduce((s, m) => s + m.value, 0));
  const columns: BosColumn<PostedMovement>[] = [
    { key: "item", header: "Item", cell: (m) => <span className="ims-strong">{m.itemName}</span> },
    { key: "qty", header: mode === "ADJUSTMENT" ? "Change" : "Qty", align: "right", cell: (m) => <span className={cx("ims-num", m.delta > 0 ? "ims-pos" : m.delta < 0 ? "ims-neg" : undefined)}>{signedQty(m.delta)}</span> },
    {
      key: "stock",
      header: "Stock before → after",
      align: "right",
      cell: (m) => (
        <span className="ims-num">
          {qtyText(m.before)} → <b>{qtyText(m.after)}</b>
        </span>
      ),
    },
    ...(showValue ? [{ key: "value", header: "Value", align: "right" as const, cell: (m: PostedMovement) => <span className="ims-num">{inr(m.value)}</span> }] : []),
  ];
  return (
    <Card interactive={false}>
      <Stack gap={18}>
        <div className="ims-b-success" role="status">
          <div className="ims-b-success-ic" aria-hidden="true">
            ✓
          </div>
          <div className="ims-b-success-title">{MODE[mode].done}</div>
          <div className="ims-b-success-sub">
            {ms.length} item{ms.length === 1 ? "" : "s"} · {signedQty(units)} units{showValue ? ` · ${inr(value)}` : ""} · {dateLabel(posted.date)}
            {posted.refNo ? ` · Ref ${posted.refNo}` : ""}
            {posted.party ? ` · ${posted.party}` : ""}
          </div>
        </div>
        <DataTable compact columns={columns} rows={ms} rowKey={(m) => m.id} onRowClick={(m) => navigate("items", `open:${m.itemId}`)} caption="Posted lines" />
        {ms.some((m) => m.after < 0) ? <Alert tone="amber" title="Some items are now below zero">Receive stock or run a stock check to bring them back in line.</Alert> : null}
        <div className="ims-row" style={{ justifyContent: "center" }}>
          <Button variant="primary" icon="plus" onClick={onNew}>
            New entry
          </Button>
          <Button icon="clock" onClick={() => navigate("history", `type:${mode}`)}>
            View history
          </Button>
          {mode === "DAMAGE" ? (
            <Button variant="ghost" onClick={() => navigate("returns", "damaged")}>
              Damaged stock
            </Button>
          ) : null}
        </div>
      </Stack>
    </Card>
  );
}

/* ---------- Recent entries ---------- */

function RecentEntries({ mode, showValue }: { mode: Mode; showValue: boolean }) {
  const { navigate } = useIms();
  const [period, setPeriod] = useState<"today" | "7d">("today");
  const state = useImsData(() => ims.movements({ type: mode, period, limit: 40 }), [mode, period]);
  return (
    <WidgetCard title={`Recent ${MODE[mode].tab.toLowerCase()}`} dot="blue" note={<Segmented size="sm" role="radio" aria-label="Recent period" value={period} onChange={setPeriod} options={[{ value: "today", label: "Today" }, { value: "7d", label: "7 days" }]} />}>
      <Loaded state={state} rows={1}>
        {(d) => {
          const t = d.totals[mode];
          if (!d.movements.length) return <p className="ims-faint">No entries {period === "today" ? "today" : "in the last 7 days"}.</p>;
          return (
            <Stack gap={10}>
              <div className="ims-row" style={{ gap: 6 }}>
                <Badge tone="neutral">{t?.count ?? d.movements.length} entries</Badge>
                {t ? <Badge tone={MODE[mode].tone === "coral" ? "coral" : "blue"}>{qtyText(t.qty)} units</Badge> : null}
                {t && showValue && mode !== "ADJUSTMENT" ? <Badge tone="emerald">{inr(t.value)}</Badge> : null}
              </div>
              <div className="ims-b-list">
                {d.movements.slice(0, 12).map((m) => (
                  <button key={m.id} type="button" className="ims-b-list-row ims-pick-row" onClick={() => navigate("items", `open:${m.itemId}`)}>
                    <span className="ims-cell-stack">
                      <span className="ims-strong">{m.itemName}</span>
                      <small>{[m.partyName, m.refNo, m.reason].filter(Boolean).join(" · ") || m.actorName || "—"}</small>
                    </span>
                    <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
                      <span className={cx("ims-num ims-strong", m.delta > 0 ? "ims-pos" : m.delta < 0 ? "ims-neg" : undefined)}>{signedQty(m.delta)}</span>
                      <small>{timeAgo(m.createdAt) || dateLabel(m.date)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </Stack>
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}
