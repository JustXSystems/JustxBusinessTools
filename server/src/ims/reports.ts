import type { Request, Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, isoDate, parse, parsePatch, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows } from "./db.js";
import { ImsError, conflict, forbidden, notFound, type ImsActor } from "./host.js";
import {
  AGING_BUCKETS,
  PERIODS,
  REPORT_SCHEDULES,
  REPORT_TYPES,
  agingBucket,
  average,
  billBalance,
  billDisplayStatus,
  daysBetween,
  daysOverdue,
  durationLabel,
  fillRatePct,
  gstinStateCode,
  hsnSummary,
  invoiceBalance,
  invoiceDisplayStatus,
  isB2CLarge,
  isIntraState,
  isReportType,
  isValidGstin,
  itemGstIssues,
  marginPct,
  minutesBetween,
  netGstPayable,
  nextReportRun,
  normalizeDocLine,
  periodRange,
  rateWiseSummary,
  reorderQty,
  round2,
  round3,
  splitTax,
  stockStatus,
  todayISO,
  trackKm,
  type DocLine,
  type ReportApprovalStatus,
  type ReportType,
} from "./logic.js";
import { getSettings, listMembers, type ImsSettings } from "./settings.js";

/* ---------- Result shape ---------- */

export type ReportCellKind = "text" | "number" | "money" | "qty" | "date" | "pct" | "status";
export type ReportColumn = { key: string; label: string; kind: ReportCellKind; total?: boolean };
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;
export type ReportSummary = { label: string; value: number | string; kind: ReportCellKind; tone?: "blue" | "emerald" | "amber" | "coral"; hint?: string };
export type ReportChart = { kind: "bar" | "stack"; title: string; valueKind: ReportCellKind; data: Array<{ label: string; value: number; color?: string }> } | null;
export type ReportResult = {
  type: ReportType;
  title: string;
  range: { from: string; to: string } | null;
  asOf: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummary[];
  chart: ReportChart;
  notes: string[];
};

type RunFilters = { category: string; supplierId: string; partyId: string; userId: number | null; status: string; groupBy: "item" | "category"; days: number; q: string };
type RunCtx = { tenantId: number; today: string; range: { from: string; to: string }; filters: RunFilters; settings: ImsSettings };

const typeLabel = (t: string): string => REPORT_TYPES.find((r) => r.key === t)?.label ?? t;

function top(map: Map<string, number>, n = 8): Array<{ label: string; value: number }> {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: round2(value) }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}
const bump = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);

/* ---------- Report builders ---------- */

type MoveRow = {
  id: string;
  item_name: string;
  type: string;
  qty: string;
  unit_cost: string | null;
  unit_price: string | null;
  value: string;
  ref_no: string | null;
  party_name: string | null;
  reason: string | null;
  notes: string | null;
  movement_date: string;
  actor_name: string | null;
  sku: string | null;
  unit: string | null;
  category: string | null;
  purchase_price: string | null;
};

async function movementRows(deps: ImsDeps, ctx: RunCtx, types: string[]): Promise<MoveRow[]> {
  const where = ["m.tenant_id = :tenantId", `m.type IN (${types.map((_, i) => `:t${i}`).join(", ")})`, "m.movement_date BETWEEN :from AND :to"];
  const params: Record<string, unknown> = { tenantId: ctx.tenantId, ...ctx.range };
  types.forEach((t, i) => (params[`t${i}`] = t));
  if (ctx.filters.category) {
    where.push("i.category = :category");
    params.category = ctx.filters.category;
  }
  const party = ctx.filters.partyId || ctx.filters.supplierId;
  if (party) {
    where.push("m.party_id = :party");
    params.party = party;
  }
  if (ctx.filters.q) {
    where.push("(m.item_name LIKE :q OR i.sku LIKE :q OR m.ref_no LIKE :q OR m.party_name LIKE :q)");
    params.q = likeOf(ctx.filters.q);
  }
  return rows<MoveRow>(
    deps.db,
    `SELECT m.id, m.item_name, m.type, m.qty, m.unit_cost, m.unit_price, m.value, m.ref_no, m.party_name, m.reason, m.notes, m.movement_date, m.actor_name, i.sku, i.unit, i.category, i.purchase_price
     FROM ims_movements m LEFT JOIN ims_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
     WHERE ${where.join(" AND ")} ORDER BY m.movement_date DESC, m.created_at DESC LIMIT 5000`,
    params,
  );
}

async function stockFlow(deps: ImsDeps, ctx: RunCtx, dir: "in" | "out"): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = await movementRows(deps, ctx, [dir === "in" ? "IN" : "OUT"]);
  const byItem = new Map<string, number>();
  const parties = new Set<string>();
  let units = 0;
  let value = 0;
  const out = list.map((m) => {
    const qty = round3(money(m.qty));
    const rate = round2(money(dir === "in" ? m.unit_cost : m.unit_price));
    const v = round2(money(m.value) || qty * rate);
    units += qty;
    value += v;
    bump(byItem, m.item_name, v);
    if (m.party_name) parties.add(m.party_name);
    return {
      date: isoOf(m.movement_date),
      ref: m.ref_no,
      item: m.item_name,
      sku: m.sku,
      category: m.category,
      qty,
      unit: m.unit,
      rate,
      value: v,
      party: m.party_name,
      reason: m.reason,
      user: m.actor_name,
    };
  });
  return {
    range: ctx.range,
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "ref", label: "Reference", kind: "text" },
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "rate", label: dir === "in" ? "Unit cost" : "Unit price", kind: "money" },
      { key: "value", label: "Value", kind: "money", total: true },
      { key: "party", label: dir === "in" ? "Supplier" : "Customer", kind: "text" },
      ...(dir === "out" ? [{ key: "reason", label: "Reason", kind: "text" as const }] : []),
      { key: "user", label: "Entered by", kind: "text" },
    ],
    rows: out,
    summary: [
      { label: "Entries", value: out.length, kind: "number" },
      { label: dir === "in" ? "Units received" : "Units issued", value: round3(units), kind: "qty" },
      { label: dir === "in" ? "Value received" : "Value issued", value: round2(value), kind: "money", tone: dir === "in" ? "emerald" : "blue" },
      { label: dir === "in" ? "Suppliers" : "Customers", value: parties.size, kind: "number" },
    ],
    chart: { kind: "bar", title: "Top items by value", valueKind: "money", data: top(byItem) },
    notes: [],
  };
}

async function damageReport(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = await movementRows(deps, ctx, ["DAMAGE", "WRITE_OFF"]);
  const byReason = new Map<string, number>();
  let units = 0;
  let value = 0;
  let writeOffs = 0;
  const out = list.map((m) => {
    const qty = round3(money(m.qty));
    const v = round2(money(m.value) || qty * money(m.unit_cost ?? m.purchase_price));
    units += qty;
    value += v;
    if (m.type === "WRITE_OFF") writeOffs += v;
    bump(byReason, m.reason || "Unspecified", v);
    return { date: isoOf(m.movement_date), item: m.item_name, sku: m.sku, type: m.type === "WRITE_OFF" ? "Write-off" : "Damage", qty, unit: m.unit, reason: m.reason, value: v, notes: m.notes, user: m.actor_name };
  });
  return {
    range: ctx.range,
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "type", label: "Type", kind: "status" },
      { key: "qty", label: "Qty", kind: "qty", total: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "reason", label: "Reason", kind: "text" },
      { key: "value", label: "Value lost", kind: "money", total: true },
      { key: "notes", label: "Notes", kind: "text" },
      { key: "user", label: "Recorded by", kind: "text" },
    ],
    rows: out,
    summary: [
      { label: "Incidents", value: out.length, kind: "number" },
      { label: "Units affected", value: round3(units), kind: "qty" },
      { label: "Value at cost", value: round2(value), kind: "money", tone: "coral" },
      { label: "Written off", value: round2(writeOffs), kind: "money", tone: "amber" },
    ],
    chart: { kind: "bar", title: "Loss by reason", valueKind: "money", data: top(byReason) },
    notes: [],
  };
}

type ItemRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gst_rate: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_price: string;
  selling_price: string;
  current_stock: string;
  min_stock: string;
  max_stock: string | null;
  reorder_qty: string | null;
  location: string | null;
  last_movement_at: string | null;
  created_at: string;
};

async function itemRows(deps: ImsDeps, ctx: RunCtx, extra = ""): Promise<ItemRow[]> {
  const where = ["i.tenant_id = :tenantId", "i.active = 1"];
  const params: Record<string, unknown> = { tenantId: ctx.tenantId };
  if (ctx.filters.category) {
    where.push("i.category = :category");
    params.category = ctx.filters.category;
  }
  if (ctx.filters.supplierId) {
    where.push("i.supplier_id = :supplierId");
    params.supplierId = ctx.filters.supplierId;
  }
  if (ctx.filters.q) {
    where.push("(i.name LIKE :q OR i.sku LIKE :q OR i.brand LIKE :q)");
    params.q = likeOf(ctx.filters.q);
  }
  return rows<ItemRow>(
    deps.db,
    `SELECT i.id, i.name, i.sku, i.category, i.brand, i.unit, i.hsn, i.gst_rate, i.supplier_id, p.name AS supplier_name, i.purchase_price, i.selling_price,
            i.current_stock, i.min_stock, i.max_stock, i.reorder_qty, i.location, i.last_movement_at, i.created_at
     FROM ims_items i LEFT JOIN ims_parties p ON p.id = i.supplier_id AND p.tenant_id = i.tenant_id
     WHERE ${where.join(" AND ")} ${extra} ORDER BY i.name LIMIT 10000`,
    params,
  );
}

const STATUS_TEXT: Record<string, string> = { GOOD: "In stock", LOW: "Low", OUT_OF_STOCK: "Out of stock", OVERSTOCK: "Overstock" };

function itemFacts(r: ItemRow, today: string) {
  const current = round3(money(r.current_stock));
  const min = round3(money(r.min_stock));
  const max = r.max_stock == null ? null : round3(money(r.max_stock));
  const cost = round2(money(r.purchase_price));
  const lastMove = isoOf(r.last_movement_at ?? r.created_at);
  return {
    current,
    min,
    max,
    cost,
    price: round2(money(r.selling_price)),
    status: stockStatus(current, min, max),
    value: round2(Math.max(0, current) * cost),
    lastMove,
    idleDays: lastMove ? Math.max(0, daysBetween(lastMove, today)) : 0,
  };
}

