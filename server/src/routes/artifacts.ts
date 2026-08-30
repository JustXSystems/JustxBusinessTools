import { Router } from "express";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import {
  createArtifact,
  ensureArtifactDeliverySchema,
  hashAgentToken,
  logArtifactEvent,
  mintAgentToken,
  normalizeConflictPolicy,
  readArtifactBlob,
  toArtifactApi,
  type ArtifactRow,
  type DeliveryChannel,
  type SyncStatus,
} from "../lib/artifact-delivery.js";
import {
  dispatchArtifact,
  ensureDeliveryConfigColumns,
  loadProfileDeliveryConfig,
  publicDeliveryConfig,
} from "../lib/artifact-dispatch.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";
import {
  getActiveOrgId,
  getActiveProfileId,
  getActiveUserId,
} from "../lib/request-context.js";
import { requireWriteAccess } from "../middleware/require-write.js";

const router = Router();

const TERMINAL: SyncStatus[] = ["synced", "skipped_duplicate"];
const ACK_STATUSES: SyncStatus[] = [
  "synced",
  "failed",
  "conflict",
  "skipped_duplicate",
  "pending",
  "in_progress",
];
const CHANNELS: DeliveryChannel[] = [
  "fsa",
  "desktop_agent",
  "browser_download",
  "share_sheet",
  "google_drive",
  "webhook",
];

async function loadArtifact(id: string, profileId: number): Promise<ArtifactRow | null> {
  const [rows] = await pool.query(
    `SELECT * FROM artifact_deliveries WHERE id = :id AND business_profile_id = :profileId LIMIT 1`,
    { id, profileId },
  );
  return (Array.isArray(rows) ? rows[0] : null) as ArtifactRow | null;
}

/** Resolve agent from Bearer token; falls back to session user. */
async function resolveAgentAuth(req: {
  headers: { authorization?: string };
}): Promise<{
  mode: "session" | "agent";
  organizationId: number;
  businessProfileId: number;
  userId: number;
  agentId?: string;
} | null> {
  const auth = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) {
    await ensureArtifactDeliverySchema();
    const tokenHash = hashAgentToken(m[1].trim());
    const [rows] = await pool.query(
      `SELECT id, organization_id, business_profile_id, user_id
       FROM artifact_sync_agents
       WHERE token_hash = :hash AND revoked_at IS NULL LIMIT 1`,
      { hash: tokenHash },
    );
    const row = Array.isArray(rows)
      ? (rows[0] as
          | {
              id: string;
              organization_id: number;
              business_profile_id: number;
              user_id: number;
            }
          | undefined)
      : undefined;
    if (!row) return null;
    await pool.query(`UPDATE artifact_sync_agents SET last_seen_at = NOW() WHERE id = :id`, {
      id: row.id,
    });
    return {
      mode: "agent",
      organizationId: row.organization_id,
      businessProfileId: row.business_profile_id,
      userId: row.user_id,
      agentId: row.id,
    };
  }
  return {
    mode: "session",
    organizationId: getActiveOrgId(),
    businessProfileId: getActiveProfileId(),
    userId: getActiveUserId() ?? 1,
  };
}

router.use(async (_req, res, next) => {
  try {
    await ensureArtifactDeliverySchema();
    await ensureDeliveryConfigColumns();
    next();
  } catch (err) {
    next(err);
  }
});

/** Stage a tool-generated artifact (source of truth for offline sync). */
router.post("/", requireWriteAccess, async (req, res) => {
  const body = req.body ?? {};
  try {
    const [profRows] = await pool.query(
      `SELECT download_folder_conflict_policy FROM business_profiles WHERE id = :id`,
      { id: getActiveProfileId() },
    );
    const prof = Array.isArray(profRows)
      ? (profRows[0] as { download_folder_conflict_policy?: string } | undefined)
      : undefined;
    const policy = normalizeConflictPolicy(
      body.conflictPolicy ?? prof?.download_folder_conflict_policy,
    );
    const userId = getActiveUserId() ?? 1;
    const result = await createArtifact({
      organizationId: getActiveOrgId(),
      businessProfileId: getActiveProfileId(),
      userId,
      toolId: String(body.toolId ?? "unknown"),
      filename: String(body.filename ?? "artifact"),
      mimeType: String(body.mimeType ?? "application/octet-stream"),
      contentBase64: String(body.contentBase64 ?? ""),
      conflictPolicy: policy,
      meta: body.meta && typeof body.meta === "object" ? body.meta : undefined,
      retentionDays: body.retentionDays,
    });
    await logAudit("artifact.stage", "artifact", result.artifact.id, {
      toolId: result.artifact.toolId,
      filename: result.artifact.originalFilename,
    }, req.ip);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid artifact" });
  }
});

