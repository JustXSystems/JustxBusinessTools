import { pool } from "../db.js";
import { getActiveOrgId, getRequestContext } from "./request-context.js";

export const PLATFORM_ADMIN_EMAIL = (
  process.env.PLATFORM_ADMIN_EMAIL ?? "admin@justx.local"
).trim().toLowerCase();

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
  await pool.query(
    `UPDATE users SET is_platform_admin = 1 WHERE LOWER(email) = :email`,
    { email: PLATFORM_ADMIN_EMAIL },
  );
}

export function userIsPlatformAdmin(email: string, flag?: number | boolean | null): boolean {
  if (flag) return true;
  return email.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}
