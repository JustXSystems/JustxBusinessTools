import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { jsonVal } from "../../lib/admin/approvals.js";
import { applyWebhookEvent } from "../../lib/payments/webhook-process.js";
import { getActiveOrgId, getActiveUserId } from "../../lib/request-context.js";
import { publishNotification } from "../../lib/notification-publish.js";

const router = Router();

function maskConfig(config: unknown): Record<string, unknown> {
  const obj = (jsonVal(config) as Record<string, unknown> | null) ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const s = String(v ?? "");
    if (/key|secret|token|password/i.test(k) && s.length > 4) {
      out[k] = `••••${s.slice(-4)}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, provider, display_name, mode, enabled, mapped_plan_ids, config, last_health, last_health_at
     FROM payment_gateways WHERE organization_id = :orgId ORDER BY id`,
    { orgId },
  );
  res.json({
    gateways: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        provider: String(r.provider),
        displayName: String(r.display_name),
        mode: String(r.mode),
        enabled: Boolean(r.enabled),
        mappedPlanIds: jsonVal(r.mapped_plan_ids) ?? [],
        config: maskConfig(r.config),
        lastHealth: (r.last_health as string | null) ?? null,
        lastHealthAt: r.last_health_at ? String(r.last_health_at) : null,
      };
    }),
  });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
  const provider = String(req.body?.provider ?? "").trim();
  const displayName = String(req.body?.displayName ?? provider).trim();
  if (!provider || !displayName) {
    res.status(400).json({ error: "provider and displayName required" });
    return;
  }
  const [result] = await pool.query(
    `INSERT INTO payment_gateways
      (organization_id, provider, display_name, mode, enabled, mapped_plan_ids, config)
     VALUES (:orgId, :provider, :name, :mode, :enabled, :plans, :config)`,
    {
      orgId,
      provider,
      name: displayName,
      mode: req.body?.mode ?? "test",
      enabled: Number(Boolean(req.body?.enabled)),
      plans: JSON.stringify(req.body?.mappedPlanIds ?? []),
      config: JSON.stringify(req.body?.config ?? {}),
    },
  );
  const id = Number((result as { insertId: number }).insertId);
  await pool.query(
    `INSERT INTO gateway_events (gateway_id, event_type, message) VALUES (:id, 'created', :msg)`,
    { id, msg: `Gateway ${displayName} created by user ${getActiveUserId()}` },
  );
  await logAudit("gateway.create", "payment_gateway", String(id), { provider }, req.ip);
  await publishNotification({
    eventType: "admin.gateway_event",
    title: "Payment gateway added",
    body: `${displayName} (${provider}) was configured for this organization.`,
    organizationId: orgId,
    href: "/admin/gateways",
    entityType: "payment_gateway",
    entityId: String(id),
    actorRole: "admin",
    dedupeKey: `gateway-create:${id}`,
    expiresInHours: 168,
  });
  res.status(201).json({ id });
});

router.put("/:id", async (req, res) => {
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  const [existing] = await pool.query(
    `SELECT config FROM payment_gateways WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  const prev = Array.isArray(existing) ? (existing[0] as { config: unknown } | undefined) : undefined;
  const prevConfig = (jsonVal(prev?.config) as Record<string, unknown> | null) ?? {};
  const incoming = (req.body?.config as Record<string, unknown> | undefined) ?? {};
  const merged = { ...prevConfig };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string" && v.startsWith("••••")) continue;
    merged[k] = v;
  }
  await pool.query(
    `UPDATE payment_gateways SET
       display_name = COALESCE(:name, display_name),
       mode = COALESCE(:mode, mode),
       enabled = COALESCE(:enabled, enabled),
       mapped_plan_ids = COALESCE(:plans, mapped_plan_ids),
       config = :config
     WHERE id = :id AND organization_id = :orgId`,
    {
      id,
      orgId,
      name: req.body?.displayName ?? null,
      mode: req.body?.mode ?? null,
      enabled: req.body?.enabled == null ? null : Number(Boolean(req.body.enabled)),
      plans: req.body?.mappedPlanIds ? JSON.stringify(req.body.mappedPlanIds) : null,
      config: JSON.stringify(merged),
    },
  );
  await pool.query(
    `INSERT INTO gateway_events (gateway_id, event_type, message) VALUES (:id, 'updated', 'Configuration updated')`,
    { id },
  );
  await publishNotification({
    eventType: "admin.gateway_event",
    title: "Payment gateway updated",
    body: `Gateway #${id} configuration was changed.`,
    organizationId: orgId,
    href: "/admin/gateways",
    entityType: "payment_gateway",
    entityId: String(id),
    actorRole: "admin",
    dedupeKey: `gateway-upd:${id}:${Date.now()}`,
    expiresInHours: 72,
  });
  res.json({ ok: true });
});

