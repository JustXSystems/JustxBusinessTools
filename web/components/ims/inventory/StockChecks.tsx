"use client";

import "./inventory-b.css";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
  Input,
  KpiCard,
  ProgressBar,
  SearchInput,
  Segmented,
  Select,
  Switch,
  Textarea,
  cx,
  type BosColumn,
} from "@/components/bos";
import { errorText, ims, type CheckStatus, type ImsItem } from "@/lib/ims/api";
import { imsB, type CountLine, type CountSheet } from "@/lib/ims/inventory-b";
import { dateLabel, downloadCsv, inr, num, qtyText, round2, round3, signedQty, stampLabel, timeAgo, todayLocal, type BadgeView } from "@/lib/ims/format";
import { Loaded, PageHeader, Stack, StatusBadge, useIms, useImsAction, useImsData, usePrint } from "../core";
import { ItemSearch, useItemCatalog } from "../shared/pickers";
import { useInventoryMeta } from "./stock-shared";

const CHECK_BADGE: Record<CheckStatus, BadgeView> = {
  counting: { text: "COUNTING", tone: "blue" },
  submitted: { text: "AWAITING APPROVAL", tone: "amber" },
  approved: { text: "APPROVED", tone: "emerald" },
  adjusted: { text: "ADJUSTED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "neutral" },
};

type ListFilter = "all" | "counting" | "submitted" | "closed";
const isClosed = (s: CheckStatus) => s === "approved" || s === "adjusted" || s === "cancelled";
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const scopeText = (c: CountSheet): string => {
  const s = c.scope ?? {};
  const parts = [s.category ? `Category: ${s.category}` : null, s.location ? `Location: ${s.location}` : null, s.lowOnly ? "Low stock only" : null, s.itemIds ? `${s.itemIds} selected items` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All active items";
};

export function StockChecksModule() {
  const { takeIntent, can } = useIms();
  const [intent] = useState(() => takeIntent("checks"));
  const [openId, setOpenId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [creating, setCreating] = useState(intent === "new" && can("stockCheck"));
  return (
    <>
      {openId ? <CheckDetail id={openId} onBack={() => setOpenId(null)} /> : <CheckList onOpen={setOpenId} onNew={() => setCreating(true)} />}
      <NewCheckDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpenId(id);
        }}
      />
    </>
  );
}

/* ---------- List ---------- */

function CheckList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { can } = useIms();
  const state = useImsData(() => imsB.checks(), []);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [q, setQ] = useState("");
  const columns: BosColumn<CountSheet>[] = [
    {
      key: "check",
      header: "Check",
      cell: (c) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{c.title}</span>
          <small>
            {c.checkNo} · {scopeText(c)}
          </small>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (c) => <StatusBadge view={CHECK_BADGE[c.status] ?? CHECK_BADGE.counting} /> },
    {
      key: "progress",
      header: "Progress",
      width: 160,
      cell: (c) => (
        <span className="ims-cell-stack" style={{ gap: 4 }}>
          <ProgressBar value={pctOf(c.countedCount, c.itemCount)} tone={c.countedCount >= c.itemCount ? "emerald" : "blue"} label={`${c.countedCount} of ${c.itemCount} counted`} />
          <small>
            {c.countedCount} / {c.itemCount} counted
          </small>
        </span>
      ),
    },
    { key: "mismatch", header: "Mismatches", align: "right", cell: (c) => <span className={cx("ims-num", c.mismatchCount ? "ims-strong" : "ims-muted")}>{c.mismatchCount}</span> },
    { key: "vq", header: "Variance", align: "right", cell: (c) => <span className={cx("ims-num", c.varianceQty < 0 ? "ims-diff-neg" : c.varianceQty > 0 ? "ims-diff-pos" : "ims-muted")}>{signedQty(c.varianceQty)}</span> },
    { key: "vv", header: "Value", align: "right", cell: (c) => <span className={cx("ims-num", c.varianceValue < 0 ? "ims-neg" : c.varianceValue > 0 ? "ims-pos" : "ims-muted")}>{inr(c.varianceValue)}</span> },
    {
      key: "by",
      header: "Last activity",
      cell: (c) => (
        <span className="ims-cell-stack">
          <span>{c.decidedByName ?? c.countedByName ?? "—"}</span>
          <small>{timeAgo(c.decidedAt ?? c.updatedAt) || stampLabel(c.updatedAt)}</small>
        </span>
      ),
    },
  ];
  return (
    <Stack>
      <PageHeader
        title="Stock Check"
        sub="Count physical stock, reconcile differences and post approved adjustments."
        actions={
          can("stockCheck") ? (
            <Button variant="primary" icon="plus" onClick={onNew}>
              New stock check
            </Button>
          ) : null
        }
      />
      <Loaded state={state}>
        {(d) => {
          const checks = d.checks;
          const counting = checks.filter((c) => c.status === "counting");
          const submitted = checks.filter((c) => c.status === "submitted");
          const done = checks.filter((c) => c.status === "approved" || c.status === "adjusted");
          const term = q.trim().toLowerCase();
          const shown = checks.filter(
            (c) =>
              (filter === "all" || (filter === "closed" ? isClosed(c.status) : c.status === filter)) &&
              (!term || [c.title, c.checkNo, c.countedByName].some((v) => v && v.toLowerCase().includes(term))),
          );
          return (
            <Stack>
              <Grid cols={4} min={150}>
                <KpiCard label="Counting now" value={counting.length} chip={{ color: "blue", glyph: "☑" }} delta={counting.length ? `${counting.reduce((s, c) => s + (c.itemCount - c.countedCount), 0)} items left to count` : "No open counts"} deltaTone="info" />
                <KpiCard label="Awaiting approval" value={submitted.length} chip={{ color: "amber", glyph: "⏳" }} delta={submitted.length ? `${inr(submitted.reduce((s, c) => s + c.varianceValue, 0))} net variance` : "Nothing pending"} deltaTone={submitted.length ? "warn" : "muted"} />
                <KpiCard label="Completed" value={done.length} chip={{ color: "mint", glyph: "✓" }} delta={done[0] ? `Last: ${dateLabel(done[0].decidedAt ?? done[0].updatedAt)}` : "None yet"} deltaTone="muted" />
                <KpiCard
                  label="Adjusted value"
                  value={inr(done.reduce((s, c) => s + c.varianceValue, 0))}
                  valueTone={done.reduce((s, c) => s + c.varianceValue, 0) < 0 ? "coral" : undefined}
                  chip={{ color: "lavender", glyph: "±" }}
                  delta="Net of all approved checks"
                  deltaTone="muted"
                />
              </Grid>
              <Card interactive={false}>
                <div className="ims-toolbar">
                  <SearchInput wrapperClassName="ims-grow" placeholder="Search checks…" aria-label="Search stock checks" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Segmented
                    size="sm"
                    role="radio"
                    aria-label="Status"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: "all", label: `All (${checks.length})` },
                      { value: "counting", label: `Counting (${counting.length})` },
                      { value: "submitted", label: `Awaiting (${submitted.length})` },
                      { value: "closed", label: "Closed" },
                    ]}
                  />
                </div>
                <DataTable
                  columns={columns}
                  rows={shown}
                  rowKey={(c) => c.id}
                  onRowClick={(c) => onOpen(c.id)}
                  chevron
                  caption="Stock checks"
                  empty={
                    checks.length ? (
                      "No checks match these filters."
                    ) : (
                      <EmptyState
                        icon="tasks"
                        title="No stock checks yet"
                        actions={
                          can("stockCheck") ? (
                            <Button variant="primary" icon="plus" onClick={onNew}>
                              Start your first count
                            </Button>
                          ) : undefined
                        }
                      >
                        Count all items, a category, a location or just the low-stock ones. Differences are posted only after approval.
                      </EmptyState>
                    )
                  }
                />
              </Card>
            </Stack>
          );
        }}
      </Loaded>
    </Stack>
  );
}

