import { Router } from "express";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { grantBranchAccess, revokeBranchAccess } from "../lib/auth/branch-access.js";
import { hashPassword } from "../lib/auth/session.js";
import { publishNotification } from "../lib/notification-publish.js";
import {
  getActiveOrgId,
  getActiveProfileId,
  getActiveUserId,
  getRequestContext,
} from "../lib/request-context.js";

const router = Router();

/** Owner or org Admin (or platform super user) may manage team on Business Profile. */
function requireTeamManager(res: import("express").Response): boolean {
  const ctx = getRequestContext();
  if (!ctx?.userId) {
    res.status(403).json({ error: "Authentication required" });
    return false;
  }
  if (ctx.isPlatformAdmin && !ctx.actAsRole) {
    res.status(403).json({
      error: "Enter Operator as a Business Profile role first (/enter)",
      code: "NEED_ACT_AS",
    });
    return false;
  }
  if (ctx.role === "owner" || ctx.role === "admin" || ctx.role === "legacy") {
    return true;
  }
  res.status(403).json({
    error: "Only the Business Owner or org Admin can manage team access here",
  });
  return false;
}

function parseUserId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function mapMember(row: Record<string, unknown>, profileId: number) {
  const role = String(row.role);
  const accessExplicit = row.access_granted != null;
  const implicit = role === "owner" || role === "admin";
  return {
    id: Number(row.id),
    email: String(row.email),
    name: (row.name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    status: String(row.status),
    role,
    joinedAt: String(row.created_at),
    access: implicit || accessExplicit,
    implicit,
    profileId,
  };
}

/** Pending Staff/Viewer join requests for the Owner's organization. */
router.get("/pending", async (_req, res) => {
  if (!requireTeamManager(res)) return;
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.phone, u.status, u.created_at, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId
       AND u.status = 'pending'
       AND m.role IN ('staff', 'viewer')
     ORDER BY u.created_at DESC`,
    { orgId },
  );
  const members = (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: Number(row.id),
      email: String(row.email),
      name: (row.name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      status: String(row.status),
      role: String(row.role),
      createdAt: String(row.created_at),
    };
  });
  res.json({ members });
});

/** Active / suspended staff for the current Business Profile. */
router.get("/members", async (_req, res) => {
  if (!requireTeamManager(res)) return;
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, u.phone, u.status, u.created_at, m.role,
            ba.user_id AS access_granted
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     LEFT JOIN branch_access ba
       ON ba.user_id = u.id AND ba.business_profile_id = :profileId
     WHERE m.organization_id = :orgId
       AND u.status IN ('active', 'suspended')
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
       u.name IS NULL, u.name, u.email`,
    { orgId, profileId },
  );
  const members = (Array.isArray(rows) ? rows : []).map((r) =>
    mapMember(r as Record<string, unknown>, profileId),
  );
  res.json({ members, businessProfileId: profileId });
});

router.post("/invite", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const role = String(req.body?.role ?? "staff").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const name = String(req.body?.name ?? "").trim() || null;
  const phone = String(req.body?.phone ?? "").trim() || null;

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  if (role !== "staff" && role !== "viewer") {
    res.status(400).json({ error: "Invite as Staff or Viewer only" });
    return;
  }

  const [existing] = await pool.query(`SELECT id, status FROM users WHERE email = :email`, { email });
  let userId: number;
  let created = false;

  if (Array.isArray(existing) && existing[0]) {
    userId = Number((existing[0] as { id: number }).id);
    if (name || phone) {
      await pool.query(
        `UPDATE users SET name = COALESCE(:name, name), phone = COALESCE(:phone, phone) WHERE id = :id`,
        { name, phone, id: userId },
      );
    }
  } else if (password.length >= 8) {
    const hash = await hashPassword(password);
    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone, status)
       VALUES (:email, :hash, :name, :phone, 'active')`,
      { email, hash, name, phone },
    );
    userId = Number((result as { insertId: number }).insertId);
    created = true;
    await pool.query(
      `INSERT IGNORE INTO user_verifications (user_id, kyc_status) VALUES (:userId, 'unverified')`,
      { userId },
    );
  } else {
    res.status(400).json({ error: "New users need a password (min 8 characters)" });
    return;
  }

  const [memberRows] = await pool.query(
    `SELECT role FROM org_members WHERE organization_id = :orgId AND user_id = :userId LIMIT 1`,
    { orgId, userId },
  );
  const existingRole = Array.isArray(memberRows)
    ? (memberRows[0] as { role: string } | undefined)?.role
    : undefined;
  if (existingRole === "owner" || existingRole === "admin") {
    res.status(403).json({
      error: "This person is already an Owner or Admin — Justxsystems admins manage those accounts",
    });
    return;
  }

  await pool.query(
    `INSERT INTO org_members (organization_id, user_id, role)
     VALUES (:orgId, :userId, :role)
     ON DUPLICATE KEY UPDATE role = :role`,
    { orgId, userId, role },
  );
  if (!created) {
    await pool.query(
      `UPDATE users SET status = 'active' WHERE id = :userId AND status IN ('pending', 'rejected')`,
      { userId },
    );
  }
  await grantBranchAccess(userId, profileId);

  await logAudit("profile.team.invite", "user", String(userId), { email, role, created, profileId }, req.ip);
  await publishNotification({
    eventType: "team.member_invited",
    title: "You were added to a business",
    body: `${email} invited as ${role}.`,
    href: "/login",
    entityType: "user",
    entityId: String(userId),
    organizationId: orgId,
    businessProfileId: profileId,
    targetUserId: userId,
    actorRole: "owner",
    dedupeKey: `profile-team-invite:${orgId}:${userId}:${Date.now()}`,
    meta: { email, role, created },
    expiresInHours: 336,
  });
  res.status(201).json({ userId, email, role, status: created ? "active" : "existing", businessProfileId: profileId });
});

router.post("/:userId/approve", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot approve your own account" });
    return;
  }

  const role = String(req.body?.role ?? "").trim().toLowerCase();
  if (role !== "staff" && role !== "viewer") {
    res.status(400).json({ error: "Choose role Staff or Viewer when approving" });
    return;
  }

  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const [rows] = await pool.query(
    `SELECT u.status, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { status: string; role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(403).json({
      error: "Owner and Admin accounts must be approved by a Justxsystems admin",
    });
    return;
  }
  if (row.status !== "pending") {
    res.status(400).json({ error: "This account is not awaiting approval" });
    return;
  }

  await pool.query(
    `UPDATE org_members SET role = :role WHERE organization_id = :orgId AND user_id = :userId`,
    { role, orgId, userId },
  );
  await pool.query(`UPDATE users SET status = 'active' WHERE id = :userId`, { userId });
  await grantBranchAccess(userId, profileId);
  await logAudit("profile.team.approve", "user", String(userId), { role, profileId }, req.ip);
  await publishNotification({
    eventType: "team.member_approved",
    title: "Join request approved",
    body: `You were approved as ${role} and can sign in now.`,
    href: "/login",
    organizationId: orgId,
    entityType: "user",
    entityId: String(userId),
    businessProfileId: profileId,
    targetUserId: userId,
    actorRole: "owner",
    dedupeKey: `profile-team-approved:${userId}`,
    expiresInHours: 168,
  });
  res.json({ ok: true, role });
});

