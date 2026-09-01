import { Router } from "express";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { jsonVal } from "../lib/admin/approvals.js";
import { newDocumentId } from "../lib/documents.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId } from "../lib/request-context.js";
import { LimitReachedError, runCreateWithLimit } from "../lib/usage-limits.js";
import {
  getWhatsAppDeliveryConfig,
  normalizeWaPhone,
  postWhatsAppWebhook,
  sendWhatsAppCloudDocuments,
} from "../lib/whatsapp-cloud.js";
import { requireWriteAccess } from "../middleware/require-write.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";
import { notifyDocumentOutbound } from "../lib/notification-billing.js";
import { withFileAccessToken } from "../lib/storage.js";

const TOOL_ID = "quotationv1";
const COMPANY_KEY = "quotation_v1_company";
const HISTORY_KEY = "quotation_v1_history";
const NOTIF_KEY = "quotation_v1_notifications";
const COUNTER_KEY = "quotation_v1_counters";

const router = Router();

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  void requireWriteAccess(req, res, next);
});

type QuoteBody = Record<string, unknown>;

function parseData(data: unknown): QuoteBody {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as QuoteBody;
    } catch {
      return {};
    }
  }
  return (data as QuoteBody) ?? {};
}

async function getConfig(key: string): Promise<unknown> {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT value FROM platform_config WHERE config_key = :key LIMIT 1`,
    { key: `${key}:${orgId}` },
  );
  const row = Array.isArray(rows) ? (rows[0] as { value: unknown } | undefined) : undefined;
  if (!row) return null;
  return typeof row.value === "string" ? JSON.parse(row.value) : jsonVal(row.value) ?? row.value;
}

async function setConfig(key: string, value: unknown): Promise<void> {
  const orgId = getActiveOrgId();
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value = :value`,
    { key: `${key}:${orgId}`, value: JSON.stringify(value) },
  );
}

