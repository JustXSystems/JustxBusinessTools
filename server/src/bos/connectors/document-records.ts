import type { Pool } from "mysql2/promise";
import { json, rows } from "../db.js";

export type DocumentRow = {
  id: string;
  doc_no: string;
  doc_date: string;
  party_name: string | null;
  grand_total: string | number;
  status: string;
  data: unknown;
  updated_at: string | null;
};

/** Read-only access to JBT's shared `document_records` table for one tool. */
export async function listDocuments(db: Pool, tenantId: number, toolId: string, ref?: string): Promise<Array<DocumentRow & { payload: Record<string, unknown> }>> {
  const list = await rows<DocumentRow>(
    db,
    `SELECT id, doc_no, doc_date, party_name, grand_total, status, data, updated_at
     FROM document_records
     WHERE business_profile_id = :tenantId AND tool_id = :toolId ${ref ? "AND id = :ref" : ""}
     ORDER BY updated_at DESC
     LIMIT 500`,
    { tenantId, toolId, ref: ref ?? null },
  );
  return list.map((r) => ({ ...r, payload: json<Record<string, unknown>>(r.data, {}) }));
}

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
