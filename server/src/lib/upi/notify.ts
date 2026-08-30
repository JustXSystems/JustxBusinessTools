import { pool } from "../../db.js";
import { getUpiNotify, type UpiNotify } from "./config.js";

export type NotifyVars = Record<string, string | number | null | undefined>;

export function fillTemplate(template: string, vars: NotifyVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

async function logOutbox(row: {
  channel: string;
  destination: string;
  subject?: string;
  body: string;
  kind: string;
  claimId?: number | null;
  status: string;
  error?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO notify_outbox
       (channel, destination, subject, body, kind, claim_id, status, error_message)
     VALUES (:channel, :destination, :subject, :body, :kind, :claimId, :status, :error)`,
    {
      channel: row.channel,
      destination: row.destination,
      subject: row.subject ?? null,
      body: row.body,
      kind: row.kind,
      claimId: row.claimId ?? null,
      status: row.status,
      error: row.error ?? null,
    },
  );
}

async function postWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }
}

async function sendEmail(to: string, subject: string, body: string, kind: string, claimId?: number) {
  const url = process.env.EMAIL_WEBHOOK_URL ?? process.env.NOTIFY_EMAIL_WEBHOOK_URL;
  try {
    if (url) {
      await postWebhook(url, { channel: "email", to, subject, body, kind });
    } else {
      console.log(`[notify:email] to=${to} subject=${subject}\n${body}`);
    }
    await logOutbox({ channel: "email", destination: to, subject, body, kind, claimId, status: "sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "email failed";
    await logOutbox({
      channel: "email",
      destination: to,
      subject,
      body,
      kind,
      claimId,
      status: "failed",
      error: msg,
    });
  }
}

async function sendWhatsapp(to: string, body: string, kind: string, claimId?: number) {
  if (!to) return;
  const url = process.env.WHATSAPP_WEBHOOK_URL ?? process.env.NOTIFY_WHATSAPP_WEBHOOK_URL;
  try {
    if (url) {
      await postWebhook(url, { channel: "whatsapp", to, message: body, kind });
    } else {
      console.log(`[notify:whatsapp] to=${to}\n${body}`);
    }
    await logOutbox({ channel: "whatsapp", destination: to, body, kind, claimId, status: "sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "whatsapp failed";
    await logOutbox({
      channel: "whatsapp",
      destination: to,
      body,
      kind,
      claimId,
      status: "failed",
      error: msg,
    });
  }
}

export async function notifyClaimSubmitted(vars: NotifyVars, claimId: number): Promise<void> {
  const cfg: UpiNotify = await getUpiNotify();
  const subject = fillTemplate(cfg.submitSubject, vars);
  const body = fillTemplate(cfg.submitBody, vars);
  if (cfg.emailEnabled && cfg.emailTo) {
    await sendEmail(cfg.emailTo, subject, body, "upi.submit.company", claimId);
  }
  if (cfg.whatsappEnabled && cfg.whatsappTo) {
    await sendWhatsapp(cfg.whatsappTo, `${subject}\n${body}`, "upi.submit.company", claimId);
  }
}

export async function notifyClaimDecision(vars: NotifyVars, claimId: number, payerEmail?: string, payerPhone?: string) {
  const cfg: UpiNotify = await getUpiNotify();
  const subject = fillTemplate(cfg.decisionSubject, vars);
  const body = fillTemplate(cfg.decisionBody, vars);
  if (cfg.emailEnabled && cfg.emailTo) {
    await sendEmail(cfg.emailTo, subject, body, "upi.decision.company", claimId);
  }
  if (payerEmail) {
    await sendEmail(payerEmail, subject, body, "upi.decision.payer", claimId);
  }
  if (cfg.whatsappEnabled && cfg.whatsappTo) {
    await sendWhatsapp(cfg.whatsappTo, `${subject}\n${body}`, "upi.decision.company", claimId);
  }
  if (cfg.whatsappEnabled && payerPhone) {
    await sendWhatsapp(payerPhone, `${subject}\n${body}`, "upi.decision.payer", claimId);
  }
}

export async function listNotifyOutbox(limit = 40) {
  const [rows] = await pool.query(
    `SELECT id, channel, destination, subject, body, kind, claim_id, status, error_message, created_at
     FROM notify_outbox ORDER BY id DESC LIMIT :limit`,
    { limit },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      channel: String(r.channel),
      destination: String(r.destination),
      subject: (r.subject as string | null) ?? null,
      body: String(r.body),
      kind: String(r.kind),
      claimId: r.claim_id == null ? null : Number(r.claim_id),
      status: String(r.status),
      error: (r.error_message as string | null) ?? null,
      createdAt: String(r.created_at),
    };
  });
}
