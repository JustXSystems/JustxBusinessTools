"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AdminEmpty, AdminSection, AdminTabs } from "@/components/admin/ui";
import { SwitchField, TextField, TextareaField } from "@/components/admin/ui/AdminFields";
import type { PaymentsActionHandle } from "@/components/admin/payments-actions";
import { Alert, Badge, Button, DataTable, FormGrid, cx, type BosBadgeTone, type BosColumn } from "@/components/bos";
import { api } from "@/lib/api";
import { useBrandCopy } from "@/lib/use-brand-copy";
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
  billingCycle?: "month" | "year";
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

const CLAIM_FILTERS = ["pending", "approved", "rejected", "all"] as const;

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function statusTone(status: string): BosBadgeTone {
  if (status === "approved" || status === "sent") return "emerald";
  if (status === "pending") return "amber";
  if (status === "rejected" || status === "failed") return "coral";
  return "neutral";
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
  const { appName } = useBrandCopy();
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
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const say = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setMessageTone(tone);
    setMessage(text);
  }, []);

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

  useLiveRefresh(() => load().catch((e: Error) => say(e.message, "error")), {
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
      say("UPI account and notification templates saved.");
    } catch (err) {
      say(err instanceof Error ? err.message : "Save failed", "error");
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
      say(action === "approve" ? "Approved — selected tools are now licensed." : "Rejected — no new licenses granted.");
      invalidateAdminData("admin-upi");
      await load();
    } catch (err) {
      say(err instanceof Error ? err.message : "Review failed", "error");
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
      say("Could not copy UTR", "error");
    }
  }

  const outboxColumns: ReadonlyArray<BosColumn<Outbox>> = [
    {
      key: "dest",
      header: "Destination",
      cell: (ev) => (
        <div>
          <div className="admin-cc-cell-title">
            {ev.channel} · {ev.destination}
          </div>
          <div className="admin-cc-cell-sub">{ev.kind}</div>
        </div>
      ),
    },
    { key: "createdAt", header: "When", mono: true, cell: (ev) => fmtWhen(ev.createdAt) },
    {
      key: "status",
      header: "Status",
      cell: (ev) => (
        <Badge auto tone={statusTone(ev.status)}>
          {ev.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="admin-cc-two">
      <div className="admin-cc-split-stack">
        <AdminSection
          title={`${appName} UPI account`}
          description="Default checkout is a UPI QR to this VPA. Gateways stay optional."
          actions={
            dirty ? (
              <Badge auto tone="amber">
                Unsaved changes
              </Badge>
            ) : null
          }
        >
          <form
            className="admin-cc-form"
            id="upi-settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveConfig();
            }}
          >
            <FormGrid>
              <SwitchField
                label="Enable UPI QR (default)"
                checked={payee.enabled}
                onChange={(enabled) => setPayee({ ...payee, enabled })}
              />
              <TextField
                label="Payee name"
                value={payee.payeeName}
                onChange={(e) => setPayee({ ...payee, payeeName: e.target.value })}
                required
              />
              <TextField
                label="UPI ID (VPA)"
                value={payee.vpa}
                onChange={(e) => setPayee({ ...payee, vpa: e.target.value })}
                required
                placeholder="justx@okaxis"
              />
              <TextField
                label="Merchant code (optional)"
                value={payee.merchantCode}
                onChange={(e) => setPayee({ ...payee, merchantCode: e.target.value })}
              />
              <div className="admin-cc-subhead bos-form-grid-full">Company alerts</div>
              <SwitchField
                label={`Email ${appName}`}
                checked={notify.emailEnabled}
                onChange={(emailEnabled) => setNotify({ ...notify, emailEnabled })}
              />
              <TextField
                label="Alert email"
                type="email"
                value={notify.emailTo}
                onChange={(e) => setNotify({ ...notify, emailTo: e.target.value })}
              />
              <SwitchField
                label="WhatsApp alerts"
                checked={notify.whatsappEnabled}
                onChange={(whatsappEnabled) => setNotify({ ...notify, whatsappEnabled })}
              />
              <TextField
                label="WhatsApp number"
                value={notify.whatsappTo}
                onChange={(e) => setNotify({ ...notify, whatsappTo: e.target.value })}
                placeholder="+91…"
              />
              <TextField
                full
                label="On submit — subject"
                value={notify.submitSubject}
                onChange={(e) => setNotify({ ...notify, submitSubject: e.target.value })}
              />
              <TextareaField
                full
                label="On submit — body"
                hint={<>Placeholders: {"{{payerName}} {{utr}} {{amount}}"}</>}
                rows={3}
                value={notify.submitBody}
                onChange={(e) => setNotify({ ...notify, submitBody: e.target.value })}
              />
              <TextField
                full
                label="On approve/reject — subject"
                value={notify.decisionSubject}
                onChange={(e) => setNotify({ ...notify, decisionSubject: e.target.value })}
              />
              <TextareaField
                full
                label="On approve/reject — body"
                rows={3}
                value={notify.decisionBody}
                onChange={(e) => setNotify({ ...notify, decisionBody: e.target.value })}
              />
            </FormGrid>
          </form>
          {message ? (
            <div style={{ marginTop: 12 }}>
              <Alert tone={messageTone === "error" ? "coral" : "emerald"} title={message} />
            </div>
          ) : null}
        </AdminSection>
      </div>

      <div className="admin-cc-split-stack">
        <AdminSection
          title="UPI claims"
          description="Verify bank UTR against the amount, then approve to grant tool licenses."
        >
          <div className="admin-cc-stack">
            <AdminTabs
              aria-label="Claim filter"
              options={CLAIM_FILTERS.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))}
              value={(CLAIM_FILTERS as ReadonlyArray<string>).includes(filter) ? (filter as (typeof CLAIM_FILTERS)[number]) : "pending"}
              onChange={setFilter}
            />
            <div className="admin-cc-dir-list" style={{ marginTop: 0, maxHeight: 360 }}>
              {claims.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={cx("admin-cc-row", active && "is-selected")}
                    aria-pressed={active}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="admin-cc-row-main">
                      <div className="admin-cc-cell-title">{c.payerName}</div>
                      <div className="admin-cc-cell-sub">
                        {c.utr} · {inr(c.amountInr)} · {fmtWhen(c.createdAt)}
                      </div>
                    </div>
                    <div className="admin-cc-row-badges">
                      <Badge auto tone={c.billingCycle === "year" ? "blue" : "neutral"}>
                        {c.billingCycle === "year" ? "365d" : "30d"}
                      </Badge>
                      <Badge auto tone={statusTone(c.status)}>
                        {c.status}
                      </Badge>
                    </div>
                  </button>
                );
              })}
              {claims.length === 0 ? (
                <AdminEmpty title="No claims" icon="receipt">
                  No claims in this filter.
                </AdminEmpty>
              ) : null}
            </div>
          </div>
        </AdminSection>

        {selected ? (
          <AdminSection
            title={`Verify #${selected.id}`}
            actions={
              <Badge auto tone={statusTone(selected.status)}>
                {selected.status}
              </Badge>
            }
          >
            <ul className="admin-cc-kv">
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
                <strong className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                  <span className="admin-cc-code">{selected.utr}</span>
                  <Button variant="ghost" size="sm" onClick={() => void copyUtr()}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </strong>
              </li>
              <li>
                <span>Amount</span>
                <strong>{inr(selected.amountInr)}</strong>
              </li>
              <li>
                <span>Billing cycle</span>
                <strong>
                  {selected.billingCycle === "year" ? "Yearly (365 days)" : "Monthly (30 days)"}
                </strong>
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
            {selected.notes ? <p className="admin-cc-note-text">{selected.notes}</p> : null}
            {selected.status === "pending" ? (
              <div className="admin-cc-form" style={{ marginTop: 12 }}>
                <TextField
                  label="Review note"
                  hint="Sent in the final notification."
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <div className="admin-cc-form-actions">
                  <Button variant="primary" disabled={busy} onClick={() => void review("approve")}>
                    Approve &amp; license ({selected.billingCycle === "year" ? "365d" : "30d"})
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={() => void review("reject")}>
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <p className="admin-cc-note-text" style={{ marginTop: 12 }}>
                Already {selected.status}. {selected.reviewNote}
              </p>
            )}
          </AdminSection>
        ) : null}

        <AdminSection title="Notification log" description="Most recent outbound alerts.">
          {outbox.length === 0 ? (
            <AdminEmpty title="No outbound notifications yet" icon="bell">
              Alerts appear here once claims are submitted or reviewed.
            </AdminEmpty>
          ) : (
            <div className="admin-cc-scroll" style={{ maxHeight: 360 }}>
              <DataTable
                compact
                caption="UPI notification log"
                columns={outboxColumns}
                rows={outbox.slice(0, 12)}
                rowKey={(ev) => String(ev.id)}
              />
            </div>
          )}
        </AdminSection>
      </div>
    </div>
  );
});
