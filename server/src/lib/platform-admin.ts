import { pool } from "../db.js";
import { getActiveOrgId, getRequestContext } from "./request-context.js";

/**
 * Platform (JustX) operators who get the Admin Console and cross-org scope.
 * Env: PLATFORM_ADMIN_EMAIL — comma-separated list.
 * Defaults include production JustX operator + local bootstrap.
 */
const DEFAULT_PLATFORM_ADMIN_EMAILS = ["admin@justxsystems.com", "admin@justx.local"];

function parsePlatformAdminEmails(raw: string | undefined): string[] {
  const fromEnv = String(raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const list = fromEnv.length ? fromEnv : DEFAULT_PLATFORM_ADMIN_EMAILS;
  return Array.from(new Set(list));
}

export const PLATFORM_ADMIN_EMAILS = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAIL);

/** Primary / first configured platform admin email (back-compat). */
export const PLATFORM_ADMIN_EMAIL = PLATFORM_ADMIN_EMAILS[0] ?? "admin@justxsystems.com";

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export function isPlatformAdmin(): boolean {
  return Boolean(getRequestContext()?.isPlatformAdmin);
}

export function orgEqualsSql(column: string): string {
  return isPlatformAdmin() ? "1=1" : `${column} = :orgId`;
}

export function orgScopeParams(): { orgId: number } {
  return { orgId: getActiveOrgId() };
}

export async function ensurePlatformAdminSchema(): Promise<void> {
  try {
    await pool.query(
      `ALTER TABLE users ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0`,
    );
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
  }
  if (!PLATFORM_ADMIN_EMAILS.length) return;
  const placeholders = PLATFORM_ADMIN_EMAILS.map((_, i) => `:e${i}`).join(", ");
  const params = Object.fromEntries(PLATFORM_ADMIN_EMAILS.map((email, i) => [`e${i}`, email]));
  await pool.query(
    `UPDATE users SET is_platform_admin = 1 WHERE LOWER(email) IN (${placeholders})`,
    params,
  );
}

export function userIsPlatformAdmin(email: string, flag?: number | boolean | null): boolean {
  if (flag) return true;
  return isPlatformAdminEmail(email);
}

/** Persist platform-admin flag when email is in the allowlist (idempotent). */
export async function ensureUserPlatformAdminFlag(
  userId: number,
  email: string,
): Promise<boolean> {
  if (!isPlatformAdminEmail(email) || !Number.isInteger(userId) || userId <= 0) return false;
  await pool.query(`UPDATE users SET is_platform_admin = 1 WHERE id = :userId`, { userId });
  return true;
}