/** List artifacts for the active branch (agent + UI sync queue). */
router.get("/", async (req, res) => {
  const auth = await resolveAgentAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Invalid agent token" });
    return;
  }
  const status = String(req.query.status ?? "").trim();
  const pendingOnly = status === "pending" || String(req.query.pending ?? "") === "1";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const [rows] = await pool.query(
    pendingOnly
      ? `SELECT * FROM artifact_deliveries
         WHERE business_profile_id = :profileId
           AND sync_status IN ('pending','failed','conflict')
         ORDER BY created_at ASC LIMIT ${limit}`
      : `SELECT * FROM artifact_deliveries
         WHERE business_profile_id = :profileId
         ORDER BY created_at DESC LIMIT ${limit}`,
    { profileId: auth.businessProfileId },
  );
  const list = (Array.isArray(rows) ? rows : []) as ArtifactRow[];
  res.json({
    downloadFolder: await getDownloadFolder(auth.businessProfileId),
    conflictPolicy: await getConflictPolicy(auth.businessProfileId),
    items: list.map(toArtifactApi),
  });
});

router.get("/sync-summary", async (_req, res) => {
  const profileId = getActiveProfileId();
  const [rows] = await pool.query(
    `SELECT sync_status, COUNT(*) AS c FROM artifact_deliveries
     WHERE business_profile_id = :profileId
     GROUP BY sync_status`,
    { profileId },
  );
  const counts: Record<string, number> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const row = r as { sync_status: string; c: number };
    counts[row.sync_status] = Number(row.c) || 0;
  }
  const cfg = await loadProfileDeliveryConfig(profileId);
  res.json({
    downloadFolder: await getDownloadFolder(profileId),
    counts,
    pending:
      (counts.pending ?? 0) + (counts.failed ?? 0) + (counts.conflict ?? 0),
    delivery: cfg ? publicDeliveryConfig(cfg) : null,
  });
});

/** Manually re-run automatic cloud/UNC dispatch for one artifact. */
router.post("/:id/dispatch", requireWriteAccess, async (req, res) => {
  const id = String(req.params.id);
  const row = await loadArtifact(id, getActiveProfileId());
  if (!row) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  if (row.sync_status === "failed" || row.sync_status === "conflict") {
    await pool.query(
      `UPDATE artifact_deliveries SET sync_status = 'pending', last_error = NULL WHERE id = :id`,
      { id },
    );
  }
  const result = await dispatchArtifact(id);
  const updated = await loadArtifact(id, getActiveProfileId());
  res.json({ result, artifact: updated ? toArtifactApi(updated) : null });
});

/** Register optional desktop sync agent for this branch. */
router.post("/agent/register", requireWriteAccess, async (req, res) => {
  const token = mintAgentToken();
  const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const label = String(req.body?.label ?? "Desktop Sync Agent").slice(0, 120);
  await pool.query(
    `INSERT INTO artifact_sync_agents
     (id, organization_id, business_profile_id, user_id, token_hash, label, last_seen_at)
     VALUES (:id, :orgId, :profileId, :userId, :hash, :label, NOW())`,
    {
      id,
      orgId: getActiveOrgId(),
      profileId: getActiveProfileId(),
      userId: getActiveUserId() ?? 1,
      hash: hashAgentToken(token),
      label,
    },
  );
  await logAudit("artifact.agent_register", "artifact_agent", id, { label }, req.ip);
  res.status(201).json({
    agentId: id,
    token,
    note: "Store this token securely. It is shown once and authorizes sync for this Business Profile.",
  });
});

