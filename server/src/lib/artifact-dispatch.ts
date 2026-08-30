import { pool } from "../db.js";
import {
  ensureArtifactDeliverySchema,
  logArtifactEvent,
  readArtifactBlob,
  toArtifactApi,
  type ArtifactRow,
  type DeliveryChannel,
} from "./artifact-delivery.js";
import {
  driveFolderHint,
  isGoogleDriveConfigured,
  signWebhookBody,
  uploadToGoogleDriveFolder,
} from "./google-drive-upload.js";
import {
  ensureProfileDriveSchema,
  getProfileDriveAccessToken,
  getProfileDrivePublic,
  isDriveOAuthClientConfigured,
} from "./profile-drive-oauth.js";
import { normalizeProfileSendSettings } from "./profile-send-settings.js";
import { publishNotificationAsync } from "./notification-publish.js";

export type ArtifactDestination = "auto" | "google_drive" | "webhook" | "unc_agent" | "none";

export type ProfileDeliveryConfig = {
  artifactDestination: ArtifactDestination;
  downloadFolder: string | null;
  driveFolderId: string;
  driveFolderLabel: string;
  driveConnected: boolean;
  driveEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookSecretConfigured: boolean;
};

function normalizeDestination(raw: unknown): ArtifactDestination {
  const v = String(raw ?? "auto").trim().toLowerCase();
  if (
    v === "google_drive" ||
    v === "webhook" ||
    v === "unc_agent" ||
    v === "none" ||
    v === "auto"
  ) {
    return v;
  }
  return "auto";
}

export function validateWebhookUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (v.length > 1024) throw new Error("Webhook URL is too long");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error("Webhook URL must be a valid https URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Webhook URL must use http or https");
  }
  // Block obvious SSRF to link-local / metadata in production-ish configs
  const host = u.hostname.toLowerCase();
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    throw new Error("Webhook URL host is not allowed");
  }
  return v;
}

export async function ensureDeliveryConfigColumns(): Promise<void> {
  await ensureArtifactDeliverySchema();
  const cols = [
    `ALTER TABLE business_profiles ADD COLUMN artifact_destination VARCHAR(24) NOT NULL DEFAULT 'auto'`,
    `ALTER TABLE business_profiles ADD COLUMN artifact_webhook_url VARCHAR(1024) NULL`,
    `ALTER TABLE business_profiles ADD COLUMN artifact_webhook_secret VARCHAR(255) NULL`,
  ];
  for (const sql of cols) {
    try {
      await pool.query(sql);
    } catch (err) {
      const e = err as { code?: string; errno?: number };
      if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
    }
  }
}

