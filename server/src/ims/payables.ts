import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorName, actorOf, can, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, notFound, type ImsActor } from "./host.js";
import {
  BILL_STATUSES,
  PAY_METHODS,
  addDaysISO,
  apPriority,
  billBalance,
  billDisplayStatus,
  billPayable,
  computeTotals,
  daysBetween,
  dueDateFor,
  formatINR,
  intraStateFor,
  monthStartISO,
  round2,
  todayISO,
  type ImsLine,
  type PayMethod,
} from "./logic.js";
import { LineInput, PaymentInput, assertDayOpen, dateText, insertPayment, mapPayment, type PaymentRow } from "./sales.js";
import { getSettings } from "./settings.js";
import { nextDocNo } from "./stock.js";

export type BillRow = {
  id: string;
  bill_no: string;
  supplier_bill_no: string | null;
  status: string;
  supplier_id: string | null;
  supplier_name: string;
  po_id: string | null;
  po_no: string | null;
  bill_date: unknown;
  due_date: unknown;
  lines: unknown;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  amount_paid: string;
  hold_reason: string | null;
  scheduled_on: unknown;
  pay_method: string | null;
  category?: string | null;
  run_id?: string | null;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  notes: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  supplier_mobile?: string | null;
  supplier_email?: string | null;
  supplier_gstin?: string | null;
};

export function mapBill(r: BillRow, today: string, withLines = false) {
  const grandTotal = round2(money(r.grand_total));
  const amountPaid = round2(money(r.amount_paid));
  const dueDate = r.due_date ? isoOf(r.due_date) : null;
  const base = { status: r.status, grandTotal, amountPaid, dueDate };
  const balance = billBalance(base);
  const lines = json<ImsLine[] | null>(r.lines, null);
  return {
    id: r.id,
    billNo: r.bill_no,
    supplierBillNo: r.supplier_bill_no,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierMobile: r.supplier_mobile ?? null,
    supplierEmail: r.supplier_email ?? null,
    supplierGstin: r.supplier_gstin ?? null,
    poId: r.po_id,
    poNo: r.po_no,
    billDate: isoOf(r.bill_date),
    dueDate,
    daysToDue: dueDate ? daysBetween(today, dueDate) : null,
    subtotal: round2(money(r.subtotal)),
    taxTotal: round2(money(r.tax_total)),
    grandTotal,
    amountPaid,
    balance,
    status: r.status as (typeof BILL_STATUSES)[number],
    displayStatus: billDisplayStatus(base, today),
    priority: apPriority(dueDate, today),
    holdReason: r.hold_reason,
    scheduledOn: r.scheduled_on ? isoOf(r.scheduled_on) : null,
    payMethod: r.pay_method,
    category: r.category ?? null,
    runId: r.run_id ?? null,
    decidedByName: r.decided_by_name,
    decidedAt: tsOf(r.decided_at),
    notes: r.notes,
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    lineCount: lines?.length ?? 0,
    ...(withLines ? { lines: lines ?? [] } : {}),
  };
}

export type ImsBill = ReturnType<typeof mapBill>;

const BILL_SELECT = `SELECT b.*, p.mobile AS supplier_mobile, p.email AS supplier_email, p.gstin AS supplier_gstin
  FROM ims_bills b LEFT JOIN ims_parties p ON p.id = b.supplier_id AND p.tenant_id = b.tenant_id`;