function mapRow(row: Record<string, unknown>) {
  const data = parseData(row.data);
  return {
    ...data,
    id: String(row.id),
    quoteNo: row.doc_no ? String(row.doc_no) : (data.quoteNo as string | null) ?? null,
    date: row.doc_date ? String(row.doc_date) : data.date,
    validTill: row.extra_date ? String(row.extra_date) : data.validTill,
    status: String(row.status ?? data.status ?? "draft"),
    createdAt: String(row.created_at ?? data.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    _grandTotal: Number(row.grand_total ?? 0),
  };
}

async function loadActiveBusinessBrand(): Promise<{
  businessName: string;
  logo: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
} | null> {
  const [rows] = await pool.query(
    `SELECT business_name, logo_data_url, address_line1, address_line2, state, gstin, phone, email
     FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: getActiveProfileId() },
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
  if (!row) return null;
  return {
    businessName: row.business_name,
    logo: withFileAccessToken(row.logo_data_url),
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    state: row.state,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
  };
}

function mergeCompanyWithBusinessBrand(
  stored: Record<string, unknown> | null,
  brand: Awaited<ReturnType<typeof loadActiveBusinessBrand>>,
): Record<string, unknown> {
  const storedObj = stored && typeof stored === "object" ? { ...stored } : {};
  delete (storedObj as { send?: unknown }).send;
  const company: Record<string, unknown> = {
    name: "Your Company",
    logo: null,
    tagline: "Quotations · Service · Sales",
    address: "",
    state: "Karnataka",
    gstin: "",
    landline: "",
    phone: "",
    email: "",
    salesEmail: "",
    managerEmail: "",
    website: "",
    quotePrefix: "QT",
    place: "Bengaluru",
    ...storedObj,
  };
  if (!brand) return company;

  const name = String(brand.businessName ?? "").trim();
  const addressFromProfile = [brand.addressLine1, brand.addressLine2]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const storedAddress = String(company.address ?? "").trim();
  const storedGstin = String(company.gstin ?? "").trim();
  const storedPhone = String(company.phone ?? "").trim();
  const storedEmail = String(company.email ?? "").trim();
  const storedState = String(company.state ?? "").trim();
  const storedPrefix = String(company.quotePrefix ?? "").trim();
  const prefixFromName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

  return {
    ...company,
    name: name || company.name,
    logo: brand.logo || company.logo || null,
    address: storedAddress || addressFromProfile || company.address,
    state: storedState && storedState !== "Karnataka" ? storedState : brand.state || company.state,
    gstin: storedGstin || brand.gstin || company.gstin,
    phone: storedPhone || brand.phone || company.phone,
    email: storedEmail || brand.email || company.email,
    quotePrefix:
      storedPrefix && storedPrefix !== "QT" ? storedPrefix : prefixFromName || company.quotePrefix,
  };
}

router.get("/company", async (_req, res) => {
  const stored = ((await getConfig(COMPANY_KEY)) as Record<string, unknown> | null) ?? null;
  const brand = await loadActiveBusinessBrand();
  res.json({ company: mergeCompanyWithBusinessBrand(stored, brand) });
});

router.put("/company", async (req, res) => {
  const body = req.body?.company ?? req.body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "company object required" });
    return;
  }
  const brand = await loadActiveBusinessBrand();
  const incoming = { ...(body as Record<string, unknown>) };
  delete incoming.send;
  const company = mergeCompanyWithBusinessBrand(incoming, brand);
  await setConfig(COMPANY_KEY, company);
  res.json({ company });
});

router.post("/send/email", async (req, res) => {
  const to = String(req.body?.to ?? "").trim();
  const cc = String(req.body?.cc ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.message ?? req.body?.body ?? "").trim();
  if (!to) {
    res.status(400).json({ error: "Email To is required" });
    return;
  }
  if (!subject || !body) {
    res.status(400).json({ error: "Subject and message are required" });
    return;
  }
  const webhook = process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL;
  try {
    if (webhook) {
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "email",
          to,
          cc: cc || undefined,
          subject,
          body,
          kind: "quotationv1.send",
          quotationId: req.body?.quotationId ?? null,
          quoteNo: req.body?.quoteNo ?? null,
          pdfBase64: req.body?.pdfBase64 ?? null,
          filename: req.body?.filename ?? null,
        }),
      });
      if (!r.ok) {
        throw new Error(`Email webhook ${r.status}: ${(await r.text()).slice(0, 180)}`);
      }
    } else {
      console.log(`[quotation-v1:email] via=mailto-fallback to=${to} cc=${cc} subject=${subject}`);
    }
    await logAudit(
      "quotationv1.send.email",
      "document",
      String(req.body?.quotationId ?? ""),
      { quoteNo: req.body?.quoteNo, to, cc, via: webhook ? "webhook" : "mailto" },
      req.ip,
    );
    notifyDocumentOutbound({
      channel: "email",
      title: "Quotation emailed",
      body: `${req.body?.quoteNo ?? "Quotation"} sent to ${to}${cc ? ` (cc ${cc})` : ""}.`,
      entityType: "document",
      entityId: String(req.body?.quotationId ?? ""),
      href: "/tools/quotationv1",
    });
    res.json({
      ok: true,
      delivered: Boolean(webhook),
      via: webhook ? "webhook" : "mailto",
      hint: webhook
        ? undefined
        : "No EMAIL_WEBHOOK_URL — client should open mailto and attach the downloaded PDF.",
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Email send failed" });
  }
});

router.get("/send/email/status", (_req, res) => {
  const webhook = Boolean(
    (process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL ?? "").trim(),
  );
  res.json({ webhookConfigured: webhook });
});

router.get("/send/whatsapp/status", (_req, res) => {
  res.json(getWhatsAppDeliveryConfig());
});

router.post("/send/whatsapp", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  const filename = String(req.body?.filename ?? "quotation.pdf").trim() || "quotation.pdf";
  const pdfBase64 = String(req.body?.pdfBase64 ?? "").trim();
  const phonesRaw = Array.isArray(req.body?.phones) ? (req.body.phones as unknown[]) : [];
  const phones: string[] = [
    ...new Set(
      phonesRaw
        .map((p) => normalizeWaPhone(String(p ?? "")))
        .filter((p): p is string => p.length >= 10),
    ),
  ];

  if (!phones.length) {
    res.status(400).json({ error: "At least one WhatsApp number is required" });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "WhatsApp message is required" });
    return;
  }
  if (!pdfBase64) {
    res.status(400).json({ error: "PDF attachment is required" });
    return;
  }

  const cfg = getWhatsAppDeliveryConfig();
  if (!cfg.canAutoAttach) {
    res.json({
      ok: true,
      delivered: false,
      via: "manual",
      hint:
        "Configure WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID (Cloud API) or WHATSAPP_WEBHOOK_URL for automatic PDF delivery. Browser WhatsApp links cannot attach files.",
    });
    return;
  }

  try {
    if (cfg.cloudConfigured) {
      const result = await sendWhatsAppCloudDocuments({
        phones,
        message,
        filename,
        pdfBase64,
      });
      if (!result.sent.length) {
        const first = result.errors[0]?.error ?? "WhatsApp Cloud API send failed";
        res.status(502).json({ error: first, errors: result.errors });
        return;
      }
      await logAudit(
        "quotationv1.send.whatsapp",
        "document",
        String(req.body?.quotationId ?? ""),
        {
          quoteNo: req.body?.quoteNo,
          phones: result.sent,
          errors: result.errors,
          via: "cloud",
        },
        req.ip,
      );
      notifyDocumentOutbound({
        channel: "whatsapp",
        title: "Quotation sent on WhatsApp",
        body: `${req.body?.quoteNo ?? "Quotation"} delivered to ${result.sent.join(", ")}.`,
        entityType: "document",
        entityId: String(req.body?.quotationId ?? ""),
        href: "/tools/quotationv1",
      });
      res.json({
        ok: true,
        delivered: true,
        via: "cloud",
        sent: result.sent,
        errors: result.errors,
      });
      return;
    }

    await postWhatsAppWebhook({
      channel: "whatsapp",
      phones,
      message,
      kind: "quotationv1.send",
      quotationId: req.body?.quotationId ?? null,
      quoteNo: req.body?.quoteNo ?? null,
      pdfBase64,
      filename,
    });
    await logAudit(
      "quotationv1.send.whatsapp",
      "document",
      String(req.body?.quotationId ?? ""),
      { quoteNo: req.body?.quoteNo, phones, via: "webhook" },
      req.ip,
    );
    notifyDocumentOutbound({
      channel: "whatsapp",
      title: "Quotation sent on WhatsApp",
      body: `${req.body?.quoteNo ?? "Quotation"} queued for ${phones.join(", ")}.`,
      entityType: "document",
      entityId: String(req.body?.quotationId ?? ""),
      href: "/tools/quotationv1",
    });
    res.json({ ok: true, delivered: true, via: "webhook", sent: phones, errors: [] });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "WhatsApp send failed" });
  }
});

router.get("/history", async (_req, res) => {
  const list = ((await getConfig(HISTORY_KEY)) as unknown[]) ?? [];
  res.json({ history: Array.isArray(list) ? list : [] });
});

router.get("/notifications", async (_req, res) => {
  const list = ((await getConfig(NOTIF_KEY)) as unknown[]) ?? [];
  res.json({ notifications: Array.isArray(list) ? list : [] });
});

router.post("/notifications/:id/read", async (req, res) => {
  const list = (((await getConfig(NOTIF_KEY)) as Array<Record<string, unknown>>) ?? []).slice();
  const id = req.params.id;
  for (const n of list) {
    if (String(n.id) === id) n.read = true;
  }
  await setConfig(NOTIF_KEY, list);
  res.json({ ok: true });
});

router.get("/", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, tool_id, doc_no, doc_date, extra_date, party_name, grand_total, status, data, created_at, updated_at
     FROM document_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     ORDER BY updated_at DESC`,
    { profileId: getActiveProfileId(), toolId: TOOL_ID },
  );
  const quotations = (Array.isArray(rows) ? rows : []).map((r) => mapRow(r as Record<string, unknown>));
  res.json({ quotations });
});