export async function loadProfileDeliveryConfig(
  profileId: number,
): Promise<ProfileDeliveryConfig | null> {
  await ensureDeliveryConfigColumns();
  await ensureProfileDriveSchema();
  const [rows] = await pool.query(
    `SELECT download_folder, artifact_destination, artifact_webhook_url, artifact_webhook_secret,
            send_settings
     FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: profileId },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as
        | {
            download_folder: string | null;
            artifact_destination: string | null;
            artifact_webhook_url: string | null;
            artifact_webhook_secret: string | null;
            send_settings: unknown;
          }
        | undefined)
    : undefined;
  if (!row) return null;
  const send = normalizeProfileSendSettings(row.send_settings);
  const drive = await getProfileDrivePublic(profileId);
  // Prefer dedicated Drive connection folder; fall back to legacy sendSettings folder id.
  const folderId = drive.folderId || send.googleDrive.folderId;
  const folderLabel = drive.folderLabel || send.googleDrive.folderLabel;
  return {
    artifactDestination: normalizeDestination(row.artifact_destination),
    downloadFolder: row.download_folder ?? null,
    driveFolderId: folderId,
    driveFolderLabel: folderLabel,
    driveConnected: drive.connected,
    driveEmail: drive.email,
    webhookUrl: row.artifact_webhook_url ?? null,
    webhookSecret: row.artifact_webhook_secret ?? null,
    webhookSecretConfigured: Boolean(row.artifact_webhook_secret),
  };
}

/** Resolve effective channel for auto mode (cloud-first, per-tenant). */
export function resolveEffectiveDestination(
  cfg: ProfileDeliveryConfig,
): ArtifactDestination {
  if (cfg.artifactDestination !== "auto") return cfg.artifactDestination;
  // Tenant connected their own Google account + folder
  if (cfg.driveConnected && cfg.driveFolderId) return "google_drive";
  // Optional platform SA + folder id pasted on profile
  if (cfg.driveFolderId && isGoogleDriveConfigured()) return "google_drive";
  if (cfg.webhookUrl) return "webhook";
  if (cfg.downloadFolder) return "unc_agent";
  return "none";
}

export function publicDeliveryConfig(cfg: ProfileDeliveryConfig) {
  const effective = resolveEffectiveDestination(cfg);
  return {
    artifactDestination: cfg.artifactDestination,
    effectiveDestination: effective,
    downloadFolder: cfg.downloadFolder,
    googleDrive: {
      folderId: cfg.driveFolderId,
      folderLabel: cfg.driveFolderLabel,
      connected: cfg.driveConnected,
      email: cfg.driveEmail,
      oauthClientConfigured: isDriveOAuthClientConfigured(),
      /** Optional platform SA — not required for multi-tenant OAuth. */
      serverServiceAccountConfigured: isGoogleDriveConfigured(),
      serviceAccountEmail: driveFolderHint(),
    },
    webhook: {
      url: cfg.webhookUrl,
      secretConfigured: cfg.webhookSecretConfigured,
    },
    automationReady:
      effective === "google_drive" ||
      effective === "webhook" ||
      (effective === "unc_agent" && Boolean(cfg.downloadFolder)),
  };
}

async function markArtifact(
  id: string,
  patch: {
    status: string;
    channel: DeliveryChannel | "google_drive" | "webhook";
    destinationPath?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const synced = patch.status === "synced" || patch.status === "skipped_duplicate";
  await pool.query(
    `UPDATE artifact_deliveries SET
       sync_status = :status,
       delivery_channel = :channel,
       destination_path = COALESCE(:destinationPath, destination_path),
       last_error = :lastError,
       attempt_count = attempt_count + 1,
       synced_at = IF(:synced, NOW(), synced_at)
     WHERE id = :id`,
    {
      id,
      status: patch.status,
      channel: patch.channel,
      destinationPath: patch.destinationPath ?? null,
      lastError: patch.error ?? null,
      synced: synced ? 1 : 0,
    },
  );
}

async function deliverViaDrive(
  row: ArtifactRow,
  folderId: string,
  accessToken?: string | null,
): Promise<void> {
  const buf = await readArtifactBlob(row.storage_key);
  const uploaded = await uploadToGoogleDriveFolder({
    folderId,
    filename: row.original_filename,
    mimeType: row.mime_type,
    buffer: buf,
    accessToken: accessToken || undefined,
  });
  await markArtifact(row.id, {
    status: "synced",
    channel: "google_drive",
    destinationPath: uploaded.webViewLink || `drive:${uploaded.fileId}`,
  });
  await logArtifactEvent({
    artifactId: row.id,
    organizationId: row.organization_id,
    businessProfileId: row.business_profile_id,
    userId: row.user_id,
    eventType: "ack.synced",
    channel: "google_drive",
    detail: { fileId: uploaded.fileId, webViewLink: uploaded.webViewLink },
  });
}

async function deliverViaWebhook(
  row: ArtifactRow,
  webhookUrl: string,
  webhookSecret: string | null,
): Promise<void> {
  const buf = await readArtifactBlob(row.storage_key);
  const payload = {
    event: "artifact.ready",
    artifactId: row.id,
    organizationId: row.organization_id,
    businessProfileId: row.business_profile_id,
    userId: row.user_id,
    toolId: row.tool_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    contentBase64: buf.toString("base64"),
    timestamp: new Date().toISOString(),
  };
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "JustX-ArtifactDispatcher/1.0",
    "X-JustX-Event": "artifact.ready",
    "X-JustX-Artifact-Id": row.id,
  };
  if (webhookSecret) {
    headers["X-JustX-Signature"] = `sha256=${signWebhookBody(webhookSecret, raw)}`;
  }
  const res = await fetch(webhookUrl, { method: "POST", headers, body: raw });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook ${res.status}: ${text.slice(0, 180)}`);
  }
  await markArtifact(row.id, {
    status: "synced",
    channel: "webhook",
    destinationPath: webhookUrl,
  });
  await logArtifactEvent({
    artifactId: row.id,
    organizationId: row.organization_id,
    businessProfileId: row.business_profile_id,
    userId: row.user_id,
    eventType: "ack.synced",
    channel: "webhook",
    detail: { status: res.status },
  });
}

/**
 * Automatically deliver a staged artifact using the profile's cloud-first destination.
 * UNC remains pending for the optional desktop agent (already polling).
 */