async function loadBillRow(db: Queryable, tenantId: number, id: string, lock = false): Promise<BillRow> {
  const r = lock
    ? await one<BillRow>(db, `SELECT * FROM ims_bills WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id })
    : await one<BillRow>(db, `${BILL_SELECT} WHERE b.tenant_id = :tenantId AND b.id = :id LIMIT 1`, { tenantId, id });
  if (!r) throw notFound("Bill");
  return r;
}

async function billDetail(deps: ImsDeps, tenantId: number, id: string) {
  const today = todayISO();
  const bill = mapBill(await loadBillRow(deps.db, tenantId, id), today, true);
  const [payments, events] = await Promise.all([
    rows<PaymentRow>(deps.db, `SELECT * FROM ims_payments WHERE tenant_id = :tenantId AND doc_type = 'bill' AND doc_id = :id ORDER BY paid_on DESC, created_at DESC`, { tenantId, id }),
    rows<{ id: number; actor_name: string | null; event_type: string; summary: string; created_at: string }>(
      deps.db,
      `SELECT id, actor_name, event_type, summary, created_at FROM ims_events WHERE tenant_id = :tenantId AND entity_type = 'bill' AND entity_id = :id ORDER BY created_at DESC LIMIT 100`,
      { tenantId, id },
    ),
  ]);
  return {
    bill,
    payments: payments.map(mapPayment),
    events: events.map((e) => ({ id: Number(e.id), actorName: e.actor_name, type: e.event_type, summary: e.summary, createdAt: tsOf(e.created_at) })),
  };
}

const BillInput = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().trim().min(1, "Pick a supplier or type a name").max(200),
  supplierBillNo: optText(64),
  billDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  lines: z.array(LineInput).max(300).optional(),
  amount: z.coerce.number().min(0).max(1e12).optional(),
  taxAmount: z.coerce.number().min(0).max(1e12).optional(),
  category: optText(60),
  notes: optText(2000),
});
type BillInputT = z.infer<typeof BillInput>;

/** Totals from GST lines, or a plain amount + tax for expense-type bills. */
async function billValues(deps: ImsDeps, actor: ImsActor, input: BillInputT) {
  const settings = await getSettings(deps, actor.tenantId);
  const supplier = input.supplierId
    ? await one<{ id: string; state: string | null; payment_terms_days: number | null }>(deps.db, `SELECT id, state, payment_terms_days FROM ims_parties WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: input.supplierId,
      })
    : null;
  if (input.supplierId && !supplier) throw notFound("Supplier");
  let lines: ImsLine[] | null = null;
  let subtotal: number;
  let taxTotal: number;
  if (input.lines?.length) {
    const totals = computeTotals(input.lines, intraStateFor(settings, supplier?.state), false);
    lines = totals.lines;
    subtotal = totals.taxable;
    taxTotal = totals.taxTotal;
  } else {
    subtotal = round2(input.amount ?? 0);
    taxTotal = round2(input.taxAmount ?? 0);
  }
  const grandTotal = round2(subtotal + taxTotal);
  if (grandTotal <= 0) throw badRequest("Enter the bill lines or an amount more than zero");
  const dueDate = input.dueDate ?? dueDateFor(input.billDate, supplier?.payment_terms_days ?? null, settings.paymentTermsDays);
  if (dueDate < input.billDate) throw badRequest("The due date can't be before the bill date");
  return { settings, supplierId: supplier?.id ?? null, lines, subtotal, taxTotal, grandTotal, dueDate };
}

async function assertNoDuplicate(db: Queryable, tenantId: number, supplierId: string | null, supplierName: string, supplierBillNo: string | null | undefined, exceptId?: string) {
  if (!supplierBillNo?.trim()) return;
  const dup = await one<{ bill_no: string }>(
    db,
    `SELECT bill_no FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND supplier_bill_no = :no
       AND ${supplierId ? "supplier_id = :supplierId" : "supplier_name = :supplierName"} ${exceptId ? "AND id <> :exceptId" : ""} LIMIT 1`,
    { tenantId, no: supplierBillNo.trim(), supplierId, supplierName, exceptId: exceptId ?? null },
  );
  if (dup) throw conflict(`Supplier bill ${supplierBillNo} is already recorded as ${dup.bill_no}`);
}