router.get("/:id", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM document_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id: req.params.id, profileId: getActiveProfileId(), toolId: TOOL_ID },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  res.json({ quotation: mapRow(row as Record<string, unknown>) });
});

async function nextQuoteNo(q: QuoteBody, prefix: string): Promise<string> {
  const category = String(q.category ?? "other");
  const engagement = String(q.engagement ?? "misc");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const key = `${category}-${engagement}-${yyyy}-${mm}`;
  const counters = ((await getConfig(COUNTER_KEY)) as Record<string, number>) ?? {};
  counters[key] = (counters[key] || 0) + 1;
  await setConfig(COUNTER_KEY, counters);
  const seq = String(counters[key]).padStart(4, "0");
  const catCode = String(q._catCode ?? category.slice(0, 3).toUpperCase()).slice(0, 6);
  const engCode = String(q._engCode ?? engagement.slice(0, 3).toUpperCase()).slice(0, 6);
  const p = (prefix || "QT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "QT";
  return `${p}-${catCode}/${engCode}-${yyyy}/${mm}-${seq}`;
}

router.post("/", async (req, res) => {
  const body = (req.body?.quotation ?? req.body ?? {}) as QuoteBody;
  const company = ((await getConfig(COMPANY_KEY)) as { quotePrefix?: string } | null) ?? {};
  let quoteNo = body.quoteNo ? String(body.quoteNo) : "";
  const isNew = !quoteNo;
  if (isNew) {
    quoteNo = await nextQuoteNo(body, company.quotePrefix ?? "QT");
  }

  const id = String(body.id ?? newDocumentId(TOOL_ID));
  const customer = (body.customer as { name?: string; phone?: string }) ?? {};
  if (!String(body.preparedBy ?? "").trim() || !String(customer.name ?? "").trim() || !String(customer.phone ?? "").trim()) {
    res.status(400).json({ error: "Prepared By, Customer Name, and Customer Phone are required" });
    return;
  }

  const grandTotal = Number(req.body?.grandTotal ?? body.grandTotal ?? 0);
  const status = String(body.status ?? "draft");
  const docDate = String(body.date ?? new Date().toISOString().slice(0, 10));
  const extraDate = body.validTill ? String(body.validTill) : null;
  const payload = { ...body, id, quoteNo, status, updatedAt: new Date().toISOString() };

  try {
    if (isNew) {
      const quotation = await runCreateWithLimit(TOOL_ID, "document", async (conn) => {
        await conn.query(
          `INSERT INTO document_records
           (id, business_profile_id, tool_id, doc_no, doc_date, extra_date, party_name, grand_total, status, data)
           VALUES (:id, :profileId, :toolId, :docNo, :docDate, :extraDate, :partyName, :grandTotal, :status, :data)`,
          {
            id,
            profileId: getActiveProfileId(),
            toolId: TOOL_ID,
            docNo: quoteNo,
            docDate,
            extraDate,
            partyName: customer.name ?? null,
            grandTotal,
            status,
            data: JSON.stringify(payload),
          },
        );
        const [rows] = await conn.query(`SELECT * FROM document_records WHERE id = :id`, { id });
        return mapRow((Array.isArray(rows) ? rows[0] : {}) as Record<string, unknown>);
      });

      await appendHistory(payload, grandTotal);
      await logAudit("quotationv1.create", "document", id, { quoteNo }, req.ip);
      if (status === "submitted") {
        publishNotificationAsync({
          eventType: "document.quotation_submitted",
          title: "Quotation submitted",
          body: `${quoteNo} · ${customer.name ?? "Customer"} — copy queued for company document delivery.`,
          href: "/tools/quotationv1",
          entityType: "document",
          entityId: id,
          dedupeKey: `quote-submitted:${id}`,
          meta: { quoteNo, status },
          expiresInHours: 168,
        });
      }
      if (status === "sent") {
        publishNotificationAsync({
          eventType: "document.quotation_sent",
          title: "Quotation marked as sent",
          body: `${quoteNo} · ${customer.name ?? "Customer"} is awaiting a decision.`,
          href: "/tools/quotationv1",
          entityType: "document",
          entityId: id,
          dedupeKey: `quote-sent:${id}`,
          meta: { quoteNo, status },
          expiresInHours: 336,
        });
      }
      res.status(201).json({ quotation });
      return;
    }

    const [upd] = await pool.query(
      `UPDATE document_records SET
         doc_no = :docNo, doc_date = :docDate, extra_date = :extraDate,
         party_name = :partyName, grand_total = :grandTotal, status = :status, data = :data
       WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
      {
        id,
        profileId: getActiveProfileId(),
        toolId: TOOL_ID,
        docNo: quoteNo,
        docDate,
        extraDate,
        partyName: customer.name ?? null,
        grandTotal,
        status,
        data: JSON.stringify(payload),
      },
    );
    if (Number((upd as { affectedRows?: number }).affectedRows ?? 0) < 1) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    await appendHistory(payload, grandTotal);
    await logAudit("quotationv1.update", "document", id, { quoteNo }, req.ip);
    if (status === "submitted") {
      publishNotificationAsync({
        eventType: "document.quotation_submitted",
        title: "Quotation submitted",
        body: `${quoteNo} · ${customer.name ?? "Customer"} — copy queued for company document delivery.`,
        href: "/tools/quotationv1",
        entityType: "document",
        entityId: id,
        dedupeKey: `quote-submitted:${id}`,
        meta: { quoteNo, status },
        expiresInHours: 168,
      });
    }
    if (status === "sent") {
      publishNotificationAsync({
        eventType: "document.quotation_sent",
        title: "Quotation marked as sent",
        body: `${quoteNo} · ${customer.name ?? "Customer"} is awaiting a decision.`,
        href: "/tools/quotationv1",
        entityType: "document",
        entityId: id,
        dedupeKey: `quote-sent:${id}`,
        meta: { quoteNo, status },
        expiresInHours: 336,
      });
    }
    const [rows] = await pool.query(
      `SELECT * FROM document_records
       WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
      { id, profileId: getActiveProfileId(), toolId: TOOL_ID },
    );
    res.json({ quotation: mapRow((Array.isArray(rows) ? rows[0] : {}) as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof LimitReachedError) {
      res.status(403).json({ error: "FREE_LIMIT_REACHED", limit: err.limit });
      return;
    }
    throw err;
  }
});

async function appendHistory(q: QuoteBody, grand: number) {
  const history = (((await getConfig(HISTORY_KEY)) as unknown[]) ?? []).slice();
  history.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    quotationId: q.id,
    quoteNo: q.quoteNo,
    customerName: (q.customer as { name?: string })?.name ?? "",
    typeLabel: `${q.category} — ${q.engagement}`,
    status: q.status,
    grand,
    savedAt: new Date().toISOString(),
    userId: getActiveUserId(),
  });
  await setConfig(HISTORY_KEY, history.slice(0, 500));
}

router.delete("/:id", async (req, res) => {
  await pool.query(
    `DELETE FROM document_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id: req.params.id, profileId: getActiveProfileId(), toolId: TOOL_ID },
  );
  await logAudit("quotationv1.delete", "document", req.params.id, {}, req.ip);
  res.status(204).send();
});

router.post("/notifications", async (req, res) => {
  const list = (((await getConfig(NOTIF_KEY)) as unknown[]) ?? []).slice();
  const message = String(req.body?.message ?? "");
  const quotationId = String(req.body?.quotationId ?? "");
  const n = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    quotationId,
    message,
    read: false,
    createdAt: new Date().toISOString(),
  };
  list.unshift(n);
  await setConfig(NOTIF_KEY, list.slice(0, 200));

  const lower = message.toLowerCase();
  let eventType: "document.quotation_sent" | "document.quotation_approved" | "document.quotation_rejected" =
    "document.quotation_sent";
  if (lower.includes("approv")) eventType = "document.quotation_approved";
  else if (lower.includes("reject")) eventType = "document.quotation_rejected";

  publishNotificationAsync({
    eventType,
    title: eventType === "document.quotation_sent" ? "Quotation activity" : "Quotation status update",
    body: message || "Quotation notification",
    href: "/tools/quotationv1",
    entityType: "document",
    entityId: quotationId || null,
    dedupeKey: `qgv1:${n.id}`,
    expiresInHours: 168,
  });

  res.status(201).json({ notification: n });
});

export default router;
