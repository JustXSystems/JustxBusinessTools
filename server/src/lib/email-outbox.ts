import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import {
  createArtifact,
  ensureArtifactDeliverySchema,
  readArtifactBytesById,
} from "./artifact-delivery.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId } from "./request-context.js";

export type EmailOutboxStatus =
  | "pending"
  | "sent"
  | "opened"
  | "failed"
  | "cancelled";

export type EmailOutboxRow = {
  id: string;
  organization_id: number;
  business_profile_id: number;
  user_id: number | null;
  tool_id: string;
  entity_type: string | null;
  entity_id: string | null;
  quote_no: string | null;
  to_addr: string;
  cc_addr: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  template_id: string | null;
  reply_to: string | null;
  from_name: string | null;
  from_email: string | null;
  artifact_id: string | null;
  filename: string | null;
  status: EmailOutboxStatus;
  last_error: string | null;
  last_channel: string | null;
  attempt_count: number;
  sent_at: Date | string | null;
  opened_at: Date | string | null;
  cancelled_at: Date | string | null;
  meta: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

let schemaReady: Promise<void> | null = null;

export async function ensureEmailOutboxSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_outbox (
          id VARCHAR(64) NOT NULL,
          organization_id INT UNSIGNED NOT NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          user_id INT UNSIGNED NULL,
          tool_id VARCHAR(40) NOT NULL DEFAULT 'quotation-v1',
          entity_type VARCHAR(40) NULL,
          entity_id VARCHAR(64) NULL,
          quote_no VARCHAR(80) NULL,
          to_addr VARCHAR(512) NOT NULL,
          cc_addr VARCHAR(1024) NULL,
          subject VARCHAR(512) NOT NULL,
          body_text MEDIUMTEXT NOT NULL,
          body_html MEDIUMTEXT NULL,
          template_id VARCHAR(40) NULL,
          reply_to VARCHAR(512) NULL,
          from_name VARCHAR(255) NULL,
          from_email VARCHAR(255) NULL,
          artifact_id VARCHAR(64) NULL,
          filename VARCHAR(255) NULL,
          status VARCHAR(24) NOT NULL DEFAULT 'pending',
          last_error VARCHAR(1024) NULL,
          last_channel VARCHAR(40) NULL,
          attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
          sent_at DATETIME NULL,
          opened_at DATETIME NULL,
          cancelled_at DATETIME NULL,
          meta JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_email_outbox_profile_status (business_profile_id, status, created_at),
          KEY idx_email_outbox_org (organization_id, created_at),
          KEY idx_email_outbox_artifact (artifact_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function newOutboxId() {
  return `eml_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function emailWebhookConfigured(): boolean {
  return Boolean(
    (process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL ?? "").trim(),
  );
}

export function getEmailWebhookUrl(): string | null {
  const u = (process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL ?? "").trim();
  return u || null;
}

export function mapOutboxPublic(row: EmailOutboxRow) {
  return {
    id: row.id,
    toolId: row.tool_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    quoteNo: row.quote_no,
    to: row.to_addr,
    cc: row.cc_addr ?? "",
    subject: row.subject,
    body: row.body_text,
    html: row.body_html,
    templateId: row.template_id,
    replyTo: row.reply_to,
    fromName: row.from_name,
    fromEmail: row.from_email,
    artifactId: row.artifact_id,
    filename: row.filename,
    status: row.status,
    lastError: row.last_error,
    lastChannel: row.last_channel,
    attemptCount: Number(row.attempt_count) || 0,
    sentAt: row.sent_at ? String(row.sent_at) : null,
    openedAt: row.opened_at ? String(row.opened_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    meta: row.meta,
  };
}

export type CreateEmailOutboxInput = {
  toolId?: string;
  entityType?: string | null;
  entityId?: string | null;
  quoteNo?: string | null;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  html?: string | null;
  templateId?: string | null;
  replyTo?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  filename?: string | null;
  pdfBase64?: string | null;
  artifactId?: string | null;
  status?: EmailOutboxStatus;
  lastChannel?: string | null;
  lastError?: string | null;
  meta?: Record<string, unknown> | null;
};

export async function createEmailOutbox(input: CreateEmailOutboxInput): Promise<EmailOutboxRow> {
  await ensureEmailOutboxSchema();
  await ensureArtifactDeliverySchema();

  const to = String(input.to ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!to) throw new Error("Email To is required");
  if (!subject || !body) throw new Error("Subject and message are required");

  let artifactId = input.artifactId?.trim() || null;
  const filename =
    String(input.filename ?? "").trim() ||
    (input.quoteNo ? `Quotation-${input.quoteNo}.pdf` : "quotation.pdf");

  if (!artifactId && input.pdfBase64?.trim()) {
    const staged = await createArtifact({
      organizationId: getActiveOrgId(),
      businessProfileId: getActiveProfileId(),
      userId: getActiveUserId() || 0,
      toolId: input.toolId || "quotation-v1",
      filename,
      mimeType: "application/pdf",
      contentBase64: input.pdfBase64.trim(),
      conflictPolicy: "overwrite",
      meta: {
        kind: "email_outbox",
        quoteNo: input.quoteNo ?? null,
        entityId: input.entityId ?? null,
      },
      skipDispatch: true,
    });
    artifactId = staged.artifact.id;
  }

  const id = newOutboxId();
  const status = input.status ?? "pending";
  await pool.query(
    `INSERT INTO email_outbox (
       id, organization_id, business_profile_id, user_id, tool_id,
       entity_type, entity_id, quote_no, to_addr, cc_addr, subject,
       body_text, body_html, template_id, reply_to, from_name, from_email,
       artifact_id, filename, status, last_error, last_channel, attempt_count,
       sent_at, meta
     ) VALUES (
       :id, :orgId, :profileId, :userId, :toolId,
       :entityType, :entityId, :quoteNo, :toAddr, :ccAddr, :subject,
       :bodyText, :bodyHtml, :templateId, :replyTo, :fromName, :fromEmail,
       :artifactId, :filename, :status, :lastError, :lastChannel, :attempts,
       :sentAt, :meta
     )`,
    {
      id,
      orgId: getActiveOrgId(),
      profileId: getActiveProfileId(),
      userId: getActiveUserId() || null,
      toolId: input.toolId || "quotation-v1",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      quoteNo: input.quoteNo ?? null,
      toAddr: to,
      ccAddr: String(input.cc ?? "").trim() || null,
      subject,
      bodyText: body,
      bodyHtml: input.html?.trim() || null,
      templateId: input.templateId ?? null,
      replyTo: input.replyTo?.trim() || null,
      fromName: input.fromName?.trim() || null,
      fromEmail: input.fromEmail?.trim() || null,
      artifactId,
      filename,
      status,
      lastError: input.lastError ?? null,
      lastChannel: input.lastChannel ?? null,
      attempts: status === "sent" || status === "failed" ? 1 : 0,
      sentAt: status === "sent" ? new Date() : null,
      meta: input.meta ? JSON.stringify(input.meta) : null,
    },
  );

  const row = await getEmailOutboxById(id);
  if (!row) throw new Error("Failed to create email outbox row");
  return row;
}

export async function getEmailOutboxById(id: string): Promise<EmailOutboxRow | null> {
  await ensureEmailOutboxSchema();
  const [rows] = await pool.query(
    `SELECT * FROM email_outbox
     WHERE id = :id AND business_profile_id = :profileId
     LIMIT 1`,
    { id, profileId: getActiveProfileId() },
  );
  const row = Array.isArray(rows) ? (rows[0] as EmailOutboxRow | undefined) : undefined;
  return row ?? null;
}

export async function listEmailOutbox(opts?: {
  status?: string;
  pendingOnly?: boolean;
  limit?: number;
}): Promise<EmailOutboxRow[]> {
  await ensureEmailOutboxSchema();
  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 200);
  const pendingOnly = Boolean(opts?.pendingOnly);
  const status = String(opts?.status ?? "").trim();

  let where = `business_profile_id = :profileId`;
  const params: { profileId: number; status?: string } = {
    profileId: getActiveProfileId(),
  };
  if (pendingOnly) {
    where += ` AND status IN ('pending','failed')`;
  } else if (status) {
    where += ` AND status = :status`;
    params.status = status;
  }

  const [rows] = await pool.query(
    `SELECT * FROM email_outbox
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
    params,
  );
  return (Array.isArray(rows) ? rows : []) as EmailOutboxRow[];
}

export async function updateEmailOutboxStatus(
  id: string,
  patch: {
    status: EmailOutboxStatus;
    lastChannel?: string | null;
    lastError?: string | null;
    incrementAttempt?: boolean;
  },
): Promise<EmailOutboxRow | null> {
  await ensureEmailOutboxSchema();
  const sets = [
    `status = :status`,
    `last_channel = :lastChannel`,
    `last_error = :lastError`,
  ];
  if (patch.incrementAttempt) sets.push(`attempt_count = attempt_count + 1`);
  if (patch.status === "sent") sets.push(`sent_at = CURRENT_TIMESTAMP`);
  if (patch.status === "opened") sets.push(`opened_at = CURRENT_TIMESTAMP`);
  if (patch.status === "cancelled") sets.push(`cancelled_at = CURRENT_TIMESTAMP`);

  await pool.query(
    `UPDATE email_outbox SET ${sets.join(", ")}
     WHERE id = :id AND business_profile_id = :profileId`,
    {
      id,
      profileId: getActiveProfileId(),
      status: patch.status,
      lastChannel: patch.lastChannel ?? null,
      lastError: patch.lastError ?? null,
    },
  );
  return getEmailOutboxById(id);
}

export async function postEmailWebhookPayload(payload: Record<string, unknown>): Promise<void> {
  const webhook = getEmailWebhookUrl();
  if (!webhook) throw new Error("EMAIL_WEBHOOK_URL is not configured");
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    throw new Error(`Email webhook ${r.status}: ${(await r.text()).slice(0, 180)}`);
  }
}

export async function buildWebhookPayloadFromOutbox(row: EmailOutboxRow): Promise<Record<string, unknown>> {
  let pdfBase64: string | null = null;
  if (row.artifact_id) {
    try {
      const bytes = await readArtifactBytesById(row.artifact_id);
      pdfBase64 = Buffer.from(bytes).toString("base64");
    } catch {
      pdfBase64 = null;
    }
  }
  return {
    channel: "email",
    to: row.to_addr,
    cc: row.cc_addr || undefined,
    subject: row.subject,
    body: row.body_text,
    html: row.body_html || undefined,
    templateId: row.template_id || undefined,
    replyTo: row.reply_to || undefined,
    fromName: row.from_name || undefined,
    fromEmail: row.from_email || undefined,
    from:
      row.from_email && row.from_name
        ? `${row.from_name} <${row.from_email}>`
        : row.from_email || row.from_name || undefined,
    kind: `${row.tool_id}.outbox`,
    outboxId: row.id,
    quotationId: row.entity_id,
    quoteNo: row.quote_no,
    pdfBase64,
    filename: row.filename,
  };
}

export async function sendOutboxViaWebhook(id: string): Promise<EmailOutboxRow> {
  const row = await getEmailOutboxById(id);
  if (!row) throw new Error("Outbox item not found");
  if (row.status === "cancelled") throw new Error("This email was cancelled");
  try {
    const payload = await buildWebhookPayloadFromOutbox(row);
    await postEmailWebhookPayload(payload);
    const updated = await updateEmailOutboxStatus(id, {
      status: "sent",
      lastChannel: "webhook",
      lastError: null,
      incrementAttempt: true,
    });
    if (!updated) throw new Error("Failed to update outbox");
    return updated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook send failed";
    await updateEmailOutboxStatus(id, {
      status: "failed",
      lastChannel: "webhook",
      lastError: msg,
      incrementAttempt: true,
    });
    throw new Error(msg);
  }
}

/** Agent-facing: load outbox without profile filter when agent token scopes profile. */
export async function getEmailOutboxForAgent(id: string): Promise<EmailOutboxRow | null> {
  await ensureEmailOutboxSchema();
  const [rows] = await pool.query(
    `SELECT * FROM email_outbox
     WHERE id = :id AND business_profile_id = :profileId
     LIMIT 1`,
    { id, profileId: getActiveProfileId() },
  );
  return Array.isArray(rows) ? ((rows[0] as EmailOutboxRow) ?? null) : null;
}

export type { ArtifactRow } from "./artifact-delivery.js";
