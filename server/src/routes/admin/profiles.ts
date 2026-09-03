import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { createApproval, reviewApproval } from "../../lib/admin/approvals.js";
import { grantBranchAccess, revokeBranchAccess } from "../../lib/auth/branch-access.js";
import { gstinTakenByOther, normalizeGstin } from "../../lib/gstin.js";
import {
  ensureHomeToolIdsColumn,
  normalizeHomeToolIdsInput,
  parseHomeToolIds,
} from "../../lib/home-tools.js";
import { getActiveOrgId, getActiveUserId } from "../../lib/request-context.js";
import { orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import { publishNotification } from "../../lib/notification-publish.js";

const router = Router();

function mapProfile(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    businessName: String(r.business_name ?? ""),
    gstin: (r.gstin as string | null) ?? null,
    pan: (r.pan as string | null) ?? null,
    addressLine1: (r.address_line1 as string | null) ?? null,
    addressLine2: (r.address_line2 as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    stateCode: (r.state_code as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    bankName: (r.bank_name as string | null) ?? null,
    bankBranch: (r.bank_branch as string | null) ?? null,
    bankAccount: (r.bank_account as string | null) ?? null,
    bankIfsc: (r.bank_ifsc as string | null) ?? null,
    bankUpi: (r.bank_upi as string | null) ?? null,
    terms: (r.terms as string | null) ?? null,
    isDefault: Boolean(r.is_default),
    organizationId: r.organization_id == null ? null : Number(r.organization_id),
    organizationName: (r.organization_name as string | null) ?? null,
    approvalStatus: String(r.approval_status ?? "approved"),
    reviewNote: (r.review_note as string | null) ?? null,
    archivedAt: r.archived_at ? String(r.archived_at) : null,
    planId: (r.plan_id as string | null) ?? "free",
    subscriptionStatus: (r.sub_status as string | null) ?? "active",
    staffCount: Number(r.staff_count) || 0,
    recordCount: Number(r.record_count) || 0,
    documentCount: Number(r.document_count) || 0,
    homeToolIds: parseHomeToolIds(r.home_tool_ids),
  };
}

function completeness(p: ReturnType<typeof mapProfile>): number {
  const checks = [
    p.businessName,
    p.gstin,
    p.pan,
    p.addressLine1,
    p.state,
    p.phone,
    p.email,
    p.bankIfsc || p.bankUpi,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function blankToNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function validateTaxIds(body: Record<string, unknown>): string | null {
  const gstinRaw = blankToNull(body.gstin);
  const gstin = gstinRaw ? gstinRaw.replace(/\s+/g, "").toUpperCase() : null;
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(gstin)) {
    return "GSTIN must be 15 characters (e.g. 29ABCDE1234F1Z5)";
  }
  const panRaw = blankToNull(body.pan);
  const pan = panRaw ? panRaw.replace(/\s+/g, "").toUpperCase() : null;
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(pan)) {
    return "PAN must be 10 characters (e.g. ABCDE1234F)";
  }
  const ifscRaw = blankToNull(body.bankIfsc);
  const ifsc = ifscRaw ? ifscRaw.replace(/\s+/g, "").toUpperCase() : null;
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc)) {
    return "IFSC looks invalid";
  }
  return null;
}

/** True when the client is only updating the home-tool allowlist. */
function isHomeToolsOnlyUpdate(body: Record<string, unknown>): boolean {
  if (!("homeToolIds" in body)) return false;
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  return keys.length === 1 && keys[0] === "homeToolIds";
}

async function assertGstinAvailable(body: Record<string, unknown>, excludeProfileId: number | null) {
  const gstin = blankToNull(body.gstin);
  if (!gstin) return null;
  const taken = await gstinTakenByOther(normalizeGstin(gstin), excludeProfileId);
  return taken ? "This GSTIN is already registered to another business profile" : null;
}

