"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, Dialog, EmptyState, Field, FilterChip, FormGrid, Grid, Input, KpiCard, SearchInput, Segmented, Select, Textarea, type BosColumn } from "@/components/bos";
import { ims, type ImsModuleKey } from "@/lib/ims/api";
import { stampLabel, timeAgo } from "@/lib/ims/format";
import { imsSystem, TICKET_PRIORITY_TONE, TICKET_STATUS_LABEL, TICKET_STATUS_TONE, type Ticket, type TicketList, type TicketPriority, type TicketStatus } from "@/lib/ims/system";
import { Loaded, PageHeader, PersonAvatar, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { KeyValues, ReplyBox, Thread, ToolHead, useDebounced } from "./shared";

type Tab = "tickets" | "faq";
type StatusFilter = TicketStatus | "active" | "";
const STATUSES: ReadonlyArray<TicketStatus> = ["open", "in_progress", "waiting", "resolved", "closed"];
const PRIORITIES: ReadonlyArray<TicketPriority> = ["low", "normal", "high", "urgent"];
const SUPPORT_URL = "https://justxsystems.com/";

export function HelpdeskModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("helpdesk"));
  const [tab, setTab] = useState<Tab>(intent === "faq" ? "faq" : "tickets");
  const [creating, setCreating] = useState(intent === "new");
  const [openId, setOpenId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  return (
    <Stack>
      <PageHeader
        title="Help Desk & FAQ"
        sub="Raise a ticket with your team, follow its progress, or find an answer in the FAQ."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New ticket
          </Button>
        }
      />
      <SubTabs
        label="Help desk"
        value={tab}
        onChange={setTab}
        options={[
          { value: "tickets", label: "Tickets" },
          { value: "faq", label: "FAQ" },
        ]}
      />
      {tab === "tickets" ? <TicketsTab onOpen={setOpenId} onNew={() => setCreating(true)} /> : <Faq />}
      <ContactCard />
      <NewTicketDialog open={creating} onClose={() => setCreating(false)} onCreated={(t) => setOpenId(t.id)} />
      <TicketDialog key={openId ?? "none"} id={openId} onClose={() => setOpenId(null)} />
    </Stack>
  );
}

/* ---------- Tickets ---------- */

function TicketsTab({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => imsSystem.tickets({ scope, status: status || undefined, q: dq || undefined }), [scope, status, dq]);
  return (
    <Loaded state={state}>
      {(d) => (
        <Stack gap={16}>
          <Grid cols={4} min={140}>
            <KpiCard interactive={false} label="Open" value={d.counts.open ?? 0} valueTone={(d.counts.open ?? 0) > 0 ? "amber" : undefined} />
            <KpiCard interactive={false} label="In progress" value={d.counts.in_progress ?? 0} />
            <KpiCard interactive={false} label="Waiting on raiser" value={d.counts.waiting ?? 0} />
            <KpiCard interactive={false} label="Resolved / closed" value={(d.counts.resolved ?? 0) + (d.counts.closed ?? 0)} valueTone="emerald" />
          </Grid>
          <Card interactive={false}>
            <Stack gap={12}>
              <div className="ims-toolbar" style={{ marginBottom: 0 }}>
                {d.canManage ? (
                  <Segmented
                    size="sm"
                    role="radio"
                    aria-label="Whose tickets"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: "mine", label: "My tickets" },
                      { value: "all", label: "All tickets" },
                    ]}
                  />
                ) : null}
                <SearchInput wrapperClassName="ims-grow" placeholder="Search ticket no, subject or description…" aria-label="Search tickets" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Status">
                <FilterChip active={status === "active"} onClick={() => setStatus("active")}>
                  Active
                </FilterChip>
                <FilterChip active={status === ""} onClick={() => setStatus("")}>
                  All
                </FilterChip>
                {STATUSES.map((st) => (
                  <FilterChip key={st} active={status === st} onClick={() => setStatus(st)}>
                    {TICKET_STATUS_LABEL[st]}
                  </FilterChip>
                ))}
              </div>
              <TicketTable data={d} onOpen={onOpen} onNew={onNew} />
            </Stack>
          </Card>
        </Stack>
      )}
    </Loaded>
  );
}

