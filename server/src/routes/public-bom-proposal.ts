import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { exec, money, one, rows, tsOf } from "../ims/db.js";
import { round2, round3 } from "../ims/logic.js";
import { normalizeBomPaperTemplate } from "../ims/settings.js";
import { withBrowserFileAccessToken } from "../lib/storage.js";

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
  project_ref: string | null;
  party_id?: string | null;
  margin_pct: string;
  tax_pct: string;
  materials_total: string;
  margin_amount: string;
  tax_amount: string;
  grand_total: string;
  notes: string | null;
  prepared_by: string | null;
  revision: number | null;
  valid_until: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  scope_of_supply?: string | null;
  exclusions?: string | null;
  paper_json?: unknown;
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
  item_hsn: string | null;
};

type PublicBusiness = {
  name: string;
  gstin: string | null;
  address: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  bankUpi?: string | null;
};

async function loadByToken(token: string): Promise<BomDocPublicRow | null> {
  try {
    return await one<BomDocPublicRow>(
      pool,
      `SELECT id, tenant_id, doc_no, status, doc_date, capacity_label, title, customer_name, location, project_ref, party_id,
              margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total, notes, prepared_by,
              revision, valid_until, payment_terms, delivery_terms, warranty_terms,
              scope_of_supply, exclusions, paper_json,
              proposal_token, proposal_status, proposal_sent_at, proposal_responded_at, proposal_response_note
       FROM ims_bom_docs
       WHERE proposal_token = :token
         AND proposal_status IS NOT NULL
         AND proposal_status <> 'revoked'
       LIMIT 1`,
      { token },
    );
  } catch {
    return one<BomDocPublicRow>(
      pool,
      `SELECT id, tenant_id, doc_no, status, doc_date, capacity_label, title, customer_name, location, project_ref, party_id,
              margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total, notes, prepared_by,
              revision, valid_until, payment_terms, delivery_terms, warranty_terms,
              proposal_token, proposal_status, proposal_sent_at, proposal_responded_at, proposal_response_note
       FROM ims_bom_docs
       WHERE proposal_token = :token
         AND proposal_status IS NOT NULL
         AND proposal_status <> 'revoked'
       LIMIT 1`,
      { token },
    );
  }
}

