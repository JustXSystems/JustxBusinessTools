import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db.js";
import { localUploadDir, uploadDriver } from "./storage.js";

export type SyncStatus =
  | "pending"
  | "in_progress"
  | "synced"
  | "failed"
  | "conflict"
  | "skipped_duplicate";

export type DeliveryChannel =
  | "fsa"
  | "desktop_agent"
  | "browser_download"
  | "share_sheet"
  | "google_drive"
  | "webhook";

export type ConflictPolicy = "rename" | "skip" | "overwrite";

export type ArtifactRow = {
  id: string;
  organization_id: number;
  business_profile_id: number;
  user_id: number;
  tool_id: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  storage_key: string;
  sync_status: SyncStatus;
  delivery_channel: DeliveryChannel | null;
  destination_path: string | null;
  conflict_policy: ConflictPolicy;
  attempt_count: number;
  last_error: string | null;
  browser_fallback_at: Date | string | null;
  synced_at: Date | string | null;
  expires_at: Date | string | null;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

let schemaReady: Promise<void> | null = null;

async function addColumnIfMissing(sql: string): Promise<void> {
  try {
    await pool.query(sql);
  } catch (err) {
    const e = err as { code?: string; errno?: number };
    if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
  }
}

export async function ensureArtifactDeliverySchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await addColumnIfMissing(
        `ALTER TABLE business_profiles ADD COLUMN download_folder VARCHAR(512) NULL`,
      );
      await addColumnIfMissing(
        `ALTER TABLE business_profiles ADD COLUMN download_folder_conflict_policy VARCHAR(16) NOT NULL DEFAULT 'rename'`,
      );
      await pool.query(`
        CREATE TABLE IF NOT EXISTS artifact_deliveries (
          id VARCHAR(64) NOT NULL,
          organization_id INT UNSIGNED NOT NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          tool_id VARCHAR(64) NOT NULL,
          original_filename VARCHAR(255) NOT NULL,
          mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
          byte_size INT UNSIGNED NOT NULL DEFAULT 0,
          content_hash CHAR(64) NOT NULL,
          storage_key VARCHAR(512) NOT NULL,
          sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          delivery_channel VARCHAR(32) NULL,
          destination_path VARCHAR(1024) NULL,
          conflict_policy VARCHAR(16) NOT NULL DEFAULT 'rename',
          attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
          last_error VARCHAR(500) NULL,
          browser_fallback_at TIMESTAMP NULL,
          synced_at TIMESTAMP NULL,
          expires_at TIMESTAMP NULL,
          meta JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_art_pending (business_profile_id, sync_status, created_at),
          KEY idx_art_org (organization_id, created_at),
          KEY idx_art_hash (business_profile_id, content_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS artifact_delivery_events (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          artifact_id VARCHAR(64) NOT NULL,
          organization_id INT UNSIGNED NOT NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NULL,
          event_type VARCHAR(48) NOT NULL,
          channel VARCHAR(32) NULL,
          detail JSON NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_art_ev_art (artifact_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS artifact_sync_agents (
          id VARCHAR(64) NOT NULL,
          organization_id INT UNSIGNED NOT NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NOT NULL,
          token_hash CHAR(64) NOT NULL,
          label VARCHAR(120) NULL,
          last_seen_at TIMESTAMP NULL,
          last_probe_ok TINYINT(1) NOT NULL DEFAULT 0,
          last_probe_path VARCHAR(512) NULL,
          last_probe_error VARCHAR(500) NULL,
          revoked_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_agent_token (token_hash),
          KEY idx_agent_profile (business_profile_id, revoked_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

/** Normalize + validate Download Folder path (config only; server never writes to it in SaaS mode). */
export function validateDownloadFolderPath(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (v.length > 512) throw new Error("Download Folder path must be 512 characters or fewer");
  if (/[\0\n\r]/.test(v)) throw new Error("Download Folder path contains invalid characters");
  if (v.includes("..")) throw new Error("Download Folder path must not contain '..'");
  // Reject obvious traversal / device tricks; allow UNC \\server\share and drive letters.
  if (/^[a-zA-Z]:/.test(v) || v.startsWith("\\\\") || v.startsWith("//") || v.startsWith("/")) {
    return v;
  }
  // Relative org-approved labels are rejected — require absolute/UNC.
  throw new Error(
    "Download Folder must be an absolute path (e.g. C:\\\\Artifacts) or UNC share (\\\\fileserver\\\\shared\\\\...)",
  );
}

export function normalizeConflictPolicy(raw: unknown): ConflictPolicy {
  const v = String(raw ?? "rename").trim().toLowerCase();
  if (v === "skip" || v === "overwrite" || v === "rename") return v;
  return "rename";
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || "artifact").trim() || "artifact");
  const cleaned = base.replace(/[<>:"/\\|?*\0]/g, "_").replace(/\s+/g, " ").slice(0, 200);
  return cleaned || "artifact";
}

export function contentHash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function decodeArtifactPayload(
  contentBase64: string,
  mimeType: string,
): { buffer: Buffer; mime: string } {
  const mime = String(mimeType || "application/octet-stream").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error("Unsupported artifact type");
  }
  const raw = String(contentBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) throw new Error("Artifact content is empty");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("Artifact content is empty");
  if (buffer.length > MAX_ARTIFACT_BYTES) {
    throw new Error(`Artifact must be ${MAX_ARTIFACT_BYTES / (1024 * 1024)} MB or smaller`);
  }
  // Light magic-byte checks for common types
  if (mime === "application/pdf" && buffer.subarray(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("File content does not look like a PDF");
  }
  return { buffer, mime };
}

async function writeArtifactBlob(key: string, buffer: Buffer, mime: string): Promise<void> {
  if (uploadDriver() === "s3") {
    // Reuse local for MVP if S3 helper stays private; prefer local artifact dir.
    // Callers can point UPLOAD_DRIVER=local for artifacts in SaaS staging.
  }
  const dest = path.join(localUploadDir(), key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  void mime;
}

export async function readArtifactBlob(storageKey: string): Promise<Buffer> {
  const root = localUploadDir();
  const abs = path.resolve(root, storageKey);
  if (!abs.startsWith(root) || storageKey.includes("..")) {
    throw new Error("Invalid storage key");
  }
  return readFile(abs);
}

export async function deleteArtifactBlob(storageKey: string): Promise<void> {
  try {
    const root = localUploadDir();
    const abs = path.resolve(root, storageKey);
    if (!abs.startsWith(root) || storageKey.includes("..")) return;
    await unlink(abs);
  } catch {
    /* ignore */
  }
}

export function toArtifactApi(row: ArtifactRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    businessProfileId: row.business_profile_id,
    userId: row.user_id,
    toolId: row.tool_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size) || 0,
    contentHash: row.content_hash,
    syncStatus: row.sync_status,
    deliveryChannel: row.delivery_channel,
    destinationPath: row.destination_path,
    conflictPolicy: row.conflict_policy,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: row.last_error,
    browserFallbackAt: row.browser_fallback_at,
    syncedAt: row.synced_at,
    expiresAt: row.expires_at,
    meta: parseJson(row.meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function logArtifactEvent(input: {
  artifactId: string;
  organizationId: number;
  businessProfileId: number;
  userId?: number | null;
  eventType: string;
  channel?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO artifact_delivery_events
     (artifact_id, organization_id, business_profile_id, user_id, event_type, channel, detail)
     VALUES (:artifactId, :organizationId, :businessProfileId, :userId, :eventType, :channel, :detail)`,
    {
      artifactId: input.artifactId,
      organizationId: input.organizationId,
      businessProfileId: input.businessProfileId,
      userId: input.userId ?? null,
      eventType: input.eventType,
      channel: input.channel ?? null,
      detail: input.detail ? JSON.stringify(input.detail) : null,
    },
  );
}