router.post("/:userId/reject", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot reject your own account" });
    return;
  }

  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT u.status, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { status: string; role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(403).json({
      error: "Owner and Admin accounts must be handled by a Justxsystems admin",
    });
    return;
  }
  if (row.status !== "pending") {
    res.status(400).json({ error: "This account is not awaiting approval" });
    return;
  }

  const note = String(req.body?.note ?? "").trim();
  await pool.query(`UPDATE users SET status = 'rejected' WHERE id = :userId`, { userId });
  await logAudit("profile.team.reject", "user", String(userId), { note: note || undefined }, req.ip);
  await publishNotification({
    eventType: "team.member_rejected",
    title: "Join request declined",
    body: note
      ? `Your request to join was declined: ${note}`
      : "Your request to join was declined by the Business Profile Owner.",
    href: "/login",
    organizationId: orgId,
    entityType: "user",
    entityId: String(userId),
    businessProfileId: null,
    targetUserId: userId,
    actorRole: "owner",
    dedupeKey: `profile-team-reject:${userId}`,
    severity: "attention",
    expiresInHours: 168,
  });
  res.json({ ok: true });
});

router.patch("/:userId", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot change your own role here" });
    return;
  }

  const role = String(req.body?.role ?? "").trim().toLowerCase();
  if (role !== "staff" && role !== "viewer") {
    res.status(400).json({ error: "Role must be Staff or Viewer" });
    return;
  }

  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT m.role
     FROM org_members m
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(403).json({ error: "Owner and Admin roles are managed by Justxsystems admins" });
    return;
  }

  await pool.query(
    `UPDATE org_members SET role = :role WHERE organization_id = :orgId AND user_id = :userId`,
    { role, orgId, userId },
  );
  await logAudit("profile.team.role", "user", String(userId), { role }, req.ip);
  res.json({ ok: true, role });
});

router.post("/:userId/suspend", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot suspend your own account" });
    return;
  }

  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT u.status, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { status: string; role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(403).json({ error: "Owner and Admin accounts cannot be suspended here" });
    return;
  }

  await pool.query(`UPDATE users SET status = 'suspended' WHERE id = :userId`, { userId });
  await logAudit("profile.team.suspend", "user", String(userId), undefined, req.ip);
  res.json({ ok: true, status: "suspended" });
});

router.post("/:userId/reactivate", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }

  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT u.status, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { status: string; role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(403).json({ error: "Owner and Admin accounts cannot be changed here" });
    return;
  }
  if (row.status !== "suspended") {
    res.status(400).json({ error: "Only suspended accounts can be reactivated" });
    return;
  }

  await pool.query(`UPDATE users SET status = 'active' WHERE id = :userId`, { userId });
  await logAudit("profile.team.reactivate", "user", String(userId), undefined, req.ip);
  res.json({ ok: true, status: "active" });
});

router.post("/:userId/access", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const [rows] = await pool.query(
    `SELECT m.role
     FROM org_members m
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(400).json({ error: "Owners and Admins already have access to every profile" });
    return;
  }
  await grantBranchAccess(userId, profileId);
  await logAudit("profile.team.grant_access", "user", String(userId), { profileId }, req.ip);
  res.json({ ok: true, access: true, businessProfileId: profileId });
});

router.delete("/:userId/access", async (req, res) => {
  if (!requireTeamManager(res)) return;
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const [rows] = await pool.query(
    `SELECT m.role
     FROM org_members m
     WHERE m.organization_id = :orgId AND m.user_id = :userId
     LIMIT 1`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { role: string } | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Member not found in this business" });
    return;
  }
  if (row.role === "owner" || row.role === "admin") {
    res.status(400).json({ error: "Owners and Admins always keep access" });
    return;
  }
  await revokeBranchAccess(userId, profileId);
  await logAudit("profile.team.revoke_access", "user", String(userId), { profileId }, req.ip);
  res.json({ ok: true, access: false, businessProfileId: profileId });
});

export default router;
