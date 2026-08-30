import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { createApproval, reviewApproval } from "../../lib/admin/approvals.js";
import { getActiveOrgId, getActiveUserId } from "../../lib/request-context.js";
import { orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import { getCollectionsSummary } from "../../lib/payments/collections.js";
import { getSaasPaymentSummary } from "../../lib/payments/saas.js";
import { notifyPaymentOps } from "../../lib/notification-billing.js";

const router = Router();

router.get("/overview", async (req, res) => {
  const days = Number(req.query.days ?? 90);
  const [saas, collections, opsRows] = await Promise.all([
    getSaasPaymentSummary(days),
    getCollectionsSummary(),
    pool.query(
      `SELECT COUNT(*) AS cnt FROM payment_ops
       WHERE approval_status = 'pending' AND ${orgEqualsSql("organization_id")}`,
      orgScopeParams(),
    ),
  ]);

  let upiPending = 0;
  let upiPendingInr = 0;
  try {
    const { listClaims } = await import("../../lib/upi/claims.js");
    const claims = await listClaims("pending");
    upiPending = claims.length;
    upiPendingInr = claims.reduce((sum, c) => sum + c.amountInr, 0);
  } catch {
    /* UPI schema optional */
  }

  const deskPending = Number(
    (Array.isArray(opsRows[0]) ? (opsRows[0][0] as { cnt: number })?.cnt : 0) ?? 0,
  );

  res.json({
    days,
    saas: saas.summary,
    subscription: saas.subscription,
    collections: collections.summary,
    pending: {
      deskOps: deskPending,
      upiClaims: upiPending,
      upiAmountInr: upiPendingInr,
      total: deskPending + upiPending,
    },
  });
});

router.get("/saas", async (req, res) => {
  const days = Number(req.query.days ?? 90);
  res.json(await getSaasPaymentSummary(days));
});

router.get("/collections", async (_req, res) => {
  res.json(await getCollectionsSummary());
});

router.get("/ops", async (req, res) => {
  const status = String(req.query.status ?? "");
  const [rows] = await pool.query(
    `SELECT id, kind, party, amount_inr, status, approval_status, due_date, reference, notes, created_at
     FROM payment_ops
     WHERE ${orgEqualsSql("organization_id")}
       AND (:status = '' OR status = :status OR approval_status = :status)
     ORDER BY created_at DESC
     LIMIT 200`,
    { ...orgScopeParams(), status },
  );
  res.json({
    ops: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        kind: String(r.kind),
        party: String(r.party),
        amountInr: Number(r.amount_inr),
        status: String(r.status),
        approvalStatus: String(r.approval_status),
        dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
        reference: (r.reference as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        createdAt: String(r.created_at),
      };
    }),
  });
});

router.post("/ops", async (req, res) => {
  const orgId = getActiveOrgId();
  const party = String(req.body?.party ?? "").trim();
  if (!party) {
    res.status(400).json({ error: "party required" });
    return;
  }
  const [result] = await pool.query(
    `INSERT INTO payment_ops
      (organization_id, kind, party, amount_inr, status, approval_status, due_date, reference, notes)
     VALUES (:orgId, :kind, :party, :amount, :status, 'pending', :dueDate, :reference, :notes)`,
    {
      orgId,
      kind: req.body?.kind ?? "receivable",
      party,
      amount: Number(req.body?.amountInr ?? 0),
      status: req.body?.status ?? "pending",
      dueDate: req.body?.dueDate ?? null,
      reference: req.body?.reference ?? null,
      notes: req.body?.notes ?? null,
    },
  );
  const id = Number((result as { insertId: number }).insertId);
  await createApproval({ entityType: "payment_op", entityId: String(id), action: "create" });
  await logAudit("payment_op.create", "payment_op", String(id), { party }, req.ip);
  await notifyPaymentOps({
    organizationId: orgId,
    opId: id,
    party,
    amountInr: Number(req.body?.amountInr ?? 0),
    kind: String(req.body?.kind ?? "receivable"),
    relatedUserId: getActiveUserId(),
  });
  res.status(201).json({ id });
});

