import type { Router } from "express";
import { moduleAllowed } from "../lib/ims-profile-modules.js";
import { accessOf, actorOf, enabledModulesOf, qint, qstr, type ImsDeps } from "./context.js";
import { isoOf, likeOf, money, rows, tsOf } from "./db.js";
import { IMS_ROLE_LABELS, addDaysISO, agingBucket, buildAgingBuckets, compareRestockUrgency, daysBetween, monthStartISO, periodRange, round2, round3, stockStatus, todayISO, type AgingKey } from "./logic.js";
import { getSettings } from "./settings.js";
import { loadReservedQtyByItem } from "./stock-state.js";

/** Web module keys — deep links are `?m=<module>&open=<id>`. Mirrors web/components/ims/modules.ts. */
export type ImsModuleKey =
  | "dashboard"
  | "items"
  | "stock"
  | "stockin"
  | "stockout"
  | "checks"
  | "lowstock"
  | "returns"
  | "history"
  | "scanner"
  | "parties"
  | "purchase"
  | "approvals"
  | "salesOrders"
  | "sales"
  | "bom"
  | "bomPackages"
  | "bomRateCards"
  | "bomCompare"
  | "bomDc"
  | "receivables"
  | "payables"
  | "ledger"
  | "closing"
  | "field"
  | "reports"
  | "gst"
  | "excise"
  | "audit"
  | "integrations"
  | "connect"
  | "helpdesk"
  | "settings"
  | "more";

export type ImsNotification = {
  id: string;
  tone: "coral" | "amber" | "blue" | "emerald";
  title: string;
  body: string;
  module: ImsModuleKey;
  open?: string;
  at: string | null;
};

type ItemAgg = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  hsn: string | null;
  unit: string;
  current_stock: string;
  damaged_stock: string;
  min_stock: string;
  max_stock: string | null;
  purchase_price: string;
  selling_price: string;
  last_movement_at: string | null;
  created_at: string;
};

