import { pool } from "../../db.js";
import { decryptSecret, encryptSecret } from "../secret-box.js";
import {
  generateTotpSecret,
  totpOtpauthUrl,
  verifyTotp,
} from "./totp.js";

export async function ensureMfaSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id INT UNSIGNED NOT NULL,
      secret_enc VARCHAR(512) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      confirmed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function isMfaEnabled(userId: number): Promise<boolean> {
  await ensureMfaSchema();
  const [rows] = await pool.query(
    `SELECT enabled FROM user_mfa WHERE user_id = :userId LIMIT 1`,
    { userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { enabled: number } | undefined) : undefined;
  return Boolean(row?.enabled);
}

export async function beginMfaSetup(userId: number, email: string): Promise<{
  secret: string;
  otpauthUrl: string;
}> {
  await ensureMfaSchema();
  const secret = generateTotpSecret();
  await pool.query(
    `INSERT INTO user_mfa (user_id, secret_enc, enabled)
     VALUES (:userId, :secret, 0)
     ON DUPLICATE KEY UPDATE secret_enc = VALUES(secret_enc), enabled = 0, confirmed_at = NULL`,
    { userId, secret: encryptSecret(secret) },
  );
  return {
    secret,
    otpauthUrl: totpOtpauthUrl({ secret, accountName: email, issuer: "JustXSystems" }),
  };
}

export async function confirmMfaSetup(userId: number, token: string): Promise<boolean> {
  await ensureMfaSchema();
  const [rows] = await pool.query(
    `SELECT secret_enc FROM user_mfa WHERE user_id = :userId LIMIT 1`,
    { userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { secret_enc: string } | undefined) : undefined;
  if (!row) return false;
  const secret = decryptSecret(row.secret_enc);
  if (!verifyTotp(secret, token)) return false;
  await pool.query(
    `UPDATE user_mfa SET enabled = 1, confirmed_at = CURRENT_TIMESTAMP WHERE user_id = :userId`,
    { userId },
  );
  return true;
}

export async function disableMfa(userId: number, token: string): Promise<boolean> {
  if (!(await verifyUserTotp(userId, token))) return false;
  await pool.query(`DELETE FROM user_mfa WHERE user_id = :userId`, { userId });
  return true;
}

export async function verifyUserTotp(userId: number, token: string): Promise<boolean> {
  await ensureMfaSchema();
  const [rows] = await pool.query(
    `SELECT secret_enc, enabled FROM user_mfa WHERE user_id = :userId LIMIT 1`,
    { userId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as { secret_enc: string; enabled: number } | undefined)
    : undefined;
  if (!row || !row.enabled) return false;
  return verifyTotp(decryptSecret(row.secret_enc), token);
}