router.post("/ops/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const orgId = getActiveOrgId();
  const [opsRows] = await pool.query(
    `SELECT party, amount_inr, kind FROM payment_ops WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  const op = Array.isArray(opsRows) ? (opsRows[0] as Record<string, unknown> | undefined) : undefined;
  await pool.query(
    `UPDATE payment_ops SET approval_status = 'approved', status = IF(status = 'pending', 'cleared', status)
     WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  const [pending] = await pool.query(
    `SELECT id FROM approval_requests
     WHERE organization_id = :orgId AND entity_type = 'payment_op' AND entity_id = :eid AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    { orgId, eid: String(id) },
  );
  const row = Array.isArray(pending) ? pending[0] : null;
  if (row) await reviewApproval(Number((row as { id: number }).id), "approved");
  if (op) {
    await notifyPaymentOps({
      organizationId: orgId,
      opId: id,
      party: String(op.party),
      amountInr: Number(op.amount_inr ?? 0),
      kind: String(op.kind ?? "receivable"),
      decided: "approved",
    });
  }
  res.json({ ok: true });
});

router.post("/ops/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const orgId = getActiveOrgId();
  const [opsRows] = await pool.query(
    `SELECT party, amount_inr, kind FROM payment_ops WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  const op = Array.isArray(opsRows) ? (opsRows[0] as Record<string, unknown> | undefined) : undefined;
  await pool.query(
    `UPDATE payment_ops SET approval_status = 'rejected' WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  if (op) {
    await notifyPaymentOps({
      organizationId: orgId,
      opId: id,
      party: String(op.party),
      amountInr: Number(op.amount_inr ?? 0),
      kind: String(op.kind ?? "receivable"),
      decided: "rejected",
    });
  }
  res.json({ ok: true });
});

router.get("/upi/config", async (_req, res) => {
  const { getUpiPayee, getUpiNotify } = await import("../../lib/upi/config.js");
  const [payee, notify] = await Promise.all([getUpiPayee(), getUpiNotify()]);
  res.json({ payee, notify });
});

router.put("/upi/config", async (req, res) => {
  const { saveUpiPayee, saveUpiNotify, getUpiPayee, getUpiNotify } = await import("../../lib/upi/config.js");
  const payee = req.body?.payee ? await saveUpiPayee(req.body.payee) : await getUpiPayee();
  const notify = req.body?.notify ? await saveUpiNotify(req.body.notify) : await getUpiNotify();
  res.json({ payee, notify });
});

router.get("/upi/claims", async (req, res) => {
  const { listClaims } = await import("../../lib/upi/claims.js");
  res.json({ claims: await listClaims(String(req.query.status ?? "")) });
});

router.post("/upi/claims/:id/approve", async (req, res) => {
  try {
    const { reviewClaim } = await import("../../lib/upi/claims.js");
    const { getActiveUserId } = await import("../../lib/request-context.js");
    const claim = await reviewClaim(
      Number(req.params.id),
      "approved",
      getActiveUserId(),
      String(req.body?.reviewNote ?? "").trim() || "Verified against bank / UPI statement.",
      req.ip,
    );
    res.json({ claim });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Approve failed" });
  }
});

router.post("/upi/claims/:id/reject", async (req, res) => {
  try {
    const { reviewClaim } = await import("../../lib/upi/claims.js");
    const { getActiveUserId } = await import("../../lib/request-context.js");
    const claim = await reviewClaim(
      Number(req.params.id),
      "rejected",
      getActiveUserId(),
      String(req.body?.reviewNote ?? "").trim() || "Could not match this UTR.",
      req.ip,
    );
    res.json({ claim });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Reject failed" });
  }
});

router.get("/upi/outbox", async (_req, res) => {
  const { listNotifyOutbox } = await import("../../lib/upi/notify.js");
  res.json({ events: await listNotifyOutbox() });
});

export default router;
