import { Router } from "express";
import { pool } from "../../db.js";
import {
  grantBranchAccess,
  listBranchAccessForUser,
  revokeBranchAccess,
} from "../../lib/auth/branch-access.js";
import { hashPassword } from "../../lib/auth/session.js";
import { logAudit } from "../../lib/audit.js";
import { getActiveOrgId, getActiveSessionId, getActiveUserId } from "../../lib/request-context.js";
import { isPlatformAdmin, orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import { publishNotification } from "../../lib/notification-publish.js";
import { assertOrgMember, resolveAdminOrgId } from "../../lib/admin/tenant-guard.js";

const router = Router();
const ROLES = new Set(["owner", "admin", "staff", "viewer"]);

function mapMember(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    email: String(r.email),
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    status: String(r.status),
    role: String(r.role),
    joinedAt: String(r.created_at),
    kycStatus: String(r.kyc_status ?? "unverified"),
    emailVerified: Boolean(r.email_verified),
    phoneVerified: Boolean(r.phone_verified),
    organizationId: r.organization_id == null ? null : Number(r.organization_id),
    organizationName: (r.organization_name as string | null) ?? null,
    gstin: (r.gstin as string | null) ?? null,
  };
}

const MEMBER_SQL = `SELECT u.id, u.email, u.name, u.phone, u.status, m.role, m.created_at,
            m.organization_id,
            o.name AS organization_name,
            (SELECT bp.gstin FROM business_profiles bp
              WHERE bp.organization_id = m.organization_id
              ORDER BY bp.is_default DESC, bp.id LIMIT 1) AS gstin,
            COALESCE(v.kyc_status, 'unverified') AS kyc_status,
            COALESCE(v.email_verified, 0) AS email_verified,
            COALESCE(v.phone_verified, 0) AS phone_verified
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     INNER JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN user_verifications v ON v.user_id = u.id`;

async function orgForMember(userId: number): Promise<number> {
  if (!isPlatformAdmin()) return getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT organization_id FROM org_members WHERE user_id = :userId LIMIT 1`,
    { userId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { organization_id: number } | undefined) : undefined;
  return row ? Number(row.organization_id) : getActiveOrgId();
}

async function countOwners(orgId: number): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM org_members WHERE organization_id = :orgId AND role = 'owner'`,
    { orgId },
  );
  const first = Array.isArray(rows) ? (rows[0] as { cnt: number }) : { cnt: 0 };
  return Number(first.cnt);
}

