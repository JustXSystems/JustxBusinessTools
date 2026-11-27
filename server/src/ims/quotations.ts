import type { Router } from "express";
import type { PoolConnection } from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { jsonVal } from "../lib/admin/approvals.js";
import { logAudit } from "../lib/audit.js";
import { ensureDocumentAccentColorColumn, normalizeDocumentAccentColor, normalizeDocumentTextTone } from "../lib/document-accent.js";
import { ensureDocumentFooterColumn, normalizeDocumentFooter } from "../lib/document-footer.js";
import { createEmailOutbox, emailWebhookConfigured, mapOutboxPublic, postEmailWebhookPayload } from "../lib/email-outbox.js";
import { notifyDocumentOutbound } from "../lib/notification-billing.js";
import { ensureSendSettingsColumn, normalizeProfileSendSettings } from "../lib/profile-send-settings.js";
import {
  FOLLOW_UP_REMINDER_TIMEZONE_DEFAULT,
  localDateParts,
  runFollowUpRemindersForProfile,
} from "../lib/quotation-followup-reminders.js";
import { signatureOf, signatureUpdateDecision } from "../lib/quotation-signature.js";
import { getActiveOrgId } from "../lib/request-context.js";
import { withFileAccessToken } from "../lib/storage.js";
import {
  getWhatsAppDeliveryConfig,
  normalizeWaPhone,
  postWhatsAppWebhook,
  sendWhatsAppCloudDocuments,
} from "../lib/whatsapp-cloud.js";
import { draftInvoiceNo, insertImsInvoice, upsertParty } from "./connect.js";
import { actorName, actorOf, isOwner, parse, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./host.js";
import { addDaysISO, computeTotals, isIntraState, nameKey, round2, round3, todayISO, type ImsLineInput } from "./logic.js";
import {
  computeQuoteTotals,
  formatV1QuoteNo,
  normalizeImsQuoteSettings,
  normalizeQuoteCategory,
  normalizeQuoteEngagement,
  normalizeQuoteStatus,
  parseQuoteTrailingSeq,
  QUOTE_CATEGORIES,
  QUOTE_ENGAGEMENTS,
  QUOTE_STATUSES,
  type ImsQuoteSettings,
  type QuoteCategory,
  type QuoteEngagement,
  type QuoteExtraCharge,
  type QuoteGstOverride,
  type QuoteLineInput,
} from "./quote-logic.js";
import { getSettings, type ImsSettings } from "./settings.js";
import { nextDocNo } from "./stock.js";
import { loadReservedQtyByItem } from "./stock-state.js";

type QuoteRow = {
  id: string;
  tenant_id: number;
  quote_no: string;
  revision: number;
  parent_quote_id: string | null;
  category: string;
  engagement: string;
  category_custom_label: string | null;
  status: string;
  quote_date: unknown;
  valid_until: unknown;
  follow_up_date: unknown;
  party_id: string | null;
  customer_name: string;
  customer_company: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_gstin: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  subtotal: string;
  discount_total: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total_gst: string;
  buyback_less: string;
  round_off: string;
  grand_total: string;
  lines_json: unknown;
  extra_charge_json: unknown;
  gst_override_json: unknown;
  display_json: unknown;
  notes: string | null;
  company_snapshot_json: unknown;
  history_json: unknown;
  prepared_by: string;
  prepared_by_phone: string | null;
  prepared_by_email: string | null;
  created_by_user_id: number | null;
  approval_token: string;
  finance_sent: number;
  approved_at: unknown;
  approved_by: string | null;
  rejected_at: unknown;
  rejected_by: string | null;
  converted_so_id: string | null;
  converted_invoice_id: string | null;
  converted_bom_id: string | null;
  so_no?: string | null;
  invoice_no?: string | null;
  bom_doc_no?: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type DisplayJson = {
  showGstColumns?: boolean;
  gstNote?: string;
  buybackLabel?: string;
};

const clip = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

const newApprovalToken = () => randomBytes(24).toString("hex");

function mapQuoteRow(r: QuoteRow) {
  const items = json<QuoteLineInput[]>(r.lines_json, []);
  const extraCharge = json<QuoteExtraCharge>(r.extra_charge_json, { label: "", amount: "", gst: 18 });
  const gstOverride = json<QuoteGstOverride>(r.gst_override_json, { mode: "auto", cgst: null, sgst: null, igst: null });
  const display = json<DisplayJson>(r.display_json, {});
  const history = json<Array<{ ts: string; event: string }>>(r.history_json, []);
  const companySnapshot = json<Record<string, unknown> | null>(r.company_snapshot_json, null);

  return {
    id: r.id,
    quoteNo: r.quote_no,
    revision: Number(r.revision ?? 1),
    parentQuoteId: r.parent_quote_id ?? null,
    category: normalizeQuoteCategory(r.category),
    engagement: normalizeQuoteEngagement(r.engagement),
    categoryCustomLabel: r.category_custom_label ?? "",
    status: normalizeQuoteStatus(r.status),
    date: isoOf(r.quote_date),
    validTill: r.valid_until ? isoOf(r.valid_until) : "",
    followUpDate: r.follow_up_date ? isoOf(r.follow_up_date) : "",
    preparedBy: r.prepared_by ?? "",
    preparedByPhone: r.prepared_by_phone ?? "",
    preparedByEmail: r.prepared_by_email ?? "",
    createdByUserId: r.created_by_user_id == null ? undefined : Number(r.created_by_user_id),
    partyId: r.party_id ?? undefined,
    customer: {
      name: r.customer_name ?? "",
      company: r.customer_company ?? "",
      address: r.customer_address ?? "",
      city: r.customer_city ?? "",
      state: r.customer_state ?? "",
      gstin: r.customer_gstin ?? "",
      phone: r.customer_phone ?? "",
      email: r.customer_email ?? "",
    },
    items,
    extraCharge,
    gstOverride,
    showGstColumns: display.showGstColumns,
    gstNote: display.gstNote,
    buybackLabel: display.buybackLabel,
    notes: r.notes ?? "",
    companySnapshot: companySnapshot ?? undefined,
    history,
    approvalToken: r.approval_token,
    financeSent: Boolean(r.finance_sent),
    approvedAt: tsOf(r.approved_at) ?? undefined,
    approvedBy: r.approved_by ?? undefined,
    rejectedAt: tsOf(r.rejected_at) ?? undefined,
    rejectedBy: r.rejected_by ?? undefined,
    _grandTotal: round2(money(r.grand_total)),
    totals: {
      subtotal: round2(money(r.subtotal)),
      discountTotal: round2(money(r.discount_total)),
      taxable: round2(money(r.taxable)),
      cgst: round2(money(r.cgst)),
      sgst: round2(money(r.sgst)),
      igst: round2(money(r.igst)),
      totalGst: round2(money(r.total_gst)),
      oldBuybackLess: round2(money(r.buyback_less)),
      roundOff: round2(money(r.round_off)),
      grand: round2(money(r.grand_total)),
    },
    conversions: {
      salesOrderId: r.converted_so_id ?? null,
      salesOrderNo: r.so_no ?? null,
      invoiceId: r.converted_invoice_id ?? null,
      invoiceNo: r.invoice_no ?? null,
      bomId: r.converted_bom_id ?? null,
      bomDocNo: r.bom_doc_no ?? null,
    },
    createdAt: tsOf(r.created_at) ?? "",
    updatedAt: tsOf(r.updated_at) ?? "",
  };
}

/** Load merged letterhead + quote settings, auto-falling back to legacy V1 config / business profile when unset. */
async function loadQuotationConfig(deps: ImsDeps, tenantId: number, settings: ImsSettings) {
  await ensureDocumentAccentColorColumn().catch(() => undefined);
  await ensureDocumentFooterColumn().catch(() => undefined);
  await ensureSendSettingsColumn().catch(() => undefined);

  const profileRow = await one<{
    organization_id?: number;
    business_name?: string | null;
    logo_data_url?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    state?: string | null;
    gstin?: string | null;
    phone?: string | null;
    email?: string | null;
    document_accent_color?: string | null;
    document_text_tone?: string | null;
    document_footer?: unknown;
    quote_terms?: unknown;
    send_settings?: unknown;
  }>(
    pool,
    `SELECT organization_id, business_name, logo_data_url, address_line1, address_line2, state, gstin, phone, email,
            document_accent_color, document_text_tone, document_footer, quote_terms, send_settings
     FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: tenantId },
  ).catch(() => null);

  // Legacy V1 company config fallback (read-only) so migrating tenants see zero surprise.
  let legacyCompany: Record<string, unknown> = {};
  const orgId = profileRow?.organization_id ?? getActiveOrgId();
  if (orgId) {
    const cfg = await one<{ value: unknown }>(
      pool,
      `SELECT value FROM platform_config WHERE config_key = :k LIMIT 1`,
      { k: `quotation_v1_company:${orgId}` },
    ).catch(() => null);
    if (cfg?.value) {
      const parsed = typeof cfg.value === "string" ? (() => { try { return JSON.parse(cfg.value); } catch { return null; } })() : jsonVal(cfg.value) ?? cfg.value;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) legacyCompany = parsed as Record<string, unknown>;
    }
  }

  const profileQuoteTerms = json<Record<string, string>>(profileRow?.quote_terms, {});
  const qs: ImsQuoteSettings = {
    ...settings.quoteSettings,
    termsByEngagement:
      Object.keys(settings.quoteSettings.termsByEngagement).length > 0
        ? settings.quoteSettings.termsByEngagement
        : (profileQuoteTerms as ImsQuoteSettings["termsByEngagement"]),
  };

  const name = String(profileRow?.business_name || settings.businessName || legacyCompany.name || "Your Company").trim();
  const prefixFromName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  const quotePrefix =
    qs.quotePrefix ||
    (typeof legacyCompany.quotePrefix === "string" && legacyCompany.quotePrefix.trim() && legacyCompany.quotePrefix !== "QT"
      ? legacyCompany.quotePrefix.trim().toUpperCase()
      : "") ||
    prefixFromName ||
    "QT";

  const addressFromProfile = [profileRow?.address_line1, profileRow?.address_line2]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");

  const company = {
    name,
    logo: profileRow?.logo_data_url ? withFileAccessToken(profileRow.logo_data_url) : null,
    tagline: qs.tagline || String(legacyCompany.tagline ?? "Quotations · Service · Sales"),
    address: settings.address || addressFromProfile || String(legacyCompany.address ?? ""),
    state: settings.state || profileRow?.state || String(legacyCompany.state ?? "Karnataka"),
    gstin: settings.gstin || profileRow?.gstin || String(legacyCompany.gstin ?? ""),
    landline: qs.landline || String(legacyCompany.landline ?? ""),
    phone: settings.phone || profileRow?.phone || String(legacyCompany.phone ?? ""),
    email: settings.email || profileRow?.email || String(legacyCompany.email ?? ""),
    salesEmail: qs.salesEmail || String(legacyCompany.salesEmail ?? ""),
    managerEmail: qs.managerEmail || String(legacyCompany.managerEmail ?? ""),
    website: qs.website || String(legacyCompany.website ?? ""),
    quotePrefix,
    place: qs.place || String(legacyCompany.place ?? "Bengaluru"),
    documentAccentColor: normalizeDocumentAccentColor(profileRow?.document_accent_color),
    documentTextTone: normalizeDocumentTextTone(profileRow?.document_text_tone),
    documentFooter: normalizeDocumentFooter(profileRow?.document_footer),
  };

  const sendSettings = normalizeProfileSendSettings(profileRow?.send_settings);
  return { company, quoteSettings: qs, sendSettings };
}

/**
 * Allocate the next quotation number per tenant_id atomically inside the transaction.
 * Supports V1 format (`PREFIX-CAT/ENG-YYYY/MM-0001`) and IMS FY format (`QTN/26-27/0001`).
 * Automatically seeds sequence past any existing quotes (including legacy Quotation V1) so numbers never collide.
 */
async function allocateQuoteNo(
  conn: PoolConnection,
  tenantId: number,
  settings: ImsSettings,
  prefix: string,
  category: QuoteCategory,
  engagement: QuoteEngagement,
  quoteDate: string,
): Promise<string> {
  if (settings.quoteSettings.numberingMode === "ims_fy") {
    return nextDocNo(conn, tenantId, "quotation", prefix || "QTN", quoteDate, settings.businessName);
  }
  const ym = /^\d{4}-\d{2}/.test(quoteDate) ? quoteDate.slice(0, 7) : todayISO().slice(0, 7);
  const seqType = `qtn:${category}:${engagement}`;
  const existingSeq = await one<{ next_no: number }>(
    conn,
    `SELECT next_no FROM ims_sequences WHERE tenant_id = :tenantId AND doc_type = :seqType AND fiscal_year = :ym FOR UPDATE`,
    { tenantId, seqType, ym },
  );

  let nextNo: number;
  if (existingSeq) {
    nextNo = Number(existingSeq.next_no);
    await exec(
      conn,
      `UPDATE ims_sequences SET next_no = next_no + 1 WHERE tenant_id = :tenantId AND doc_type = :seqType AND fiscal_year = :ym`,
      { tenantId, seqType, ym },
    );
  } else {
    // Seed past any existing IMS or legacy V1 quotes for the same category/engagement/month.
    const yyyy = ym.slice(0, 4);
    const mm = ym.slice(5, 7);
    const [imsExisting, legacyExisting] = await Promise.all([
      rows<{ quote_no: string }>(
        conn,
        `SELECT quote_no FROM ims_quotations WHERE tenant_id = :tenantId AND category = :category AND engagement = :engagement AND quote_no LIKE :pat`,
        { tenantId, category, engagement, pat: `%-${yyyy}/${mm}-%` },
      ),
      rows<{ doc_no: string }>(
        conn,
        `SELECT doc_no FROM document_records WHERE business_profile_id = :tenantId AND tool_id = 'quotationv1' AND doc_no LIKE :pat`,
        { tenantId, pat: `%-${yyyy}/${mm}-%` },
      ).catch(() => []),
    ]);
    let maxSeq = 0;
    for (const r of imsExisting) maxSeq = Math.max(maxSeq, parseQuoteTrailingSeq(r.quote_no));
    for (const r of legacyExisting) maxSeq = Math.max(maxSeq, parseQuoteTrailingSeq(r.doc_no));
    nextNo = maxSeq + 1;
    await exec(
      conn,
      `INSERT INTO ims_sequences (tenant_id, doc_type, fiscal_year, next_no) VALUES (:tenantId, :seqType, :ym, :after)
       ON DUPLICATE KEY UPDATE next_no = GREATEST(next_no + 1, :after)`,
      { tenantId, seqType, ym, after: nextNo + 1 },
    );
  }

  return formatV1QuoteNo({ prefix, category, engagement, dateIso: quoteDate, seq: nextNo });
}

async function addAlert(db: Queryable, tenantId: number, quotationId: string | null, message: string) {
  const id = randomUUID();
  await exec(
    db,
    `INSERT INTO ims_quotation_alerts (id, tenant_id, quotation_id, message, is_read) VALUES (:id, :tenantId, :quotationId, :message, 0)`,
    { id, tenantId, quotationId, message: message.slice(0, 500) },
  ).catch(() => undefined);
  return { id, quotationId: quotationId ?? "", message, read: false, createdAt: new Date().toISOString() };
}

const ConvertSchema = z.object({
  target: z.enum(["sales_order", "invoice", "proforma", "bom"]),
});

export function registerQuotations(router: Router, deps: ImsDeps): void {
  /* ---------- Config & Send Status ---------- */
  router.get("/quotations/config", async (_req, res) => {
    const actor = actorOf(res);
    const settings = await getSettings(deps, actor.tenantId);
    const [{ company, quoteSettings, sendSettings }, emailWebhook, whatsappConfig, legacyRow] = await Promise.all([
      loadQuotationConfig(deps, actor.tenantId, settings),
      emailWebhookConfigured().catch(() => false),
      getWhatsAppDeliveryConfig().catch(() => ({ canAutoAttach: false, cloudConfigured: false, webhookConfigured: false })),
      one<{ n: number }>(
        deps.db,
        `SELECT COUNT(*) AS n FROM document_records d
         WHERE d.business_profile_id = :tenantId AND d.tool_id = 'quotationv1'
           AND NOT EXISTS (SELECT 1 FROM ims_quotations q WHERE q.tenant_id = :tenantId AND q.id = d.id)`,
        { tenantId: actor.tenantId },
      ).catch(() => ({ n: 0 })),
    ]);

    res.json({
      company,
      quoteSettings,
      sendSettings,
      emailWebhookConfigured: emailWebhook,
      whatsappConfig,
      legacyCount: Number(legacyRow?.n ?? 0),
    });
  });

  /* ---------- List ---------- */
  router.get("/quotations", async (req, res) => {
    const actor = actorOf(res);
    const status = qstr(req.query.status, 24);
    const where = ["q.tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) {
      where.push("q.status = :status");
      params.status = status;
    }
    const list = await rows<QuoteRow>(
      deps.db,
      `SELECT q.*, so.so_no, inv.invoice_no, b.doc_no AS bom_doc_no
       FROM ims_quotations q
       LEFT JOIN ims_sales_orders so ON so.tenant_id = q.tenant_id AND so.id = q.converted_so_id
       LEFT JOIN ims_invoices inv ON inv.tenant_id = q.tenant_id AND inv.id = q.converted_invoice_id
       LEFT JOIN ims_bom_docs b ON b.tenant_id = q.tenant_id AND b.id = q.converted_bom_id
       WHERE ${where.join(" AND ")}
       ORDER BY q.updated_at DESC
       LIMIT 2000`,
      params,
    );
    res.json({ quotations: list.map(mapQuoteRow) });
  });

  /* ---------- Alerts (V1 Notifications tab parity) ---------- */
  router.get("/quotations/alerts", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<{ id: string; quotation_id: string | null; message: string; is_read: number; created_at: unknown }>(
      deps.db,
      `SELECT id, quotation_id, message, is_read, created_at FROM ims_quotation_alerts
       WHERE tenant_id = :tenantId ORDER BY created_at DESC LIMIT 200`,
      { tenantId: actor.tenantId },
    ).catch(() => []);
    res.json({
      notifications: list.map((a) => ({
        id: a.id,
        quotationId: a.quotation_id ?? "",
        message: a.message,
        read: Boolean(a.is_read),
        createdAt: tsOf(a.created_at) ?? "",
      })),
    });
  });

  router.post("/quotations/alerts", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);
    const message = String(req.body?.message ?? "").trim();
    const quotationId = clip(req.body?.quotationId, 64);
    const notification = await addAlert(deps.db, actor.tenantId, quotationId, message || "Quotation update");
    res.status(201).json({ notification });
  });

  router.post("/quotations/alerts/read-all", async (_req, res) => {
    const actor = actorOf(res);
    const result = await exec(
      deps.db,
      `UPDATE ims_quotation_alerts SET is_read = 1 WHERE tenant_id = :tenantId AND is_read = 0`,
      { tenantId: actor.tenantId },
    );
    res.json({ ok: true, count: Number(result.affectedRows ?? 0) });
  });

  router.post("/quotations/alerts/:id/read", async (req, res) => {
    const actor = actorOf(res);
    await exec(
      deps.db,
      `UPDATE ims_quotation_alerts SET is_read = 1 WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: req.params.id },
    );
    res.json({ ok: true });
  });

  /* ---------- Activity / History ---------- */
  router.get("/quotations/activity", async (_req, res) => {
    const actor = actorOf(res);
    const list = await rows<{ id: number; actor_name: string | null; event_type: string; entity_id: string | null; summary: string; payload: unknown; created_at: unknown }>(
      deps.db,
      `SELECT id, actor_name, event_type, entity_id, summary, payload, created_at
       FROM ims_events
       WHERE tenant_id = :tenantId AND entity_type = 'quotation'
       ORDER BY id DESC LIMIT 500`,
      { tenantId: actor.tenantId },
    );
    const history = list.map((e) => {
      const p = json<Record<string, unknown>>(e.payload, {});
      return {
        id: String(e.id),
        quotationId: e.entity_id ?? "",
        quoteNo: typeof p.quoteNo === "string" ? p.quoteNo : null,
        customerName: typeof p.customerName === "string" ? p.customerName : "",
        typeLabel: typeof p.typeLabel === "string" ? p.typeLabel : "",
        status: typeof p.status === "string" ? p.status : "",
        grand: Number(p.grand ?? 0),
        savedAt: tsOf(e.created_at) ?? "",
        action: typeof p.action === "string" ? p.action : e.event_type,
        preparedBy: typeof p.preparedBy === "string" ? p.preparedBy : e.actor_name ?? "",
        summary: e.summary,
      };
    });
    res.json({ history });
  });

  /* ---------- Send Status & Outbound Email / WhatsApp (V1 Parity) ---------- */
  router.get("/quotations/send/email/status", async (_req, res) => {
    res.json({ webhookConfigured: await emailWebhookConfigured().catch(() => false) });
  });

  router.get("/quotations/send/whatsapp/status", async (_req, res) => {
    res.json(await getWhatsAppDeliveryConfig().catch(() => ({ canAutoAttach: false, cloudConfigured: false, webhookConfigured: false })));
  });

  router.post("/quotations/send/email", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);
    const to = String(req.body?.to ?? "").trim();
    const cc = String(req.body?.cc ?? "").trim();
    const subject = String(req.body?.subject ?? "").trim();
    const body = String(req.body?.message ?? req.body?.body ?? "").trim();
    const html = typeof req.body?.html === "string" && req.body.html.trim() ? req.body.html.trim() : undefined;
    const templateId = String(req.body?.templateId ?? "").trim() || undefined;
    const replyTo = String(req.body?.replyTo ?? "").trim() || undefined;
    const fromName = String(req.body?.fromName ?? "").trim() || undefined;
    const fromEmail = String(req.body?.fromEmail ?? "").trim() || undefined;
    const queueOnly = Boolean(req.body?.queueOnly);
    const quotationId = clip(req.body?.quotationId, 64);
    const quoteNo = clip(req.body?.quoteNo, 64);

    if (!to) throw badRequest("Email To is required");
    if (!subject || !body) throw badRequest("Subject and message are required");

    const webhookOn = await emailWebhookConfigured();
    let outboxId: string | null = null;
    try {
      if (webhookOn && !queueOnly) {
        try {
          await postEmailWebhookPayload({
            channel: "email",
            to,
            cc: cc || undefined,
            subject,
            body,
            html,
            templateId,
            replyTo,
            fromName,
            fromEmail,
            from: fromEmail && fromName ? `${fromName} <${fromEmail}>` : fromEmail || fromName || undefined,
            kind: "ims.quotation.send",
            quotationId,
            quoteNo,
            pdfBase64: req.body?.pdfBase64 ?? null,
            filename: req.body?.filename ?? null,
          });
          const outbox = await createEmailOutbox({
            toolId: "imsdealer",
            entityType: "quotation",
            entityId: quotationId,
            quoteNo,
            to,
            cc,
            subject,
            body,
            html: html ?? null,
            templateId: templateId ?? null,
            replyTo: replyTo ?? null,
            fromName: fromName ?? null,
            fromEmail: fromEmail ?? null,
            filename: req.body?.filename ? String(req.body.filename) : null,
            pdfBase64: req.body?.pdfBase64 ? String(req.body.pdfBase64) : null,
            status: "sent",
            lastChannel: "webhook",
          });
          outboxId = outbox.id;
          await logAudit("ims.quotation.send.email", "quotation", quotationId ?? "", { quoteNo, to, cc, via: "webhook", outboxId }, req.ip);
          await addAlert(deps.db, actor.tenantId, quotationId, `${quoteNo ?? "Quotation"} emailed to ${to}`);
          notifyDocumentOutbound({
            channel: "email",
            title: "Quotation emailed",
            body: `${quoteNo ?? "Quotation"} sent to ${to}${cc ? ` (cc ${cc})` : ""}.`,
            entityType: "quotation",
            entityId: quotationId ?? "",
            href: quotationId ? `/ims?m=quotations&open=${quotationId}` : "/ims?m=quotations",
          });
          res.json({ ok: true, delivered: true, via: "webhook", outboxId, outbox: mapOutboxPublic(outbox) });
          return;
        } catch (err) {
          const outbox = await createEmailOutbox({
            toolId: "imsdealer",
            entityType: "quotation",
            entityId: quotationId,
            quoteNo,
            to,
            cc,
            subject,
            body,
            html: html ?? null,
            templateId: templateId ?? null,
            replyTo: replyTo ?? null,
            fromName: fromName ?? null,
            fromEmail: fromEmail ?? null,
            filename: req.body?.filename ? String(req.body.filename) : null,
            pdfBase64: req.body?.pdfBase64 ? String(req.body.pdfBase64) : null,
            status: "failed",
            lastChannel: "webhook",
            lastError: err instanceof Error ? err.message : "Webhook send failed",
          });
          res.status(502).json({
            error: err instanceof Error ? err.message : "Email send failed",
            outboxId: outbox.id,
            outbox: mapOutboxPublic(outbox),
            hint: "Saved to Email Outbox — retry webhook, open mail app, or Open in Outlook via desktop agent.",
          });
          return;
        }
      }

      const outbox = await createEmailOutbox({
        toolId: "imsdealer",
        entityType: "quotation",
        entityId: quotationId,
        quoteNo,
        to,
        cc,
        subject,
        body,
        html: html ?? null,
        templateId: templateId ?? null,
        replyTo: replyTo ?? null,
        fromName: fromName ?? null,
        fromEmail: fromEmail ?? null,
        filename: req.body?.filename ? String(req.body.filename) : null,
        pdfBase64: req.body?.pdfBase64 ? String(req.body.pdfBase64) : null,
        status: "pending",
        lastChannel: queueOnly ? "queued" : "mailto",
      });
      outboxId = outbox.id;
      await addAlert(deps.db, actor.tenantId, quotationId, `${quoteNo ?? "Quotation"} email ${queueOnly ? "queued" : "prepared"} for ${to}`);
      res.json({
        ok: true,
        delivered: false,
        via: queueOnly ? "queued" : "mailto",
        outboxId,
        outbox: mapOutboxPublic(outbox),
        webhookConfigured: webhookOn,
        hint: queueOnly
          ? "Saved to Email Outbox. Open Sync Center / Email Outbox to send later."
          : "No EMAIL_WEBHOOK_URL — open mailto, download PDF to attach, or use Email Outbox → Open in Outlook.",
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Email send failed", outboxId });
    }
  });

  router.post("/quotations/send/whatsapp", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);
    const message = String(req.body?.message ?? "").trim();
    const filename = String(req.body?.filename ?? "quotation.pdf").trim() || "quotation.pdf";
    const pdfBase64 = String(req.body?.pdfBase64 ?? "").trim();
    const quotationId = clip(req.body?.quotationId, 64);
    const quoteNo = clip(req.body?.quoteNo, 64);
    const phonesRaw = Array.isArray(req.body?.phones) ? (req.body.phones as unknown[]) : [];
    const phones = [...new Set(phonesRaw.map((p) => normalizeWaPhone(String(p ?? ""))).filter((p): p is string => p.length >= 10))];

    if (!phones.length) throw badRequest("At least one WhatsApp number is required");
    if (!message) throw badRequest("WhatsApp message is required");
    if (!pdfBase64) throw badRequest("PDF attachment is required");

    const cfg = await getWhatsAppDeliveryConfig();
    if (!cfg.canAutoAttach) {
      res.json({
        ok: true,
        delivered: false,
        via: "manual",
        hint: "Configure WhatsApp under Admin → Integrations (Cloud API or webhook) for automatic PDF delivery.",
      });
      return;
    }

    if (cfg.cloudConfigured) {
      const result = await sendWhatsAppCloudDocuments({ phones, message, filename, pdfBase64 });
      if (!result.sent.length) {
        res.status(502).json({ error: result.errors[0]?.error ?? "WhatsApp Cloud API send failed", errors: result.errors });
        return;
      }
      await addAlert(deps.db, actor.tenantId, quotationId, `${quoteNo ?? "Quotation"} sent on WhatsApp to ${result.sent.join(", ")}`);
      notifyDocumentOutbound({
        channel: "whatsapp",
        title: "Quotation sent on WhatsApp",
        body: `${quoteNo ?? "Quotation"} delivered to ${result.sent.join(", ")}.`,
        entityType: "quotation",
        entityId: quotationId ?? "",
        href: quotationId ? `/ims?m=quotations&open=${quotationId}` : "/ims?m=quotations",
      });
      res.json({ ok: true, delivered: true, via: "cloud", sent: result.sent, errors: result.errors });
      return;
    }

    await postWhatsAppWebhook({ channel: "whatsapp", phones, message, kind: "ims.quotation.send", quotationId, quoteNo, pdfBase64, filename });
    await addAlert(deps.db, actor.tenantId, quotationId, `${quoteNo ?? "Quotation"} queued on WhatsApp for ${phones.join(", ")}`);
    res.json({ ok: true, delivered: true, via: "webhook", sent: phones, errors: [] });
  });

  router.post("/quotations/follow-up-reminders/run-now", async (req, res) => {
    const actor = actorOf(res);
    if (!isOwner(res)) throw forbidden("Only the business owner can run follow-up reminders manually.");
    const { date } = localDateParts(new Date(), process.env.FOLLOWUP_REMINDER_TZ?.trim() || FOLLOW_UP_REMINDER_TIMEZONE_DEFAULT);
    const result = await runFollowUpRemindersForProfile(actor.tenantId, date);
    await recordEvent(deps, actor, {
      type: "quotation.followup_reminders.run",
      entityType: "quotation",
      entityId: String(actor.tenantId),
      summary: `Ran quotation follow-up reminders (${result.sent} sent, ${result.queued} queued)`,
      payload: { date, ...result },
      ip: req.ip,
    });
    res.json({ ok: true, date, ...result });
  });

  /* ---------- Idempotent Legacy V1 Import ---------- */
  router.post("/quotations/import-legacy", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales", "settings"]);
    const legacyRows = await rows<{
      id: string;
      doc_no: string;
      doc_date: unknown;
      extra_date: unknown;
      party_name: string | null;
      grand_total: string | number;
      status: string;
      data: unknown;
      created_at: unknown;
      updated_at: unknown;
    }>(
      deps.db,
      `SELECT id, doc_no, doc_date, extra_date, party_name, grand_total, status, data, created_at, updated_at
       FROM document_records
       WHERE business_profile_id = :tenantId AND tool_id = 'quotationv1'
       ORDER BY created_at ASC`,
      { tenantId: actor.tenantId },
    );

    const settings = await getSettings(deps, actor.tenantId);
    const { company } = await loadQuotationConfig(deps, actor.tenantId, settings);
    let imported = 0;
    let skipped = 0;

    for (const r of legacyRows) {
      const exists = await one<{ id: string }>(
        deps.db,
        `SELECT id FROM ims_quotations WHERE tenant_id = :tenantId AND (id = :id OR quote_no = :quoteNo) LIMIT 1`,
        { tenantId: actor.tenantId, id: r.id, quoteNo: r.doc_no },
      );
      if (exists) {
        skipped += 1;
        continue;
      }
      const d = json<Record<string, unknown>>(r.data, {});
      const c = (d.customer && typeof d.customer === "object" ? (d.customer as Record<string, unknown>) : {}) as Record<string, unknown>;
      const items = Array.isArray(d.items) ? (d.items as QuoteLineInput[]) : [];
      const extraCharge = (d.extraCharge as QuoteExtraCharge | undefined) ?? { label: "", amount: "", gst: 18 };
      const gstOverride = (d.gstOverride as QuoteGstOverride | undefined) ?? { mode: "auto", cgst: null, sgst: null, igst: null };
      const totals = computeQuoteTotals({
        items,
        extraCharge,
        gstOverride,
        customerState: String(c.state ?? ""),
        companyState: company.state,
      });
      const quoteDate = isoOf(r.doc_date) || String(d.date ?? todayISO());
      const validTill = r.extra_date ? isoOf(r.extra_date) : clip(d.validTill, 10);
      const followUpDate = clip(d.followUpDate, 10);
      const token = clip(d.approvalToken, 64) ?? newApprovalToken();

      await exec(
        deps.db,
        `INSERT INTO ims_quotations (
           id, tenant_id, quote_no, revision, category, engagement, category_custom_label, status,
           quote_date, valid_until, follow_up_date, party_id,
           customer_name, customer_company, customer_city, customer_state, customer_gstin, customer_phone, customer_email, customer_address,
           subtotal, discount_total, taxable, cgst, sgst, igst, total_gst, buyback_less, round_off, grand_total,
           lines_json, extra_charge_json, gst_override_json, display_json, notes, company_snapshot_json, history_json,
           prepared_by, prepared_by_phone, prepared_by_email, created_by_user_id,
           approval_token, finance_sent, approved_by, rejected_by
         ) VALUES (
           :id, :tenantId, :quoteNo, 1, :category, :engagement, :catCustom, :status,
           :quoteDate, :validUntil, :followUpDate, :partyId,
           :cName, :cCompany, :cCity, :cState, :cGstin, :cPhone, :cEmail, :cAddress,
           :subtotal, :discountTotal, :taxable, :cgst, :sgst, :igst, :totalGst, :buybackLess, :roundOff, :grandTotal,
           :linesJson, :extraJson, :gstJson, :displayJson, :notes, :snapshotJson, :historyJson,
           :preparedBy, :preparedByPhone, :preparedByEmail, :createdByUserId,
           :approvalToken, :financeSent, :approvedBy, :rejectedBy
         )`,
        {
          id: r.id,
          tenantId: actor.tenantId,
          quoteNo: String(r.doc_no || d.quoteNo || r.id).slice(0, 64),
          category: normalizeQuoteCategory(d.category),
          engagement: normalizeQuoteEngagement(d.engagement),
          catCustom: clip(d.categoryCustomLabel, 120),
          status: normalizeQuoteStatus(r.status || d.status),
          quoteDate,
          validUntil: validTill,
          followUpDate,
          partyId: clip(d.partyId, 64),
          cName: clip(c.name || r.party_name, 200) ?? "Customer",
          cCompany: clip(c.company, 200),
          cCity: clip(c.city, 80),
          cState: clip(c.state, 80),
          cGstin: clip(c.gstin, 20)?.toUpperCase() ?? null,
          cPhone: clip(c.phone, 40),
          cEmail: clip(c.email, 180),
          cAddress: clip(c.address, 500),
          subtotal: round2(totals.subtotal),
          discountTotal: round2(totals.discountTotal),
          taxable: round2(totals.taxable),
          cgst: round2(totals.cgst),
          sgst: round2(totals.sgst),
          igst: round2(totals.igst),
          totalGst: round2(totals.totalGst),
          buybackLess: round2(totals.oldBuybackLess),
          roundOff: round2(totals.roundOff),
          grandTotal: round2(Number(r.grand_total) || totals.grand),
          linesJson: JSON.stringify(items),
          extraJson: JSON.stringify(extraCharge),
          gstJson: JSON.stringify(gstOverride),
          displayJson: JSON.stringify({
            showGstColumns: typeof d.showGstColumns === "boolean" ? d.showGstColumns : true,
            gstNote: typeof d.gstNote === "string" ? d.gstNote : undefined,
            buybackLabel: typeof d.buybackLabel === "string" ? d.buybackLabel : undefined,
          }),
          notes: clip(d.notes, 8000),
          snapshotJson: d.companySnapshot ? JSON.stringify(d.companySnapshot) : null,
          historyJson: JSON.stringify(Array.isArray(d.history) ? d.history : []),
          preparedBy: clip(d.preparedBy, 120) ?? "",
          preparedByPhone: clip(d.preparedByPhone, 40),
          preparedByEmail: clip(d.preparedByEmail, 180),
          createdByUserId: typeof d.createdByUserId === "number" ? d.createdByUserId : null,
          approvalToken: token,
          financeSent: d.financeSent ? 1 : 0,
          approvedBy: clip(d.approvedBy, 120),
          rejectedBy: clip(d.rejectedBy, 120),
        },
      );
      imported += 1;
    }

    if (imported > 0) {
      await recordEvent(deps, actor, {
        type: "quotation.import_legacy",
        entityType: "quotation",
        entityId: "bulk",
        summary: `Imported ${imported} existing Quotation V1 record${imported === 1 ? "" : "s"} into IMS`,
        payload: { imported, skipped },
        ip: req.ip,
      });
    }
    res.json({ imported, skipped });
  });

  /* ---------- Get Single + Live ATP Stock ---------- */
  router.get("/quotations/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await one<QuoteRow>(
      deps.db,
      `SELECT q.*, so.so_no, inv.invoice_no, b.doc_no AS bom_doc_no
       FROM ims_quotations q
       LEFT JOIN ims_sales_orders so ON so.tenant_id = q.tenant_id AND so.id = q.converted_so_id
       LEFT JOIN ims_invoices inv ON inv.tenant_id = q.tenant_id AND inv.id = q.converted_invoice_id
       LEFT JOIN ims_bom_docs b ON b.tenant_id = q.tenant_id AND b.id = q.converted_bom_id
       WHERE q.tenant_id = :tenantId AND q.id = :id LIMIT 1`,
      { tenantId: actor.tenantId, id: req.params.id },
    );
    if (!row) throw notFound("Quotation");

    const mapped = mapQuoteRow(row);
    const itemIds = [...new Set(mapped.items.map((i) => i.itemId).filter((x): x is string => Boolean(x)))];
    let stockByItem: Record<string, { currentStock: number; reserved: number; free: number; unit: string }> = {};
    if (itemIds.length) {
      const [itemRows, reservedMap] = await Promise.all([
        rows<{ id: string; current_stock: string; unit: string }>(
          deps.db,
          `SELECT id, current_stock, unit FROM ims_items WHERE tenant_id = :tenantId AND id IN (:ids)`,
          { tenantId: actor.tenantId, ids: itemIds },
        ),
        loadReservedQtyByItem(deps.db, actor.tenantId),
      ]);
      stockByItem = Object.fromEntries(
        itemRows.map((i) => {
          const cur = round3(money(i.current_stock));
          const reserved = reservedMap.get(i.id) ?? 0;
          return [i.id, { currentStock: cur, reserved, free: round3(Math.max(0, cur - reserved)), unit: i.unit }];
        }),
      );
    }

    res.json({ quotation: mapped, stockByItem });
  });

  /* ---------- Create / Update (Full V1 Parity) ---------- */
  router.post("/quotations", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);

    const body = (req.body?.quotation ?? req.body ?? {}) as Record<string, unknown>;
    const customer = (body.customer && typeof body.customer === "object" ? (body.customer as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (!String(body.preparedBy ?? "").trim() || !String(customer.name ?? "").trim() || !String(customer.phone ?? "").trim()) {
      throw badRequest("Prepared By, Customer Name, and Customer Phone are required");
    }

    const settings = await getSettings(deps, actor.tenantId);
    const { company } = await loadQuotationConfig(deps, actor.tenantId, settings);
    const category = normalizeQuoteCategory(body.category);
    const engagement = normalizeQuoteEngagement(body.engagement);
    const status = normalizeQuoteStatus(body.status);
    const quoteDate = clip(body.date, 10) ?? todayISO();
    const validTill = clip(body.validTill, 10) ?? (settings.quoteSettings.defaultValidityDays > 0 ? addDaysISO(quoteDate, settings.quoteSettings.defaultValidityDays) : null);
    const followUpDate = clip(body.followUpDate, 10);
    const items = Array.isArray(body.items) ? (body.items as QuoteLineInput[]) : [];
    const extraCharge = (body.extraCharge as QuoteExtraCharge | undefined) ?? { label: "", amount: "", gst: 18 };
    const gstOverride = (body.gstOverride as QuoteGstOverride | undefined) ?? { mode: "auto", cgst: null, sgst: null, igst: null };
    const totals = computeQuoteTotals({
      items,
      extraCharge,
      gstOverride,
      customerState: String(customer.state ?? ""),
      companyState: company.state,
    });
    const historyAction = String(req.body?.historyAction ?? "");

    const saved = await tx(deps.db, async (conn) => {
      const incomingId = clip(body.id, 64);
      const existing = incomingId
        ? await one<QuoteRow>(
            conn,
            `SELECT * FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
            { tenantId: actor.tenantId, id: incomingId },
          )
        : null;

      const isNew = !existing;
      const id = existing ? existing.id : incomingId || randomUUID();

      // Creator signature lock (100% V1 parity).
      let forcedSignature: { before: Record<string, string>; after: Record<string, string> } | null = null;
      if (existing) {
        const before = signatureOf({
          preparedBy: existing.prepared_by,
          preparedByPhone: existing.prepared_by_phone,
          preparedByEmail: existing.prepared_by_email,
        });
        const after = signatureOf(body);
        const decision = signatureUpdateDecision({
          before,
          after,
          userId: actor.userId,
          creatorUserId: existing.created_by_user_id,
          role: isOwner(res) ? "owner" : actor.role,
          force: req.body?.forceSignature === true,
        });
        if (decision === "locked") {
          throw forbidden(
            `The signature on ${existing.quote_no} is locked to ${before.preparedBy || "the user who saved it"}. Only the Business Owner can force an update.`,
          );
        }
        if (decision === "forced") forcedSignature = { before, after };
      }

      // Upsert customer into shared Party Registry (jbt_parties / ims_parties).
      let partyId = clip(body.partyId, 64) ?? existing?.party_id ?? null;
      try {
        const up = await upsertParty(conn, actor, {
          kind: "customer",
          name: String(customer.company || customer.name),
          contactPerson: customer.company ? String(customer.name) : null,
          mobile: clip(customer.phone, 40),
          email: clip(customer.email, 180),
          gstin: clip(customer.gstin, 20),
          address: clip(customer.address, 500),
          city: clip(customer.city, 80),
          state: clip(customer.state, 80),
        });
        partyId = up.id;
      } catch {
        /* non-fatal */
      }

      const quoteNo =
        existing?.quote_no ||
        clip(body.quoteNo, 64) ||
        (await allocateQuoteNo(conn, actor.tenantId, settings, company.quotePrefix, category, engagement, quoteDate));

      const approvalToken = existing?.approval_token || clip(body.approvalToken, 64) || newApprovalToken();
      const nowIso = new Date().toISOString();
      const history = Array.isArray(body.history) ? [...(body.history as Array<{ ts: string; event: string }>)] : [];
      if (forcedSignature) {
        history.push({
          ts: nowIso,
          event: `Signature force-updated by Business Owner: ${forcedSignature.before.preparedBy || "—"} → ${forcedSignature.after.preparedBy || "—"}`,
        });
      }

      const display: DisplayJson = {
        showGstColumns: typeof body.showGstColumns === "boolean" ? body.showGstColumns : settings.quoteSettings.defaultShowGstColumns,
        gstNote: typeof body.gstNote === "string" ? body.gstNote : undefined,
        buybackLabel: typeof body.buybackLabel === "string" ? body.buybackLabel : undefined,
      };
      const snapshot = body.companySnapshot && typeof body.companySnapshot === "object" ? body.companySnapshot : company;

      const params = {
        id,
        tenantId: actor.tenantId,
        quoteNo,
        category,
        engagement,
        catCustom: clip(body.categoryCustomLabel, 120),
        status,
        quoteDate,
        validUntil: validTill,
        followUpDate,
        partyId,
        cName: clip(customer.name, 200) ?? "Customer",
        cCompany: clip(customer.company, 200),
        cCity: clip(customer.city, 80),
        cState: clip(customer.state, 80),
        cGstin: clip(customer.gstin, 20)?.toUpperCase() ?? null,
        cPhone: clip(customer.phone, 40),
        cEmail: clip(customer.email, 180),
        cAddress: clip(customer.address, 500),
        subtotal: round2(totals.subtotal),
        discountTotal: round2(totals.discountTotal),
        taxable: round2(totals.taxable),
        cgst: round2(totals.cgst),
        sgst: round2(totals.sgst),
        igst: round2(totals.igst),
        totalGst: round2(totals.totalGst),
        buybackLess: round2(totals.oldBuybackLess),
        roundOff: round2(totals.roundOff),
        grandTotal: round2(totals.grand),
        linesJson: JSON.stringify(items),
        extraJson: JSON.stringify(extraCharge),
        gstJson: JSON.stringify(gstOverride),
        displayJson: JSON.stringify(display),
        notes: clip(body.notes, 8000),
        snapshotJson: JSON.stringify(snapshot),
        historyJson: JSON.stringify(history),
        preparedBy: clip(body.preparedBy, 120) ?? actorName(actor),
        preparedByPhone: clip(body.preparedByPhone, 40),
        preparedByEmail: clip(body.preparedByEmail, 180),
        createdByUserId: existing ? existing.created_by_user_id : actor.userId,
        approvalToken,
        financeSent: body.financeSent ? 1 : 0,
        approvedBy: clip(body.approvedBy, 120) ?? existing?.approved_by ?? null,
        rejectedBy: clip(body.rejectedBy, 120) ?? existing?.rejected_by ?? null,
      };

      if (isNew) {
        await exec(
          conn,
          `INSERT INTO ims_quotations (
             id, tenant_id, quote_no, revision, category, engagement, category_custom_label, status,
             quote_date, valid_until, follow_up_date, party_id,
             customer_name, customer_company, customer_city, customer_state, customer_gstin, customer_phone, customer_email, customer_address,
             subtotal, discount_total, taxable, cgst, sgst, igst, total_gst, buyback_less, round_off, grand_total,
             lines_json, extra_charge_json, gst_override_json, display_json, notes, company_snapshot_json, history_json,
             prepared_by, prepared_by_phone, prepared_by_email, created_by_user_id,
             approval_token, finance_sent, approved_by, rejected_by
           ) VALUES (
             :id, :tenantId, :quoteNo, 1, :category, :engagement, :catCustom, :status,
             :quoteDate, :validUntil, :followUpDate, :partyId,
             :cName, :cCompany, :cCity, :cState, :cGstin, :cPhone, :cEmail, :cAddress,
             :subtotal, :discountTotal, :taxable, :cgst, :sgst, :igst, :totalGst, :buybackLess, :roundOff, :grandTotal,
             :linesJson, :extraJson, :gstJson, :displayJson, :notes, :snapshotJson, :historyJson,
             :preparedBy, :preparedByPhone, :preparedByEmail, :createdByUserId,
             :approvalToken, :financeSent, :approvedBy, :rejectedBy
           )`,
          params,
        );
      } else {
        await exec(
          conn,
          `UPDATE ims_quotations SET
             category = :category, engagement = :engagement, category_custom_label = :catCustom, status = :status,
             quote_date = :quoteDate, valid_until = :validUntil, follow_up_date = :followUpDate, party_id = :partyId,
             customer_name = :cName, customer_company = :cCompany, customer_city = :cCity, customer_state = :cState,
             customer_gstin = :cGstin, customer_phone = :cPhone, customer_email = :cEmail, customer_address = :cAddress,
             subtotal = :subtotal, discount_total = :discountTotal, taxable = :taxable,
             cgst = :cgst, sgst = :sgst, igst = :igst, total_gst = :totalGst,
             buyback_less = :buybackLess, round_off = :roundOff, grand_total = :grandTotal,
             lines_json = :linesJson, extra_charge_json = :extraJson, gst_override_json = :gstJson, display_json = :displayJson,
             notes = :notes, company_snapshot_json = :snapshotJson, history_json = :historyJson,
             prepared_by = :preparedBy, prepared_by_phone = :preparedByPhone, prepared_by_email = :preparedByEmail,
             finance_sent = :financeSent, approved_by = :approvedBy, rejected_by = :rejectedBy
           WHERE tenant_id = :tenantId AND id = :id`,
          params,
        );
      }

      const fresh = await one<QuoteRow>(
        conn,
        `SELECT q.*, so.so_no, inv.invoice_no, b.doc_no AS bom_doc_no
         FROM ims_quotations q
         LEFT JOIN ims_sales_orders so ON so.tenant_id = q.tenant_id AND so.id = q.converted_so_id
         LEFT JOIN ims_invoices inv ON inv.tenant_id = q.tenant_id AND inv.id = q.converted_invoice_id
         LEFT JOIN ims_bom_docs b ON b.tenant_id = q.tenant_id AND b.id = q.converted_bom_id
         WHERE q.tenant_id = :tenantId AND q.id = :id LIMIT 1`,
        { tenantId: actor.tenantId, id },
      );
      return { isNew, row: fresh!, forcedSignature };
    });

    const mapped = mapQuoteRow(saved.row);
    const actionLabel = historyAction || (saved.isNew ? "create" : "update");
    await recordEvent(deps, actor, {
      type: saved.isNew ? "quotation.create" : "quotation.update",
      entityType: "quotation",
      entityId: mapped.id,
      summary: `${saved.isNew ? "Created" : "Updated"} ${mapped.quoteNo} (${mapped.customer.company || mapped.customer.name}) · ${mapped.status}`,
      payload: {
        quoteNo: mapped.quoteNo,
        customerName: mapped.customer.company || mapped.customer.name,
        typeLabel: `${mapped.category} · ${mapped.engagement}`,
        status: mapped.status,
        grand: mapped._grandTotal,
        action: actionLabel,
        preparedBy: mapped.preparedBy,
      },
      ...(status === "submitted" || status === "sent"
        ? {
            notice: {
              kind: "activity" as const,
              title: status === "submitted" ? "Quotation submitted" : "Quotation marked as sent",
              body: `${mapped.quoteNo} · ${mapped.customer.company || mapped.customer.name}`,
              path: `?m=quotations&open=${mapped.id}`,
            },
          }
        : {}),
      ip: req.ip,
    });

    if (status === "submitted" || status === "sent" || status === "approved" || status === "rejected") {
      await addAlert(
        deps.db,
        actor.tenantId,
        mapped.id,
        `${mapped.quoteNo} (${mapped.customer.company || mapped.customer.name}) marked ${status}`,
      );
    }

    res.status(saved.isNew ? 201 : 200).json({ quotation: mapped });
  });

  /* ---------- Delete ---------- */
  router.delete("/quotations/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);
    const row = await one<QuoteRow>(
      deps.db,
      `SELECT * FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
      { tenantId: actor.tenantId, id: req.params.id },
    );
    if (!row) throw notFound("Quotation");
    if ((row.converted_so_id || row.converted_invoice_id || row.converted_bom_id) && !isOwner(res)) {
      throw conflict("This quotation has already been converted to an order, invoice or BOM. Only an owner can delete it.");
    }
    await exec(deps.db, `DELETE FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: req.params.id,
    });
    await recordEvent(deps, actor, {
      type: "quotation.delete",
      entityType: "quotation",
      entityId: row.id,
      summary: `Deleted quotation ${row.quote_no}`,
      payload: { quoteNo: row.quote_no, customerName: row.customer_company || row.customer_name, status: row.status, action: "delete" },
      ip: req.ip,
    });
    res.status(204).send();
  });

  /* ---------- Revise (Create R2 / R3) ---------- */
  router.post("/quotations/:id/revise", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["quotations", "sales"]);
    const revised = await tx(deps.db, async (conn) => {
      const src = await one<QuoteRow>(
        conn,
        `SELECT * FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: req.params.id },
      );
      if (!src) throw notFound("Quotation");

      const baseNo = src.quote_no.replace(/-R\d+$/, "");
      const rootId = src.parent_quote_id || src.id;
      const maxRevRow = await one<{ max_rev: number }>(
        conn,
        `SELECT COALESCE(MAX(revision), 1) AS max_rev FROM ims_quotations WHERE tenant_id = :tenantId AND (id = :rootId OR parent_quote_id = :rootId)`,
        { tenantId: actor.tenantId, rootId },
      );
      const nextRev = Number(maxRevRow?.max_rev ?? src.revision) + 1;
      const newId = randomUUID();
      const newNo = `${baseNo}-R${nextRev}`;
      const history = [
        ...json<Array<{ ts: string; event: string }>>(src.history_json, []),
        { ts: new Date().toISOString(), event: `Created revision R${nextRev} from ${src.quote_no}` },
      ];

      await exec(
        conn,
        `INSERT INTO ims_quotations (
           id, tenant_id, quote_no, revision, parent_quote_id, category, engagement, category_custom_label, status,
           quote_date, valid_until, follow_up_date, party_id,
           customer_name, customer_company, customer_city, customer_state, customer_gstin, customer_phone, customer_email, customer_address,
           subtotal, discount_total, taxable, cgst, sgst, igst, total_gst, buyback_less, round_off, grand_total,
           lines_json, extra_charge_json, gst_override_json, display_json, notes, company_snapshot_json, history_json,
           prepared_by, prepared_by_phone, prepared_by_email, created_by_user_id, approval_token, finance_sent
         ) VALUES (
           :newId, :tenantId, :newNo, :nextRev, :rootId, :category, :engagement, :catCustom, 'draft',
           :quoteDate, :validUntil, :followUpDate, :partyId,
           :cName, :cCompany, :cCity, :cState, :cGstin, :cPhone, :cEmail, :cAddress,
           :subtotal, :discountTotal, :taxable, :cgst, :sgst, :igst, :totalGst, :buybackLess, :roundOff, :grandTotal,
           :linesJson, :extraJson, :gstJson, :displayJson, :notes, :snapshotJson, :historyJson,
           :preparedBy, :preparedByPhone, :preparedByEmail, :createdByUserId, :approvalToken, 0
         )`,
        {
          newId,
          tenantId: actor.tenantId,
          newNo,
          nextRev,
          rootId,
          category: src.category,
          engagement: src.engagement,
          catCustom: src.category_custom_label,
          quoteDate: todayISO(),
          validUntil: src.valid_until ? isoOf(src.valid_until) : null,
          followUpDate: src.follow_up_date ? isoOf(src.follow_up_date) : null,
          partyId: src.party_id,
          cName: src.customer_name,
          cCompany: src.customer_company,
          cCity: src.customer_city,
          cState: src.customer_state,
          cGstin: src.customer_gstin,
          cPhone: src.customer_phone,
          cEmail: src.customer_email,
          cAddress: src.customer_address,
          subtotal: src.subtotal,
          discountTotal: src.discount_total,
          taxable: src.taxable,
          cgst: src.cgst,
          sgst: src.sgst,
          igst: src.igst,
          totalGst: src.total_gst,
          buybackLess: src.buyback_less,
          roundOff: src.round_off,
          grandTotal: src.grand_total,
          linesJson: typeof src.lines_json === "string" ? src.lines_json : JSON.stringify(src.lines_json),
          extraJson: src.extra_charge_json ? (typeof src.extra_charge_json === "string" ? src.extra_charge_json : JSON.stringify(src.extra_charge_json)) : null,
          gstJson: src.gst_override_json ? (typeof src.gst_override_json === "string" ? src.gst_override_json : JSON.stringify(src.gst_override_json)) : null,
          displayJson: src.display_json ? (typeof src.display_json === "string" ? src.display_json : JSON.stringify(src.display_json)) : null,
          notes: src.notes,
          snapshotJson: src.company_snapshot_json ? (typeof src.company_snapshot_json === "string" ? src.company_snapshot_json : JSON.stringify(src.company_snapshot_json)) : null,
          historyJson: JSON.stringify(history),
          preparedBy: src.prepared_by,
          preparedByPhone: src.prepared_by_phone,
          preparedByEmail: src.prepared_by_email,
          createdByUserId: actor.userId,
          approvalToken: newApprovalToken(),
        },
      );

      return (await one<QuoteRow>(conn, `SELECT * FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, {
        tenantId: actor.tenantId,
        id: newId,
      }))!;
    });

    const mapped = mapQuoteRow(revised);
    await recordEvent(deps, actor, {
      type: "quotation.revise",
      entityType: "quotation",
      entityId: mapped.id,
      summary: `Created revision ${mapped.quoteNo}`,
      payload: { quoteNo: mapped.quoteNo, customerName: mapped.customer.company || mapped.customer.name, status: "draft", action: "revise" },
      ip: req.ip,
    });
    res.status(201).json({ quotation: mapped });
  });

  /* ---------- 1-Click Convert → Sales Order / Invoice / Proforma / BOM ---------- */
  router.post("/quotations/:id/convert", async (req, res) => {
    const actor = actorOf(res);
    const { target } = parse(ConvertSchema, req.body);
    if (target === "bom") requirePerm(res, "bom");
    else requirePerm(res, "sales");

    const settings = await getSettings(deps, actor.tenantId);

    const out = await tx(deps.db, async (conn) => {
      const q = await one<QuoteRow>(
        conn,
        `SELECT * FROM ims_quotations WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: req.params.id },
      );
      if (!q) throw notFound("Quotation");

      const items = json<QuoteLineInput[]>(q.lines_json, []).filter((it) => String(it.desc ?? "").trim() || Number(it.rate) !== 0);
      const extraCharge = json<QuoteExtraCharge | null>(q.extra_charge_json, null);
      if (!items.length) throw badRequest("This quotation has no line items to convert");

      // Match catalog items by itemId, SKU, or normalized name.
      const catalog = await rows<{ id: string; name: string; sku: string | null; hsn: string | null; unit: string; gst_rate: string }>(
        conn,
        `SELECT id, name, sku, hsn, unit, gst_rate FROM ims_items WHERE tenant_id = :tenantId AND active = 1 LIMIT 20000`,
        { tenantId: actor.tenantId },
      );
      const byId = new Map(catalog.map((i) => [i.id, i]));
      const bySku = new Map(catalog.filter((i) => i.sku).map((i) => [i.sku!.trim().toLowerCase(), i]));
      const byName = new Map(catalog.map((i) => [nameKey(i.name), i]));

      const imsLines: ImsLineInput[] = items
        .filter((it) => (Number(it.qty) || 0) * (Number(it.rate) || 0) >= 0)
        .map((it) => {
          const match =
            (it.itemId ? byId.get(it.itemId) : undefined) ??
            (it.sku ? bySku.get(it.sku.trim().toLowerCase()) : undefined) ??
            byName.get(nameKey(it.desc));
          return {
            itemId: match?.id ?? null,
            name: String(it.desc || match?.name || "Item").slice(0, 200),
            sku: match?.sku ?? it.sku ?? null,
            hsn: it.hsn || match?.hsn || null,
            unit: it.unit || match?.unit || "nos",
            qty: Math.max(0.001, Number(it.qty) || 1),
            rate: Math.max(0, Number(it.rate) || 0),
            discountPct: Math.max(0, Number(it.discount) || 0),
            gstRate: Number.isFinite(Number(it.gst)) ? Number(it.gst) : Number(match?.gst_rate ?? settings.defaultGstRate),
          };
        });
      if (extraCharge && Number(extraCharge.amount) > 0) {
        imsLines.push({
          itemId: null,
          name: extraCharge.label || "Additional charges",
          sku: null,
          hsn: null,
          unit: "nos",
          qty: 1,
          rate: Number(extraCharge.amount),
          discountPct: 0,
          gstRate: Number(extraCharge.gst) || 0,
        });
      }

      // Ensure customer party exists.
      let partyId = q.party_id;
      const partyName = q.customer_company || q.customer_name || "Customer";
      if (!partyId) {
        const up = await upsertParty(conn, actor, {
          kind: "customer",
          name: partyName,
          contactPerson: q.customer_company ? q.customer_name : null,
          mobile: q.customer_phone,
          email: q.customer_email,
          gstin: q.customer_gstin,
          address: q.customer_address,
          city: q.customer_city,
          state: q.customer_state,
        });
        partyId = up.id;
      }

      const fullAddress = [q.customer_address, q.customer_city, q.customer_state].filter(Boolean).join(", ") || null;
      const intraState = isIntraState(settings.state, q.customer_state || settings.state);
      const today = todayISO();

      if (target === "sales_order") {
        if (q.converted_so_id) {
          const existingSo = await one<{ id: string; so_no: string }>(
            conn,
            `SELECT id, so_no FROM ims_sales_orders WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
            { tenantId: actor.tenantId, id: q.converted_so_id },
          );
          if (existingSo) return { target, id: existingSo.id, docNo: existingSo.so_no, alreadyExisted: true };
        }
        const totals = computeTotals(imsLines, intraState);
        const soId = randomUUID();
        const soNo = await nextDocNo(conn, actor.tenantId, "sales_order", settings.soPrefix || "SO", today, settings.businessName);
        await exec(
          conn,
          `INSERT INTO ims_sales_orders (
             id, tenant_id, so_no, status, customer_id, customer_name, customer_gstin, customer_email, customer_mobile,
             bill_to_address, ship_to_address, customer_po_ref, quotation_id, order_date, delivery_date, currency_code,
             \`lines\`, subtotal, tax_total, grand_total, notes, terms, created_by, created_by_name
           ) VALUES (
             :id, :tenantId, :soNo, 'draft', :customerId, :customerName, :gstin, :email, :mobile,
             :addr, :addr, :poRef, :quotationId, :orderDate, :deliveryDate, :currency,
             :lines, :subtotal, :taxTotal, :grandTotal, :notes, :terms, :userId, :userName
           )`,
          {
            id: soId,
            tenantId: actor.tenantId,
            soNo,
            customerId: partyId,
            customerName: partyName.slice(0, 200),
            gstin: q.customer_gstin,
            email: q.customer_email,
            mobile: q.customer_phone,
            addr: fullAddress,
            poRef: q.quote_no,
            quotationId: q.id,
            orderDate: today,
            deliveryDate: q.valid_until ? isoOf(q.valid_until) : addDaysISO(today, 15),
            currency: settings.baseCurrency || "INR",
            lines: JSON.stringify(totals.lines),
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            grandTotal: totals.grandTotal,
            notes: `From Quotation ${q.quote_no}`,
            terms: q.notes || settings.terms,
            userId: actor.userId,
            userName: actorName(actor),
          },
        );
        await exec(
          conn,
          `UPDATE ims_quotations SET converted_so_id = :soId, party_id = :partyId WHERE tenant_id = :tenantId AND id = :id`,
          { soId, partyId, tenantId: actor.tenantId, id: q.id },
        );
        return { target, id: soId, docNo: soNo, alreadyExisted: false };
      }

      if (target === "invoice" || target === "proforma") {
        if (q.converted_invoice_id) {
          const existingInv = await one<{ id: string; invoice_no: string }>(
            conn,
            `SELECT id, invoice_no FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
            { tenantId: actor.tenantId, id: q.converted_invoice_id },
          );
          if (existingInv) return { target, id: existingInv.id, docNo: existingInv.invoice_no, alreadyExisted: true };
        }
        const totals = computeTotals(imsLines, intraState);
        const invId = randomUUID();
        const invNo = draftInvoiceNo(invId);
        await insertImsInvoice(conn, actor, {
          id: invId,
          status: "draft",
          invoiceNo: invNo,
          customerId: partyId,
          customerName: partyName,
          customerGstin: q.customer_gstin,
          customerAddress: fullAddress,
          customerMobile: q.customer_phone,
          placeOfSupply: q.customer_state || settings.state || null,
          intraState,
          invoiceDate: today,
          dueDate: addDaysISO(today, settings.paymentTermsDays),
          totals,
          amountPaid: 0,
          payMode: null,
          stockPosted: false,
          sourceTool: "ims_quotation",
          sourceRef: q.id,
          notes: `From Quotation ${q.quote_no}`,
          terms: q.notes || settings.terms,
        });
        await exec(
          conn,
          `UPDATE ims_invoices SET doc_kind = :kind, quotation_id = :quotationId WHERE tenant_id = :tenantId AND id = :id`,
          { kind: target === "proforma" ? "proforma" : "tax_invoice", quotationId: q.id, tenantId: actor.tenantId, id: invId },
        );
        await exec(
          conn,
          `UPDATE ims_quotations SET converted_invoice_id = :invId, party_id = :partyId WHERE tenant_id = :tenantId AND id = :id`,
          { invId, partyId, tenantId: actor.tenantId, id: q.id },
        );
        return { target, id: invId, docNo: invNo, alreadyExisted: false };
      }

      // target === "bom"
      if (q.converted_bom_id) {
        const existingBom = await one<{ id: string; doc_no: string }>(
          conn,
          `SELECT id, doc_no FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
          { tenantId: actor.tenantId, id: q.converted_bom_id },
        );
        if (existingBom) return { target, id: existingBom.id, docNo: existingBom.doc_no, alreadyExisted: true };
      }
      const bomId = randomUUID();
      const bomNo = await nextDocNo(conn, actor.tenantId, "bom", settings.bomPrefix || "BOM", today, settings.businessName);
      const materialsTotal = round2(imsLines.reduce((s, l) => s + l.qty * l.rate, 0));
      const taxPct = Number(settings.defaultGstRate || 18);
      const taxAmount = round2((materialsTotal * taxPct) / 100);
      const grandTotal = round2(materialsTotal + taxAmount);

      await exec(
        conn,
        `INSERT INTO ims_bom_docs (
           id, tenant_id, doc_no, status, doc_date, title, customer_name, location, quotation_ref, party_id,
           margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total, notes, prepared_by, created_by_name
         ) VALUES (
           :id, :tenantId, :docNo, 'draft', :docDate, :title, :customerName, :location, :quoteNo, :partyId,
           0, :taxPct, :materialsTotal, 0, :taxAmount, :grandTotal, :notes, :preparedBy, :createdByName
         )`,
        {
          id: bomId,
          tenantId: actor.tenantId,
          docNo: bomNo,
          docDate: today,
          title: `BOM for ${q.quote_no}`.slice(0, 200),
          customerName: partyName.slice(0, 200),
          location: [q.customer_city, q.customer_state].filter(Boolean).join(", ") || null,
          quoteNo: q.quote_no,
          partyId,
          taxPct,
          materialsTotal,
          taxAmount,
          grandTotal,
          notes: q.notes,
          preparedBy: q.prepared_by || actorName(actor),
          createdByName: actorName(actor),
        },
      );

      let sortNo = 1;
      for (const l of imsLines) {
        await exec(
          conn,
          `INSERT INTO ims_bom_doc_lines (
             id, tenant_id, doc_id, section, sort_no, line_kind, item_id, description, qty, unit, scale_by_capacity, rate, amount
           ) VALUES (
             :id, :tenantId, :docId, 'Main Items', :sortNo, :lineKind, :itemId, :desc, :qty, :unit, 0, :rate, :amount
           )`,
          {
            id: randomUUID(),
            tenantId: actor.tenantId,
            docId: bomId,
            sortNo: sortNo++,
            lineKind: l.itemId ? "stock" : "service",
            itemId: l.itemId ?? null,
            desc: l.name,
            qty: round3(l.qty),
            unit: l.unit || "nos",
            rate: round2(l.rate),
            amount: round2(l.qty * l.rate),
          },
        );
      }

      await exec(
        conn,
        `UPDATE ims_quotations SET converted_bom_id = :bomId, party_id = :partyId WHERE tenant_id = :tenantId AND id = :id`,
        { bomId, partyId, tenantId: actor.tenantId, id: q.id },
      );
      return { target, id: bomId, docNo: bomNo, alreadyExisted: false };
    });

    if (!out.alreadyExisted) {
      await recordEvent(deps, actor, {
        type: `quotation.convert.${out.target}`,
        entityType: "quotation",
        entityId: req.params.id,
        summary: `Converted quotation to ${out.target.replace("_", " ")} ${out.docNo}`,
        payload: { target: out.target, targetId: out.id, docNo: out.docNo },
        ip: req.ip,
      });
    }
    res.json(out);
  });
}
