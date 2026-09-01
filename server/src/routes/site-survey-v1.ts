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

const TOOL_ID = "sitesurveyv1";
const COMPANY_KEY = "site_survey_v1_company";
const HISTORY_KEY = "site_survey_v1_history";
const COUNTER_KEY = "site_survey_v1_counters";

const router = Router();

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  void requireWriteAccess(req, res, next);
});

type SurveyBody = Record<string, unknown>;

function parseData(data: unknown): SurveyBody {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as SurveyBody;
    } catch {
      return {};
    }
  }
  return (data as SurveyBody) ?? {};
}

function fieldVal(values: unknown, key: string): string {
  const obj = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  const v = obj[key];
  if (Array.isArray(v)) return String(v[0] ?? "").trim();
  return String(v ?? "").trim();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

function mapRow(row: Record<string, unknown>, opts?: { stripPhotos?: boolean }) {
  const data = parseData(row.data);
  const mapped: SurveyBody = {
    ...data,
    id: String(row.id),
    reportNo: row.doc_no ? String(row.doc_no) : (data.reportNo as string | null) ?? null,
    status: String(row.status ?? data.status ?? "draft"),
    createdAt: String(row.created_at ?? data.createdAt ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    _estimatedCost: Number(row.grand_total ?? 0),
  };
  if (opts?.stripPhotos) {
    mapped.photos = {};
  }
  return mapped;
}

async function loadActiveBusinessBrand(): Promise<{
  businessName: string;
  logo: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  phone: string | null;
  email: string | null;
} | null> {
  const [rows] = await pool.query(
    `SELECT business_name, logo_data_url, address_line1, address_line2, phone, email
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
    tagline: "Solar Site Survey",
    address: "",
    phone: "",
    email: "",
    website: "",
    reportPrefix: "ZSS",
    ...storedObj,
  };
  if (!brand) return company;

  const name = String(brand.businessName ?? "").trim();
  const addressFromProfile = [brand.addressLine1, brand.addressLine2]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const storedAddress = String(company.address ?? "").trim();
  const storedPhone = String(company.phone ?? "").trim();
  const storedEmail = String(company.email ?? "").trim();
  const storedPrefix = String(company.reportPrefix ?? "").trim();
  const prefixFromName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

  return {
    ...company,
    name: name || company.name,
    logo: brand.logo || company.logo || null,
    address: storedAddress || addressFromProfile || company.address,
    phone: storedPhone || brand.phone || company.phone,
    email: storedEmail || brand.email || company.email,
    reportPrefix:
      storedPrefix && storedPrefix !== "ZSS" ? storedPrefix : prefixFromName || company.reportPrefix,
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
          kind: "sitesurveyv1.send",
          surveyId: req.body?.surveyId ?? null,
          reportNo: req.body?.reportNo ?? null,
          pdfBase64: req.body?.pdfBase64 ?? null,
          filename: req.body?.filename ?? null,
        }),
      });
      if (!r.ok) {
        throw new Error(`Email webhook ${r.status}: ${(await r.text()).slice(0, 180)}`);
      }
    } else {
      console.log(`[site-survey-v1:email] via=mailto-fallback to=${to} cc=${cc} subject=${subject}`);
    }
    await logAudit(
      "sitesurveyv1.send.email",
      "document",
      String(req.body?.surveyId ?? ""),
      { reportNo: req.body?.reportNo, to, cc, via: webhook ? "webhook" : "mailto" },
      req.ip,
    );
    notifyDocumentOutbound({
      channel: "email",
      title: "Site survey emailed",
      body: `${req.body?.reportNo ?? "Survey"} sent to ${to}.`,
      entityType: "document",
      entityId: String(req.body?.surveyId ?? ""),
      href: "/tools/sitesurveyv1",
    });
    publishNotificationAsync({
      eventType: "document.survey_sent",
      title: "Site survey delivered",
      body: `${req.body?.reportNo ?? "Survey"} emailed to the customer.`,
      href: "/tools/sitesurveyv1",
      entityType: "document",
      entityId: String(req.body?.surveyId ?? ""),
      targetRoles: ["owner", "staff"],
      dedupeKey: `survey-email:${req.body?.surveyId ?? Date.now()}`,
      expiresInHours: 72,
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
  const filename = String(req.body?.filename ?? "site-survey.pdf").trim() || "site-survey.pdf";
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
        "sitesurveyv1.send.whatsapp",
        "document",
        String(req.body?.surveyId ?? ""),
        {
          reportNo: req.body?.reportNo,
          phones: result.sent,
          errors: result.errors,
          via: "cloud",
        },
        req.ip,
      );
      notifyDocumentOutbound({
        channel: "whatsapp",
        title: "Site survey sent on WhatsApp",
        body: `${req.body?.reportNo ?? "Survey"} delivered to ${result.sent.join(", ")}.`,
        entityType: "document",
        entityId: String(req.body?.surveyId ?? ""),
        href: "/tools/sitesurveyv1",
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
      kind: "sitesurveyv1.send",
      surveyId: req.body?.surveyId ?? null,
      reportNo: req.body?.reportNo ?? null,
      pdfBase64,
      filename,
    });
    await logAudit(
      "sitesurveyv1.send.whatsapp",
      "document",
      String(req.body?.surveyId ?? ""),
      { reportNo: req.body?.reportNo, phones, via: "webhook" },
      req.ip,
    );
    notifyDocumentOutbound({
      channel: "whatsapp",
      title: "Site survey sent on WhatsApp",
      body: `${req.body?.reportNo ?? "Survey"} queued for ${phones.join(", ")}.`,
      entityType: "document",
      entityId: String(req.body?.surveyId ?? ""),
      href: "/tools/sitesurveyv1",
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

router.get("/", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, tool_id, doc_no, doc_date, party_name, grand_total, status, data, created_at, updated_at
     FROM document_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     ORDER BY updated_at DESC`,
    { profileId: getActiveProfileId(), toolId: TOOL_ID },
  );
  const surveys = (Array.isArray(rows) ? rows : []).map((r) =>
    mapRow(r as Record<string, unknown>, { stripPhotos: true }),
  );
  res.json({ surveys });
});

router.get("/:id", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM document_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id: req.params.id, profileId: getActiveProfileId(), toolId: TOOL_ID },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Survey not found" });
    return;
  }
  res.json({ survey: mapRow(row as Record<string, unknown>) });
});