router.get("/", async (_req, res) => {
  await ensureHomeToolIdsColumn();
  const [rows] = await pool.query(
    `SELECT p.id, p.organization_id, o.name AS organization_name, p.business_name, p.gstin, p.pan, p.address_line1, p.address_line2,
            p.state, p.state_code, p.phone, p.email, p.is_default, p.home_tool_ids,
            p.bank_name, p.bank_branch, p.bank_account, p.bank_ifsc, p.bank_upi, p.terms,
            COALESCE(m.approval_status, 'approved') AS approval_status,
            m.review_note, m.archived_at,
            COALESCE(s.plan_id, 'free') AS plan_id,
            COALESCE(s.status, 'active') AS sub_status,
            (SELECT COUNT(*) FROM branch_access ba WHERE ba.business_profile_id = p.id) AS staff_count,
            (SELECT COUNT(*) FROM tool_records tr WHERE tr.business_profile_id = p.id) AS record_count,
            (SELECT COUNT(*) FROM document_records dr WHERE dr.business_profile_id = p.id) AS document_count
     FROM business_profiles p
     LEFT JOIN organizations o ON o.id = p.organization_id
     LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
     LEFT JOIN subscriptions s ON s.business_profile_id = p.id
     WHERE ${orgEqualsSql("p.organization_id")}
     ORDER BY p.is_default DESC, p.id`,
    orgScopeParams(),
  );
  const profiles = (Array.isArray(rows) ? rows : []).map((row) => {
    const mapped = mapProfile(row as Record<string, unknown>);
    return { ...mapped, completeness: completeness(mapped) };
  });
  res.json({
    profiles,
    summary: {
      total: profiles.length,
      pending: profiles.filter((p) => p.approvalStatus === "pending").length,
      approved: profiles.filter((p) => p.approvalStatus === "approved").length,
      archived: profiles.filter((p) => p.approvalStatus === "archived").length,
      incomplete: profiles.filter((p) => p.completeness < 75 && p.approvalStatus !== "archived").length,
    },
  });
});

