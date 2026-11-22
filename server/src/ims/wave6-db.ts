/**
 * Wave 6 data helpers shared by sales.ts (payment hooks, receivables) and sales-wave6.ts (routes):
 * installment plans on invoices and dunning run history. Imports nothing from sales.ts so there is no cycle.
 */
import { exec, isoOf, money, one, rows, tsOf, type Queryable } from "./db.js";
import { round2 } from "./logic.js";
import { allocateToInstallments, deallocateFromInstallments, installmentStatusOf, type InstallmentStatus } from "./wave6-logic.js";

/** Older deploys may not have run migration 059 yet — plan hooks must never break a payment. */
async function ignoreMissingTable(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return;
    throw err;
  }
}

/* ---------- Installments ---------- */

type PlanRow = { id: string; invoice_id: string; label: string | null; status: string; created_by_name: string | null; created_at: string };
type ScheduleRow = { id: string; plan_id: string; seq_no: number; due_on: unknown; amount: string; amount_paid: string; status: string; label: string | null };

export type ImsInstallment = {
  id: string;
  seqNo: number;
  dueOn: string;
  amount: number;
  amountPaid: number;
  balance: number;
  status: InstallmentStatus;
  /** Past due and not fully paid (computed against today). */
  overdue: boolean;
  label: string | null;
};

export type ImsInstallmentPlan = {
  id: string;
  invoiceId: string;
  label: string | null;
  status: "active" | "completed" | "cancelled";
  total: number;
  paid: number;
  createdByName: string | null;
  createdAt: string | null;
  installments: ImsInstallment[];
};

export async function loadInstallmentPlan(db: Queryable, tenantId: number, invoiceId: string, today: string): Promise<ImsInstallmentPlan | null> {
  const plan = await one<PlanRow>(db, `SELECT * FROM ims_installment_plans WHERE tenant_id = :tenantId AND invoice_id = :invoiceId LIMIT 1`, { tenantId, invoiceId });
  if (!plan) return null;
  const sched = await rows<ScheduleRow>(db, `SELECT * FROM ims_installment_schedule WHERE tenant_id = :tenantId AND plan_id = :planId ORDER BY seq_no ASC, due_on ASC`, {
    tenantId,
    planId: plan.id,
  });
  const installments = sched.map<ImsInstallment>((s) => {
    const amount = round2(money(s.amount));
    const amountPaid = round2(money(s.amount_paid));
    const status = installmentStatusOf(amount, amountPaid);
    const dueOn = isoOf(s.due_on);
    return { id: s.id, seqNo: Number(s.seq_no), dueOn, amount, amountPaid, balance: round2(Math.max(0, amount - amountPaid)), status, overdue: status !== "paid" && dueOn < today, label: s.label };
  });
  return {
    id: plan.id,
    invoiceId: plan.invoice_id,
    label: plan.label,
    status: plan.status as ImsInstallmentPlan["status"],
    total: round2(installments.reduce((s, i) => s + i.amount, 0)),
    paid: round2(installments.reduce((s, i) => s + i.amountPaid, 0)),
    createdByName: plan.created_by_name,
    createdAt: tsOf(plan.created_at),
    installments,
  };
}

