import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";

export type PartyDb = Pool | PoolConnection;
type Params = Record<string, unknown>;

const run = (db: PartyDb, sql: string, params: Params) => (db as Pool).query(sql, params as Parameters<Pool["query"]>[1]);

export async function rows<T>(db: PartyDb, sql: string, params: Params = {}): Promise<T[]> {
  const [result] = await run(db, sql, params);
  return (Array.isArray(result) ? result : []) as T[];
}

export async function one<T>(db: PartyDb, sql: string, params: Params = {}): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function exec(db: PartyDb, sql: string, params: Params = {}): Promise<ResultSetHeader> {
  const [result] = await run(db, sql, params);
  return result as ResultSetHeader;
}