router.get("/:id", async (req, res) => {
  await ensureHomeToolIdsColumn();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid profile" });
    return;
  }
  const [rows] = await pool.query(
    `SELECT p.*, o.name AS organization_name, COALESCE(m.approval_status, 'approved') AS approval_status,
            m.review_note, m.archived_at,
            COALESCE(s.plan_id, 'free') AS plan_id,
            COALESCE(s.status, 'active') AS sub_status,
            (SELECT COUNT(*) FROM branch_access ba WHERE ba.business_profile_id = p.id) AS staff_count,
            (SELECT COUNT(*) FROM tool_records tr WHERE tr.business_profile_id = p.id) AS record_count,
            (SELECT COUNT(*) FROM document_records dr WHERE dr.business_profile_id = p.id) AS document_count
     FROM business_profiles p
     LEFT JOIN organizations o ON o.id = p.organization_id
     LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
     LEFT JOIN subscriptions s ON s.business_profile_id = p.id
     WHERE p.id = :id AND ${orgEqualsSql("p.organization_id")}`,
    { id, ...orgScopeParams() },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const mapped = mapProfile(row as Record<string, unknown>);
  const orgId = Number((row as { organization_id: number }).organization_id) || getActiveOrgId();
  const [peopleRows] = await pool.query(
    `SELECT u.id, u.email, u.name, om.role,
            CASE WHEN om.role IN ('owner', 'admin') THEN 1
                 WHEN ba.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_access
     FROM org_members om
     INNER JOIN users u ON u.id = om.user_id
     LEFT JOIN branch_access ba ON ba.user_id = u.id AND ba.business_profile_id = :id
     WHERE om.organization_id = :orgId
     ORDER BY om.role, u.email`,
    { id, orgId },
  );
  const people = (Array.isArray(peopleRows) ? peopleRows : []).map((p) => {
    const r = p as { id: number; email: string; name: string | null; role: string; has_access: number };
    return {
      userId: Number(r.id),
      email: String(r.email),
      name: r.name,
      role: String(r.role),
      access: Boolean(r.has_access) || r.role === "owner" || r.role === "admin",
      implicit: r.role === "owner" || r.role === "admin",
    };
  });
  res.json({ profile: { ...mapped, completeness: completeness(mapped) }, people });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
  const businessName = String(req.body?.businessName ?? "").trim();
  if (!businessName) {
    res.status(400).json({ error: "businessName required" });
    return;
  }
  const taxError = validateTaxIds(req.body ?? {});
  if (taxError) {
    res.status(400).json({ error: taxError });
    return;
  }
  const gstinError = await assertGstinAvailable(req.body ?? {}, null);
  if (gstinError) {
    res.status(409).json({ error: gstinError });
    return;
  }
  await ensureHomeToolIdsColumn();
  const homeToolIds = normalizeHomeToolIdsInput(req.body?.homeToolIds);
  const [result] = await pool.query(
    `INSERT INTO business_profiles
      (organization_id, business_name, gstin, pan, address_line1, address_line2, state, state_code, phone, email,
       bank_name, bank_branch, bank_account, bank_ifsc, bank_upi, terms, home_tool_ids, is_default)
     VALUES (:orgId, :name, :gstin, :pan, :a1, :a2, :state, :stateCode, :phone, :email,
             :bankName, :bankBranch, :bankAccount, :bankIfsc, :bankUpi, :terms, :homeToolIds, 0)`,
    {
      orgId,
      name: businessName,
      gstin: blankToNull(req.body?.gstin) ? normalizeGstin(req.body.gstin) : null,
      pan: blankToNull(req.body?.pan),
      a1: blankToNull(req.body?.addressLine1),
      a2: blankToNull(req.body?.addressLine2),
      state: blankToNull(req.body?.state),
      stateCode: blankToNull(req.body?.stateCode),
      phone: blankToNull(req.body?.phone),
      email: blankToNull(req.body?.email),
      bankName: blankToNull(req.body?.bankName),
      bankBranch: blankToNull(req.body?.bankBranch),
      bankAccount: blankToNull(req.body?.bankAccount),
      bankIfsc: blankToNull(req.body?.bankIfsc),
      bankUpi: blankToNull(req.body?.bankUpi),
      terms: blankToNull(req.body?.terms),
      homeToolIds: homeToolIds ? JSON.stringify(homeToolIds) : null,
    },
  );
  const id = Number((result as { insertId: number }).insertId);
  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, requested_by)
     VALUES (:id, 'pending', :userId)`,
    { id, userId: getActiveUserId() },
  );
  await pool.query(
    `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:id, 'free', 'active')`,
    { id },
  );
  await createApproval({ entityType: "business_profile", entityId: String(id), action: "create" });
  await logAudit("profile.create", "business_profile", String(id), { businessName }, req.ip);
  const requesterId = getActiveUserId();
  await publishNotification({
    eventType: "business.branch_submitted",
    title: "Business branch pending approval",
    body: `${businessName} was submitted for review.`,
    href: `/admin/profiles?filter=pending&id=${id}`,
    entityType: "business_profile",
    entityId: String(id),
    organizationId: getActiveOrgId(),
    businessProfileId: id,
    targetUserId: requesterId,
    dedupeKey: `branch-submit:${id}`,
    expiresInHours: 336,
  });
  await publishNotification({
    eventType: "admin.business_update",
    title: "New business profile created",
    body: `${businessName} awaits approval.`,
    href: `/admin/approvals?kind=profile`,
    entityType: "business_profile",
    entityId: String(id),
    organizationId: getActiveOrgId(),
    businessProfileId: id,
    targetRoles: ["admin", "owner"],
    targetUserId: requesterId,
    dedupeKey: `admin-branch-create:${id}`,
    expiresInHours: 336,
  });
  res.status(201).json({ id, businessName, approvalStatus: "pending" });
});

router.put("/:id", async (req, res) => {
  await ensureHomeToolIdsColumn();
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const homeOnly = isHomeToolsOnlyUpdate(body);

  if (!homeOnly) {
    const taxError = validateTaxIds(body);
    if (taxError) {
      res.status(400).json({ error: taxError });
      return;
    }
    const gstinError = await assertGstinAvailable(body, id);
    if (gstinError) {
      res.status(409).json({ error: gstinError });
      return;
    }
  }

  const homeToolIds =
    body.homeToolIds === undefined ? undefined : normalizeHomeToolIdsInput(body.homeToolIds);

  if (homeOnly) {
    if (homeToolIds === undefined) {
      res.status(400).json({ error: "homeToolIds required" });
      return;
    }
    await pool.query(
      `UPDATE business_profiles SET home_tool_ids = :homeToolIds
       WHERE id = :id AND ${orgEqualsSql("organization_id")}`,
      { id, orgId, homeToolIds: JSON.stringify(homeToolIds) },
    );
    await logAudit("profile.update.homeTools", "business_profile", String(id), undefined, req.ip);
    res.json({ ok: true });
    return;
  }

  await pool.query(
    `UPDATE business_profiles SET
       business_name = COALESCE(:name, business_name),
       gstin = :gstin,
       pan = :pan,
       address_line1 = :a1,
       address_line2 = :a2,
       state = :state,
       state_code = :stateCode,
       phone = :phone,
       email = :email,
       bank_name = :bankName,
       bank_branch = :bankBranch,
       bank_account = :bankAccount,
       bank_ifsc = :bankIfsc,
       bank_upi = :bankUpi,
       terms = :terms
       ${homeToolIds !== undefined ? ", home_tool_ids = :homeToolIds" : ""}
     WHERE id = :id AND ${orgEqualsSql("organization_id")}`,
    {
      id,
      orgId,
      name: blankToNull(body.businessName),
      gstin: blankToNull(body.gstin) ? normalizeGstin(String(body.gstin)) : null,
      pan: blankToNull(body.pan),
      a1: blankToNull(body.addressLine1),
      a2: blankToNull(body.addressLine2),
      state: blankToNull(body.state),
      stateCode: blankToNull(body.stateCode),
      phone: blankToNull(body.phone),
      email: blankToNull(body.email),
      bankName: blankToNull(body.bankName),
      bankBranch: blankToNull(body.bankBranch),
      bankAccount: blankToNull(body.bankAccount),
      bankIfsc: blankToNull(body.bankIfsc)
        ? String(body.bankIfsc).replace(/\s+/g, "").toUpperCase()
        : null,
      bankUpi: blankToNull(body.bankUpi),
      terms: blankToNull(body.terms),
      ...(homeToolIds !== undefined ? { homeToolIds: JSON.stringify(homeToolIds) } : {}),
    },
  );
  await logAudit("profile.update", "business_profile", String(id), undefined, req.ip);
  await publishNotification({
    eventType: "business.profile_updated",
    title: "Business profile updated",
    body: `Branch #${id} was updated by an administrator.`,
    organizationId: orgId,
    businessProfileId: id,
    href: "/admin/profiles",
    entityType: "business_profile",
    entityId: String(id),
    actorRole: "admin",
    dedupeKey: `admin-profile-upd:${id}:${Date.now()}`,
    expiresInHours: 72,
  });
  res.json({ ok: true });
});