async function memberRole(orgId: number, userId: number): Promise<string | null> {
  const [rows] = await pool.query(
    `SELECT role FROM org_members WHERE organization_id = :orgId AND user_id = :userId`,
    { orgId, userId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? String((row as { role: string }).role) : null;
}

router.get("/", async (_req, res) => {
  const [rows] = await pool.query(
    `${MEMBER_SQL} WHERE ${orgEqualsSql("m.organization_id")} ORDER BY m.created_at`,
    orgScopeParams(),
  );
  const members = (Array.isArray(rows) ? rows : []).map((row) => mapMember(row as Record<string, unknown>));
  res.json({
    members,
    summary: {
      total: members.length,
      pending: members.filter((m) => m.status === "pending").length,
      active: members.filter((m) => m.status === "active").length,
      suspended: members.filter((m) => m.status === "suspended").length,
      unverified: members.filter((m) => m.kycStatus === "unverified" || !m.emailVerified).length,
    },
  });
});

router.get("/roles/matrix", async (_req, res) => {
  const { getRoleMatrix, ROLE_CAPABILITY_LABELS, DEFAULT_ROLE_MATRIX } = await import(
    "../../lib/roles/matrix.js"
  );
  res.json({
    matrix: await getRoleMatrix(),
    defaults: DEFAULT_ROLE_MATRIX,
    labels: ROLE_CAPABILITY_LABELS,
  });
});

router.put("/roles/matrix", async (req, res) => {
  const { saveRoleMatrix, ROLE_CAPABILITY_LABELS } = await import("../../lib/roles/matrix.js");
  const matrix = await saveRoleMatrix(req.body?.matrix ?? req.body);
  await logAudit("team.role_matrix", "platform_config", "role_permissions", {}, req.ip);
  res.json({ matrix, labels: ROLE_CAPABILITY_LABELS });
});

function parseUserId(param: string | undefined): number | null {
  const id = Number(param);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post("/invite", async (req, res) => {
  const orgResolved = resolveAdminOrgId(req.body?.organizationId);
  if (typeof orgResolved === "object") {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  const orgId = orgResolved;
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const role = String(req.body?.role ?? "staff");
  const password = String(req.body?.password ?? "");
  const name = String(req.body?.name ?? "").trim() || null;
  const phone = String(req.body?.phone ?? "").trim() || null;

  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  if (!ROLES.has(role) || role === "owner") {
    res.status(400).json({ error: "Invite as admin, staff, or viewer" });
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
       VALUES (:email, :hash, :name, :phone, 'pending')`,
      { email, hash, name, phone },
    );
    userId = Number((result as { insertId: number }).insertId);
    created = true;
  } else {
    res.status(400).json({ error: "New users need password (min 8 chars)" });
    return;
  }

  await pool.query(
    `INSERT INTO org_members (organization_id, user_id, role)
     VALUES (:orgId, :userId, :role)
     ON DUPLICATE KEY UPDATE role = :role`,
    { orgId, userId, role },
  );

  const branchIds = Array.isArray(req.body?.branchIds)
    ? (req.body.branchIds as number[]).map(Number).filter(Boolean)
    : [];
  if (branchIds.length && (role === "staff" || role === "viewer")) {
    for (const profileId of branchIds) {
      await grantBranchAccess(userId, profileId);
    }
  }

  if (created) {
    await pool.query(
      `INSERT IGNORE INTO user_verifications (user_id, kyc_status) VALUES (:userId, 'unverified')`,
      { userId },
    );
  }

  await logAudit("team.invite", "user", String(userId), { email, role, created }, req.ip);
  await publishNotification({
    eventType: created ? "team.member_pending" : "team.member_invited",
    title: created ? "New team member pending approval" : "Team member invited",
    body: `${email} invited as ${role}.`,
    href: created ? `/admin/team?filter=pending&user=${userId}` : `/admin/team?user=${userId}`,
    entityType: "user",
    entityId: String(userId),
    organizationId: orgId,
    businessProfileId: null,
    targetUserId: userId,
    dedupeKey: `team-invite:${orgId}:${userId}:${Date.now()}`,
    meta: { email, role, created },
    expiresInHours: 336,
  });
  res.status(201).json({ userId, email, role, status: created ? "pending" : "existing" });
});

router.get("/:userId", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const [rows] = await pool.query(
    `${MEMBER_SQL} WHERE u.id = :userId AND ${orgEqualsSql("m.organization_id")}`,
    { userId, ...orgScopeParams() },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const branchIds = await listBranchAccessForUser(userId);
  const [toolRows] = await pool.query(
    `SELECT tool_id, granted FROM user_tool_access WHERE user_id = :userId`,
    { userId },
  );
  const tools = (Array.isArray(toolRows) ? toolRows : []).map((t) => {
    const r = t as { tool_id: string; granted: number };
    return { toolId: r.tool_id, granted: Boolean(r.granted) };
  });
  const [sessionRows] = await pool.query(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_seen
     FROM sessions WHERE user_id = :userId AND expires_at > CURRENT_TIMESTAMP`,
    { userId },
  );
  const session = Array.isArray(sessionRows) ? (sessionRows[0] as { cnt: number; last_seen: Date | null }) : null;
  res.json({
    member: mapMember(row as Record<string, unknown>),
    branchIds,
    branchMode: branchIds.length ? "selected" : "all",
    tools,
    toolMode: tools.length ? "selected" : "all",
    sessions: {
      active: Number(session?.cnt ?? 0),
      lastSeenAt: session?.last_seen ? String(session.last_seen) : null,
    },
  });
});

router.patch("/:userId", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const orgId = member.orgId;
  const currentRole = await memberRole(orgId, userId);
  if (!currentRole) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  if (req.body?.role) {
    const nextRole = String(req.body.role);
    if (!ROLES.has(nextRole)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    if (currentRole === "owner" && nextRole !== "owner") {
      const owners = await countOwners(orgId);
      if (owners <= 1) {
        res.status(400).json({ error: "Cannot demote the last owner" });
        return;
      }
    }
    await pool.query(
      `UPDATE org_members SET role = :role WHERE organization_id = :orgId AND user_id = :userId`,
      { role: nextRole, orgId, userId },
    );
    await publishNotification({
      eventType: "team.role_changed",
      title: "Team role updated",
      body: `User #${userId} role changed from ${currentRole} to ${nextRole}.`,
      organizationId: orgId,
      businessProfileId: null,
      href: `/admin/team?user=${userId}`,
      expiresInHours: 168,
    });
  }

  if (req.body?.name !== undefined || req.body?.phone !== undefined) {
    await pool.query(
      `UPDATE users SET name = COALESCE(:name, name), phone = COALESCE(:phone, phone) WHERE id = :userId`,
      {
        userId,
        name: req.body?.name === undefined ? null : String(req.body.name).trim() || null,
        phone: req.body?.phone === undefined ? null : String(req.body.phone).trim() || null,
      },
    );
  }

  if (req.body?.status) {
    const status = String(req.body.status);
    if (userId === getActiveUserId() && status !== "active") {
      res.status(400).json({ error: "You cannot change your own account status" });
      return;
    }
    await pool.query(`UPDATE users SET status = :status WHERE id = :userId`, { status, userId });
  }

  await logAudit("team.update", "user", String(userId), req.body, req.ip);
  res.json({ ok: true });
});

router.post("/:userId/approve", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const orgId = member.orgId;
  const currentRole = await memberRole(orgId, userId);
  const requested = String(req.body?.role ?? "").trim().toLowerCase();

  let nextRole = currentRole;
  if (currentRole === "owner") {
    // New-GSTIN Owner accounts: activate only; role stays owner.
    nextRole = "owner";
  } else if (requested === "staff" || requested === "viewer") {
    nextRole = requested;
  } else if (currentRole === "staff" || currentRole === "viewer") {
    nextRole = currentRole || "staff";
  }

  if (nextRole && nextRole !== currentRole) {
    await pool.query(
      `UPDATE org_members SET role = :role WHERE organization_id = :orgId AND user_id = :userId`,
      { role: nextRole, orgId, userId },
    );
  }

  await pool.query(`UPDATE users SET status = 'active' WHERE id = :userId`, { userId });
  await logAudit("team.approve", "user", String(userId), { role: nextRole }, req.ip);
  await publishNotification({
    eventType: "team.member_approved",
    title: "Team member approved",
    body:
      currentRole === "owner"
        ? `Owner account #${userId} is now active.`
        : `User #${userId} is now active as ${nextRole}.`,
    href: `/admin/team?user=${userId}`,
    organizationId: orgId,
    entityType: "user",
    entityId: String(userId),
    businessProfileId: null,
    targetUserId: userId,
    actorRole: "admin",
    dedupeKey: `team-approved:${userId}`,
    expiresInHours: 168,
  });
  res.json({ ok: true, role: nextRole });
});

router.post("/:userId/reject", async (req, res) => {
  const userId = Number(req.params.userId);
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot reject your own account" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  await pool.query(`UPDATE users SET status = 'rejected' WHERE id = :userId`, { userId });
  await logAudit("team.reject", "user", String(userId), { note: req.body?.note }, req.ip);
  const orgId = member.orgId;
  await publishNotification({
    eventType: "team.member_rejected",
    title: "Team member rejected",
    body: `User #${userId} was rejected${req.body?.note ? `: ${req.body.note}` : "."}`,
    href: `/admin/team?user=${userId}`,
    organizationId: orgId,
    entityType: "user",
    entityId: String(userId),
    businessProfileId: null,
    targetUserId: userId,
    actorRole: "admin",
    dedupeKey: `team-reject:${userId}`,
    severity: "attention",
    expiresInHours: 168,
  });
  res.json({ ok: true });
});

router.post("/:userId/suspend", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const orgId = member.orgId;
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot suspend yourself" });
    return;
  }
  if ((await memberRole(orgId, userId)) === "owner" && (await countOwners(orgId)) <= 1) {
    res.status(400).json({ error: "Cannot suspend the last owner" });
    return;
  }
  await pool.query(`UPDATE users SET status = 'suspended' WHERE id = :userId`, { userId });
  await logAudit("team.suspend", "user", String(userId), undefined, req.ip);
  await publishNotification({
    eventType: "team.member_suspended",
    title: "Team member suspended",
    body: `User #${userId} was suspended and can no longer sign in.`,
    organizationId: orgId,
    businessProfileId: null,
    href: `/admin/team?filter=suspended&user=${userId}`,
    entityType: "user",
    entityId: String(userId),
    targetUserId: userId,
    actorRole: "admin",
    dedupeKey: `team-suspend:${userId}:${Date.now()}`,
    severity: "urgent",
    expiresInHours: 336,
  });
  res.json({ ok: true });
});

router.post("/:userId/reset-password", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const password = String(req.body?.password ?? "");
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const hash = await hashPassword(password);
  await pool.query(`UPDATE users SET password_hash = :hash WHERE id = :userId`, {
    hash,
    userId,
  });
  await logAudit("team.reset_password", "user", String(userId), undefined, req.ip);
  res.json({ ok: true });
});

