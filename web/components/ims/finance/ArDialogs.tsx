"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Checkbox, Dialog, Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/bos";
import type { ReminderSettings } from "@/lib/ims/api";
import {
  AR_PRIORITY_BADGE,
  AR_STATUS_BADGE,
  CHANNEL_LABEL,
  finance,
  INVOICE_BADGE,
  methodLabel,
  renderTemplate,
  reminderVars,
  type ArCustomer,
  type ImsInvoice,
  type PayMethod,
  type ReminderChannel,
  type SentReminder,
} from "@/lib/ims/finance";
import { dateLabel, inrExact, num, round2, stampLabel } from "@/lib/ims/format";
import { Loaded, StatusBadge, useIms, useImsAction, useImsData } from "../core";
import { activityTone, KeyValues, MethodSelect, PaymentDialog, QuickChips, ReasonDialog, Stats, Timeline, type TimelineItem } from "./shared";

/* ---------- Reminders ---------- */

/**
 * Logs the reminder on each invoice and returns click-to-send links. Delivery happens in the
 * user's own WhatsApp / SMS / mail app — IMS doesn't send messages through a gateway.
 */
export function ReminderDialog({
  invoices,
  reminders,
  businessName,
  rule,
  presetTemplate,
  onClose,
}: {
  invoices: ImsInvoice[];
  reminders: ReminderSettings;
  businessName: string;
  rule?: string | null;
  presetTemplate?: string | null;
  onClose: () => void;
}) {
  const channels = reminders.channels.length ? reminders.channels : (["whatsapp", "sms", "email"] as ReminderChannel[]);
  const preset = reminders.templates.find((t) => t.key === presetTemplate);
  const [channel, setChannel] = useState<ReminderChannel>(preset?.channel ?? channels[0]);
  const forChannel = reminders.templates.filter((t) => t.channel === channel);
  const [templateKey, setTemplateKey] = useState<string>(preset?.key ?? forChannel[0]?.key ?? "");
  const template = reminders.templates.find((t) => t.key === templateKey) ?? forChannel[0] ?? null;
  const [message, setMessage] = useState(template?.body ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [sent, setSent] = useState<SentReminder[] | null>(null);
  const { run, busy } = useImsAction();
  const first = invoices[0];
  const preview = first ? renderTemplate(message, reminderVars(first, businessName)) : message;
  const missingContact = invoices.filter((i) => (channel === "email" ? !i.customerEmail : !i.customerMobile)).length;

  const pickTemplate = (key: string, ch = channel) => {
    const t = reminders.templates.find((x) => x.key === key) ?? reminders.templates.find((x) => x.channel === ch) ?? null;
    setTemplateKey(t?.key ?? "");
    setMessage(t?.body ?? "");
    setSubject(t?.subject ?? "");
  };

  const send = async () => {
    const out = await run(
      "remind",
      () => finance.sendReminders({ invoiceIds: invoices.map((i) => i.id), channel, templateKey: template?.key ?? null, message: message.trim() || null, subject: channel === "email" ? subject.trim() || null : null, rule: rule ?? null }),
      { success: invoices.length === 1 ? "Reminder ready to send" : `${invoices.length} reminders ready to send` },
    );
    if (out) {
      setSent(out.sent);
      if (out.sent.length === 1) window.open(out.sent[0].link, "_blank", "noopener,noreferrer");
    }
  };

  if (sent) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={sent.length === 1 ? "Reminder logged" : `${sent.length} reminders logged`}
        description="Each link opens your messaging app with the message filled in — press send there to deliver it."
        icon={{ tone: "emerald", name: "check" }}
        wide
        actions={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="fin-lg">
          <div className="fin-table-wrap">
            <table className="fin-table">
              <tbody>
                {sent.map((s) => (
                  <tr key={s.invoiceId}>
                    <td>
                      <span className="ims-cell-stack">
                        <span className="ims-strong">{s.customerName}</span>
                        <small>
                          {s.invoiceNo} · {s.to ?? `no ${s.channel === "email" ? "email" : "mobile"} on file`}
                        </small>
                      </span>
                    </td>
                    <td style={{ width: 1 }}>
                      <Button size="sm" onClick={() => window.open(s.link, "_blank", "noopener,noreferrer")}>
                        Open {CHANNEL_LABEL[s.channel]}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={invoices.length === 1 ? `Send reminder · ${first?.invoiceNo}` : `Send ${invoices.length} reminders`}
      description={invoices.length === 1 ? `${first?.customerName} owes ${inrExact(first?.balance ?? 0)}${first?.daysOverdue ? ` · ${first.daysOverdue} days overdue` : ""}` : "The message is personalised for each invoice."}
      icon={{ tone: "blue", name: "bell" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy === "remind"}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} disabled={busy === "remind" || !message.trim()}>
            {busy === "remind" ? "Preparing…" : invoices.length === 1 ? `Open ${CHANNEL_LABEL[channel]}` : "Prepare reminders"}
          </Button>
        </>
      }
    >
      <div className="fin-lg">
        <FormGrid columns="1fr 1fr">
          <Field label="Channel">
            {({ id }) => (
              <Select
                id={id}
                value={channel}
                onChange={(e) => {
                  const ch = e.target.value as ReminderChannel;
                  setChannel(ch);
                  pickTemplate(reminders.templates.find((t) => t.channel === ch)?.key ?? "", ch);
                }}
              >
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Template">
            {({ id }) => (
              <Select id={id} value={templateKey} onChange={(e) => pickTemplate(e.target.value)} disabled={!forChannel.length}>
                {forChannel.length ? null : <option value="">No templates for this channel</option>}
                {forChannel.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {channel === "email" ? (
            <Field label="Subject" full>
              {({ id }) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
            </Field>
          ) : null}
          <Field label="Message" full hint="Placeholders: {customer} {invoice} {amount} {total} {due} {days} {business}">
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />}
          </Field>
        </FormGrid>
        {first ? (
          <div style={{ marginTop: 12 }}>
            <div className="fin-section-title">Preview{invoices.length > 1 ? ` (${first.customerName})` : ""}</div>
            <pre className="fin-share">{preview}</pre>
          </div>
        ) : null}
        {missingContact ? (
          <div style={{ marginTop: 10 }}>
            <Alert tone="amber" title={`${missingContact} without ${channel === "email" ? "an email" : "a mobile number"}`}>
              Those reminders are still logged; the link opens {CHANNEL_LABEL[channel]} so you can pick the recipient yourself.
            </Alert>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Promise / note / assign ---------- */

export function PromiseDialog({ invoice, today, onClose }: { invoice: ImsInvoice; today: string; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const [date, setDate] = useState(invoice.promiseDate ?? today);
  const [amount, setAmount] = useState(String(invoice.promiseAmount ?? invoice.balance));
  const [note, setNote] = useState("");
  const value = round2(num(amount));
  const error = !date ? "Pick a date" : !(value > 0) ? "Enter an amount" : value > invoice.balance + 0.005 ? `More than the balance (${inrExact(invoice.balance)})` : null;
  const save = async (clear = false) => {
    if (!clear && error) return;
    const out = await run("promise", () => finance.promise(invoice.id, clear ? { clear: true, note: note.trim() || null } : { date, amount: value, note: note.trim() || null }), { success: clear ? "Promise cleared" : "Promise to pay logged" });
    if (out) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Promise to pay · ${invoice.invoiceNo}`}
      description={`${invoice.customerName} · balance ${inrExact(invoice.balance)}`}
      icon={{ tone: "blue", name: "calendar" }}
      wide
      actions={
        <>
          {invoice.promiseDate ? (
            <Button variant="ghost" onClick={() => save(true)} disabled={busy === "promise"}>
              Mark promise broken
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => save(false)} disabled={busy === "promise" || Boolean(error)}>
            {busy === "promise" ? "Saving…" : "Save promise"}
          </Button>
        </>
      }
    >
      <FormGrid columns="1fr 1fr">
        <Field label="Promised date *">{({ id }) => <Input id={id} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Amount (₹) *" error={error && date ? error : undefined}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Note" full>
          {({ id }) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Will pay after month-end collections" />}
        </Field>
      </FormGrid>
    </Dialog>
  );
}

export function NoteDialog({ invoice, onClose }: { invoice: ImsInvoice; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const [kind, setKind] = useState<"note" | "call" | "escalation">("call");
  const [message, setMessage] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Log follow-up · ${invoice.invoiceNo}`}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!message.trim() || busy === "note"}
            onClick={async () => {
              const out = await run("note", () => finance.addNote(invoice.id, { kind, channel: kind === "call" ? "call" : null, message: message.trim() }), { success: "Follow-up logged" });
              if (out) onClose();
            }}
          >
            {busy === "note" ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 10 }}>
        <QuickChips
          label="Follow-up type"
          active={kind}
          options={[
            { key: "call", label: "📞 Call" },
            { key: "note", label: "📝 Note" },
            { key: "escalation", label: "⚑ Escalation" },
          ]}
          onPick={(k) => setKind(k as "note" | "call" | "escalation")}
        />
      </div>
      <Field label="What happened? *">
        {({ id }) => <Textarea id={id} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder={kind === "call" ? "Spoke to accounts — cheque ready by Friday" : "Details"} />}
      </Field>
    </Dialog>
  );
}

export function AssignDialog({ invoiceIds, managers, onClose }: { invoiceIds: string[]; managers: Array<{ userId: number; name: string; isAccountManager: boolean }>; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const sorted = [...managers].sort((a, b) => Number(b.isAccountManager) - Number(a.isAccountManager) || a.name.localeCompare(b.name));
  const [managerId, setManagerId] = useState<string>(sorted[0] ? String(sorted[0].userId) : "");
  const [applyToCustomer, setApplyToCustomer] = useState(true);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Assign account manager · ${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"}`}
      icon={{ tone: "blue", name: "user" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy === "assign"}
            onClick={async () => {
              const out = await run("assign", () => finance.assign({ invoiceIds, managerId: managerId ? Number(managerId) : null, applyToCustomer }), { success: managerId ? "Account manager assigned" : "Account manager cleared" });
              if (out) onClose();
            }}
          >
            {busy === "assign" ? "Saving…" : "Assign"}
          </Button>
        </>
      }
    >
      <Field label="Account manager">
        {({ id }) => (
          <Select id={id} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Unassigned</option>
            {sorted.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {m.isAccountManager ? " · account manager" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <label className="ims-row" style={{ marginTop: 12, fontSize: 13 }}>
        <Checkbox checked={applyToCustomer} onChange={setApplyToCustomer} aria-label="Also set on the customer" />
        Also set on the customer, so their future invoices go to the same person
      </label>
    </Dialog>
  );
}

/* ---------- Receipt (lump sum, FIFO) ---------- */

export function ReceiptDialog({ customers, invoices, today, initialKey, onClose }: { customers: ArCustomer[]; invoices: ImsInvoice[]; today: string; initialKey?: string | null; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const [key, setKey] = useState(initialKey ?? customers[0]?.key ?? "");
  const customer = customers.find((c) => c.key === key) ?? null;
  const open = useMemo(
    () => invoices.filter((i) => customer?.invoiceIds.includes(i.id)).sort((a, b) => (a.dueDate ?? a.invoiceDate).localeCompare(b.dueDate ?? b.invoiceDate) || a.invoiceDate.localeCompare(b.invoiceDate)),
    [invoices, customer],
  );
  const [amount, setAmount] = useState(customer ? String(customer.outstanding) : "");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PayMethod>("bank");
  const [reference, setReference] = useState("");
  const value = round2(num(amount));
  const { plan, left } = open.reduce<{ plan: Array<{ inv: ImsInvoice; take: number }>; left: number }>(
    (acc, i) => {
      const take = round2(Math.max(0, Math.min(acc.left, i.balance)));
      return { plan: [...acc.plan, { inv: i, take }], left: round2(acc.left - take) };
    },
    { plan: [], left: value },
  );
  const onAccount = Math.max(0, left);

  const save = async () => {
    if (!customer || !(value > 0)) return;
    const out = await run(
      "receipt",
      () => finance.recordReceipt({ partyId: customer.customerId, partyName: customer.name, amount: value, date, method, reference: reference.trim() || null, invoiceIds: open.map((i) => i.id) }),
      { success: `Receipt of ${inrExact(value)} recorded` },
    );
    if (out) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record payment received"
      description="The amount settles the oldest invoices first; anything extra stays on the customer's account as an advance."
      icon={{ tone: "emerald", name: "wallet" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon="check" disabled={!customer || !(value > 0) || date > today || busy === "receipt"} onClick={save}>
            {busy === "receipt" ? "Saving…" : `Record ${inrExact(value)}`}
          </Button>
        </>
      }
    >
      <div className="fin-lg">
        {customers.length ? (
          <FormGrid columns="1fr 1fr">
            <Field label="Customer *" full>
              {({ id }) => (
                <Select
                  id={id}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    const c = customers.find((x) => x.key === e.target.value);
                    setAmount(c ? String(c.outstanding) : "");
                  }}
                >
                  {customers.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name} — {inrExact(c.outstanding)} due
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Amount (₹) *">{({ id }) => <Input id={id} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
            <Field label="Date">{({ id }) => <Input id={id} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Method">{({ id }) => <MethodSelect id={id} value={method} onChange={setMethod} />}</Field>
            <Field label="Reference (UTR / cheque no.)">{({ id }) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}</Field>
          </FormGrid>
        ) : (
          <Alert tone="blue" title="No dues to collect">
            Every issued invoice is paid. Record advances from the customer&apos;s ledger instead.
          </Alert>
        )}
        {customer && value > 0 ? (
          <div style={{ marginTop: 14 }}>
            <div className="fin-section-title">How it will be applied</div>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="is-num">Balance</th>
                    <th className="is-num">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(({ inv, take }) => (
                    <tr key={inv.id} style={take ? undefined : { opacity: 0.55 }}>
                      <td>{inv.invoiceNo}</td>
                      <td>{dateLabel(inv.dueDate)}</td>
                      <td className="is-num">{inrExact(inv.balance)}</td>
                      <td className="is-num">{take ? inrExact(take) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {onAccount > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>On account (advance)</td>
                      <td className="is-num">{inrExact(onAccount)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Collections panel for one invoice ---------- */

type PanelDlg = null | "pay" | "remind" | "promise" | "dispute" | "resolve" | "note" | "assign";

export function CollectionsPanel({
  invoiceId,
  reminders,
  businessName,
  managers,
  onClose,
  onStatement,
}: {
  invoiceId: string;
  reminders: ReminderSettings;
  businessName: string;
  managers: Array<{ userId: number; name: string; isAccountManager: boolean }>;
  onClose: () => void;
  onStatement: (party: { id: string | null; name: string }) => void;
}) {
  const { session, can, navigate } = useIms();
  const { run, busy } = useImsAction();
  const state = useImsData(() => finance.invoice(invoiceId), [invoiceId]);
  const [dlg, setDlg] = useState<PanelDlg>(null);
  const inv = state.data?.invoice ?? null;

  return (
    <>
      <Dialog
        open={dlg === null}
        onClose={onClose}
        title={inv ? `${inv.invoiceNo} · ${inv.customerName}` : "Invoice"}
        wide
        actions={
          inv && can("sales") ? (
            <Button variant="ghost" onClick={() => navigate("sales", `open:${inv.id}`)}>
              Open invoice
            </Button>
          ) : undefined
        }
      >
        <div className="fin-xl">
          <Loaded state={state} rows={2}>
            {(d) => {
              const i = d.invoice;
              const open = i.status === "issued" && i.balance > 0.005;
              const items: TimelineItem[] = [
                ...d.payments.map((p) => ({ key: `p-${p.id}`, at: p.createdAt ?? p.paidOn, text: `Received ${inrExact(p.amount)} by ${methodLabel(p.method)}`, meta: `${dateLabel(p.paidOn)} · ${p.createdByName ?? "—"}`, tone: "good" as const })),
                ...d.activity.map((a) => ({
                  key: `a-${a.id}`,
                  at: a.createdAt ?? "",
                  text: `${a.kind === "reminder" ? `Reminder · ${a.channel ? CHANNEL_LABEL[a.channel as ReminderChannel] ?? a.channel : ""}` : a.kind === "promise" && a.promiseDate ? `Promise · ${inrExact(a.promiseAmount ?? 0)} by ${dateLabel(a.promiseDate)}` : a.kind[0].toUpperCase() + a.kind.slice(1)}${a.message && a.kind !== "reminder" ? ` — ${a.message}` : ""}`,
                  meta: `${stampLabel(a.createdAt)} · ${a.createdByName ?? "System"}${a.status && a.kind === "promise" ? ` · ${a.status}` : ""}`,
                  tone: activityTone(a.kind, a.status),
                })),
              ]
                .sort((a, b) => (a.at < b.at ? 1 : -1));
              return (
                <div className="bos-stack" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div className="ims-row">
                    <StatusBadge view={INVOICE_BADGE[i.displayStatus]} />
                    {open ? <StatusBadge view={AR_STATUS_BADGE[i.arStatus]} /> : null}
                    {open && i.daysOverdue > 0 ? <StatusBadge view={AR_PRIORITY_BADGE[i.priority]} /> : null}
                    {i.disputed ? <Badge tone="lavender">Disputed</Badge> : null}
                  </div>
                  <Stats
                    items={[
                      { label: "Balance", value: inrExact(i.balance), tone: i.daysOverdue > 0 ? "coral" : null },
                      { label: "Invoice total", value: inrExact(i.grandTotal) },
                      { label: "Days overdue", value: i.daysOverdue, tone: i.daysOverdue > 30 ? "coral" : i.daysOverdue > 0 ? "amber" : "emerald" },
                      { label: "Reminders", value: i.reminderCount },
                    ]}
                  />
                  <KeyValues
                    rows={[
                      ["Invoice date", dateLabel(i.invoiceDate)],
                      ["Due date", dateLabel(i.dueDate)],
                      ["Contact", [i.customerMobile, i.customerEmail].filter(Boolean).join(" · ")],
                      ["Account manager", i.accountManagerName],
                      ["Promise", i.promiseDate ? `${inrExact(i.promiseAmount ?? i.balance)} by ${dateLabel(i.promiseDate)}` : null],
                      ["Dispute", i.disputed ? i.disputeReason : null],
                      ["Last reminder", i.lastReminderAt ? stampLabel(i.lastReminderAt) : "Never"],
                    ]}
                  />
                  {open ? (
                    <div className="ims-row">
                      <Button variant="success" icon="wallet" onClick={() => setDlg("pay")}>
                        Record payment
                      </Button>
                      <Button icon="bell" onClick={() => setDlg("remind")} disabled={i.disputed}>
                        Send reminder
                      </Button>
                      <Button icon="calendar" onClick={() => setDlg("promise")}>
                        Promise to pay
                      </Button>
                      <Button icon="edit" onClick={() => setDlg("note")}>
                        Log follow-up
                      </Button>
                      <Button icon="user" onClick={() => setDlg("assign")}>
                        Assign
                      </Button>
                      {i.disputed ? (
                        <Button variant="ghost" onClick={() => setDlg("resolve")}>
                          Resolve dispute
                        </Button>
                      ) : (
                        <Button variant="ghost" icon="alert" onClick={() => setDlg("dispute")}>
                          Mark disputed
                        </Button>
                      )}
                      <Button variant="ghost" icon="file" onClick={() => onStatement({ id: i.customerId, name: i.customerName })}>
                        Statement
                      </Button>
                    </div>
                  ) : (
                    <Alert tone="emerald" title="Nothing to collect">
                      This invoice is {i.status === "issued" ? "fully paid" : i.status}.
                    </Alert>
                  )}
                  {open ? (
                    <label className="ims-row" style={{ fontSize: 13 }}>
                      <Switch
                        checked={i.autoReminder}
                        disabled={busy === "auto"}
                        onChange={(on) => run("auto", () => finance.setAutoReminder([i.id], on), { success: on ? "Auto reminders on" : "Auto reminders off" })}
                        aria-label="Include in automatic reminder rules"
                      />
                      Include in automatic reminder rules
                    </label>
                  ) : null}
                  <div>
                    <div className="fin-section-title">Activity</div>
                    <Timeline items={items} empty="No follow-ups yet." />
                  </div>
                </div>
              );
            }}
          </Loaded>
        </div>
      </Dialog>

      {inv ? (
        <>
          <PaymentDialog
            open={dlg === "pay"}
            onClose={() => setDlg(null)}
            title={`Record payment · ${inv.invoiceNo}`}
            description={`From ${inv.customerName}`}
            balance={inv.balance}
            today={session.today}
            defaultMethod="bank"
            busy={busy === "pay"}
            onSubmit={(input) => run("pay", () => finance.recordInvoicePayment(inv.id, input), { success: `Payment of ${inrExact(input.amount)} recorded` })}
          />
          {dlg === "remind" ? <ReminderDialog invoices={[inv]} reminders={reminders} businessName={businessName} onClose={() => setDlg(null)} /> : null}
          {dlg === "promise" ? <PromiseDialog invoice={inv} today={session.today} onClose={() => setDlg(null)} /> : null}
          {dlg === "note" ? <NoteDialog invoice={inv} onClose={() => setDlg(null)} /> : null}
          {dlg === "assign" ? <AssignDialog invoiceIds={[inv.id]} managers={managers} onClose={() => setDlg(null)} /> : null}
          <ReasonDialog
            open={dlg === "dispute"}
            onClose={() => setDlg(null)}
            title={`Mark ${inv.invoiceNo} as disputed`}
            description="Disputed invoices are left out of automatic reminders until resolved."
            label="What is the customer disputing?"
            confirmLabel="Mark disputed"
            busy={busy === "dispute"}
            suggestions={["Rate difference", "Short / damaged goods", "Goods not received", "GST / billing error", "Duplicate billing"]}
            onConfirm={async (reason) => {
              const out = await run("dispute", () => finance.dispute(inv.id, { disputed: true, reason }), { success: "Marked as disputed" });
              if (out) setDlg(null);
            }}
          />
          <ReasonDialog
            open={dlg === "resolve"}
            onClose={() => setDlg(null)}
            title="Resolve dispute"
            label="Resolution"
            minLength={0}
            confirmLabel="Resolve"
            busy={busy === "dispute"}
            onConfirm={async (reason) => {
              const out = await run("dispute", () => finance.dispute(inv.id, { disputed: false, reason: reason || null }), { success: "Dispute resolved" });
              if (out) setDlg(null);
            }}
          />
        </>
      ) : null}
    </>
  );
}