async function notifications(
  deps: ImsDeps,
  tenantId: number,
  perms: ReadonlySet<string>,
  enabled: ReadonlyArray<ImsModuleKey> | null = null,
): Promise<ImsNotification[]> {
  const today = todayISO();
  const out: ImsNotification[] = [];
  const allow = (m: ImsModuleKey) => moduleAllowed(enabled, m);
  const [allActive, reservedMap] = await Promise.all([
    rows<{ id: string; name: string; current_stock: string; min_stock: string; max_stock: string | null; unit: string; updated_at: string }>(
      deps.db,
      `SELECT id, name, current_stock, min_stock, max_stock, unit, updated_at FROM ims_items
       WHERE tenant_id = :tenantId AND active = 1`,
      { tenantId },
    ),
    loadReservedQtyByItem(deps.db, tenantId),
  ]);
  const low = allActive
    .map((i) => {
      const cur = round3(money(i.current_stock));
      const min = round3(money(i.min_stock));
      const max = i.max_stock == null ? null : round3(money(i.max_stock));
      const reserved = reservedMap.get(i.id) ?? 0;
      const available = round3(Math.max(0, cur - reserved));
      const status = stockStatus(cur, min, max, { reserved });
      return { ...i, cur, min, reserved, available, status };
    })
    .filter((i) => i.status === "OUT_OF_STOCK" || i.status === "LOW")
    .sort((a, b) =>
      compareRestockUrgency(
        { status: a.status, currentStock: a.cur, availableStock: a.available, minStock: a.min, name: a.name },
        { status: b.status, currentStock: b.cur, availableStock: b.available, minStock: b.min, name: b.name },
      ),
    )
    .slice(0, 8);
  if (allow("lowstock")) for (const i of low) {
    const out_ = i.status === "OUT_OF_STOCK";
    out.push({
      id: `low:${i.id}`,
      tone: out_ ? "coral" : "amber",
      title: out_ ? `${i.name} is out of stock` : `${i.name} is running low`,
      body: `${i.cur} ${i.unit} left${i.reserved > 0 ? ` (${i.available} free)` : ""} · minimum ${i.min}`,
      module: "lowstock",
      open: i.id,
      at: tsOf(i.updated_at),
    });
  }
  if (perms.has("approvals") && (allow("approvals") || allow("checks") || allow("purchase"))) {
    const pos = await rows<{ id: string; po_no: string; supplier_name: string; grand_total: string; updated_at: string }>(
      deps.db,
      `SELECT id, po_no, supplier_name, grand_total, updated_at FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status = 'pending_approval' ORDER BY updated_at DESC LIMIT 5`,
      { tenantId },
    );
    if (allow("approvals") || allow("purchase")) for (const p of pos) {
      out.push({ id: `po:${p.id}`, tone: "blue", title: `PO ${p.po_no} needs approval`, body: `${p.supplier_name} · ₹${round2(money(p.grand_total)).toLocaleString("en-IN")}`, module: "approvals", open: p.id, at: tsOf(p.updated_at) });
    }
    if (allow("approvals") || allow("sales")) {
      const invs = await rows<{ id: string; invoice_no: string; customer_name: string; grand_total: string; updated_at: string }>(
        deps.db,
        `SELECT id, invoice_no, customer_name, grand_total, updated_at FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'pending_approval' ORDER BY updated_at DESC LIMIT 5`,
        { tenantId },
      );
      for (const i of invs) {
        out.push({
          id: `inv:${i.id}`,
          tone: "blue",
          title: `Invoice for ${i.customer_name} needs approval`,
          body: `${i.invoice_no} · ₹${round2(money(i.grand_total)).toLocaleString("en-IN")}`,
          module: "sales",
          open: i.id,
          at: tsOf(i.updated_at),
        });
      }
    }
    const checks = await rows<{ id: string; check_no: string; title: string; updated_at: string }>(
      deps.db,
      `SELECT id, check_no, title, updated_at FROM ims_stock_checks WHERE tenant_id = :tenantId AND status = 'submitted' ORDER BY updated_at DESC LIMIT 3`,
      { tenantId },
    );
    if (allow("approvals") || allow("checks")) for (const c of checks) {
      out.push({ id: `check:${c.id}`, tone: "blue", title: `Stock check ${c.check_no} awaits approval`, body: c.title, module: "checks", open: c.id, at: tsOf(c.updated_at) });
    }
  }
  if (perms.has("approvals") && perms.has("bom") && (allow("bomDc") || allow("bom"))) {
    const pendingDcs = await rows<{ id: string; doc_no: string; customer_name: string | null; bom_doc_no: string; updated_at: string }>(
      deps.db,
      `SELECT d.id, d.doc_no, b.customer_name, b.doc_no AS bom_doc_no, d.updated_at
       FROM ims_bom_dcs d
       INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
       WHERE d.tenant_id = :tenantId AND d.status = 'verified'
       ORDER BY d.updated_at DESC LIMIT 5`,
      { tenantId },
    ).catch(() => [] as Array<{ id: string; doc_no: string; customer_name: string | null; bom_doc_no: string; updated_at: string }>);
    for (const d of pendingDcs) {
      out.push({
        id: `bomdc:${d.id}`,
        tone: "blue",
        title: `DC ${d.doc_no} awaits approval`,
        body: `${d.customer_name || "No customer"} · BOM ${d.bom_doc_no}`,
        module: allow("bomDc") ? "bomDc" : "bom",
        open: d.id,
        at: tsOf(d.updated_at),
      });
    }
  }
  if ((perms.has("receivables") || perms.has("sales")) && allow("receivables")) {
    const overdue = await rows<{ id: string; invoice_no: string; customer_name: string; balance: string; due_date: string }>(
      deps.db,
      `SELECT id, invoice_no, customer_name, grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) AS balance, due_date FROM ims_invoices
       WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')
         AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005 AND due_date < :today
       ORDER BY due_date ASC LIMIT 5`,
      { tenantId, today },
    );
    for (const i of overdue) {
      const days = daysBetween(isoOf(i.due_date), today);
      out.push({ id: `ar:${i.id}`, tone: days > 60 ? "coral" : "amber", title: `${i.invoice_no} overdue ${days} days`, body: `${i.customer_name} · ₹${round2(money(i.balance)).toLocaleString("en-IN")} due`, module: "receivables", open: i.id, at: null });
    }
  }
  if (perms.has("payables") && allow("payables")) {
    const due = await rows<{ id: string; bill_no: string; supplier_name: string; balance: string; due_date: string; status: string }>(
      deps.db,
      `SELECT id, bill_no, supplier_name, grand_total - amount_paid AS balance, due_date, status FROM ims_bills
       WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005 AND (due_date <= :soon OR status = 'pending_approval')
       ORDER BY due_date ASC LIMIT 5`,
      { tenantId, soon: addDaysISO(today, 7) },
    );
    for (const b of due) {
      const pending = b.status === "pending_approval";
      out.push({
        id: `ap:${b.id}`,
        tone: pending ? "blue" : isoOf(b.due_date) < today ? "coral" : "amber",
        title: pending ? `Bill ${b.bill_no} awaits approval` : `Pay ${b.supplier_name} by ${isoOf(b.due_date)}`,
        body: `${b.bill_no} · ₹${round2(money(b.balance)).toLocaleString("en-IN")}`,
        module: "payables",
        open: b.id,
        at: null,
      });
    }
  }
  return out;
}

