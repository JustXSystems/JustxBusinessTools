"use client";

import "./inventory-b.css";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, Field, FilterChip, Input, Pagination, SearchInput, Segmented, Select, cx, type BosColumn } from "@/components/bos";
import { ims, type ImsEvent, type ImsMovement, type MovementType, type Period } from "@/lib/ims/api";
import { imsB } from "@/lib/ims/inventory-b";
import { addDaysISO, dateLabel, dateRange, downloadCsv, downloadXlsx, inr, MOVEMENT_LABEL, PERIOD_OPTIONS, qtyText, round2, round3, signedQty, stampLabel, timeAgo, todayLocal, type ExportColumn } from "@/lib/ims/format";
import { Loaded, PageHeader, PersonAvatar, Stack, SubTabs, useIms, useImsData } from "../core";
import { ItemPickerDialog, useItemCatalog, usePartyOptions } from "../shared/pickers";
import { ENTITY_MODULE, MovementBadge, movementView, useDebounced, useInventoryMeta } from "./stock-shared";

type Tab = "movements" | "activity";
const TYPES: ReadonlyArray<MovementType> = ["IN", "OUT", "DAMAGE", "ADJUSTMENT", "RETURN_IN", "RETURN_OUT", "WRITE_OFF", "OPENING"];
const isType = (t: string): t is MovementType => (TYPES as readonly string[]).includes(t);
const PAGE = 50;

export function HistoryModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("history"));
  const [tab, setTab] = useState<Tab>(intent === "activity" || intent?.startsWith("entity:") ? "activity" : "movements");
  const [initial] = useState(() => ({
    types: intent?.startsWith("type:") ? intent.slice(5).split(",").map((t) => t.trim().toUpperCase()).filter(isType) : [],
    itemId: intent?.startsWith("item:") ? intent.slice(5) : null,
    entity: intent?.startsWith("entity:") ? intent.slice(7) : "",
  }));
  return (
    <Stack>
      <PageHeader title="Transactions & Activity" sub="Every stock movement and every change made in IMS — filter, search and export." />
      <SubTabs
        label="History"
        value={tab}
        onChange={setTab}
        options={[
          { value: "movements", label: "Stock movements" },
          { value: "activity", label: "Activity log" },
        ]}
      />
      {tab === "movements" ? <MovementsTab initialTypes={initial.types} initialItemId={initial.itemId} /> : <ActivityTab initialEntity={initial.entity} />}
    </Stack>
  );
}

/* ---------- Stock movements ---------- */

