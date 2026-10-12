"use client";

import "./finance.css";
import { useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, DataTable, EmptyState, Grid, KpiCard, SearchInput, Segmented, Select, WidgetCard, WidgetRow, type BosColumn } from "@/components/bos";
import type { AgingKey } from "@/lib/ims/api";
import { AR_PRIORITY_BADGE, AR_STATUS_BADGE, CHANNEL_LABEL, finance, type ArCustomer, type ArPriority, type ImsInvoice, type ReceivablesData } from "@/lib/ims/finance";
import { dateLabel, downloadCsv, inr, inrCompact, inrExact, timeAgo } from "@/lib/ims/format";
import { Loaded, PageHeader, RequirePerm, Stack, StatusBadge, useIms, useImsAction, useImsData } from "../core";
import { AssignDialog, CollectionsPanel, ReceiptDialog, ReminderDialog } from "./ArDialogs";
import { StatementDialog } from "./Statement";

type ViewMode = "invoices" | "customers";
type Bucket = "" | AgingKey | "notdue";
type ReminderJob = { invoices: ImsInvoice[]; rule?: string | null; templateKey?: string | null };

const customerKeyOf = (i: Pick<ImsInvoice, "customerId" | "customerName">) => i.customerId ?? `name:${i.customerName.toLowerCase()}`;
const PRIORITY_RANK: Record<ArPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function ReceivablesModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("receivables"));
  const state = useImsData(() => finance.receivables(), []);
  return (
    <RequirePerm perm="receivables" what="accounts receivable">
      <Stack>
        <Loaded state={state} rows={3}>
          {(data) => <ReceivablesBody data={data} intent={intent} />}
        </Loaded>
      </Stack>
    </RequirePerm>
  );
}

