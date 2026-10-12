"use client";

import "./purchase.css";
import { useState } from "react";
import { Badge, Button, DataTable, Dialog, EmptyState, type BosColumn } from "@/components/bos";
import { dateLabel, inr, inrExact, MOVEMENT_LABEL, qtyText, stockBadge } from "@/lib/ims/format";
import type { MovementType } from "@/lib/ims/api";
import { purchase, type Party, type PartyDetail as Detail } from "@/lib/ims/purchase";
import { Loaded, PersonAvatar, StatusBadge, SubTabs, useIms, useImsData } from "../core";
import { KeyValues, KindBadge, MiniStats, PoStatusBadge, Timeline } from "./ui";

type Tab = "overview" | "items" | "pos" | "docs" | "activity";

export function PartyDetailDialog({ partyId, onClose, onEdit }: { partyId: string | null; onClose: () => void; onEdit: (p: Party) => void }) {
  return (
    <Dialog open={partyId !== null} onClose={onClose} wide title={partyId ? "Party details" : ""} actions={<Button onClick={onClose}>Close</Button>}>
      {partyId ? <DetailBody key={partyId} partyId={partyId} onEdit={onEdit} onClose={onClose} /> : null}
    </Dialog>
  );
}

function DetailBody({ partyId, onEdit, onClose }: { partyId: string; onEdit: (p: Party) => void; onClose: () => void }) {
  const state = useImsData(() => purchase.party(partyId), [partyId]);
  return (
    <div className="ims-xl">
      <Loaded state={state} rows={2}>
        {(d) => <DetailView d={d} onEdit={onEdit} onClose={onClose} />}
      </Loaded>
    </div>
  );
}