router.post("/:userId/verify", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const emailV = req.body?.emailVerified === undefined ? null : Number(Boolean(req.body.emailVerified));
  const phoneV = req.body?.phoneVerified === undefined ? null : Number(Boolean(req.body.phoneVerified));
  const kycRaw = req.body?.kycStatus === undefined ? null : String(req.body.kycStatus);
  const KYC = new Set(["unverified", "pending", "verified", "rejected"]);
  if (kycRaw && !KYC.has(kycRaw)) {
    res.status(400).json({ error: "Invalid KYC status" });
    return;
  }
  await pool.query(
    `INSERT INTO user_verifications (user_id, email_verified, phone_verified, kyc_status, verified_by, verified_at)
     VALUES (:userId, COALESCE(:emailV, 0), COALESCE(:phoneV, 0), COALESCE(:kyc, 'unverified'), :reviewer, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       email_verified = COALESCE(:emailV, email_verified),
       phone_verified = COALESCE(:phoneV, phone_verified),
       kyc_status = COALESCE(:kyc, kyc_status),
       verified_by = :reviewer,
       verified_at = CURRENT_TIMESTAMP`,
    { userId, emailV, phoneV, kyc: kycRaw, reviewer: getActiveUserId() },
  );
  await logAudit("team.verify", "user", String(userId), { emailV, phoneV, kyc: kycRaw }, req.ip);
  res.json({ ok: true });
});

