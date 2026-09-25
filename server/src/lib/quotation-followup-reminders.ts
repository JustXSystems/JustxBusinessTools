import { pool } from "../db.js";
import {
  createEmailOutbox,
  emailWebhookConfigured,
  sendOutboxViaWebhook,
} from "./email-outbox.js";
import {
  ensureSendSettingsColumn,
  normalizeProfileSendSettings,
  type ProfileFollowUpReminderSettings,
} from "./profile-send-settings.js";
import { runWithContext } from "./request-context.js";
import { webAppUrl } from "./web-public-url.js";

const QUOTATION_TOOL_ID = "quotationv1";
/** Decided quotations need no follow-up. */
const CLOSED_STATUSES = ["approved", "rejected"];

export const FOLLOW_UP_REMINDER_TIMEZONE_DEFAULT = "Asia/Kolkata";

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export type ReminderMember = { email: string; name: string | null };

export type FollowUpReminderRunResult = {
  profileId: number;
  due: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

/** Split a comma / semicolon / whitespace separated list into unique valid emails (case-insensitive). */
export function parseEmailList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,;\s]+/)) {
    const email = part.trim();
    if (!email || !isEmail(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** `YYYY-MM-DD` and hour (0–23) for `now` in the given IANA time zone. */
export function localDateParts(
  now: Date,
  timeZone: string,
): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) || 0,
  };
}

/**
 * Resolve the Prepared By text to a team member email.
 * Quotation tool seeds Prepared By with the user's name, or the email local part when name is blank.
 */
export function matchPreparedByEmail(
  preparedBy: string,
  members: ReminderMember[],
): string | null {
  const needle = preparedBy.trim().toLowerCase();
  if (!needle) return null;
  if (isEmail(needle)) return preparedBy.trim();

  const byName = members.find((m) => (m.name ?? "").trim().toLowerCase() === needle);
  if (byName) return byName.email;
  const byLocalPart = members.find(
    (m) => m.email.split("@")[0]?.toLowerCase() === needle,
  );
  return byLocalPart?.email ?? null;
}

/** To = Prepared By; CC = owners + extra list, excluding the To address. Falls back to CC as To. */
export function buildReminderRecipients(input: {
  creatorEmail: string | null;
  ownerEmails: string[];
  settings: Pick<ProfileFollowUpReminderSettings, "ccOwners" | "cc">;
}): { to: string[]; cc: string[] } {
  const ccPool = parseEmailList(
    [...(input.settings.ccOwners ? input.ownerEmails : []), input.settings.cc].join(","),
  );
  const creator = input.creatorEmail && isEmail(input.creatorEmail) ? input.creatorEmail : null;
  if (!creator) return { to: ccPool, cc: [] };
  const creatorKey = creator.toLowerCase();
  return { to: [creator], cc: ccPool.filter((e) => e.toLowerCase() !== creatorKey) };
}

export function fillReminderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reminderTextToHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933">${body}</div>`;
}

function fmtDisplayDate(iso: string): string {
  const s = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${s}T00:00:00Z`));
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value ?? "").slice(0, 10);
}

function fmtAmount(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

let schemaReady: Promise<void> | null = null;

export async function ensureFollowUpReminderSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS quotation_followup_reminders (
          document_id VARCHAR(64) NOT NULL,
          reminder_date DATE NOT NULL,
          business_profile_id INT UNSIGNED NOT NULL,
          outbox_id VARCHAR(64) NULL,
          status VARCHAR(24) NOT NULL DEFAULT 'claimed',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (document_id, reminder_date),
          KEY idx_qfr_profile_date (business_profile_id, reminder_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

/** One reminder per quotation per day, even when API and worker both run the scheduler. */
async function claimReminder(
  documentId: string,
  reminderDate: string,
  profileId: number,
): Promise<boolean> {
  const [res] = await pool.query(
    `INSERT IGNORE INTO quotation_followup_reminders (document_id, reminder_date, business_profile_id)
     VALUES (:documentId, :reminderDate, :profileId)`,
    { documentId, reminderDate, profileId },
  );
  return Number((res as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

async function markReminder(
  documentId: string,
  reminderDate: string,
  status: string,
  outboxId: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE quotation_followup_reminders SET status = :status, outbox_id = :outboxId
     WHERE document_id = :documentId AND reminder_date = :reminderDate`,
    { documentId, reminderDate, status, outboxId },
  );
}