async function fullStock(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = await itemRows(deps, ctx);
  const byCat = new Map<string, number>();
  let units = 0;
  let value = 0;
  let retail = 0;
  let attention = 0;
  const out: ReportRow[] = [];
  for (const r of list) {
    const f = itemFacts(r, ctx.today);
    if (ctx.filters.status && f.status !== ctx.filters.status) continue;
    const retailValue = round2(Math.max(0, f.current) * f.price);
    units += Math.max(0, f.current);
    value += f.value;
    retail += retailValue;
    if (f.status === "LOW" || f.status === "OUT_OF_STOCK") attention += 1;
    bump(byCat, r.category || "Uncategorised", f.value);
    out.push({ item: r.name, sku: r.sku, category: r.category, brand: r.brand, stock: f.current, unit: r.unit, cost: f.cost, value: f.value, retail: retailValue, status: STATUS_TEXT[f.status], idle: f.idleDays, location: r.location });
  }
  return {
    range: null,
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "brand", label: "Brand", kind: "text" },
      { key: "stock", label: "Stock", kind: "qty", total: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "cost", label: "Unit cost", kind: "money" },
      { key: "value", label: "Stock value", kind: "money", total: true },
      { key: "retail", label: "Retail value", kind: "money", total: true },
      { key: "status", label: "Status", kind: "status" },
      { key: "idle", label: "Idle days", kind: "number" },
      { key: "location", label: "Location", kind: "text" },
    ],
    rows: out,
    summary: [
      { label: "Items", value: out.length, kind: "number" },
      { label: "Stock value (cost)", value: round2(value), kind: "money", tone: "blue" },
      { label: "Retail value", value: round2(retail), kind: "money", tone: "emerald", hint: `Potential margin ${round2(retail - value).toLocaleString("en-IN")}` },
      { label: "Low / out of stock", value: attention, kind: "number", tone: attention ? "amber" : undefined },
      { label: "Units on hand", value: round3(units), kind: "qty" },
    ],
    chart: { kind: "bar", title: "Stock value by category", valueKind: "money", data: top(byCat, 10) },
    notes: ["A current snapshot — the period doesn't apply."],
  };
}

async function lowStock(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = await itemRows(deps, ctx, "AND i.current_stock <= i.min_stock");
  const bySupplier = new Map<string, number>();
  let reorderValue = 0;
  let out0 = 0;
  const suppliers = new Set<string>();
  const out = list.map((r) => {
    const f = itemFacts(r, ctx.today);
    const suggested = reorderQty({ current: f.current, min: f.min, max: f.max, reorderQty: r.reorder_qty == null ? null : money(r.reorder_qty) });
    const v = round2(suggested * f.cost);
    reorderValue += v;
    if (f.status === "OUT_OF_STOCK") out0 += 1;
    const supplier = r.supplier_name || "No preferred supplier";
    suppliers.add(supplier);
    bump(bySupplier, supplier, v);
    return { item: r.name, sku: r.sku, category: r.category, supplier, stock: f.current, min: f.min, suggested, unit: r.unit, cost: f.cost, value: v, status: STATUS_TEXT[f.status] };
  });
  return {
    range: null,
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "stock", label: "In stock", kind: "qty" },
      { key: "min", label: "Minimum", kind: "qty" },
      { key: "suggested", label: "Suggested order", kind: "qty", total: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "cost", label: "Unit cost", kind: "money" },
      { key: "value", label: "Reorder value", kind: "money", total: true },
      { key: "status", label: "Status", kind: "status" },
    ],
    rows: out,
    summary: [
      { label: "Items to reorder", value: out.length, kind: "number", tone: out.length ? "amber" : "emerald" },
      { label: "Out of stock", value: out0, kind: "number", tone: out0 ? "coral" : undefined },
      { label: "Reorder value", value: round2(reorderValue), kind: "money", tone: "blue" },
      { label: "Suppliers", value: suppliers.size, kind: "number" },
    ],
    chart: { kind: "bar", title: "Reorder value by supplier", valueKind: "money", data: top(bySupplier) },
    notes: ["Suggested quantity uses each item's reorder quantity, else enough to reach maximum stock (or twice the minimum)."],
  };
}

async function deadStock(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const days = ctx.filters.days;
  const list = await itemRows(deps, ctx, "AND i.current_stock > 0");
  const all = list.map((r) => ({ r, f: itemFacts(r, ctx.today) }));
  const totalValue = all.reduce((s, x) => s + x.f.value, 0);
  const dead = all.filter((x) => x.f.idleDays >= days).sort((a, b) => b.f.value - a.f.value);
  const byCat = new Map<string, number>();
  let units = 0;
  let value = 0;
  const out = dead.map(({ r, f }) => {
    units += f.current;
    value += f.value;
    bump(byCat, r.category || "Uncategorised", f.value);
    const bucket = AGING_BUCKETS.find((b) => b.key === agingBucket(f.idleDays));
    return { item: r.name, sku: r.sku, category: r.category, stock: f.current, unit: r.unit, value: f.value, lastMove: f.lastMove, idle: f.idleDays, bucket: bucket?.label ?? "" };
  });
  return {
    range: null,
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "sku", label: "SKU", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "stock", label: "Stock", kind: "qty", total: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "value", label: "Value tied up", kind: "money", total: true },
      { key: "lastMove", label: "Last movement", kind: "date" },
      { key: "idle", label: "Idle days", kind: "number" },
      { key: "bucket", label: "Aging", kind: "status" },
    ],
    rows: out,
    summary: [
      { label: `Idle ${days}+ days`, value: out.length, kind: "number", tone: out.length ? "amber" : "emerald" },
      { label: "Units", value: round3(units), kind: "qty" },
      { label: "Value tied up", value: round2(value), kind: "money", tone: "coral" },
      { label: "Share of stock value", value: totalValue > 0 ? round2((value / totalValue) * 100) : 0, kind: "pct" },
    ],
    chart: { kind: "bar", title: "Dead stock value by category", valueKind: "money", data: top(byCat) },
    notes: [`Items with stock on hand and no movement for ${days} days or more. Consider clearance pricing or supplier returns.`],
  };
}

type PoRow = {
  id: string;
  po_no: string;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  order_date: string;
  expected_date: string | null;
  lines: unknown;
  grand_total: string;
  received_at: string | null;
  bill_id: string | null;
  subtotal: string;
  tax_total: string;
};

const PO_STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  sent: "Sent",
  partially_received: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};

function poQty(lines: unknown): { ordered: number; received: number; orderedValue: number; receivedValue: number; count: number } {
  const list = json<unknown[]>(lines, []);
  let ordered = 0;
  let received = 0;
  let orderedValue = 0;
  let receivedValue = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const l = normalizeDocLine(r);
    const rec = Math.min(l.qty, Math.max(0, money(r.receivedQty ?? r.received_qty)));
    ordered += l.qty;
    received += rec;
    orderedValue += l.qty * l.rate;
    receivedValue += rec * l.rate;
  }
  return { ordered, received, orderedValue, receivedValue, count: Array.isArray(list) ? list.length : 0 };
}

async function poRows(deps: ImsDeps, ctx: RunCtx): Promise<PoRow[]> {
  const where = ["tenant_id = :tenantId", "order_date BETWEEN :from AND :to"];
  const params: Record<string, unknown> = { tenantId: ctx.tenantId, ...ctx.range };
  if (ctx.filters.supplierId) {
    where.push("supplier_id = :supplierId");
    params.supplierId = ctx.filters.supplierId;
  }
  return rows<PoRow>(
    deps.db,
    `SELECT id, po_no, status, supplier_id, supplier_name, order_date, expected_date, \`lines\`, grand_total, received_at, bill_id, subtotal, tax_total
     FROM ims_purchase_orders WHERE ${where.join(" AND ")} ORDER BY order_date DESC, po_no DESC LIMIT 5000`,
    params,
  );
}

async function poReport(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = (await poRows(deps, ctx)).filter((p) => !ctx.filters.status || p.status === ctx.filters.status);
  const byStatus = new Map<string, number>();
  let value = 0;
  let pending = 0;
  let open = 0;
  const out = list.map((p) => {
    const q = poQty(p.lines);
    const total = round2(money(p.grand_total));
    if (p.status !== "cancelled" && p.status !== "rejected") value += total;
    if (p.status === "pending_approval") pending += 1;
    if (p.status === "approved" || p.status === "sent" || p.status === "partially_received") open += 1;
    bump(byStatus, PO_STATUS_TEXT[p.status] ?? p.status, total);
    return {
      poNo: p.po_no,
      date: isoOf(p.order_date),
      supplier: p.supplier_name,
      expected: p.expected_date ? isoOf(p.expected_date) : null,
      status: PO_STATUS_TEXT[p.status] ?? p.status,
      lines: q.count,
      total,
      received: fillRatePct(q.ordered, q.received),
    };
  });
  return {
    range: ctx.range,
    columns: [
      { key: "poNo", label: "PO number", kind: "text" },
      { key: "date", label: "Order date", kind: "date" },
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "expected", label: "Expected", kind: "date" },
      { key: "status", label: "Status", kind: "status" },
      { key: "lines", label: "Lines", kind: "number" },
      { key: "total", label: "Total", kind: "money", total: true },
      { key: "received", label: "Received", kind: "pct" },
    ],
    rows: out,
    summary: [
      { label: "Purchase orders", value: out.length, kind: "number" },
      { label: "Order value", value: round2(value), kind: "money", tone: "blue", hint: "Excludes cancelled and rejected" },
      { label: "Awaiting approval", value: pending, kind: "number", tone: pending ? "amber" : undefined },
      { label: "Open (not fully received)", value: open, kind: "number" },
    ],
    chart: { kind: "bar", title: "Value by status", valueKind: "money", data: top(byStatus) },
    notes: [],
  };
}

