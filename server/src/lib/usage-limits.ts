import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";
import { getActiveOrgId, getActiveProfileId } from "./request-context.js";
import { getRecordLimit } from "./subscription.js";
import { notifyUsageLimit } from "./notification-billing.js";

export class LimitReachedError extends Error {
  code = "FREE_LIMIT_REACHED";
  limit: number;

  constructor(limit: number) {
    super("FREE_LIMIT_REACHED");
    this.limit = limit;
  }
}

export type RecordKind = "tracker" | "document";

async function countTrackerRecords(conn: PoolConnection, toolId: string): Promise<number> {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM tool_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId`,
    { profileId: getActiveProfileId(), toolId },
  );
  const row = Array.isArray(rows) ? rows[0] : { cnt: 0 };
  return Number((row as { cnt: number }).cnt) || 0;
}

async function countDocumentRecords(conn: PoolConnection, toolId: string): Promise<number> {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM document_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId`,
    { profileId: getActiveProfileId(), toolId },
  );
  const row = Array.isArray(rows) ? rows[0] : { cnt: 0 };
  return Number((row as { cnt: number }).cnt) || 0;
}

export async function countRecordsForTool(
  conn: PoolConnection,
  toolId: string,
  kind: RecordKind,
): Promise<number> {
  return kind === "tracker"
    ? countTrackerRecords(conn, toolId)
    : countDocumentRecords(conn, toolId);
}

async function lockUsageRow(conn: PoolConnection, toolId: string): Promise<void> {
  await conn.query(
    `INSERT INTO tool_usage (business_profile_id, tool_id, record_count)
     VALUES (:profileId, :toolId, 0)
     ON DUPLICATE KEY UPDATE tool_id = tool_id`,
    { profileId: getActiveProfileId(), toolId },
  );
  await conn.query(
    `SELECT record_count FROM tool_usage
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     FOR UPDATE`,
    { profileId: getActiveProfileId(), toolId },
  );
}

export async function assertCanCreateInTransaction(
  conn: PoolConnection,
  toolId: string,
  kind: RecordKind,
): Promise<void> {
  await lockUsageRow(conn, toolId);
  const count = await countRecordsForTool(conn, toolId, kind);
  const limit = await getRecordLimit(getActiveProfileId(), conn, toolId);
  if (limit !== null && count >= limit) {
    notifyUsageLimit({
      organizationId: getActiveOrgId(),
      profileId: getActiveProfileId(),
      toolId,
      limit,
      kind: "reached",
      recordCount: count,
    });
    throw new LimitReachedError(limit);
  }
}

export async function syncUsageInTransaction(
  conn: PoolConnection,
  toolId: string,
  count: number,
): Promise<void> {
  await conn.query(
    `INSERT INTO tool_usage (business_profile_id, tool_id, record_count)
     VALUES (:profileId, :toolId, :count)
     ON DUPLICATE KEY UPDATE record_count = :count`,
    { profileId: getActiveProfileId(), toolId, count },
  );
}

export async function runCreateWithLimit<T>(
  toolId: string,
  kind: RecordKind,
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertCanCreateInTransaction(conn, toolId, kind);
    const result = await fn(conn);
    const count = await countRecordsForTool(conn, toolId, kind);
    await syncUsageInTransaction(conn, toolId, count);
    await conn.commit();

    const limit = await getRecordLimit(getActiveProfileId(), undefined, toolId);
    if (limit !== null && count >= limit - 4 && count < limit) {
      notifyUsageLimit({
        organizationId: getActiveOrgId(),
        profileId: getActiveProfileId(),
        toolId,
        limit,
        kind: "near",
        recordCount: count,
      });
    }
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function buildUsagePayload(
  toolId: string,
  recordCount: number,
  limit: number | null,
) {
  const atLimit = limit !== null && recordCount >= limit;
  const nearLimit = limit !== null && recordCount >= limit - 4;
  return {
    toolId,
    recordCount,
    limit,
    atLimit,
    nearLimit,
  };
}
