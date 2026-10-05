"use client";

import { useState } from "react";
import {
  Alert,
  Badge,
  BlockLabel,
  BosIcon,
  Button,
  DataTable,
  Field,
  FormGrid,
  Input,
  ModuleToolbar,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  Switch,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import { bos, type BosItem, type ItemInput, type PosBill, type PosMethod } from "@/lib/bos-app/api";
import { computeGstTotals, dateLabel, inr, inrExact, invoiceBadge, POS_METHOD_LABEL, posChange, todayLocal, type GstTotals } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";
import { InvoicePaper } from "./Invoices";

const METHODS: ReadonlyArray<PosMethod> = ["cash", "upi", "card"];
const time = (ts: string) => new Date(ts.replace(" ", "T")).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/* ---------- POS counter ---------- */

type CartLine = { key: string; description: string; hsn: string | null; unit: string | null; rate: number; taxRate: number; quantity: number };
type Receipt = { invoiceId: string; invoiceNo: string; partyName: string; partyGstin: string | null; totals: GstTotals; method: PosMethod; change: number | null };

let cartSeq = 0;
const cartKey = () => `cart-${++cartSeq}`;
const asLine = (l: CartLine) => ({ description: l.description, hsn: l.hsn, unit: l.unit, quantity: l.quantity, rate: l.rate, taxRate: l.taxRate });

/** Counter billing: tap products into a cart, take payment, print the receipt. Each bill is a paid GST invoice. */
export function PosCounter() {
  const { session, navigate } = useBosApp();
  const settings = session.settings;
  const { run, busy } = useBosAction();
  const day = useBosData(() => bos.posDay(), []);
  const catalog = useBosData(() => bos.salesItems(), []);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState({ description: "", rate: "", taxRate: String(settings.defaultTaxRate) });
  const [customer, setCustomer] = useState({ name: "", gstin: "" });
  const [method, setMethod] = useState<PosMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const print = usePrint();

  const items = (catalog.data?.items ?? []).filter((i) => i.active);
  const q = search.trim().toLowerCase();
  const shown = items.filter((i) => !q || `${i.name} ${i.sku ?? ""} ${i.hsn ?? ""}`.toLowerCase().includes(q));
  const totals = computeGstTotals(cart.map(asLine), true);
  const change = method === "cash" ? posChange(totals.grandTotal, tendered) : null;
  const short = method === "cash" && tendered.trim() !== "" && change === null;

  const add = (item: Pick<BosItem, "name" | "hsn" | "unit" | "rate" | "taxRate">) =>
    setCart((c) => {
      const same = c.find((l) => l.description === item.name && l.rate === item.rate && l.taxRate === item.taxRate);
      if (same) return c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { key: cartKey(), description: item.name, hsn: item.hsn, unit: item.unit, rate: item.rate, taxRate: item.taxRate, quantity: 1 }];
    });
  const bump = (key: string, by: number) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.quantity + by > 0 ? [{ ...l, quantity: l.quantity + by }] : [])));
  const addCustom = () => {
    const rate = Number(custom.rate);
    if (!custom.description.trim() || !(rate > 0)) return;
    add({ name: custom.description.trim(), hsn: null, unit: null, rate, taxRate: Number(custom.taxRate) || 0 });
    setCustom((c) => ({ ...c, description: "", rate: "" }));
  };

  const charge = async () => {
    const out = await run(
      "charge",
      () =>
        bos.posBill({
          partyName: customer.name.trim() || null,
          partyGstin: customer.gstin.trim() || null,
          lines: cart.map(asLine),
          method,
          reference: method === "cash" ? null : reference.trim() || null,
        }),
      { success: "Payment received", description: `${inr(totals.grandTotal)} · ${POS_METHOD_LABEL[method]}` },
    );
    if (!out) return;
    setReceipt({ invoiceId: out.invoice.id, invoiceNo: out.invoice.invoiceNo, partyName: customer.name.trim() || "Walk-in customer", partyGstin: customer.gstin.trim() || null, totals, method, change });
    setCart([]);
    setCustomer({ name: "", gstin: "" });
    setTendered("");
    setReference("");
  };

  return (
    <Stack gap={16}>
      {receipt ? (
        <div className="bos-pos-receipt">
          <div className="bos-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button size="sm" onClick={() => navigate("finance", "invoices", `open:${receipt.invoiceId}`)}>
              Open invoice
            </Button>
            <Button size="sm" icon="printer" onClick={print}>
              Print receipt
            </Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setReceipt(null)}>
              New bill
            </Button>
          </div>
          <InvoicePaper
            settings={settings}
            doc={{
              invoiceNo: receipt.invoiceNo,
              partyName: receipt.partyName,
              partyGstin: receipt.partyGstin,
              partyAddress: null,
              issueDate: todayLocal(),
              dueDate: todayLocal(),
              placeOfSupply: settings.state,
              intraState: true,
              totals: receipt.totals,
              notes: "Thank you for your purchase.",
              amountPaid: receipt.totals.grandTotal,
              dueTitle: null,
              stamp: { text: "PAID", tone: "emerald" },
              extraMeta: [["Payment", POS_METHOD_LABEL[receipt.method], receipt.change ? `Change returned ${inrExact(receipt.change)}` : undefined]],
            }}
          />
        </div>
      ) : (
        <div className="bos-pos">
          <WidgetCard title="🛒 Products" dot="mint" note={items.length ? `${items.length} in catalog` : undefined}>
            <div style={{ padding: "4px 0 10px" }}>
              <SearchInput placeholder="Search name, SKU or HSN…" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {shown.length ? (
              <div className="bos-pos-grid" role="list" aria-label="Products">
                {shown.map((i) => (
                  <div key={i.id} role="listitem">
                    <button type="button" className="bos-pos-item" onClick={() => add(i)} aria-label={`Add ${i.name}, ${inr(i.rate)}`}>
                      <span className="bos-pos-item-name">{i.name}</span>
                      <span className="bos-pos-item-rate">
                        {inr(i.rate)}
                        {i.unit ? <small> / {i.unit}</small> : null}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="bos-text-faint" style={{ fontSize: 12.5, margin: "4px 0 10px" }}>
                {items.length ? "No products match." : "Add products in the Products & Services tab to tap them in here — or ring up a quick item below."}
              </p>
            )}
            <BlockLabel>Quick item</BlockLabel>
            <div className="bos-pos-custom">
              <Input size="sm" aria-label="Quick item description" placeholder="Description" value={custom.description} onChange={(e) => setCustom((c) => ({ ...c, description: e.target.value }))} />
              <Input size="sm" aria-label="Quick item rate" placeholder="Rate (₹)" type="number" inputMode="decimal" min={0} step="any" value={custom.rate} onChange={(e) => setCustom((c) => ({ ...c, rate: e.target.value }))} />
              <Input size="sm" aria-label="Quick item GST rate" placeholder="GST %" type="number" inputMode="decimal" min={0} max={100} step="any" value={custom.taxRate} onChange={(e) => setCustom((c) => ({ ...c, taxRate: e.target.value }))} />
              <Button size="sm" icon="plus" onClick={addCustom} disabled={!custom.description.trim() || !(Number(custom.rate) > 0)}>
                Add
              </Button>
            </div>
          </WidgetCard>

          <WidgetCard title="🧾 Current bill" dot="rose" note={cart.length ? `${cart.reduce((s, l) => s + l.quantity, 0)} items` : undefined}>
            {cart.length ? (
              <ul className="bos-pos-cart" aria-label="Bill items">
                {cart.map((l, i) => (
                  <li key={l.key}>
                    <span className="bos-pos-cart-name">
                      {l.description}
                      <small>
                        {inr(l.rate)} · GST {l.taxRate}%
                      </small>
                    </span>
                    <span className="bos-pos-qty">
                      <button type="button" aria-label={`One less ${l.description}`} onClick={() => bump(l.key, -1)}>
                        −
                      </button>
                      <span aria-label={`Quantity of ${l.description}`}>{l.quantity}</span>
                      <button type="button" aria-label={`One more ${l.description}`} onClick={() => bump(l.key, 1)}>
                        +
                      </button>
                    </span>
                    <span className="bos-pos-cart-amount">{inr(totals.lines[i]?.amount ?? 0)}</span>
                    <button type="button" className="bos-inv-remove" aria-label={`Remove ${l.description}`} onClick={() => bump(l.key, -l.quantity)}>
                      <BosIcon name="x" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <WidgetRow label={<span className="bos-text-faint">Tap a product to start a bill.</span>} />
            )}
            <WidgetRow label="Taxable value" value={inrExact(totals.subtotal - totals.discountTotal)} soft />
            <WidgetRow label="GST (CGST + SGST)" value={inrExact(totals.taxTotal)} soft />
            <WidgetRow label={<strong>Total</strong>} value={<strong>{inrExact(totals.grandTotal)}</strong>} />
            <FormGrid>
              <Field label="Customer (optional)">{({ id }) => <Input id={id} value={customer.name} maxLength={200} placeholder="Walk-in customer" onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} />}</Field>
              <Field label="Customer GSTIN">{({ id }) => <Input id={id} value={customer.gstin} maxLength={20} placeholder="For a B2B bill" onChange={(e) => setCustomer((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))} />}</Field>
            </FormGrid>
            <div style={{ margin: "12px 0 8px" }}>
              <Segmented<PosMethod> size="sm" aria-label="Payment method" options={METHODS.map((m) => ({ value: m, label: POS_METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
            </div>
            {method === "cash" ? (
              <Field label="Cash received" hint={change !== null ? `Change to return: ${inrExact(change)}` : short ? "Less than the bill total" : "Optional — to work out the change"}>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="any" value={tendered} onChange={(e) => setTendered(e.target.value)} />}
              </Field>
            ) : (
              <Field label={method === "upi" ? "UPI reference" : "Card approval code"} hint="Optional">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}
              </Field>
            )}
            <Button variant="primary" icon="wallet" disabled={!cart.length || totals.grandTotal <= 0 || short || busy !== null} onClick={charge} style={{ width: "100%", marginTop: 12 }}>
              {busy === "charge" ? "Saving…" : `Charge ${inrExact(totals.grandTotal)}`}
            </Button>
          </WidgetCard>
        </div>
      )}
      <Loaded state={day}>{(d) => <TodayBills bills={d.bills} truncated={d.truncated} total={d.total} byMethod={d.byMethod} onOpen={(id) => navigate("finance", "invoices", `open:${id}`)} />}</Loaded>
    </Stack>
  );
}

function TodayBills({
  bills,
  truncated,
  total,
  byMethod,
  onOpen,
}: {
  bills: PosBill[];
  truncated?: boolean;
  total: number;
  byMethod: Record<PosMethod, number>;
  onOpen: (id: string) => void;
}) {
  const columns: BosColumn<PosBill>[] = [
    { key: "time", header: "Time", mono: true, cell: (b) => time(b.createdAt) },
    { key: "no", header: "Bill #", mono: true, cell: (b) => b.invoiceNo },
    { key: "party", header: "Customer", cell: (b) => b.partyName },
    { key: "method", header: "Paid by", cell: (b) => (b.method ? POS_METHOD_LABEL[b.method] : "—") },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (b) => inr(b.grandTotal) },
    { key: "status", header: "Status", cell: (b) => <StatusBadge view={invoiceBadge(b.status)} /> },
  ];
  return (
    <div>
      <ModuleToolbar>
        <BlockLabel>Today · {dateLabel(todayLocal())}</BlockLabel>
        <span className="bos-spacer" />
        <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
          {METHODS.map((m) => `${POS_METHOD_LABEL[m]} ${inr(byMethod[m])}`).join(" · ")} · <strong>Total {inr(total)}</strong>
        </span>
      </ModuleToolbar>
      <DataTable caption="Today's counter bills" columns={columns} rows={bills} rowKey={(b) => b.id} onRowClick={(b) => onOpen(b.id)} chevron empty="No counter bills yet today." />
      {truncated ? <Pagination>The latest {bills.length} bills · the totals cover the whole day</Pagination> : null}
    </div>
  );
}

/* ---------- Products & services ---------- */

/** The catalog behind quotation lines and the POS counter. Lines copy the item, so edits never change old documents. */
export function ProductsTab({ posEnabled }: { posEnabled: boolean }) {
  const { canManage } = useBosApp();
  const state = useBosData(() => bos.salesItems(), []);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BosItem | "new" | null>(null);
  return (
    <Loaded state={state}>
      {({ items }) => {
        const q = query.trim().toLowerCase();
        const rows = items.filter((i) => !q || `${i.name} ${i.sku ?? ""} ${i.hsn ?? ""}`.toLowerCase().includes(q));
        const columns: BosColumn<BosItem>[] = [
          {
            key: "name",
            header: "Item",
            cell: (i) => (
              <span>
                <span style={{ fontWeight: 600 }}>{i.name}</span>
                {i.sku ? <span className="bos-text-faint"> · {i.sku}</span> : null}
              </span>
            ),
          },
          { key: "kind", header: "Type", cell: (i) => <Badge tag={i.kind === "service" ? "lavender" : "sage"}>{i.kind === "service" ? "SERVICE" : "PRODUCT"}</Badge> },
          { key: "hsn", header: "HSN / SAC", mono: true, cell: (i) => i.hsn ?? "—" },
          { key: "unit", header: "Unit", cell: (i) => i.unit ?? "—" },
          { key: "rate", header: "Rate", align: "right", mono: true, cell: (i) => inrExact(i.rate) },
          { key: "gst", header: "GST", align: "right", mono: true, cell: (i) => `${i.taxRate}%` },
          { key: "status", header: "Status", cell: (i) => <Badge tone={i.active ? "emerald" : "neutral"}>{i.active ? "ACTIVE" : "HIDDEN"}</Badge> },
        ];
        return (
          <Stack gap={12}>
            {canManage && !posEnabled ? (
              <Alert tone="blue" title="POS counter billing is off">
                An administrator can turn it on in Admin → Tools → Justx BOS → Switches. Counter bills are issued as paid GST invoices.
              </Alert>
            ) : null}
            <ModuleToolbar>
              <SearchInput placeholder="Search name, SKU or HSN…" aria-label="Search products and services" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button
                size="sm"
                icon="download"
                disabled={!items.length}
                onClick={() =>
                  downloadCsv(
                    "products-services.csv",
                    ["Name", "SKU", "Type", "HSN/SAC", "Unit", "Rate", "GST %", "Active"],
                    items.map((i) => ({
                      Name: i.name,
                      SKU: i.sku ?? "",
                      Type: i.kind === "service" ? "Service" : "Product",
                      "HSN/SAC": i.hsn ?? "",
                      Unit: i.unit ?? "",
                      Rate: i.rate,
                      "GST %": i.taxRate,
                      Active: i.active ? "Yes" : "No",
                    })),
                  )
                }
              >
                CSV
              </Button>
              {canManage ? (
                <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
                  Add item
                </Button>
              ) : null}
            </ModuleToolbar>
            <DataTable
              caption="Products and services"
              columns={columns}
              rows={rows}
              rowKey={(i) => i.id}
              onRowClick={canManage ? (i) => setEditing(i) : undefined}
              chevron={canManage}
              empty={items.length ? "No items match." : canManage ? "No products yet — add what you sell to speed up quotations and counter billing." : "No products in the catalog yet."}
            />
            {editing ? <ItemDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function ItemDialog({ item, onClose }: { item: BosItem | null; onClose: () => void }) {
  const { session } = useBosApp();
  const { run, busy } = useBosAction();
  const [confirm, setConfirm] = useState(false);
  const f = useFormState(() => ({
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    kind: item?.kind ?? ("goods" as BosItem["kind"]),
    hsn: item?.hsn ?? "",
    unit: item?.unit ?? "",
    rate: item ? String(item.rate) : "",
    taxRate: item ? String(item.taxRate) : String(session.settings.defaultTaxRate),
    active: item?.active ?? true,
  }));
  const v = f.values;
  const submit = async () => {
    const body: ItemInput = {
      name: v.name.trim(),
      sku: v.sku.trim() || null,
      kind: v.kind,
      hsn: v.hsn.trim() || null,
      unit: v.unit.trim() || null,
      rate: Number(v.rate) || 0,
      taxRate: Number(v.taxRate) || 0,
      active: v.active,
    };
    const out = await run("item", () => (item ? bos.updateItem(item.id, body) : bos.createItem(body)), { success: item ? "Item saved" : "Item added", description: body.name });
    if (out) onClose();
  };
  return (
    <>
      <FormDialog
        open={!confirm}
        onClose={onClose}
        title={item ? `Edit ${item.name}` : "Add a product or service"}
        description="Quotations, orders and counter bills copy these details into each line."
        icon={{ tone: "emerald", name: "box" }}
        submitLabel={item ? "Save" : "Add item"}
        busy={busy === "item"}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label="Name" full>
            {({ id }) => <Input id={id} required maxLength={200} value={v.name} placeholder="Solar panel 540W" onChange={(e) => f.set("name")(e.target.value)} />}
          </Field>
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={v.kind} onChange={(e) => f.set("kind")(e.target.value as BosItem["kind"])}>
                <option value="goods">Product (goods)</option>
                <option value="service">Service</option>
              </Select>
            )}
          </Field>
          <Field label="SKU / code" hint="Optional, unique">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={64} value={v.sku} onChange={(e) => f.set("sku")(e.target.value)} />}
          </Field>
          <Field label={v.kind === "service" ? "SAC code" : "HSN code"}>{({ id }) => <Input id={id} maxLength={20} value={v.hsn} onChange={(e) => f.set("hsn")(e.target.value)} />}</Field>
          <Field label="Unit">{({ id }) => <Input id={id} maxLength={20} value={v.unit} placeholder="Nos, kg, hour…" onChange={(e) => f.set("unit")(e.target.value)} />}</Field>
          <Field label="Rate (₹, before GST)">
            {({ id }) => <Input id={id} required type="number" inputMode="decimal" min={0} step="any" value={v.rate} onChange={(e) => f.set("rate")(e.target.value)} />}
          </Field>
          <Field label="GST %">{({ id }) => <Input id={id} required type="number" inputMode="decimal" min={0} max={100} step="any" value={v.taxRate} onChange={(e) => f.set("taxRate")(e.target.value)} />}</Field>
          <div className="bos-field" style={{ justifyContent: "flex-end" }}>
            <label className="bos-row" style={{ gap: 8, alignItems: "center", fontSize: 13 }}>
              <Switch checked={v.active} onChange={(c) => f.set("active")(c)} aria-label="Active" />
              Active — offered in quotations and at the counter
            </label>
          </div>
        </FormGrid>
        {item ? (
          <div style={{ marginTop: 12 }}>
            <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}>
              Remove item
            </Button>
          </div>
        ) : null}
      </FormDialog>
      {item ? (
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          destructive
          title={`Remove ${item.name}?`}
          description="Existing quotations, orders and invoices keep their lines. To stop offering it but keep it on file, switch it off instead."
          confirmLabel="Remove"
          busy={busy === "remove"}
          onConfirm={async () => {
            const ok = await run("remove", () => bos.deleteItem(item.id).then(() => true), { success: "Item removed", description: item.name });
            if (ok) onClose();
            else setConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}
