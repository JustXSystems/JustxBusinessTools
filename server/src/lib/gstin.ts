import type { Pool, PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";
import { withFileAccessToken } from "./storage.js";

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;

export type GstinProfileRow = {
  id: number;
  organizationId: number;
  businessName: string;
  gstin: string;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  logo: string | null;
};

type Queryable = Pool | PoolConnection;

export function normalizeGstin(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

export function isValidGstin(gstin: string): boolean {
  return GSTIN_RE.test(gstin);
}

export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

export function publicGstinProfile(row: GstinProfileRow) {
  return {
    businessName: row.businessName,
    gstin: row.gstin,
    pan: row.pan,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    state: row.state,
    stateCode: row.stateCode,
    phone: row.phone,
    email: row.email,
    // Signed URL so register/login (no session) can preview the company logo.
    logo: withFileAccessToken(row.logo),
  };
}

export async function findProfileByGstin(
  gstin: string,
  conn: Queryable = pool,
): Promise<GstinProfileRow | null> {
  const [rows] = await conn.query(
    `SELECT id, organization_id, business_name, gstin, pan, address_line1, address_line2,
            state, state_code, phone, email, logo_data_url
     FROM business_profiles
     WHERE gstin = :gstin
     LIMIT 1`,
    { gstin },
  );
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    businessName: String(row.business_name ?? ""),
    gstin: String(row.gstin),
    pan: (row.pan as string | null) ?? null,
    addressLine1: (row.address_line1 as string | null) ?? null,
    addressLine2: (row.address_line2 as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    stateCode: (row.state_code as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    logo: (row.logo_data_url as string | null) ?? null,
  };
}

export async function gstinTakenByOther(
  gstin: string,
  excludeProfileId: number | null = null,
  conn: Queryable = pool,
): Promise<boolean> {
  const existing = await findProfileByGstin(gstin, conn);
  if (!existing) return false;
  if (excludeProfileId != null && existing.id === excludeProfileId) return false;
  return true;
}

export async function ensureGstinUniqueness(): Promise<void> {
  await pool.query(
    `UPDATE business_profiles SET gstin = NULL WHERE gstin IS NOT NULL AND TRIM(gstin) = ''`,
  );
  await pool.query(
    `UPDATE business_profiles SET gstin = UPPER(TRIM(gstin)) WHERE gstin IS NOT NULL`,
  );
  try {
    await pool.query(
      `ALTER TABLE business_profiles ADD UNIQUE KEY uq_business_profiles_gstin (gstin)`,
    );
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code === "ER_DUP_KEYNAME" || e.errno === 1061) return;
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) {
      console.warn("GSTIN unique index skipped because duplicate GSTINs already exist");
      return;
    }
    throw err;
  }
}
