"use client";

import "./inventory-a.css";

import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, DataTable, Dialog, KpiCard, Skeleton, useToast, type BosColumn, type BosKpi } from "@/components/bos";
import { ims, type AgingKey, type ImsItem, type ImsMovement, type MovementType } from "@/lib/ims/api";
import { AGING_BUCKETS, MOVEMENT_LABEL, dateLabel, inr, inrExact, movementBadge, pct, qtyText, signedQty, stampLabel, stockBadge, timeAgo, toneFor } from "@/lib/ims/format";
import { isEan13, scanCodeOf } from "@/lib/ims/inventory-a";
import { ErrorBlock, StatusBadge, useIms, useImsAction, useImsData } from "../core";

/* ---------- Shared bits for the inventory screens ---------- */

export function useInventoryMeta() {
  return useImsData(() => ims.inventoryMeta(), []);
}

export type InventoryMeta = Awaited<ReturnType<typeof ims.inventoryMeta>>;

const initialsOfItem = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

export function ItemAvatar({ item, size = 34 }: { item: Pick<ImsItem, "name" | "category">; size?: number }) {
  return (
    <span className="ims-inv-avatar" style={{ width: size, height: size, background: toneFor(item.category || item.name), fontSize: size > 40 ? 15 : 12 }} aria-hidden="true">
      {initialsOfItem(item.name)}
    </span>
  );
}

export function ItemCell({ item, sub }: { item: Pick<ImsItem, "name" | "category" | "sku" | "barcode" | "active">; sub?: ReactNode }) {
  return (
    <span className="ims-inv-item">
      <ItemAvatar item={item} />
      <span className="ims-cell-stack">
        <span className="ims-strong">
          {item.name}
          {item.active === false ? (
            <>
              {" "}
              <Badge tone="neutral" auto>
                ARCHIVED
              </Badge>
            </>
          ) : null}
        </span>
        <small>{sub ?? ([item.sku, item.barcode && item.barcode !== item.sku ? item.barcode : null].filter(Boolean).join(" · ") || "No SKU")}</small>
      </span>
    </span>
  );
}

export function agingOf(key: AgingKey) {
  return AGING_BUCKETS.find((b) => b.key === key) ?? AGING_BUCKETS[0];
}

export function AgingChip({ bucket, days }: { bucket: AgingKey; days?: number }) {
  const b = agingOf(bucket);
  return (
    <span className="ims-inv-aging" style={{ color: b.color }} title={days !== undefined ? `${days} days since last movement` : undefined}>
      {b.label}
    </span>
  );
}

/** KPI card that opens a module; plain card when there's nowhere to go. */
export function KpiLink({ onClick, ...kpi }: BosKpi & { onClick?: () => void }) {
  if (!onClick) return <KpiCard {...kpi} interactive={false} />;
  return (
    <button type="button" className="ims-kpi-btn" onClick={onClick}>
      <KpiCard {...kpi} />
    </button>
  );
}

const REDUCES: ReadonlySet<MovementType> = new Set(["OUT", "DAMAGE", "RETURN_OUT", "WRITE_OFF"]);

/** Signed delta for a movement row (server `delta` when present). */
export const movementDelta = (m: { type: MovementType; qty: number; delta?: number }) => (m.delta !== undefined ? m.delta : REDUCES.has(m.type) ? -m.qty : m.qty);

/* ---------- Item detail ---------- */