async function loadActiveMembers(orgId: number): Promise<{
  members: ReminderMember[];
  ownerEmails: string[];
  emailById: Map<number, string>;
}> {
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name, m.role
     FROM org_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = :orgId AND u.status = 'active'
     ORDER BY m.id`,
    { orgId },
  );
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    id: number;
    email: string;
    name: string | null;
    role: string;
  }>;
  return {
    members: list.map((r) => ({ email: r.email, name: r.name })),
    ownerEmails: list.filter((r) => r.role === "owner").map((r) => r.email),
    emailById: new Map(list.map((r) => [Number(r.id), r.email])),
  };
}

/** Creator user id: stamped on new quotations, else the original create audit event. */
async function resolveCreatorUserId(
  documentId: string,
  data: Record<string, unknown>,
): Promise<number | null> {
  const stamped = Number(data.createdByUserId);
  if (Number.isInteger(stamped) && stamped > 0) return stamped;
  const [rows] = await pool.query(
    `SELECT user_id FROM audit_events
     WHERE action = 'quotationv1.create' AND entity_id = :id AND user_id IS NOT NULL
     ORDER BY id ASC LIMIT 1`,
    { id: documentId },
  );
  const row = Array.isArray(rows) ? (rows[0] as { user_id?: number } | undefined) : undefined;
  return row?.user_id ? Number(row.user_id) : null;
}

type ProfileRow = {
  id: number;
  organization_id: number;
  business_name: string;
  phone: string | null;
  email: string | null;
  send_settings: unknown;
};

type QuoteRow = {
  id: string;
  doc_no: string;
  doc_date: unknown;
  extra_date: unknown;
  party_name: string | null;
  grand_total: number | string;
  status: string;
  data: unknown;
};

function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

async function loadProfile(profileId: number): Promise<ProfileRow | null> {
  const [rows] = await pool.query(
    `SELECT id, organization_id, business_name, phone, email, send_settings
     FROM business_profiles WHERE id = :id LIMIT 1`,
    { id: profileId },
  );
  return Array.isArray(rows) ? ((rows[0] as ProfileRow | undefined) ?? null) : null;
}

async function listDueQuotations(profileId: number, today: string): Promise<QuoteRow[]> {
  const [rows] = await pool.query(
    `SELECT id, doc_no, doc_date, extra_date, party_name, grand_total, status, data
     FROM document_records
     WHERE business_profile_id = :profileId
       AND tool_id = :toolId
       AND status NOT IN (${CLOSED_STATUSES.map((_, i) => `:closed${i}`).join(",")})
       AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.followUpDate')) = :today`,
    {
      profileId,
      toolId: QUOTATION_TOOL_ID,
      today,
      ...Object.fromEntries(CLOSED_STATUSES.map((s, i) => [`closed${i}`, s])),
    },
  );
  return (Array.isArray(rows) ? rows : []) as QuoteRow[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Send today's follow-up reminders for one Business Profile.
 * Uses the profile's Email webhook (Path A); without one, rows are queued in Email Outbox.
 */
export async function runFollowUpRemindersForProfile(
  profileId: number,
  today: string,
): Promise<FollowUpReminderRunResult> {
  const result: FollowUpReminderRunResult = {
    profileId,
    due: 0,
    sent: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
  };
  await ensureFollowUpReminderSchema();
  const profile = await loadProfile(profileId);
  if (!profile) return result;
  const settings = normalizeProfileSendSettings(profile.send_settings);
  const reminder = settings.followUpReminder;
  if (!reminder.enabled) return result;

  const orgId = Number(profile.organization_id) || 1;
  return runWithContext(
    {
      userId: null,
      organizationId: orgId,
      businessProfileId: profileId,
      role: "legacy",
      sessionId: null,
      isPlatformAdmin: false,
    },
    async () => {
      const quotes = await listDueQuotations(profileId, today);
      result.due = quotes.length;
      if (!quotes.length) return result;

      const { members, ownerEmails, emailById } = await loadActiveMembers(orgId);
      const webhookOn = await emailWebhookConfigured(profileId);
      const replyTo = settings.email.replyTo || profile.email || null;
      const quotationLink = webAppUrl("/tools/quotationv1");

      for (const q of quotes) {
        const data = parseData(q.data);
        const preparedBy = String(data.preparedBy ?? "").trim();
        let creatorEmail = matchPreparedByEmail(preparedBy, members);
        if (!creatorEmail) {
          const creatorId = await resolveCreatorUserId(q.id, data);
          creatorEmail = creatorId ? (emailById.get(creatorId) ?? null) : null;
        }
        const { to, cc } = buildReminderRecipients({
          creatorEmail,
          ownerEmails,
          settings: reminder,
        });
        if (!to.length) {
          result.skipped += 1;
          console.warn(
            `[followup-reminders] profile=${profileId} quote=${q.doc_no} skipped — no recipient for Prepared By "${preparedBy}"`,
          );
          continue;
        }
        if (!(await claimReminder(q.id, today, profileId))) {
          result.skipped += 1;
          continue;
        }

        const customer =
          data.customer && typeof data.customer === "object"
            ? (data.customer as Record<string, unknown>)
            : {};
        const category = String(data.category ?? "").trim();
        const engagement = String(data.engagement ?? "").trim();
        const vars: Record<string, string> = {
          preparedBy: preparedBy || "team",
          quoteNo: q.doc_no,
          customerName: String(customer.name ?? q.party_name ?? "").trim(),
          customerCompany: String(customer.company ?? "").trim(),
          customerPhone: String(customer.phone ?? "").trim(),
          customerEmail: String(customer.email ?? "").trim(),
          typeLabel:
            String(data.categoryCustomLabel ?? "").trim() ||
            [category.toUpperCase(), engagement.toUpperCase()].filter(Boolean).join(" · "),
          date: fmtDisplayDate(toIsoDate(q.doc_date)),
          validTill: fmtDisplayDate(toIsoDate(q.extra_date)),
          followUpDate: fmtDisplayDate(today),
          grandTotal: fmtAmount(Number(q.grand_total)),
          status: titleCase(String(q.status ?? "")),
          companyName: profile.business_name || "",
          companyPhone: profile.phone ?? "",
          companyEmail: profile.email ?? "",
          quotationLink,
        };
        const subject = fillReminderTemplate(reminder.subject, vars).trim();
        const body = fillReminderTemplate(reminder.message, vars).trim();

        try {
          const outbox = await createEmailOutbox({
            toolId: "quotation-v1",
            entityType: "quotation",
            entityId: q.id,
            quoteNo: q.doc_no,
            to: to.join(", "),
            cc: cc.join(", "),
            subject,
            body,
            html: reminderTextToHtml(body),
            templateId: "followup-reminder",
            replyTo,
            fromName: profile.business_name || null,
            status: "pending",
            lastChannel: webhookOn ? "webhook" : "queued",
            meta: { kind: "quotation.followup_reminder", followUpDate: today },
          });
          if (!webhookOn) {
            await markReminder(q.id, today, "queued", outbox.id);
            result.queued += 1;
            continue;
          }
          try {
            await sendOutboxViaWebhook(outbox.id);
            await markReminder(q.id, today, "sent", outbox.id);
            result.sent += 1;
          } catch (err) {
            await markReminder(q.id, today, "failed", outbox.id);
            result.failed += 1;
            console.warn(
              `[followup-reminders] profile=${profileId} quote=${q.doc_no} webhook failed`,
              err instanceof Error ? err.message : err,
            );
          }
        } catch (err) {
          await markReminder(q.id, today, "failed", null);
          result.failed += 1;
          console.warn(
            `[followup-reminders] profile=${profileId} quote=${q.doc_no} failed`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      return result;
    },
  );
}

/** Profiles with the follow-up reminder checkbox enabled. */
export async function listReminderEnabledProfileIds(): Promise<number[]> {
  await ensureSendSettingsColumn();
  const [rows] = await pool.query(
    `SELECT id, send_settings FROM business_profiles WHERE send_settings IS NOT NULL`,
  );
  const list = (Array.isArray(rows) ? rows : []) as Array<{ id: number; send_settings: unknown }>;
  return list
    .filter((r) => normalizeProfileSendSettings(r.send_settings).followUpReminder.enabled)
    .map((r) => Number(r.id));
}
