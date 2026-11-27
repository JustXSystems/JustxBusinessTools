import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";
import { withFileAccessToken } from "../lib/storage.js";
import {
  ensureDocumentAccentColorColumn,
  normalizeDocumentAccentColor,
  normalizeDocumentTextTone,
} from "../lib/document-accent.js";
import { ensureDocumentFooterColumn, normalizeDocumentFooter } from "../lib/document-footer.js";

const TOOL_ID = "quotationv1";
const router = Router();

function parseData(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (data as Record<string, unknown>) ?? {};
}

async function companyForRecord(
  data: Record<string, unknown>,
  businessProfileId: number | null,
): Promise<Record<string, unknown>> {
  const snapshot = data.companySnapshot;
  if (snapshot && typeof snapshot === "object") {
    const s = { ...(snapshot as Record<string, unknown>) };
    if (typeof s.logo === "string") {
      s.logo = withFileAccessToken(s.logo) ?? s.logo;
    }
    return s;
  }
  if (!businessProfileId) {
    return {
      name: "Your Company",
      logo: null,
      tagline: "",
      address: "",
      state: "",
      gstin: "",
      phone: "",
      email: "",
      documentAccentColor: normalizeDocumentAccentColor(null),
    };
  }
  await ensureDocumentAccentColorColumn();
  await ensureDocumentFooterColumn();
  const [rows] = await pool.query(
    `SELECT business_name, logo_data_url, address_line1, address_line2, state, gstin, phone, email,
            document_accent_color, document_text_tone, document_footer
     FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: businessProfileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as
        | {
            business_name: string;
            logo_data_url: string | null;
            address_line1: string | null;
            address_line2: string | null;
            state: string | null;
            gstin: string | null;
            phone: string | null;
            email: string | null;
            document_accent_color?: string | null;
            document_text_tone?: string | null;
            document_footer?: unknown;
          }
        | undefined)
    : undefined;
  if (!row) {
    return { name: "Your Company", logo: null };
  }
  return {
    name: row.business_name || "Your Company",
    logo: withFileAccessToken(row.logo_data_url),
    tagline: "",
    address: [row.address_line1, row.address_line2].filter(Boolean).join("\n"),
    state: row.state || "",
    gstin: row.gstin || "",
    phone: row.phone || "",
    email: row.email || "",
    landline: "",
    salesEmail: "",
    managerEmail: "",
    website: "",
    quotePrefix: "QT",
    place: "",
    documentAccentColor: normalizeDocumentAccentColor(row.document_accent_color),
    documentTextTone: normalizeDocumentTextTone(row.document_text_tone),
    documentFooter: normalizeDocumentFooter(row.document_footer),
  };
}

function mapQuotation(row: Record<string, unknown>, data: Record<string, unknown>) {
  return {
    ...data,
    id: String(row.id),
    quoteNo: String(row.doc_no ?? data.quoteNo ?? ""),
    status: String(row.status ?? data.status ?? "draft"),
    date: String(row.doc_date ?? data.date ?? ""),
    validTill: row.extra_date ? String(row.extra_date) : data.validTill,
  };
}

function parseJsonVal<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function mapImsQuotationToPublic(row: Record<string, unknown>) {
  const display = parseJsonVal<Record<string, unknown>>(row.display_json, {});
  return {
    id: String(row.id),
    quoteNo: String(row.quote_no ?? ""),
    category: String(row.category ?? "other"),
    engagement: String(row.engagement ?? "sale"),
    categoryCustomLabel: String(row.category_custom_label ?? ""),
    status: String(row.status ?? "draft"),
    date: row.quote_date ? String(row.quote_date).slice(0, 10) : "",
    validTill: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
    followUpDate: row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : "",
    preparedBy: String(row.prepared_by ?? ""),
    preparedByPhone: String(row.prepared_by_phone ?? ""),
    preparedByEmail: String(row.prepared_by_email ?? ""),
    customer: {
      name: String(row.customer_name ?? ""),
      company: String(row.customer_company ?? ""),
      address: String(row.customer_address ?? ""),
      city: String(row.customer_city ?? ""),
      state: String(row.customer_state ?? ""),
      gstin: String(row.customer_gstin ?? ""),
      phone: String(row.customer_phone ?? ""),
      email: String(row.customer_email ?? ""),
    },
    items: parseJsonVal<unknown[]>(row.lines_json, []),
    extraCharge: parseJsonVal<Record<string, unknown>>(row.extra_charge_json, { label: "", amount: "", gst: 18 }),
    gstOverride: parseJsonVal<Record<string, unknown>>(row.gst_override_json, { mode: "auto", cgst: null, sgst: null, igst: null }),
    showGstColumns: typeof display.showGstColumns === "boolean" ? display.showGstColumns : true,
    gstNote: typeof display.gstNote === "string" ? display.gstNote : undefined,
    buybackLabel: typeof display.buybackLabel === "string" ? display.buybackLabel : undefined,
    notes: String(row.notes ?? ""),
    history: parseJsonVal<unknown[]>(row.history_json, []),
    approvalToken: String(row.approval_token ?? ""),
    financeSent: Boolean(row.finance_sent),
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    approvedBy: row.approved_by ? String(row.approved_by) : undefined,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : undefined,
    rejectedBy: row.rejected_by ? String(row.rejected_by) : undefined,
    companySnapshot: parseJsonVal<Record<string, unknown> | null>(row.company_snapshot_json, null) ?? undefined,
  };
}

router.get("/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }

  // 1. Check native IMS Quotations first.
  try {
    const [imsRows] = await pool.query(
      `SELECT * FROM ims_quotations WHERE approval_token = :token LIMIT 1`,
      { token },
    );
    const imsRow = Array.isArray(imsRows) ? (imsRows[0] as Record<string, unknown> | undefined) : undefined;
    if (imsRow) {
      const q = mapImsQuotationToPublic(imsRow);
      const company = await companyForRecord(
        { companySnapshot: q.companySnapshot },
        imsRow.tenant_id != null ? Number(imsRow.tenant_id) : null,
      );
      res.json({ quotation: q, company });
      return;
    }
  } catch {
    /* ims_quotations table optional before migration 067 */
  }

  // 2. Fallback to standalone Quotation V1 (document_records).
  const [rows] = await pool.query(
    `SELECT id, doc_no, status, data, doc_date, extra_date, party_name, grand_total, business_profile_id
     FROM document_records
     WHERE tool_id = :toolId
       AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.approvalToken')) = :token
     LIMIT 1`,
    { toolId: TOOL_ID, token },
  );
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  const data = parseData(row.data);
  const company = await companyForRecord(
    data,
    row.business_profile_id != null ? Number(row.business_profile_id) : null,
  );
  res.json({
    quotation: mapQuotation(row, data),
    company,
  });
});

router.post("/:token/decide", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  const decision = String(req.body?.decision ?? "").toLowerCase();
  const approverName = String(req.body?.approverName ?? "").trim();
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be approved or rejected" });
    return;
  }
  if (!approverName || approverName.length < 2) {
    res.status(400).json({ error: "Approver name is required" });
    return;
  }
  if (approverName.length > 120) {
    res.status(400).json({ error: "Approver name is too long" });
    return;
  }

  // 1. Check native IMS Quotations first.
  try {
    const [imsRows] = await pool.query(
      `SELECT * FROM ims_quotations WHERE approval_token = :token LIMIT 1`,
      { token },
    );
    const imsRow = Array.isArray(imsRows) ? (imsRows[0] as Record<string, unknown> | undefined) : undefined;
    if (imsRow) {
      if (String(imsRow.status) !== "sent") {
        res.status(400).json({ error: `Quotation is already ${imsRow.status}` });
        return;
      }
      const now = new Date().toISOString();
      const history = parseJsonVal<Array<{ ts: string; event: string }>>(imsRow.history_json, []);
      history.push({
        ts: now,
        event: decision === "approved" ? `Approved by ${approverName}` : `Rejected by ${approverName}`,
      });
      const imsId = String(imsRow.id ?? "");
      await pool.query(
        `UPDATE ims_quotations SET
           status = :status,
           history_json = :history,
           approved_at = IF(:status = 'approved', CURRENT_TIMESTAMP, approved_at),
           approved_by = IF(:status = 'approved', :approverName, approved_by),
           rejected_at = IF(:status = 'rejected', CURRENT_TIMESTAMP, rejected_at),
           rejected_by = IF(:status = 'rejected', :approverName, rejected_by)
         WHERE id = :id`,
        { id: imsId, status: decision, history: JSON.stringify(history), approverName },
      );

      const tenantId = Number(imsRow.tenant_id);
      const quoteNo = String(imsRow.quote_no ?? "");
      const party = String(imsRow.customer_company || imsRow.customer_name || imsId);
      await pool
        .query(
          `INSERT INTO ims_quotation_alerts (id, tenant_id, quotation_id, message, is_read)
           VALUES (:id, :tenantId, :qid, :msg, 0)`,
          {
            id: randomUUID(),
            tenantId,
            qid: imsId,
            msg: `${quoteNo} ${decision} by ${approverName} (${party})`,
          },
        )
        .catch(() => undefined);
      await pool
        .query(
          `INSERT INTO ims_events (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload)
           VALUES (:tenantId, NULL, :actorName, :type, 'quotation', :qid, :summary, CAST(:payload AS JSON))`,
          {
            tenantId,
            actorName: approverName,
            type: decision === "approved" ? "quotation.approved" : "quotation.rejected",
            qid: imsId,
            summary: `${quoteNo} ${decision} by ${approverName}`.slice(0, 255),
            payload: JSON.stringify({ quoteNo, customerName: party, status: decision, action: `status:${decision}` }),
          },
        )
        .catch(() => undefined);

      let orgId: number | undefined;
      try {
        const [orgRows] = await pool.query(`SELECT organization_id FROM business_profiles WHERE id = :id LIMIT 1`, { id: tenantId });
        const orgRow = Array.isArray(orgRows) ? (orgRows[0] as { organization_id: number } | undefined) : undefined;
        if (orgRow) orgId = Number(orgRow.organization_id);
      } catch {
        /* best-effort */
      }
      if (orgId != null) {
        publishNotificationAsync({
          eventType: decision === "approved" ? "document.quotation_approved" : "document.quotation_rejected",
          title: decision === "approved" ? "Quotation approved by customer" : "Quotation rejected by customer",
          body: `${quoteNo ? `${quoteNo} · ` : ""}${approverName} ${decision} the quotation${party ? ` (${party})` : ""}.`,
          organizationId: orgId,
          businessProfileId: tenantId,
          href: `/ims?m=quotations&open=${imsRow.id}`,
          entityType: "quotation",
          entityId: String(imsRow.id),
          dedupeKey: `ims-quote-decide:${imsRow.id}:${decision}`,
          severity: decision === "rejected" ? "urgent" : "attention",
          meta: { decision, quoteNo, approverName, decidedAt: now },
          expiresInHours: 336,
        });
      }

      const mapped = mapImsQuotationToPublic({
        ...imsRow,
        status: decision,
        history_json: history,
        ...(decision === "approved" ? { approved_at: now, approved_by: approverName } : { rejected_at: now, rejected_by: approverName }),
      });
      const company = await companyForRecord({ companySnapshot: mapped.companySnapshot }, tenantId);
      res.json({ quotation: mapped, company });
      return;
    }
  } catch {
    /* ims_quotations table optional before migration 067 */
  }

  const [rows] = await pool.query(
    `SELECT id, status, data, business_profile_id FROM document_records
     WHERE tool_id = :toolId
       AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.approvalToken')) = :token
     LIMIT 1`,
    { toolId: TOOL_ID, token },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as { id: string; status: string; data: unknown; business_profile_id: number } | undefined)
    : undefined;
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (String(row.status) !== "sent") {
    res.status(400).json({ error: `Quotation is already ${row.status}` });
    return;
  }
  const data = parseData(row.data);
  const now = new Date().toISOString();
  data.status = decision;
  if (decision === "approved") {
    data.approvedAt = now;
    data.approvedBy = approverName;
  } else {
    data.rejectedAt = now;
    data.rejectedBy = approverName;
  }
  const history = Array.isArray(data.history) ? [...(data.history as unknown[])] : [];
  history.push({
    ts: now,
    event:
      decision === "approved"
        ? `Approved by ${approverName}`
        : `Rejected by ${approverName}`,
  });
  data.history = history;

  await pool.query(
    `UPDATE document_records SET status = :status, data = :data WHERE id = :id`,
    { id: row.id, status: decision, data: JSON.stringify(data) },
  );

  const party = String(data.customerName ?? data.partyName ?? row.id);
  const quoteNo = String(data.quoteNo ?? "");
  let orgId: number | undefined;
  if (row.business_profile_id) {
    try {
      const [orgRows] = await pool.query(
        `SELECT organization_id FROM business_profiles WHERE id = :id LIMIT 1`,
        { id: row.business_profile_id },
      );
      const orgRow = Array.isArray(orgRows)
        ? (orgRows[0] as { organization_id: number } | undefined)
        : undefined;
      if (orgRow) orgId = Number(orgRow.organization_id);
    } catch {
      /* best-effort */
    }
  }
  if (orgId != null) {
    publishNotificationAsync({
      eventType: decision === "approved" ? "document.quotation_approved" : "document.quotation_rejected",
      title: decision === "approved" ? "Quotation approved by customer" : "Quotation rejected by customer",
      body: `${quoteNo ? `${quoteNo} · ` : ""}${approverName} ${decision} the quotation${party ? ` (${party})` : ""}.`,
      organizationId: orgId,
      businessProfileId: row.business_profile_id ?? null,
      href: `/tools/quotationv1`,
      entityType: "document",
      entityId: String(row.id),
      dedupeKey: `quote-decide:${row.id}:${decision}`,
      severity: decision === "rejected" ? "urgent" : "attention",
      meta: { decision, quoteNo, approverName, decidedAt: now },
      expiresInHours: 336,
    });
  }

  const company = await companyForRecord(data, row.business_profile_id ?? null);
  res.json({ quotation: { ...data, id: row.id, status: decision }, company });
});

export default router;
