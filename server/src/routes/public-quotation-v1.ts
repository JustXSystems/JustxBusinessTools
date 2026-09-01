import { Router } from "express";
import { pool } from "../db.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";
import { withFileAccessToken } from "../lib/storage.js";

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
    };
  }
  const [rows] = await pool.query(
    `SELECT business_name, logo_data_url, address_line1, address_line2, state, gstin, phone, email
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

router.get("/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
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
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be approved or rejected" });
    return;
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
  if (decision === "approved") data.approvedAt = now;
  else data.rejectedAt = now;
  const history = Array.isArray(data.history) ? [...(data.history as unknown[])] : [];
  history.push({
    ts: now,
    event: decision === "approved" ? "Approved by customer" : "Rejected by customer",
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
      body: `${quoteNo ? `${quoteNo} · ` : ""}${party} ${decision} the quotation.`,
      organizationId: orgId,
      businessProfileId: row.business_profile_id ?? null,
      href: `/tools/quotationv1`,
      entityType: "document",
      entityId: String(row.id),
      dedupeKey: `quote-decide:${row.id}:${decision}`,
      severity: decision === "rejected" ? "urgent" : "attention",
      meta: { decision, quoteNo },
      expiresInHours: 336,
    });
  }

  const company = await companyForRecord(data, row.business_profile_id ?? null);
  res.json({ quotation: { ...data, id: row.id, status: decision }, company });
});

export default router;
