import { pool } from "../../db.js";
import { getActiveProfileId } from "../request-context.js";
import { isPlatformAdmin } from "../platform-admin.js";

type AgingBucket = { label: string; count: number; amount: number };

export async function getCollectionsSummary() {
  const profileId = getActiveProfileId();

  const [rows] = await pool.query(
    isPlatformAdmin()
      ? `SELECT data FROM tool_records WHERE tool_id = 'paymenttracker'`
      : `SELECT data FROM tool_records WHERE business_profile_id = :profileId AND tool_id = 'paymenttracker'`,
    { profileId },
  );

  let totalReceivable = 0;
  let totalPayable = 0;
  let overdueReceivable = 0;
  let pendingReceivable = 0;
  const aging: AgingBucket[] = [
    { label: "0-30 days", count: 0, amount: 0 },
    { label: "31-60 days", count: 0, amount: 0 },
    { label: "61-90 days", count: 0, amount: 0 },
    { label: "90+ days", count: 0, amount: 0 },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const row of Array.isArray(rows) ? rows : []) {
    let data: Record<string, unknown> = {};
    const raw = (row as { data: string | Record<string, unknown> }).data;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = {};
      }
    } else {
      data = raw ?? {};
    }

    const amount = Number(data.amount) || 0;
    const kind = String(data.kind ?? "");
    const status = String(data.status ?? "");
    const dateStr = String(data.date ?? "");
    const date = dateStr ? new Date(dateStr.slice(0, 10)) : today;
    const days = Math.floor((today.getTime() - date.getTime()) / 86400000);

    if (kind === "Receivable") {
      if (status !== "Paid") totalReceivable += amount;
      if (status === "Overdue") overdueReceivable += amount;
      if (status === "Pending" || status === "Partially Paid") pendingReceivable += amount;

      if (status === "Overdue" || status === "Pending" || status === "Partially Paid") {
        let bucket = 0;
        if (days <= 30) bucket = 0;
        else if (days <= 60) bucket = 1;
        else if (days <= 90) bucket = 2;
        else bucket = 3;
        aging[bucket].count += 1;
        aging[bucket].amount += amount;
      }
    } else if (kind === "Payable" && status !== "Paid") {
      totalPayable += amount;
    }
  }

  const [docRows] = await pool.query(
    `SELECT SUM(grand_total) AS invoiced FROM document_records
     WHERE business_profile_id = :profileId AND tool_id = 'invoice'`,
    { profileId },
  );
  const invoiced = Array.isArray(docRows) ? docRows[0] : null;
  const invoicedTotal = Number((invoiced as { invoiced: number } | null)?.invoiced) || 0;

  const [amcRows] = await pool.query(
    `SELECT data FROM tool_records WHERE business_profile_id = :profileId AND tool_id = 'amc'`,
    { profileId },
  );
  let renewals30d = 0;
  const in30 = new Date(today.getTime() + 30 * 86400000);
  for (const row of Array.isArray(amcRows) ? amcRows : []) {
    const raw = (row as { data: string | Record<string, unknown> }).data;
    let data: Record<string, unknown> = {};
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        data = {};
      }
    } else data = raw ?? {};
    const renewal = String(data.renewalDate ?? "");
    if (!renewal) continue;
    const d = new Date(renewal.slice(0, 10));
    if (d >= today && d <= in30) renewals30d += 1;
  }

  return {
    summary: {
      totalReceivable,
      totalPayable,
      netPosition: totalReceivable - totalPayable,
      overdueReceivable,
      pendingReceivable,
      invoicedTotal,
      amcRenewalsNext30d: renewals30d,
    },
    aging,
  };
}
