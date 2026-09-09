/**
 * WhatsApp Cloud API helpers (Meta Graph).
 * Credentials: Admin → Integrations (preferred) or WHATSAPP_* env.
 */

import { resolveWhatsApp } from "./integrations/resolvers.js";

export type WhatsAppDeliveryConfig = {
  cloudConfigured: boolean;
  webhookConfigured: boolean;
  /** True when either Cloud API or webhook can deliver with attachment. */
  canAutoAttach: boolean;
};

export async function getWhatsAppDeliveryConfig(): Promise<WhatsAppDeliveryConfig> {
  const resolved = await resolveWhatsApp();
  if (!resolved) {
    return { cloudConfigured: false, webhookConfigured: false, canAutoAttach: false };
  }
  return {
    cloudConfigured: resolved.cloudConfigured,
    webhookConfigured: resolved.webhookConfigured,
    canAutoAttach: resolved.canAutoAttach,
  };
}

async function waCreds() {
  const resolved = await resolveWhatsApp();
  return {
    token: resolved?.accessToken ?? "",
    phoneNumberId: resolved?.phoneNumberId ?? "",
    webhook: resolved?.webhookUrl ?? "",
    apiVersion: resolved?.apiVersion ?? "v21.0",
  };
}

function graphBase(version: string) {
  const v = (version || "v21.0").trim() || "v21.0";
  return `https://graph.facebook.com/${v}`;
}

export function normalizeWaPhone(raw: string): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

async function uploadDocument(params: {
  token: string;
  phoneNumberId: string;
  filename: string;
  pdfBuffer: Buffer;
  apiVersion: string;
}): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append(
    "file",
    new Blob([new Uint8Array(params.pdfBuffer)], { type: "application/pdf" }),
    params.filename.endsWith(".pdf") ? params.filename : `${params.filename}.pdf`,
  );

  const res = await fetch(`${graphBase(params.apiVersion)}/${params.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp media upload ${res.status}: ${text.slice(0, 240)}`);
  }
  let json: { id?: string };
  try {
    json = JSON.parse(text) as { id?: string };
  } catch {
    throw new Error(`WhatsApp media upload: invalid JSON (${text.slice(0, 120)})`);
  }
  if (!json.id) throw new Error("WhatsApp media upload: missing media id");
  return json.id;
}

async function sendDocumentMessage(params: {
  token: string;
  phoneNumberId: string;
  to: string;
  mediaId: string;
  filename: string;
  caption: string;
  apiVersion: string;
}): Promise<void> {
  const caption = params.caption.slice(0, 1024);
  const res = await fetch(`${graphBase(params.apiVersion)}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "document",
      document: {
        id: params.mediaId,
        filename: params.filename.endsWith(".pdf") ? params.filename : `${params.filename}.pdf`,
        ...(caption ? { caption } : {}),
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp send ${res.status} to ${params.to}: ${text.slice(0, 240)}`);
  }
}

async function sendTextMessage(params: {
  token: string;
  phoneNumberId: string;
  to: string;
  body: string;
  apiVersion: string;
}): Promise<void> {
  const body = params.body.slice(0, 4096);
  if (!body.trim()) return;
  const res = await fetch(`${graphBase(params.apiVersion)}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp text ${res.status} to ${params.to}: ${text.slice(0, 240)}`);
  }
}

export async function sendWhatsAppCloudDocuments(params: {
  phones: string[];
  message: string;
  filename: string;
  pdfBase64: string;
}): Promise<{ sent: string[]; errors: Array<{ phone: string; error: string }> }> {
  const creds = await waCreds();
  const { token, phoneNumberId, apiVersion } = creds;
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp Cloud API is not configured");
  }

  const unique = [
    ...new Set(params.phones.map(normalizeWaPhone).filter((p) => p.length >= 10)),
  ];
  if (!unique.length) throw new Error("No valid WhatsApp numbers");

  const pdfBuffer = Buffer.from(params.pdfBase64, "base64");
  if (!pdfBuffer.length) throw new Error("PDF is empty");

  const mediaId = await uploadDocument({
    token,
    phoneNumberId,
    filename: params.filename,
    pdfBuffer,
    apiVersion,
  });

  const message = params.message.trim();
  const useSeparateText = message.length > 1024;
  const caption = useSeparateText ? "" : message;
  const sent: string[] = [];
  const errors: Array<{ phone: string; error: string }> = [];

  for (const to of unique) {
    try {
      if (useSeparateText) {
        await sendTextMessage({ token, phoneNumberId, to, body: message, apiVersion });
      }
      await sendDocumentMessage({
        token,
        phoneNumberId,
        to,
        mediaId,
        filename: params.filename,
        caption,
        apiVersion,
      });
      sent.push(to);
    } catch (err) {
      errors.push({
        phone: to,
        error: err instanceof Error ? err.message : "Send failed",
      });
    }
  }

  return { sent, errors };
}

export async function postWhatsAppWebhook(payload: Record<string, unknown>): Promise<void> {
  const creds = await waCreds();
  if (!creds.webhook) throw new Error("WhatsApp webhook is not configured");
  const r = await fetch(creds.webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    throw new Error(`WhatsApp webhook ${r.status}: ${(await r.text()).slice(0, 180)}`);
  }
}
