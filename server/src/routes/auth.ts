import { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { userHasBranchAccess } from "../lib/auth/branch-access.js";
import {
  findProfileByGstin,
  isValidGstin,
  normalizeGstin,
  panFromGstin,
  publicGstinProfile,
  type GstinProfileRow,
} from "../lib/gstin.js";
import {
  buildGoogleAuthUrl,
  getGoogleOAuthConfig,
  loginOrRegisterWithGoogle,
} from "../lib/auth/google-oauth.js";
import { requestPhoneOtp, verifyPhoneOtp } from "../lib/auth/phone-otp.js";
import {
  createSession,
  destroySession,
  hashPassword,
  loadSessionUser,
  setSessionCookie,
  clearSessionCookie,
  getTokenFromCookie,
  verifyPassword,
} from "../lib/auth/session.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  applyRegistrationPlaceholders,
  getRegistrationCopy,
} from "../lib/config/registration-copy.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";
import { getRequestContext } from "../lib/request-context.js";
import { ensureHomeToolIdsColumn, normalizeHomeToolIdsInput } from "../lib/home-tools.js";
import { saveImageUpload } from "../lib/storage.js";
import { webAppUrl } from "../lib/web-public-url.js";
import crypto from "node:crypto";

const router = Router();

function blank(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function isDupEntry(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e.code === "ER_DUP_ENTRY" || e.errno === 1062;
}

async function attachUserToGstinProfile(
  conn: PoolConnection,
  userId: number,
  profile: GstinProfileRow,
): Promise<void> {
  await conn.query(
    `INSERT INTO org_members (organization_id, user_id, role)
     VALUES (:orgId, :userId, 'staff')`,
    { orgId: profile.organizationId, userId },
  );
  await conn.query(
    `INSERT IGNORE INTO branch_access (user_id, business_profile_id) VALUES (:userId, :profileId)`,
    { userId, profileId: profile.id },
  );
}

router.get("/gstin", async (req, res) => {
  const gstin = normalizeGstin(req.query.gstin);
  if (!isValidGstin(gstin)) {
    res.status(400).json({ error: "Enter a valid 15-character GSTIN" });
    return;
  }
  const profile = await findProfileByGstin(gstin);
  if (!profile) {
    res.json({ exists: false, gstin });
    return;
  }
  res.json({ exists: true, gstin, profile: publicGstinProfile(profile) });
});

router.post("/register", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const name = String(req.body?.name ?? "").trim();
  const phone = blank(req.body?.phone);
  const gstin = normalizeGstin(req.body?.gstin);

  if (!email || password.length < 8) {
    res.status(400).json({ error: "Email and password (min 8 chars) required" });
    return;
  }
  if (!isValidGstin(gstin)) {
    res.status(400).json({ error: "A valid 15-character GSTIN is required" });
    return;
  }

  const [existingUsers] = await pool.query(`SELECT id FROM users WHERE email = :email`, { email });
  if (Array.isArray(existingUsers) && existingUsers[0]) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let joinedExisting = false;
    let orgId: number;
    let profileId: number;
    let userId = 0;
    let existing = await findProfileByGstin(gstin, conn);

    if (existing) {
      const [userResult] = await conn.query(
        `INSERT INTO users (email, password_hash, name, phone, status)
         VALUES (:email, :hash, :name, :phone, 'pending')`,
        { email, hash: passwordHash, name: name || null, phone },
      );
      userId = Number((userResult as { insertId: number }).insertId);
      await conn.query(
        `INSERT IGNORE INTO user_verifications (user_id, kyc_status) VALUES (:userId, 'unverified')`,
        { userId },
      );
      await attachUserToGstinProfile(conn, userId, existing);
      orgId = existing.organizationId;
      profileId = existing.id;
      joinedExisting = true;
    } else {
      await ensureHomeToolIdsColumn();
      const businessName =
        String(req.body?.businessName ?? req.body?.organizationName ?? "").trim() || name || "My Business";
      const pan = blank(req.body?.pan)?.toUpperCase() || panFromGstin(gstin);
      const logoUrl = await saveImageUpload(blank(req.body?.logo), "logos");
      const homeToolIds = normalizeHomeToolIdsInput(req.body?.homeToolIds) ?? [];

      const [orgResult] = await conn.query(
        `INSERT INTO organizations (name, owner_user_id) VALUES (:name, NULL)`,
        { name: businessName },
      );
      orgId = Number((orgResult as { insertId: number }).insertId);

      try {
        const [profileResult] = await conn.query(
          `INSERT INTO business_profiles
            (organization_id, business_name, gstin, pan, address_line1, address_line2,
             state, state_code, phone, email, logo_data_url, home_tool_ids, is_default)
           VALUES
            (:orgId, :name, :gstin, :pan, :a1, :a2, :state, :stateCode, :bizPhone, :bizEmail, :logo, :homeTools, 1)`,
          {
            orgId,
            name: businessName,
            gstin,
            pan,
            a1: blank(req.body?.addressLine1),
            a2: blank(req.body?.addressLine2),
            state: blank(req.body?.state),
            stateCode: blank(req.body?.stateCode),
            bizPhone: blank(req.body?.businessPhone) ?? phone,
            bizEmail: blank(req.body?.businessEmail) ?? email,
            logo: logoUrl,
            homeTools: JSON.stringify(homeToolIds),
          },
        );
        profileId = Number((profileResult as { insertId: number }).insertId);
      } catch (err) {
        if (!isDupEntry(err)) throw err;
        await conn.query(`DELETE FROM organizations WHERE id = :orgId`, { orgId });
        existing = await findProfileByGstin(gstin, conn);
        if (!existing) throw err;
        const [userResult] = await conn.query(
          `INSERT INTO users (email, password_hash, name, phone, status)
           VALUES (:email, :hash, :name, :phone, 'pending')`,
          { email, hash: passwordHash, name: name || null, phone },
        );
        userId = Number((userResult as { insertId: number }).insertId);
        await conn.query(
          `INSERT IGNORE INTO user_verifications (user_id, kyc_status) VALUES (:userId, 'unverified')`,
          { userId },
        );
        await attachUserToGstinProfile(conn, userId, existing);
        orgId = existing.organizationId;
        profileId = existing.id;
        joinedExisting = true;
      }

      if (!joinedExisting) {
        const [userResult] = await conn.query(
          `INSERT INTO users (email, password_hash, name, phone, status)
           VALUES (:email, :hash, :name, :phone, 'pending')`,
          { email, hash: passwordHash, name: name || null, phone },
        );
        userId = Number((userResult as { insertId: number }).insertId);
        await conn.query(
          `INSERT IGNORE INTO user_verifications (user_id, kyc_status) VALUES (:userId, 'unverified')`,
          { userId },
        );
        await conn.query(`UPDATE organizations SET owner_user_id = :userId WHERE id = :orgId`, {
          userId,
          orgId,
        });
        await conn.query(
          `INSERT INTO org_members (organization_id, user_id, role) VALUES (:orgId, :userId, 'owner')`,
          { orgId, userId },
        );
        await conn.query(
          `INSERT IGNORE INTO branch_access (user_id, business_profile_id) VALUES (:userId, :profileId)`,
          { userId, profileId },
        );
        await conn.query(
          `INSERT INTO org_subscriptions (organization_id, plan_id, status) VALUES (:orgId, 'free', 'active')`,
          { orgId },
        );
        await conn.query(
          `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:profileId, 'free', 'active')`,
          { profileId },
        );
        await conn.query(
          `INSERT IGNORE INTO business_profile_meta (business_profile_id, approval_status)
           VALUES (:profileId, 'approved')`,
          { profileId },
        );
      }
    }

    await conn.commit();

    // Self-registration always stays pending until Owner (join) or JBT admin (new Owner) approves.
    await logAudit(
      joinedExisting ? "auth.register.join" : "auth.register",
      "user",
      String(userId),
      { email, gstin, joinedExisting, status: "pending" },
      req.ip,
    );
    publishNotificationAsync({
      eventType: joinedExisting ? "auth.user_registered" : "admin.business_update",
      title: joinedExisting ? "New user awaiting approval" : "New business Owner awaiting approval",
      body: joinedExisting
        ? `${email} requested to join GSTIN ${gstin}. Approve as Staff or Viewer in Business Profile.`
        : `${email} registered a new business for GSTIN ${gstin} as Owner. JBT admin approval required.`,
      organizationId: orgId,
      businessProfileId: profileId,
      href: joinedExisting ? "/profile" : "/admin/approvals?kind=user",
      entityType: "user",
      entityId: String(userId),
      targetRoles: joinedExisting ? ["owner", "admin"] : ["admin"],
      dedupeKey: `auth-reg:${userId}`,
      severity: "attention",
      expiresInHours: 336,
    });
    const copy = await getRegistrationCopy();
    const title = joinedExisting ? copy.pendingJoinTitle : copy.pendingOwnerTitle;
    const message = joinedExisting ? copy.pendingJoinMessage : copy.pendingOwnerMessage;
    const detailTemplate = joinedExisting ? copy.pendingJoinDetail : copy.pendingOwnerDetail;
    res.status(201).json({
      pending: true,
      joinedExisting,
      email,
      title,
      message,
      detail: applyRegistrationPlaceholders(detailTemplate, email),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

router.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  const [rows] = await pool.query(
    `SELECT u.id, u.password_hash, u.status, m.organization_id, m.role
     FROM users u
     INNER JOIN org_members m ON m.user_id = u.id
     WHERE u.email = :email
     ORDER BY m.id LIMIT 1`,
    { email },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const r = row as {
    id: number;
    password_hash: string | null;
    status: string;
    organization_id: number;
    role: string;
  };

  if (r.status !== "active" || !r.password_hash) {
    const reason =
      r.status === "pending"
        ? "Your account is awaiting approval"
        : r.status === "suspended"
          ? "Your account is suspended"
          : r.status === "rejected"
            ? "Your account request was declined"
            : "Invalid email or password";
    res.status(401).json({ error: reason });
    return;
  }

  const ok = await verifyPassword(password, r.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const { isMfaEnabled } = await import("../lib/auth/mfa.js");
  const { signMfaChallenge } = await import("../lib/auth/totp.js");
  if (await isMfaEnabled(r.id)) {
    res.json({
      mfaRequired: true,
      mfaToken: signMfaChallenge(r.id),
    });
    return;
  }

  const [profileRows] = await pool.query(
    `SELECT id FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id LIMIT 1`,
    { orgId: r.organization_id },
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const profileId = profile ? Number((profile as { id: number }).id) : 1;

  const token = await createSession(r.id, r.organization_id, profileId);
  setSessionCookie(res, token);
  const user = await loadSessionUser(r.id, r.organization_id, profileId);
  if (!user) {
    res.status(500).json({ error: "Login succeeded but user profile could not be loaded" });
    return;
  }
  await logAudit("auth.login", "user", String(r.id), undefined, req.ip);
  res.json({ user });
});

router.post("/mfa/verify", async (req, res) => {
  const mfaToken = String(req.body?.mfaToken ?? "");
  const code = String(req.body?.code ?? "");
  const { verifyMfaChallenge } = await import("../lib/auth/totp.js");
  const { verifyUserTotp } = await import("../lib/auth/mfa.js");
  const userId = verifyMfaChallenge(mfaToken);
  if (!userId) {
    res.status(401).json({ error: "MFA challenge expired — sign in again" });
    return;
  }
  if (!(await verifyUserTotp(userId, code))) {
    res.status(401).json({ error: "Invalid authenticator code" });
    return;
  }
  const [rows] = await pool.query(
    `SELECT m.organization_id FROM org_members m WHERE m.user_id = :userId ORDER BY m.id LIMIT 1`,
    { userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { organization_id: number } | undefined) : undefined;
  if (!row) {
    res.status(401).json({ error: "No organization membership" });
    return;
  }
  const [profileRows] = await pool.query(
    `SELECT id FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id LIMIT 1`,
    { orgId: row.organization_id },
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const profileId = profile ? Number((profile as { id: number }).id) : 1;
  const token = await createSession(userId, row.organization_id, profileId);
  setSessionCookie(res, token);
  const user = await loadSessionUser(userId, row.organization_id, profileId);
  if (!user) {
    res.status(500).json({ error: "MFA ok but user profile could not be loaded" });
    return;
  }
  await logAudit("auth.mfa", "user", String(userId), undefined, req.ip);
  res.json({ user });
});

router.get("/methods", async (_req, res) => {
  const sms = (process.env.SMS_PROVIDER ?? "console").toLowerCase();
  const phoneOtp =
    process.env.ENABLE_PHONE_OTP === "true" || (sms !== "console" && process.env.ENABLE_PHONE_OTP !== "false");
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  res.json({
    password: true,
    phoneOtp,
    google,
    mfa: process.env.ENABLE_MFA !== "false",
  });
});

router.get("/mfa/status", requireAuth, async (_req, res) => {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { isMfaEnabled } = await import("../lib/auth/mfa.js");
  res.json({ enabled: await isMfaEnabled(ctx.userId) });
});

router.post("/mfa/setup", requireAuth, async (req, res) => {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = await loadSessionUser(ctx.userId, ctx.organizationId, ctx.businessProfileId);
  const { beginMfaSetup } = await import("../lib/auth/mfa.js");
  const setup = await beginMfaSetup(ctx.userId, user?.email ?? `user-${ctx.userId}`);
  res.json(setup);
});

router.post("/mfa/confirm", requireAuth, async (req, res) => {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const code = String(req.body?.code ?? "");
  const { confirmMfaSetup } = await import("../lib/auth/mfa.js");
  const ok = await confirmMfaSetup(ctx.userId, code);
  if (!ok) {
    res.status(400).json({ error: "Invalid authenticator code" });
    return;
  }
  await logAudit("auth.mfa_enable", "user", String(ctx.userId), undefined, req.ip);
  res.json({ enabled: true });
});

router.post("/mfa/disable", requireAuth, async (req, res) => {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const code = String(req.body?.code ?? "");
  const { disableMfa } = await import("../lib/auth/mfa.js");
  const ok = await disableMfa(ctx.userId, code);
  if (!ok) {
    res.status(400).json({ error: "Invalid authenticator code" });
    return;
  }
  await logAudit("auth.mfa_disable", "user", String(ctx.userId), undefined, req.ip);
  res.json({ enabled: false });
});

router.post("/logout", requireAuth, async (req, res) => {
  const token = getTokenFromCookie(req.headers.cookie);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await loadSessionUser(ctx.userId, ctx.organizationId, ctx.businessProfileId);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user });
});

router.post("/switch-branch", requireAuth, async (req, res) => {
  const ctx = getRequestContext()!;
  const profileId = Number(req.body?.businessProfileId);
  if (!profileId) {
    res.status(400).json({ error: "businessProfileId required" });
    return;
  }

  const [rows] = await pool.query(
    ctx.isPlatformAdmin
      ? `SELECT id, organization_id FROM business_profiles WHERE id = :id`
      : `SELECT id FROM business_profiles WHERE id = :id AND organization_id = :orgId`,
    { id: profileId, orgId: ctx.organizationId },
  );
  const profileRow = Array.isArray(rows) ? (rows[0] as { id: number; organization_id?: number }) : null;
  if (!profileRow) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  const allowed = await userHasBranchAccess(ctx.userId!, profileId, ctx.role);
  if (!allowed) {
    res.status(403).json({ error: "No access to this branch" });
    return;
  }

  const nextOrgId = ctx.isPlatformAdmin && profileRow.organization_id
    ? Number(profileRow.organization_id)
    : ctx.organizationId;

  if (ctx.sessionId) {
    await pool.query(
      `UPDATE sessions SET business_profile_id = :profileId, organization_id = :orgId WHERE id = :sessionId`,
      { profileId, orgId: nextOrgId, sessionId: ctx.sessionId },
    );
  }

  const token = getTokenFromCookie(req.headers.cookie);
  if (token) {
    const user = await loadSessionUser(ctx.userId!, nextOrgId, profileId);
    res.json({ user });
    return;
  }
  res.status(400).json({ error: "No active session" });
});

router.get("/google", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const url = buildGoogleAuthUrl(state);
  if (!url) {
    res.status(503).json({ error: "Google OAuth is not configured" });
    return;
  }
  res.cookie("jbt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600000,
    secure: process.env.NODE_ENV === "production",
  });
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) {
    res.redirect(`${webAppUrl("/login")}?error=oauth_not_configured`);
    return;
  }

  const stateCookie = req.cookies?.jbt_oauth_state;
  const state = String(req.query.state ?? "");
  if (!stateCookie || stateCookie !== state) {
    res.redirect(`${webAppUrl("/login")}?error=invalid_state`);
    return;
  }

  const code = String(req.query.code ?? "");
  if (!code) {
    res.redirect(`${webAppUrl("/login")}?error=missing_code`);
    return;
  }

  const result = await loginOrRegisterWithGoogle(code, res);
  if (!result.ok) {
    res.redirect(`${webAppUrl("/login")}?error=${encodeURIComponent(result.error)}`);
    return;
  }

  await logAudit("auth.google", "user", String(result.userId), undefined, req.ip);
  res.clearCookie("jbt_oauth_state");
  res.redirect(webAppUrl("/"));
});

router.post("/otp/request", async (req, res) => {
  const phone = String(req.body?.phone ?? "");
  const result = await requestPhoneOtp(phone);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, message: "OTP sent" });
});

router.post("/otp/verify", async (req, res) => {
  const phone = String(req.body?.phone ?? "");
  const code = String(req.body?.code ?? "");
  const result = await verifyPhoneOtp(phone, code, res);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  await logAudit("auth.otp", "user", String(result.userId), undefined, req.ip);
  const user = await loadSessionUser(
    result.userId,
    result.organizationId,
    result.businessProfileId,
  );
  res.json({ ok: true, user });
});

export default router;