async function supplierReport(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = (await poRows(deps, ctx)).filter((p) => !["draft", "cancelled", "rejected"].includes(p.status));
  type Agg = { supplier: string; pos: number; value: number; received: number; leads: number[]; onTime: number; dated: number; ordered: number; got: number };
  const map = new Map<string, Agg>();
  for (const p of list) {
    const key = p.supplier_id ?? p.supplier_name;
    const a = map.get(key) ?? { supplier: p.supplier_name, pos: 0, value: 0, received: 0, leads: [], onTime: 0, dated: 0, ordered: 0, got: 0 };
    const q = poQty(p.lines);
    a.pos += 1;
    a.value += money(p.grand_total);
    a.ordered += q.ordered;
    a.got += q.received;
    if ((p.status === "received" || p.status === "partially_received") && p.received_at) {
      a.received += 1;
      const recDate = isoOf(p.received_at);
      a.leads.push(Math.max(0, daysBetween(isoOf(p.order_date), recDate)));
      if (p.expected_date) {
        a.dated += 1;
        if (recDate <= isoOf(p.expected_date)) a.onTime += 1;
      }
    }
    map.set(key, a);
  }
  const aggs = [...map.values()].sort((a, b) => b.value - a.value);
  const out = aggs.map((a) => ({
    supplier: a.supplier,
    pos: a.pos,
    value: round2(a.value),
    received: a.received,
    lead: a.leads.length ? average(a.leads) : null,
    onTime: a.dated ? round2((a.onTime / a.dated) * 100) : null,
    fill: fillRatePct(a.ordered, a.got),
  }));
  const allLeads = aggs.flatMap((a) => a.leads);
  const totalOrdered = aggs.reduce((s, a) => s + a.ordered, 0);
  const totalGot = aggs.reduce((s, a) => s + a.got, 0);
  return {
    range: ctx.range,
    columns: [
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "pos", label: "POs", kind: "number", total: true },
      { key: "value", label: "PO value", kind: "money", total: true },
      { key: "received", label: "Received POs", kind: "number", total: true },
      { key: "lead", label: "Avg lead time (days)", kind: "number" },
      { key: "onTime", label: "On time", kind: "pct" },
      { key: "fill", label: "Fill rate", kind: "pct" },
    ],
    rows: out,
    summary: [
      { label: "Suppliers", value: out.length, kind: "number" },
      { label: "PO value", value: round2(aggs.reduce((s, a) => s + a.value, 0)), kind: "money", tone: "blue" },
      { label: "Avg lead time", value: allLeads.length ? `${average(allLeads)} days` : "—", kind: "text" },
      { label: "Overall fill rate", value: fillRatePct(totalOrdered, totalGot), kind: "pct", tone: "emerald" },
    ],
    chart: { kind: "bar", title: "Fill rate by supplier (%)", valueKind: "pct", data: out.slice(0, 8).map((o) => ({ label: o.supplier, value: o.fill })) },
    notes: ["Lead time runs from order date to receipt. Fill rate is units received ÷ units ordered. On time compares receipt with the expected date."],
  };
}

type InvoiceRow = {
  id: string;
  invoice_no: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_gstin: string | null;
  place_of_supply: string | null;
  intra_state: number;
  invoice_date: string;
  due_date: string | null;
  lines: unknown;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  cgst: string;
  sgst: string;
  igst: string;
  grand_total: string;
  amount_paid: string;
  account_manager_name: string | null;
};

async function invoiceRows(deps: ImsDeps, tenantId: number, where: string[], params: Record<string, unknown>): Promise<InvoiceRow[]> {
  return rows<InvoiceRow>(
    deps.db,
    `SELECT id, invoice_no, status, customer_id, customer_name, customer_gstin, place_of_supply, intra_state, invoice_date, due_date, \`lines\`,
            subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, amount_paid, account_manager_name
     FROM ims_invoices WHERE tenant_id = :tenantId AND ${where.join(" AND ")} ORDER BY invoice_date DESC, invoice_no DESC LIMIT 10000`,
    { tenantId, ...params },
  );
}

const invoiceTaxable = (r: InvoiceRow) => round2(money(r.subtotal) - money(r.discount_total));

