import { pool } from "../db.js";

let ready: Promise<void> | null = null;

/** Ensures `business_profiles.amc_terms` (Quotation V1 AMC terms & notes). */
export function ensureAmcTermsColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(`ALTER TABLE business_profiles ADD COLUMN amc_terms TEXT NULL`);
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