/* ---------- New check ---------- */

type Scope = "all" | "category" | "location" | "low" | "selected";

function NewCheckDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const catalog = useItemCatalog();
  const [title, setTitle] = useState(() => `Stock check · ${dateLabel(todayLocal())}`);
  const [scope, setScope] = useState<Scope>("all");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [picked, setPicked] = useState<ImsItem[]>([]);
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const items = useMemo(() => catalog.data ?? [], [catalog.data]);
  const categories = useMemo(() => [...new Set([...(meta.data?.taxonomy.categories.map((c) => c.name) ?? []), ...items.map((i) => i.category).filter((c): c is string => Boolean(c))])].sort(), [meta.data, items]);
  const locations = useMemo(() => [...new Set([...(meta.data?.taxonomy.locations ?? []), ...items.map((i) => i.location).filter((c): c is string => Boolean(c))])].sort(), [meta.data, items]);
  const matching =
    scope === "all"
      ? items.length
      : scope === "category"
        ? items.filter((i) => i.category === category).length
        : scope === "location"
          ? items.filter((i) => i.location === location).length
          : scope === "low"
            ? items.filter((i) => i.currentStock <= i.minStock).length
            : picked.length;
  const error = !title.trim()
    ? "Give the check a title"
    : scope === "category" && !category
      ? "Pick a category"
      : scope === "location" && !location
        ? "Pick a location"
        : catalog.data && matching === 0
          ? "No items match this scope"
          : null;

  const create = async () => {
    setTouched(true);
    if (error) return;
    const res = await run(
      "create",
      () =>
        ims.createCheck({
          title: title.trim(),
          category: scope === "category" ? category : null,
          location: scope === "location" ? location : null,
          lowOnly: scope === "low",
          itemIds: scope === "selected" ? picked.map((i) => i.id) : undefined,
          notes: notes.trim() || null,
        }),
      { success: "Stock check started", description: `${matching} items to count` },
    );
    if (res) {
      setTouched(false);
      setPicked([]);
      setNotes("");
      onCreated(res.check.id);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="New stock check"
      description="System quantities are captured now; count, submit, and an approver posts the differences."
      actionsNote={catalog.data ? `${matching} item${matching === 1 ? "" : "s"} in scope` : "Loading items…"}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" disabled={isBusy("create")} onClick={() => void create()}>
            {isBusy("create") ? "Starting…" : "Start counting"}
          </Button>
        </>
      }
    >
      {open ? (
        <Stack gap={16}>
          <FormGrid>
            <Field label="Title" full error={touched && !title.trim() ? "Give the check a title" : null}>
              {({ id, describedBy, invalid }) => <Input id={id} value={title} maxLength={200} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
          </FormGrid>
          <div>
            <div className="bos-field-label" style={{ marginBottom: 8 }}>
              What to count
            </div>
            <Segmented
              size="sm"
              role="radio"
              scroll
              aria-label="Scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All items" },
                { value: "category", label: "Category" },
                { value: "location", label: "Location" },
                { value: "low", label: "Low stock only" },
                { value: "selected", label: "Selected items" },
              ]}
            />
          </div>
          {scope === "category" ? (
            <Field label="Category">
              {({ id }) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select a category…</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c} ({items.filter((i) => i.category === c).length})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {scope === "location" ? (
            <Field label="Location">
              {({ id }) => (
                <Select id={id} value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">Select a location…</option>
                  {locations.map((c) => (
                    <option key={c} value={c}>
                      {c} ({items.filter((i) => i.location === c).length})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {scope === "selected" ? (
            <Stack gap={10}>
              <ItemSearch onPick={(it) => setPicked((p) => (p.some((x) => x.id === it.id) ? p : [...p, it]))} exclude={new Set(picked.map((p) => p.id))} placeholder="Search or scan items to include…" />
              {picked.length ? (
                <div className="ims-b-chips">
                  {picked.map((p) => (
                    <FilterChip key={p.id} active onClick={() => setPicked((ps) => ps.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>
                      {p.name} ✕
                    </FilterChip>
                  ))}
                </div>
              ) : null}
            </Stack>
          ) : null}
          <Field label="Instructions for counters" hint="Optional">
            {({ id }) => <Textarea id={id} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Count back store first; open sealed cartons only if damaged." />}
          </Field>
          {touched && error ? (
            <Alert tone="coral" title="Can't start yet">
              {error}
            </Alert>
          ) : null}
          {scope === "all" && items.length > 500 ? <Alert tone="blue" title="Large count">{items.length} items — consider counting by category or location so several people can work in parallel.</Alert> : null}
        </Stack>
      ) : null}
    </Dialog>
  );
}

/* ---------- Count sheet ---------- */

type Edit = { qty: string; note: string };
type SheetLine = CountLine & { qtyText: string; noteText: string; invalid: boolean; drift: boolean };
type SheetView = "all" | "pending" | "mismatch" | "matched";
const PAGE = 200;
let editSeq = 0;

function CheckDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const state = useImsData(() => imsB.check(id), [id]);
  return (
    <Stack>
      <div>
        <Button size="sm" variant="ghost" icon="chevronLeft" onClick={onBack}>
          All stock checks
        </Button>
      </div>
      <Loaded state={state}>{(d) => <CountSheetView key={d.check.id} check={d.check} />}</Loaded>
    </Stack>
  );
}

function CountSheetView({ check }: { check: CountSheet }) {
  const { can, session } = useIms();
  const { run, isBusy } = useImsAction();
  const meta = useInventoryMeta();
  const print = usePrint();
  const editable = check.status === "counting" && can("stockCheck");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [dirty, setDirty] = useState<Record<string, number>>({});
  const [save, setSave] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string; at?: string }>({ status: "idle" });
  const [q, setQ] = useState("");
  const [view, setView] = useState<SheetView>("all");
  const [grouped, setGrouped] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [dialog, setDialog] = useState<null | "submit" | "approve" | "reject" | "cancel" | "print">(null);
  const [rejectNote, setRejectNote] = useState("");
  const [blind, setBlind] = useState(true);

  const lines: SheetLine[] = useMemo(
    () =>
      (check.lines ?? []).map((l) => {
        const e = edits[l.itemId];
        const drift = l.liveQty != null && Math.abs(l.liveQty - l.systemQty) > 0.0005;
        if (!e) return { ...l, qtyText: l.physicalQty === null ? "" : String(l.physicalQty), noteText: l.note ?? "", invalid: false, drift };
        const raw = e.qty.trim();
        const v = raw === "" ? null : num(raw, Number.NaN);
        const invalid = v !== null && (!Number.isFinite(v) || v < 0);
        const physicalQty = v === null || invalid ? null : round3(v);
        return { ...l, physicalQty, difference: physicalQty === null ? 0 : round3(physicalQty - l.systemQty), qtyText: e.qty, noteText: e.note, invalid, drift };
      }),
    [check.lines, edits],
  );

  const summary = useMemo(() => {
    let counted = 0;
    let mismatches = 0;
    let shortValue = 0;
    let excessValue = 0;
    let netQty = 0;
    for (const l of lines) {
      if (l.physicalQty === null) continue;
      counted += 1;
      if (Math.abs(l.difference) > 0.0005) {
        mismatches += 1;
        netQty += l.difference;
        if (l.difference < 0) shortValue += -l.difference * l.unitCost;
        else excessValue += l.difference * l.unitCost;
      }
    }
    return { counted, mismatches, shortValue: round2(shortValue), excessValue: round2(excessValue), net: round2(excessValue - shortValue), netQty: round3(netQty) };
  }, [lines]);
  const invalidCount = lines.filter((l) => l.invalid).length;
  const driftCount = lines.filter((l) => l.drift).length;
  const pending = Object.keys(dirty).length;

  const persist = useCallback(
    async (payload: Array<{ itemId: string; physicalQty: number | null; note: string | null }>, seqs: Record<string, number>): Promise<boolean> => {
      if (!payload.length) return true;
      setSave({ status: "saving" });
      try {
        await ims.saveCount(check.id, { lines: payload });
        setDirty((d) => {
          const next = { ...d };
          for (const [k, s] of Object.entries(seqs)) if (next[k] === s) delete next[k];
          return next;
        });
        setSave({ status: "saved", at: new Date().toISOString() });
        return true;
      } catch (err) {
        setSave({ status: "error", message: errorText(err) });
        return false;
      }
    },
    [check.id],
  );

  const payloadOf = useCallback(
    (ids: string[]) => {
      const payload: Array<{ itemId: string; physicalQty: number | null; note: string | null }> = [];
      const seqs: Record<string, number> = {};
      for (const itemId of ids) {
        const e = edits[itemId];
        if (!e) continue;
        const raw = e.qty.trim();
        const v = raw === "" ? null : num(raw, Number.NaN);
        if (v !== null && (!Number.isFinite(v) || v < 0)) continue;
        payload.push({ itemId, physicalQty: v === null ? null : round3(v), note: e.note.trim() || null });
        seqs[itemId] = dirty[itemId];
      }
      return { payload, seqs };
    },
    [edits, dirty],
  );

  useEffect(() => {
    if (!editable) return;
    const ids = Object.keys(dirty);
    if (!ids.length) return;
    const t = window.setTimeout(() => {
      const { payload, seqs } = payloadOf(ids);
      void persist(payload, seqs);
    }, 900);
    return () => window.clearTimeout(t);
  }, [dirty, editable, payloadOf, persist]);

  const setLine = (l: SheetLine, patch: Partial<Edit>) => {
    setEdits((e) => ({ ...e, [l.itemId]: { ...(e[l.itemId] ?? { qty: l.qtyText, note: l.noteText }), ...patch } }));
    setDirty((d) => ({ ...d, [l.itemId]: ++editSeq }));
  };
  const setMany = (targets: SheetLine[]) => {
    if (!targets.length) return;
    setEdits((e) => {
      const next = { ...e };
      for (const l of targets) next[l.itemId] = { qty: String(l.systemQty), note: e[l.itemId]?.note ?? l.noteText };
      return next;
    });
    setDirty((d) => {
      const next = { ...d };
      for (const l of targets) next[l.itemId] = ++editSeq;
      return next;
    });
  };
  const flush = async (): Promise<boolean> => {
    const { payload, seqs } = payloadOf(Object.keys(dirty));
    return persist(payload, seqs);
  };

  const term = q.trim().toLowerCase();
  const filtered = lines.filter(
    (l) =>
      (view === "all" || (view === "pending" ? l.physicalQty === null : view === "mismatch" ? l.physicalQty !== null && Math.abs(l.difference) > 0.0005 : l.physicalQty !== null && Math.abs(l.difference) <= 0.0005)) &&
      (!term || [l.name, l.sku, l.category, l.location].some((v) => v && v.toLowerCase().includes(term))),
  );
  const visible = filtered.slice(0, limit);
  const groups: Array<{ key: string; rows: SheetLine[] }> = [];
  if (!grouped) groups.push({ key: "", rows: visible });
  else {
    const map = new Map<string, SheetLine[]>();
    for (const l of visible) {
      const k = l.category || "Uncategorised";
      const list = map.get(k);
      if (list) list.push(l);
      else map.set(k, [l]);
    }
    for (const [key, rows] of map) groups.push({ key, rows });
  }

  const focusNext = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const all = Array.from(e.currentTarget.closest(".ims-b-sheet")?.querySelectorAll<HTMLInputElement>("input[data-count]") ?? []);
    const i = all.indexOf(e.currentTarget);
    all[i + 1]?.focus();
  };

  const exportCsv = () =>
    downloadCsv(`${check.checkNo.replace(/\//g, "-")}-count`, lines, [
      { header: "Item", value: (l) => l.name },
      { header: "SKU", value: (l) => l.sku },
      { header: "Category", value: (l) => l.category },
      { header: "Location", value: (l) => l.location },
      { header: "Unit", value: (l) => l.unit },
      { header: "System qty", value: (l) => l.systemQty },
      { header: "Counted qty", value: (l) => l.physicalQty },
      { header: "Difference", value: (l) => (l.physicalQty === null ? "" : l.difference) },
      ...(meta.data?.canSeeCost ? [{ header: "Unit cost", value: (l: SheetLine) => l.unitCost }] : []),
      { header: "Variance value", value: (l) => (l.physicalQty === null ? "" : round2(l.difference * l.unitCost)) },
      { header: "Note", value: (l) => l.noteText },
    ]);

  const submit = async () => {
    if (pending && !(await flush())) return;
    const res = await run("submit", () => ims.submitCheck(check.id), { success: "Sent for approval", description: `${check.checkNo} · ${summary.mismatches} differences` });
    if (res) setDialog(null);
  };
  const approve = async () => {
    const res = await run("approve", () => ims.approveCheck(check.id), {
      success: "Stock check approved",
      description: summary.mismatches ? `${summary.mismatches} stock adjustments posted` : "No differences to post",
    });
    if (res) setDialog(null);
  };
  const reject = async () => {
    const res = await run("reject", () => ims.rejectCheck(check.id, rejectNote.trim() || undefined), { success: "Sent back for recount" });
    if (res) {
      setRejectNote("");
      setDialog(null);
    }
  };
  const cancel = async () => {
    const res = await run("cancel", () => ims.cancelCheck(check.id), { success: "Stock check cancelled", tone: "amber" });
    if (res) setDialog(null);
  };

  const canDecide = check.status === "submitted" && can("approvals");
  const canCancel = (check.status === "counting" || check.status === "submitted") && (can("stockCheck") || can("approvals"));
  const progress = pctOf(summary.counted, lines.length);
  const uncounted = lines.length - summary.counted;

  return (
    <Stack>
      <PageHeader
        title={
          <span className="ims-row" style={{ gap: 10 }}>
            {check.title} <StatusBadge view={CHECK_BADGE[check.status] ?? CHECK_BADGE.counting} />
          </span>
        }
        sub={`${check.checkNo} · ${scopeText(check)} · started ${stampLabel(check.createdAt)}${check.countedByName ? ` · last counted by ${check.countedByName}` : ""}${check.decidedByName ? ` · decided by ${check.decidedByName} ${stampLabel(check.decidedAt)}` : ""}`}
        actions={
          <>
            <Button size="sm" icon="printer" onClick={() => setDialog("print")}>
              Print sheet
            </Button>
            <Button size="sm" icon="download" onClick={exportCsv}>
              CSV
            </Button>
            {canCancel ? (
              <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
                Cancel check
              </Button>
            ) : null}
            {editable ? (
              <Button size="sm" variant="primary" icon="check" disabled={!summary.counted || isBusy("submit")} onClick={() => setDialog("submit")}>
                Submit for approval
              </Button>
            ) : null}
            {canDecide ? (
              <>
                <Button size="sm" onClick={() => setDialog("reject")}>
                  Send back
                </Button>
                <Button size="sm" variant="success" icon="check" onClick={() => setDialog("approve")}>
                  Approve
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {check.notes ? (
        <Alert tone={/\[Sent back\]/.test(check.notes) && check.status === "counting" ? "amber" : "blue"} title="Notes">
          <span style={{ whiteSpace: "pre-line" }}>{check.notes}</span>
        </Alert>
      ) : null}
      {check.status === "submitted" && !can("approvals") ? <Alert tone="blue" title="Waiting for an approver">Counts are locked. An approver will post the differences or send it back for a recount.</Alert> : null}
      {driftCount && (check.status === "counting" || check.status === "submitted") ? (
        <Alert tone="amber" title={`${driftCount} item${driftCount === 1 ? "" : "s"} moved since this count started`}>
          Differences are measured against the system quantity captured when the check started. Approving posts those differences on top of today&apos;s stock.
        </Alert>
      ) : null}

      <Grid cols={4} min={150}>
        <Card interactive={false}>
          <div className="bos-kpi-label">Counted</div>
          <div className="bos-kpi-value">
            {summary.counted} <span className="ims-faint">/ {lines.length}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <ProgressBar value={progress} tone={progress === 100 ? "emerald" : "blue"} label={`${progress}% counted`} />
          </div>
        </Card>
        <KpiCard label="Mismatches" value={summary.mismatches} chip={{ color: "amber", glyph: "≠" }} delta={summary.mismatches ? `${signedQty(summary.netQty)} units net` : "Everything matches so far"} deltaTone={summary.mismatches ? "warn" : "up"} interactive={false} />
        <KpiCard label="Short" value={inr(summary.shortValue)} valueTone={summary.shortValue ? "coral" : undefined} chip={{ color: "rose", glyph: "−" }} delta="Missing units at cost" deltaTone="muted" interactive={false} />
        <KpiCard label="Net variance" value={inr(summary.net)} valueTone={summary.net < 0 ? "coral" : summary.net > 0 ? "emerald" : undefined} chip={{ color: "mint", glyph: "+" }} delta={`${inr(summary.excessValue)} excess`} deltaTone="muted" interactive={false} />
      </Grid>

      <Card interactive={false}>
        <div className="ims-toolbar">
          <SearchInput wrapperClassName="ims-grow" placeholder="Search item, SKU, location…" aria-label="Search count sheet" value={q} onChange={(e) => setQ(e.target.value)} />
          <Segmented
            size="sm"
            role="radio"
            scroll
            aria-label="Show"
            value={view}
            onChange={(v) => {
              setView(v);
              setLimit(PAGE);
            }}
            options={[
              { value: "all", label: `All (${lines.length})` },
              { value: "pending", label: `Not counted (${uncounted})` },
              { value: "mismatch", label: `Mismatch (${summary.mismatches})` },
              { value: "matched", label: "Matched" },
            ]}
          />
          <span className="ims-row" style={{ gap: 6 }}>
            <Switch checked={grouped} onChange={setGrouped} aria-label="Group by category" />
            <span className="ims-muted" style={{ fontSize: 12.5 }}>
              Group
            </span>
          </span>
        </div>
        {editable ? (
          <div className="ims-between" style={{ marginBottom: 10 }}>
            <SaveIndicator save={save} pending={pending} invalid={invalidCount} onRetry={() => void flush()} />
            <Button size="sm" variant="ghost" icon="check" disabled={!filtered.some((l) => l.physicalQty === null)} onClick={() => setMany(filtered.filter((l) => l.physicalQty === null))}>
              Mark {view === "all" && !term ? "all" : "shown"} uncounted as matching
            </Button>
          </div>
        ) : null}

        <div className="ims-b-sheet" role="table" aria-label="Count sheet">
          <div className="ims-b-sheet-head" role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader" className="ims-num">
              System
            </span>
            <span role="columnheader">Counted</span>
            <span role="columnheader" className="ims-num">
              Difference
            </span>
            <span role="columnheader">Note</span>
          </div>
          {filtered.length === 0 ? (
            <p className="ims-faint" style={{ padding: 16 }}>
              {lines.length ? "No lines match these filters." : "This check has no items."}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.key || "all"} role="rowgroup">
                {g.key ? (
                  <div className="ims-b-sheet-group">
                    <span>{g.key}</span>
                    <span>
                      {g.rows.filter((r) => r.physicalQty !== null).length} / {g.rows.length}
                    </span>
                  </div>
                ) : null}
                {g.rows.map((l) => (
                  <SheetRow key={l.itemId} l={l} editable={editable} onChange={(p) => setLine(l, p)} onKeyDown={focusNext} />
                ))}
              </div>
            ))
          )}
        </div>
        {filtered.length > visible.length ? (
          <div className="ims-row" style={{ justifyContent: "center", marginTop: 12 }}>
            <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, filtered.length - visible.length)} more ({filtered.length - visible.length} left)
            </Button>
          </div>
        ) : null}
      </Card>

      <Dialog
        open={dialog === "submit"}
        onClose={() => setDialog(null)}
        icon={{ tone: "blue", name: "check" }}
        title="Submit for approval?"
        description="Counts lock once submitted. An approver posts the differences as stock adjustments."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep counting
            </Button>
            <Button variant="primary" disabled={isBusy("submit") || invalidCount > 0} onClick={() => void submit()}>
              {isBusy("submit") ? "Submitting…" : "Submit"}
            </Button>
          </>
        }
      >
        <Stack gap={10}>
          <DecisionFacts summary={summary} total={lines.length} />
          {uncounted ? <Alert tone="amber" title={`${uncounted} item${uncounted === 1 ? "" : "s"} not counted`}>Uncounted items are left unchanged.</Alert> : null}
          {invalidCount ? <Alert tone="coral" title="Fix invalid counts first">{invalidCount} line(s) have a count that isn&apos;t a valid quantity.</Alert> : null}
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        icon={{ tone: "emerald", name: "check" }}
        title={`Approve ${check.checkNo}?`}
        description={summary.mismatches ? `${summary.mismatches} stock adjustments will be posted to the ledger.` : "No differences — the check will be closed as approved."}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Not now
            </Button>
            <Button variant="success" disabled={isBusy("approve")} onClick={() => void approve()}>
              {isBusy("approve") ? "Posting…" : "Approve & post"}
            </Button>
          </>
        }
      >
        <Stack gap={10}>
          <DecisionFacts summary={summary} total={lines.length} />
          {driftCount ? <Alert tone="amber" title={`${driftCount} item(s) moved since counting started`}>Adjustments are the counted differences, applied on top of current stock.</Alert> : null}
        </Stack>
      </Dialog>

      <Dialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        icon={{ tone: "amber", name: "refresh" }}
        title="Send back for recount"
        description="The counter can edit counts again. Your note is added to the check."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={isBusy("reject")} onClick={() => void reject()}>
              Send back
            </Button>
          </>
        }
      >
        <Field label="What should be recounted?" hint="Optional">
          {({ id }) => <Textarea id={id} rows={3} maxLength={500} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="e.g. Recount the fans aisle — numbers look off." />}
        </Field>
      </Dialog>

      <Dialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        icon={{ tone: "coral", name: "warning" }}
        title={`Cancel ${check.checkNo}?`}
        description="No stock changes will be posted. Counts are kept for reference."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={isBusy("cancel")} onClick={() => void cancel()}>
              Cancel check
            </Button>
          </>
        }
      />

      <Dialog
        open={dialog === "print"}
        onClose={() => setDialog(null)}
        wide
        title="Print count sheet"
        actionsNote={
          <Segmented
            size="sm"
            role="radio"
            aria-label="Sheet type"
            value={blind ? "blind" : "full"}
            onChange={(v) => setBlind(v === "blind")}
            options={[
              { value: "blind", label: "Blank for counting" },
              { value: "full", label: "With counts" },
            ]}
          />
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Close
            </Button>
            <Button variant="primary" icon="printer" onClick={print}>
              Print
            </Button>
          </>
        }
      >
        {dialog === "print" ? <CountPaper check={check} lines={filtered.length ? filtered : lines} blind={blind} business={session.settings.businessName || session.brand?.name || ""} address={session.settings.address} /> : null}
      </Dialog>
    </Stack>
  );
}