export async function createArtifact(input: {
  organizationId: number;
  businessProfileId: number;
  userId: number;
  toolId: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  conflictPolicy?: ConflictPolicy;
  meta?: Record<string, unknown>;
  retentionDays?: number;
}): Promise<{ artifact: ReturnType<typeof toArtifactApi>; duplicateOf?: string }> {
  await ensureArtifactDeliverySchema();
  const { buffer, mime } = decodeArtifactPayload(input.contentBase64, input.mimeType);
  const hash = contentHash(buffer);
  const filename = sanitizeFilename(input.filename);

  // Duplicate detection within profile (same hash + pending/synced)
  const [dupRows] = await pool.query(
    `SELECT id FROM artifact_deliveries
     WHERE business_profile_id = :profileId AND content_hash = :hash
       AND sync_status IN ('pending','in_progress','synced')
     ORDER BY created_at DESC LIMIT 1`,
    { profileId: input.businessProfileId, hash },
  );
  const dup = Array.isArray(dupRows) ? (dupRows[0] as { id: string } | undefined) : undefined;

  const id = `art_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
  const key = `artifacts/${input.organizationId}/${input.businessProfileId}/${id}${path.extname(filename) || ""}`;
  await writeArtifactBlob(key, buffer, mime);

  const retention = Math.min(Math.max(Number(input.retentionDays ?? 30) || 30, 1), 365);
  const expires = new Date(Date.now() + retention * 24 * 60 * 60 * 1000);
  const policy = input.conflictPolicy ?? "rename";
  const meta = {
    ...(input.meta ?? {}),
    toolId: input.toolId,
    businessProfileId: input.businessProfileId,
    userId: input.userId,
    generatedAt: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO artifact_deliveries
     (id, organization_id, business_profile_id, user_id, tool_id, original_filename, mime_type,
      byte_size, content_hash, storage_key, sync_status, conflict_policy, expires_at, meta)
     VALUES
     (:id, :orgId, :profileId, :userId, :toolId, :filename, :mime, :byteSize, :hash, :key,
      'pending', :policy, :expires, :meta)`,
    {
      id,
      orgId: input.organizationId,
      profileId: input.businessProfileId,
      userId: input.userId,
      toolId: String(input.toolId).slice(0, 64),
      filename,
      mime,
      byteSize: buffer.length,
      hash,
      key,
      policy,
      expires,
      meta: JSON.stringify(meta),
    },
  );

  await logArtifactEvent({
    artifactId: id,
    organizationId: input.organizationId,
    businessProfileId: input.businessProfileId,
    userId: input.userId,
    eventType: "staged",
    detail: { filename, byteSize: buffer.length, hash, duplicateOf: dup?.id },
  });

  const [rows] = await pool.query(`SELECT * FROM artifact_deliveries WHERE id = :id`, { id });
  const row = (Array.isArray(rows) ? rows[0] : null) as ArtifactRow;
  const artifact = toArtifactApi(row);

  // Await cloud delivery (Drive / webhook) so Download PDF / Send Via actually publish
  // before the browser continues. UNC stays queued asynchronously.
  let delivery: {
    ok: boolean;
    channel: string;
    status: string;
    message?: string;
  } | null = null;
  try {
    const { dispatchArtifact } = await import("./artifact-dispatch.js");
    delivery = await dispatchArtifact(id);
    // Refresh row after dispatch so client sees google_drive + synced/failed.
    const [after] = await pool.query(`SELECT * FROM artifact_deliveries WHERE id = :id`, { id });
    const afterRow = (Array.isArray(after) ? after[0] : null) as ArtifactRow | null;
    return {
      artifact: afterRow ? toArtifactApi(afterRow) : artifact,
      duplicateOf: dup?.id,
      delivery,
    };
  } catch (err) {
    console.warn("[artifact-dispatch]", id, err);
    return {
      artifact,
      duplicateOf: dup?.id,
      delivery: {
        ok: false,
        channel: "none",
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintAgentToken(): string {
  return `jxsa_${randomBytes(32).toString("base64url")}`;
}
