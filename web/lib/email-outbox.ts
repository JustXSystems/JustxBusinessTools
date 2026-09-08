import { api } from "@/lib/api";
import { LOCAL_AGENT_BRIDGE, probeLocalAgent } from "@/lib/artifact-delivery";

export type EmailOutboxItem = {
  id: string;
  toolId: string;
  entityType: string | null;
  entityId: string | null;
  quoteNo: string | null;
  to: string;
  cc: string;
  subject: string;
  body: string;
  html: string | null;
  templateId: string | null;
  replyTo: string | null;
  fromName: string | null;
  fromEmail: string | null;
  artifactId: string | null;
  filename: string | null;
  status: "pending" | "sent" | "opened" | "failed" | "cancelled";
  lastError: string | null;
  lastChannel: string | null;
  attemptCount: number;
  sentAt: string | null;
  openedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchEmailOutbox(opts?: { pendingOnly?: boolean }) {
  const q = opts?.pendingOnly ? "?pending=1" : "";
  return api<{ items: EmailOutboxItem[]; webhookConfigured: boolean }>(`/email-outbox${q}`);
}

export async function fetchEmailOutboxStatus() {
  return api<{ webhookConfigured: boolean; pendingCount: number }>("/email-outbox/status");
}

export async function sendEmailOutboxWebhook(id: string) {
  return api<{ ok: boolean; delivered: boolean; via: string; item: EmailOutboxItem }>(
    `/email-outbox/${id}/send-webhook`,
    { method: "POST", body: "{}" },
  );
}

export async function markEmailOutboxOpened(id: string, channel = "mailto") {
  return api<{ item: EmailOutboxItem }>(`/email-outbox/${id}/mark-opened`, {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
}

export async function cancelEmailOutbox(id: string) {
  return api<{ item: EmailOutboxItem }>(`/email-outbox/${id}/cancel`, {
    method: "POST",
    body: "{}",
  });
}

export async function requeueEmailOutbox(id: string) {
  return api<{ item: EmailOutboxItem }>(`/email-outbox/${id}/requeue`, {
    method: "POST",
    body: "{}",
  });
}

export function openMailtoForOutbox(item: EmailOutboxItem) {
  const params = new URLSearchParams();
  if (item.cc.trim()) params.set("cc", item.cc.trim());
  params.set("subject", item.subject);
  params.set("body", item.body.slice(0, 1800));
  window.location.href = `mailto:${item.to}?${params.toString()}`;
}

export async function downloadOutboxPdf(item: EmailOutboxItem) {
  if (!item.artifactId) throw new Error("No PDF attached to this outbox item");
  const { apiUrl } = await import("@/lib/api-base");
  const res = await fetch(apiUrl(`/api/artifacts/${item.artifactId}/content`), {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = item.filename || "quotation.pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Ask desktop agent to open Outlook with attachment (Windows). */
export async function openOutboxInOutlook(outboxId: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
}> {
  const local = await probeLocalAgent();
  if (!local?.ok) {
    return {
      ok: false,
      error:
        "Desktop agent not detected on this PC. Start it from Sync Center, then retry Open in Outlook.",
    };
  }
  try {
    const res = await fetch(`${LOCAL_AGENT_BRIDGE}/open-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outboxId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Agent returned ${res.status}` };
    }
    await markEmailOutboxOpened(outboxId, "outlook_agent").catch(() => undefined);
    return { ok: true, message: data.message || "Outlook compose opened." };
  } catch {
    return {
      ok: false,
      error: "Could not reach desktop agent bridge (127.0.0.1:17865).",
    };
  }
}