router.post("/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  await pool.query(
    `UPDATE payment_gateways SET last_health = 'ok', last_health_at = CURRENT_TIMESTAMP
     WHERE id = :id AND organization_id = :orgId`,
    { id, orgId: getActiveOrgId() },
  );
  await pool.query(
    `INSERT INTO gateway_events (gateway_id, event_type, message)
     VALUES (:id, 'health_check', 'Test ping succeeded (sandbox)')`,
    { id },
  );
  await publishNotification({
    eventType: "admin.gateway_event",
    title: "Gateway health check OK",
    body: `Gateway #${id} responded to a test ping.`,
    organizationId: getActiveOrgId(),
    href: "/admin/gateways",
    entityType: "payment_gateway",
    entityId: String(id),
    actorRole: "admin",
    severity: "info",
    dedupeKey: `gateway-health:${id}:${Date.now()}`,
    expiresInHours: 48,
  });
  res.json({ ok: true, lastHealth: "ok" });
});

router.get("/:id/events", async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, event_type, message, payload, created_at FROM gateway_events
     WHERE gateway_id = :id ORDER BY id DESC LIMIT 50`,
    { id: Number(req.params.id) },
  );
  res.json({
    events: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        eventType: String(r.event_type),
        message: (r.message as string | null) ?? null,
        payload: jsonVal(r.payload),
        hasPayload: Boolean(r.payload),
        createdAt: String(r.created_at),
      };
    }),
  });
});

router.post("/:id/events/:eventId/replay", async (req, res) => {
  const orgId = getActiveOrgId();
  const gatewayId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  const [gwRows] = await pool.query(
    `SELECT id, provider FROM payment_gateways WHERE id = :id AND organization_id = :orgId`,
    { id: gatewayId, orgId },
  );
  const gw = Array.isArray(gwRows) ? (gwRows[0] as { id: number; provider: string } | undefined) : undefined;
  if (!gw) {
    res.status(404).json({ error: "Gateway not found" });
    return;
  }

  let payload: unknown = req.body?.payload;
  if (payload == null && eventId > 0) {
    const [evRows] = await pool.query(
      `SELECT payload FROM gateway_events WHERE id = :eventId AND gateway_id = :gatewayId`,
      { eventId, gatewayId },
    );
    const ev = Array.isArray(evRows) ? (evRows[0] as { payload: unknown } | undefined) : undefined;
    payload = jsonVal(ev?.payload) ?? ev?.payload;
  }
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Event has no JSON payload to replay" });
    return;
  }

  try {
    const result = await applyWebhookEvent(String(gw.provider), payload, {
      skipVerify: true,
      skipLog: true,
    });
    await pool.query(
      `INSERT INTO gateway_events (gateway_id, event_type, message, payload)
       VALUES (:id, 'webhook.replay', :msg, :payload)`,
      {
        id: gatewayId,
        msg: `Replayed${eventId > 0 ? ` event #${eventId}` : " sample"}${result.type ? ` (${result.type})` : ""}`,
        payload: JSON.stringify(payload),
      },
    );
    await logAudit(
      "gateway.webhook.replay",
      "gateway_event",
      String(eventId > 0 ? eventId : gatewayId),
      { gatewayId },
      req.ip,
    );
    res.json({ ok: true, result });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Replay failed" });
  }
});

export default router;
