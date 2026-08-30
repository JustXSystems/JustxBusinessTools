import { Router } from "express";
import { pool } from "../db.js";
import { logAudit } from "../lib/audit.js";
import {
  ensureHomeToolIdsColumn,
  normalizeHomeToolIdsInput,
  parseHomeToolIds,
} from "../lib/home-tools.js";
import {
  ensureArtifactDeliverySchema,
  normalizeConflictPolicy,
  validateDownloadFolderPath,
} from "../lib/artifact-delivery.js";
import {
  ensureDeliveryConfigColumns,
  loadProfileDeliveryConfig,
  publicDeliveryConfig,
  validateWebhookUrl,
  type ArtifactDestination,
} from "../lib/artifact-dispatch.js";
import {
  ensureSendSettingsColumn,
  mergeSendSettingsPreservingDriveSecrets,
  normalizeProfileSendSettings,
  publicSendSettings,
  serializeProfileSendSettings,
} from "../lib/profile-send-settings.js";
import { getActiveOrgId, getActiveProfileId } from "../lib/request-context.js";
import { gstinTakenByOther, isValidGstin, normalizeGstin } from "../lib/gstin.js";
import { isStoredImageUrl, saveImageUpload } from "../lib/storage.js";
import { requireBusinessProfileOwner } from "../middleware/require-business-profile-owner.js";
import { requireWriteAccess } from "../middleware/require-write.js";
import { publishNotificationAsync } from "../lib/notification-publish.js";

const router = Router();

type ProfileRow = {
  id: number;
  logo_data_url: string | null;
  business_name: string;
  address_line1: string | null;
  address_line2: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  state_code: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  bank_upi: string | null;
  terms: string | null;
  home_tool_ids?: unknown;
  send_settings?: unknown;
  download_folder?: string | null;
  download_folder_conflict_policy?: string | null;
  artifact_destination?: string | null;
  artifact_webhook_url?: string | null;
  artifact_webhook_secret?: string | null;
};

function toApi(row: ProfileRow, deliveryExtra?: ReturnType<typeof publicDeliveryConfig> | null) {
  return {
    id: row.id,
    logo: row.logo_data_url,
    businessName: row.business_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    gstin: row.gstin,
    pan: row.pan,
    state: row.state,
    stateCode: row.state_code,
    phone: row.phone,
    email: row.email,
    bankName: row.bank_name,
    bankBranch: row.bank_branch,
    bankAccount: row.bank_account,
    bankIfsc: row.bank_ifsc,
    bankUpi: row.bank_upi,
    terms: row.terms,
    homeToolIds: parseHomeToolIds(row.home_tool_ids),
    sendSettings: publicSendSettings(row.send_settings),
    downloadFolder: row.download_folder ?? null,
    downloadFolderConflictPolicy: normalizeConflictPolicy(
      row.download_folder_conflict_policy,
    ),
    artifactDestination: (row.artifact_destination as ArtifactDestination) || "auto",
    artifactWebhookUrl: row.artifact_webhook_url ?? null,
    artifactWebhookSecretConfigured: Boolean(row.artifact_webhook_secret),
    delivery: deliveryExtra ?? null,
  };
}

async function ensureProfileExtras() {
  await ensureHomeToolIdsColumn();
  await ensureSendSettingsColumn();
  await ensureArtifactDeliverySchema();
  await ensureDeliveryConfigColumns();
}

