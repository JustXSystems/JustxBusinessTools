import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { exec, money, one, rows, tsOf } from "../ims/db.js";
import { round2, round3 } from "../ims/logic.js";

const router = Router();

type BomDocPublicRow = {
  id: string;
  tenant_id: number;
  doc_no: string;
  status: string;
  doc_date: string;
  capacity_label: string | null;
  title: string | null;
  customer_name: string;
  location: string | null;
  margin_pct: string;
  tax_pct: string;
  materials_total: string;
  margin_amount: string;
  tax_amount: string;
  grand_total: string;
  notes: string | null;
  prepared_by: string | null;
  proposal_token: string | null;
  proposal_status: string | null;
  proposal_sent_at: string | null;
  proposal_responded_at: string | null;
  proposal_response_note: string | null;
};

type BomLinePublicRow = {
  id: string;
  section: string;
  sort_no: number;
  line_kind: string;
  description: string;
  make_text: string | null;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
  remarks: string | null;
  item_sku: string | null;
};

async function loadByToken(token: string): Promise<BomDocPublicRow | null> {
  return one<BomDocPublicRow>(
    pool,
    `SELECT id, tenant_id, doc_no, status, doc_date, capacity_label, title, customer_name, location,
            margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total, notes, prepared_by,
            proposal_token, proposal_status, proposal_sent_at, proposal_responded_at, proposal_response_note
     FROM ims_bom_docs
     WHERE proposal_token = :token
       AND proposal_status IS NOT NULL
       AND proposal_status <> 'revoked'
     LIMIT 1`,
    { token },
  );
}

async function loadPublicLines(tenantId: number, docId: string) {
  const list = await rows<BomLinePublicRow>(
    pool,
    `SELECT l.id, l.section, l.sort_no, l.line_kind, l.description, l.make_text, l.qty, l.unit, l.rate, l.amount, l.remarks,
            i.sku AS item_sku
     FROM ims_bom_doc_lines l
     LEFT JOIN ims_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
     WHERE l.tenant_id = :tenantId AND l.doc_id = :docId
     ORDER BY l.sort_no ASC, l.created_at ASC`,
    { tenantId, docId },
  );
  return list.map((l) => ({
    id: l.id,
    section: l.section,
    sortNo: Number(l.sort_no),
    lineKind: l.line_kind,
    description: l.description,
    makeText: l.make_text,
    sku: l.item_sku,
    qty: round3(money(l.qty)),
    unit: l.unit,
    rate: round2(money(l.rate)),
    amount: round2(money(l.amount)),
    remarks: l.remarks,
  }));
}

async function businessNameForTenant(tenantId: number): Promise<string> {
  const row = await one<{ business_name: string }>(
    pool,
    `SELECT business_name FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: tenantId },
  );
  return row?.business_name?.trim() || "Your Company";
}

function mapPublicDoc(row: BomDocPublicRow, lines: Awaited<ReturnType<typeof loadPublicLines>>, businessName: string) {
  return {
    docNo: row.doc_no,
    status: row.status,
    docDate: String(row.doc_date).slice(0, 10),
    capacityLabel: row.capacity_label,
    title: row.title,
    customerName: row.customer_name,
    location: row.location,
    notes: row.notes,
    preparedBy: row.prepared_by,
    materialsTotal: round2(money(row.materials_total)),
    marginAmount: round2(money(row.margin_amount)),
    taxAmount: round2(money(row.tax_amount)),
    grandTotal: round2(money(row.grand_total)),
    proposalStatus: row.proposal_status,
    proposalSentAt: tsOf(row.proposal_sent_at),
    proposalRespondedAt: tsOf(row.proposal_responded_at),
    proposalResponseNote: row.proposal_response_note,
    lines,
    businessName,
  };
}

router.get("/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  const row = await loadByToken(token);
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (row.proposal_status === "sent") {
    await exec(
      pool,
      `UPDATE ims_bom_docs SET proposal_status = 'viewed'
       WHERE id = :id AND proposal_token = :token AND proposal_status = 'sent'`,
      { id: row.id, token },
    );
    row.proposal_status = "viewed";
  }
  const [lines, businessName] = await Promise.all([
    loadPublicLines(row.tenant_id, row.id),
    businessNameForTenant(row.tenant_id),
  ]);
  res.json({ proposal: mapPublicDoc(row, lines, businessName) });
});

const decideBody = z.object({
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().max(500).optional(),
  responderName: z.string().trim().max(120).optional(),
});

router.post("/:token/decide", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  const parsed = decideBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "decision must be accepted or rejected" });
    return;
  }
  const { decision, note, responderName } = parsed.data;
  const row = await loadByToken(token);
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (row.proposal_status === "accepted" || row.proposal_status === "rejected") {
    res.status(400).json({ error: `Proposal is already ${row.proposal_status}` });
    return;
  }
  const responseNote = [responderName?.trim(), note?.trim()].filter(Boolean).join(": ").slice(0, 500) || null;
  await exec(
    pool,
    `UPDATE ims_bom_docs SET
       proposal_status = :status,
       proposal_responded_at = CURRENT_TIMESTAMP,
       proposal_response_note = :note
     WHERE id = :id AND proposal_token = :token
       AND proposal_status IS NOT NULL
       AND proposal_status NOT IN ('revoked', 'accepted', 'rejected')`,
    { id: row.id, token, status: decision, note: responseNote },
  );
  try {
    await exec(
      pool,
      `INSERT INTO ims_events (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload)
       VALUES (:tenantId, NULL, :actorName, :type, 'bom_doc', :entityId, :summary, :payload)`,
      {
        tenantId: row.tenant_id,
        actorName: responderName?.trim() || "Customer",
        type: decision === "accepted" ? "bom.doc.proposal_accepted" : "bom.doc.proposal_rejected",
        entityId: row.id,
        summary: `Proposal ${decision} for ${row.doc_no}`,
        payload: JSON.stringify({ decision, note: note ?? null, responderName: responderName ?? null }),
      },
    );
  } catch {
    /* best-effort public event */
  }
  const refreshed = await loadByToken(token);
  if (!refreshed) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const [lines, businessName] = await Promise.all([
    loadPublicLines(refreshed.tenant_id, refreshed.id),
    businessNameForTenant(refreshed.tenant_id),
  ]);
  res.json({ proposal: mapPublicDoc(refreshed, lines, businessName) });
});

export default router;