/** Agent reports whether Download Folder is reachable from the current machine. */
router.post("/agent/probe", async (req, res) => {
  const auth = await resolveAgentAuth(req);
  if (!auth || auth.mode !== "agent" || !auth.agentId) {
    res.status(401).json({ error: "Agent token required" });
    return;
  }
  const ok = Boolean(req.body?.ok);
  const folderPath = String(req.body?.path ?? "").slice(0, 512);
  const error = req.body?.error != null ? String(req.body.error).slice(0, 500) : null;
  await pool.query(
    `UPDATE artifact_sync_agents SET
       last_probe_ok = :ok,
       last_probe_path = :path,
       last_probe_error = :error,
       last_seen_at = NOW()
     WHERE id = :id`,
    { id: auth.agentId, ok: ok ? 1 : 0, path: folderPath || null, error },
  );
  res.json({ ok: true });
});

/** List registered desktop agents for this branch (staff/owner Sync Center). */
router.get("/agents", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, label, last_seen_at, last_probe_ok, last_probe_path, last_probe_error,
            revoked_at, created_at, user_id
     FROM artifact_sync_agents
     WHERE business_profile_id = :profileId
     ORDER BY created_at DESC
     LIMIT 40`,
    { profileId: getActiveProfileId() },
  );
  const items = (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as {
      id: string;
      label: string | null;
      last_seen_at: Date | string | null;
      last_probe_ok: number;
      last_probe_path: string | null;
      last_probe_error: string | null;
      revoked_at: Date | string | null;
      created_at: Date | string;
      user_id: number;
    };
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    const online = !row.revoked_at && lastSeen > Date.now() - 2 * 60 * 1000;
    return {
      id: row.id,
      label: row.label,
      userId: row.user_id,
      lastSeenAt: row.last_seen_at,
      lastProbeOk: Boolean(row.last_probe_ok),
      lastProbePath: row.last_probe_path,
      lastProbeError: row.last_probe_error,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      online,
    };
  });
  res.json({ items });
});

router.post("/agents/:id/revoke", requireWriteAccess, async (req, res) => {
  const id = String(req.params.id);
  const [result] = await pool.query(
    `UPDATE artifact_sync_agents SET revoked_at = NOW()
     WHERE id = :id AND business_profile_id = :profileId AND revoked_at IS NULL`,
    { id, profileId: getActiveProfileId() },
  );
  const affected = (result as { affectedRows?: number })?.affectedRows ?? 0;
  if (!affected) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  await logAudit("artifact.agent_revoke", "artifact_agent", id, undefined, req.ip);
  res.json({ ok: true });
});

router.get("/:id", async (req, res) => {
  const row = await loadArtifact(String(req.params.id), getActiveProfileId());
  if (!row) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.json(toArtifactApi(row));
});

router.get("/:id/content", async (req, res) => {
  const auth = await resolveAgentAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Invalid agent token" });
    return;
  }
  const row = await loadArtifact(String(req.params.id), auth.businessProfileId);
  if (!row) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  try {
    const buf = await readArtifactBlob(row.storage_key);
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.original_filename.replace(/"/g, "")}"`,
    );
    res.setHeader("X-Content-Hash", row.content_hash);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buf);
  } catch {
    res.status(404).json({ error: "Artifact blob missing" });
  }
});

