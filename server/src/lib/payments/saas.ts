import { pool } from "../../db.js";
import { getActiveOrgId } from "../request-context.js";
import { orgEqualsSql } from "../platform-admin.js";

let paymentTxnIdempotencyReady: Promise<void> | null = null;

export async function ensurePaymentTxnIdempotency(): Promise<void> {
  if (!paymentTxnIdempotencyReady) {
    paymentTxnIdempotencyReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE payment_transactions
           ADD UNIQUE KEY uq_pay_txn_provider_ext_st (provider, external_id, type, status)`,
        );
      } catch (err) {
        const code = (err as { code?: string }).code;
        // ER_DUP_KEYNAME / already exists — OK. Duplicate data may block; log once.
        if (code !== "ER_DUP_KEYNAME" && code !== "ER_CANT_DROP_FIELD_OR_KEY") {
          console.warn(
            "[payments] could not add uq_pay_txn_provider_ext_st:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    })();
  }
  await paymentTxnIdempotencyReady;
}

/** Returns true if this provider+externalId success charge was already recorded. */
export async function hasProcessedPaymentEvent(
  provider: string,
  externalId: string,
  type: string,
): Promise<boolean> {
  if (!externalId) return false;
  await ensurePaymentTxnIdempotency();
  const [rows] = await pool.query(
    `SELECT id FROM payment_transactions
     WHERE provider = :provider
       AND external_id = :externalId
       AND type = :type
       AND status = 'success'
     LIMIT 1`,
    { provider, externalId, type },
  );
  return Array.isArray(rows) && rows.length > 0;
}

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

  let billingItems: Array<{
    toolId: string;
    name: string;
    unitPriceInr: number;
    periodEnd: string | null;
    source: string | null;
  }> = [];
  try {
    const { listSubscriptionItems } = await import("../subscription-items.js");
    billingItems = (await listSubscriptionItems(orgId)).map((i) => ({
      toolId: i.toolId,
      name: i.name,
      unitPriceInr: i.unitPriceInr,
      periodEnd: i.periodEnd,
      source: i.source,
    }));
  } catch {
    /* optional until migrated */
  }

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
    billingItems,
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
): Promise<"inserted" | "duplicate"> {
  await ensurePaymentTxnIdempotency();
  try {
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
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ER_DUP_ENTRY" && externalId) {
      return "duplicate";
    }
    throw err;
  }

  if (status === "success" && type === "subscription_charge") {
    await pool.query(
      `UPDATE org_subscriptions SET mrr_inr = :mrr WHERE organization_id = :orgId`,
      { orgId, mrr: amountInr },
    );
  }
  return "inserted";
}
