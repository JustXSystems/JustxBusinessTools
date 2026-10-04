import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";

export type BosDb = Pool;
type Queryable = Pool | PoolConnection;
type Params = Record<string, unknown>;

/** Pool and PoolConnection share `query`, but TS can't resolve overloads on the union. */
const run = (db: Queryable, sql: string, params: Params) => (db as Pool).query(sql, params as Parameters<Pool["query"]>[1]);

export async function rows<T>(db: Queryable, sql: string, params: Params = {}): Promise<T[]> {
  const [result] = await run(db, sql, params);
  return (Array.isArray(result) ? result : []) as T[];
}

export async function one<T>(db: Queryable, sql: string, params: Params = {}): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function exec(db: Queryable, sql: string, params: Params = {}): Promise<ResultSetHeader> {
  const [result] = await run(db, sql, params);
  return result as ResultSetHeader;
}

export async function tx<T>(db: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** mysql2 returns JSON columns parsed on some drivers and as strings on others. */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Atomic per-tenant counter: a single statement, safe under concurrency. */
export async function nextSequence(db: Queryable, tenantId: number, key: string, period: string): Promise<number> {
  const res = await exec(
    db,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value)
     VALUES (:tenantId, :key, :period, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE seq_value = LAST_INSERT_ID(seq_value + 1)`,
    { tenantId, key, period },
  );
  return Number(res.insertId) || 1;
}