function MovementsTab({ initialTypes, initialItemId }: { initialTypes: MovementType[]; initialItemId: string | null }) {
  const { navigate } = useIms();
  const meta = useInventoryMeta();
  const catalog = useItemCatalog();
  const parties = usePartyOptions();
  const [today] = useState(() => todayLocal());
  const [period, setPeriod] = useState<Period>(initialItemId ? "fytd" : "30d");
  const [from, setFrom] = useState(() => addDaysISO(todayLocal(), -29));
  const [to, setTo] = useState(today);
  const [types, setTypes] = useState<ReadonlySet<MovementType>>(() => new Set(initialTypes));
  const [itemId, setItemId] = useState<string | null>(initialItemId);
  const [partyId, setPartyId] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [page, setPage] = useState(0);
  const dq = useDebounced(q.trim());
  const typeParam = [...types].join(",");
  const customOk = period !== "custom" || (Boolean(from) && Boolean(to) && from <= to);

  const state = useImsData(
    () =>
      imsB.movements({
        period: customOk ? period : "30d",
        from: period === "custom" && customOk ? from : undefined,
        to: period === "custom" && customOk ? to : undefined,
        type: typeParam || undefined,
        itemId: itemId ?? undefined,
        partyId: partyId || undefined,
        q: dq || undefined,
        limit: 2000,
      }),
    [period, from, to, typeParam, itemId, partyId, dq, customOk],
  );
  const canSeeCost = meta.data?.canSeeCost ?? false;
  const item = itemId ? catalog.data?.find((i) => i.id === itemId) : null;
  const resetPage = () => setPage(0);
  const toggleType = (t: MovementType) => {
    setTypes((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
    resetPage();
  };
  const filtersOn = types.size > 0 || itemId !== null || partyId !== "" || q.trim() !== "";

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
          <small>{[m.sku, m.category].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (m) => (
        <span className="ims-cell-stack" style={{ gap: 2 }}>
          <MovementBadge m={m} />
          {m.reason ? <small>{m.reason}</small> : null}
        </span>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      cell: (m) =>
        m.delta === 0 ? (
          <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
            <span className="ims-num">{qtyText(m.qty)}</span>
            <small>quarantine</small>
          </span>
        ) : (
          <span className={cx("ims-num ims-strong", m.delta > 0 ? "ims-pos" : "ims-neg")}>{signedQty(m.delta)}</span>
        ),
    },
    {
      key: "stock",
      header: "Before → after",
      align: "right",
      cell: (m) => (
        <span className="ims-num ims-muted">
          {qtyText(m.before)} → <b className={m.after < 0 ? "ims-neg" : undefined}>{qtyText(m.after, m.unit)}</b>
        </span>
      ),
    },
    ...(canSeeCost ? [{ key: "value", header: "Value", align: "right" as const, cell: (m: ImsMovement) => <span className="ims-num">{inr(m.value)}</span> }] : []),
    {
      key: "party",
      header: "Party / ref",
      cell: (m) => (
        <span className="ims-cell-stack">
          <span>{m.partyName ?? "—"}</span>
          <small>{[m.refNo, m.refType !== "manual" ? m.refType.toUpperCase() : null].filter(Boolean).join(" · ")}</small>
        </span>
      ),
    },
    { key: "by", header: "By", cell: (m) => <span className="ims-muted">{m.actorName ?? "—"}</span> },
  ];

  const exportCols: ReadonlyArray<ExportColumn<ImsMovement>> = [
    { header: "Date", value: (m) => m.date },
    { header: "Recorded at", value: (m) => m.createdAt },
    { header: "Item", value: (m) => m.itemName },
    { header: "SKU", value: (m) => m.sku },
    { header: "Category", value: (m) => m.category },
    { header: "Type", value: (m) => movementView(m).text },
    { header: "Qty", value: (m) => m.qty },
    { header: "Change", value: (m) => m.delta },
    { header: "Before", value: (m) => m.before },
    { header: "After", value: (m) => m.after },
    { header: "Unit", value: (m) => m.unit },
    ...(canSeeCost
      ? [
          { header: "Unit cost", value: (m: ImsMovement) => m.unitCost },
          { header: "Unit price", value: (m: ImsMovement) => m.unitPrice },
          { header: "Value", value: (m: ImsMovement) => m.value },
        ]
      : []),
    { header: "Party", value: (m) => m.partyName },
    { header: "Reference", value: (m) => m.refNo },
    { header: "Source", value: (m) => m.refType },
    { header: "Reason", value: (m) => m.reason },
    { header: "Notes", value: (m) => m.notes },
    { header: "By", value: (m) => m.actorName },
  ];

  return (
    <Stack gap={16}>
      <Card interactive={false}>
        <Stack gap={12}>
          <div className="ims-between">
            <Segmented
              size="sm"
              role="radio"
              scroll
              aria-label="Period"
              value={period}
              onChange={(p) => {
                setPeriod(p);
                resetPage();
              }}
              options={[...PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label })), { value: "custom" as Period, label: "Custom" }]}
            />
            {period === "custom" ? (
              <span className="ims-row">
                <Field label="From" error={!customOk ? "Start must be before end" : null}>
                  {({ id }) => <Input id={id} size="sm" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />}
                </Field>
                <Field label="To">{({ id }) => <Input id={id} size="sm" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              </span>
            ) : null}
          </div>
          <div className="ims-b-filters" role="group" aria-label="Movement types">
            <FilterChip
              active={types.size === 0}
              onClick={() => {
                setTypes(new Set());
                resetPage();
              }}
            >
              All types
            </FilterChip>
            {TYPES.map((t) => (
              <FilterChip key={t} active={types.has(t)} onClick={() => toggleType(t)}>
                {MOVEMENT_LABEL[t]}
              </FilterChip>
            ))}
          </div>
          <div className="ims-toolbar" style={{ marginBottom: 0 }}>
            <SearchInput
              wrapperClassName="ims-grow"
              placeholder="Search item, reference, party, reason, person…"
              aria-label="Search movements"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                resetPage();
              }}
            />
            {itemId ? (
              <FilterChip active onClick={() => setItemId(null)} aria-label="Clear item filter">
                {item?.name ?? "Selected item"} ✕
              </FilterChip>
            ) : (
              <Button size="sm" icon="box" onClick={() => setPicking(true)}>
                Item
              </Button>
            )}
            {parties.data?.length ? (
              <Select
                size="sm"
                aria-label="Party"
                value={partyId}
                style={{ maxWidth: 220 }}
                onChange={(e) => {
                  setPartyId(e.target.value);
                  resetPage();
                }}
              >
                <option value="">All parties</option>
                {parties.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {filtersOn ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTypes(new Set());
                  setItemId(null);
                  setPartyId("");
                  setQ("");
                  resetPage();
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </Stack>
      </Card>

      <Loaded state={state}>
        {(d) => {
          const rows = d.movements;
          const pages = Math.max(1, Math.ceil(rows.length / PAGE));
          const current = Math.min(page, pages - 1);
          const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
          const totals = TYPES.flatMap((t) => (d.totals[t] ? [{ t, ...d.totals[t] }] : []));
          const net = round3(totals.reduce((s, t) => s + (t.delta ?? 0), 0));
          const file = `stock-movements-${d.range.from}-to-${d.range.to}`;
          return (
            <Card interactive={false}>
              <div className="ims-between" style={{ marginBottom: 12 }}>
                <span className="ims-muted" style={{ fontSize: 13 }}>
                  {dateRange(d.range.from, d.range.to)} · {d.count ?? rows.length} movement{(d.count ?? rows.length) === 1 ? "" : "s"}
                  {totals.some((t) => t.delta !== undefined) ? ` · net ${signedQty(net)} units` : ""}
                </span>
                <span className="ims-row">
                  <Button size="sm" icon="download" disabled={!rows.length} onClick={() => downloadCsv(file, rows, exportCols)}>
                    CSV
                  </Button>
                  <Button size="sm" icon="file" disabled={!rows.length} onClick={() => void downloadXlsx(file, "Movements", rows, exportCols)}>
                    Excel
                  </Button>
                </span>
              </div>
              {totals.length ? (
                <div className="ims-b-totals" style={{ marginTop: 0, marginBottom: 14 }} aria-label="Totals by type">
                  {totals.map((t) => (
                    <button
                      key={t.t}
                      type="button"
                      className={cx("ims-b-total", "ims-pick-row")}
                      style={{ display: "flex", textAlign: "left" }}
                      aria-pressed={types.has(t.t)}
                      onClick={() => {
                        setTypes(new Set([t.t]));
                        resetPage();
                      }}
                    >
                      <span className="ims-muted">
                        {MOVEMENT_LABEL[t.t]} · {t.count}
                      </span>
                      <b>{t.delta !== undefined && t.delta !== 0 ? signedQty(t.delta) : qtyText(t.qty)} units</b>
                      {canSeeCost ? <span className="ims-faint">{inr(round2(t.value))}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <DataTable
                columns={columns}
                rows={shown}
                rowKey={(m) => m.id}
                onRowClick={(m) => navigate("items", `open:${m.itemId}`)}
                caption="Stock movements"
                empty={
                  <EmptyState icon="clock" title="No movements">
                    {filtersOn ? "Nothing matches these filters in this period." : "Stock in, out, damage, adjustments and returns will appear here."}
                  </EmptyState>
                }
              />
              {rows.length > PAGE || d.truncated ? (
                <Pagination
                  actions={
                    rows.length > PAGE ? (
                      <>
                        <Button size="sm" iconOnly icon="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" />
                        <Button size="sm" iconOnly icon="chevronRight" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page" />
                      </>
                    ) : undefined
                  }
                >
                  {current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of {rows.length}
                  {d.truncated ? ` (latest ${rows.length} of ${d.count} — narrow the period or filters)` : ""}
                </Pagination>
              ) : null}
            </Card>
          );
        }}
      </Loaded>
      <ItemPickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        title="Filter by item"
        onPick={(it) => {
          setItemId(it.id);
          setPicking(false);
          resetPage();
        }}
      />
    </Stack>
  );
}

/* ---------- Activity log ---------- */

const ENTITY_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Everything" },
  { value: "item", label: "Items" },
  { value: "movement", label: "Stock" },
  { value: "check", label: "Stock checks" },
  { value: "return", label: "Returns" },
  { value: "po", label: "Purchase orders" },
  { value: "invoice", label: "Invoices" },
  { value: "bill", label: "Bills" },
  { value: "party", label: "Parties" },
  { value: "settings", label: "Settings" },
];

function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDaysISO(today, -1)) return "Yesterday";
  return dateLabel(day);
}

function ActivityTab({ initialEntity }: { initialEntity: string }) {
  const { navigate } = useIms();
  const [today] = useState(() => todayLocal());
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(() => addDaysISO(todayLocal(), -29));
  const [to, setTo] = useState(today);
  const [entity, setEntity] = useState(initialEntity);
  const [limit, setLimit] = useState(200);
  const dq = useDebounced(q.trim());
  const rangeOk = !from || !to || from <= to;
  const state = useImsData(() => ims.events({ q: dq || undefined, from: rangeOk ? from || undefined : undefined, to: rangeOk ? to || undefined : undefined, entityType: entity || undefined, limit }), [dq, from, to, entity, limit, rangeOk]);

  const exportCols: ReadonlyArray<ExportColumn<ImsEvent>> = [
    { header: "When", value: (e) => e.createdAt },
    { header: "Who", value: (e) => e.actorName },
    { header: "Event", value: (e) => e.type },
    { header: "Entity", value: (e) => e.entityType },
    { header: "Entity id", value: (e) => e.entityId },
    { header: "Summary", value: (e) => e.summary },
  ];

  return (
    <Stack gap={16}>
      <Card interactive={false}>
        <Stack gap={12}>
          <div className="ims-toolbar" style={{ marginBottom: 0 }}>
            <SearchInput wrapperClassName="ims-grow" placeholder="Search what happened or who did it…" aria-label="Search activity" value={q} onChange={(e) => setQ(e.target.value)} />
            <Field label="From" error={!rangeOk ? "Start must be before end" : null}>
              {({ id }) => <Input id={id} size="sm" type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label="To">{({ id }) => <Input id={id} size="sm" type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
          <div className="ims-b-filters" role="group" aria-label="Activity type">
            {ENTITY_FILTERS.map((f) => (
              <FilterChip key={f.value || "all"} active={entity === f.value} onClick={() => setEntity(f.value)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
        </Stack>
      </Card>
      <Loaded state={state}>
        {(d) => {
          const days = new Map<string, ImsEvent[]>();
          for (const e of d.events) {
            const k = String(e.createdAt ?? "").slice(0, 10) || "—";
            const list = days.get(k);
            if (list) list.push(e);
            else days.set(k, [e]);
          }
          return (
            <Card interactive={false}>
              <div className="ims-between" style={{ marginBottom: 4 }}>
                <span className="ims-muted" style={{ fontSize: 13 }}>
                  {d.events.length} event{d.events.length === 1 ? "" : "s"}
                  {d.events.length >= limit ? " (latest)" : ""}
                </span>
                <Button size="sm" icon="download" disabled={!d.events.length} onClick={() => downloadCsv(`ims-activity-${from || "all"}-to-${to || today}`, d.events, exportCols)}>
                  CSV
                </Button>
              </div>
              {d.events.length ? (
                <div className="ims-b-feed">
                  {[...days.entries()].map(([day, events]) => (
                    <section key={day} aria-label={dayTitle(day, today)}>
                      <div className="ims-b-feed-day">{dayTitle(day, today)}</div>
                      {events.map((e) => {
                        const target = e.entityType ? ENTITY_MODULE[e.entityType] : undefined;
                        const linkable = target && e.entityId && !["bulk", "batch"].includes(e.entityId);
                        return (
                          <div key={e.id} className="ims-b-feed-row">
                            <PersonAvatar name={e.actorName} />
                            <div style={{ minWidth: 0 }}>
                              <div className="ims-b-feed-summary">{e.summary}</div>
                              <div className="ims-b-feed-meta">
                                {e.actorName ?? "System"} · {stampLabel(e.createdAt)} · {e.type}
                              </div>
                            </div>
                            <div className="ims-cell-stack" style={{ alignItems: "flex-end", gap: 4 }}>
                              <span className="ims-faint">{timeAgo(e.createdAt)}</span>
                              {linkable && target ? (
                                <button type="button" className="ims-b-link" style={{ fontSize: 12.5 }} onClick={() => navigate(target, `open:${e.entityId}`)}>
                                  Open
                                </button>
                              ) : e.entityType === "movement" ? (
                                <span className="ims-faint">Stock</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyState icon="clock" title="No activity">
                  {q || entity ? "Nothing matches these filters." : "Changes made in IMS appear here."}
                </EmptyState>
              )}
              {d.events.length >= limit && limit < 500 ? (
                <div className="ims-row" style={{ justifyContent: "center", marginTop: 12 }}>
                  <Button size="sm" onClick={() => setLimit(500)}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </Card>
          );
        }}
      </Loaded>
    </Stack>
  );
}
