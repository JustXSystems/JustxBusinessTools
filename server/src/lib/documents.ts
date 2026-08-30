import { pool } from "../db.js";
import { isDocumentToolId, newRecordId } from "./constants.js";
import { getActiveProfileId } from "./request-context.js";

/** Upsert receivable in payment tracker when an invoice is saved. */
export async function syncInvoiceToPaymentTracker(
  invoiceId: string,
  docNo: string,
  partyName: string,
  docDate: string,
  amount: number,
): Promise<void> {
  const recvId = `recv_${invoiceId}`;
  const data = {
    kind: "Receivable",
    party: partyName,
    ref: docNo,
    date: docDate,
    amount,
    status: "Pending",
  };

  const [existing] = await pool.query(
    `SELECT id FROM tool_records WHERE id = :id AND business_profile_id = :profileId`,
    { id: recvId, profileId: getActiveProfileId() },
  );
  const hasRow = Array.isArray(existing) && existing.length > 0;

  if (hasRow) {
    await pool.query(
      `UPDATE tool_records SET data = :data, tool_id = 'paymenttracker' WHERE id = :id`,
      { id: recvId, data: JSON.stringify(data) },
    );
  } else {
    await pool.query(
      `INSERT INTO tool_records (id, business_profile_id, tool_id, data)
       VALUES (:id, :profileId, 'paymenttracker', :data)`,
      { id: recvId, profileId: getActiveProfileId(), data: JSON.stringify(data) },
    );
  }

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tool_records
     WHERE business_profile_id = :profileId AND tool_id = 'paymenttracker'`,
    { profileId: getActiveProfileId() },
  );
  const row = Array.isArray(rows) ? rows[0] : { cnt: 0 };
  const count = Number((row as { cnt: number }).cnt) || 0;
  await pool.query(
    `INSERT INTO tool_usage (business_profile_id, tool_id, record_count)
     VALUES (:profileId, 'paymenttracker', :count)
     ON DUPLICATE KEY UPDATE record_count = :count`,
    { profileId: getActiveProfileId(), count },
  );
}

export function newDocumentId(toolId: string): string {
  return newRecordId(toolId);
}

export function isDocumentTool(toolId: string): boolean {
  return isDocumentToolId(toolId);
}