function TicketTable({ data, onOpen, onNew }: { data: TicketList; onOpen: (id: string) => void; onNew: () => void }) {
  const cat = new Map(data.categories.map((c) => [c.key, c.label]));
  const columns: BosColumn<Ticket>[] = [
    { key: "no", header: "Ticket", mono: true, cell: (t) => t.ticketNo },
    {
      key: "subject",
      header: "Subject",
      cell: (t) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{t.subject}</span>
          <small>{cat.get(t.category) ?? t.category}</small>
        </span>
      ),
    },
    { key: "priority", header: "Priority", cell: (t) => <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{t.priority}</Badge> },
    { key: "status", header: "Status", cell: (t) => <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge> },
    ...(data.scope === "all"
      ? [
          {
            key: "by",
            header: "Raised by",
            cell: (t: Ticket) => (
              <span className="ims-row" style={{ gap: 8 }}>
                <PersonAvatar name={t.raisedByName} size="xs" />
                {t.raisedByName ?? "—"}
              </span>
            ),
          },
        ]
      : []),
    { key: "assignee", header: "Assigned", cell: (t) => <span className="ims-muted">{t.assignedToName ?? "—"}</span> },
    { key: "replies", header: "Replies", align: "right", cell: (t) => <span className="ims-num">{t.replies}</span> },
    { key: "updated", header: "Updated", cell: (t) => <span className="ims-muted" title={stampLabel(t.updatedAt)}>{timeAgo(t.lastReplyAt ?? t.updatedAt)}</span> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={data.tickets}
      rowKey={(t) => t.id}
      onRowClick={(t) => onOpen(t.id)}
      chevron
      caption="Tickets"
      empty={
        <EmptyState icon="tasks" title="No tickets here" actions={<Button size="sm" variant="primary" onClick={onNew}>Raise a ticket</Button>}>
          Stuck on something? Raise a ticket — your owner or manager is notified and replies right here.
        </EmptyState>
      }
    />
  );
}

function NewTicketDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: Ticket) => void }) {
  const { run, isBusy } = useImsAction();
  const meta = useImsData(() => imsSystem.tickets({ scope: "mine", status: "active" }).then((r) => r.categories), []);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [description, setDescription] = useState("");
  const valid = subject.trim().length >= 4 && description.trim().length >= 10;
  const submit = async () => {
    const r = await run("create", () => imsSystem.createTicket({ subject: subject.trim(), category, priority, description: description.trim() }), { success: "Ticket raised", description: "Your team has been notified." });
    if (r) {
      setSubject("");
      setDescription("");
      setPriority("normal");
      onClose();
      onCreated(r.ticket);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Raise a ticket"
      description="Say what you were doing, what you expected and what happened instead. Include document numbers (invoice, PO, item SKU) so it can be found quickly."
      icon={{ tone: "blue", name: "tasks" }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || isBusy("create")} onClick={() => void submit()}>
            {isBusy("create") ? "Raising…" : "Raise ticket"}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        <Field label="Subject" error={subject && subject.trim().length < 4 ? "A few more words, please" : null}>
          {({ id }) => <Input id={id} value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Invoice INV-0042 shows the wrong GST" />}
        </Field>
        <FormGrid>
          <Field label="Category">
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {(meta.data ?? [{ key: "general", label: "General question" }]).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority" hint={priority === "urgent" ? "Urgent tickets alert owners immediately." : undefined}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
        <Field label="Details" hint={`${description.trim().length} / 8000`}>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={6} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </Stack>
    </Dialog>
  );
}

function TicketDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { session } = useIms();
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => (id ? imsSystem.ticket(id).then((r) => r.ticket) : Promise.resolve(null)), [id]);
  const list = useImsData(() => (id ? imsSystem.tickets({ scope: "mine", status: "active" }).then((r) => ({ canManage: r.canManage, categories: r.categories })) : Promise.resolve(null)), [id]);
  const team = useImsData(() => (list.data?.canManage ? ims.team().then((r) => r.members.filter((m) => m.active && ["owner", "manager"].includes(m.imsRole))) : Promise.resolve([])), [list.data?.canManage]);
  const t = state.data;
  const me = session.actor.userId;
  const canManage = list.data?.canManage ?? false;
  const mine = t?.raisedBy !== null && t?.raisedBy === me;
  const cat = new Map((list.data?.categories ?? []).map((c) => [c.key, c.label]));
  const update = (patch: Parameters<typeof imsSystem.updateTicket>[1], success: string) => (t ? run("update", () => imsSystem.updateTicket(t.id, patch), { success }) : Promise.resolve(undefined));
  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      wide
      title={t ? `${t.ticketNo} · ${t.subject}` : "Ticket"}
      description={t ? `Raised by ${t.raisedByName ?? "—"} · ${stampLabel(t.createdAt)}` : undefined}
      actionsNote={
        t && (mine || canManage) ? (
          t.status === "closed" || t.status === "resolved" ? (
            <Button size="sm" variant="ghost" disabled={isBusy("update")} onClick={() => void update({ status: "open" }, "Ticket reopened")}>
              Reopen
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={isBusy("update")} onClick={() => void update({ status: "closed" }, "Ticket closed")}>
              Close ticket
            </Button>
          )
        ) : null
      }
      actions={<Button onClick={onClose}>Done</Button>}
    >
      {t ? (
        <Stack gap={14}>
          <div className="ims-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABEL[t.status]}</Badge>
            <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
            <Badge tone="neutral">{cat.get(t.category) ?? t.category}</Badge>
          </div>
          {canManage ? (
            <FormGrid columns="1fr 1fr 1fr">
              <Field label="Status">
                {({ id: fid }) => (
                  <Select id={fid} size="sm" value={t.status} disabled={isBusy("update")} onChange={(e) => void update({ status: e.target.value as TicketStatus }, "Status updated")}>
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {TICKET_STATUS_LABEL[st]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Priority">
                {({ id: fid }) => (
                  <Select id={fid} size="sm" value={t.priority} disabled={isBusy("update")} onChange={(e) => void update({ priority: e.target.value as TicketPriority }, "Priority updated")}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Assigned to">
                {({ id: fid }) => (
                  <Select
                    id={fid}
                    size="sm"
                    value={t.assignedTo ?? ""}
                    disabled={isBusy("update")}
                    onChange={(e) => {
                      const uid = e.target.value ? Number(e.target.value) : null;
                      const m = team.data?.find((x) => x.userId === uid);
                      void update({ assignedTo: uid, assignedToName: m ? (m.name ?? m.email) : null }, uid ? "Ticket assigned" : "Unassigned");
                    }}
                  >
                    <option value="">Unassigned</option>
                    {(team.data ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
          ) : (
            <KeyValues
              rows={[
                ["Assigned to", t.assignedToName ?? "Not yet assigned"],
                ["Last update", timeAgo(t.updatedAt)],
              ]}
            />
          )}
          <Card interactive={false} flat>
            <div className="ims-sys-msg-meta">Original request</div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55 }}>{t.description}</div>
          </Card>
          <Thread entries={t.thread ?? []} meId={me} empty="No replies yet." />
          {t.status !== "closed" ? (
            <ReplyBox
              busy={isBusy("reply")}
              placeholder={canManage && !mine ? "Reply to the raiser…" : "Add details or answer a question…"}
              onSend={async (text) => Boolean(await run("reply", () => imsSystem.replyTicket(t.id, text), { success: "Reply sent" }))}
            />
          ) : (
            <p className="ims-muted" style={{ margin: 0, fontSize: 13 }}>
              This ticket is closed. Reopen it to continue the conversation.
            </p>
          )}
        </Stack>
      ) : (
        <Loaded state={state}>{() => null}</Loaded>
      )}
    </Dialog>
  );
}

/* ---------- FAQ ---------- */

type FaqEntry = { area: string; module?: ImsModuleKey; q: string; a: string[] };

const FAQ: ReadonlyArray<FaqEntry> = [
  { area: "Getting started", module: "settings", q: "What should I set up first?", a: ["Open Settings → Business profile and fill in your business name, GSTIN, state, financial-year start and document prefixes. Then add your items (Items → Add or Import), your suppliers and customers (Parties), and invite your team with the right IMS role."] },
  { area: "Getting started", module: "settings", q: "How do roles and permissions work?", a: ["Every person has one IMS role (Manager, Store incharge, Staff, Accountant, Auditor, Field, Viewer). Owners can tick exactly what each role may do in Settings → Role permissions — for example letting Staff record stock out but not see purchase prices."] },
  { area: "Dashboard", module: "dashboard", q: "What do the dashboard numbers mean?", a: ["Stock value is current stock × purchase price; Sales MTD is issued invoices this month; Receivable and Payable are open balances today. Click any tile to jump to the screen behind it."] },
  { area: "Items", module: "items", q: "How do I import my existing item list?", a: ["Items → Import accepts Excel or CSV with columns such as Name, SKU, Category, Unit, HSN, GST rate, Purchase price, Selling price and Opening stock. Existing SKUs are updated; new ones are created with an opening-stock movement."] },
  { area: "Items", module: "items", q: "Why can't I delete an item?", a: ["Items with stock history are archived instead of deleted so your ledger stays complete. Archived items disappear from pickers but stay in reports."] },
  { area: "Stock", module: "stockin", q: "What's the difference between Stock In and receiving a PO?", a: ["Receiving against a purchase order also updates the PO and can create the supplier bill. Use Stock In for receipts without a PO — opening stock, transfers or free samples."] },
  { area: "Stock", module: "stockout", q: "Stock out says 'insufficient stock'. What now?", a: ["IMS blocks issuing more than you have unless Settings → Allow negative stock is on. Check for a missed receipt first; if the physical count really is higher, post a stock check or adjustment with a reason."] },
  { area: "Stock", module: "checks", q: "How do stock checks (physical counts) work?", a: ["Start a check for a category, location or all items, count on any device, then submit. A manager approves and IMS posts one adjustment per difference with the reason 'Stock check', so the audit trail shows who counted and who approved."] },
  { area: "Stock", module: "lowstock", q: "How is 'low stock' decided?", a: ["An item is low when its stock is at or below its minimum level, and out of stock at zero. Low Stock groups these by supplier so you can raise purchase orders in one click."] },
  { area: "Stock", module: "returns", q: "How do I record damaged or returned goods?", a: ["Returns handles customer returns (back into stock or quarantine) and returns to suppliers. Damaged units go to quarantine and can be written off later with a reason — both show up in the auditor's unusual-entries checks if large."] },
  { area: "Stock", module: "history", q: "Can I see who changed what?", a: ["Transactions & Activity lists every stock movement and every change in IMS with the person, time and before/after quantities. Export it to CSV or Excel for your records."] },
  { area: "Stock", module: "scanner", q: "Can I use barcodes?", a: ["Yes. Add barcodes to items, then use the Scanner to look items up and move stock quickly."] },
  { area: "Purchasing", module: "parties", q: "Where do I keep supplier and customer details?", a: ["Parties holds both. GSTIN and state on the party decide whether invoices and bills use CGST + SGST or IGST, and payment terms set due dates."] },
  { area: "Purchasing", module: "purchase", q: "How does a purchase order flow?", a: ["Draft → submit for approval (if required) → approved → sent to the supplier (WhatsApp, email or print) → received in full or in parts. Receiving updates stock and can create the bill for payables."] },
  { area: "Purchasing", module: "approvals", q: "Who approves purchase orders and bills?", a: ["Anyone whose role has the Approvals permission. Approvers see everything waiting in Approvals and get a notification; decisions are recorded with their name and time."] },
  { area: "Sales", module: "sales", q: "Why does a new invoice show a DRAFT number?", a: ["Drafts get a temporary DRAFT-XXXX number so the real invoice series has no gaps. The next number in your series is assigned when you issue the invoice."] },
  { area: "Sales", module: "sales", q: "How do I bring in an approved quotation?", a: ["Open Connected Tools, pick Quotation V1 and import the approved quotations you want. Each becomes a draft invoice with its customer and lines — review it in Invoices & Billing and issue it."] },
  { area: "Finance", module: "receivables", q: "How do payment reminders work?", a: ["Receivables lists open invoices by age. Send reminders by WhatsApp, SMS or email from the invoice, or turn on automatic reminders (before due, on due date and after 7/15/30/60/90 days) in Settings."] },
  { area: "Finance", module: "payables", q: "How do I pay several supplier bills at once?", a: ["In Payables, select the approved bills and create a payment run. Each bill is marked paid with the method and reference you record, grouped under one run for easy reconciliation."] },
  { area: "Finance", module: "ledger", q: "What is the Ledger / Khata?", a: ["A simple party-wise book of money given and received outside invoices — advances, small credits, cash adjustments — with due dates and settlement tracking."] },
  { area: "Finance", module: "closing", q: "What does daily closing do?", a: ["It freezes the day's figures (sales, receipts, payments, expenses, expected vs counted cash) and records who closed the day and any cash variance."] },
  { area: "Field", module: "field", q: "How do field / onsite visits work?", a: ["Field staff record their onsite visits and reports from their phone. Managers review them in Field / Onsite and follow up from there."] },
  { area: "Insights", module: "reports", q: "Which reports are available?", a: ["Sales, purchase, stock and finance reports, each filtered by period. Most tables in IMS can also be exported to CSV or Excel."] },
  { area: "Insights", module: "gst", q: "Does IMS file my GST returns?", a: ["IMS prepares GSTR-1 style summaries (B2B, B2C, HSN, rate-wise) and an input vs output view. Review them with your CA and file on the GST portal; export the data from the GST screen."] },
  { area: "Compliance", module: "excise", q: "How do I keep the excise register?", a: ["Turn on excise in Settings. In Excise Records, add one entry per permit / transport pass with cases, bottles, issues and duty. IMS carries the closing balance forward, totals duty for the month and year, and prints the register."] },
  { area: "Compliance", module: "audit", q: "How do I give my CA access?", a: ["Invite your CA to the organisation, then in Settings → Team set their IMS role to Auditor. They get the Auditing / CA workspace (ledgers, bank reconciliation, GST, documents and queries) without being able to change your transactions."] },
  { area: "Compliance", module: "audit", q: "What are 'audit issues'?", a: ["Rules that check your books automatically: GST that doesn't add up, overdue receivables and payables, possible duplicates, missing supplier invoices, negative or mismatched stock, large adjustments, edits after approval, failed Tally syncs and unreconciled bank lines. Your auditor marks each as verified or dismissed."] },
  { area: "Compliance", module: "audit", q: "How does bank reconciliation work?", a: ["Upload your bank statement (CSV or Excel) in Auditing → Banking. IMS reads the date, narration, reference and amounts, skips duplicates and auto-matches lines to receipts, payments and expenses by amount, date and reference. Match the rest by hand or mark them ignored."] },
  { area: "Integrations", module: "integrations", q: "How do I connect Tally?", a: ["In Tally, enable the XML server (F1 Help → Settings → Connectivity, port 9000). In Tally & POS, enter the host, port and exact company name and press Test connection, then Sync now. If your Tally PC isn't reachable from the internet, download the XML and import it in Tally instead — it always works."] },
  { area: "Integrations", module: "integrations", q: "Tally rejected some vouchers. Why?", a: ["Usually a ledger or stock item doesn't exist in Tally yet, or the company isn't open. Sync masters first (or import the masters XML), then vouchers. The sync log shows Tally's exact error for each batch."] },
  { area: "Integrations", module: "integrations", q: "How does the POS integration work?", a: ["Connect your POS in Tally & POS. Each bill it sends reduces stock and becomes a paid invoice (or credit invoice) in IMS. The same bill number is never booked twice. Use 'Simulate a POS sale' to see the flow end to end."] },
  { area: "Integrations", module: "connect", q: "What are Connected Tools?", a: ["Other Justx tools in your organisation. Bring approved quotations in as draft invoices, and import Justx BOS products, customers and vendors as IMS items and parties. Issued IMS invoices are available in Justx BOS → Connected tools."] },
  { area: "Help", module: "helpdesk", q: "Who answers my tickets?", a: ["Tickets go to your organisation's owners and anyone with the Settings permission. For product problems they can't solve, contact Justx support using the card below."] },
];

function Faq() {
  const { navigate } = useIms();
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const areas = useMemo(() => [...new Set(FAQ.map((f) => f.area))], []);
  const needle = q.trim().toLowerCase();
  const shown = FAQ.filter((f) => (!area || f.area === area) && (!needle || `${f.q} ${f.a.join(" ")} ${f.area}`.toLowerCase().includes(needle)));
  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <SearchInput placeholder="Search the FAQ — e.g. Tally, GST, reminders, barcode…" aria-label="Search FAQ" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Topic">
          <FilterChip active={!area} onClick={() => setArea("")}>
            All topics
          </FilterChip>
          {areas.map((a) => (
            <FilterChip key={a} active={area === a} onClick={() => setArea(a)}>
              {a}
            </FilterChip>
          ))}
        </div>
        {shown.length ? (
          <div className="ims-sys-faq">
            {shown.map((f) => (
              <details key={f.q}>
                <summary>
                  <span>{f.q}</span>
                  <span className="ims-sys-faq-tag">{f.area}</span>
                </summary>
                <div className="ims-sys-faq-body">
                  {f.a.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  {f.module ? (
                    <Button size="sm" variant="ghost" onClick={() => navigate(f.module as ImsModuleKey)}>
                      Go there →
                    </Button>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState icon="search" title="No answers match">
            Try another word, or raise a ticket and your team will help.
          </EmptyState>
        )}
      </Stack>
    </Card>
  );
}

function ContactCard() {
  const { session } = useIms();
  return (
    <Card interactive={false}>
      <div className="ims-sys-contact">
        <ToolHead
          glyph="🛟"
          title="Contact Justx support"
          sub={`For product problems, billing or feature requests. Quote your business code JBT-${String(session.tenantId).padStart(4, "0")} and the ticket number if you have one.`}
        />
        <a className="bos-btn bos-btn-primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
          Visit justxsystems.com ↗
        </a>
      </div>
    </Card>
  );
}
