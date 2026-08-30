import { pool } from "../../db.js";
import { getActiveOrgId } from "../request-context.js";
import { orgEqualsSql } from "../platform-admin.js";

export async function getSaasPaymentSummary(days = 90) {
  const orgId = getActiveOrgId();
  const orgSql = orgEqualsSql("organization_id");

  const [subRows] = await pool.query(
    `SELECT plan_id, status, mrr_inr, current_period_start, current_period_end, payment_provider
     FROM org_subscriptions WHERE ${orgSql}`,
    { orgId },
  );
  const sub = Array.isArray(subRows) ? subRows[0] : null;

  const [txnRows] = await pool.query(
    `SELECT id, type, status, amount_inr, provider, error_code, error_message, occurred_at
     FROM payment_transactions
     WHERE ${orgSql} AND occurred_at >= DATE_SUB(NOW(), INTERVAL :days DAY)
     ORDER BY occurred_at DESC LIMIT 100`,
    { orgId, days },
  );

  const transactions = (Array.isArray(txnRows) ? txnRows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      type: String(r.type),
      status: String(r.status),
      amountInr: Number(r.amount_inr),
      provider: String(r.provider),
      errorCode: r.error_code as string | null,
      errorMessage: r.error_message as string | null,
      occurredAt: String(r.occurred_at),
    };
  });

  const success = transactions.filter((t) => t.status === "success");
  const failed = transactions.filter((t) => t.status === "failed");
  const collected = success.reduce((s, t) => s + t.amountInr, 0);
  const mrr = (Array.isArray(subRows) ? subRows : []).reduce(
    (sum, row) => sum + Number((row as { mrr_inr?: number }).mrr_inr ?? 0),
    0,
  );

  const [invoiceRows] = await pool.query(
    `SELECT id, invoice_no, status, amount_inr, period_start, period_end, created_at
     FROM billing_invoices WHERE ${orgSql} ORDER BY created_at DESC LIMIT 20`,
    { orgId },
  );

  const invoices = (Array.isArray(invoiceRows) ? invoiceRows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      invoiceNo: String(r.invoice_no),
      status: String(r.status),
      amountInr: Number(r.amount_inr),
      periodStart: r.period_start ? String(r.period_start).slice(0, 10) : null,
      periodEnd: r.period_end ? String(r.period_end).slice(0, 10) : null,
      createdAt: String(r.created_at),
    };
  });

  return {
    subscription: sub
      ? {
          planId: String((sub as { plan_id: string }).plan_id),
          status: String((sub as { status: string }).status),
          mrrInr: mrr,
          currentPeriodStart: (sub as { current_period_start: string | null }).current_period_start,
          currentPeriodEnd: (sub as { current_period_end: string | null }).current_period_end,
          provider: (sub as { payment_provider: string | null }).payment_provider,
        }
      : null,
    summary: {
      collectedInr: collected,
      successCount: success.length,
      failedCount: failed.length,
      failureRate: transactions.length ? failed.length / transactions.length : 0,
    },
    transactions,
    invoices,
  };
}

export async function recordSaasTransaction(
  orgId: number,
  type: string,
  status: string,
  amountInr: number,
  provider: string,
  externalId?: string,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO payment_transactions
     (organization_id, provider, external_id, type, status, amount_inr, error_code, error_message)
     VALUES (:orgId, :provider, :externalId, :type, :status, :amount, :errorCode, :errorMessage)`,
    {
      orgId,
      provider,
      externalId: externalId ?? null,
      type,
      status,
      amount: amountInr,
      errorCode: errorCode ?? null,
      errorMessage: errorMessage ?? null,
    },
  );

  if (status === "success" && type === "subscription_charge") {
    await pool.query(
      `UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`,
      { orgId, mrr: amountInr },
    );
  }
}