export function registerWorkspace(router: Router, deps: ImsDeps): void {
  router.get("/session", async (_req, res) => {
    const actor = actorOf(res);
    const access = accessOf(res);
    const enabledModules = enabledModulesOf(res) as ImsModuleKey[] | null;
    const [settings, brand] = await Promise.all([getSettings(deps, actor.tenantId), deps.host.brand(actor.tenantId).catch(() => null)]);
    res.json({
      host: deps.host.id,
      tenantId: actor.tenantId,
      actor: { userId: actor.userId, name: actor.name, email: actor.email, platformRole: actor.role },
      access: { role: access.role, roleLabel: IMS_ROLE_LABELS[access.role], perms: [...access.perms] },
      /** Admin ceiling for left-nav modules. `null` = all modules allowed for this profile. */
      enabledModules,
      settings,
      brand: brand ? { name: brand.name, logoUrl: brand.logoUrl, gstin: brand.gstin, state: brand.state, address: brand.address, phone: brand.phone, email: brand.email } : null,
      sources: deps.sources.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: s.href, description: s.description, kind: "documents" })),
      catalogs: deps.catalogs.map((c) => ({ id: c.id, label: c.label, icon: c.icon, href: c.href, description: c.description, kind: "catalog" })),
      today: todayISO(),
    });
  });

  router.get("/dashboard", async (req, res) => {
    const actor = actorOf(res);
    const access = accessOf(res);
    const tenantId = actor.tenantId;
    const settings = await getSettings(deps, tenantId);
    const today = todayISO();
    const range = periodRange(qstr(req.query.period) || "30d", today, settings.fiscalYearStart, { from: qstr(req.query.from), to: qstr(req.query.to) });

    const [items, reservedMap] = await Promise.all([
      rows<ItemAgg>(
        deps.db,
        `SELECT id, name, sku, category, hsn, unit, current_stock, damaged_stock, min_stock, max_stock, purchase_price, selling_price, last_movement_at, created_at
         FROM ims_items WHERE tenant_id = :tenantId AND active = 1`,
        { tenantId },
      ),
      loadReservedQtyByItem(deps.db, tenantId),
    ]);
    const moved30 = new Map(
      (
        await rows<{ item_id: string; qty: string }>(
          deps.db,
          `SELECT item_id, SUM(qty) AS qty FROM ims_movements WHERE tenant_id = :tenantId AND type = 'OUT' AND movement_date >= :since GROUP BY item_id`,
          { tenantId, since: addDaysISO(today, -29) },
        )
      ).map((m) => [m.item_id, money(m.qty)]),
    );
    let stockValue = 0;
    let retailValue = 0;
    let damagedUnits = 0;
    let totalUnits = 0;
    const dead = { items: 0, value: 0 };
    const slow = { items: 0, value: 0 };
    let missingHsn = 0;
    let missingPrice = 0;
    const statusCount = { GOOD: 0, LOW: 0, OUT_OF_STOCK: 0, OVERSTOCK: 0 };
    const agingBuckets = buildAgingBuckets(settings.agingBreaks);
    const aging: Record<AgingKey, { items: number; value: number }> = Object.fromEntries(agingBuckets.map((b) => [b.key, { items: 0, value: 0 }])) as Record<AgingKey, { items: number; value: number }>;
    const byCategory = new Map<string, { category: string; items: number; units: number; value: number }>();
    const deadIdleDays = settings.agingBreaks[settings.agingBreaks.length - 1] ?? 90;
    for (const i of items) {
      const cur = money(i.current_stock);
      const value = Math.max(0, cur) * money(i.purchase_price);
      stockValue += value;
      retailValue += Math.max(0, cur) * money(i.selling_price);
      damagedUnits += money(i.damaged_stock);
      statusCount[stockStatus(cur, money(i.min_stock), i.max_stock == null ? null : money(i.max_stock), { reserved: reservedMap.get(i.id) ?? 0 })] += 1;
      if (!i.hsn) missingHsn += 1;
      if (money(i.selling_price) <= 0) missingPrice += 1;
      if (cur > 0) {
        totalUnits += cur;
        const idle = daysBetween(isoOf(i.last_movement_at ?? i.created_at), today);
        const bucket = agingBucket(idle, settings.agingBreaks);
        aging[bucket].items += 1;
        aging[bucket].value += value;
        if (idle > deadIdleDays) {
          dead.items += 1;
          dead.value += value;
        } else if (!moved30.get(i.id)) {
          slow.items += 1;
          slow.value += value;
        }
      }
      const cat = i.category || "Uncategorised";
      const c = byCategory.get(cat) ?? { category: cat, items: 0, units: 0, value: 0 };
      c.items += 1;
      c.units += Math.max(0, cur);
      c.value += value;
      byCategory.set(cat, c);
    }

    const flows = await rows<{ type: string; qty: string; value: string; n: number }>(
      deps.db,
      `SELECT type, SUM(qty) AS qty, SUM(value) AS value, COUNT(*) AS n FROM ims_movements
       WHERE tenant_id = :tenantId AND movement_date BETWEEN :from AND :to GROUP BY type`,
      { tenantId, ...range },
    );
    const flow = (t: string) => flows.find((f) => f.type === t);
    const todayFlows = await rows<{ type: string; qty: string; n: number }>(
      deps.db,
      `SELECT type, SUM(qty) AS qty, COUNT(*) AS n FROM ims_movements WHERE tenant_id = :tenantId AND movement_date = :today GROUP BY type`,
      { tenantId, today },
    );
    const todayOf = (t: string) => todayFlows.find((f) => f.type === t);

    const series = await rows<{ d: string; stock_in: string; stock_out: string }>(
      deps.db,
      `SELECT movement_date AS d,
              SUM(CASE WHEN type IN ('IN','OPENING','RETURN_IN') THEN qty ELSE 0 END) AS stock_in,
              SUM(CASE WHEN type IN ('OUT','RETURN_OUT') THEN qty ELSE 0 END) AS stock_out
       FROM ims_movements WHERE tenant_id = :tenantId AND movement_date BETWEEN :from AND :to
       GROUP BY movement_date ORDER BY movement_date`,
      { tenantId, from: addDaysISO(today, -13), to: today },
    );

    const topMovers = await rows<{ item_id: string; item_name: string; qty: string; value: string }>(
      deps.db,
      `SELECT item_id, item_name, SUM(qty) AS qty, SUM(value) AS value FROM ims_movements
       WHERE tenant_id = :tenantId AND type = 'OUT' AND movement_date BETWEEN :from AND :to
       GROUP BY item_id, item_name ORDER BY SUM(qty) DESC LIMIT 6`,
      { tenantId, ...range },
    );

    const recent = await rows<{ id: string; item_id: string; item_name: string; type: string; qty: string; after_qty: string; ref_type: string | null; ref_no: string | null; party_name: string | null; actor_name: string | null; created_at: string }>(
      deps.db,
      `SELECT id, item_id, item_name, type, qty, after_qty, ref_type, ref_no, party_name, actor_name, created_at FROM ims_movements
       WHERE tenant_id = :tenantId ORDER BY created_at DESC LIMIT 8`,
      { tenantId },
    );

    const finance = await rows<{ sales: string | null; receivable: string | null; overdue: string | null; overdue_n: number }>(
      deps.db,
      `SELECT
         SUM(CASE WHEN invoice_date BETWEEN :mfrom AND :today THEN grand_total ELSE 0 END) AS sales,
         SUM(grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0)) AS receivable,
         SUM(CASE WHEN due_date < :today THEN grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) ELSE 0 END) AS overdue,
         SUM(CASE WHEN due_date < :today AND grand_total - amount_paid - COALESCE(credit_applied, 0) - COALESCE(advance_applied, 0) - COALESCE(retention_amount, 0) > 0.005 THEN 1 ELSE 0 END) AS overdue_n
       FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note')`,
      { tenantId, today, mfrom: monthStartISO(today) },
    );
    const invoiced = await rows<{ n: number; total: string | null }>(
      deps.db,
      `SELECT COUNT(*) AS n, SUM(grand_total) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') IN ('tax_invoice', 'debit_note') AND invoice_date BETWEEN :from AND :to`,
      { tenantId, ...range },
    );
    const payable = await rows<{ payable: string | null }>(
      deps.db,
      `SELECT SUM(grand_total - amount_paid) AS payable FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled'`,
      { tenantId },
    );
    const pending = await rows<{ po: number; bills: number; invoices: number; checks: number; dcs: number }>(
      deps.db,
      `SELECT
         (SELECT COUNT(*) FROM ims_purchase_orders WHERE tenant_id = :tenantId AND status = 'pending_approval') AS po,
         (SELECT COUNT(*) FROM ims_bills WHERE tenant_id = :tenantId AND status = 'pending_approval') AS bills,
         (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'pending_approval') AS invoices,
         (SELECT COUNT(*) FROM ims_stock_checks WHERE tenant_id = :tenantId AND status = 'submitted') AS checks,
         (SELECT COUNT(*) FROM ims_bom_dcs WHERE tenant_id = :tenantId AND status = 'verified') AS dcs`,
      { tenantId },
    );

    const f = finance[0];
    const seriesByDay = new Map(series.map((s) => [isoOf(s.d), s]));
    const fullSeries = Array.from({ length: 14 }, (_, i) => {
      const date = addDaysISO(today, i - 13);
      const s = seriesByDay.get(date);
      return { date, in: round3(money(s?.stock_in)), out: round3(money(s?.stock_out)) };
    });
    res.json({
      today,
      range,
      kpis: {
        totalItems: items.length,
        stockValue: round2(stockValue),
        retailValue: round2(retailValue),
        lowStock: statusCount.LOW,
        outOfStock: statusCount.OUT_OF_STOCK,
        overStock: statusCount.OVERSTOCK,
        goodStock: statusCount.GOOD,
        damagedUnits: round3(damagedUnits),
        stockIn: round3(money(flow("IN")?.qty) + money(flow("OPENING")?.qty) + money(flow("RETURN_IN")?.qty)),
        stockOut: round3(money(flow("OUT")?.qty) + money(flow("RETURN_OUT")?.qty)),
        damaged: round3(money(flow("DAMAGE")?.qty)),
        salesValue: round2(money(flow("OUT")?.value)),
        todayIn: round3(money(todayOf("IN")?.qty) + money(todayOf("RETURN_IN")?.qty)),
        todayOut: round3(money(todayOf("OUT")?.qty)),
        todayEntries: todayFlows.reduce((s, t) => s + Number(t.n), 0),
        salesMtd: round2(money(f?.sales)),
        receivable: round2(money(f?.receivable)),
        overdue: round2(money(f?.overdue)),
        overdueCount: Number(f?.overdue_n ?? 0),
        payable: round2(money(payable[0]?.payable)),
        pendingApprovals:
          Number(pending[0]?.po ?? 0) +
          Number(pending[0]?.bills ?? 0) +
          Number(pending[0]?.invoices ?? 0) +
          Number(pending[0]?.checks ?? 0) +
          Number(pending[0]?.dcs ?? 0),
      },
      pending: {
        po: Number(pending[0]?.po ?? 0),
        bills: Number(pending[0]?.bills ?? 0),
        checks: Number(pending[0]?.checks ?? 0),
        dcs: Number(pending[0]?.dcs ?? 0),
      },
      aging: agingBuckets.map((b) => ({ key: b.key, label: b.label, color: b.color, items: aging[b.key].items, value: round2(aging[b.key].value) })),
      categories: [...byCategory.values()].map((c) => ({ ...c, units: round3(c.units), value: round2(c.value) })).sort((a, b) => b.value - a.value),
      series: fullSeries,
      topMovers: topMovers.map((m) => ({ itemId: m.item_id, name: m.item_name, qty: round3(money(m.qty)), value: round2(money(m.value)) })),
      recent: recent.map((m) => ({ id: m.id, itemId: m.item_id, itemName: m.item_name, type: m.type, qty: round3(money(m.qty)), after: round3(money(m.after_qty)), refType: m.ref_type, refNo: m.ref_no, partyName: m.party_name, actorName: m.actor_name, createdAt: tsOf(m.created_at) })),
      notifications: await notifications(deps, tenantId, access.perms, enabledModulesOf(res) as ImsModuleKey[] | null),
      insights: {
        totalUnits: round3(totalUnits),
        potentialMargin: round2(retailValue - stockValue),
        marginPct: retailValue > 0 ? round2(((retailValue - stockValue) / retailValue) * 100) : 0,
        deadStock: { items: dead.items, value: round2(dead.value) },
        slowMovers: { items: slow.items, value: round2(slow.value) },
        missingHsn,
        missingPrice,
        period: {
          invoices: Number(invoiced[0]?.n ?? 0),
          invoiced: round2(money(invoiced[0]?.total)),
          purchasedValue: round2(money(flow("IN")?.value)),
          returnsIn: round3(money(flow("RETURN_IN")?.qty)),
          damagedValue: round2(money(flow("DAMAGE")?.value) + money(flow("WRITE_OFF")?.value)),
          entries: flows.reduce((s, t) => s + Number(t.n), 0),
        },
      },
    });
  });

  router.get("/notifications", async (_req, res) => {
    const actor = actorOf(res);
    res.json({
      notifications: await notifications(deps, actor.tenantId, accessOf(res).perms, enabledModulesOf(res) as ImsModuleKey[] | null),
    });
  });

  /** Activity history / audit trail. */
  router.get("/events", async (req, res) => {
    const actor = actorOf(res);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit: qint(req.query.limit, 100, 1, 500) };
    const entityType = qstr(req.query.entityType, 24);
    const entityId = qstr(req.query.entityId, 64);
    const q = qstr(req.query.q);
    const from = qstr(req.query.from, 10);
    const to = qstr(req.query.to, 10);
    if (entityType) {
      where.push("entity_type = :entityType");
      params.entityType = entityType;
    }
    if (entityId) {
      where.push("entity_id = :entityId");
      params.entityId = entityId;
    }
    if (q) {
      where.push("(summary LIKE :q OR actor_name LIKE :q OR event_type LIKE :q)");
      params.q = likeOf(q);
    }
    if (from) {
      where.push("created_at >= :from");
      params.from = `${from} 00:00:00`;
    }
    if (to) {
      where.push("created_at <= :to");
      params.to = `${to} 23:59:59`;
    }
    const list = await rows<{ id: number; actor_name: string | null; event_type: string; entity_type: string | null; entity_id: string | null; summary: string; created_at: string }>(
      deps.db,
      `SELECT id, actor_name, event_type, entity_type, entity_id, summary, created_at FROM ims_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT :limit`,
      params,
    );
    res.json({
      events: list.map((e) => ({ id: Number(e.id), actorName: e.actor_name, type: e.event_type, entityType: e.entity_type, entityId: e.entity_id, summary: e.summary, createdAt: tsOf(e.created_at) })),
    });
  });

  /** Global search across items, parties and documents (top bar / command palette). */
  router.get("/search", async (req, res) => {
    const actor = actorOf(res);
    const q = qstr(req.query.q, 80);
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }
    const params = { tenantId: actor.tenantId, q: likeOf(q), exact: q };
    const [items, parties, invoices, pos, bills, boms, packages, dcs, returns] = await Promise.all([
      rows<{ id: string; name: string; sku: string | null; current_stock: string; unit: string }>(
        deps.db,
        `SELECT id, name, sku, current_stock, unit FROM ims_items
         WHERE tenant_id = :tenantId
           AND (name LIKE :q OR sku LIKE :q OR barcode = :exact OR EXISTS (SELECT 1 FROM ims_item_serials s WHERE s.tenant_id = ims_items.tenant_id AND s.item_id = ims_items.id AND s.serial_no = :exact))
         ORDER BY name LIMIT 8`,
        params,
      ),
      rows<{ id: string; name: string; kind: string; mobile: string | null }>(
        deps.db,
        `SELECT id, name, kind, mobile FROM ims_parties WHERE tenant_id = :tenantId AND (name LIKE :q OR mobile LIKE :q OR gstin LIKE :q) ORDER BY name LIMIT 6`,
        params,
      ),
      rows<{ id: string; invoice_no: string; customer_name: string; grand_total: string }>(
        deps.db,
        `SELECT id, invoice_no, customer_name, grand_total FROM ims_invoices WHERE tenant_id = :tenantId AND (invoice_no LIKE :q OR customer_name LIKE :q) ORDER BY invoice_date DESC LIMIT 5`,
        params,
      ),
      rows<{ id: string; po_no: string; supplier_name: string; status: string }>(
        deps.db,
        `SELECT id, po_no, supplier_name, status FROM ims_purchase_orders WHERE tenant_id = :tenantId AND (po_no LIKE :q OR supplier_name LIKE :q) ORDER BY order_date DESC LIMIT 5`,
        params,
      ),
      rows<{ id: string; bill_no: string; supplier_name: string }>(
        deps.db,
        `SELECT id, bill_no, supplier_name FROM ims_bills WHERE tenant_id = :tenantId AND (bill_no LIKE :q OR supplier_bill_no LIKE :q OR supplier_name LIKE :q) ORDER BY bill_date DESC LIMIT 5`,
        params,
      ),
      rows<{ id: string; doc_no: string; customer_name: string; status: string; grand_total: string }>(
        deps.db,
        `SELECT id, doc_no, customer_name, status, grand_total FROM ims_bom_docs
         WHERE tenant_id = :tenantId AND (doc_no LIKE :q OR customer_name LIKE :q OR IFNULL(title,'') LIKE :q OR IFNULL(capacity_label,'') LIKE :q)
         ORDER BY doc_date DESC LIMIT 5`,
        params,
      ).catch(() => [] as Array<{ id: string; doc_no: string; customer_name: string; status: string; grand_total: string }>),
      rows<{ id: string; name: string; code: string | null; capacity_label: string | null }>(
        deps.db,
        `SELECT id, name, code, capacity_label FROM ims_bom_packages
         WHERE tenant_id = :tenantId AND active = 1 AND (name LIKE :q OR IFNULL(code,'') LIKE :q OR IFNULL(capacity_label,'') LIKE :q)
         ORDER BY name LIMIT 4`,
        params,
      ).catch(() => [] as Array<{ id: string; name: string; code: string | null; capacity_label: string | null }>),
      rows<{ id: string; doc_no: string; status: string; bom_doc_no: string; customer_name: string | null }>(
        deps.db,
        `SELECT d.id, d.doc_no, d.status, b.doc_no AS bom_doc_no, b.customer_name
         FROM ims_bom_dcs d
         INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
         WHERE d.tenant_id = :tenantId AND (d.doc_no LIKE :q OR b.doc_no LIKE :q OR IFNULL(b.customer_name,'') LIKE :q OR IFNULL(d.vehicle_no,'') LIKE :q)
         ORDER BY d.doc_date DESC LIMIT 5`,
        params,
      ).catch(() => [] as Array<{ id: string; doc_no: string; status: string; bom_doc_no: string; customer_name: string | null }>),
      rows<{ id: string; return_no: string; dc_doc_no: string; bom_doc_no: string; customer_name: string | null }>(
        deps.db,
        `SELECT r.id, r.return_no, d.doc_no AS dc_doc_no, b.doc_no AS bom_doc_no, b.customer_name
         FROM ims_bom_dc_returns r
         INNER JOIN ims_bom_dcs d ON d.id = r.dc_id AND d.tenant_id = r.tenant_id
         INNER JOIN ims_bom_docs b ON b.id = r.bom_doc_id AND b.tenant_id = r.tenant_id
         WHERE r.tenant_id = :tenantId AND (r.return_no LIKE :q OR d.doc_no LIKE :q OR b.doc_no LIKE :q OR IFNULL(b.customer_name,'') LIKE :q)
         ORDER BY r.return_date DESC LIMIT 5`,
        params,
      ).catch(() => [] as Array<{ id: string; return_no: string; dc_doc_no: string; bom_doc_no: string; customer_name: string | null }>),
    ]);
    res.json({
      results: [
        ...items.map((i) => ({ kind: "item", id: i.id, title: i.name, sub: `${i.sku ? `${i.sku} · ` : ""}${round3(money(i.current_stock))} ${i.unit} in stock`, module: "items", open: i.id })),
        ...parties.map((p) => ({ kind: "party", id: p.id, title: p.name, sub: `${p.kind}${p.mobile ? ` · ${p.mobile}` : ""}`, module: "parties", open: p.id })),
        ...invoices.map((i) => ({ kind: "invoice", id: i.id, title: i.invoice_no, sub: `${i.customer_name} · ₹${round2(money(i.grand_total)).toLocaleString("en-IN")}`, module: "sales", open: i.id })),
        ...pos.map((p) => ({ kind: "po", id: p.id, title: p.po_no, sub: `${p.supplier_name} · ${p.status.replace(/_/g, " ")}`, module: "purchase", open: p.id })),
        ...bills.map((b) => ({ kind: "bill", id: b.id, title: b.bill_no, sub: b.supplier_name, module: "payables", open: b.id })),
        ...boms.map((b) => ({
          kind: "bom",
          id: b.id,
          title: b.doc_no,
          sub: `${b.customer_name || "No customer"} · ${b.status} · ₹${round2(money(b.grand_total)).toLocaleString("en-IN")}`,
          module: "bom",
          open: b.id,
        })),
        ...packages.map((p) => ({
          kind: "bom_package",
          id: p.id,
          title: p.name,
          sub: [p.code, p.capacity_label].filter(Boolean).join(" · ") || "BOM package",
          module: "bomPackages",
          open: p.id,
        })),
        ...dcs.map((d) => ({
          kind: "bom_dc",
          id: d.id,
          title: d.doc_no,
          sub: `${d.customer_name || "No customer"} · BOM ${d.bom_doc_no} · ${d.status}`,
          module: "bomDc" as const,
          open: d.id,
        })),
        ...returns.map((r) => ({
          kind: "bom_dc_return",
          id: r.id,
          title: r.return_no,
          sub: `${r.customer_name || "No customer"} · DC ${r.dc_doc_no} · BOM ${r.bom_doc_no}`,
          module: "bomDc" as const,
          open: `return:${r.id}`,
        })),
      ],
    });
  });
}