/** One-time: copy legacy quotation letterhead send config into profile if empty. */
async function maybeMigrateLegacySendSettings(profileId: number, current: unknown): Promise<unknown> {
  if (current != null && String(current).trim() !== "" && String(current) !== "null") {
    const normalized = normalizeProfileSendSettings(current);
    const hasAny =
      normalized.whatsappNumbers.some((n) => n.phone) ||
      Boolean(normalized.email.to || normalized.email.cc || normalized.googleDrive.folderId);
    if (hasAny) return current;
  }

  const [orgRows] = await pool.query(
    `SELECT organization_id FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: profileId },
  );
  const org = Array.isArray(orgRows) ? (orgRows[0] as { organization_id?: number } | undefined) : undefined;
  if (!org?.organization_id) return current;

  const [cfgRows] = await pool.query(
    `SELECT value FROM platform_config WHERE config_key = :key LIMIT 1`,
    { key: `quotation_v1_company:${org.organization_id}` },
  );
  const cfgRow = Array.isArray(cfgRows) ? (cfgRows[0] as { value: unknown } | undefined) : undefined;
  if (!cfgRow) return current;
  let company: Record<string, unknown> = {};
  try {
    const raw = typeof cfgRow.value === "string" ? JSON.parse(cfgRow.value) : cfgRow.value;
    company = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return current;
  }
  if (!company.send) return current;
  const migrated = serializeProfileSendSettings(company.send);
  const migratedHas =
    migrated.whatsappNumbers.length > 0 ||
    Boolean(migrated.email.to || migrated.email.cc || migrated.googleDrive.folderId);
  if (!migratedHas) return current;

  await pool.query(`UPDATE business_profiles SET send_settings = :send WHERE id = :id`, {
    id: profileId,
    send: JSON.stringify(migrated),
  });
  return migrated;
}

router.get("/", async (_req, res) => {
  await ensureProfileExtras();
  const profileId = getActiveProfileId();
  const [rows] = await pool.query("SELECT * FROM business_profiles WHERE id = :id", {
    id: profileId,
  });
  const row = (Array.isArray(rows) ? rows[0] : null) as ProfileRow | null;
  if (!row) {
    res.status(404).json({ error: "Business profile not found" });
    return;
  }
  const sendRaw = await maybeMigrateLegacySendSettings(profileId, row.send_settings);
  const cfg = await loadProfileDeliveryConfig(profileId);
  res.json(
    toApi(
      { ...row, send_settings: sendRaw },
      cfg ? publicDeliveryConfig(cfg) : null,
    ),
  );
});

router.put("/", requireWriteAccess, requireBusinessProfileOwner, async (req, res) => {
  await ensureProfileExtras();
  const profileId = getActiveProfileId();
  const body = req.body ?? {};
  const businessName = String(body.businessName ?? "").trim();
  const gstinRaw = body.gstin ? normalizeGstin(body.gstin) : "";
  const gstin = gstinRaw || null;
  if (gstin && !isValidGstin(gstin)) {
    res.status(400).json({ error: "GSTIN must be 15 characters (e.g. 29ABCDE1234F1Z5)" });
    return;
  }
  if (gstin && (await gstinTakenByOther(gstin, profileId))) {
    res.status(409).json({ error: "This GSTIN is already registered to another business profile" });
    return;
  }

  const [currentRows] = await pool.query(
    `SELECT logo_data_url, send_settings FROM business_profiles WHERE id = :id`,
    { id: profileId },
  );
  const current = (Array.isArray(currentRows) ? currentRows[0] : null) as {
    logo_data_url: string | null;
    send_settings: unknown;
  } | null;

  let logo = current?.logo_data_url ?? null;
  if (body.logo === null) {
    logo = null;
  } else if (typeof body.logo === "string" && body.logo.trim()) {
    if (isStoredImageUrl(body.logo.trim())) {
      logo = body.logo.trim();
    } else {
      logo = await saveImageUpload(String(body.logo), "logos");
    }
  }

  const homeToolIds =
    body.homeToolIds === undefined ? undefined : normalizeHomeToolIdsInput(body.homeToolIds);

  const sendSettings =
    body.sendSettings === undefined
      ? normalizeProfileSendSettings(current?.send_settings)
      : mergeSendSettingsPreservingDriveSecrets(body.sendSettings, current?.send_settings);

  let downloadFolder: string | null | undefined = undefined;
  if (body.downloadFolder !== undefined) {
    try {
      downloadFolder = validateDownloadFolderPath(body.downloadFolder);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid Download Folder" });
      return;
    }
  }
  const conflictPolicy =
    body.downloadFolderConflictPolicy !== undefined
      ? normalizeConflictPolicy(body.downloadFolderConflictPolicy)
      : undefined;

  let artifactDestination: ArtifactDestination | undefined;
  if (body.artifactDestination !== undefined) {
    const v = String(body.artifactDestination).trim().toLowerCase();
    if (!["auto", "google_drive", "webhook", "unc_agent", "none"].includes(v)) {
      res.status(400).json({ error: "Invalid artifact destination" });
      return;
    }
    artifactDestination = v as ArtifactDestination;
  }

  let artifactWebhookUrl: string | null | undefined;
  if (body.artifactWebhookUrl !== undefined) {
    try {
      artifactWebhookUrl = validateWebhookUrl(body.artifactWebhookUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid webhook URL" });
      return;
    }
  }

  let artifactWebhookSecret: string | null | undefined;
  if (body.artifactWebhookSecret !== undefined) {
    const s = String(body.artifactWebhookSecret ?? "").trim();
    // Empty string clears; omit field to keep existing.
    artifactWebhookSecret = s ? s.slice(0, 255) : null;
  }

  await pool.query(
    `UPDATE business_profiles SET
      logo_data_url = :logo,
      business_name = :businessName,
      address_line1 = :addressLine1,
      address_line2 = :addressLine2,
      gstin = :gstin,
      pan = :pan,
      state = :state,
      state_code = :stateCode,
      phone = :phone,
      email = :email,
      bank_name = :bankName,
      bank_branch = :bankBranch,
      bank_account = :bankAccount,
      bank_ifsc = :bankIfsc,
      bank_upi = :bankUpi,
      terms = :terms,
      send_settings = :sendSettings
      ${homeToolIds !== undefined ? ", home_tool_ids = :homeToolIds" : ""}
      ${downloadFolder !== undefined ? ", download_folder = :downloadFolder" : ""}
      ${conflictPolicy !== undefined ? ", download_folder_conflict_policy = :conflictPolicy" : ""}
      ${artifactDestination !== undefined ? ", artifact_destination = :artifactDestination" : ""}
      ${artifactWebhookUrl !== undefined ? ", artifact_webhook_url = :artifactWebhookUrl" : ""}
      ${artifactWebhookSecret !== undefined ? ", artifact_webhook_secret = :artifactWebhookSecret" : ""}
     WHERE id = :id`,
    {
      id: profileId,
      logo,
      businessName,
      addressLine1: body.addressLine1 || null,
      addressLine2: body.addressLine2 || null,
      gstin,
      pan: body.pan || null,
      state: body.state || null,
      stateCode: body.stateCode || null,
      phone: body.phone || null,
      email: body.email || null,
      bankName: body.bankName || null,
      bankBranch: body.bankBranch || null,
      bankAccount: body.bankAccount || null,
      bankIfsc: body.bankIfsc || null,
      bankUpi: body.bankUpi || null,
      terms: body.terms || null,
      sendSettings: JSON.stringify(sendSettings),
      ...(homeToolIds !== undefined ? { homeToolIds: JSON.stringify(homeToolIds) } : {}),
      ...(downloadFolder !== undefined ? { downloadFolder } : {}),
      ...(conflictPolicy !== undefined ? { conflictPolicy } : {}),
      ...(artifactDestination !== undefined ? { artifactDestination } : {}),
      ...(artifactWebhookUrl !== undefined ? { artifactWebhookUrl } : {}),
      ...(artifactWebhookSecret !== undefined ? { artifactWebhookSecret } : {}),
    },
  );

  const [rows] = await pool.query("SELECT * FROM business_profiles WHERE id = :id", {
    id: profileId,
  });
  const row = (Array.isArray(rows) ? rows[0] : null) as ProfileRow;
  await logAudit("profile.update", "business_profile", String(profileId), undefined, req.ip);
  publishNotificationAsync({
    eventType: "business.profile_updated",
    title: "Business profile updated",
    body: `${row.business_name || "Branch"} details were updated by the owner.`,
    organizationId: getActiveOrgId(),
    businessProfileId: profileId,
    href: "/profile",
    entityType: "business_profile",
    entityId: String(profileId),
    dedupeKey: `profile-upd:${profileId}:${Date.now()}`,
    expiresInHours: 72,
  });
  const cfg = await loadProfileDeliveryConfig(profileId);
  res.json(toApi(row, cfg ? publicDeliveryConfig(cfg) : null));
});

export default router;
