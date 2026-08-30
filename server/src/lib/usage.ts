import { pool } from "../db.js";
import { getActiveProfileId } from "./request-context.js";
import { getRecordLimit } from "./subscription.js";
import { buildUsagePayload } from "./usage-limits.js";

export async function countToolRecords(toolId: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tool_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId`,
    { profileId: getActiveProfileId(), toolId },
  );
  const row = Array.isArray(rows) ? rows[0] : { cnt: 0 };
  return Number((row as { cnt: number }).cnt) || 0;
}

export async function syncToolUsage(toolId: string): Promise<number> {
  const count = await countToolRecords(toolId);
  await pool.query(
    `INSERT INTO tool_usage (business_profile_id, tool_id, record_count)
     VALUES (:profileId, :toolId, :count)
     ON DUPLICATE KEY UPDATE record_count = :count`,
    { profileId: getActiveProfileId(), toolId, count },
  );
  return count;
}

export async function getToolUsage(toolId: string) {
  const recordCount = await syncToolUsage(toolId);
  const limit = await getRecordLimit(getActiveProfileId(), undefined, toolId);
  return buildUsagePayload(toolId, recordCount, limit);
}

/** @deprecated Use runCreateWithLimit from usage-limits.ts */
export async function assertCanCreate(toolId: string): Promise<void> {
  const count = await countToolRecords(toolId);
  const limit = await getRecordLimit(getActiveProfileId(), undefined, toolId);
  if (limit !== null && count >= limit) {
    const err = new Error("FREE_LIMIT_REACHED") as Error & { code: string };
    err.code = "FREE_LIMIT_REACHED";
    throw err;
  }
}
