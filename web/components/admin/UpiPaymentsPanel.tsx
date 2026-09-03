"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { PaymentsActionHandle } from "@/components/admin/payments-actions";
import { api } from "@/lib/api";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

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

function snapshot(payee: Payee, notify: Notify) {
  return JSON.stringify({ payee, notify });
}

function fmtWhen(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const UpiPaymentsPanel = forwardRef<
  PaymentsActionHandle,
  { initialStatus?: string; focusClaimId?: number | null }
>(function UpiPaymentsPanel({ initialStatus = "pending", focusClaimId = null }, ref) {
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
  const savedSnap = useRef("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(focusClaimId);
  const [filter, setFilter] = useState(initialStatus || "pending");
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [cfg, cl, ob] = await Promise.all([
      api<{ payee: Payee; notify: Notify }>("/admin/payments/upi/config"),
      api<{ claims: Claim[] }>(`/admin/payments/upi/claims?status=${filter}`),
      api<{ events: Outbox[] }>("/admin/payments/upi/outbox"),
    ]);
    setPayee(cfg.payee);
    setNotify(cfg.notify);
    savedSnap.current = snapshot(cfg.payee, cfg.notify);
    setClaims(cl.claims);
    setOutbox(ob.events);
    setSelectedId((cur) => {
      if (focusClaimId && cl.claims.some((c) => c.id === focusClaimId)) return focusClaimId;
      if (cur && cl.claims.some((c) => c.id === cur)) return cur;
      return cl.claims[0]?.id ?? null;
    });
  }, [filter, focusClaimId]);

  useEffect(() => {
    if (initialStatus) setFilter(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (focusClaimId) setSelectedId(focusClaimId);
  }, [focusClaimId]);

  useLiveRefresh(() => load().catch((e: Error) => setMessage(e.message)), {
    intervalMs: 20_000,
    deps: [filter],
  });

  const selected = claims.find((c) => c.id === selectedId) ?? claims[0] ?? null;
  const dirty = snapshot(payee, notify) !== savedSnap.current;

  async function saveConfig() {
    setBusy(true);
    setMessage("");
    try {
      await api("/admin/payments/upi/config", {
        method: "PUT",
        body: JSON.stringify({ payee, notify }),
      });
      savedSnap.current = snapshot(payee, notify);
      setMessage("UPI account and notification templates saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save: saveConfig,
      isBusy: () => busy,
      isDirty: () => dirty,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save closes over latest payee/notify/busy/dirty
    [busy, dirty, payee, notify],
  );

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
      invalidateAdminData("admin-upi");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyUtr() {
    if (!selected?.utr) return;
    try {
      await navigator.clipboard.writeText(selected.utr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("Could not copy UTR");
    }
  }

  return (
    <div className="admin-split payments-split">
      <div className="admin-pane-stack">
        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <div>
              <h2>JustXSystems UPI account</h2>
              <p className="muted">Default checkout is a UPI QR to this VPA. Gateways stay optional.</p>
            </div>
            {dirty ? <span className="pill pill-warning">Unsaved changes</span> : null}
          </div>
          <form
            className="admin-form-grid"
            id="upi-settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveConfig();
            }}
          >
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
            <h3 className="analytics-subhead" style={{ gridColumn: "1 / -1" }}>
              Company alerts
            </h3>
            <label className="field">
              <span>Email JustXSystems</span>
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
          </form>
          {message ? <p className="muted">{message}</p> : null}
        </section>
      </div>

      <div className="admin-pane-stack">
        <section className="panel admin-card">
          <h2>UPI claims</h2>
          <p className="muted">Verify bank UTR against the amount, then approve to grant tool licenses.</p>
          <div className="admin-tabs" role="tablist" aria-label="Claim filter">
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
                    {c.utr} · {inr(c.amountInr)} · {fmtWhen(c.createdAt)}
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
              <li>
                <span>Payer</span>
                <strong>{selected.payerName}</strong>
              </li>
              <li>
                <span>Email</span>
                <strong>{selected.payerEmail}</strong>
              </li>
              <li>
                <span>Phone</span>
                <strong>{selected.payerPhone || "—"}</strong>
              </li>
              <li>
                <span>Payer UPI</span>
                <strong>{selected.payerUpi || "—"}</strong>
              </li>
              <li>
                <span>UTR</span>
                <strong className="admin-form-row" style={{ gap: 8 }}>
                  <span className="mono">{selected.utr}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyUtr()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </strong>
              </li>
              <li>
                <span>Amount</span>
                <strong>{inr(selected.amountInr)}</strong>
              </li>
              <li>
                <span>Tools</span>
                <strong>{selected.toolIds?.length ? selected.toolIds.join(", ") : "—"}</strong>
              </li>
              <li>
                <span>Paid on</span>
                <strong>{selected.paidAt ? fmtWhen(selected.paidAt) : "—"}</strong>
              </li>
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
                    Approve & license
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void review("reject")}>
                    Reject
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">
                Already {selected.status}. {selected.reviewNote}
              </p>
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
                  <em className="muted">
                    {" "}
                    {ev.kind} · {fmtWhen(ev.createdAt)}
                  </em>
                </span>
                <span className={statusPill(ev.status)}>{ev.status}</span>
              </li>
            ))}
            {outbox.length === 0 ? <li className="muted">No outbound notifications yet.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
});
