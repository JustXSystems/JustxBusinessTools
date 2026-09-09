import { pool } from "../../db.js";
import { encryptSecret, decryptSecret } from "../secret-box.js";

export type IntegrationStatus = "not_configured" | "disabled" | "active" | "error";

export type IntegrationId = "google_oauth" | "email_webhook";

export type IntegrationRow = {
  id: IntegrationId;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  status: IntegrationStatus;
  statusDetail: string | null;
  lastCheckedAt: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
};

let schemaReady: Promise<void> | null = null;

export async function ensurePlatformIntegrationsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS platform_integrations (
          id VARCHAR(64) NOT NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          config_json JSON NULL,
          secrets_enc TEXT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'not_configured',
          status_detail VARCHAR(500) NULL,
          last_checked_at TIMESTAMP NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          updated_by INT UNSIGNED NULL,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      )
      .then(() => undefined);
  }
  await schemaReady;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function decryptSecrets(enc: string | null): Record<string, string> {
  if (!enc) return {};
  try {
    const raw = decryptSecret(enc);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v != null && String(v).trim()) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

export async function getIntegration(id: IntegrationId): Promise<IntegrationRow | null> {
  await ensurePlatformIntegrationsSchema();
  const [rows] = await pool.query(
    `SELECT id, enabled, config_json, secrets_enc, status, status_detail, last_checked_at, updated_at, updated_by
     FROM platform_integrations WHERE id = :id LIMIT 1`,
    { id },
  );
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  return {
    id: String(row.id) as IntegrationId,
    enabled: Boolean(row.enabled),
    config: parseJson(row.config_json),
    secrets: decryptSecrets(row.secrets_enc != null ? String(row.secrets_enc) : null),
    status: (String(row.status || "not_configured") as IntegrationStatus) || "not_configured",
    statusDetail: row.status_detail != null ? String(row.status_detail) : null,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: row.updated_by != null ? Number(row.updated_by) : null,
  };
}

export async function listIntegrations(): Promise<IntegrationRow[]> {
  await ensurePlatformIntegrationsSchema();
  const ids: IntegrationId[] = ["google_oauth", "email_webhook"];
  const out: IntegrationRow[] = [];
  for (const id of ids) {
    const row = await getIntegration(id);
    if (row) out.push(row);
    else {
      out.push({
        id,
        enabled: false,
        config: {},
        secrets: {},
        status: "not_configured",
        statusDetail: null,
        lastCheckedAt: null,
        updatedAt: null,
        updatedBy: null,
      });
    }
  }
  return out;
}

export async function upsertIntegration(input: {
  id: IntegrationId;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Partial secrets; omit keys or blank to keep existing */
  secretsPatch?: Record<string, string | null | undefined>;
  status?: IntegrationStatus;
  statusDetail?: string | null;
  updatedBy?: number | null;
}): Promise<IntegrationRow> {
  await ensurePlatformIntegrationsSchema();
  const existing = await getIntegration(input.id);
  const secrets = { ...(existing?.secrets ?? {}) };
  if (input.secretsPatch) {
    for (const [k, v] of Object.entries(input.secretsPatch)) {
      if (v == null) continue;
      const trimmed = String(v).trim();
      if (!trimmed) continue; // blank = keep
      secrets[k] = trimmed;
    }
  }
  const secretsEnc = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
  const status = input.status ?? existing?.status ?? "not_configured";
  const statusDetail =
    input.statusDetail !== undefined ? input.statusDetail : (existing?.statusDetail ?? null);

  await pool.query(
    `INSERT INTO platform_integrations
      (id, enabled, config_json, secrets_enc, status, status_detail, updated_by)
     VALUES (:id, :enabled, CAST(:config AS JSON), :secrets, :status, :detail, :by)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       config_json = VALUES(config_json),
       secrets_enc = VALUES(secrets_enc),
       status = VALUES(status),
       status_detail = VALUES(status_detail),
       updated_by = VALUES(updated_by)`,
    {
      id: input.id,
      enabled: input.enabled ? 1 : 0,
      config: JSON.stringify(input.config ?? {}),
      secrets: secretsEnc,
      status,
      detail: statusDetail,
      by: input.updatedBy ?? null,
    },
  );
  invalidateIntegrationCache();
  const row = await getIntegration(input.id);
  if (!row) throw new Error("Failed to save integration");
  return row;
}

export async function updateIntegrationStatus(
  id: IntegrationId,
  status: IntegrationStatus,
  statusDetail: string | null,
): Promise<void> {
  await ensurePlatformIntegrationsSchema();
  await pool.query(
    `UPDATE platform_integrations
     SET status = :status, status_detail = :detail, last_checked_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { id, status, detail: statusDetail },
  );
  invalidateIntegrationCache();
}

type CacheBundle = {
  at: number;
  google: IntegrationRow | null;
  email: IntegrationRow | null;
};

let cache: CacheBundle | null = null;
const CACHE_MS = 3000;

export function invalidateIntegrationCache(): void {
  cache = null;
}

export async function loadIntegrationCache(): Promise<CacheBundle> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const [google, email] = await Promise.all([
    getIntegration("google_oauth"),
    getIntegration("email_webhook"),
  ]);
  cache = { at: Date.now(), google, email };
  return cache;
}

export function maskSecret(value: string | undefined | null): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}
