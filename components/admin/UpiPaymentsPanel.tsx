"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Payee = { enabled: boolean; vpa: string; payeeName: string; merchantCode: string };
type Notify = {
  emailEnabled: boolean;
  emailTo: string;
  whatsappEnabled: boolean;
  whatsappTo: string;
  submitSubject: string;
  submitBody: string;
  decisionSubject: string;
  decisionBody: string;
};
type Claim = {
  id: number;
  status: string;
  payerName: string;
  payerEmail: string;
  payerPhone: string | null;
  payerUpi: string | null;
  utr: string;
  amountInr: number;
  toolIds?: string[];
  paidAt: string | null;
  notes: string | null;
  reviewNote: string | null;
  createdAt: string;
};
type Outbox = {
  id: number;
  channel: string;
  destination: string;
  subject: string | null;
  kind: string;
  status: string;
  createdAt: string;
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function statusPill(status: string) {
  if (status === "approved" || status === "sent") return "pill pill-success";
  if (status === "pending") return "pill pill-warning";
  if (status === "rejected" || status === "failed") return "pill pill-danger";
  return "pill";
}

export function UpiPaymentsPanel() {
  const [payee, setPayee] = useState<Payee>({ enabled: true, vpa: "", payeeName: "", merchantCode: "" });
  const [notify, setNotify] = useState<Notify>({
    emailEnabled: true,
    emailTo: "",
    whatsappEnabled: true,
    whatsappTo: "",
    submitSubject: "",
    submitBody: "",
    decisionSubject: "",
    decisionBody: "",
  });
  const [claims, setClaims] = useState<Claim[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("pending");
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [cfg, cl, ob] = await Promise.all([
      api<{ payee: Payee; notify: Notify }>("/admin/payments/upi/config"),
      api<{ claims: Claim[] }>(`/admin/payments/upi/claims?status=${filter}`),
      api<{ events: Outbox[] }>("/admin/payments/upi/outbox"),
    ]);
    setPayee(cfg.payee);
    setNotify(cfg.notify);
    setClaims(cl.claims);
    setOutbox(ob.events);
  }, [filter]);

  useEffect(() => {
    load().catch((e: Error) => setMessage(e.message));
  }, [load]);

  const selected = claims.find((c) => c.id === selectedId) ?? claims[0] ?? null;

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/admin/payments/upi/config", {
        method: "PUT",
        body: JSON.stringify({ payee, notify }),
      });
      setMessage("UPI account and notification templates saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "approve" | "reject") {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/admin/payments/upi/claims/${selected.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reviewNote }),
      });
      setReviewNote("");
      setMessage(action === "approve" ? "Approved — selected tools are now licensed." : "Rejected — no new licenses granted.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-split payments-split">
      <div className="admin-pane-stack">
        <section className="panel admin-card">
          <h2>JustX UPI account</h2>
          <p className="muted">Default checkout is a UPI QR to this VPA. Payment gateways stay optional.</p>
          <form className="admin-form-grid" onSubmit={saveConfig}>
            <label className="field">
              <span>Enable UPI QR</span>
              <select
                value={payee.enabled ? "1" : "0"}
                onChange={(e) => setPayee({ ...payee, enabled: e.target.value === "1" })}
              >
                <option value="1">On (default)</option>
                <option value="0">Off</option>
              </select>
            </label>
            <label className="field">
              <span>Payee name</span>
              <input value={payee.payeeName} onChange={(e) => setPayee({ ...payee, payeeName: e.target.value })} required />
            </label>
            <label className="field">
              <span>UPI ID (VPA)</span>
              <input value={payee.vpa} onChange={(e) => setPayee({ ...payee, vpa: e.target.value })} required placeholder="justx@okaxis" />
            </label>
            <label className="field">
              <span>Merchant code (optional)</span>
              <input value={payee.merchantCode} onChange={(e) => setPayee({ ...payee, merchantCode: e.target.value })} />
            </label>
            <h3 className="analytics-subhead" style={{ gridColumn: "1 / -1" }}>Company alerts</h3>
            <label className="field">
              <span>Email JustX</span>
              <select
                value={notify.emailEnabled ? "1" : "0"}
                onChange={(e) => setNotify({ ...notify, emailEnabled: e.target.value === "1" })}
              >
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </label>
            <label className="field">
              <span>Alert email</span>
              <input type="email" value={notify.emailTo} onChange={(e) => setNotify({ ...notify, emailTo: e.target.value })} />
            </label>
            <label className="field">
              <span>WhatsApp alerts</span>
              <select
                value={notify.whatsappEnabled ? "1" : "0"}
                onChange={(e) => setNotify({ ...notify, whatsappEnabled: e.target.value === "1" })}
              >
                <option value="1">On</option>
                <option value="0">Off</option>
              </select>
            </label>
            <label className="field">
              <span>WhatsApp number</span>
              <input value={notify.whatsappTo} onChange={(e) => setNotify({ ...notify, whatsappTo: e.target.value })} placeholder="+91…" />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>On submit — subject</span>
              <input value={notify.submitSubject} onChange={(e) => setNotify({ ...notify, submitSubject: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>On submit — body (placeholders: {"{{payerName}} {{utr}} {{amount}}"})</span>
              <textarea rows={3} value={notify.submitBody} onChange={(e) => setNotify({ ...notify, submitBody: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>On approve/reject — subject</span>
              <input value={notify.decisionSubject} onChange={(e) => setNotify({ ...notify, decisionSubject: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>On approve/reject — body</span>
              <textarea rows={3} value={notify.decisionBody} onChange={(e) => setNotify({ ...notify, decisionBody: e.target.value })} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save UPI settings
            </button>
          </form>
          {message ? <p className="muted">{message}</p> : null}
        </section>
      </div>

      <div className="admin-pane-stack">
        <section className="panel admin-card">
          <h2>UPI claims</h2>
          <div className="admin-tabs">
            {["pending", "approved", "rejected", "all"].map((f) => (
              <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
          <div className="tracker-list">
            {claims.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`tracker-row admin-member-row ${selected?.id === c.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <div>
                  <strong>{c.payerName}</strong>
                  <span className="muted">
                    {c.utr} · {inr(c.amountInr)}
                  </span>
                </div>
                <span className={statusPill(c.status)}>{c.status}</span>
              </button>
            ))}
            {claims.length === 0 ? <p className="muted">No claims in this filter.</p> : null}
          </div>
        </section>

        {selected ? (
          <section className="panel admin-card">
            <h2>Verify #{selected.id}</h2>
            <ul className="admin-kv">
              <li><span>Payer</span><strong>{selected.payerName}</strong></li>
              <li><span>Email</span><strong>{selected.payerEmail}</strong></li>
              <li><span>Phone</span><strong>{selected.payerPhone || "—"}</strong></li>
              <li><span>Payer UPI</span><strong>{selected.payerUpi || "—"}</strong></li>
              <li><span>UTR</span><strong>{selected.utr}</strong></li>
              <li><span>Amount</span><strong>{inr(selected.amountInr)}</strong></li>
              <li><span>Tools</span><strong>{selected.toolIds?.length ? selected.toolIds.join(", ") : "—"}</strong></li>
              <li><span>Paid on</span><strong>{selected.paidAt ?? "—"}</strong></li>
            </ul>
            {selected.notes ? <p className="muted">{selected.notes}</p> : null}
            {selected.status === "pending" ? (
              <>
                <label className="field">
                  <span>Review note (sent in the final notification)</span>
                  <input value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                </label>
                <div className="admin-form-row">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void review("approve")}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void review("reject")}>
                    Reject
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">Already {selected.status}. {selected.reviewNote}</p>
            )}
          </section>
        ) : null}

        <section className="panel admin-card">
          <h2>Notification log</h2>
          <ul className="admin-list">
            {outbox.slice(0, 12).map((ev) => (
              <li key={ev.id}>
                <span>
                  {ev.channel} · {ev.destination}
                  <em className="muted"> {ev.kind}</em>
                </span>
                <span className={statusPill(ev.status)}>{ev.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