/** Ack delivery from FSA, desktop agent, or browser fallback. */
router.post("/:id/ack", requireWriteAccess, async (req, res) => {
  const auth = await resolveAgentAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Invalid agent token" });
    return;
  }
  const row = await loadArtifact(String(req.params.id), auth.businessProfileId);
  if (!row) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  const body = req.body ?? {};
  const status = String(body.status ?? "").trim() as SyncStatus;
  if (!ACK_STATUSES.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const channel = String(body.channel ?? "").trim() as DeliveryChannel;
  if (channel && !CHANNELS.includes(channel)) {
    res.status(400).json({ error: "Invalid channel" });
    return;
  }
  const destinationPath =
    body.destinationPath != null ? String(body.destinationPath).slice(0, 1024) : null;
  const lastError = body.error != null ? String(body.error).slice(0, 500) : null;
  const browserFallback = channel === "browser_download";
  const downgradeBlocked =
    (row.sync_status === "synced" || row.sync_status === "skipped_duplicate") &&
    (status === "pending" || status === "in_progress");

  const nextStatus = downgradeBlocked ? row.sync_status : status;

  await pool.query(
    `UPDATE artifact_deliveries SET
       sync_status = :status,
       delivery_channel = CASE
         WHEN :downgradeBlocked = 1 THEN delivery_channel
         ELSE COALESCE(:channel, delivery_channel)
       END,
       destination_path = COALESCE(:destinationPath, destination_path),
       last_error = :lastError,
       attempt_count = attempt_count + 1,
       browser_fallback_at = IF(:browserFallback, COALESCE(browser_fallback_at, NOW()), browser_fallback_at),
       synced_at = IF(:isSynced, COALESCE(synced_at, NOW()), synced_at)
     WHERE id = :id`,
    {
      id: row.id,
      status: nextStatus,
      channel: channel || null,
      destinationPath,
      lastError:
        nextStatus === "failed" || nextStatus === "conflict" ? lastError : null,
      browserFallback: browserFallback ? 1 : 0,
      isSynced: TERMINAL.includes(nextStatus) ? 1 : 0,
      downgradeBlocked: downgradeBlocked ? 1 : 0,
    },
  );

  await logArtifactEvent({
    artifactId: row.id,
    organizationId: auth.organizationId,
    businessProfileId: auth.businessProfileId,
    userId: auth.userId,
    eventType: `ack.${status}`,
    channel: channel || null,
    detail: { destinationPath, error: lastError, agentId: auth.agentId },
  });

  if (status === "synced" || status === "failed") {
    publishNotificationAsync({
      eventType: status === "synced" ? "artifact.synced" : "artifact.sync_failed",
      title: status === "synced" ? "File synced to Download Folder" : "File sync failed",
      body:
        status === "synced"
          ? `${row.original_filename} was saved to the configured Download Folder.`
          : `${row.original_filename}: ${lastError || "transfer failed"}`,
      organizationId: auth.organizationId,
      businessProfileId: auth.businessProfileId,
      href: "/profile",
      entityType: "artifact",
      entityId: row.id,
      dedupeKey: `art-${status}:${row.id}`,
      expiresInHours: 48,
    });
  }

  const updated = await loadArtifact(row.id, auth.businessProfileId);
  res.json(toArtifactApi(updated!));
});

router.post("/:id/retry", requireWriteAccess, async (req, res) => {
  const row = await loadArtifact(String(req.params.id), getActiveProfileId());
  if (!row) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  await pool.query(
    `UPDATE artifact_deliveries SET sync_status = 'pending', last_error = NULL WHERE id = :id`,
    { id: row.id },
  );
  await logArtifactEvent({
    artifactId: row.id,
    organizationId: getActiveOrgId(),
    businessProfileId: getActiveProfileId(),
    userId: getActiveUserId(),
    eventType: "retry_requested",
  });
  const updated = await loadArtifact(row.id, getActiveProfileId());
  res.json(toArtifactApi(updated!));
});

async function getDownloadFolder(profileId: number): Promise<string | null> {
  const [rows] = await pool.query(
    `SELECT download_folder FROM business_profiles WHERE id = :id`,
    { id: profileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as { download_folder?: string | null } | undefined)
    : undefined;
  return row?.download_folder ?? null;
}

async function getConflictPolicy(profileId: number) {
  const [rows] = await pool.query(
    `SELECT download_folder_conflict_policy FROM business_profiles WHERE id = :id`,
    { id: profileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as { download_folder_conflict_policy?: string } | undefined)
    : undefined;
  return normalizeConflictPolicy(row?.download_folder_conflict_policy);
}

export default router;
