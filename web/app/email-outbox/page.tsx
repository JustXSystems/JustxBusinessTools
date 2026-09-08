"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { canUseSyncCenter } from "@/lib/auth-access";
import { probeLocalAgent } from "@/lib/artifact-delivery";
import {
  cancelEmailOutbox,
  downloadOutboxPdf,
  fetchEmailOutbox,
  openMailtoForOutbox,
  openOutboxInOutlook,
  requeueEmailOutbox,
  sendEmailOutboxWebhook,
  type EmailOutboxItem,
} from "@/lib/email-outbox";

function statusClass(status: string) {
  if (status === "sent") return "pill pill-success";
  if (status === "pending" || status === "opened") return "pill pill-warning";
  if (status === "failed" || status === "cancelled") return "pill pill-danger";
  return "pill";
}

export default function EmailOutboxPage() {
  const { user } = useAuth();
  const allowed = canUseSyncCenter(user);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<EmailOutboxItem[]>([]);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!allowed) return;
    setError("");
    try {
      const [list, local] = await Promise.all([
        fetchEmailOutbox({ pendingOnly }),
        probeLocalAgent(),
      ]);
      setItems(list.items);
      setWebhookConfigured(list.webhookConfigured);
      setAgentOnline(Boolean(local?.ok));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load email outbox");
    } finally {
      setLoading(false);
    }
  }, [allowed, pendingOnly]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function run(id: string, label: string, fn: () => Promise<void>) {
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      await fn();
      setMessage(label);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) {
    return (
      <div className="page">
        <h1 className="page-title">Email Outbox</h1>
        <p className="section-note">Only Business Owners and Staff can manage the email outbox.</p>
        <Link href="/" className="btn btn-secondary">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="page sync-center-page">
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Email Outbox</h1>
          <p className="section-note" style={{ marginTop: 4 }}>
            Queued quotation emails when webhook delivery is unavailable or failed. Retry via webhook,
            open your mail app (PDF download separately), or Open in Outlook with the desktop agent.
          </p>
        </div>
        <div className="sync-actions">
          <button
            type="button"
            className={`btn btn-sm ${pendingOnly ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setPendingOnly(true)}
          >
            Pending
          </button>
          <button
            type="button"
            className={`btn btn-sm ${!pendingOnly ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setPendingOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || Boolean(busyId)}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="sync-status-grid">
        <div className="panel sync-stat">
          <span className="sync-stat-label">Webhook</span>
          <strong className="sync-stat-value" style={{ fontSize: 15 }}>
            {webhookConfigured ? "Configured" : "Not set"}
          </strong>
          <span className="section-note">EMAIL_WEBHOOK_URL on API</span>
        </div>
        <div className="panel sync-stat">
          <span className="sync-stat-label">Desktop agent</span>
          <strong className="sync-stat-value" style={{ fontSize: 15 }}>
            {agentOnline ? "Online" : "Not detected"}
          </strong>
          <span className="section-note">
            <Link href="/sync">Sync Center</Link> · Outlook attach
          </span>
        </div>
        <div className="panel sync-stat">
          <span className="sync-stat-label">Items</span>
          <strong className="sync-stat-value">{loading ? "…" : items.length}</strong>
          <span className="section-note">{pendingOnly ? "Pending / failed" : "All statuses"}</span>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">How to send</h3>
        <ol className="sync-setup-steps">
          <li>
            <strong>Webhook (best)</strong> — JustX engineer sets <code>EMAIL_WEBHOOK_URL</code>; use{" "}
            <em>Send via webhook</em> for HTML + PDF.
          </li>
          <li>
            <strong>Mail app</strong> — <em>Open mail app</em> prefills To/CC/subject/body;{" "}
            <em>Download PDF</em> then attach manually (browsers cannot auto-attach).
          </li>
          <li>
            <strong>Outlook + PDF</strong> — run desktop agent on this PC, then{" "}
            <em>Open in Outlook</em> (Windows Outlook COM).
          </li>
        </ol>
        <p className="section-note">
          Full setup: <code>docs/EMAIL_OUTBOX.md</code> and <code>docs/EMAIL_WEBHOOK.md</code>.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">{pendingOnly ? "Pending emails" : "All emails"}</h3>
        {loading ? (
          <p className="section-note">Loading…</p>
        ) : items.length === 0 ? (
          <p className="section-note">Nothing here — send a quotation via Email to create entries.</p>
        ) : (
          <ul className="sync-file-ul">
            {items.map((item) => (
              <li key={item.id} className="sync-file-row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {item.quoteNo || item.subject}{" "}
                    <span className={statusClass(item.status)}>{item.status}</span>
                  </strong>
                  <span className="section-note" style={{ display: "block" }}>
                    To: {item.to}
                    {item.cc ? ` · CC: ${item.cc}` : ""} · {item.subject}
                  </span>
                  <span className="section-note" style={{ display: "block" }}>
                    {new Date(item.createdAt).toLocaleString()}
                    {item.lastChannel ? ` · ${item.lastChannel}` : ""}
                    {item.artifactId ? " · PDF attached" : " · no PDF"}
                    {item.lastError ? ` · ${item.lastError}` : ""}
                  </span>
                </div>
                <div className="sync-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {item.status === "pending" || item.status === "failed" || item.status === "opened" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={Boolean(busyId) || !webhookConfigured}
                        title={
                          webhookConfigured
                            ? "Send HTML + PDF via EMAIL_WEBHOOK_URL"
                            : "Configure EMAIL_WEBHOOK_URL on the API server"
                        }
                        onClick={() =>
                          void run(item.id, "Sent via webhook.", async () => {
                            await sendEmailOutboxWebhook(item.id);
                          })
                        }
                      >
                        Send via webhook
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void run(item.id, "Mail app opened. Attach the downloaded PDF if needed.", async () => {
                            if (item.artifactId) {
                              try {
                                await downloadOutboxPdf(item);
                              } catch {
                                /* mailto still useful */
                              }
                            }
                            openMailtoForOutbox(item);
                            const { markEmailOutboxOpened } = await import("@/lib/email-outbox");
                            await markEmailOutboxOpened(item.id, "mailto");
                          })
                        }
                      >
                        Open mail app
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={Boolean(busyId) || !agentOnline || !item.artifactId}
                        title={
                          !agentOnline
                            ? "Start desktop agent from Sync Center"
                            : !item.artifactId
                              ? "No PDF on this draft"
                              : "Open Outlook with PDF attached (Windows)"
                        }
                        onClick={() =>
                          void run(item.id, "Outlook compose requested.", async () => {
                            const r = await openOutboxInOutlook(item.id);
                            if (!r.ok) throw new Error(r.error || "Outlook open failed");
                          })
                        }
                      >
                        Open in Outlook
                      </button>
                    </>
                  ) : null}
                  {item.artifactId ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={Boolean(busyId)}
                      onClick={() =>
                        void run(item.id, "PDF downloaded.", async () => {
                          await downloadOutboxPdf(item);
                        })
                      }
                    >
                      Download PDF
                    </button>
                  ) : null}
                  {item.status === "failed" || item.status === "cancelled" ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={Boolean(busyId)}
                      onClick={() =>
                        void run(item.id, "Requeued.", async () => {
                          await requeueEmailOutbox(item.id);
                        })
                      }
                    >
                      Requeue
                    </button>
                  ) : null}
                  {item.status !== "sent" && item.status !== "cancelled" ? (
                    <button
                      type="button"
                      className="btn btn-destructive btn-sm"
                      disabled={Boolean(busyId)}
                      onClick={() =>
                        void run(item.id, "Cancelled.", async () => {
                          await cancelEmailOutbox(item.id);
                        })
                      }
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message ? <p className="section-note sync-msg-ok">{message}</p> : null}
      {error ? <p className="section-note sync-msg-err">{error}</p> : null}
    </div>
  );
}