async function customerStateForDoc(tenantId: number, partyId: string | null | undefined): Promise<string | null> {
  if (!partyId) return null;
  const row = await one<{ state: string | null }>(
    pool,
    `SELECT state FROM ims_parties WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
    { tenantId, id: partyId },
  ).catch(() => null);
  const s = String(row?.state ?? "").trim();
  return s || null;
}

async function loadPublicLines(tenantId: number, docId: string) {
  const list = await rows<BomLinePublicRow>(
    pool,
    `SELECT l.id, l.section, l.sort_no, l.line_kind, l.description, l.make_text, l.qty, l.unit, l.rate, l.amount, l.remarks,
            l.optional_flag, l.option_key, l.alternate_item_ids_json,
            i.sku AS item_sku, i.hsn AS item_hsn
     FROM ims_bom_doc_lines l
     LEFT JOIN ims_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
     WHERE l.tenant_id = :tenantId AND l.doc_id = :docId
     ORDER BY l.sort_no ASC, l.created_at ASC`,
    { tenantId, docId },
  ).catch(async () =>
    rows<BomLinePublicRow & { optional_flag?: number; option_key?: string | null; alternate_item_ids_json?: unknown }>(
      pool,
      `SELECT l.id, l.section, l.sort_no, l.line_kind, l.description, l.make_text, l.qty, l.unit, l.rate, l.amount, l.remarks,
              i.sku AS item_sku, i.hsn AS item_hsn
       FROM ims_bom_doc_lines l
       LEFT JOIN ims_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
       WHERE l.tenant_id = :tenantId AND l.doc_id = :docId
       ORDER BY l.sort_no ASC, l.created_at ASC`,
      { tenantId, docId },
    ),
  );
  return list.map((l) => {
    const ext = l as BomLinePublicRow & {
      optional_flag?: number;
      option_key?: string | null;
      alternate_item_ids_json?: unknown;
    };
    let alternateCount = 0;
    const rawAlts = ext.alternate_item_ids_json;
    if (Array.isArray(rawAlts)) alternateCount = rawAlts.length;
    else if (typeof rawAlts === "string") {
      try {
        const parsed = JSON.parse(rawAlts);
        if (Array.isArray(parsed)) alternateCount = parsed.length;
      } catch {
        alternateCount = 0;
      }
    }
    return {
      id: l.id,
      section: l.section,
      sortNo: Number(l.sort_no),
      lineKind: l.line_kind,
      description: l.description,
      makeText: l.make_text,
      sku: l.item_sku,
      hsn: l.item_hsn,
      qty: round3(money(l.qty)),
      unit: l.unit,
      rate: round2(money(l.rate)),
      amount: round2(money(l.amount)),
      remarks: l.remarks,
      optionalFlag: Boolean(ext.optional_flag),
      optionKey: ext.option_key ?? null,
      alternateCount,
    };
  });
}

async function businessForTenant(tenantId: number): Promise<PublicBusiness> {
  type BrandRow = {
    business_name: string | null;
    gstin: string | null;
    state: string | null;
    address_line1: string | null;
    address_line2: string | null;
    phone: string | null;
    email: string | null;
    logo_data_url: string | null;
    bank_name?: string | null;
    bank_branch?: string | null;
    bank_account?: string | null;
    bank_ifsc?: string | null;
    bank_upi?: string | null;
  };
  let row: BrandRow | null = null;
  try {
    row = await one<BrandRow>(
      pool,
      `SELECT business_name, gstin, state, address_line1, address_line2, phone, email, logo_data_url,
              bank_name, bank_branch, bank_account, bank_ifsc, bank_upi
       FROM business_profiles WHERE id = :id LIMIT 1`,
      { id: tenantId },
    );
  } catch {
    row = await one<BrandRow>(
      pool,
      `SELECT business_name, gstin, state, address_line1, address_line2, phone, email, logo_data_url
       FROM business_profiles WHERE id = :id LIMIT 1`,
      { id: tenantId },
    );
  }
  const address = [row?.address_line1, row?.address_line2].filter(Boolean).join(", ") || null;
  return {
    name: row?.business_name?.trim() || "Your Company",
    gstin: row?.gstin ?? null,
    address,
    state: row?.state ?? null,
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    logoUrl: row?.logo_data_url ? withBrowserFileAccessToken(row.logo_data_url) : null,
    bankName: row?.bank_name ?? null,
    bankBranch: row?.bank_branch ?? null,
    bankAccount: row?.bank_account ?? null,
    bankIfsc: row?.bank_ifsc ?? null,
    bankUpi: row?.bank_upi ?? null,
  };
}

type PublicPaperOptions = {
  template: string;
  industryPack: string;
  tone: string;
  density: string;
  hideMargin: boolean;
  scheduleColumns: string[] | null;
};

async function paperOptionsForTenant(tenantId: number): Promise<PublicPaperOptions> {
  try {
    const row = await one<{
      bom_paper_template: string | null;
      bom_industry_pack: string | null;
      bom_paper_tone: string | null;
      bom_paper_density: string | null;
      bom_hide_margin: number | boolean | null;
      bom_schedule_columns_json?: unknown;
    }>(
      pool,
      `SELECT bom_paper_template, bom_industry_pack, bom_paper_tone, bom_paper_density, bom_hide_margin,
              bom_schedule_columns_json
       FROM ims_settings WHERE tenant_id = :tenantId LIMIT 1`,
      { tenantId },
    );
    let scheduleColumns: string[] | null = null;
    const rawCols = row?.bom_schedule_columns_json;
    if (Array.isArray(rawCols)) scheduleColumns = rawCols.map(String);
    else if (typeof rawCols === "string" && rawCols.trim()) {
      try {
        const parsed = JSON.parse(rawCols);
        if (Array.isArray(parsed)) scheduleColumns = parsed.map(String);
      } catch {
        scheduleColumns = null;
      }
    }
    return {
      template: normalizeBomPaperTemplate(row?.bom_paper_template),
      industryPack: row?.bom_industry_pack ?? "general",
      tone: row?.bom_paper_tone ?? "neutral",
      density: row?.bom_paper_density ?? "comfort",
      hideMargin: Boolean(row?.bom_hide_margin),
      scheduleColumns,
    };
  } catch {
    const row = await one<{ bom_paper_template: string | null }>(
      pool,
      `SELECT bom_paper_template FROM ims_settings WHERE tenant_id = :tenantId LIMIT 1`,
      { tenantId },
    );
    return {
      template: normalizeBomPaperTemplate(row?.bom_paper_template),
      industryPack: "general",
      tone: "neutral",
      density: "comfort",
      hideMargin: false,
      scheduleColumns: null,
    };
  }
}

function parsePaperJson(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapPublicDoc(
  row: BomDocPublicRow,
  lines: Awaited<ReturnType<typeof loadPublicLines>>,
  business: PublicBusiness,
  paper: PublicPaperOptions,
  customerState: string | null,
) {
  const docPaper = parsePaperJson(row.paper_json);
  const mapped = {
    docNo: row.doc_no,
    status: row.status,
    docDate: String(row.doc_date).slice(0, 10),
    capacityLabel: row.capacity_label,
    title: row.title,
    customerName: row.customer_name,
    location: row.location,
    customerState,
    projectRef: row.project_ref,
    revision: Number(row.revision ?? 1),
    validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
    paymentTerms: row.payment_terms,
    deliveryTerms: row.delivery_terms,
    warrantyTerms: row.warranty_terms,
    scopeOfSupply: row.scope_of_supply ?? null,
    exclusions: row.exclusions ?? null,
    notes: row.notes,
    preparedBy: row.prepared_by,
    marginPct: round3(money(row.margin_pct)),
    taxPct: round3(money(row.tax_pct)),
    materialsTotal: round2(money(row.materials_total)),
    marginAmount: round2(money(row.margin_amount)),
    taxAmount: round2(money(row.tax_amount)),
    grandTotal: round2(money(row.grand_total)),
    proposalStatus: row.proposal_status,
    proposalSentAt: tsOf(row.proposal_sent_at),
    proposalRespondedAt: tsOf(row.proposal_responded_at),
    proposalResponseNote: row.proposal_response_note,
    lines,
    business,
    template: normalizeBomPaperTemplate(docPaper?.purpose ?? paper.template),
    industryPack: String(docPaper?.industryPack ?? paper.industryPack),
    tone: String(docPaper?.tone ?? paper.tone),
    density: String(docPaper?.density ?? paper.density),
    hideMargin: typeof docPaper?.hideMargin === "boolean" ? docPaper.hideMargin : paper.hideMargin,
    scheduleColumns: Array.isArray(docPaper?.columns)
      ? (docPaper!.columns as unknown[]).map(String)
      : paper.scheduleColumns,
    /** @deprecated prefer business.name — kept for older clients */
    businessName: business.name,
  };
  return mapped;
}

async function loadPublicPayload(tokenRow: BomDocPublicRow) {
  const [lines, business, paper, customerState] = await Promise.all([
    loadPublicLines(tokenRow.tenant_id, tokenRow.id),
    businessForTenant(tokenRow.tenant_id),
    paperOptionsForTenant(tokenRow.tenant_id),
    customerStateForDoc(tokenRow.tenant_id, tokenRow.party_id),
  ]);
  return mapPublicDoc(tokenRow, lines, business, paper, customerState);
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
  const mapped = await loadPublicPayload(row);
  res.json({ proposal: mapped, doc: mapped });
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
  const mapped = await loadPublicPayload(refreshed);
  res.json({ proposal: mapped, doc: mapped });
});

export default router;
