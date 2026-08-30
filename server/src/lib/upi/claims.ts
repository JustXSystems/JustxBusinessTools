import { pool } from "../../db.js";
import { jsonVal } from "../admin/approvals.js";
import { logAudit } from "../audit.js";
import { recordSaasTransaction } from "../payments/saas.js";
import { parseToolIds } from "../tool-skus.js";
import { grantAllPaidSkus, grantToolLicenses } from "../tool-licenses.js";
import { ensureUpiSchema } from "./config.js";
import { notifyClaimDecision, notifyClaimSubmitted } from "./notify.js";
import { publishNotification } from "../notification-publish.js";

export type UpiClaim = {
  id: number;
  organizationId: number;
  userId: number | null;
  profileId: number;
  planId: string;
  toolIds: string[];
  amountInr: number;
  status: string;
  payerName: string;
  payerEmail: string;
  payerPhone: string | null;
  payerUpi: string | null;
  utr: string;
  paidAt: string | null;
  notes: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

function mapClaim(r: Record<string, unknown>): UpiClaim {
  return {
    id: Number(r.id),
    organizationId: Number(r.organization_id),
    userId: r.user_id == null ? null : Number(r.user_id),
    profileId: Number(r.business_profile_id),
    planId: String(r.plan_id),
    toolIds: parseToolIds(r.tool_ids ?? jsonVal(r.tool_ids)),
    amountInr: Number(r.amount_inr),
    status: String(r.status),
    payerName: String(r.payer_name),
    payerEmail: String(r.payer_email),
    payerPhone: (r.payer_phone as string | null) ?? null,
    payerUpi: (r.payer_upi as string | null) ?? null,
    utr: String(r.utr),
    paidAt: r.paid_at ? String(r.paid_at).slice(0, 10) : null,
    notes: (r.notes as string | null) ?? null,
    reviewNote: (r.review_note as string | null) ?? null,
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    createdAt: String(r.created_at),
  };
}

export async function listClaims(status?: string): Promise<UpiClaim[]> {
  await ensureUpiSchema();
  const filter = status && status !== "all" ? status : "";
  const [rows] = await pool.query(
    `SELECT * FROM upi_payment_claims
     WHERE (:status = '' OR status = :status)
     ORDER BY created_at DESC LIMIT 200`,
    { status: filter },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => mapClaim(row as Record<string, unknown>));
}

export async function getLatestClaimForOrg(orgId: number): Promise<UpiClaim | null> {
  await ensureUpiSchema();
  const [rows] = await pool.query(
    `SELECT * FROM upi_payment_claims WHERE organization_id = :orgId ORDER BY id DESC LIMIT 1`,
    { orgId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapClaim(row as Record<string, unknown>) : null;
}

export async function createClaim(input: {
  orgId: number;
  userId: number | null;
  profileId: number;
  planId: string;
  toolIds: string[];
  amountInr: number;
  payerName: string;
  payerEmail: string;
  payerPhone?: string | null;
  payerUpi?: string | null;
  utr: string;
  paidAt?: string | null;
  notes?: string | null;
  orgName?: string;
}): Promise<UpiClaim> {
  await ensureUpiSchema();
  const utr = input.utr.trim().toUpperCase();
  if (utr.length < 6) {
    throw Object.assign(new Error("Enter a valid UPI / UTR reference (min 6 characters)"), { status: 400 });
  }
  const [pending] = await pool.query(
    `SELECT id FROM upi_payment_claims
     WHERE organization_id = :orgId AND status = 'pending' LIMIT 1`,
    { orgId: input.orgId },
  );
  if (Array.isArray(pending) && pending[0]) {
    throw Object.assign(new Error("A payment is already waiting for JustXSystems verification"), { status: 409 });
  }

  const [result] = await pool.query(
    `INSERT INTO upi_payment_claims
       (organization_id, user_id, business_profile_id, plan_id, tool_ids, amount_inr, status,
        payer_name, payer_email, payer_phone, payer_upi, utr, paid_at, notes)
     VALUES (:orgId, :userId, :profileId, :planId, :toolIds, :amount, 'pending',
        :payerName, :payerEmail, :payerPhone, :payerUpi, :utr, :paidAt, :notes)`,
    {
      orgId: input.orgId,
      userId: input.userId,
      profileId: input.profileId,
      planId: input.planId,
      toolIds: JSON.stringify(input.toolIds),
      amount: input.amountInr,
      payerName: input.payerName.trim(),
      payerEmail: input.payerEmail.trim().toLowerCase(),
      payerPhone: input.payerPhone?.trim() || null,
      payerUpi: input.payerUpi?.trim() || null,
      utr,
      paidAt: input.paidAt || null,
      notes: input.notes?.trim() || null,
    },
  );
  const id = Number((result as { insertId: number }).insertId);
  const claim = (await getClaim(id))!;
  await notifyClaimSubmitted(
    {
      id: claim.id,
      payerName: claim.payerName,
      payerEmail: claim.payerEmail,
      payerPhone: claim.payerPhone,
      payerUpi: claim.payerUpi,
      amount: claim.amountInr,
      utr: claim.utr,
      orgName: input.orgName ?? "",
      status: "pending",
    },
    claim.id,
  );
  publishNotification({
    eventType: "billing.upi_claim_submitted",
    title: "UPI payment awaiting verification",
    body: `${claim.payerName} · ₹${claim.amountInr} · UTR ${claim.utr}. JustXSystems will verify and notify you.`,
    href: "/admin/approvals",
    organizationId: claim.organizationId,
    businessProfileId: claim.profileId,
    entityType: "upi_claim",
    entityId: String(claim.id),
    actorUserId: claim.userId,
    // Submitter always sees their own pending claim; roles = admin + owner (+ staff actor expands owner).
    targetUserId: claim.userId,
    dedupeKey: `upi-submit:${claim.id}`,
    severity: "attention",
    expiresInHours: 336,
  }).catch(() => undefined);
  return claim;
}

export async function getClaim(id: number): Promise<UpiClaim | null> {
  const [rows] = await pool.query(`SELECT * FROM upi_payment_claims WHERE id = :id`, { id });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? mapClaim(row as Record<string, unknown>) : null;
}

export async function reviewClaim(
  id: number,
  action: "approved" | "rejected",
  reviewerId: number | null,
  reviewNote: string | null,
  reqIp?: string,
): Promise<UpiClaim> {
  await ensureUpiSchema();
  const claim = await getClaim(id);
  if (!claim) {
    throw Object.assign(new Error("Claim not found"), { status: 404 });
  }
  if (claim.status !== "pending") {
    throw Object.assign(new Error("This claim was already reviewed"), { status: 400 });
  }

  await pool.query(
    `UPDATE upi_payment_claims
     SET status = :status, review_note = :note, reviewed_by = :reviewer, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { status: action, note: reviewNote, reviewer: reviewerId, id },
  );

  if (action === "approved") {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (claim.toolIds.length > 0) {
      await grantToolLicenses(claim.organizationId, claim.toolIds, periodEnd, claim.id);
    } else {
      await grantAllPaidSkus(claim.organizationId, periodEnd);
    }
    await recordSaasTransaction(
      claim.organizationId,
      "subscription_charge",
      "success",
      claim.amountInr,
      "upi",
      claim.utr,
    );
  }

  await logAudit(`upi.claim.${action}`, "upi_claim", String(id), { utr: claim.utr }, reqIp);

  const next = (await getClaim(id))!;
  await notifyClaimDecision(
    {
      id: next.id,
      payerName: next.payerName,
      payerEmail: next.payerEmail,
      payerPhone: next.payerPhone,
      amount: next.amountInr,
      utr: next.utr,
      status: action,
      reviewNote: next.reviewNote ?? (action === "approved" ? "Selected tools are now licensed." : "Please contact JustXSystems if this looks wrong."),
    },
    next.id,
    next.payerEmail,
    next.payerPhone ?? undefined,
  );
  // Await so inbox refetch after admin action includes this row.
  await publishNotification({
    eventType: "billing.upi_claim_decided",
    title: action === "approved" ? "UPI payment verified" : "UPI payment rejected",
    body:
      action === "approved"
        ? `${next.payerName} · ₹${next.amountInr} · UTR ${next.utr} approved. Tools are now licensed.`
        : `${next.payerName} · ₹${next.amountInr} · UTR ${next.utr} was rejected${next.reviewNote ? `: ${next.reviewNote}` : "."}`,
    href: action === "approved" ? "/subscription" : "/admin/approvals",
    organizationId: next.organizationId,
    businessProfileId: next.profileId,
    entityType: "upi_claim",
    entityId: String(next.id),
    actorUserId: reviewerId,
    actorRole: "admin",
    // Org submitter (owner/staff) always gets the decision in their inbox.
    targetUserId: next.userId,
    dedupeKey: `upi-decide:${next.id}:${action}`,
    severity: action === "rejected" ? "urgent" : "info",
    expiresInHours: 168,
    meta: { action, utr: next.utr, toolIds: next.toolIds },
  });
  return next;
}