function SaveIndicator({ save, pending, invalid, onRetry }: { save: { status: string; message?: string; at?: string }; pending: number; invalid: number; onRetry: () => void }) {
  if (save.status === "error") {
    return (
      <span className="ims-row" role="alert">
        <Badge tone="coral">NOT SAVED</Badge>
        <span className="ims-faint">{save.message}</span>
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  }
  if (invalid) return <Badge tone="coral">{invalid} invalid count{invalid === 1 ? "" : "s"}</Badge>;
  if (save.status === "saving") return <Badge tone="blue">Saving…</Badge>;
  if (pending) return <Badge tone="amber">Unsaved changes</Badge>;
  return <span className="ims-faint">{save.at ? `All changes saved · ${timeAgo(save.at) || "just now"}` : "Counts save automatically as you type"}</span>;
}

function SheetRow({ l, editable, onChange, onKeyDown }: { l: SheetLine; editable: boolean; onChange: (p: Partial<Edit>) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void }) {
  const counted = l.physicalQty !== null;
  const mismatch = counted && Math.abs(l.difference) > 0.0005;
  return (
    <div className={cx("ims-b-sheet-row", mismatch && "is-mismatch", counted && !mismatch && "is-match")} role="row">
      <span className="ims-cell-stack" role="cell">
        <span className="ims-strong">{l.name}</span>
        <small>
          {[l.sku, l.location, l.unit].filter(Boolean).join(" · ")}
          {l.drift ? <span className="ims-b-drift"> · now {qtyText(l.liveQty ?? 0)} in system</span> : null}
        </small>
      </span>
      <span className="ims-num" role="cell">
        {qtyText(l.systemQty)}
      </span>
      <span className="ims-b-sheet-count" role="cell">
        {editable ? (
          <>
            <Input
              size="sm"
              className="ims-count-input"
              inputMode="decimal"
              data-count=""
              aria-label={`Counted quantity of ${l.name}`}
              aria-invalid={l.invalid || undefined}
              placeholder="—"
              value={l.qtyText}
              onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "") })}
              onKeyDown={onKeyDown}
              onFocus={(e) => e.target.select()}
            />
            <Button size="sm" variant="ghost" aria-label={`Same as system for ${l.name}`} title="Same as system" onClick={() => onChange({ qty: String(l.systemQty) })}>
              =
            </Button>
          </>
        ) : (
          <span className="ims-num">{counted ? qtyText(l.physicalQty ?? 0) : "—"}</span>
        )}
      </span>
      <span role="cell" className={cx("ims-num", mismatch ? (l.difference < 0 ? "ims-diff-neg" : "ims-diff-pos") : "ims-faint")}>
        {counted ? (mismatch ? signedQty(l.difference) : "✓") : ""}
      </span>
      <span className="ims-b-sheet-note" role="cell">
        {editable ? (
          <Input size="sm" aria-label={`Note for ${l.name}`} maxLength={300} placeholder="Note" value={l.noteText} onChange={(e) => onChange({ note: e.target.value })} />
        ) : (
          <span className="ims-faint">{l.noteText || ""}</span>
        )}
      </span>
    </div>
  );
}