export async function dispatchArtifact(artifactId: string): Promise<{
  ok: boolean;
  channel: string;
  status: string;
  message?: string;
}> {
  await ensureDeliveryConfigColumns();
  const [rows] = await pool.query(`SELECT * FROM artifact_deliveries WHERE id = :id LIMIT 1`, {
    id: artifactId,
  });
  const row = (Array.isArray(rows) ? rows[0] : null) as ArtifactRow | null;
  if (!row) return { ok: false, channel: "none", status: "missing", message: "Not found" };
  if (row.sync_status === "synced" || row.sync_status === "skipped_duplicate") {
    return { ok: true, channel: row.delivery_channel || "none", status: row.sync_status };
  }

  const cfg = await loadProfileDeliveryConfig(row.business_profile_id);
  if (!cfg) return { ok: false, channel: "none", status: "failed", message: "Profile missing" };
  const dest = resolveEffectiveDestination(cfg);

  try {
    if (dest === "google_drive") {
      if (!cfg.driveFolderId) {
        throw new Error("Choose a Google Drive folder on Business Profile after connecting");
      }
      const tenantToken = await getProfileDriveAccessToken(row.business_profile_id);
      if (!tenantToken && !isGoogleDriveConfigured()) {
        throw new Error(
          "Connect Google Drive on Business Profile (Owner), or ask platform admin to enable Drive OAuth",
        );
      }
      await pool.query(
        `UPDATE artifact_deliveries SET sync_status = 'in_progress', delivery_channel = 'google_drive' WHERE id = :id`,
        { id: row.id },
      );
      await deliverViaDrive(row, cfg.driveFolderId, tenantToken);
      publishNotificationAsync({
        eventType: "artifact.synced",
        title: "File saved to Google Drive",
        body: `${row.original_filename} was uploaded automatically.`,
        organizationId: row.organization_id,
        businessProfileId: row.business_profile_id,
        href: "/sync",
        entityType: "artifact",
        entityId: row.id,
        dedupeKey: `art-synced:${row.id}`,
        expiresInHours: 48,
      });
      return { ok: true, channel: "google_drive", status: "synced" };
    }

    if (dest === "webhook") {
      if (!cfg.webhookUrl) throw new Error("Artifact webhook URL is not configured");
      await pool.query(
        `UPDATE artifact_deliveries SET sync_status = 'in_progress', delivery_channel = 'webhook' WHERE id = :id`,
        { id: row.id },
      );
      await deliverViaWebhook(row, cfg.webhookUrl, cfg.webhookSecret);
      publishNotificationAsync({
        eventType: "artifact.synced",
        title: "File delivered to corporate webhook",
        body: `${row.original_filename} was posted automatically (SharePoint / Power Automate / n8n).`,
        organizationId: row.organization_id,
        businessProfileId: row.business_profile_id,
        href: "/sync",
        entityType: "artifact",
        entityId: row.id,
        dedupeKey: `art-synced:${row.id}`,
        expiresInHours: 48,
      });
      return { ok: true, channel: "webhook", status: "synced" };
    }

    if (dest === "unc_agent") {
      // Leave pending — desktop agent polls and writes without Sync Center clicks.
      await logArtifactEvent({
        artifactId: row.id,
        organizationId: row.organization_id,
        businessProfileId: row.business_profile_id,
        userId: row.user_id,
        eventType: "queued.unc_agent",
        channel: "desktop_agent",
        detail: { downloadFolder: cfg.downloadFolder },
      });
      return {
        ok: true,
        channel: "desktop_agent",
        status: "pending",
        message: "Queued for desktop sync agent",
      };
    }

    return {
      ok: true,
      channel: "none",
      status: "pending",
      message: "No cloud destination configured — browser download / Sync Center only",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markArtifact(row.id, {
      status: "failed",
      channel: dest === "webhook" ? "webhook" : dest === "google_drive" ? "google_drive" : "desktop_agent",
      error: msg,
    });
    await logArtifactEvent({
      artifactId: row.id,
      organizationId: row.organization_id,
      businessProfileId: row.business_profile_id,
      userId: row.user_id,
      eventType: "ack.failed",
      channel: dest,
      detail: { error: msg },
    });
    publishNotificationAsync({
      eventType: "artifact.sync_failed",
      title: "Automatic file delivery failed",
      body: `${row.original_filename}: ${msg}`,
      organizationId: row.organization_id,
      businessProfileId: row.business_profile_id,
      href: "/sync",
      entityType: "artifact",
      entityId: row.id,
      dedupeKey: `art-fail:${row.id}:${Date.now()}`,
      expiresInHours: 72,
    });
    return { ok: false, channel: dest, status: "failed", message: msg };
  }
}

export function dispatchArtifactAsync(artifactId: string): void {
  void dispatchArtifact(artifactId).catch((err) => {
    console.warn("[artifact-dispatch]", artifactId, err);
  });
}

/** Retry failed cloud deliveries (lightweight background sweeper). */
export async function retryFailedCloudArtifacts(limit = 20): Promise<number> {
  await ensureDeliveryConfigColumns();
  const [rows] = await pool.query(
    `SELECT id FROM artifact_deliveries
     WHERE sync_status = 'failed'
       AND delivery_channel IN ('google_drive','webhook')
       AND attempt_count < 8
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY updated_at ASC
     LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
  );
  const list = (Array.isArray(rows) ? rows : []) as Array<{ id: string }>;
  let n = 0;
  for (const item of list) {
    await pool.query(
      `UPDATE artifact_deliveries SET sync_status = 'pending', last_error = NULL WHERE id = :id`,
      { id: item.id },
    );
    const result = await dispatchArtifact(item.id);
    if (result.ok && result.status === "synced") n += 1;
  }
  return n;
}

export function startArtifactDispatchScheduler(): void {
  const ms = Math.max(Number(process.env.ARTIFACT_RETRY_MS) || 60_000, 15_000);
  setInterval(() => {
    void retryFailedCloudArtifacts().catch((err) =>
      console.warn("[artifact-retry]", err instanceof Error ? err.message : err),
    );
  }, ms).unref?.();
}

export { toArtifactApi, normalizeDestination };
