/**
 * Shared helpers for the JustTestX BOS seed / wipe scripts.
 * Deterministic UUIDs keep re-runs stable; confirm gates protect production.
 */
import { createHash } from "crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../src/db.js";

export const MARKER = "justtestx:v1";
export const COMPANY = "JustTestX";
export const ORG_NAME = "JustTestX Organization";

/** Unique GSTIN for this disposable test tenant (must not collide with real profiles). */
export const GSTIN = "29JTXTS0001X1Z5";
export const PAN = "JTXTS0001X";

export type Db = Pool | PoolConnection;

export function tid(key: string): string {
  const h = createHash("sha256").update(`${MARKER}:${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requireConfirm(action: string): void {
  if (process.env.JUSTTESTX_CONFIRM === "YES") return;
  console.error(
    [
      "",
      `Refusing to ${action} without confirmation.`,
      "This script writes to the database pointed at by server/.env (often production).",
      "",
      "  PowerShell:  $env:JUSTTESTX_CONFIRM='YES'; npm run db:seed:justtestx -w server",
      "  bash:        JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx -w server",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export async function q<T extends RowDataPacket[] = RowDataPacket[]>(db: Db, sql: string, params: Record<string, unknown> = {}): Promise<T> {
  const [rows] = await db.query<T>(sql, params);
  return rows;
}

export async function exec(db: Db, sql: string, params: Record<string, unknown> = {}): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

export async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
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

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return iso(dt);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + months, Math.min(d!, 28)));
  return iso(dt);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function weekday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=Sun
}

export function* eachDate(from: string, to: string): Generator<string> {
  let cur = from;
  while (cur <= to) {
    yield cur;
    cur = addDays(cur, 1);
  }
}

export function* eachMonth(fromYm: string, toYm: string): Generator<string> {
  let [y, m] = fromYm.split("-").map(Number) as [number, number];
  const [ey, em] = toYm.split("-").map(Number) as [number, number];
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, "0")}`;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

export function fiscalYearLabel(isoDate: string, startMonth = 4): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m! >= startMonth ? y! : y! - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

export function formatDocNo(prefix: string, period: string, seq: number, pad = 4): string {
  return `${prefix}/${period}/${String(seq).padStart(pad, "0")}`;
}

export function fingerprint(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 40);
}

export async function findJustTestXProfile(): Promise<{ profileId: number; orgId: number } | null> {
  const rows = await q(
    pool,
    `SELECT p.id AS profileId, p.organization_id AS orgId
     FROM business_profiles p
     WHERE p.business_name = :name
     ORDER BY p.id DESC
     LIMIT 1`,
    { name: COMPANY },
  );
  if (!rows[0]) return null;
  return { profileId: Number(rows[0].profileId), orgId: Number(rows[0].orgId) };
}

/** Child-first wipe of every bos_* row for a tenant. Safe to call when no BOS data exists. */
export const BOS_WIPE_ORDER = [
  "bos_service_comments",
  "bos_policy_acks",
  "bos_candidate_events",
  "bos_journal_lines",
  "bos_opening_balances",
  "bos_payslips",
  "bos_budget_lines",
  "bos_bank_txns",
  "bos_asset_events",
  "bos_payments",
  "bos_training_enrollments",
  "bos_certifications",
  "bos_kras",
  "bos_promotions",
  "bos_pips",
  "bos_recognitions",
  "bos_leave_requests",
  "bos_profile_changes",
  "bos_attendance",
  "bos_salary_structures",
  "bos_travel_requests",
  "bos_service_requests",
  "bos_agreements",
  "bos_project_tasks",
  "bos_project_milestones",
  "bos_candidates",
  "bos_invoices",
  "bos_bills",
  "bos_expenses",
  "bos_payroll_runs",
  "bos_bank_accounts",
  "bos_budgets",
  "bos_assets",
  "bos_journals",
  "bos_accounts",
  "bos_job_openings",
  "bos_training_programs",
  "bos_policies",
  "bos_compliance_items",
  "bos_items",
  "bos_sales_docs",
  "bos_employees",
  "bos_departments",
  "bos_projects",
  "bos_parties",
  "bos_holidays",
  "bos_links",
  "bos_events",
  "bos_sequences",
  "bos_payroll_settings",
  "bos_accounting_settings",
  "bos_settings",
] as const;

export async function wipeBosTenant(db: Db, tenantId: number): Promise<number> {
  let total = 0;
  for (const table of BOS_WIPE_ORDER) {
    try {
      const r = await exec(db, `DELETE FROM ${table} WHERE tenant_id = :t`, { t: tenantId });
      total += r.affectedRows;
    } catch (err) {
      const e = err as { code?: string; errno?: number };
      // Table may not exist yet on older DBs — skip.
      if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) continue;
      throw err;
    }
  }
  return total;
}