router.post("/:id/default", async (req, res) => {
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  const [metaRows] = await pool.query(
    `SELECT COALESCE(m.approval_status, 'approved') AS approval_status
     FROM business_profiles p
     LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
     WHERE p.id = :id AND ${orgEqualsSql("p.organization_id")}`,
    { id, orgId },
  );
  const meta = Array.isArray(metaRows) ? (metaRows[0] as { approval_status: string } | undefined) : undefined;
  if (!meta) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (meta.approval_status !== "approved") {
    res.status(400).json({ error: "Only an approved branch can be the default" });
    return;
  }
  await pool.query(`UPDATE business_profiles SET is_default = 0 WHERE organization_id = :orgId`, { orgId });
  await pool.query(
    `UPDATE business_profiles SET is_default = 1 WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  await logAudit("profile.default", "business_profile", String(id), undefined, req.ip);
  res.json({ ok: true });
});

router.post("/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, reviewed_by, review_note)
     VALUES (:id, 'approved', :userId, :note)
     ON DUPLICATE KEY UPDATE approval_status = 'approved', reviewed_by = :userId, review_note = :note, archived_at = NULL`,
    { id, userId: getActiveUserId(), note: req.body?.note ?? null },
  );
  const [pending] = await pool.query(
    `SELECT id FROM approval_requests
     WHERE organization_id = :orgId AND entity_type = 'business_profile' AND entity_id = :eid AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    { orgId: getActiveOrgId(), eid: String(id) },
  );
  const row = Array.isArray(pending) ? pending[0] : null;
  if (row) await reviewApproval(Number((row as { id: number }).id), "approved", req.body?.note);
  await logAudit("profile.approve", "business_profile", String(id), undefined, req.ip);
  const [metaRows] = await pool.query(
    `SELECT requested_by FROM business_profile_meta WHERE business_profile_id = :id LIMIT 1`,
    { id },
  );
  const meta = Array.isArray(metaRows)
    ? (metaRows[0] as { requested_by: number | null } | undefined)
    : undefined;
  await publishNotification({
    eventType: "business.branch_approved",
    title: "Business branch approved",
    body: `Branch #${id} is now approved and active.`,
    href: "/admin/profiles",
    organizationId: getActiveOrgId(),
    entityType: "business_profile",
    entityId: String(id),
    businessProfileId: id,
    targetUserId: meta?.requested_by ?? null,
    actorRole: "admin",
    dedupeKey: `branch-approved:${id}`,
    expiresInHours: 168,
  });
  res.json({ ok: true });
});