/** Pays one bill's amount inside the caller's transaction. */
async function payBill(conn: PoolConnection, actor: ImsActor, row: BillRow, p: { amount: number; method: PayMethod; reference?: string | null; notes?: string | null; date: string; runId?: string | null }) {
  await insertPayment(conn, actor, {
    direction: "out",
    partyId: row.supplier_id,
    partyName: row.supplier_name,
    docType: "bill",
    docId: row.id,
    docNo: row.supplier_bill_no ? `${row.bill_no} · ${row.supplier_bill_no}`.slice(0, 64) : row.bill_no,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    paidOn: p.date,
    runId: p.runId ?? null,
    notes: p.notes,
  });
  const paid = round2(money(row.amount_paid) + p.amount);
  const settled = paid + 0.005 >= money(row.grand_total);
  await exec(
    conn,
    `UPDATE ims_bills SET amount_paid = :paid, pay_method = :method ${settled ? ", status = 'approved', scheduled_on = NULL" : ""} ${p.runId ? ", run_id = :runId" : ""}
     WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId: actor.tenantId, id: row.id, paid, method: p.method, runId: p.runId ?? null },
  );
}

type RunRow = {
  id: string;
  run_no: string;
  status: string;
  run_date: unknown;
  method: string;
  reference: string | null;
  bill_ids: unknown;
  bill_count: number;
  total: string;
  notes: string | null;
  paid_at: string | null;
  created_by_name: string | null;
  created_at: string;
};

const mapRun = (r: RunRow) => ({
  id: r.id,
  runNo: r.run_no,
  status: r.status as "scheduled" | "paid" | "cancelled",
  runDate: isoOf(r.run_date),
  method: r.method,
  reference: r.reference,
  billIds: json<string[]>(r.bill_ids, []),
  billCount: Number(r.bill_count) || 0,
  total: round2(money(r.total)),
  notes: r.notes,
  paidAt: tsOf(r.paid_at),
  createdByName: r.created_by_name,
  createdAt: tsOf(r.created_at),
});

const decisionNotice = (row: BillRow, actor: ImsActor, title: string, body: string) =>
  row.created_by && row.created_by !== actor.userId ? { kind: "approval_decided" as const, title, body, path: `?m=payables&open=${row.id}`, targetUserId: row.created_by } : undefined;

export function registerPayables(router: Router, deps: ImsDeps): void {
  router.get("/bills", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["payables", "approvals"]);
    const today = todayISO();
    const where = ["b.tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit: qint(req.query.limit, 1000, 1, 5000) };
    const status = qstr(req.query.status, 20);
    if ((BILL_STATUSES as readonly string[]).includes(status)) {
      where.push("b.status = :status");
      params.status = status;
    }
    const supplierId = qstr(req.query.supplierId, 36);
    if (supplierId) {
      where.push("b.supplier_id = :supplierId");
      params.supplierId = supplierId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(b.bill_no LIKE :q OR b.supplier_bill_no LIKE :q OR b.supplier_name LIKE :q OR b.po_no LIKE :q OR b.category LIKE :q)");
      params.q = likeOf(q);
    }
    const all = (await rows<BillRow>(deps.db, `${BILL_SELECT} WHERE ${where.join(" AND ")} ORDER BY (b.due_date IS NULL), b.due_date ASC, b.bill_date DESC LIMIT :limit`, params)).map((r) => mapBill(r, today));
    let bills = all;
    if (status && !(BILL_STATUSES as readonly string[]).includes(status)) {
      bills = status === "open" ? all.filter((b) => b.balance > 0.005) : all.filter((b) => b.displayStatus === status);
    }
    const priority = qstr(req.query.priority, 12).toUpperCase();
    if (priority) bills = bills.filter((b) => b.balance > 0.005 && b.status !== "cancelled" && b.priority === priority);

    const counts: Record<string, number> = { all: all.length, pending_approval: 0, approved: 0, on_hold: 0, scheduled: 0, cancelled: 0, paid: 0, partial: 0, overdue: 0 };
    for (const b of all) counts[b.displayStatus] = (counts[b.displayStatus] ?? 0) + 1;

    const k = await one<{ payable: string | null; overdue: string | null; overdue_n: string | null; week: string | null; week_n: string | null; scheduled: string | null; scheduled_n: string | null; hold: string | null; hold_n: string | null; pending: string | null; pending_n: string | null }>(
      deps.db,
      `SELECT
         SUM(grand_total - amount_paid) AS payable,
         SUM(CASE WHEN due_date < :today THEN grand_total - amount_paid ELSE 0 END) AS overdue,
         SUM(CASE WHEN due_date < :today THEN 1 ELSE 0 END) AS overdue_n,
         SUM(CASE WHEN due_date BETWEEN :today AND :weekEnd THEN grand_total - amount_paid ELSE 0 END) AS week,
         SUM(CASE WHEN due_date BETWEEN :today AND :weekEnd THEN 1 ELSE 0 END) AS week_n,
         SUM(CASE WHEN status = 'scheduled' THEN grand_total - amount_paid ELSE 0 END) AS scheduled,
         SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_n,
         SUM(CASE WHEN status = 'on_hold' THEN grand_total - amount_paid ELSE 0 END) AS hold,
         SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS hold_n,
         SUM(CASE WHEN status = 'pending_approval' THEN grand_total - amount_paid ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_n
       FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005`,
      { tenantId: actor.tenantId, today, weekEnd: addDaysISO(today, 7) },
    );
    const paidMonth = await one<{ total: string | null; n: string | null }>(deps.db, `SELECT SUM(amount) AS total, COUNT(*) AS n FROM ims_payments WHERE tenant_id = :tenantId AND direction = 'out' AND paid_on >= :monthStart`, {
      tenantId: actor.tenantId,
      monthStart: monthStartISO(today),
    });
    res.json({
      bills,
      counts,
      kpis: {
        totalPayable: round2(money(k?.payable)),
        overdue: round2(money(k?.overdue)),
        overdueCount: Number(k?.overdue_n ?? 0),
        dueThisWeek: round2(money(k?.week)),
        dueThisWeekCount: Number(k?.week_n ?? 0),
        scheduled: round2(money(k?.scheduled)),
        scheduledCount: Number(k?.scheduled_n ?? 0),
        onHold: round2(money(k?.hold)),
        onHoldCount: Number(k?.hold_n ?? 0),
        pendingApproval: round2(money(k?.pending)),
        pendingApprovalCount: Number(k?.pending_n ?? 0),
        paidThisMonth: round2(money(paidMonth?.total)),
        paidThisMonthCount: Number(paidMonth?.n ?? 0),
      },
      canApprove: can(res, "approvals"),
      canPay: can(res, "payables"),
    });
  });

  router.get("/bills/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["payables", "approvals"]);
    res.json(await billDetail(deps, actor.tenantId, req.params.id));
  });

  /* Manual bill. Approvers' bills are approved on entry; everyone else's wait for an approver. */
  router.post("/bills", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const input = parse(BillInput.extend({ approveNow: z.boolean().default(true) }), req.body);
    const v = await billValues(deps, actor, input);
    await assertNoDuplicate(deps.db, actor.tenantId, v.supplierId, input.supplierName, input.supplierBillNo);
    const approved = input.approveNow && can(res, "approvals");
    const id = randomUUID();
    const billNo = await tx(deps.db, async (conn) => {
      const no = await nextDocNo(conn, actor.tenantId, "bill", v.settings.billPrefix, input.billDate, v.settings.fiscalYearStart);
      await exec(
        conn,
        `INSERT INTO ims_bills (id, tenant_id, bill_no, supplier_bill_no, status, supplier_id, supplier_name, bill_date, due_date, \`lines\`, subtotal, tax_total, grand_total,
           category, notes, decided_by, decided_by_name, decided_at, created_by, created_by_name)
         VALUES (:id, :tenantId, :billNo, :supplierBillNo, :status, :supplierId, :supplierName, :billDate, :dueDate, :lines, :subtotal, :taxTotal, :grandTotal,
           :category, :notes, :decidedBy, :decidedByName, ${approved ? "CURRENT_TIMESTAMP" : "NULL"}, :userId, :userName)`,
        {
          id,
          tenantId: actor.tenantId,
          billNo: no,
          supplierBillNo: input.supplierBillNo?.trim() || null,
          status: approved ? "approved" : "pending_approval",
          supplierId: v.supplierId,
          supplierName: input.supplierName.trim(),
          billDate: input.billDate,
          dueDate: v.dueDate,
          lines: v.lines ? JSON.stringify(v.lines) : null,
          subtotal: v.subtotal,
          taxTotal: v.taxTotal,
          grandTotal: v.grandTotal,
          category: input.category ?? null,
          notes: input.notes ?? null,
          decidedBy: approved ? actor.userId : null,
          decidedByName: approved ? actorName(actor) : null,
          userId: actor.userId,
          userName: actorName(actor),
        },
      );
      return no;
    });
    await recordEvent(deps, actor, {
      type: "bill.created",
      entityType: "bill",
      entityId: id,
      summary: `Recorded bill ${billNo} from ${input.supplierName} (${formatINR(v.grandTotal)})${approved ? " — approved" : " — awaiting approval"}`,
      notice: approved
        ? undefined
        : {
            kind: "approval_requested",
            title: `Bill ${billNo} needs approval`,
            body: `${input.supplierName} · ${formatINR(v.grandTotal)} · due ${dateText(v.dueDate)}`,
            path: `?m=payables&open=${id}`,
            dedupeKey: `ims-bill-approval-${id}`,
          },
    });
    res.status(201).json(await billDetail(deps, actor.tenantId, id));
  });

  router.patch("/bills/:id", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (!["pending_approval", "on_hold", "approved"].includes(row.status)) throw conflict("Only unpaid bills that aren't scheduled or cancelled can be edited");
    if (money(row.amount_paid) > 0.005) throw conflict("This bill already has payments, so its amount can't change");
    const input = parse(BillInput, req.body);
    const v = await billValues(deps, actor, input);
    await assertNoDuplicate(deps.db, actor.tenantId, v.supplierId, input.supplierName, input.supplierBillNo, row.id);
    const backToApproval = row.status === "approved" && !can(res, "approvals") && Math.abs(v.grandTotal - money(row.grand_total)) > 0.005;
    await exec(
      deps.db,
      `UPDATE ims_bills SET supplier_id = :supplierId, supplier_name = :supplierName, supplier_bill_no = :supplierBillNo, bill_date = :billDate, due_date = :dueDate,
         \`lines\` = :lines, subtotal = :subtotal, tax_total = :taxTotal, grand_total = :grandTotal, category = :category, notes = :notes
         ${backToApproval ? ", status = 'pending_approval', decided_by = NULL, decided_by_name = NULL, decided_at = NULL" : ""}
       WHERE tenant_id = :tenantId AND id = :id`,
      {
        tenantId: actor.tenantId,
        id: row.id,
        supplierId: v.supplierId,
        supplierName: input.supplierName.trim(),
        supplierBillNo: input.supplierBillNo?.trim() || null,
        billDate: input.billDate,
        dueDate: v.dueDate,
        lines: v.lines ? JSON.stringify(v.lines) : null,
        subtotal: v.subtotal,
        taxTotal: v.taxTotal,
        grandTotal: v.grandTotal,
        category: input.category ?? null,
        notes: input.notes ?? null,
      },
    );
    await recordEvent(deps, actor, {
      type: "bill.updated",
      entityType: "bill",
      entityId: row.id,
      summary: `Updated bill ${row.bill_no} (${formatINR(v.grandTotal)})${backToApproval ? " — sent back for approval" : ""}`,
      notice: backToApproval ? { kind: "approval_requested", title: `Bill ${row.bill_no} changed and needs approval`, body: `${input.supplierName} · ${formatINR(v.grandTotal)}`, path: `?m=payables&open=${row.id}` } : undefined,
    });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/approve", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "approvals");
    const input = parse(z.object({ note: optText(500) }), req.body);
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "pending_approval" && row.status !== "on_hold") throw conflict(row.status === "cancelled" ? "This bill is cancelled" : "This bill is already approved");
    await exec(
      deps.db,
      `UPDATE ims_bills SET status = 'approved', hold_reason = NULL, decided_by = :userId, decided_by_name = :userName, decided_at = CURRENT_TIMESTAMP
         ${input.note ? ", notes = CONCAT(COALESCE(notes, ''), CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n' END, :note)" : ""}
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, userId: actor.userId, userName: actorName(actor), note: input.note ? `Approval note: ${input.note}` : null },
    );
    await recordEvent(deps, actor, {
      type: "bill.approved",
      entityType: "bill",
      entityId: row.id,
      summary: `Approved bill ${row.bill_no} from ${row.supplier_name} (${formatINR(money(row.grand_total))})`,
      notice: decisionNotice(row, actor, `Bill ${row.bill_no} approved`, `${row.supplier_name} · ${formatINR(money(row.grand_total))} — ready to pay`),
    });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/hold", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["approvals", "payables"]);
    const input = parse(z.object({ reason: z.string().trim().min(2, "Pick or type a reason").max(255) }), req.body);
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (!["pending_approval", "approved", "scheduled"].includes(row.status)) throw conflict(row.status === "on_hold" ? "This bill is already on hold" : "Cancelled bills can't be put on hold");
    await exec(deps.db, `UPDATE ims_bills SET status = 'on_hold', hold_reason = :reason, scheduled_on = NULL WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      reason: input.reason,
    });
    await recordEvent(deps, actor, {
      type: "bill.held",
      entityType: "bill",
      entityId: row.id,
      summary: `Put bill ${row.bill_no} on hold — ${input.reason}`,
      notice: decisionNotice(row, actor, `Bill ${row.bill_no} on hold`, `${row.supplier_name} · ${input.reason}`),
    });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/release", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["approvals", "payables"]);
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "on_hold") throw conflict("This bill isn't on hold");
    const approver = can(res, "approvals");
    const next = approver || row.decided_by ? "approved" : "pending_approval";
    await exec(
      deps.db,
      `UPDATE ims_bills SET status = :next, hold_reason = NULL ${approver && !row.decided_by ? ", decided_by = :userId, decided_by_name = :userName, decided_at = CURRENT_TIMESTAMP" : ""} WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: row.id, next, userId: actor.userId, userName: actorName(actor) },
    );
    await recordEvent(deps, actor, {
      type: "bill.released",
      entityType: "bill",
      entityId: row.id,
      summary: `Released the hold on bill ${row.bill_no}${next === "pending_approval" ? " — back to approval" : ""}`,
      notice:
        next === "pending_approval"
          ? { kind: "approval_requested", title: `Bill ${row.bill_no} needs approval`, body: `${row.supplier_name} · ${formatINR(money(row.grand_total))}`, path: `?m=payables&open=${row.id}` }
          : decisionNotice(row, actor, `Bill ${row.bill_no} released`, `${row.supplier_name} — ready to pay`),
    });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/schedule", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const input = parse(z.object({ date: isoDate, method: z.enum(PAY_METHODS).default("bank") }), req.body);
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (!billPayable(row.status)) throw conflict(row.status === "pending_approval" ? "Approve the bill before scheduling payment" : row.status === "on_hold" ? "Release the hold before scheduling payment" : "Cancelled bills can't be scheduled");
    if (billBalance({ status: row.status, grandTotal: money(row.grand_total), amountPaid: money(row.amount_paid) }) <= 0.005) throw conflict("This bill is already paid");
    await exec(deps.db, `UPDATE ims_bills SET status = 'scheduled', scheduled_on = :date, pay_method = :method WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      date: input.date,
      method: input.method,
    });
    await recordEvent(deps, actor, { type: "bill.scheduled", entityType: "bill", entityId: row.id, summary: `Scheduled payment of bill ${row.bill_no} for ${dateText(input.date)} (${input.method.toUpperCase()})` });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/unschedule", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (row.status !== "scheduled") throw conflict("This bill isn't scheduled");
    await exec(deps.db, `UPDATE ims_bills SET status = 'approved', scheduled_on = NULL, run_id = NULL WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "bill.unscheduled", entityType: "bill", entityId: row.id, summary: `Removed the payment schedule on bill ${row.bill_no}` });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["payables", "approvals"]);
    const input = parse(z.object({ reason: z.string().trim().min(3, "Give a short reason").max(255) }), req.body);
    const row = await loadBillRow(deps.db, actor.tenantId, req.params.id);
    if (row.status === "cancelled") throw conflict("This bill is already cancelled");
    if (money(row.amount_paid) > 0.005) throw conflict(`${formatINR(money(row.amount_paid))} has been paid on this bill. Void those payments first.`);
    await exec(deps.db, `UPDATE ims_bills SET status = 'cancelled', hold_reason = :reason, scheduled_on = NULL, run_id = NULL WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      reason: `Cancelled: ${input.reason}`.slice(0, 255),
    });
    await recordEvent(deps, actor, {
      type: "bill.cancelled",
      entityType: "bill",
      entityId: row.id,
      summary: `Cancelled bill ${row.bill_no} from ${row.supplier_name} — ${input.reason}`,
      notice: decisionNotice(row, actor, `Bill ${row.bill_no} cancelled`, `${row.supplier_name} · ${input.reason}`),
    });
    res.json(await billDetail(deps, actor.tenantId, row.id));
  });

  router.post("/bills/:id/payments", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const input = parse(PaymentInput, req.body);
    const date = input.date ?? todayISO();
    const row = await tx(deps.db, async (conn) => {
      const r = await loadBillRow(conn, actor.tenantId, req.params.id, true);
      if (!billPayable(r.status)) throw conflict(r.status === "pending_approval" ? "Approve the bill before paying it" : r.status === "on_hold" ? "Release the hold before paying" : "Cancelled bills can't be paid");
      const balance = billBalance({ status: r.status, grandTotal: money(r.grand_total), amountPaid: money(r.amount_paid) });
      if (input.amount > balance + 0.005) throw badRequest(`That's more than the balance due (${formatINR(balance)})`);
      await assertDayOpen(conn, actor.tenantId, date);
      await payBill(conn, actor, r, { ...input, date });
      return r;
    });
    await recordEvent(deps, actor, {
      type: "bill.paid",
      entityType: "bill",
      entityId: row.id,
      summary: `Paid ${formatINR(input.amount)} (${input.method.toUpperCase()}) to ${row.supplier_name} for ${row.bill_no}`,
      payload: { amount: input.amount, method: input.method, reference: input.reference },
    });
    res.status(201).json(await billDetail(deps, actor.tenantId, row.id));
  });

  /* ---------- Payment runs ---------- */

  router.get("/payment-runs", async (_req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["payables", "approvals"]);
    const list = await rows<RunRow>(deps.db, `SELECT * FROM ims_payment_runs WHERE tenant_id = :tenantId ORDER BY run_date DESC, created_at DESC LIMIT 200`, { tenantId: actor.tenantId });
    res.json({ runs: list.map(mapRun) });
  });

  router.get("/payment-runs/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["payables", "approvals"]);
    const run = await one<RunRow>(deps.db, `SELECT * FROM ims_payment_runs WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!run) throw notFound("Payment run");
    const ids = json<string[]>(run.bill_ids, []);
    const today = todayISO();
    const bills = ids.length ? (await rows<BillRow>(deps.db, `${BILL_SELECT} WHERE b.tenant_id = :tenantId AND b.id IN (:ids)`, { tenantId: actor.tenantId, ids })).map((r) => mapBill(r, today)) : [];
    const payments = (await rows<PaymentRow>(deps.db, `SELECT * FROM ims_payments WHERE tenant_id = :tenantId AND run_id = :id ORDER BY created_at`, { tenantId: actor.tenantId, id: run.id })).map(mapPayment);
    res.json({ run: mapRun(run), bills, payments });
  });

  /* Select bills → one run. `markPaid` pays every balance now; otherwise the bills are scheduled for the run date. */
  router.post("/payment-runs", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const input = parse(
      z.object({
        billIds: z.array(z.string().uuid()).min(1, "Pick at least one bill").max(500),
        runDate: isoDate,
        method: z.enum(PAY_METHODS).default("bank"),
        reference: optText(80),
        notes: optText(500),
        markPaid: z.boolean().default(false),
      }),
      req.body,
    );
    const settings = await getSettings(deps, actor.tenantId);
    const id = randomUUID();
    const result = await tx(deps.db, async (conn) => {
      if (input.markPaid) await assertDayOpen(conn, actor.tenantId, input.runDate);
      const bills = await rows<BillRow>(conn, `SELECT * FROM ims_bills WHERE tenant_id = :tenantId AND id IN (:ids) FOR UPDATE`, { tenantId: actor.tenantId, ids: input.billIds });
      const blocked = bills.filter((b) => !billPayable(b.status));
      if (blocked.length) throw conflict(`These bills aren't approved for payment: ${blocked.map((b) => b.bill_no).join(", ")}`);
      const payable = bills
        .map((b) => ({ row: b, balance: billBalance({ status: b.status, grandTotal: money(b.grand_total), amountPaid: money(b.amount_paid) }) }))
        .filter((b) => b.balance > 0.005);
      if (!payable.length) throw badRequest("Every selected bill is already paid");
      const total = round2(payable.reduce((s, b) => s + b.balance, 0));
      const runNo = await nextDocNo(conn, actor.tenantId, "payrun", "RUN", input.runDate, settings.fiscalYearStart);
      await exec(
        conn,
        `INSERT INTO ims_payment_runs (id, tenant_id, run_no, status, run_date, method, reference, bill_ids, bill_count, total, notes, paid_at, created_by, created_by_name)
         VALUES (:id, :tenantId, :runNo, :status, :runDate, :method, :reference, :billIds, :count, :total, :notes, ${input.markPaid ? "CURRENT_TIMESTAMP" : "NULL"}, :userId, :userName)`,
        {
          id,
          tenantId: actor.tenantId,
          runNo,
          status: input.markPaid ? "paid" : "scheduled",
          runDate: input.runDate,
          method: input.method,
          reference: input.reference ?? null,
          billIds: JSON.stringify(payable.map((b) => b.row.id)),
          count: payable.length,
          total,
          notes: input.notes ?? null,
          userId: actor.userId,
          userName: actorName(actor),
        },
      );
      for (const b of payable) {
        if (input.markPaid) {
          await payBill(conn, actor, b.row, { amount: b.balance, method: input.method, reference: input.reference ?? runNo, date: input.runDate, runId: id, notes: `Payment run ${runNo}` });
        } else {
          await exec(conn, `UPDATE ims_bills SET status = 'scheduled', scheduled_on = :date, pay_method = :method, run_id = :runId WHERE tenant_id = :tenantId AND id = :id`, {
            tenantId: actor.tenantId,
            id: b.row.id,
            date: input.runDate,
            method: input.method,
            runId: id,
          });
        }
      }
      return { runNo, total, count: payable.length };
    });
    await recordEvent(deps, actor, {
      type: input.markPaid ? "payrun.paid" : "payrun.created",
      entityType: "payrun",
      entityId: id,
      summary: `${input.markPaid ? "Paid" : "Scheduled"} payment run ${result.runNo}: ${result.count} bill${result.count === 1 ? "" : "s"}, ${formatINR(result.total)} on ${dateText(input.runDate)}`,
    });
    const run = await one<RunRow>(deps.db, `SELECT * FROM ims_payment_runs WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ run: run ? mapRun(run) : null });
  });

  router.post("/payment-runs/:id/pay", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const input = parse(z.object({ paidOn: isoDate.optional(), reference: optText(80) }), req.body);
    const paidOn = input.paidOn ?? todayISO();
    const out = await tx(deps.db, async (conn) => {
      const run = await one<RunRow>(conn, `SELECT * FROM ims_payment_runs WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId: actor.tenantId, id: req.params.id });
      if (!run) throw notFound("Payment run");
      if (run.status !== "scheduled") throw conflict(`This run is already ${run.status}`);
      await assertDayOpen(conn, actor.tenantId, paidOn);
      const ids = json<string[]>(run.bill_ids, []);
      const bills = ids.length ? await rows<BillRow>(conn, `SELECT * FROM ims_bills WHERE tenant_id = :tenantId AND id IN (:ids) FOR UPDATE`, { tenantId: actor.tenantId, ids }) : [];
      let total = 0;
      let count = 0;
      for (const b of bills) {
        if (!billPayable(b.status)) continue;
        const balance = billBalance({ status: b.status, grandTotal: money(b.grand_total), amountPaid: money(b.amount_paid) });
        if (balance <= 0.005) continue;
        await payBill(conn, actor, b, { amount: balance, method: (PAY_METHODS as readonly string[]).includes(run.method) ? (run.method as PayMethod) : "bank", reference: input.reference ?? run.reference ?? run.run_no, date: paidOn, runId: run.id, notes: `Payment run ${run.run_no}` });
        total = round2(total + balance);
        count += 1;
      }
      await exec(conn, `UPDATE ims_payment_runs SET status = 'paid', paid_at = CURRENT_TIMESTAMP, reference = COALESCE(:reference, reference) WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id: run.id,
        reference: input.reference ?? null,
      });
      return { runNo: run.run_no, total, count };
    });
    await recordEvent(deps, actor, { type: "payrun.paid", entityType: "payrun", entityId: req.params.id, summary: `Marked payment run ${out.runNo} paid — ${out.count} bill(s), ${formatINR(out.total)}` });
    res.json(out);
  });

  router.post("/payment-runs/:id/cancel", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "payables");
    const run = await one<RunRow>(deps.db, `SELECT * FROM ims_payment_runs WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!run) throw notFound("Payment run");
    if (run.status !== "scheduled") throw conflict("Only scheduled runs can be cancelled");
    await tx(deps.db, async (conn) => {
      await exec(conn, `UPDATE ims_bills SET status = 'approved', scheduled_on = NULL, run_id = NULL WHERE tenant_id = :tenantId AND run_id = :id AND status = 'scheduled'`, { tenantId: actor.tenantId, id: run.id });
      await exec(conn, `UPDATE ims_payment_runs SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: run.id });
    });
    await recordEvent(deps, actor, { type: "payrun.cancelled", entityType: "payrun", entityId: run.id, summary: `Cancelled payment run ${run.run_no}; its bills are unscheduled` });
    res.json({ ok: true });
  });
}