async function nextReportNo(prefix: string): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(yyyy).slice(-2);
  const key = `${yyyy}-${mm}`;
  const counters = ((await getConfig(COUNTER_KEY)) as Record<string, number>) ?? {};
  counters[key] = (counters[key] || 0) + 1;
  await setConfig(COUNTER_KEY, counters);
  const seq = String(counters[key]).padStart(5, "0");
  const p = (prefix || "ZSS").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "ZSS";
  return `${p}-ID-${yy}/${mm}:${seq}`;
}

router.post("/", async (req, res) => {
  const body = (req.body?.survey ?? req.body ?? {}) as SurveyBody;
  const company = ((await getConfig(COMPANY_KEY)) as { reportPrefix?: string } | null) ?? {};
  let reportNo = body.reportNo ? String(body.reportNo) : "";
  const isNew = !reportNo;
  if (isNew) {
    reportNo = await nextReportNo(company.reportPrefix ?? "ZSS");
  }

  const id = String(body.id ?? newDocumentId(TOOL_ID));
  const values = body.values;
  const customerName = fieldVal(values, "f_name");
  const customerPhone = fieldVal(values, "f_phone");
  if (!customerName || !customerPhone) {
    res.status(400).json({ error: "Customer Name (f_name) and Phone (f_phone) are required" });
    return;
  }

  const estimatedCost = Number(req.body?.estimatedCost ?? 0);
  const status = String(body.status ?? "draft");
  const docDate = fieldVal(values, "f_date") || todayISO();
  const installationType = String(body.installationType ?? "");
  const payload = { ...body, id, reportNo, status, updatedAt: new Date().toISOString() };

  try {
    if (isNew) {
      const survey = await runCreateWithLimit(TOOL_ID, "document", async (conn) => {
        await conn.query(
          `INSERT INTO document_records
           (id, business_profile_id, tool_id, doc_no, doc_date, party_name, grand_total, status, data)
           VALUES (:id, :profileId, :toolId, :docNo, :docDate, :partyName, :grandTotal, :status, :data)`,
          {
            id,
            profileId: getActiveProfileId(),
            toolId: TOOL_ID,
            docNo: reportNo,
            docDate,
            partyName: customerName,
            grandTotal: estimatedCost,
            status,
            data: JSON.stringify(payload),
          },
        );
        const [rows] = await conn.query(`SELECT * FROM document_records WHERE id = :id`, { id });
        return mapRow((Array.isArray(rows) ? rows[0] : {}) as Record<string, unknown>);
      });

      await appendHistory({
        id,
        reportNo,
        customerName,
        installationType,
        status,
        estimatedCost,
      });
      await logAudit("sitesurveyv1.create", "document", id, { reportNo }, req.ip);
      if (status === "submitted" || status === "saved") {
        publishNotificationAsync({
          eventType: "document.survey_submitted",
          title: status === "submitted" ? "Site survey submitted" : "Site survey saved",
          body: `${reportNo} · ${customerName}${installationType ? ` · ${installationType}` : ""}`,
          href: "/tools/sitesurveyv1",
          entityType: "document",
          entityId: id,
          dedupeKey: `survey:${id}:${status}`,
          meta: { reportNo, status, estimatedCost },
          expiresInHours: 168,
        });
      }
      res.status(201).json({ survey });
      return;
    }

    await pool.query(
      `UPDATE document_records SET
         doc_no = :docNo, doc_date = :docDate,
         party_name = :partyName, grand_total = :grandTotal, status = :status, data = :data
       WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
      {
        id,
        profileId: getActiveProfileId(),
        toolId: TOOL_ID,
        docNo: reportNo,
        docDate,
        partyName: customerName,
        grandTotal: estimatedCost,
        status,
        data: JSON.stringify(payload),
      },
    );
    await appendHistory({
      id,
      reportNo,
      customerName,
      installationType,
      status,
      estimatedCost,
    });
    await logAudit("sitesurveyv1.update", "document", id, { reportNo }, req.ip);
    if (status === "submitted") {
      publishNotificationAsync({
        eventType: "document.survey_submitted",
        title: "Site survey submitted",
        body: `${reportNo} · ${customerName}${installationType ? ` · ${installationType}` : ""}`,
        href: "/tools/sitesurveyv1",
        entityType: "document",
        entityId: id,
        dedupeKey: `survey:${id}:submitted`,
        meta: { reportNo, status, estimatedCost },
        expiresInHours: 168,
      });
      publishNotificationAsync({
        eventType: "activity.staff_major_event",
        title: "Staff submitted a site survey",
        body: `${reportNo} for ${customerName} was submitted.`,
        href: "/tools/sitesurveyv1",
        entityType: "document",
        entityId: id,
        targetRoles: ["owner"],
        dedupeKey: `survey-owner:${id}:submitted`,
        expiresInHours: 168,
      });
    }
    const [rows] = await pool.query(`SELECT * FROM document_records WHERE id = :id`, { id });
    res.json({ survey: mapRow((Array.isArray(rows) ? rows[0] : {}) as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof LimitReachedError) {
      res.status(403).json({ error: "FREE_LIMIT_REACHED", limit: err.limit });
      return;
    }
    throw err;
  }
});

async function appendHistory(entry: {
  id: string;
  reportNo: string;
  customerName: string;
  installationType: string;
  status: string;
  estimatedCost: number;
}) {
  const history = (((await getConfig(HISTORY_KEY)) as unknown[]) ?? []).slice();
  history.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    surveyId: entry.id,
    reportNo: entry.reportNo,
    customerName: entry.customerName,
    installationType: entry.installationType,
    status: entry.status,
    estimatedCost: entry.estimatedCost,
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
  await logAudit("sitesurveyv1.delete", "document", req.params.id, {}, req.ip);
  res.status(204).send();
});

export default router;
