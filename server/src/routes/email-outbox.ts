import { Router } from "express";
import { requireWriteAccess } from "../middleware/require-write.js";
import {
  createEmailOutbox,
  emailWebhookConfigured,
  ensureEmailOutboxSchema,
  getEmailOutboxById,
  getEmailOutboxForAgent,
  listEmailOutbox,
  mapOutboxPublic,
  sendOutboxViaWebhook,
  updateEmailOutboxStatus,
} from "../lib/email-outbox.js";
import { readArtifactBytesById } from "../lib/artifact-delivery.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

router.get("/status", async (_req, res) => {
  await ensureEmailOutboxSchema();
  const pending = await listEmailOutbox({ pendingOnly: true, limit: 200 });
  res.json({
    webhookConfigured: emailWebhookConfigured(),
    pendingCount: pending.length,
  });
});

router.get("/", async (req, res) => {
  await ensureEmailOutboxSchema();
  const pendingOnly =
    String(req.query.pending ?? "") === "1" || String(req.query.pending ?? "") === "true";
  const status = String(req.query.status ?? "").trim() || undefined;
  const limit = Number(req.query.limit) || 50;
  const rows = await listEmailOutbox({ pendingOnly, status, limit });
  res.json({
    items: rows.map(mapOutboxPublic),
    webhookConfigured: emailWebhookConfigured(),
  });
});

router.get("/:id", async (req, res) => {
  const row = await getEmailOutboxById(String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  res.json({ item: mapOutboxPublic(row), webhookConfigured: emailWebhookConfigured() });
});

router.post("/", requireWriteAccess, async (req, res) => {
  try {
    const body = req.body ?? {};
    const row = await createEmailOutbox({
      toolId: String(body.toolId ?? "quotation-v1"),
      entityType: body.entityType ?? "quotation",
      entityId: body.entityId ?? body.quotationId ?? null,
      quoteNo: body.quoteNo ?? null,
      to: String(body.to ?? ""),
      cc: String(body.cc ?? ""),
      subject: String(body.subject ?? ""),
      body: String(body.message ?? body.body ?? ""),
      html: body.html ?? null,
      templateId: body.templateId ?? null,
      replyTo: body.replyTo ?? null,
      fromName: body.fromName ?? null,
      fromEmail: body.fromEmail ?? null,
      filename: body.filename ?? null,
      pdfBase64: body.pdfBase64 ?? null,
      artifactId: body.artifactId ?? null,
      status: "pending",
      meta: body.meta && typeof body.meta === "object" ? body.meta : null,
    });
    await logAudit("email_outbox.create", "email_outbox", row.id, { to: row.to_addr }, req.ip);
    res.status(201).json({ item: mapOutboxPublic(row) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Create failed" });
  }
});

router.post("/:id/send-webhook", requireWriteAccess, async (req, res) => {
  try {
    if (!emailWebhookConfigured()) {
      res.status(400).json({
        error:
          "EMAIL_WEBHOOK_URL is not configured on the API server. Use Open mail app or Open in Outlook (desktop agent).",
      });
      return;
    }
    const row = await sendOutboxViaWebhook(String(req.params.id));
    await logAudit("email_outbox.webhook", "email_outbox", row.id, { to: row.to_addr }, req.ip);
    res.json({ ok: true, delivered: true, via: "webhook", item: mapOutboxPublic(row) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Webhook send failed" });
  }
});

router.post("/:id/mark-opened", requireWriteAccess, async (req, res) => {
  const row = await updateEmailOutboxStatus(String(req.params.id), {
    status: "opened",
    lastChannel: String(req.body?.channel ?? "mailto"),
    lastError: null,
    incrementAttempt: true,
  });
  if (!row) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  res.json({ item: mapOutboxPublic(row) });
});

router.post("/:id/cancel", requireWriteAccess, async (req, res) => {
  const existing = await getEmailOutboxById(String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  if (existing.status === "sent") {
    res.status(400).json({ error: "Already sent — cannot cancel" });
    return;
  }
  const row = await updateEmailOutboxStatus(String(req.params.id), {
    status: "cancelled",
    lastChannel: "cancel",
    lastError: null,
  });
  res.json({ item: mapOutboxPublic(row!) });
});

router.post("/:id/requeue", requireWriteAccess, async (req, res) => {
  const existing = await getEmailOutboxById(String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  const row = await updateEmailOutboxStatus(String(req.params.id), {
    status: "pending",
    lastChannel: existing.last_channel,
    lastError: null,
  });
  res.json({ item: mapOutboxPublic(row!) });
});

/** Desktop agent: load compose payload + confirm Outlook opened. */
router.get("/:id/agent-compose", async (req, res) => {
  const row = await getEmailOutboxForAgent(String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  let pdfBase64: string | null = null;
  if (row.artifact_id) {
    try {
      pdfBase64 = (await readArtifactBytesById(row.artifact_id)).toString("base64");
    } catch {
      pdfBase64 = null;
    }
  }
  res.json({
    item: mapOutboxPublic(row),
    compose: {
      to: row.to_addr,
      cc: row.cc_addr ?? "",
      subject: row.subject,
      body: row.body_text,
      filename: row.filename || "quotation.pdf",
      pdfBase64,
      artifactId: row.artifact_id,
    },
  });
});

router.post("/:id/agent-opened", async (req, res) => {
  const row = await updateEmailOutboxStatus(String(req.params.id), {
    status: "opened",
    lastChannel: "outlook_agent",
    lastError: null,
    incrementAttempt: true,
  });
  if (!row) {
    res.status(404).json({ error: "Outbox item not found" });
    return;
  }
  res.json({ ok: true, item: mapOutboxPublic(row) });
});

export default router;