function DecisionFacts({ summary, total }: { summary: { counted: number; mismatches: number; shortValue: number; excessValue: number; net: number; netQty: number }; total: number }) {
  return (
    <dl className="ims-totals" style={{ justifyContent: "stretch", gridTemplateColumns: "1fr auto" }}>
      <dt>Items counted</dt>
      <dd>
        {summary.counted} / {total}
      </dd>
      <dt>Differences</dt>
      <dd>
        {summary.mismatches} ({signedQty(summary.netQty)} units)
      </dd>
      <dt>Short at cost</dt>
      <dd className="ims-neg">{inr(summary.shortValue)}</dd>
      <dt>Excess at cost</dt>
      <dd className="ims-pos">{inr(summary.excessValue)}</dd>
      <dt className="is-grand">Net variance</dt>
      <dd className="is-grand">{inr(summary.net)}</dd>
    </dl>
  );
}

function CountPaper({ check, lines, blind, business, address }: { check: CountSheet; lines: SheetLine[]; blind: boolean; business: string; address: string | null }) {
  return (
    <article className="bos-inv-paper" aria-label="Count sheet" style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{business || "Your business"}</div>
          {address ? <div className="ims-paper-seller">{address}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">Stock count sheet</div>
          <div className="ims-paper-sub">{check.checkNo}</div>
        </div>
      </div>
      <div className="ims-paper-meta">
        <div>
          <b>Title</b>
          {check.title}
        </div>
        <div>
          <b>Scope</b>
          {scopeText(check)}
        </div>
        <div>
          <b>Started</b>
          {stampLabel(check.createdAt)}
        </div>
      </div>
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>Location</th>
            {blind ? null : <th style={{ textAlign: "right" }}>System</th>}
            <th style={{ textAlign: "right", width: 90 }}>Counted</th>
            {blind ? null : <th style={{ textAlign: "right" }}>Diff</th>}
            <th style={{ width: blind ? 180 : 120 }}>Note</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.itemId}>
              <td>{i + 1}</td>
              <td>
                {l.name}
                <small>{[l.sku, l.category, l.unit].filter(Boolean).join(" · ")}</small>
              </td>
              <td>{l.location ?? ""}</td>
              {blind ? null : <td style={{ textAlign: "right" }}>{qtyText(l.systemQty)}</td>}
              <td style={{ textAlign: "right" }}>{blind || l.physicalQty === null ? "" : qtyText(l.physicalQty)}</td>
              {blind ? null : <td style={{ textAlign: "right" }}>{l.physicalQty === null ? "" : signedQty(l.difference)}</td>}
              <td>{blind ? "" : l.noteText}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ims-paper-sign">
        <div>
          <div className="ims-paper-sign-line" />
          Counted by · date
        </div>
        <div>
          <div className="ims-paper-sign-line" />
          Verified by · date
        </div>
      </div>
    </article>
  );
}

export default StockChecksModule;