router.post("/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const { isPlatformAdmin } = await import("../../lib/platform-admin.js");
  const [profileRows] = await pool.query(
    `SELECT organization_id AS orgId FROM business_profiles
     WHERE id = :id AND ${orgEqualsSql("organization_id")}
     LIMIT 1`,
    { id, ...orgScopeParams() },
  );
  const profile = Array.isArray(profileRows)
    ? (profileRows[0] as { orgId: number } | undefined)
    : undefined;
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const orgId = Number(profile.orgId);

  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, reviewed_by, review_note)
     VALUES (:id, 'rejected', :userId, :note)
     ON DUPLICATE KEY UPDATE approval_status = 'rejected', reviewed_by = :userId, review_note = :note`,
    { id, userId: getActiveUserId(), note: req.body?.note ?? "Rejected" },
  );

  let suspended: { userIds: number[]; sessionsRevoked: number } | null = null;
  // JustX admin reject of a business: lock out the whole org and end sessions immediately.
  if (isPlatformAdmin()) {
    const { suspendOrganizationAccess } = await import("../../lib/admin/org-suspend.js");
    suspended = await suspendOrganizationAccess(orgId, {
      note: req.body?.note ?? "Business profile rejected by JustX admin",
      actorIp: req.ip,
      profileId: id,
    });
  }

  const [metaRows] = await pool.query(
    `SELECT requested_by FROM business_profile_meta WHERE business_profile_id = :id LIMIT 1`,
    { id },
  );
  const meta = Array.isArray(metaRows)
    ? (metaRows[0] as { requested_by: number | null } | undefined)
    : undefined;
  await logAudit(
    "profile.reject",
    "business_profile",
    String(id),
    { note: req.body?.note, suspendedUsers: suspended?.userIds?.length ?? 0 },
    req.ip,
  );
  await publishNotification({
    eventType: "business.branch_rejected",
    title: suspended
      ? "Business rejected — access suspended"
      : "Business branch rejected",
    body: suspended
      ? `Business profile #${id} was rejected. ${suspended.userIds.length} user(s) suspended and ${suspended.sessionsRevoked} session(s) ended${req.body?.note ? `: ${req.body.note}` : "."}`
      : `Branch #${id} was rejected${req.body?.note ? `: ${req.body.note}` : "."}`,
    href: "/admin/profiles",
    organizationId: orgId,
    entityType: "business_profile",
    entityId: String(id),
    businessProfileId: id,
    targetUserId: meta?.requested_by ?? null,
    actorRole: "admin",
    dedupeKey: `branch-rejected:${id}`,
    severity: "urgent",
    expiresInHours: 336,
  });
  res.json({
    ok: true,
    suspendedUsers: suspended?.userIds.length ?? 0,
    sessionsRevoked: suspended?.sessionsRevoked ?? 0,
  });
});