async function writeChanges(conn: Queryable, tenantId: number, changes: ReadonlyArray<{ id: string; amountPaid: number; status: InstallmentStatus }>): Promise<void> {
  for (const c of changes) {
    await exec(conn, `UPDATE ims_installment_schedule SET amount_paid = :amountPaid, status = :status WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId,
      id: c.id,
      amountPaid: c.amountPaid,
      status: c.status,
    });
  }
}

async function lockedSchedule(conn: Queryable, tenantId: number, planId: string) {
  const sched = await rows<ScheduleRow>(conn, `SELECT * FROM ims_installment_schedule WHERE tenant_id = :tenantId AND plan_id = :planId ORDER BY seq_no ASC, due_on ASC FOR UPDATE`, { tenantId, planId });
  return sched.map((s) => ({ id: s.id, amount: round2(money(s.amount)), amountPaid: round2(money(s.amount_paid)) }));
}

async function settlePlanStatus(conn: Queryable, tenantId: number, planId: string): Promise<void> {
  const left = await one<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM ims_installment_schedule WHERE tenant_id = :tenantId AND plan_id = :planId AND status <> 'paid'`, { tenantId, planId });
  await exec(conn, `UPDATE ims_installment_plans SET status = :status WHERE tenant_id = :tenantId AND id = :planId AND status <> 'cancelled'`, {
    tenantId,
    planId,
    status: Number(left?.n ?? 0) === 0 ? "completed" : "active",
  });
}

/** Called inside the payment transaction: spreads the amount over the earliest pending installments of an active plan. */
export function allocateInvoicePlanPayment(conn: Queryable, tenantId: number, invoiceId: string, amount: number): Promise<void> {
  return ignoreMissingTable(async () => {
    const plan = await one<{ id: string }>(conn, `SELECT id FROM ims_installment_plans WHERE tenant_id = :tenantId AND invoice_id = :invoiceId AND status = 'active' LIMIT 1 FOR UPDATE`, {
      tenantId,
      invoiceId,
    });
    if (!plan) return;
    const { changes } = allocateToInstallments(await lockedSchedule(conn, tenantId, plan.id), amount);
    if (!changes.length) return;
    await writeChanges(conn, tenantId, changes);
    await settlePlanStatus(conn, tenantId, plan.id);
  });
}

/**
 * Called when a receipt is voided: takes the amount back from the latest paid installments.
 * Payments recorded before the plan existed (`paymentCreatedAt` earlier than the plan) never touched it, so they are ignored.
 */
export function deallocateInvoicePlanPayment(conn: Queryable, tenantId: number, invoiceId: string, amount: number, paymentCreatedAt: string | null): Promise<void> {
  return ignoreMissingTable(async () => {
    const plan = await one<{ id: string }>(
      conn,
      `SELECT id FROM ims_installment_plans
       WHERE tenant_id = :tenantId AND invoice_id = :invoiceId AND status IN ('active', 'completed')
         ${paymentCreatedAt ? "AND created_at <= :since" : ""}
       LIMIT 1 FOR UPDATE`,
      { tenantId, invoiceId, since: paymentCreatedAt },
    );
    if (!plan) return;
    const { changes } = deallocateFromInstallments(await lockedSchedule(conn, tenantId, plan.id), amount);
    if (!changes.length) return;
    await writeChanges(conn, tenantId, changes);
    await settlePlanStatus(conn, tenantId, plan.id);
  });
}

/** Invoice cancelled (only possible with nothing received): retire its plan. */
export function cancelInvoicePlan(conn: Queryable, tenantId: number, invoiceId: string): Promise<void> {
  return ignoreMissingTable(async () => {
    await exec(conn, `UPDATE ims_installment_plans SET status = 'cancelled' WHERE tenant_id = :tenantId AND invoice_id = :invoiceId`, { tenantId, invoiceId });
  });
}

/* ---------- Dunning runs ---------- */

export type DunningRunRow = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  level_key: string;
  level_label: string;
  letter_tone: string;
  total_due: string;
  invoice_ids: unknown;
  status: string;
  prepared_by_name: string | null;
  prepared_at: string;
  notes: string | null;
};

export const mapDunningRun = (r: DunningRunRow) => {
  let invoiceIds: string[] = [];
  const raw = r.invoice_ids;
  if (Array.isArray(raw)) invoiceIds = raw.map(String);
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) invoiceIds = parsed.map(String);
    } catch {
      invoiceIds = [];
    }
  }
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    levelKey: r.level_key,
    levelLabel: r.level_label,
    tone: r.letter_tone,
    totalDue: round2(money(r.total_due)),
    invoiceIds,
    status: r.status,
    preparedByName: r.prepared_by_name,
    preparedAt: tsOf(r.prepared_at),
    notes: r.notes,
  };
};

export type ImsDunningRun = ReturnType<typeof mapDunningRun>;

export async function listDunningRuns(db: Queryable, tenantId: number, opts: { customerId?: string | null; customerName?: string | null; limit?: number }): Promise<ImsDunningRun[]> {
  const where = ["tenant_id = :tenantId"];
  const params: Record<string, unknown> = { tenantId, limit: Math.min(200, Math.max(1, opts.limit ?? 20)) };
  if (opts.customerId) {
    where.push("customer_id = :customerId");
    params.customerId = opts.customerId;
  } else if (opts.customerName) {
    where.push("customer_id IS NULL AND customer_name = :customerName");
    params.customerName = opts.customerName;
  }
  const list = await rows<DunningRunRow>(db, `SELECT * FROM ims_dunning_runs WHERE ${where.join(" AND ")} ORDER BY prepared_at DESC, id DESC LIMIT :limit`, params);
  return list.map(mapDunningRun);
}

/** Latest run per customer, keyed like the receivables customer key (`customerId` or `name:<lowercase name>`). */
export async function lastDunningByCustomer(db: Queryable, tenantId: number): Promise<Record<string, { levelKey: string; levelLabel: string; preparedAt: string | null; runs: number }>> {
  const out: Record<string, { levelKey: string; levelLabel: string; preparedAt: string | null; runs: number }> = {};
  let list: DunningRunRow[] = [];
  try {
    list = await rows<DunningRunRow>(db, `SELECT * FROM ims_dunning_runs WHERE tenant_id = :tenantId ORDER BY prepared_at DESC, id DESC LIMIT 1000`, { tenantId });
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return out;
    throw err;
  }
  for (const r of list) {
    const key = r.customer_id ?? `name:${r.customer_name.toLowerCase()}`;
    const hit = out[key];
    if (hit) hit.runs += 1;
    else out[key] = { levelKey: r.level_key, levelLabel: r.level_label, preparedAt: tsOf(r.prepared_at), runs: 1 };
  }
  return out;
}