function DetailView({ d, onEdit, onClose }: { d: Detail; onEdit: (p: Party) => void; onClose: () => void }) {
  const { can, navigate } = useIms();
  const p = d.party;
  const isSupplier = p.kind !== "customer";
  const isCustomer = p.kind !== "supplier";
  const [tab, setTab] = useState<Tab>("overview");
  const go = (module: "purchase" | "sales" | "payables", intent: string) => {
    onClose();
    navigate(module, intent);
  };
  const low = d.items.filter((i) => i.status === "LOW" || i.status === "OUT_OF_STOCK").length;
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "overview", label: "Overview" },
    ...(isSupplier ? [{ value: "items" as const, label: `Items supplied · ${d.items.length}` }, { value: "pos" as const, label: `Purchase orders · ${d.purchaseOrders.length}` }] : []),
    { value: "docs", label: isSupplier && isCustomer ? "Invoices & bills" : isSupplier ? "Bills" : "Invoices" },
    { value: "activity", label: "Activity" },
  ];

  const itemCols: BosColumn<Detail["items"][number]>[] = [
    { key: "name", header: "Item", cell: (i) => <span className="ims-cell-stack"><span className="ims-strong">{i.name}</span><small>{i.sku ?? "—"}</small></span> },
    { key: "stock", header: "In stock", align: "right", cell: (i) => qtyText(i.currentStock, i.unit) },
    { key: "min", header: "Min", align: "right", cell: (i) => qtyText(i.minStock) },
    { key: "price", header: "Buy price", align: "right", cell: (i) => inrExact(i.purchasePrice) },
    { key: "status", header: "Status", cell: (i) => <StatusBadge view={stockBadge(i.status)} /> },
  ];

  return (
    <div>
      <div className="ims-detail-head">
        <PersonAvatar name={p.name} size="lg" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="ims-row">
            <span className="ims-detail-title">{p.name}</span>
            <KindBadge kind={p.kind} />
            {!p.active ? <Badge tone="neutral">ARCHIVED</Badge> : null}
          </div>
          <div className="ims-detail-sub">{[p.contactPerson, p.mobile, p.email, p.city].filter(Boolean).join(" · ") || "No contact details yet"}</div>
          {p.tags.length ? (
            <div className="ims-row" style={{ marginTop: 6 }}>
              {p.tags.map((t) => (
                <Badge key={t} tag="sage" auto>
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ims-row" style={{ justifyContent: "flex-end" }}>
          {can("suppliers") ? (
            <Button size="sm" icon="edit" onClick={() => onEdit(p)}>
              Edit
            </Button>
          ) : null}
          {isSupplier && can("po") && p.active ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => go("purchase", `new:${p.id}`)}>
              New PO
            </Button>
          ) : null}
        </div>
      </div>

      <MiniStats
        stats={[
          ...(isSupplier ? [{ label: "Open POs", value: `${p.stats.openPoCount} · ${inr(p.stats.openPoValue)}` }, { label: "We owe", value: inr(p.stats.payable), tone: p.stats.payable > 0 ? ("coral" as const) : undefined }] : []),
          ...(isCustomer ? [{ label: "They owe", value: inr(p.stats.receivable), tone: p.stats.receivable > 0 ? ("amber" as const) : undefined }] : []),
          { label: "Net balance", value: p.stats.netBalance === 0 ? "Settled" : `${inr(Math.abs(p.stats.netBalance))} ${p.stats.netBalance > 0 ? "due to us" : "we owe"}` },
          ...(isSupplier ? [{ label: "Last purchase", value: p.stats.lastPurchaseDate ? dateLabel(p.stats.lastPurchaseDate) : "—" }] : []),
        ]}
      />

      <SubTabs value={tab} onChange={setTab} options={tabs} label="Party sections" />

      {tab === "overview" ? (
        <KeyValues
          rows={[
            ["GSTIN", p.gstin ? <span className="bos-code">{p.gstin}</span> : "Unregistered"],
            ["PAN", p.pan],
            ["State", p.state ? `${p.state}${p.stateCode ? ` (${p.stateCode})` : ""}` : null],
            ["Address", [p.address, p.city].filter(Boolean).join(", ")],
            ["Payment terms", p.paymentTermsDays == null ? "Default (Settings)" : p.paymentTermsDays === 0 ? "Immediate" : `${p.paymentTermsDays} days`],
            ["Credit limit", p.creditLimit == null ? null : inr(p.creditLimit)],
            ["Opening balance", p.openingBalance ? `${inr(Math.abs(p.openingBalance))} ${p.openingBalance > 0 ? "(they owe us)" : "(we owe them)"}` : "None"],
            ["Account manager", p.accountManagerName],
            ["Notes", p.notes],
          ]}
        />
      ) : null}

      {tab === "items" ? (
        d.items.length ? (
          <>
            {low && can("po") ? (
              <div className="ims-between" style={{ marginBottom: 10 }}>
                <span className="ims-muted">{low} item{low === 1 ? "" : "s"} at or below minimum stock.</span>
                <Button size="sm" onClick={() => go("purchase", `reorder:${p.id}`)}>
                  Draft restock PO
                </Button>
              </div>
            ) : null}
            <DataTable caption="Items supplied" columns={itemCols} rows={d.items} rowKey={(i) => i.id} compact />
          </>
        ) : (
          <EmptyState icon="box" title="No items linked yet">
            Set this supplier as the preferred supplier on items (Items → edit) to see them here and draft restock POs.
          </EmptyState>
        )
      ) : null}

      {tab === "pos" ? (
        d.purchaseOrders.length ? (
          <div className="ims-list" role="list">
            {d.purchaseOrders.map((po) => (
              <button key={po.id} type="button" role="listitem" className="ims-list-row" onClick={() => go("purchase", `open:${po.id}`)}>
                <span className="ims-cell-stack">
                  <span className="ims-strong">{po.poNo}</span>
                  <small>
                    {dateLabel(po.orderDate)} · {po.lineCount} line{po.lineCount === 1 ? "" : "s"}
                    {po.expectedDate ? ` · due ${dateLabel(po.expectedDate)}` : ""}
                  </small>
                </span>
                <span className="ims-row">
                  <span className="ims-num ims-strong">{inr(po.grandTotal)}</span>
                  <PoStatusBadge status={po.status} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon="file" title="No purchase orders yet" actions={can("po") && p.active ? <Button size="sm" variant="primary" onClick={() => go("purchase", `new:${p.id}`)}>Raise a PO</Button> : undefined} />
        )
      ) : null}

      {tab === "docs" ? (
        <div className="bos-stack" style={{ gap: 18 }}>
          {isCustomer ? (
            <div>
              <h4 className="ims-form-section-title">Sales invoices</h4>
              {d.invoices.length ? (
                <div className="ims-list" role="list">
                  {d.invoices.map((inv) => (
                    <div key={inv.id} role="listitem" className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span className="ims-strong">{inv.invoiceNo}</span>
                        <small>
                          {dateLabel(inv.invoiceDate)}
                          {inv.dueDate ? ` · due ${dateLabel(inv.dueDate)}` : ""} · {inv.status}
                        </small>
                      </span>
                      <span className="ims-cell-stack" style={{ textAlign: "right" }}>
                        <span className="ims-num ims-strong">{inr(inv.grandTotal)}</span>
                        <small>{inv.status === "issued" ? `Balance ${inr(Math.max(0, inv.grandTotal - inv.amountPaid))}` : " "}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ims-faint">No invoices yet.</p>
              )}
            </div>
          ) : null}
          {isSupplier ? (
            <div>
              <h4 className="ims-form-section-title">Supplier bills</h4>
              {d.bills.length ? (
                <div className="ims-list" role="list">
                  {d.bills.map((b) => (
                    <div key={b.id} role="listitem" className="ims-list-row">
                      <span className="ims-cell-stack">
                        <span className="ims-strong">
                          {b.billNo}
                          {b.supplierBillNo ? <span className="ims-faint"> · their #{b.supplierBillNo}</span> : null}
                        </span>
                        <small>
                          {dateLabel(b.billDate)}
                          {b.dueDate ? ` · due ${dateLabel(b.dueDate)}` : ""}
                          {b.poNo ? ` · ${b.poNo}` : ""} · {b.status.replace(/_/g, " ")}
                        </small>
                      </span>
                      <span className="ims-cell-stack" style={{ textAlign: "right" }}>
                        <span className="ims-num ims-strong">{inr(b.grandTotal)}</span>
                        <small>{b.status !== "cancelled" ? `Balance ${inr(Math.max(0, b.grandTotal - b.amountPaid))}` : " "}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ims-faint">No bills yet — bills are created automatically when PO goods are received.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="bos-stack" style={{ gap: 18 }}>
          <div>
            <h4 className="ims-form-section-title">Stock movements</h4>
            {d.movements.length ? (
              <div className="ims-list" role="list">
                {d.movements.map((m) => (
                  <div key={m.id} role="listitem" className="ims-list-row">
                    <span className="ims-cell-stack">
                      <span className="ims-strong">{m.itemName}</span>
                      <small>
                        {MOVEMENT_LABEL[m.type as MovementType] ?? m.type} · {dateLabel(m.date)}
                        {m.refNo ? ` · ${m.refNo}` : ""}
                        {m.actorName ? ` · ${m.actorName}` : ""}
                      </small>
                    </span>
                    <span className="ims-cell-stack" style={{ textAlign: "right" }}>
                      <span className="ims-num ims-strong">{qtyText(m.qty)}</span>
                      <small>{inr(m.value)}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ims-faint">No stock movements with this party yet.</p>
            )}
          </div>
          <div>
            <h4 className="ims-form-section-title">Record history</h4>
            <Timeline entityType="party" entityId={p.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