function ReceivablesBody({ data, intent }: { data: ReceivablesData; intent: string | null }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const [mode, setMode] = useState<ViewMode>("invoices");
  const [bucket, setBucket] = useState<Bucket>("");
  const [priority, setPriority] = useState<"" | ArPriority>("");
  const [manager, setManager] = useState("");
  const [q, setQ] = useState("");
  const [customerKey, setCustomerKey] = useState("");
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<string | null>(() => (intent?.startsWith("open:") ? intent.slice(5) : null));
  const [receipt, setReceipt] = useState<{ key: string | null } | null>(() => (intent === "pay" ? { key: null } : null));
  const [reminder, setReminder] = useState<ReminderJob | null>(null);
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [statement, setStatement] = useState<{ id: string | null; name: string } | null>(null);
  const k = data.kpis;
  const today = data.today;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.invoices.filter(
      (i) =>
        (!bucket || (bucket === "notdue" ? i.daysOverdue === 0 : i.daysOverdue > 0 && i.agingBucket === bucket)) &&
        (!priority || (i.daysOverdue > 0 && i.priority === priority)) &&
        (!manager || (manager === "__none" ? !i.accountManagerName : i.accountManagerName === manager)) &&
        (!disputedOnly || i.disputed) &&
        (!customerKey || customerKeyOf(i) === customerKey) &&
        (!term || [i.invoiceNo, i.customerName, i.customerMobile, i.customerGstin].some((v) => v?.toLowerCase().includes(term))),
    );
  }, [data.invoices, bucket, priority, manager, disputedOnly, customerKey, q]);

  const customers = useMemo(() => {
    const map = new Map<string, ArCustomer>();
    for (const i of filtered) {
      const key = customerKeyOf(i);
      const c = map.get(key) ?? { key, customerId: i.customerId, name: i.customerName, mobile: i.customerMobile, email: i.customerEmail, accountManagerName: i.accountManagerName, openCount: 0, outstanding: 0, overdue: 0, oldestDaysOverdue: 0, priority: "LOW" as ArPriority, disputedCount: 0, promiseCount: 0, lastReminderAt: null, invoiceIds: [] };
      c.openCount += 1;
      c.outstanding = Math.round((c.outstanding + i.balance) * 100) / 100;
      if (i.daysOverdue > 0) c.overdue = Math.round((c.overdue + i.balance) * 100) / 100;
      c.oldestDaysOverdue = Math.max(c.oldestDaysOverdue, i.daysOverdue);
      if (i.daysOverdue > 0 && PRIORITY_RANK[i.priority] > PRIORITY_RANK[c.priority]) c.priority = i.priority;
      if (i.disputed) c.disputedCount += 1;
      if (i.promiseDate) c.promiseCount += 1;
      if (i.lastReminderAt && (!c.lastReminderAt || i.lastReminderAt > c.lastReminderAt)) c.lastReminderAt = i.lastReminderAt;
      c.invoiceIds.push(i.id);
      map.set(key, c);
    }
    return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  }, [filtered]);

  const managerNames = useMemo(() => [...new Set(data.invoices.map((i) => i.accountManagerName).filter((n): n is string => Boolean(n)))].sort(), [data.invoices]);
  const filtersOn = Boolean(bucket || priority || manager || q || customerKey || disputedOnly);
  const selectedInvoices = data.invoices.filter((i) => selected.has(i.id));
  const totalAging = data.aging.reduce((s, b) => s + b.amount, 0) + data.notDue.amount;

  const ruleGroups = useMemo(() => {
    const byId = new Map(data.invoices.map((i) => [i.id, i]));
    const groups = new Map<string, { rule: string; label: string; templateKey: string | null; invoices: ImsInvoice[] }>();
    for (const m of data.ruleMatches) {
      const inv = byId.get(m.invoiceId);
      if (!inv) continue;
      const g = groups.get(m.rule) ?? { rule: m.rule, label: m.ruleLabel, templateKey: m.templateKey, invoices: [] };
      g.invoices.push(inv);
      groups.set(m.rule, g);
    }
    return [...groups.values()];
  }, [data.ruleMatches, data.invoices]);

  const invoiceColumns: BosColumn<ImsInvoice>[] = [
    {
      key: "inv",
      header: "Invoice",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{i.invoiceNo}</span>
          <small>{dateLabel(i.invoiceDate)}</small>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{i.customerName}</span>
          <small>{[i.accountManagerName ? `AM: ${i.accountManagerName}` : null, i.customerMobile].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      cell: (i) => (
        <span className="ims-cell-stack">
          <span className={i.daysOverdue > 0 ? "ims-neg" : undefined}>{dateLabel(i.dueDate)}</span>
          <small>{i.daysOverdue > 0 ? `${i.daysOverdue}d overdue` : i.dueDate === today ? "Due today" : "Not due"}</small>
        </span>
      ),
    },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (i) => inrExact(i.balance) },
    {
      key: "status",
      header: "Status",
      cell: (i) => (
        <span className="ims-row" style={{ gap: 4 }}>
          <StatusBadge view={AR_STATUS_BADGE[i.arStatus]} />
          {i.daysOverdue > 0 && i.priority !== "LOW" ? <StatusBadge view={AR_PRIORITY_BADGE[i.priority]} /> : null}
        </span>
      ),
    },
    {
      key: "follow",
      header: "Last follow-up",
      cell: (i) => (i.lastReminderAt ? <span className="ims-cell-stack"><span>{timeAgo(i.lastReminderAt)}</span><small>{i.reminderCount} reminder{i.reminderCount === 1 ? "" : "s"}{i.lastReminderChannel ? ` · ${CHANNEL_LABEL[i.lastReminderChannel as keyof typeof CHANNEL_LABEL] ?? i.lastReminderChannel}` : ""}</small></span> : <span className="ims-faint">Never</span>),
    },
  ];

  const customerColumns: BosColumn<ArCustomer>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{c.name}</span>
          <small>{[c.accountManagerName ? `AM: ${c.accountManagerName}` : null, c.mobile].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    { key: "open", header: "Open", align: "right", cell: (c) => c.openCount },
    { key: "outstanding", header: "Outstanding", align: "right", mono: true, cell: (c) => inrExact(c.outstanding) },
    { key: "overdue", header: "Overdue", align: "right", mono: true, cell: (c) => (c.overdue > 0 ? <span className="ims-neg">{inrExact(c.overdue)}</span> : <span className="ims-faint">—</span>) },
    { key: "oldest", header: "Oldest", align: "right", cell: (c) => (c.oldestDaysOverdue ? `${c.oldestDaysOverdue}d` : "—") },
    { key: "priority", header: "Priority", cell: (c) => (c.overdue > 0 ? <StatusBadge view={AR_PRIORITY_BADGE[c.priority]} /> : <span className="ims-faint">—</span>) },
    {
      key: "actions",
      header: "",
      cell: (c) => (
        <span className="ims-row" style={{ gap: 4, flexWrap: "nowrap" }} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setReceipt({ key: c.key })}>
            Receive
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStatement({ id: c.customerId, name: c.name })}>
            Statement
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Accounts Receivable"
        sub={`${inr(k.totalOutstanding)} to collect from ${k.customerCount} customer${k.customerCount === 1 ? "" : "s"} across ${k.openCount} open invoice${k.openCount === 1 ? "" : "s"}.`}
        actions={
          <>
            <Button
              icon="download"
              disabled={!filtered.length}
              onClick={() =>
                downloadCsv("receivables", filtered, [
                  { header: "Invoice", value: (i) => i.invoiceNo },
                  { header: "Date", value: (i) => i.invoiceDate },
                  { header: "Customer", value: (i) => i.customerName },
                  { header: "Mobile", value: (i) => i.customerMobile },
                  { header: "Due date", value: (i) => i.dueDate },
                  { header: "Days overdue", value: (i) => i.daysOverdue },
                  { header: "Aging", value: (i) => (i.daysOverdue > 0 ? i.agingBucket : "Not due") },
                  { header: "Total", value: (i) => i.grandTotal },
                  { header: "Paid", value: (i) => i.amountPaid },
                  { header: "Balance", value: (i) => i.balance },
                  { header: "Priority", value: (i) => i.priority },
                  { header: "Status", value: (i) => AR_STATUS_BADGE[i.arStatus].text },
                  { header: "Account manager", value: (i) => i.accountManagerName },
                  { header: "Promise date", value: (i) => i.promiseDate },
                  { header: "Reminders", value: (i) => i.reminderCount },
                ])
              }
            >
              Export
            </Button>
            <Button variant="primary" icon="wallet" onClick={() => setReceipt({ key: null })}>
              Record payment
            </Button>
          </>
        }
      />

      <Grid cols={3} min={170}>
        <KpiCard label="Total outstanding" value={inrCompact(k.totalOutstanding)} chip={{ color: "blue", glyph: "💰" }} delta={`${k.openCount} open invoices`} deltaTone="muted" />
        <KpiCard
          label="Overdue"
          value={inrCompact(k.overdue)}
          valueTone={k.overdue > 0 ? "coral" : undefined}
          chip={{ color: "rose", glyph: "⏰" }}
          delta={k.overdue90 > 0 ? `${inrCompact(k.overdue90)} over 90 days` : `${k.overdueCount} invoices`}
          deltaTone={k.overdue90 > 0 ? "down" : k.overdueCount ? "warn" : "up"}
        />
        <KpiCard label="Due this week" value={inrCompact(k.dueThisWeek)} chip={{ color: "amber", glyph: "📅" }} delta={`${k.dueThisWeekCount} invoices in the next 7 days`} deltaTone="info" />
        <KpiCard label="Collected this month" value={inrCompact(k.collectedThisMonth)} valueTone="emerald" chip={{ color: "mint", glyph: "✓" }} delta={`${k.collectedThisMonthCount} receipts · ${inrCompact(k.expectedThisMonth)} more due this month`} deltaTone="up" />
        <KpiCard label="Days sales outstanding" value={`${k.dso} days`} chip={{ color: "lavender", glyph: "⌛" }} delta="Outstanding ÷ last 90 days of sales" deltaTone={k.dso > 60 ? "down" : k.dso > 30 ? "warn" : "up"} />
        <KpiCard
          label="Promises due"
          value={inrCompact(k.promisesDue)}
          chip={{ color: "sage", glyph: "🤝" }}
          delta={k.promisesMissedCount ? `${k.promisesMissedCount} missed · ${k.promisesDueCount} due` : `${k.promisesDueCount} due by today`}
          deltaTone={k.promisesMissedCount ? "down" : "muted"}
        />
      </Grid>

      <Grid template="1.35fr 1fr" min={300}>
        <WidgetCard title="Aging" dot="blue" note={inr(totalAging)}>
          {totalAging > 0 ? (
            <>
              <div className="ims-stackbar" role="img" aria-label="Outstanding by age">
                <span style={{ width: `${(data.notDue.amount / totalAging) * 100}%`, background: "#8BC3A6" }} />
                {data.aging.map((b) => (
                  <span key={b.key} style={{ width: `${(b.amount / totalAging) * 100}%`, background: b.color }} />
                ))}
              </div>
              <div className="ims-bars" style={{ marginTop: 14 }}>
                {[{ key: "notdue" as const, label: "Not yet due", color: "#8BC3A6", amount: data.notDue.amount, count: data.notDue.count }, ...data.aging].map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className="ims-bar-row"
                    aria-pressed={bucket === b.key}
                    onClick={() => setBucket(bucket === b.key ? "" : b.key)}
                    style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left", opacity: bucket && bucket !== b.key ? 0.5 : 1 }}
                  >
                    <span>
                      <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, marginRight: 6, background: b.color }} />
                      {b.label}
                    </span>
                    <span className="ims-bar-track">
                      <span className="ims-bar-fill" style={{ display: "block", width: `${totalAging ? (b.amount / totalAging) * 100 : 0}%`, background: b.color }} />
                    </span>
                    <span className="ims-num">
                      {inr(b.amount)} <small className="ims-faint">· {b.count}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <EmptyState glyph="✓" title="Nothing outstanding">
              Every issued invoice is paid.
            </EmptyState>
          )}
        </WidgetCard>

        <WidgetCard title="Collection focus" dot="rose">
          {customers.filter((c) => c.overdue > 0).slice(0, 5).map((c) => (
            <WidgetRow
              key={c.key}
              chevron
              onClick={() => {
                setCustomerKey(c.key);
                setMode("invoices");
              }}
              label={
                <span className="ims-cell-stack">
                  <span className="ims-strong">{c.name}</span>
                  <small>
                    {c.oldestDaysOverdue}d oldest · {c.openCount} invoice{c.openCount === 1 ? "" : "s"}
                  </small>
                </span>
              }
              value={inr(c.overdue)}
              valueTone="coral"
            />
          ))}
          {!customers.some((c) => c.overdue > 0) ? <p className="ims-faint">No overdue customers{filtersOn ? " in this view" : ""}.</p> : null}
          {k.disputedCount ? <WidgetRow soft label={`${k.disputedCount} disputed invoice${k.disputedCount === 1 ? "" : "s"}`} value={inr(k.disputed)} onClick={() => setDisputedOnly(true)} chevron /> : null}
        </WidgetCard>
      </Grid>

      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 8 }}>
          <div className="ims-cell-stack">
            <span className="ims-strong">Automatic reminder rules</span>
            <small className="ims-faint">
              {data.reminders.autoEnabled ? "On" : "Off"} · {Object.entries(data.reminders.rules).filter(([, on]) => on).length} rules active · change rules and templates in Settings → Reminders
            </small>
          </div>
          {ruleGroups.length ? (
            <Button size="sm" variant="primary" icon="bell" onClick={() => setReminder({ invoices: ruleGroups.flatMap((g) => g.invoices), rule: ruleGroups.length === 1 ? ruleGroups[0].rule : "auto", templateKey: ruleGroups[0].templateKey })}>
              Send all due reminders ({ruleGroups.reduce((s, g) => s + g.invoices.length, 0)})
            </Button>
          ) : null}
        </div>
        {ruleGroups.length ? (
          <div className="ims-row">
            {ruleGroups.map((g) => (
              <Button key={g.rule} size="sm" onClick={() => setReminder({ invoices: g.invoices, rule: g.rule, templateKey: g.templateKey })}>
                {g.label} · {g.invoices.length}
              </Button>
            ))}
          </div>
        ) : (
          <p className="ims-faint" style={{ fontSize: 13 }}>
            No invoices match a reminder rule today.
          </p>
        )}
        <p className="fin-note" style={{ marginTop: 8 }}>
          IMS prepares and logs each reminder and opens WhatsApp, SMS or email with the message ready — you press send. Fully automatic delivery through a messaging gateway isn&apos;t part of this tool.
        </p>
      </Card>

      <Card interactive={false}>
        <div className="ims-toolbar">
          <Segmented
            size="sm"
            role="tabs"
            aria-label="View"
            value={mode}
            onChange={setMode}
            options={[
              { value: "invoices", label: `Invoices · ${filtered.length}` },
              { value: "customers", label: `Customers · ${customers.length}` },
            ]}
          />
          <SearchInput wrapperClassName="ims-grow" placeholder="Search invoice, customer, mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receivables" />
        </div>
        <div className="ims-toolbar">
          <Select size="sm" value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)} aria-label="Aging bucket" style={{ maxWidth: 170 }}>
            <option value="">All ages</option>
            <option value="notdue">Not yet due</option>
            {data.aging.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label} overdue
              </option>
            ))}
          </Select>
          <Select size="sm" value={priority} onChange={(e) => setPriority(e.target.value as "" | ArPriority)} aria-label="Priority" style={{ maxWidth: 150 }}>
            <option value="">Any priority</option>
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => (
              <option key={p} value={p}>
                {AR_PRIORITY_BADGE[p].text}
              </option>
            ))}
          </Select>
          <Select size="sm" value={manager} onChange={(e) => setManager(e.target.value)} aria-label="Account manager" style={{ maxWidth: 190 }}>
            <option value="">All account managers</option>
            <option value="__none">Unassigned</option>
            {managerNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Select size="sm" value={customerKey} onChange={(e) => setCustomerKey(e.target.value)} aria-label="Customer" style={{ maxWidth: 200 }}>
            <option value="">All customers</option>
            {data.customers.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="ims-row" style={{ fontSize: 13 }}>
            <Checkbox checked={disputedOnly} onChange={setDisputedOnly} aria-label="Disputed only" />
            Disputed only
          </label>
          {filtersOn ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBucket("");
                setPriority("");
                setManager("");
                setQ("");
                setCustomerKey("");
                setDisputedOnly(false);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {customerKey && mode === "invoices" ? (
          <div style={{ marginBottom: 10 }}>
            <Alert
              tone="blue"
              title={data.customers.find((c) => c.key === customerKey)?.name ?? "Customer"}
              actions={
                <>
                  <Button size="sm" onClick={() => setReceipt({ key: customerKey })}>
                    Record payment
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const c = data.customers.find((x) => x.key === customerKey);
                      if (c) setStatement({ id: c.customerId, name: c.name });
                    }}
                  >
                    Statement of account
                  </Button>
                </>
              }
            >
              {inrExact(filtered.reduce((s, i) => s + i.balance, 0))} outstanding across {filtered.length} invoice{filtered.length === 1 ? "" : "s"}.
            </Alert>
          </div>
        ) : null}

        {mode === "invoices" ? (
          <DataTable
            caption="Open invoices"
            columns={invoiceColumns}
            rows={filtered}
            rowKey={(i) => i.id}
            onRowClick={(i) => setPanel(i.id)}
            chevron
            selection={{ selected, onChange: setSelected }}
            bulkActions={(count) => (
              <div className="fin-bulk">
                <Button size="sm" icon="bell" onClick={() => setReminder({ invoices: selectedInvoices.filter((i) => !i.disputed) })} disabled={!selectedInvoices.some((i) => !i.disputed)}>
                  Remind {count}
                </Button>
                <Button size="sm" icon="user" onClick={() => setAssignIds([...selected])}>
                  Assign
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === "auto"} onClick={() => run("auto", () => finance.setAutoReminder([...selected], true), { success: "Auto reminders on" })}>
                  Auto on
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === "auto"} onClick={() => run("auto", () => finance.setAutoReminder([...selected], false), { success: "Auto reminders off" })}>
                  Auto off
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}
            empty={
              <EmptyState glyph="✓" title={filtersOn ? "No invoices match these filters" : "Nothing to collect"}>
                {filtersOn ? "Try clearing a filter." : "All issued invoices are paid."}
              </EmptyState>
            }
          />
        ) : (
          <DataTable
            caption="Customers with dues"
            columns={customerColumns}
            rows={customers}
            rowKey={(c) => c.key}
            onRowClick={(c) => {
              setCustomerKey(c.key);
              setMode("invoices");
            }}
            chevron
            empty={<EmptyState glyph="✓" title="No customers with dues">Nothing outstanding{filtersOn ? " in this view" : ""}.</EmptyState>}
          />
        )}
      </Card>

      {panel ? (
        <CollectionsPanel
          invoiceId={panel}
          reminders={data.reminders}
          businessName={data.businessName}
          managers={data.managers}
          onClose={() => setPanel(null)}
          onStatement={(p) => {
            setPanel(null);
            setStatement(p);
          }}
        />
      ) : null}
      {receipt ? <ReceiptDialog customers={data.customers} invoices={data.invoices} today={session.today} initialKey={receipt.key} onClose={() => setReceipt(null)} /> : null}
      {reminder ? (
        <ReminderDialog
          invoices={reminder.invoices}
          reminders={data.reminders}
          businessName={data.businessName}
          rule={reminder.rule}
          presetTemplate={reminder.templateKey}
          onClose={() => {
            setReminder(null);
            setSelected(new Set());
          }}
        />
      ) : null}
      {assignIds ? (
        <AssignDialog
          invoiceIds={assignIds}
          managers={data.managers}
          onClose={() => {
            setAssignIds(null);
            setSelected(new Set());
          }}
        />
      ) : null}
      <StatementDialog party={statement} onClose={() => setStatement(null)} />
    </>
  );
}