router.post("/:userId/revoke-sessions", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const current = getActiveSessionId();
  if (userId === getActiveUserId() && current) {
    await pool.query(`DELETE FROM sessions WHERE user_id = :userId AND id <> :current`, {
      userId,
      current,
    });
  } else {
    await pool.query(`DELETE FROM sessions WHERE user_id = :userId`, { userId });
  }
  await logAudit("team.revoke_sessions", "user", String(userId), undefined, req.ip);
  res.json({ ok: true });
});

router.post("/:userId/copy-access", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  const fromId = Number(req.body?.fromUserId);
  if (!userId || !fromId || fromId === userId) {
    res.status(400).json({ error: "Choose another teammate to copy from" });
    return;
  }
  const orgId = await orgForMember(userId);
  if (!(await memberRole(orgId, userId)) || !(await memberRole(orgId, fromId))) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  await pool.query(`DELETE FROM user_tool_access WHERE user_id = :userId`, { userId });
  await pool.query(
    `INSERT INTO user_tool_access (user_id, tool_id, granted)
     SELECT :userId, tool_id, granted FROM user_tool_access WHERE user_id = :fromId`,
    { userId, fromId },
  );
  const current = await listBranchAccessForUser(userId);
  for (const id of current) await revokeBranchAccess(userId, id);
  const sourceBranches = await listBranchAccessForUser(fromId);
  for (const id of sourceBranches) await grantBranchAccess(userId, id);
  await logAudit("team.copy_access", "user", String(userId), { fromId }, req.ip);
  res.json({ ok: true });
});

