"use client";

import { useState } from "react";
import {
  Alert,
  ApprovalRow,
  Button,
  DataTable,
  Field,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  Pagination,
  SearchInput,
  Segmented,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import { bos, type BosBill, type BosExpense, type BosInvoice } from "@/lib/bos-app/api";
import { billBadge, dateLabel, expenseBadge, inr, inrCompact, invoiceBadge, todayLocal } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { BillDialog, ConfirmDialog, ExpenseDialog, PaymentDialog, usePartyList } from "../dialogs";

const sum = <T,>(list: ReadonlyArray<T>, pick: (t: T) => number) => list.reduce((s, t) => s + pick(t), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- Receivables ---------- */

export function Receivables() {
  const { navigate } = useBosApp();
  const [paying, setPaying] = useState<BosInvoice | null>(null);
  const [query, setQuery] = useState("");
  const state = useBosData(async () => {
    const [overview, list] = await Promise.all([bos.financeOverview(), bos.invoices({ status: "open" })]);
    return { aging: overview.aging, invoices: list.invoices };
  });

  return (
    <Loaded state={state}>
      {({ aging, invoices }) => {
        const open = invoices.filter((i) => i.status === "sent" || i.status === "partial").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const q = query.trim().toLowerCase();
        const rows = open.filter((i) => !q || `${i.invoiceNo} ${i.partyName}`.toLowerCase().includes(q));
        const byCustomer = Object.entries(
          open.reduce<Record<string, number>>((acc, i) => {
            acc[i.partyName] = (acc[i.partyName] ?? 0) + i.balance;
            return acc;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        const columns: BosColumn<BosInvoice>[] = [
          { key: "invoiceNo", header: "Invoice", mono: true, cell: (i) => i.invoiceNo },
          { key: "party", header: "Customer", cell: (i) => i.partyName },
          { key: "due", header: "Due", mono: true, cell: (i) => dateLabel(i.dueDate) },
          {
            key: "age",
            header: "Age",
            cell: (i) => (i.daysOverdue > 0 ? <span style={{ color: "var(--bos-coral-600)", fontWeight: 650 }}>{i.daysOverdue}d overdue</span> : <span className="bos-text-faint">On time</span>),
          },
          { key: "status", header: "Status", cell: (i) => <StatusBadge view={invoiceBadge(i.displayStatus)} /> },
          { key: "balance", header: "Balance", align: "right", mono: true, cell: (i) => inr(i.balance) },
          {
            key: "action",
            header: "",
            cell: (i) => (
              <Button
                size="sm"
                variant="success"
                onClick={(e) => {
                  e.stopPropagation();
                  setPaying(i);
                }}
              >
                Record payment
              </Button>
            ),
          },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Current" value={inrCompact(aging.current)} valueTone="emerald" chip={{ color: "mint", glyph: "✓" }} delta="Not yet due" deltaTone="muted" />
              <KpiCard label="1–30 days" value={inrCompact(aging["1-30"])} valueTone="blue" chip={{ color: "blue", glyph: "◔" }} delta="Gentle reminder" deltaTone="info" />
              <KpiCard label="31–60 days" value={inrCompact(aging["31-60"])} valueTone="amber" chip={{ color: "amber", glyph: "◑" }} delta="Follow up" deltaTone="warn" />
              <KpiCard label="60+ days" value={inrCompact(aging["61-90"] + aging["90+"])} valueTone="coral" chip={{ color: "rose", glyph: "●" }} delta="Escalate" deltaTone="down" />
            </Grid>
            <Grid template="1.6fr 1fr">
              <div>
                <ModuleToolbar>
                  <SearchInput placeholder="Search invoice or customer…" aria-label="Search receivables" value={query} onChange={(e) => setQuery(e.target.value)} />
                </ModuleToolbar>
                <div style={{ marginTop: 12 }}>
                  <DataTable
                    caption="Outstanding invoices"
                    columns={columns}
                    rows={rows}
                    rowKey={(i) => i.id}
                    onRowClick={(i) => navigate("finance", "invoices", `open:${i.id}`)}
                    empty="Nothing outstanding — every issued invoice is paid."
                  />
                  <Pagination>
                    {plural(open.length, "open invoice")} · {inr(sum(open, (i) => i.balance))} to collect
                  </Pagination>
                </div>
              </div>
              <WidgetCard title="🏦 Top balances" dot="rose">
                {byCustomer.length ? (
                  byCustomer.map(([name, bal]) => <WidgetRow key={name} label={name} value={inr(bal)} valueTone="amber" />)
                ) : (
                  <WidgetRow label={<span className="bos-text-faint">No open balances</span>} />
                )}
              </WidgetCard>
            </Grid>
            <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Payables (vendor bills) ---------- */

type BillFilter = "all" | "pending" | "approved" | "paid" | "rejected";

export function Payables() {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [removing, setRemoving] = useState<BosBill | null>(null);
  const vendors = usePartyList("vendor", adding);
  const state = useBosData(() => bos.bills(), []);

  return (
    <Loaded state={state}>
      {({ bills }) => {
        const pending = bills.filter((b) => b.status === "pending");
        const approved = bills.filter((b) => b.status === "approved");
        const overdue = bills.filter((b) => b.overdue && b.status !== "paid" && b.status !== "rejected");
        const month = todayLocal().slice(0, 7);
        const paidMonth = bills.filter((b) => b.status === "paid" && (b.paidOn ?? "").startsWith(month));
        const rows = filter === "all" ? bills : bills.filter((b) => b.status === filter);
        const columns: BosColumn<BosBill>[] = [
          { key: "vendor", header: "Vendor", cell: (b) => <span>{b.partyName}{b.billNo ? <span className="bos-text-faint"> · {b.billNo}</span> : null}</span> },
          { key: "category", header: "Category", cell: (b) => b.category ?? "—" },
          { key: "billDate", header: "Billed", mono: true, cell: (b) => dateLabel(b.billDate) },
          { key: "dueDate", header: "Due", mono: true, cell: (b) => dateLabel(b.dueDate) },
          { key: "total", header: "Total", align: "right", mono: true, cell: (b) => inr(b.total) },
          { key: "status", header: "Status", cell: (b) => <StatusBadge view={billBadge(b.status, b.overdue)} /> },
          {
            key: "actions",
            header: "",
            cell: (b) =>
              canManage && b.status === "approved" ? (
                <Button size="sm" variant="success" disabled={busy !== null} onClick={() => run(`pay-${b.id}`, () => bos.payBill(b.id, todayLocal()), { success: "Bill marked paid", description: `${b.partyName} · ${inr(b.total)}` })}>
                  Mark paid
                </Button>
              ) : (b.canDelete ?? (b.status === "pending" || b.status === "rejected")) ? (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(b)}>
                  Delete
                </Button>
              ) : null,
          },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Awaiting approval" value={inrCompact(sum(pending, (b) => b.total))} chip={{ color: "amber", glyph: "⏳" }} delta={plural(pending.length, "bill")} deltaTone={pending.length ? "warn" : "muted"} />
              <KpiCard label="Approved, unpaid" value={inrCompact(sum(approved, (b) => b.total))} chip={{ color: "blue", glyph: "◎" }} delta={plural(approved.length, "bill")} deltaTone="muted" />
              <KpiCard label="Overdue" value={inrCompact(sum(overdue, (b) => b.total))} valueTone={overdue.length ? "coral" : undefined} chip={{ color: "rose", glyph: "!" }} delta={overdue.length ? plural(overdue.length, "bill") + " past due" : "Nothing overdue"} deltaTone={overdue.length ? "down" : "up"} />
              <KpiCard label="Paid this month" value={inrCompact(sum(paidMonth, (b) => b.total))} chip={{ color: "mint", glyph: "✓" }} delta={plural(paidMonth.length, "bill")} deltaTone="muted" />
            </Grid>
            {canManage && pending.length ? (
              <WidgetCard title="⏳ Pending approvals" dot="rose" note={plural(pending.length, "bill")}>
                {pending.map((b) => (
                  <ApprovalRow
                    key={b.id}
                    avatar={<PersonAvatar name={b.partyName} />}
                    name={`${b.partyName}${b.billNo ? ` · ${b.billNo}` : ""}`}
                    meta={`${b.category ?? "Uncategorised"} · due ${dateLabel(b.dueDate)}`}
                    extra={<span className="bos-widget-value">{inr(b.total)}</span>}
                    onDecide={(d) => run(`bill-${b.id}`, () => bos.decideBill(b.id, d), { success: d === "approved" ? "Bill approved" : "Bill rejected", tone: d === "approved" ? "emerald" : "amber", description: b.partyName })}
                  />
                ))}
              </WidgetCard>
            ) : null}
            <ModuleToolbar>
              <Segmented<BillFilter>
                role="radio"
                size="sm"
                scroll
                aria-label="Filter bills"
                options={[
                  { value: "all", label: "All" },
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "paid", label: "Paid" },
                  { value: "rejected", label: "Rejected" },
                ]}
                value={filter}
                onChange={setFilter}
              />
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add bill
              </Button>
            </ModuleToolbar>
            <div>
              <DataTable caption="Vendor bills" columns={columns} rows={rows} rowKey={(b) => b.id} empty={bills.length ? "No bills in this view." : "No vendor bills yet — add one to track payables and input GST."} />
              <Pagination>Showing {rows.length} of {bills.length}</Pagination>
            </div>
            <BillDialog open={adding} onClose={() => setAdding(false)} vendors={vendors} />
            <ConfirmDialog
              open={removing !== null}
              onClose={() => setRemoving(null)}
              destructive
              title="Delete this bill?"
              description={removing ? `${removing.partyName} · ${inr(removing.total)}` : undefined}
              confirmLabel="Delete"
              busy={busy === "del-bill"}
              onConfirm={async () => {
                if (!removing) return;
                await run("del-bill", () => bos.deleteBill(removing.id), { success: "Bill deleted" });
                setRemoving(null);
              }}
            />
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Expenses ---------- */

export function Expenses() {
  const { canManage, takeIntent } = useBosApp();
  const { run, busy } = useBosAction();
  const [claiming, setClaiming] = useState(() => takeIntent("expenses") === "new");
  const state = useBosData(async () => {
    const [list, staff] = await Promise.all([bos.expenses(), canManage ? bos.employees().catch(() => ({ employees: [] })) : Promise.resolve({ employees: [] })]);
    return { ...list, employees: staff.employees };
  }, [canManage]);

  return (
    <Loaded state={state}>
      {({ expenses, categories, employees, ownOnly }) => {
        const month = todayLocal().slice(0, 7);
        const submitted = expenses.filter((e) => e.status === "submitted");
        const approved = expenses.filter((e) => e.status === "approved");
        const thisMonth = expenses.filter((e) => e.spentOn.startsWith(month) && e.status !== "rejected");
        const byCategory = Object.entries(
          thisMonth.reduce<Record<string, number>>((acc, e) => {
            acc[e.category] = (acc[e.category] ?? 0) + e.amount;
            return acc;
          }, {}),
        ).sort((a, b) => b[1] - a[1]);
        const columns: BosColumn<BosExpense>[] = [
          { key: "spentOn", header: "Date", mono: true, cell: (e) => dateLabel(e.spentOn) },
          { key: "claimant", header: "Claimant", cell: (e) => e.claimantName ?? "—" },
          { key: "category", header: "Category", cell: (e) => e.category },
          { key: "description", header: "Description", cell: (e) => e.description ?? <span className="bos-text-faint">—</span> },
          { key: "amount", header: "Amount", align: "right", mono: true, cell: (e) => inr(e.amount) },
          { key: "status", header: "Status", cell: (e) => <StatusBadge view={expenseBadge(e.status)} /> },
          {
            key: "actions",
            header: "",
            cell: (e) =>
              canManage && e.status === "approved" ? (
                <Button size="sm" variant="success" disabled={busy !== null} onClick={() => run(`reimb-${e.id}`, () => bos.reimburseExpense(e.id), { success: "Marked reimbursed", description: `${e.claimantName ?? ""} · ${inr(e.amount)}` })}>
                  Reimburse
                </Button>
              ) : null,
          },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Pending claims" value={inrCompact(sum(submitted, (e) => e.amount))} chip={{ color: "amber", glyph: "⏳" }} delta={plural(submitted.length, "claim")} deltaTone={submitted.length ? "warn" : "muted"} />
              <KpiCard label="To reimburse" value={inrCompact(sum(approved, (e) => e.amount))} chip={{ color: "blue", glyph: "↺" }} delta={plural(approved.length, "approved claim")} deltaTone="muted" />
              <KpiCard label="Spent this month" value={inrCompact(sum(thisMonth, (e) => e.amount))} chip={{ color: "rose", glyph: "₹" }} delta={byCategory[0] ? `Top: ${byCategory[0][0]}` : "No spend yet"} deltaTone="muted" />
              <KpiCard label="Claims (all time)" value={expenses.length} chip={{ color: "lavender", glyph: "🧾" }} delta={`${expenses.filter((e) => e.status === "reimbursed").length} reimbursed`} deltaTone="muted" />
            </Grid>
            {canManage && submitted.length ? (
              <WidgetCard title="⏳ Pending approvals" dot="rose" note={plural(submitted.length, "claim")}>
                {submitted.map((e) => (
                  <ApprovalRow
                    key={e.id}
                    avatar={<PersonAvatar name={e.claimantName} />}
                    name={e.claimantName ?? "Unknown claimant"}
                    meta={`${e.category} · ${dateLabel(e.spentOn)}${e.description ? ` · ${e.description}` : ""}`}
                    extra={<span className="bos-widget-value">{inr(e.amount)}</span>}
                    onDecide={(d) => run(`exp-${e.id}`, () => bos.decideExpense(e.id, d), { success: d === "approved" ? "Claim approved" : "Claim rejected", tone: d === "approved" ? "emerald" : "amber", description: e.claimantName ?? undefined })}
                  />
                ))}
              </WidgetCard>
            ) : null}
            <Grid template="1.6fr 1fr">
              <div>
                <ModuleToolbar>
                  <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                    {ownOnly ? "Your claims" : "All claims across the team"}
                  </span>
                  <span className="bos-spacer" />
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setClaiming(true)}>
                    New claim
                  </Button>
                </ModuleToolbar>
                <div style={{ marginTop: 12 }}>
                  <DataTable caption="Expense claims" columns={columns} rows={expenses} rowKey={(e) => e.id} empty="No expense claims yet." />
                </div>
              </div>
              <WidgetCard title="📊 This month by category" dot="mint">
                {byCategory.length ? byCategory.map(([cat, amt]) => <WidgetRow key={cat} label={cat} value={inr(amt)} />) : <WidgetRow label={<span className="bos-text-faint">No spend recorded</span>} />}
              </WidgetCard>
            </Grid>
            <ExpenseDialog open={claiming} onClose={() => setClaiming(false)} categories={categories} employees={employees} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- GST ---------- */

export function GstModule() {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const state = useBosData(() => bos.gst(month), [month]);

  return (
    <Stack>
      <ModuleToolbar>
        <Field label="Return period">{({ id }) => <Input id={id} type="month" size="sm" value={month} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
      </ModuleToolbar>
      <Loaded state={state}>
        {(g) => (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Taxable value" value={inrCompact(g.taxable)} chip={{ color: "blue", glyph: "₹" }} delta={plural(g.invoiceCount, "invoice")} deltaTone="muted" />
              <KpiCard label="Output GST" value={inrCompact(g.outputTax)} chip={{ color: "rose", glyph: "↑" }} delta="Collected on sales" deltaTone="muted" />
              <KpiCard label="Input tax credit" value={inrCompact(g.inputTax)} chip={{ color: "mint", glyph: "↓" }} delta={`From ${plural(g.billCount, "approved bill")}`} deltaTone="muted" />
              <KpiCard
                label={g.netPayable >= 0 ? "Net GST payable" : "Credit carried forward"}
                value={inrCompact(Math.abs(g.netPayable))}
                valueTone={g.netPayable > 0 ? "coral" : "emerald"}
                chip={{ color: "amber", glyph: "=" }}
                delta="Output − input"
                deltaTone={g.netPayable > 0 ? "warn" : "up"}
              />
            </Grid>
            <Grid cols={2}>
              <WidgetCard title="🧮 Output tax split" dot="blue">
                <WidgetRow label="CGST" value={inr(g.cgst)} />
                <WidgetRow label="SGST" value={inr(g.sgst)} />
                <WidgetRow label="IGST" value={inr(g.igst)} />
                <WidgetRow label="Total output tax" value={inr(g.outputTax)} valueTone="blue" />
              </WidgetCard>
              <WidgetCard title="📑 By GST rate" dot="lavender">
                {g.byRate.length ? (
                  g.byRate.map((r) => <WidgetRow key={r.rate} label={`${r.rate}% · taxable ${inr(r.taxable)}`} value={inr(r.tax)} />)
                ) : (
                  <WidgetRow label={<span className="bos-text-faint">No taxable sales this period</span>} />
                )}
              </WidgetCard>
            </Grid>
            <Alert tone="blue" title="Preparing your return">
              Figures cover issued (non-void) invoices and approved or paid vendor bills dated in this period. Use them to prepare GSTR-1 and GSTR-3B, and reconcile with GSTR-2B before filing.
            </Alert>
          </Stack>
        )}
      </Loaded>
    </Stack>
  );
}
