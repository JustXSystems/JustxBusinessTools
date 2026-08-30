import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../db.js";
import { createSession, setSessionCookie } from "./session.js";
import { ConsoleSmsProvider } from "./sms-providers.js";
import type { Response } from "express";

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS ?? 300000);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

let smsProvider: SmsProvider = new ConsoleSmsProvider();

export function setSmsProvider(provider: SmsProvider): void {
  smsProvider = provider;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return phone.trim();
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export async function requestPhoneOtp(phone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizePhone(phone);
  if (normalized.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Valid phone number required" };
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(`DELETE FROM otp_challenges WHERE phone = :phone AND consumed_at IS NULL`, {
    phone: normalized,
  });

  await pool.query(
    `INSERT INTO otp_challenges (phone, code_hash, expires_at) VALUES (:phone, :hash, :expiresAt)`,
    { phone: normalized, hash: codeHash, expiresAt },
  );

  await smsProvider.sendOtp(normalized, code);
  return { ok: true };
}

async function findOrCreateUserByPhone(phone: string): Promise<number> {
  const email = `phone_${phone.replace(/\D/g, "")}@otp.local`;

  const [rows] = await pool.query(`SELECT id FROM users WHERE phone = :phone OR email = :email`, {
    phone,
    email,
  });
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (existing) {
    const userId = Number((existing as { id: number }).id);
    await pool.query(`UPDATE users SET phone = :phone WHERE id = :id`, { phone, id: userId });
    return userId;
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const [userResult] = await pool.query(
    `INSERT INTO users (email, password_hash, phone, name) VALUES (:email, :hash, :phone, :name)`,
    { email, hash: passwordHash, phone, name: phone },
  );
  const userId = Number((userResult as { insertId: number }).insertId);

  const [orgResult] = await pool.query(
    `INSERT INTO organizations (name, owner_user_id) VALUES (:name, :ownerId)`,
    { name: "My Business", ownerId: userId },
  );
  const orgId = Number((orgResult as { insertId: number }).insertId);

  await pool.query(
    `INSERT INTO org_members (organization_id, user_id, role) VALUES (:orgId, :userId, 'owner')`,
    { orgId, userId },
  );

  const [profileResult] = await pool.query(
    `INSERT INTO business_profiles (organization_id, business_name, is_default) VALUES (:orgId, :name, 1)`,
    { orgId, name: "My Business" },
  );
  const profileId = Number((profileResult as { insertId: number }).insertId);

  await pool.query(
    `INSERT INTO org_subscriptions (organization_id, plan_id, status) VALUES (:orgId, 'free', 'active')`,
    { orgId },
  );
  await pool.query(
    `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:profileId, 'free', 'active')`,
    { profileId },
  );

  return userId;
}

export async function verifyPhoneOtp(
  phone: string,
  code: string,
  res: Response,
): Promise<
  | { ok: true; userId: number; organizationId: number; businessProfileId: number }
  | { ok: false; error: string }
> {
  const normalized = normalizePhone(phone);
  const codeHash = hashOtp(code.trim());

  const [rows] = await pool.query(
    `SELECT id, code_hash, expires_at, attempts FROM otp_challenges
     WHERE phone = :phone AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    { phone: normalized },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, error: "No active OTP — request a new code" };

  const challenge = row as {
    id: number;
    code_hash: string;
    expires_at: Date;
    attempts: number;
  };

  if (new Date(challenge.expires_at) < new Date()) {
    return { ok: false, error: "OTP expired — request a new code" };
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts — request a new code" };
  }

  if (challenge.code_hash !== codeHash) {
    await pool.query(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = :id`, {
      id: challenge.id,
    });
    return { ok: false, error: "Invalid OTP" };
  }

  await pool.query(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = :id`, {
    id: challenge.id,
  });

  const userId = await findOrCreateUserByPhone(normalized);

  const [memberRows] = await pool.query(
    `SELECT organization_id FROM org_members WHERE user_id = :userId ORDER BY id LIMIT 1`,
    { userId },
  );
  const member = Array.isArray(memberRows) ? memberRows[0] : null;
  if (!member) return { ok: false, error: "Organization not found" };

  const orgId = Number((member as { organization_id: number }).organization_id);
  const [profileRows] = await pool.query(
    `SELECT id FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id LIMIT 1`,
    { orgId },
  );
  const bp = Array.isArray(profileRows) ? profileRows[0] : null;
  const profileId = bp ? Number((bp as { id: number }).id) : 1;

  const token = await createSession(userId, orgId, profileId);
  setSessionCookie(res, token);
  return { ok: true, userId, organizationId: orgId, businessProfileId: profileId };
}