async function salesRegister(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const where = ["invoice_date BETWEEN :from AND :to", ctx.filters.status === "cancelled" ? "status = 'cancelled'" : "status = 'issued'"];
  const params: Record<string, unknown> = { ...ctx.range };
  if (ctx.filters.partyId) {
    where.push("customer_id = :partyId");
    params.partyId = ctx.filters.partyId;
  }
  if (ctx.filters.q) {
    where.push("(invoice_no LIKE :q OR customer_name LIKE :q)");
    params.q = likeOf(ctx.filters.q);
  }
  const wanted = ["unpaid", "partial", "paid", "overdue"].includes(ctx.filters.status) ? ctx.filters.status : null;
  const docOf = (r: InvoiceRow) => ({ status: r.status, grandTotal: money(r.grand_total), amountPaid: money(r.amount_paid), dueDate: r.due_date ? isoOf(r.due_date) : null });
  const list = (await invoiceRows(deps, ctx.tenantId, where, params)).filter((r) => !wanted || invoiceDisplayStatus(docOf(r), ctx.today) === wanted);
  const byCustomer = new Map<string, number>();
  const t = { taxable: 0, tax: 0, total: 0, paid: 0, balance: 0 };
  const out = list.map((r) => {
    const inv = docOf(r);
    const balance = invoiceBalance(inv);
    const taxable = invoiceTaxable(r);
    t.taxable += taxable;
    t.tax += money(r.tax_total);
    t.total += inv.grandTotal;
    t.paid += inv.amountPaid;
    t.balance += balance;
    bump(byCustomer, r.customer_name, inv.grandTotal);
    return {
      invoiceNo: r.invoice_no,
      date: isoOf(r.invoice_date),
      customer: r.customer_name,
      gstin: r.customer_gstin,
      taxable,
      cgst: round2(money(r.cgst)),
      sgst: round2(money(r.sgst)),
      igst: round2(money(r.igst)),
      total: round2(inv.grandTotal),
      paid: round2(inv.amountPaid),
      balance,
      status: invoiceDisplayStatus(inv, ctx.today).replace(/^./, (c) => c.toUpperCase()),
    };
  });
  return {
    range: ctx.range,
    columns: [
      { key: "invoiceNo", label: "Invoice", kind: "text" },
      { key: "date", label: "Date", kind: "date" },
      { key: "customer", label: "Customer", kind: "text" },
      { key: "gstin", label: "GSTIN", kind: "text" },
      { key: "taxable", label: "Taxable", kind: "money", total: true },
      { key: "cgst", label: "CGST", kind: "money", total: true },
      { key: "sgst", label: "SGST", kind: "money", total: true },
      { key: "igst", label: "IGST", kind: "money", total: true },
      { key: "total", label: "Invoice total", kind: "money", total: true },
      { key: "paid", label: "Received", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money", total: true },
      { key: "status", label: "Status", kind: "status" },
    ],
    rows: out,
    summary: [
      { label: "Invoices", value: out.length, kind: "number" },
      { label: "Taxable value", value: round2(t.taxable), kind: "money", tone: "blue" },
      { label: "GST charged", value: round2(t.tax), kind: "money" },
      { label: "Invoice value", value: round2(t.total), kind: "money", tone: "emerald" },
      { label: "Outstanding", value: round2(t.balance), kind: "money", tone: t.balance > 0 ? "amber" : undefined },
    ],
    chart: { kind: "bar", title: "Top customers by invoice value", valueKind: "money", data: top(byCustomer) },
    notes: ctx.filters.status === "cancelled" ? ["Showing cancelled invoices only."] : ["Issued invoices only — drafts and cancelled invoices are excluded."],
  };
}

function agingStack(map: Map<string, number>): NonNullable<ReportChart>["data"] {
  return AGING_BUCKETS.map((b) => ({ label: b.label, value: round2(map.get(b.key) ?? 0), color: b.color }));
}

async function receivablesAging(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const where = ["status = 'issued'", "grand_total - amount_paid > 0.005"];
  const params: Record<string, unknown> = {};
  if (ctx.filters.partyId) {
    where.push("customer_id = :partyId");
    params.partyId = ctx.filters.partyId;
  }
  const list = await invoiceRows(deps, ctx.tenantId, where, params);
  const buckets = new Map<string, number>();
  const customers = new Set<string>();
  let total = 0;
  let overdue = 0;
  let critical = 0;
  const out = list
    .map((r) => {
      const due = r.due_date ? isoOf(r.due_date) : null;
      const days = daysOverdue(due, isoOf(r.invoice_date), ctx.today);
      const balance = round2(money(r.grand_total) - money(r.amount_paid));
      const isOver = due ? due < ctx.today : false;
      const key = agingBucket(days);
      total += balance;
      if (isOver) overdue += balance;
      if (days > 90) critical += balance;
      bump(buckets, key, balance);
      customers.add(r.customer_name);
      return {
        customer: r.customer_name,
        invoiceNo: r.invoice_no,
        date: isoOf(r.invoice_date),
        due,
        days: isOver || !due ? days : 0,
        bucket: AGING_BUCKETS.find((b) => b.key === key)?.label ?? key,
        total: round2(money(r.grand_total)),
        paid: round2(money(r.amount_paid)),
        balance,
        manager: r.account_manager_name,
      };
    })
    .sort((a, b) => b.days - a.days || b.balance - a.balance);
  return {
    range: null,
    columns: [
      { key: "customer", label: "Customer", kind: "text" },
      { key: "invoiceNo", label: "Invoice", kind: "text" },
      { key: "date", label: "Date", kind: "date" },
      { key: "due", label: "Due", kind: "date" },
      { key: "days", label: "Days overdue", kind: "number" },
      { key: "bucket", label: "Aging", kind: "status" },
      { key: "total", label: "Invoice total", kind: "money", total: true },
      { key: "paid", label: "Received", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money", total: true },
      { key: "manager", label: "Account manager", kind: "text" },
    ],
    rows: out,
    summary: [
      { label: "Outstanding", value: round2(total), kind: "money", tone: "blue" },
      { label: "Overdue", value: round2(overdue), kind: "money", tone: overdue ? "coral" : "emerald" },
      { label: "Over 90 days", value: round2(critical), kind: "money", tone: critical ? "coral" : undefined },
      { label: "Open invoices", value: out.length, kind: "number", hint: `${customers.size} customers` },
    ],
    chart: { kind: "stack", title: "Outstanding by age", valueKind: "money", data: agingStack(buckets) },
    notes: [`As of ${ctx.today}. Age counts from the due date (or invoice date when no due date is set).`],
  };
}

type BillRow = {
  id: string;
  bill_no: string;
  supplier_bill_no: string | null;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  po_no: string | null;
  bill_date: string;
  due_date: string | null;
  lines: unknown;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  amount_paid: string;
  supplier_state?: string | null;
  supplier_gstin?: string | null;
};

async function payablesAging(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const where = ["tenant_id = :tenantId", "status <> 'cancelled'", "grand_total - amount_paid > 0.005"];
  const params: Record<string, unknown> = { tenantId: ctx.tenantId };
  if (ctx.filters.supplierId) {
    where.push("supplier_id = :supplierId");
    params.supplierId = ctx.filters.supplierId;
  }
  const list = await rows<BillRow>(
    deps.db,
    `SELECT id, bill_no, supplier_bill_no, status, supplier_id, supplier_name, po_no, bill_date, due_date, \`lines\`, subtotal, tax_total, grand_total, amount_paid
     FROM ims_bills WHERE ${where.join(" AND ")} ORDER BY due_date IS NULL, due_date LIMIT 10000`,
    params,
  );
  const buckets = new Map<string, number>();
  let total = 0;
  let overdue = 0;
  let dueSoon = 0;
  const out = list.map((r) => {
    const due = r.due_date ? isoOf(r.due_date) : null;
    const bill = { status: r.status, grandTotal: money(r.grand_total), amountPaid: money(r.amount_paid), dueDate: due };
    const balance = billBalance(bill);
    const days = daysOverdue(due, isoOf(r.bill_date), ctx.today);
    const isOver = due ? due < ctx.today : false;
    total += balance;
    if (isOver) overdue += balance;
    else if (due && daysBetween(ctx.today, due) <= 7) dueSoon += balance;
    const key = agingBucket(isOver ? days : 0);
    bump(buckets, key, balance);
    return {
      supplier: r.supplier_name,
      billNo: r.bill_no,
      supplierBillNo: r.supplier_bill_no,
      date: isoOf(r.bill_date),
      due,
      days: isOver ? days : 0,
      bucket: AGING_BUCKETS.find((b) => b.key === key)?.label ?? key,
      total: round2(bill.grandTotal),
      paid: round2(bill.amountPaid),
      balance,
      status: billDisplayStatus(bill, ctx.today).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    };
  });
  return {
    range: null,
    columns: [
      { key: "supplier", label: "Supplier", kind: "text" },
      { key: "billNo", label: "Bill", kind: "text" },
      { key: "supplierBillNo", label: "Supplier bill no.", kind: "text" },
      { key: "date", label: "Bill date", kind: "date" },
      { key: "due", label: "Due", kind: "date" },
      { key: "days", label: "Days overdue", kind: "number" },
      { key: "bucket", label: "Aging", kind: "status" },
      { key: "total", label: "Bill total", kind: "money", total: true },
      { key: "paid", label: "Paid", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money", total: true },
      { key: "status", label: "Status", kind: "status" },
    ],
    rows: out,
    summary: [
      { label: "Payable", value: round2(total), kind: "money", tone: "blue" },
      { label: "Overdue", value: round2(overdue), kind: "money", tone: overdue ? "coral" : "emerald" },
      { label: "Due in 7 days", value: round2(dueSoon), kind: "money", tone: dueSoon ? "amber" : undefined },
      { label: "Open bills", value: out.length, kind: "number" },
    ],
    chart: { kind: "stack", title: "Payable by age past due", valueKind: "money", data: agingStack(buckets) },
    notes: [`As of ${ctx.today}. Bills not yet due sit in the first bucket.`],
  };
}

async function marginReport(deps: ImsDeps, ctx: RunCtx): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const list = await invoiceRows(deps, ctx.tenantId, ["status = 'issued'", "invoice_date BETWEEN :from AND :to"], { ...ctx.range });
  const items = await rows<{ id: string; category: string | null; purchase_price: string }>(deps.db, `SELECT id, category, purchase_price FROM ims_items WHERE tenant_id = :tenantId`, { tenantId: ctx.tenantId });
  const byId = new Map(items.map((i) => [i.id, i]));
  const byCategoryFilter = ctx.filters.category;
  type Agg = { name: string; category: string; qty: number; revenue: number; cost: number; costed: boolean };
  const map = new Map<string, Agg>();
  let uncosted = 0;
  for (const inv of list) {
    for (const raw of json<unknown[]>(inv.lines, [])) {
      const l = normalizeDocLine(raw);
      const item = l.itemId ? byId.get(l.itemId) : undefined;
      const category = item?.category || "Uncategorised";
      if (byCategoryFilter && category !== byCategoryFilter) continue;
      const key = ctx.filters.groupBy === "category" ? category : (l.itemId ?? `name:${l.name}`);
      const a = map.get(key) ?? { name: ctx.filters.groupBy === "category" ? category : l.name, category, qty: 0, revenue: 0, cost: 0, costed: true };
      a.qty += l.qty;
      a.revenue += l.taxable;
      if (item) a.cost += l.qty * money(item.purchase_price);
      else {
        a.costed = false;
        uncosted += l.taxable;
      }
      map.set(key, a);
    }
  }
  const out = [...map.values()]
    .map((a) => ({
      name: a.name,
      category: a.category,
      qty: round3(a.qty),
      revenue: round2(a.revenue),
      cost: round2(a.cost),
      margin: round2(a.revenue - a.cost),
      marginPct: marginPct(a.revenue, a.cost),
    }))
    .sort((a, b) => b.margin - a.margin);
  const revenue = out.reduce((s, o) => s + o.revenue, 0);
  const cost = out.reduce((s, o) => s + o.cost, 0);
  return {
    range: ctx.range,
    columns: [
      { key: "name", label: ctx.filters.groupBy === "category" ? "Category" : "Item", kind: "text" },
      ...(ctx.filters.groupBy === "category" ? [] : [{ key: "category", label: "Category", kind: "text" as const }]),
      { key: "qty", label: "Qty sold", kind: "qty", total: true },
      { key: "revenue", label: "Revenue (taxable)", kind: "money", total: true },
      { key: "cost", label: "Cost", kind: "money", total: true },
      { key: "margin", label: "Gross margin", kind: "money", total: true },
      { key: "marginPct", label: "Margin %", kind: "pct" },
    ],
    rows: out,
    summary: [
      { label: "Revenue", value: round2(revenue), kind: "money", tone: "blue" },
      { label: "Cost of goods", value: round2(cost), kind: "money" },
      { label: "Gross margin", value: round2(revenue - cost), kind: "money", tone: revenue - cost >= 0 ? "emerald" : "coral" },
      { label: "Margin %", value: marginPct(revenue, cost), kind: "pct" },
    ],
    chart: { kind: "bar", title: "Top by gross margin", valueKind: "money", data: out.slice(0, 8).map((o) => ({ label: o.name, value: o.margin })) },
    notes: [
      "Cost uses each item's current purchase price; revenue is the taxable value of issued invoices.",
      ...(uncosted > 0 ? [`₹${round2(uncosted).toLocaleString("en-IN")} of revenue is on lines not linked to an item, so it carries no cost.`] : []),
    ],
  };
}

async function onsiteReport(deps: ImsDeps, ctx: RunCtx, actor: ImsActor): Promise<Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">> {
  const params: Record<string, unknown> = { tenantId: ctx.tenantId, ...ctx.range, userId: ctx.filters.userId };
  const userFilter = ctx.filters.userId !== null ? "AND user_id = :userId" : "";
  const visits = await rows<{ user_id: number; user_name: string | null; visit_date: string; outcome: string | null; next_visit_on: string | null; in_ts: string | number; out_ts: string | number | null }>(
    deps.db,
    `SELECT user_id, user_name, visit_date, outcome, next_visit_on, UNIX_TIMESTAMP(checked_in_at) AS in_ts, UNIX_TIMESTAMP(checked_out_at) AS out_ts
     FROM ims_field_visits WHERE tenant_id = :tenantId AND visit_date BETWEEN :from AND :to ${userFilter} LIMIT 50000`,
    params,
  );
  const pings = await rows<{ user_id: number; ping_date: string; lat: string; lng: string; accuracy_m: number | null; ts: string | number }>(
    deps.db,
    `SELECT user_id, ping_date, lat, lng, accuracy_m, UNIX_TIMESTAMP(created_at) AS ts FROM ims_field_checkins
     WHERE tenant_id = :tenantId AND ping_date BETWEEN :from AND :to AND lat IS NOT NULL ${userFilter} ORDER BY created_at LIMIT 200000`,
    params,
  );
  const tasks = await rows<{ assignee_user_id: number | null; assignee_name: string | null; status: string; task_type: string; amount: string | null; done_date: string | null }>(
    deps.db,
    `SELECT assignee_user_id, assignee_name, status, task_type, amount, DATE(completed_at) AS done_date FROM ims_field_tasks
     WHERE tenant_id = :tenantId ${ctx.filters.userId !== null ? "AND assignee_user_id = :userId" : ""}
       AND (status IN ('open', 'in_progress') OR (status = 'done' AND completed_at >= :from AND completed_at < DATE_ADD(:to, INTERVAL 1 DAY)))`,
    params,
  );
  const members = await listMembers(deps, actor).catch(() => []);
  const names = new Map(members.map((m) => [m.userId, m.name || m.email || `User ${m.userId}`]));
  type Agg = { userId: number; name: string; days: Set<string>; visits: number; minutes: number; km: number; done: number; open: number; collections: number; followUps: number };
  const map = new Map<number, Agg>();
  const agg = (id: number, name: string | null) => {
    const a = map.get(id) ?? { userId: id, name: names.get(id) ?? name ?? `User ${id}`, days: new Set<string>(), visits: 0, minutes: 0, km: 0, done: 0, open: 0, collections: 0, followUps: 0 };
    map.set(id, a);
    return a;
  };
  const now = Date.now();
  for (const v of visits) {
    const a = agg(Number(v.user_id), v.user_name);
    a.visits += 1;
    a.days.add(isoOf(v.visit_date));
    a.minutes += minutesBetween(Number(v.in_ts) * 1000, v.out_ts ? Number(v.out_ts) * 1000 : now);
    if (v.outcome === "follow_up" || v.next_visit_on) a.followUps += 1;
  }
  const trails = new Map<string, Array<{ lat: number; lng: number; accuracy: number | null; at: number }>>();
  for (const p of pings) {
    const key = `${p.user_id}|${isoOf(p.ping_date)}`;
    const list = trails.get(key) ?? [];
    list.push({ lat: Number(p.lat), lng: Number(p.lng), accuracy: p.accuracy_m == null ? null : Number(p.accuracy_m), at: Number(p.ts) * 1000 });
    trails.set(key, list);
  }
  for (const [key, list] of trails) {
    const [id, day] = key.split("|");
    const a = agg(Number(id), null);
    a.km += trackKm(list);
    a.days.add(day);
  }
  for (const t of tasks) {
    if (t.assignee_user_id == null) continue;
    const a = agg(Number(t.assignee_user_id), t.assignee_name);
    if (t.status === "done") {
      a.done += 1;
      if (t.task_type === "collection") a.collections += money(t.amount);
    } else a.open += 1;
  }
  const aggs = [...map.values()].sort((a, b) => b.visits - a.visits || b.km - a.km);
  const out = aggs.map((a) => ({
    member: a.name,
    days: a.days.size,
    visits: a.visits,
    onSite: durationLabel(a.minutes),
    avgVisit: a.visits ? durationLabel(a.minutes / a.visits) : "—",
    km: round2(a.km),
    done: a.done,
    open: a.open,
    collections: round2(a.collections),
    followUps: a.followUps,
  }));
  const totalMinutes = aggs.reduce((s, a) => s + a.minutes, 0);
  return {
    range: ctx.range,
    columns: [
      { key: "member", label: "Team member", kind: "text" },
      { key: "days", label: "Active days", kind: "number" },
      { key: "visits", label: "Visits", kind: "number", total: true },
      { key: "onSite", label: "Time on site", kind: "text" },
      { key: "avgVisit", label: "Avg visit", kind: "text" },
      { key: "km", label: "Km travelled", kind: "number", total: true },
      { key: "done", label: "Tasks done", kind: "number", total: true },
      { key: "open", label: "Open tasks", kind: "number", total: true },
      { key: "collections", label: "Collections", kind: "money", total: true },
      { key: "followUps", label: "Follow-ups", kind: "number", total: true },
    ],
    rows: out,
    summary: [
      { label: "Visits", value: out.reduce((s, o) => s + o.visits, 0), kind: "number", tone: "blue" },
      { label: "Time on site", value: durationLabel(totalMinutes), kind: "text" },
      { label: "Km travelled", value: round2(out.reduce((s, o) => s + o.km, 0)), kind: "number" },
      { label: "Tasks done", value: out.reduce((s, o) => s + o.done, 0), kind: "number", tone: "emerald" },
      { label: "Collections", value: round2(out.reduce((s, o) => s + o.collections, 0)), kind: "money" },
    ],
    chart: { kind: "bar", title: "Visits by team member", valueKind: "number", data: out.slice(0, 10).map((o) => ({ label: o.member, value: o.visits })) },
    notes: ["Km come from shared live-location pings (jitter and inaccurate fixes are ignored). Collections are completed collection tasks."],
  };
}

export async function runReport(deps: ImsDeps, actor: ImsActor, type: ReportType, input: { period?: string; from?: string; to?: string; filters?: Record<string, unknown> }): Promise<ReportResult> {
  const settings = await getSettings(deps, actor.tenantId);
  const today = todayISO();
  const range = periodRange(input.period || "30d", today, settings.fiscalYearStart, { from: input.from, to: input.to });
  const f = input.filters ?? {};
  const str = (k: string, max = 80) => (typeof f[k] === "string" ? String(f[k]).trim().slice(0, max) : "");
  const userIdRaw = Number(f.userId);
  const daysRaw = Number(f.days);
  const filters: RunFilters = {
    category: str("category"),
    supplierId: str("supplierId", 36),
    partyId: str("partyId", 36),
    userId: f.userId !== undefined && f.userId !== "" && Number.isInteger(userIdRaw) ? userIdRaw : null,
    status: str("status", 24),
    groupBy: str("groupBy") === "category" ? "category" : "item",
    days: Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(3650, Math.round(daysRaw)) : 90,
    q: str("q", 120),
  };
  const ctx: RunCtx = { tenantId: actor.tenantId, today, range, filters, settings };
  let body: Omit<ReportResult, "type" | "title" | "asOf" | "generatedAt">;
  switch (type) {
    case "stockin":
      body = await stockFlow(deps, ctx, "in");
      break;
    case "stockout":
      body = await stockFlow(deps, ctx, "out");
      break;
    case "fullstock":
      body = await fullStock(deps, ctx);
      break;
    case "damage":
      body = await damageReport(deps, ctx);
      break;
    case "po":
      body = await poReport(deps, ctx);
      break;
    case "sales":
      body = await salesRegister(deps, ctx);
      break;
    case "receivables":
      body = await receivablesAging(deps, ctx);
      break;
    case "payables":
      body = await payablesAging(deps, ctx);
      break;
    case "margin":
      body = await marginReport(deps, ctx);
      break;
    case "suppliers":
      body = await supplierReport(deps, ctx);
      break;
    case "onsite":
      body = await onsiteReport(deps, ctx, actor);
      break;
    case "lowstock":
      body = await lowStock(deps, ctx);
      break;
    case "deadstock":
      body = await deadStock(deps, ctx);
      break;
  }
  return { type, title: typeLabel(type), asOf: today, generatedAt: new Date().toISOString(), ...body };
}

/* ---------- Saved & scheduled reports ---------- */

type SavedRow = {
  id: string;
  name: string;
  report_type: string;
  params: unknown;
  format: string;
  schedule: string;
  recipients: unknown;
  status: string;
  approval_status: string | null;
  approved_by_name: string | null;
  review_note: string | null;
  sent_to: string | null;
  created_by: number | null;
  created_by_name: string | null;
  last_run_ts: string | number | null;
  approved_ts: string | number | null;
  sent_ts: string | number | null;
  created_ts: string | number | null;
  updated_ts: string | number | null;
};

const SELECT_SAVED = `SELECT r.*, UNIX_TIMESTAMP(r.last_run_at) AS last_run_ts, UNIX_TIMESTAMP(r.approved_at) AS approved_ts, UNIX_TIMESTAMP(r.sent_at) AS sent_ts,
  UNIX_TIMESTAMP(r.created_at) AS created_ts, UNIX_TIMESTAMP(r.updated_at) AS updated_ts FROM ims_reports r`;

const epochIso = (ts: unknown): string | null => {
  const n = Number(ts);
  return ts !== null && ts !== undefined && Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

type SavedParams = { period: string; from?: string | null; to?: string | null; filters: Record<string, string> };

function mapSaved(r: SavedRow, today = todayISO()) {
  const params = json<Partial<SavedParams>>(r.params, {});
  const lastRunAt = epochIso(r.last_run_ts);
  const active = r.status !== "paused";
  return {
    id: r.id,
    name: r.name,
    type: r.report_type,
    typeLabel: typeLabel(r.report_type),
    period: params.period || "30d",
    from: params.from ?? null,
    to: params.to ?? null,
    filters: params.filters && typeof params.filters === "object" ? params.filters : {},
    format: r.format === "csv" ? "csv" : "xlsx",
    schedule: r.schedule,
    active,
    recipients: json<string[]>(r.recipients, []).filter((e) => typeof e === "string"),
    approvalStatus: (r.approval_status || "draft") as ReportApprovalStatus,
    approvedByName: r.approved_by_name,
    approvedAt: epochIso(r.approved_ts),
    reviewNote: r.review_note,
    sentTo: r.sent_to,
    sentAt: epochIso(r.sent_ts),
    lastRunAt,
    nextRunOn: active ? nextReportRun(r.schedule, lastRunAt ? lastRunAt.slice(0, 10) : null, today) : null,
    createdBy: r.created_by == null ? null : Number(r.created_by),
    createdByName: r.created_by_name,
    createdAt: epochIso(r.created_ts),
    updatedAt: epochIso(r.updated_ts),
  };
}

const SavedInput = z.object({
  name: z.string().trim().min(2, "Give the report a name").max(200),
  type: z.enum(REPORT_TYPES.map((t) => t.key) as [ReportType, ...ReportType[]]),
  period: z.enum(PERIODS).default("30d"),
  from: isoDate.nullable().optional(),
  to: isoDate.nullable().optional(),
  filters: z.record(z.string(), z.string().max(120)).default({}),
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
  schedule: z.enum(REPORT_SCHEDULES).default("none"),
  recipients: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).max(20).default([]),
  active: z.boolean().default(true),
});

async function loadSaved(deps: ImsDeps, tenantId: number, id: string): Promise<SavedRow> {
  const r = await one<SavedRow>(deps.db, `${SELECT_SAVED} WHERE r.tenant_id = :tenantId AND r.id = :id LIMIT 1`, { tenantId, id });
  if (!r) throw notFound("Saved report");
  return r;
}

function requireOwnerOrApprover(res: Response, actor: ImsActor, r: SavedRow): void {
  const mine = r.created_by != null && Number(r.created_by) === actor.userId;
  if (!mine && !can(res, "approvals")) throw forbidden("Only the report's creator or an approver can change it");
}

const savedPath = (id: string) => `?m=reports&open=${id}`;

/* ---------- GST ---------- */

const UQC: Record<string, string> = {
  pcs: "PCS-PIECES",
  nos: "NOS-NUMBERS",
  box: "BOX-BOX",
  pack: "PAC-PACKS",
  set: "SET-SETS",
  mtr: "MTR-METERS",
  m: "MTR-METERS",
  roll: "ROL-ROLLS",
  kg: "KGS-KILOGRAMS",
  ltr: "LTR-LITRES",
  l: "LTR-LITRES",
  pair: "PRS-PAIRS",
  btl: "BTL-BOTTLES",
  bottle: "BTL-BOTTLES",
};
const uqcOf = (unit: string) => UQC[unit.trim().toLowerCase()] ?? (unit ? `OTH-${unit.toUpperCase()}` : "OTH-OTHERS");

function intraFor(seller: { gstin: string | null; state: string | null }, party: { gstin?: string | null; state?: string | null }): boolean {
  const a = gstinStateCode(seller.gstin);
  const b = gstinStateCode(party.gstin);
  if (a && b) return a === b;
  return isIntraState(seller.state, party.state);
}

type IssuedLine = DocLine & { intraState: boolean; invoiceId: string };

async function gstOutward(deps: ImsDeps, tenantId: number, range: { from: string; to: string }) {
  const all = await invoiceRows(deps, tenantId, ["invoice_date BETWEEN :from AND :to", "status IN ('issued', 'cancelled')"], { ...range });
  const issued = all.filter((r) => r.status === "issued");
  const lines: IssuedLine[] = issued.flatMap((r) =>
    json<unknown[]>(r.lines, []).map((raw) => ({ ...normalizeDocLine(raw), intraState: Boolean(r.intra_state), invoiceId: r.id })),
  );
  return { all, issued, lines };
}

const asc = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

async function gstSummary(deps: ImsDeps, actor: ImsActor, range: { from: string; to: string }) {
  const settings = await getSettings(deps, actor.tenantId);
  const seller = { gstin: settings.gstin, state: settings.state, stateCode: settings.stateCode, businessName: settings.businessName };
  const { all, issued, lines } = await gstOutward(deps, actor.tenantId, range);
  const warnings: string[] = [];
  if (!isValidGstin(settings.gstin)) warnings.push("Your business GSTIN is missing or invalid — add it in Settings → Business profile.");

  const linesByInvoice = new Map<string, IssuedLine[]>();
  for (const l of lines) linesByInvoice.set(l.invoiceId, [...(linesByInvoice.get(l.invoiceId) ?? []), l]);

  const b2b: Array<Record<string, string | number>> = [];
  const b2cl: Array<Record<string, string | number>> = [];
  const b2csMap = new Map<string, { pos: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  const totals = { b2b: { invoices: 0, taxable: 0, tax: 0, value: 0 }, b2cl: { invoices: 0, taxable: 0, tax: 0, value: 0 }, b2cs: { invoices: 0, taxable: 0, tax: 0, value: 0 } };
  let invalidGstin = 0;
  for (const inv of issued) {
    const gstin = String(inv.customer_gstin ?? "").trim().toUpperCase();
    const hasGstin = gstin.length > 0;
    if (hasGstin && !isValidGstin(gstin)) invalidGstin += 1;
    const intra = Boolean(inv.intra_state);
    const value = round2(money(inv.grand_total));
    const pos = inv.place_of_supply || settings.state || "—";
    const invLines = linesByInvoice.get(inv.id) ?? [];
    const rates = rateWiseSummary(invLines.length ? invLines : [{ gstRate: 0, taxable: invoiceTaxable(inv), tax: money(inv.tax_total), intraState: intra }]);
    const taxable = invoiceTaxable(inv);
    const tax = round2(money(inv.tax_total));
    const date = isoOf(inv.invoice_date);
    if (hasGstin) {
      totals.b2b.invoices += 1;
      totals.b2b.taxable += taxable;
      totals.b2b.tax += tax;
      totals.b2b.value += value;
      for (const r of rates) {
        b2b.push({
          gstin,
          receiverName: inv.customer_name,
          invoiceNo: inv.invoice_no,
          invoiceDate: date,
          invoiceValue: value,
          placeOfSupply: pos,
          reverseCharge: "N",
          invoiceType: "Regular B2B",
          rate: r.rate,
          taxableValue: r.taxable,
          igst: r.igst,
          cgst: r.cgst,
          sgst: r.sgst,
          cess: 0,
        });
      }
    } else if (isB2CLarge(value, intra, false)) {
      totals.b2cl.invoices += 1;
      totals.b2cl.taxable += taxable;
      totals.b2cl.tax += tax;
      totals.b2cl.value += value;
      for (const r of rates) b2cl.push({ invoiceNo: inv.invoice_no, invoiceDate: date, invoiceValue: value, placeOfSupply: pos, rate: r.rate, taxableValue: r.taxable, igst: r.igst, cess: 0 });
    } else {
      totals.b2cs.invoices += 1;
      totals.b2cs.taxable += taxable;
      totals.b2cs.tax += tax;
      totals.b2cs.value += value;
      for (const r of rates) {
        const key = `${pos}|${r.rate}`;
        const row = b2csMap.get(key) ?? { pos, rate: r.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        row.taxable = round2(row.taxable + r.taxable);
        row.cgst = round2(row.cgst + r.cgst);
        row.sgst = round2(row.sgst + r.sgst);
        row.igst = round2(row.igst + r.igst);
        b2csMap.set(key, row);
      }
    }
  }
  if (invalidGstin) warnings.push(`${invalidGstin} invoice(s) carry a GSTIN that doesn't match the GSTIN format — fix the customer GSTIN before filing.`);
  const missingHsn = lines.filter((l) => !l.hsn).length;
  if (missingHsn) warnings.push(`${missingHsn} invoice line(s) have no HSN code — they appear under "—" in the HSN summary.`);
  const b2cs = [...b2csMap.values()]
    .sort((a, b) => asc(a.pos, b.pos) || a.rate - b.rate)
    .map((r) => ({ type: "OE", placeOfSupply: r.pos, rate: r.rate, taxableValue: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: 0 }));

  // Credit notes: customer returns. Return lines carry no tax, so tax is estimated at each item's GST rate.
  const returns = await rows<{ id: string; return_no: string; party_id: string | null; party_name: string; ref_doc_id: string | null; ref_doc_no: string | null; return_date: string; lines: unknown; total: string; refund_status: string }>(
    deps.db,
    `SELECT id, return_no, party_id, party_name, ref_doc_id, ref_doc_no, return_date, \`lines\`, total, refund_status FROM ims_returns
     WHERE tenant_id = :tenantId AND kind = 'customer' AND status <> 'cancelled' AND return_date BETWEEN :from AND :to ORDER BY return_date, return_no`,
    { tenantId: actor.tenantId, ...range },
  );
  const itemRates = new Map(
    (await rows<{ id: string; gst_rate: string }>(deps.db, `SELECT id, gst_rate FROM ims_items WHERE tenant_id = :tenantId`, { tenantId: actor.tenantId })).map((i) => [i.id, money(i.gst_rate)]),
  );
  const partyIds = [...new Set(returns.map((r) => r.party_id).filter((x): x is string => Boolean(x)))];
  const parties = partyIds.length
    ? await rows<{ id: string; gstin: string | null; state: string | null }>(deps.db, `SELECT id, gstin, state FROM ims_parties WHERE tenant_id = :tenantId AND id IN (${partyIds.map((_, i) => `:p${i}`).join(", ")})`, {
        tenantId: actor.tenantId,
        ...Object.fromEntries(partyIds.map((id, i) => [`p${i}`, id])),
      })
    : [];
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const invIntra = new Map(all.map((i) => [i.id, Boolean(i.intra_state)]));
  const creditNotes = returns.map((r) => {
    const party = r.party_id ? partyById.get(r.party_id) : undefined;
    const intra = r.ref_doc_id && invIntra.has(r.ref_doc_id) ? Boolean(invIntra.get(r.ref_doc_id)) : intraFor(seller, { gstin: party?.gstin, state: party?.state });
    let taxable = 0;
    let tax = 0;
    for (const raw of json<Array<Record<string, unknown>>>(r.lines, [])) {
      const amount = round2(money(raw.amount) || money(raw.qty) * money(raw.rate));
      const rate = itemRates.get(String(raw.itemId ?? raw.item_id ?? "")) ?? settings.defaultGstRate;
      taxable += amount;
      tax += round2((amount * rate) / 100);
    }
    if (!taxable) taxable = round2(money(r.total));
    const s = splitTax(tax, intra);
    return {
      noteNo: r.return_no,
      noteDate: isoOf(r.return_date),
      noteType: "C",
      party: r.party_name,
      gstin: party?.gstin ?? "",
      registered: isValidGstin(party?.gstin) ? "Registered (CDNR)" : "Unregistered (CDNUR)",
      originalInvoice: r.ref_doc_no ?? "",
      taxableValue: round2(taxable),
      cgst: s.cgst,
      sgst: s.sgst,
      igst: s.igst,
      noteValue: round2(taxable + tax),
    };
  });
  if (creditNotes.length) warnings.push("Credit-note tax is estimated from each returned item's GST rate — confirm against the credit notes actually issued.");

  const outRaw = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
  for (const inv of issued) {
    outRaw.taxable += invoiceTaxable(inv);
    outRaw.cgst += money(inv.cgst);
    outRaw.sgst += money(inv.sgst);
    outRaw.igst += money(inv.igst);
  }
  const cn = creditNotes.reduce((s, c) => ({ taxable: s.taxable + c.taxableValue, cgst: s.cgst + c.cgst, sgst: s.sgst + c.sgst, igst: s.igst + c.igst }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
  const outward = {
    taxable: round2(outRaw.taxable - cn.taxable),
    cgst: round2(outRaw.cgst - cn.cgst),
    sgst: round2(outRaw.sgst - cn.sgst),
    igst: round2(outRaw.igst - cn.igst),
  };

  // Inward supplies: supplier bills are the ITC basis; received POs not yet billed are shown as provisional only.
  const bills = await rows<BillRow>(
    deps.db,
    `SELECT b.id, b.bill_no, b.supplier_bill_no, b.status, b.supplier_id, b.supplier_name, b.po_no, b.bill_date, b.due_date, b.lines, b.subtotal, b.tax_total, b.grand_total, b.amount_paid,
            p.state AS supplier_state, p.gstin AS supplier_gstin
     FROM ims_bills b LEFT JOIN ims_parties p ON p.id = b.supplier_id AND p.tenant_id = b.tenant_id
     WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date BETWEEN :from AND :to ORDER BY b.bill_date, b.bill_no`,
    { tenantId: actor.tenantId, ...range },
  );
  const itc = { cgst: 0, sgst: 0, igst: 0 };
  const inwardLines: Array<{ gstRate: number; taxable: number; tax: number; intraState: boolean }> = [];
  const inward = { bills: bills.length, taxable: 0, tax: 0, value: 0, ineligibleTax: 0, unregistered: 0 };
  const billRows = bills.map((b) => {
    const intra = intraFor(seller, { gstin: b.supplier_gstin, state: b.supplier_state });
    const taxable = round2(money(b.subtotal));
    const tax = round2(money(b.tax_total));
    const eligible = isValidGstin(b.supplier_gstin);
    const s = splitTax(tax, intra);
    inward.taxable += taxable;
    inward.tax += tax;
    inward.value += money(b.grand_total);
    if (eligible) {
      itc.cgst += s.cgst;
      itc.sgst += s.sgst;
      itc.igst += s.igst;
    } else {
      inward.ineligibleTax += tax;
      inward.unregistered += 1;
    }
    const bl = json<unknown[]>(b.lines, []).map(normalizeDocLine);
    if (bl.length) for (const l of bl) inwardLines.push({ gstRate: l.gstRate, taxable: l.taxable, tax: l.tax, intraState: intra });
    else inwardLines.push({ gstRate: taxable > 0 ? round2((tax / taxable) * 100) : 0, taxable, tax, intraState: intra });
    return {
      billNo: b.bill_no,
      supplierBillNo: b.supplier_bill_no ?? "",
      billDate: isoOf(b.bill_date),
      supplier: b.supplier_name,
      gstin: b.supplier_gstin ?? "",
      taxableValue: taxable,
      cgst: s.cgst,
      sgst: s.sgst,
      igst: s.igst,
      itcEligible: eligible ? "Yes" : "No — supplier GSTIN missing",
      billValue: round2(money(b.grand_total)),
    };
  });
  if (inward.unregistered) warnings.push(`${inward.unregistered} bill(s) are from suppliers without a valid GSTIN — their tax is excluded from ITC.`);

  const pos = await rows<PoRow & { supplier_state: string | null; supplier_gstin: string | null }>(
    deps.db,
    `SELECT po.id, po.po_no, po.status, po.supplier_id, po.supplier_name, po.order_date, po.expected_date, po.lines, po.grand_total, po.received_at, po.bill_id, po.subtotal, po.tax_total,
            p.state AS supplier_state, p.gstin AS supplier_gstin
     FROM ims_purchase_orders po LEFT JOIN ims_parties p ON p.id = po.supplier_id AND p.tenant_id = po.tenant_id
     WHERE po.tenant_id = :tenantId AND po.status IN ('received', 'partially_received') AND po.bill_id IS NULL
       AND po.received_at IS NOT NULL AND DATE(po.received_at) BETWEEN :from AND :to`,
    { tenantId: actor.tenantId, ...range },
  );
  const provisional = pos.map((p) => {
    const q = poQty(p.lines);
    const share = q.orderedValue > 0 ? q.receivedValue / q.orderedValue : 1;
    const taxable = round2(money(p.subtotal) * share);
    const tax = round2(money(p.tax_total) * share);
    return { poNo: p.po_no, supplier: p.supplier_name, receivedOn: isoOf(p.received_at), taxableValue: taxable, tax, ...splitTax(tax, intraFor(seller, { gstin: p.supplier_gstin, state: p.supplier_state })) };
  });

  const itcRounded = { cgst: round2(itc.cgst), sgst: round2(itc.sgst), igst: round2(itc.igst) };
  const net = netGstPayable(outward, itcRounded);
  const outwardRate = rateWiseSummary(lines);
  const inwardRate = rateWiseSummary(inwardLines);
  const cancelled = all.filter((r) => r.status === "cancelled");
  const numbers = all.map((r) => r.invoice_no).sort(asc);
  return {
    range,
    seller,
    b2b: { rows: b2b, ...roundTotals(totals.b2b) },
    b2cl: { rows: b2cl, ...roundTotals(totals.b2cl) },
    b2cs: { rows: b2cs, ...roundTotals(totals.b2cs) },
    creditNotes: {
      rows: creditNotes,
      count: creditNotes.length,
      taxable: round2(cn.taxable),
      cgst: round2(cn.cgst),
      sgst: round2(cn.sgst),
      igst: round2(cn.igst),
      tax: round2(cn.cgst + cn.sgst + cn.igst),
    },
    documents: { from: numbers[0] ?? null, to: numbers[numbers.length - 1] ?? null, total: all.length, cancelled: cancelled.length, issued: issued.length, creditNotes: creditNotes.length },
    gross: { taxable: round2(outRaw.taxable), cgst: round2(outRaw.cgst), sgst: round2(outRaw.sgst), igst: round2(outRaw.igst), tax: round2(outRaw.cgst + outRaw.sgst + outRaw.igst) },
    outward: { ...outward, tax: round2(outward.cgst + outward.sgst + outward.igst) },
    outwardRate,
    inward: {
      bills: inward.bills,
      taxable: round2(inward.taxable),
      tax: round2(inward.tax),
      value: round2(inward.value),
      ineligibleTax: round2(inward.ineligibleTax),
      rows: billRows,
    },
    inwardRate,
    itc: { ...itcRounded, total: round2(itcRounded.cgst + itcRounded.sgst + itcRounded.igst) },
    provisional: { rows: provisional, taxable: round2(provisional.reduce((s, p) => s + p.taxableValue, 0)), tax: round2(provisional.reduce((s, p) => s + p.tax, 0)) },
    net,
    warnings,
  };
}

function roundTotals(t: { invoices: number; taxable: number; tax: number; value: number }) {
  return { invoices: t.invoices, taxable: round2(t.taxable), tax: round2(t.tax), value: round2(t.value) };
}

async function gstHsn(deps: ImsDeps, actor: ImsActor, range: { from: string; to: string }) {
  const { lines } = await gstOutward(deps, actor.tenantId, range);
  const names = new Map<string, string>();
  for (const l of lines) {
    const key = `${l.hsn || "—"}|${l.gstRate}`;
    if (!names.has(key)) names.set(key, l.name);
  }
  const intra = hsnSummary(lines.filter((l) => l.intraState));
  const inter = hsnSummary(lines.filter((l) => !l.intraState));
  const map = new Map<string, { hsn: string; description: string; uqc: string; qty: number; rate: number; taxable: number; igst: number; cgst: number; sgst: number }>();
  const add = (r: ReturnType<typeof hsnSummary>[number], intraState: boolean) => {
    const key = `${r.hsn}|${r.gstRate}`;
    const row = map.get(key) ?? { hsn: r.hsn, description: names.get(key) ?? "", uqc: uqcOf(r.unit), qty: 0, rate: r.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    const s = splitTax(r.tax, intraState);
    row.qty = round3(row.qty + r.qty);
    row.taxable = round2(row.taxable + r.taxable);
    row.igst = round2(row.igst + s.igst);
    row.cgst = round2(row.cgst + s.cgst);
    row.sgst = round2(row.sgst + s.sgst);
    map.set(key, row);
  };
  intra.forEach((r) => add(r, true));
  inter.forEach((r) => add(r, false));
  const out = [...map.values()]
    .sort((a, b) => asc(a.hsn, b.hsn) || a.rate - b.rate)
    .map((r) => ({
      hsn: r.hsn,
      description: r.description,
      uqc: r.uqc,
      totalQuantity: r.qty,
      totalValue: round2(r.taxable + r.igst + r.cgst + r.sgst),
      rate: r.rate,
      taxableValue: r.taxable,
      igst: r.igst,
      cgst: r.cgst,
      sgst: r.sgst,
      cess: 0,
    }));
  const sum = (k: "totalValue" | "taxableValue" | "igst" | "cgst" | "sgst") => round2(out.reduce((s, r) => s + r[k], 0));
  return {
    range,
    rows: out,
    totals: { codes: new Set(out.map((r) => r.hsn)).size, totalValue: sum("totalValue"), taxableValue: sum("taxableValue"), igst: sum("igst"), cgst: sum("cgst"), sgst: sum("sgst") },
    missingHsnLines: lines.filter((l) => !l.hsn).length,
  };
}

async function gstItemsCheck(deps: ImsDeps, actor: ImsActor) {
  const settings = await getSettings(deps, actor.tenantId);
  const catHsn = new Map(settings.taxonomy.categories.map((c) => [c.name.toLowerCase(), c]));
  const list = await rows<{ id: string; name: string; sku: string | null; category: string | null; hsn: string | null; gst_rate: string; current_stock: string }>(
    deps.db,
    `SELECT id, name, sku, category, hsn, gst_rate, current_stock FROM ims_items WHERE tenant_id = :tenantId AND active = 1 ORDER BY name LIMIT 20000`,
    { tenantId: actor.tenantId },
  );
  let missingHsn = 0;
  let badHsn = 0;
  let rateIssues = 0;
  const flagged = list
    .map((i) => {
      const gstRate = money(i.gst_rate);
      const issues = itemGstIssues({ hsn: i.hsn, gstRate });
      if (issues.some((s) => s.startsWith("Missing HSN"))) missingHsn += 1;
      if (issues.some((s) => s.startsWith("HSN should"))) badHsn += 1;
      if (issues.some((s) => s.startsWith("GST"))) rateIssues += 1;
      const cat = i.category ? catHsn.get(i.category.toLowerCase()) : undefined;
      return {
        id: i.id,
        name: i.name,
        sku: i.sku,
        category: i.category,
        hsn: i.hsn,
        gstRate,
        stock: round3(money(i.current_stock)),
        issues,
        suggestedHsn: !i.hsn && cat?.hsn ? cat.hsn : null,
        suggestedRate: cat?.gstRate ?? null,
      };
    })
    .filter((i) => i.issues.length);
  return {
    items: flagged,
    summary: { total: list.length, complete: list.length - flagged.length, flagged: flagged.length, missingHsn, badHsn, rateIssues, completenessPct: list.length ? round2(((list.length - flagged.length) / list.length) * 100) : 100 },
  };
}

function gstRange(req: Request, settings: ImsSettings) {
  return periodRange(qstr(req.query.period) || "lastmonth", todayISO(), settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
}

/* ---------- Routes ---------- */

export function registerReports(router: Router, deps: ImsDeps): void {
  router.get("/reports/meta", async (_req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"]);
    const [cats, suppliers, customers, members] = await Promise.all([
      rows<{ category: string }>(deps.db, `SELECT DISTINCT category FROM ims_items WHERE tenant_id = :tenantId AND active = 1 AND category IS NOT NULL AND category <> '' ORDER BY category`, { tenantId: actor.tenantId }),
      rows<{ id: string; name: string }>(deps.db, `SELECT id, name FROM ims_parties WHERE tenant_id = :tenantId AND active = 1 AND kind IN ('supplier', 'both') ORDER BY name LIMIT 2000`, { tenantId: actor.tenantId }),
      rows<{ id: string; name: string }>(deps.db, `SELECT id, name FROM ims_parties WHERE tenant_id = :tenantId AND active = 1 AND kind IN ('customer', 'both') ORDER BY name LIMIT 2000`, { tenantId: actor.tenantId }),
      listMembers(deps, actor).catch(() => []),
    ]);
    res.json({
      types: REPORT_TYPES,
      categories: cats.map((c) => c.category),
      suppliers,
      customers,
      members: members.filter((m) => m.active).map((m) => ({ userId: m.userId, name: m.name || m.email || `User ${m.userId}` })),
      canApprove: can(res, "approvals"),
    });
  });

  router.get("/reports/run", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"]);
    const type = qstr(req.query.type, 32);
    if (!isReportType(type)) throw new ImsError(400, "Choose a report type");
    const filters: Record<string, string> = {};
    for (const k of ["category", "supplierId", "partyId", "userId", "status", "groupBy", "days", "q"]) {
      const v = qstr(req.query[k], 120);
      if (v) filters[k] = v;
    }
    res.json({ report: await runReport(deps, actor, type, { period: qstr(req.query.period, 16), from: qstr(req.query.from, 10), to: qstr(req.query.to, 10), filters }) });
  });

  router.get("/reports/saved", async (_req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"]);
    const today = todayISO();
    const list = await rows<SavedRow>(deps.db, `${SELECT_SAVED} WHERE r.tenant_id = :tenantId ORDER BY r.updated_at DESC LIMIT 500`, { tenantId: actor.tenantId });
    res.json({ reports: list.map((r) => mapSaved(r, today)), canApprove: can(res, "approvals") });
  });

  router.get("/reports/saved/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"]);
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, req.params.id)) });
  });

  router.post("/reports/saved", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "reports");
    const input = parse(SavedInput, req.body);
    if (input.period === "custom" && (!input.from || !input.to || input.from > input.to)) throw new ImsError(400, "Pick a valid custom date range");
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_reports (id, tenant_id, name, report_type, params, format, schedule, recipients, status, approval_status, created_by, created_by_name)
       VALUES (:id, :tenantId, :name, :type, :params, :format, :schedule, :recipients, :status, 'draft', :createdBy, :createdByName)`,
      {
        id,
        tenantId: actor.tenantId,
        name: input.name,
        type: input.type,
        params: JSON.stringify({ period: input.period, from: input.from ?? null, to: input.to ?? null, filters: input.filters }),
        format: input.format,
        schedule: input.schedule,
        recipients: JSON.stringify([...new Set(input.recipients)]),
        status: input.active ? "active" : "paused",
        createdBy: actor.userId,
        createdByName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, { type: "report.created", entityType: "report", entityId: id, summary: `Saved report "${input.name}" (${typeLabel(input.type)})`, payload: { schedule: input.schedule } });
    res.status(201).json({ report: mapSaved(await loadSaved(deps, actor.tenantId, id)) });
  });

  router.patch("/reports/saved/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "reports");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    requireOwnerOrApprover(res, actor, row);
    const patch = parsePatch(SavedInput, req.body);
    const current = mapSaved(row);
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id: row.id };
    if (patch.name !== undefined) {
      sets.push("name = :name");
      params.name = patch.name;
    }
    if (patch.type !== undefined) {
      sets.push("report_type = :type");
      params.type = patch.type;
    }
    if (patch.period !== undefined || patch.from !== undefined || patch.to !== undefined || patch.filters !== undefined) {
      const next = { period: patch.period ?? current.period, from: patch.from !== undefined ? patch.from : current.from, to: patch.to !== undefined ? patch.to : current.to, filters: patch.filters ?? current.filters };
      if (next.period === "custom" && (!next.from || !next.to || next.from > next.to)) throw new ImsError(400, "Pick a valid custom date range");
      sets.push("params = :params");
      params.params = JSON.stringify(next);
    }
    if (patch.format !== undefined) {
      sets.push("format = :format");
      params.format = patch.format;
    }
    if (patch.schedule !== undefined) {
      sets.push("schedule = :schedule");
      params.schedule = patch.schedule;
    }
    if (patch.recipients !== undefined) {
      sets.push("recipients = :recipients");
      params.recipients = JSON.stringify([...new Set(patch.recipients)]);
    }
    if (patch.active !== undefined) {
      sets.push("status = :status");
      params.status = patch.active ? "active" : "paused";
    }
    const contentChanged = ["name", "type", "period", "from", "to", "filters", "format"].some((k) => k in patch);
    const reset = contentChanged && (current.approvalStatus === "approved" || current.approvalStatus === "sent");
    if (reset) sets.push("approval_status = 'draft'", "approved_by = NULL", "approved_by_name = NULL", "approved_at = NULL");
    if (sets.length) {
      await exec(deps.db, `UPDATE ims_reports SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
      await recordEvent(deps, actor, {
        type: "report.updated",
        entityType: "report",
        entityId: row.id,
        summary: `Updated report "${patch.name ?? row.name}"${reset ? " — back to draft for re-approval" : ""}`,
        payload: { fields: Object.keys(patch) },
      });
    }
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, row.id)), resetToDraft: reset });
  });

  router.delete("/reports/saved/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "reports");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    requireOwnerOrApprover(res, actor, row);
    await exec(deps.db, `DELETE FROM ims_reports WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "report.deleted", entityType: "report", entityId: row.id, summary: `Deleted report "${row.name}"` });
    res.status(204).end();
  });

  router.post("/reports/saved/:id/submit", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "reports");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    requireOwnerOrApprover(res, actor, row);
    if ((row.approval_status || "draft") !== "draft") throw conflict("Only a draft can be submitted for approval");
    await exec(deps.db, `UPDATE ims_reports SET approval_status = 'pending_approval', review_note = NULL WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, {
      type: "report.submitted",
      entityType: "report",
      entityId: row.id,
      summary: `Submitted report "${row.name}" for approval`,
      notice: { kind: "approval_requested", title: "Report awaiting approval", body: `${actorName(actor) ?? "A team member"} submitted "${row.name}"`, path: savedPath(row.id) },
    });
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, row.id)) });
  });

  router.post("/reports/saved/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    if (row.approval_status !== "pending_approval") throw conflict("Only a report awaiting approval can be approved");
    await exec(
      deps.db,
      `UPDATE ims_reports SET approval_status = 'approved', approved_by = :userId, approved_by_name = :name, approved_at = CURRENT_TIMESTAMP, review_note = NULL WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, userId: actor.userId, name: actorName(actor) },
    );
    await recordEvent(deps, actor, {
      type: "report.approved",
      entityType: "report",
      entityId: row.id,
      summary: `Approved report "${row.name}"`,
      notice: row.created_by ? { kind: "approval_decided", title: "Report approved", body: `"${row.name}" is approved and ready to send`, path: savedPath(row.id), targetUserId: Number(row.created_by) } : undefined,
    });
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, row.id)) });
  });

  router.post("/reports/saved/:id/reject", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    if (row.approval_status !== "pending_approval") throw conflict("Only a report awaiting approval can be sent back");
    const { note } = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body);
    await exec(deps.db, `UPDATE ims_reports SET approval_status = 'draft', review_note = :note WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id, note: note || null });
    await recordEvent(deps, actor, {
      type: "report.returned",
      entityType: "report",
      entityId: row.id,
      summary: `Sent report "${row.name}" back to draft${note ? `: ${note}` : ""}`,
      notice: row.created_by ? { kind: "approval_decided", title: "Report sent back", body: note ? `"${row.name}": ${note}` : `"${row.name}" needs changes`, path: savedPath(row.id), targetUserId: Number(row.created_by) } : undefined,
    });
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, row.id)) });
  });

  router.post("/reports/saved/:id/run", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"]);
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    const saved = mapSaved(row);
    if (!isReportType(saved.type)) throw new ImsError(400, "This saved report has an unknown type");
    const report = await runReport(deps, actor, saved.type, { period: saved.period, from: saved.from ?? undefined, to: saved.to ?? undefined, filters: saved.filters });
    await exec(deps.db, `UPDATE ims_reports SET last_run_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    res.json({ report, saved: mapSaved(await loadSaved(deps, actor.tenantId, row.id)) });
  });

  router.post("/reports/saved/:id/sent", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "reports");
    const row = await loadSaved(deps, actor.tenantId, req.params.id);
    if (row.approval_status !== "approved" && row.approval_status !== "sent") throw conflict("Approve the report before sending it");
    const { recipients } = parse(z.object({ recipients: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).min(1, "Add at least one recipient").max(20) }), req.body);
    const to = [...new Set(recipients)].join(", ");
    await exec(deps.db, `UPDATE ims_reports SET approval_status = 'sent', sent_to = :to, sent_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id, to });
    await recordEvent(deps, actor, { type: "report.sent", entityType: "report", entityId: row.id, summary: `Shared report "${row.name}" with ${to}` });
    res.json({ report: mapSaved(await loadSaved(deps, actor.tenantId, row.id)) });
  });

  router.get("/gst/summary", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"], "GST summaries need the Reports & GST or Auditor permission");
    const settings = await getSettings(deps, actor.tenantId);
    res.json(await gstSummary(deps, actor, gstRange(req, settings)));
  });

  router.get("/gst/hsn", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"], "GST summaries need the Reports & GST or Auditor permission");
    const settings = await getSettings(deps, actor.tenantId);
    res.json(await gstHsn(deps, actor, gstRange(req, settings)));
  });

  router.get("/gst/items-check", async (_req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["reports", "audit"], "GST summaries need the Reports & GST or Auditor permission");
    res.json(await gstItemsCheck(deps, actor));
  });
}