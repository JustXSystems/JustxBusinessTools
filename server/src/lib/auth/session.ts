import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Response } from "express";
import { BRAND_DEFAULTS } from "@jbt/shared";
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
  /** Platform super only — operator act-as role for troubleshooting. */
  actAsRole?: OrgRole | null;
  branches: Array<{
    id: number;
    businessName: string;
    gstin: string | null;
    isDefault: boolean;
    organizationId?: number;
    organizationName?: string | null;
    approvalStatus?: string;
    archivedAt?: string | null;
  }>;
};

const ACT_AS_ROLES = new Set<OrgRole>(["owner", "admin", "staff", "viewer"]);

export function parseActAsRole(raw: unknown): OrgRole | null {
  if (raw == null || raw === "" || raw === "platform" || raw === "none") return null;
  const role = String(raw).trim().toLowerCase() as OrgRole;
  return ACT_AS_ROLES.has(role) ? role : null;
}

/**
 * Production safety: never ALTER or SELECT act_as_role on the auth hot path until
 * startup (or an explicit ensure) has confirmed the column exists. Live clients must
 * keep switching branches / resolving sessions even if the optional column is delayed.
 */
let actAsColumnAvailable = false;
let actAsColumnReady: Promise<void> | null = null;

export function isActAsRoleColumnAvailable(): boolean {
  return actAsColumnAvailable;
}

export async function ensureActAsRoleSchema(): Promise<void> {
  if (actAsColumnAvailable) return;
  if (!actAsColumnReady) {
    actAsColumnReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE sessions ADD COLUMN act_as_role VARCHAR(16) NULL`,
        );
        actAsColumnAvailable = true;
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code === "ER_DUP_FIELDNAME" || e.errno === 1060) {
          actAsColumnAvailable = true;
          return;
        }
        // Allow a later retry; do not permanently poison auth.
        actAsColumnReady = null;
        console.warn("[jbt] sessions.act_as_role ensure failed — platform act-as disabled until retry", err);
        throw err;
      }
    })();
  }
  await actAsColumnReady;
}

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
  // Hot path: never ALTER here. Prefer the act_as column only after ensure succeeded.
  const includeActAs = actAsColumnAvailable;
  const [rows] = await pool.query(
    includeActAs
      ? `SELECT s.id AS session_id, s.user_id, s.organization_id, s.business_profile_id, s.expires_at,
              s.act_as_role, m.role, u.email, u.status, COALESCE(u.is_platform_admin, 0) AS is_platform_admin
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       LEFT JOIN org_members m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
       WHERE s.token_hash = :hash`
      : `SELECT s.id AS session_id, s.user_id, s.organization_id, s.business_profile_id, s.expires_at,
              m.role, u.email, u.status, COALESCE(u.is_platform_admin, 0) AS is_platform_admin
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
    act_as_role?: string | null;
    role: string | null;
    email: string;
    status: string;
    is_platform_admin: number;
  };

  if (r.status !== "active") {
    await pool.query(`DELETE FROM sessions WHERE user_id = :userId`, { userId: r.user_id });
    return null;
  }

  if (new Date(r.expires_at) < new Date()) {
    await pool.query(`DELETE FROM sessions WHERE id = :id`, { id: r.session_id });
    return null;
  }

  const platform = userIsPlatformAdmin(r.email, r.is_platform_admin);
  if (!platform && !r.role) return null;

  const membershipRole = (r.role as OrgRole) ?? "owner";
  // Never apply act-as to live org members — platform supers only.
  const actAsRole =
    platform && includeActAs ? parseActAsRole(r.act_as_role ?? null) : null;

  return {
    userId: r.user_id,
    organizationId: r.organization_id,
    businessProfileId: r.business_profile_id,
    role: actAsRole ?? membershipRole,
    sessionId: r.session_id,
    isPlatformAdmin: platform,
    actAsRole,
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

export async function loadSessionUser(
  userId: number,
  orgId: number,
  profileId: number,
  actAsRole: OrgRole | null = null,
): Promise<SessionUser | null> {
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
      ? `SELECT p.id, p.business_name, p.gstin, p.is_default, p.organization_id, o.name AS organization_name,
                COALESCE(m.approval_status, 'approved') AS approval_status, m.archived_at
         FROM business_profiles p
         LEFT JOIN organizations o ON o.id = p.organization_id
         LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
         ORDER BY o.name ASC, p.is_default DESC, p.id`
      : `SELECT p.id, p.business_name, p.gstin, p.is_default, p.organization_id,
                COALESCE(m.approval_status, 'approved') AS approval_status, m.archived_at
         FROM business_profiles p
         LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
         WHERE p.organization_id = :orgId
         ORDER BY p.is_default DESC, p.id`,
    { orgId },
  );
  const branches = (Array.isArray(branchRows) ? branchRows : []).map((b) => {
    const row = b as {
      id: number;
      business_name: string;
      gstin: string | null;
      is_default: number;
      organization_id?: number;
      organization_name?: string | null;
      approval_status?: string | null;
      archived_at?: string | Date | null;
    };
    return {
      id: row.id,
      businessName: row.business_name,
      gstin: row.gstin,
      isDefault: Boolean(row.is_default),
      organizationId: row.organization_id == null ? undefined : Number(row.organization_id),
      organizationName: row.organization_name == null ? null : String(row.organization_name),
      approvalStatus: String(row.approval_status ?? "approved"),
      archivedAt: row.archived_at ? String(row.archived_at) : null,
    };
  });

  const membershipRole = (u.role as OrgRole) ?? "owner";
  const effectiveActAs = platform ? parseActAsRole(actAsRole) : null;

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: effectiveActAs ?? membershipRole,
    organizationId: orgId,
    organizationName: u.org_name ?? (platform ? `${BRAND_DEFAULTS.appName} Platform` : "Organization"),
    businessProfileId: profileId,
    isPlatformAdmin: platform,
    actAsRole: effectiveActAs,
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
    actAsRole: null,
  };
}

export { JWT_SECRET };