router.post("/:id/unarchive", async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, archived_at, reviewed_by)
     VALUES (:id, 'approved', NULL, :userId)
     ON DUPLICATE KEY UPDATE approval_status = 'approved', archived_at = NULL, reviewed_by = :userId`,
    { id, userId: getActiveUserId() },
  );
  await logAudit("profile.unarchive", "business_profile", String(id), undefined, req.ip);
  res.json({ ok: true });
});

router.post("/:id/duplicate", async (req, res) => {
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    `SELECT * FROM business_profiles WHERE id = :id AND ${orgEqualsSql("organization_id")}`,
    { id, orgId },
  );
  const src = Array.isArray(rows) ? (rows[0] as Record<string, unknown>) : null;
  if (!src) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const [result] = await pool.query(
    `INSERT INTO business_profiles
      (organization_id, business_name, gstin, pan, address_line1, address_line2, state, state_code, phone, email,
       bank_name, bank_branch, bank_account, bank_ifsc, bank_upi, terms, is_default)
     VALUES (:orgId, :name, :gstin, :pan, :a1, :a2, :state, :stateCode, :phone, :email,
             :bankName, :bankBranch, :bankAccount, :bankIfsc, :bankUpi, :terms, 0)`,
    {
      orgId,
      name: `${String(src.business_name ?? "Branch")} (copy)`,
      gstin: null,
      pan: src.pan ?? null,
      a1: src.address_line1 ?? null,
      a2: src.address_line2 ?? null,
      state: src.state ?? null,
      stateCode: src.state_code ?? null,
      phone: src.phone ?? null,
      email: src.email ?? null,
      bankName: src.bank_name ?? null,
      bankBranch: src.bank_branch ?? null,
      bankAccount: src.bank_account ?? null,
      bankIfsc: src.bank_ifsc ?? null,
      bankUpi: src.bank_upi ?? null,
      terms: src.terms ?? null,
    },
  );
  const newId = Number((result as { insertId: number }).insertId);
  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, requested_by)
     VALUES (:id, 'pending', :userId)`,
    { id: newId, userId: getActiveUserId() },
  );
  await pool.query(
    `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:id, 'free', 'active')`,
    { id: newId },
  );
  await createApproval({ entityType: "business_profile", entityId: String(newId), action: "create" });
  await logAudit("profile.duplicate", "business_profile", String(newId), { from: id }, req.ip);
  res.status(201).json({ id: newId });
});

router.delete("/:id", async (req, res) => {
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    `SELECT is_default FROM business_profiles WHERE id = :id AND ${orgEqualsSql("organization_id")}`,
    { id, orgId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if ((row as { is_default: number }).is_default) {
    res.status(400).json({ error: "Cannot remove the default branch" });
    return;
  }
  await pool.query(
    `INSERT INTO business_profile_meta (business_profile_id, approval_status, archived_at)
     VALUES (:id, 'archived', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE approval_status = 'archived', archived_at = CURRENT_TIMESTAMP`,
    { id },
  );
  await createApproval({ entityType: "business_profile", entityId: String(id), action: "archive" });
  await logAudit("profile.archive", "business_profile", String(id), undefined, req.ip);
  await publishNotification({
    eventType: "business.branch_archived",
    title: "Business branch archived",
    body: `Branch #${id} was archived.`,
    href: "/admin/profiles",
    organizationId: orgId,
    entityType: "business_profile",
    entityId: String(id),
    businessProfileId: id,
    actorRole: "admin",
    dedupeKey: `branch-archive:${id}:${Date.now()}`,
    expiresInHours: 336,
  });
  res.json({ ok: true, archived: true });
});

router.post("/:id/access", async (req, res) => {
  const profileId = Number(req.params.id);
  const userId = Number(req.body?.userId);
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  await grantBranchAccess(userId, profileId);
  await logAudit("profile.grant_access", "business_profile", String(profileId), { userId }, req.ip);
  res.json({ ok: true });
});

router.delete("/:id/access/:userId", async (req, res) => {
  await revokeBranchAccess(Number(req.params.userId), Number(req.params.id));
  res.status(204).send();
});

export default router;
