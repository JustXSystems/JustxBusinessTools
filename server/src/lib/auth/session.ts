import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Response } from "express";
import { pool } from "../../db.js";
import type { OrgRole, RequestContext } from "../request-context.js";
import { PROFILE_ID } from "../constants.js";
import { userIsPlatformAdmin } from "../platform-admin.js";
import { getJwtSecret } from "../env.js";

const JWT_SECRET = getJwtSecret();
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);
const COOKIE_NAME = "jbt_session";

export type SessionUser = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  role: OrgRole;
  organizationId: number;
  organizationName: string;
  businessProfileId: number;
  isPlatformAdmin: boolean;
  branches: Array<{
    id: number;
    businessName: string;
    gstin: string | null;
    isDefault: boolean;
  }>;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(
  userId: number,
  organizationId: number,
  businessProfileId: number,
): Promise<string> {
  const token = signSessionToken();
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, organization_id, business_profile_id, expires_at)
     VALUES (:userId, :tokenHash, :orgId, :profileId, :expiresAt)`,
    {
      userId,
      tokenHash,
      orgId: organizationId,
      profileId: businessProfileId,
      expiresAt: expires,
    },
  );

  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE token_hash = :hash`, {
    hash: hashToken(token),
  });
}

export async function resolveSession(token: string): Promise<RequestContext | null> {
  const [rows] = await pool.query(
    `SELECT s.id AS session_id, s.user_id, s.organization_id, s.business_profile_id, s.expires_at,
            m.role, u.email, COALESCE(u.is_platform_admin, 0) AS is_platform_admin
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN org_members m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
     WHERE s.token_hash = :hash`,
    { hash: hashToken(token) },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  const r = row as {
    session_id: number;
    user_id: number;
    organization_id: number;
    business_profile_id: number;
    expires_at: Date;
    role: string | null;
    email: string;
    is_platform_admin: number;
  };

  if (new Date(r.expires_at) < new Date()) {
    await pool.query(`DELETE FROM sessions WHERE id = :id`, { id: r.session_id });
    return null;
  }

  const platform = userIsPlatformAdmin(r.email, r.is_platform_admin);
  if (!platform && !r.role) return null;

  return {
    userId: r.user_id,
    organizationId: r.organization_id,
    businessProfileId: r.business_profile_id,
    role: (r.role as OrgRole) ?? "owner",
    sessionId: r.session_id,
    isPlatformAdmin: platform,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400000,
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(`${COOKIE_NAME}=`)) {
      return decodeURIComponent(part.slice(COOKIE_NAME.length + 1));
    }
  }
  return null;
}

export const SESSION_COOKIE = COOKIE_NAME;

export async function loadSessionUser(userId: number, orgId: number, profileId: number): Promise<SessionUser | null> {
  const [userRows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.phone, m.role, o.name AS org_name,
            COALESCE(u.is_platform_admin, 0) AS is_platform_admin
     FROM users u
     LEFT JOIN org_members m ON m.user_id = u.id AND m.organization_id = :orgId
     LEFT JOIN organizations o ON o.id = COALESCE(m.organization_id, :orgId)
     WHERE u.id = :userId AND u.status = 'active'`,
    { userId, orgId },
  );
  const user = Array.isArray(userRows) ? userRows[0] : null;
  if (!user) return null;

  const u = user as {
    id: number;
    email: string;
    name: string | null;
    phone: string | null;
    role: string | null;
    org_name: string | null;
    is_platform_admin: number;
  };
  const platform = userIsPlatformAdmin(u.email, u.is_platform_admin);
  if (!platform && !u.role) return null;

  const [branchRows] = await pool.query(
    platform
      ? `SELECT id, business_name, gstin, is_default FROM business_profiles ORDER BY is_default DESC, id`
      : `SELECT id, business_name, gstin, is_default
         FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id`,
    { orgId },
  );
  const branches = (Array.isArray(branchRows) ? branchRows : []).map((b) => {
    const row = b as { id: number; business_name: string; gstin: string | null; is_default: number };
    return {
      id: row.id,
      businessName: row.business_name,
      gstin: row.gstin,
      isDefault: Boolean(row.is_default),
    };
  });

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: (u.role as OrgRole) ?? "owner",
    organizationId: orgId,
    organizationName: u.org_name ?? (platform ? "JustXSystems Platform" : "Organization"),
    businessProfileId: profileId,
    isPlatformAdmin: platform,
    branches,
  };
}

export function legacyContext(): RequestContext {
  return {
    userId: null,
    organizationId: 1,
    businessProfileId: PROFILE_ID,
    role: "legacy",
    sessionId: null,
    isPlatformAdmin: false,
  };
}

export { JWT_SECRET };
