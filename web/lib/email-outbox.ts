import { api } from "@/lib/api";
import { LOCAL_AGENT_BRIDGE, probeLocalAgent } from "@/lib/artifact-delivery";
import { buildMailtoHref } from "@/lib/mailto";

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

export async function markEmailOutboxOpenFailed(
  id: string,
  error: string,
  channel = "outlook_agent",
) {
  return api<{ item: EmailOutboxItem }>(`/email-outbox/${id}/mark-open-failed`, {
    method: "POST",
    body: JSON.stringify({ error, channel }),
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
  window.location.href = buildMailtoHref({
    to: item.to,
    cc: item.cc,
    subject: item.subject,
    body: item.body,
  });
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

/** Ask desktop agent to open Outlook with attachment (Windows). Prefers HTMLBody when outbox has html. */
export async function openOutboxInOutlook(outboxId: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
}> {
  const local = await probeLocalAgent();
  if (!local?.ok) {
    await markEmailOutboxOpenFailed(
      outboxId,
      "Desktop agent not detected on this PC",
      "outlook_agent",
    ).catch(() => undefined);
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
      const err = data.error || `Agent returned ${res.status}`;
      // Agent ≥1.1.2 also reports agent-open-failed; this covers older agents / bridge errors.
      await markEmailOutboxOpenFailed(outboxId, err, "outlook_agent").catch(() => undefined);
      return { ok: false, error: err };
    }
    // Agent calls agent-opened on success; keep a session mark as backup for older agents.
    await markEmailOutboxOpened(outboxId, "outlook_agent").catch(() => undefined);
    return { ok: true, message: data.message || "Outlook compose opened." };
  } catch {
    const err = "Could not reach desktop agent bridge (127.0.0.1:17865).";
    await markEmailOutboxOpenFailed(outboxId, err, "outlook_agent").catch(() => undefined);
    return { ok: false, error: err };
  }
}

/**
 * Prefer Outlook agent when HTML (or PDF attach) is needed — mailto cannot carry HTML.
 * Falls back to mailto plain text when agent is offline.
 * Mailto does NOT mark the row opened (cannot verify the draft appeared).
 */
export async function openOutboxBestEffort(item: EmailOutboxItem): Promise<{
  ok: boolean;
  via: "outlook_agent" | "mailto";
  message?: string;
  error?: string;
}> {
  const wantsHtml = Boolean(item.html?.trim());
  const canOutlook = Boolean(item.artifactId);
  if (wantsHtml || canOutlook) {
    const local = await probeLocalAgent();
    if (local?.ok && item.artifactId) {
      const r = await openOutboxInOutlook(item.id);
      if (r.ok) {
        return {
          ok: true,
          via: "outlook_agent",
          message: wantsHtml
            ? "Opened Outlook with HTML body and PDF attached."
            : r.message,
        };
      }
      if (wantsHtml) {
        return {
          ok: false,
          via: "outlook_agent",
          error:
            (r.error || "Outlook open failed") +
            " HTML cannot be sent via mailto — fix classic Outlook/COM or use Email webhook (Path A).",
        };
      }
    } else if (wantsHtml) {
      await markEmailOutboxOpenFailed(
        item.id,
        "Corporate HTML needs desktop agent + classic Outlook",
        "mailto",
      ).catch(() => undefined);
      return {
        ok: false,
        via: "mailto",
        error:
          "Corporate HTML needs Open in Outlook (desktop agent + classic Outlook) or an Email webhook. Mailto is plain text only.",
      };
    }
  }
  openMailtoForOutbox(item);
  // Do not mark opened — mailto is fire-and-forget; keep pending until staff cancel or webhook send.
  return {
    ok: true,
    via: "mailto",
    message: "Mail app requested (plain text). Item stays pending until you Cancel or send via webhook.",
  };
}