router.delete("/:userId", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const orgId = await orgForMember(userId);
  if (userId === getActiveUserId()) {
    res.status(400).json({ error: "You cannot remove yourself" });
    return;
  }
  const role = await memberRole(orgId, userId);
  if (!role) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  if (role === "owner" && (await countOwners(orgId)) <= 1) {
    res.status(400).json({ error: "Cannot remove the last owner" });
    return;
  }
  await pool.query(`DELETE FROM sessions WHERE user_id = :userId`, { userId });
  await pool.query(`DELETE FROM org_members WHERE organization_id = :orgId AND user_id = :userId`, {
    orgId,
    userId,
  });
  await logAudit("team.remove", "user", String(userId), { role }, req.ip);
  res.status(204).send();
});

router.get("/:userId/tools", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const [rows] = await pool.query(
    `SELECT tool_id, granted FROM user_tool_access WHERE user_id = :userId`,
    { userId },
  );
  const tools = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as { tool_id: string; granted: number };
    return { toolId: r.tool_id, granted: Boolean(r.granted) };
  });
  res.json({ tools, toolMode: tools.length ? "selected" : "all" });
});

router.put("/:userId/tools", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const mode = String(req.body?.mode ?? "selected");
  await pool.query(`DELETE FROM user_tool_access WHERE user_id = :userId`, { userId });
  if (mode !== "all") {
    const toolIds = Array.isArray(req.body?.toolIds)
      ? (req.body.toolIds as unknown[]).map(String).filter(Boolean)
      : [];
    for (const toolId of toolIds) {
      await pool.query(
        `INSERT INTO user_tool_access (user_id, tool_id, granted) VALUES (:userId, :toolId, 1)`,
        { userId, toolId },
      );
    }
  }
  await logAudit("team.tools", "user", String(userId), { mode }, req.ip);
  res.json({ ok: true });
});

router.post("/:userId/tools", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const toolId = String(req.body?.toolId ?? "");
  if (!toolId) {
    res.status(400).json({ error: "toolId required" });
    return;
  }
  await pool.query(
    `INSERT INTO user_tool_access (user_id, tool_id, granted) VALUES (:userId, :toolId, :granted)
     ON DUPLICATE KEY UPDATE granted = :granted`,
    { userId, toolId, granted: Number(req.body?.granted !== false) },
  );
  res.json({ ok: true });
});

router.get("/:userId/branches", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const branches = await listBranchAccessForUser(userId);
  res.json({ userId, branchIds: branches });
});

router.post("/:userId/branches", async (req, res) => {
  const userId = Number(req.params.userId);
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const profileId = Number(req.body?.businessProfileId);
  if (!profileId) {
    res.status(400).json({ error: "businessProfileId required" });
    return;
  }
  await grantBranchAccess(userId, profileId);
  await logAudit("team.grant_branch", "user", String(userId), { profileId }, req.ip);
  res.json({ ok: true });
});

router.put("/:userId/branches", async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "Invalid member" });
    return;
  }
  const member = await assertOrgMember(userId);
  if (!member.ok) {
    res.status(member.status).json({ error: member.error });
    return;
  }
  const mode = String(req.body?.mode ?? "all");
  const current = await listBranchAccessForUser(userId);
  for (const id of current) await revokeBranchAccess(userId, id);
  if (mode !== "all") {
    const branchIds = Array.isArray(req.body?.branchIds)
      ? (req.body.branchIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (branchIds.length === 0) {
      res.status(400).json({ error: "Select at least one branch, or choose all branches" });
      return;
    }
    for (const profileId of branchIds) {
      await grantBranchAccess(userId, profileId);
    }
  }
  await logAudit("team.branches", "user", String(userId), { mode }, req.ip);
  res.json({ ok: true });
});

router.delete("/:userId/branches/:profileId", async (req, res) => {
  const userId = Number(req.params.userId);
  const profileId = Number(req.params.profileId);
  await revokeBranchAccess(userId, profileId);
  await logAudit("team.revoke_branch", "user", String(userId), { profileId }, req.ip);
  res.status(204).send();
});

export default router;