const STAT_ORDER: ReadonlyArray<MovementType> = ["OPENING", "IN", "OUT", "RETURN_IN", "RETURN_OUT", "DAMAGE", "WRITE_OFF", "ADJUSTMENT"];

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "coral" | "amber" | "emerald" }) {
  return (
    <div className="ims-inv-tile">
      <small>{label}</small>
      <b style={tone ? { color: `var(--bos-${tone}-600)` } : undefined}>{value}</b>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

/**
 * Item record: stock card, pricing, 90-day flow and the last 100 movements,
 * with shortcuts into stock in / out / damage.
 */
export function ItemDetailDialog({
  itemId,
  onClose,
  onEdit,
  onPrintLabel,
  canSeeCost = true,
}: {
  itemId: string | null;
  onClose: () => void;
  onEdit?: (item: ImsItem) => void;
  onPrintLabel?: (item: ImsItem) => void;
  canSeeCost?: boolean;
}) {
  const { can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const { show } = useToast();
  const [confirming, setConfirming] = useState(false);
  const state = useImsData(() => (itemId ? ims.item(itemId) : Promise.resolve(null)), [itemId]);
  const data = state.data && itemId && state.data.item.id === itemId ? state.data : null;
  const item = data?.item ?? null;

  const close = () => {
    setConfirming(false);
    onClose();
  };
  const go = (module: "stockin" | "stockout" | "returns") => {
    if (!item) return;
    close();
    navigate(module, `item:${item.id}`);
  };
  const remove = async () => {
    if (!item) return;
    const out = await run("delete", async () => ({ res: await ims.deleteItem(item.id) }));
    setConfirming(false);
    if (!out) return;
    show({ tone: "emerald", title: out.res?.archived ? `${item.name} archived` : `${item.name} deleted`, description: out.res?.archived ? "It has stock history, so it's kept for reports and can be restored." : undefined });
    if (!out.res?.archived) onClose();
  };
  const restore = () => item && run("restore", () => ims.updateItem(item.id, { active: true }), { success: `${item.name} restored` });

  const movementCols: BosColumn<ImsMovement>[] = [
    { key: "date", header: "Date", mono: true, cell: (m) => <span title={stampLabel(m.createdAt)}>{dateLabel(m.date)}</span> },
    { key: "type", header: "Type", cell: (m) => <StatusBadge view={movementBadge(m.type)} auto /> },
    { key: "qty", header: "Qty", align: "right", cell: (m) => <span className={m.delta >= 0 ? "ims-pos ims-strong" : "ims-neg ims-strong"}>{signedQty(m.delta)}</span> },
    { key: "after", header: "Balance", align: "right", cell: (m) => qtyText(m.after) },
    {
      key: "ref",
      header: "Reference",
      cell: (m) => (
        <span className="ims-cell-stack">
          <span>{m.refNo || m.reason || "—"}</span>
          {m.partyName ? <small>{m.partyName}</small> : null}
        </span>
      ),
    },
    { key: "by", header: "By", cell: (m) => <span className="ims-faint">{m.actorName ?? "—"}</span> },
  ];

  const margin = item && item.sellingPrice > 0 ? ((item.sellingPrice - item.purchasePrice) / item.sellingPrice) * 100 : null;
  const stats = data
    ? STAT_ORDER.flatMap((t) => {
        const s = data.stats90d[t];
        return s ? [[t, s] as const] : [];
      })
    : [];

  return (
    <Dialog
      open={itemId !== null}
      onClose={close}
      title={item ? item.name : "Item"}
      description={item ? [item.category, item.brand, item.supplierName].filter(Boolean).join(" · ") || "Item details" : undefined}
      actions={
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      <div className="ims-inv-xl">
        {!data ? (
          state.error ? (
            <ErrorBlock error={state.error} onRetry={state.reload} />
          ) : (
            <div aria-busy="true" aria-label="Loading item">
              <Skeleton height={60} />
              <Skeleton height={140} style={{ marginTop: 12 }} />
            </div>
          )
        ) : item ? (
          <>
            <div className="ims-between" style={{ marginBottom: 14 }}>
              <span className="ims-row">
                <ItemAvatar item={item} size={44} />
                <span className="ims-cell-stack">
                  <span className="ims-row" style={{ gap: 6 }}>
                    <StatusBadge view={stockBadge(item.status)} />
                    {item.active ? null : <Badge tone="neutral">ARCHIVED</Badge>}
                  </span>
                  <small>
                    {item.sku ? `SKU ${item.sku}` : "No SKU"}
                    {item.barcode ? ` · ${isEan13(item.barcode) ? "EAN" : "Code"} ${item.barcode}` : ""}
                  </small>
                </span>
              </span>
              <div className="ims-inv-actions">
                {item.active && can("stockIn") ? (
                  <Button size="sm" variant="success" onClick={() => go("stockin")}>
                    ⬇ Stock in
                  </Button>
                ) : null}
                {item.active && can("stockOut") ? (
                  <Button size="sm" onClick={() => go("stockout")}>
                    ⬆ Stock out
                  </Button>
                ) : null}
                {item.active && can("damage") ? (
                  <Button size="sm" variant="ghost" onClick={() => go("returns")}>
                    🔧 Damage
                  </Button>
                ) : null}
                {onPrintLabel ? (
                  <Button size="sm" variant="ghost" icon="printer" onClick={() => onPrintLabel(item)}>
                    Label
                  </Button>
                ) : null}
                {can("items") && onEdit ? (
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(item)}>
                    Edit
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="ims-inv-tiles">
              <Tile label="In stock" value={qtyText(item.currentStock, item.unit)} tone={item.status === "OUT_OF_STOCK" ? "coral" : item.status === "LOW" ? "amber" : undefined} sub={`Min ${qtyText(item.minStock)}${item.maxStock != null ? ` · Max ${qtyText(item.maxStock)}` : ""}`} />
              <Tile label="Damaged" value={qtyText(item.damagedStock, item.unit)} tone={item.damagedStock > 0 ? "coral" : undefined} sub="Quarantined, not saleable" />
              <Tile label="Reorder" value={item.suggestedReorder > 0 ? qtyText(item.suggestedReorder, item.unit) : "—"} sub={item.reorderQty ? `Fixed lot ${qtyText(item.reorderQty)}` : "Suggested quantity"} />
              {canSeeCost ? <Tile label="Stock value" value={inr(item.stockValue)} sub={`At cost ${inrExact(item.purchasePrice)}`} /> : null}
              <Tile label="Idle" value={`${item.idleDays} d`} sub={<AgingChip bucket={item.agingBucket} days={item.idleDays} />} />
              <Tile label="Out · 30 days" value={qtyText(item.movement30d, item.unit)} sub={item.lastMovementAt ? `Last moved ${timeAgo(item.lastMovementAt)}` : "No movement yet"} />
            </div>

            <div className="ims-inv-subhead">Pricing &amp; tax</div>
            <dl className="ims-inv-kv">
              {canSeeCost ? (
                <div>
                  <dt>Purchase price</dt>
                  <dd>{inrExact(item.purchasePrice)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Selling price</dt>
                <dd>{inrExact(item.sellingPrice)}</dd>
              </div>
              <div>
                <dt>MRP</dt>
                <dd>{item.mrp != null ? inrExact(item.mrp) : "—"}</dd>
              </div>
              {canSeeCost ? (
                <div>
                  <dt>Margin</dt>
                  <dd className={margin !== null && margin < 0 ? "ims-neg" : undefined}>{margin === null ? "—" : pct(margin, 1)}</dd>
                </div>
              ) : null}
              <div>
                <dt>HSN / SAC</dt>
                <dd>{item.hsn ?? "—"}</dd>
              </div>
              <div>
                <dt>GST</dt>
                <dd>{pct(item.gstRate, item.gstRate % 1 ? 2 : 0)}</dd>
              </div>
              <div>
                <dt>Unit</dt>
                <dd>{item.unit}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{item.location ?? "—"}</dd>
              </div>
              <div>
                <dt>Supplier</dt>
                <dd>{item.supplierName ?? "—"}</dd>
              </div>
              <div>
                <dt>Scan code</dt>
                <dd className="bos-code">{scanCodeOf(item)}</dd>
              </div>
              {item.volumeMl ? (
                <div>
                  <dt>Volume</dt>
                  <dd>{item.volumeMl} ml</dd>
                </div>
              ) : null}
              {item.exciseCategory ? (
                <div>
                  <dt>Excise category</dt>
                  <dd>{item.exciseCategory}</dd>
                </div>
              ) : null}
              <div>
                <dt>Added</dt>
                <dd>{stampLabel(item.createdAt)}</dd>
              </div>
            </dl>
            {item.notes ? <p className="ims-faint" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{item.notes}</p> : null}

            <div className="ims-inv-subhead">Last 90 days</div>
            {stats.length ? (
              <div className="ims-inv-strip">
                {stats.map(([t, s]) => (
                  <span key={t} className="ims-inv-pill">
                    {MOVEMENT_LABEL[t]} <b>{qtyText(s.qty, item.unit)}</b>
                    {canSeeCost && s.value ? <span>· {inr(s.value)}</span> : null}
                  </span>
                ))}
              </div>
            ) : (
              <p className="ims-faint">No stock movement in the last 90 days.</p>
            )}

            <div className="ims-inv-subhead">Movements {data.movements.length ? `(last ${data.movements.length})` : ""}</div>
            <div className="ims-inv-scroll">
              <DataTable compact columns={movementCols} rows={data.movements} rowKey={(m) => m.id} caption={`Stock movements for ${item.name}`} empty="No movements recorded yet." />
            </div>

            {can("items") ? (
              <div style={{ marginTop: 16 }}>
                {!item.active ? (
                  <Button size="sm" variant="secondary" onClick={restore} disabled={busy === "restore"}>
                    ↺ Restore item
                  </Button>
                ) : confirming ? (
                  <Alert
                    tone="coral"
                    title={`Remove ${item.name}?`}
                    actions={
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                          Cancel
                        </Button>
                        <Button size="sm" variant="destructive" onClick={remove} disabled={busy === "delete"}>
                          {busy === "delete" ? "Removing…" : "Remove"}
                        </Button>
                      </>
                    }
                  >
                    Items with stock or history are archived (kept for reports, restorable). Unused items are deleted permanently.
                  </Alert>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
                    Archive / delete item
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
