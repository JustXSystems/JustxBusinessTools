import { Router } from "express";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { publishNotification } from "../lib/notification-publish.js";
import { getActiveOrgId, getActiveUserId, getRequestContext } from "../lib/request-context.js";

const router = Router();

function requireOwner(res: import("express").Response): boolean {
  const ctx = getRequestContext();
  if (!ctx?.userId || ctx.role !== "owner") {
    res.status(403).json({
      error: "Only the Business Profile Owner can manage join requests",
    });
    return false;
  }
  return true;
}

function parseUserId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Pending Staff/Viewer join requests for the Owner's organization. */
router.get("/pending", async (_req, res) => {
  if (!requireOwner(res)) return;
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

router.post("/:userId/approve", async (req, res) => {
  if (!requireOwner(res)) return;
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
      error: "Owner and Admin accounts must be approved by a JustX admin",
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
  await logAudit("profile.team.approve", "user", String(userId), { role }, req.ip);
  await publishNotification({
    eventType: "team.member_approved",
    title: "Join request approved",
    body: `You were approved as ${role} and can sign in now.`,
    href: "/login",
    organizationId: orgId,
    entityType: "user",
    entityId: String(userId),
    businessProfileId: null,
    targetUserId: userId,
    actorRole: "owner",
    dedupeKey: `profile-team-approved:${userId}`,
    expiresInHours: 168,
  });
  res.json({ ok: true, role });
});

router.post("/:userId/reject", async (req, res) => {
  if (!requireOwner(res)) return;
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
      error: "Owner and Admin accounts must be handled by a JustX admin",
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

export default router;
