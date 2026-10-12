"use client";

import "./finance.css";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, FormGrid, Grid, Input, KpiCard, Select, Switch, Textarea, WidgetCard, type BosColumn } from "@/components/bos";
import { finance, methodLabel, PAY_METHODS, type ClosingDay, type DayFigures, type ImsClosing, type ImsExpense, type PayMethod } from "@/lib/ims/finance";
import { dateLabel, inrCompact, inrExact, num, round2, stampLabel } from "@/lib/ims/format";
import { Loaded, PageHeader, RequirePerm, Stack, SubTabs, useIms, useImsAction, useImsData, usePrint } from "../core";
import { MethodSelect, ReasonDialog, sellerOf, Stats } from "./shared";

type Tab = "day" | "history";

const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

const shiftDate = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const varianceClass = (v: number) => (v <= -1 ? "is-short" : v >= 1 ? "is-over" : "is-ok");
const varianceText = (v: number) => (Math.abs(v) < 1 ? "Matched" : `${v > 0 ? "Over" : "Short"} by ${inrExact(Math.abs(v))}`);

export function ClosingModule() {
  const { session, takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("closing"));
  const [tab, setTab] = useState<Tab>(intent?.startsWith("open:") ? "history" : "day");
  const [date, setDate] = useState(session.today);
  const [report, setReport] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);

  return (
    <RequirePerm perm="closing" what="daily closing">
      <Stack>
        <PageHeader
          title="Daily Closing"
          sub="Reconcile the cash drawer, record the day's expenses and lock the books."
          actions={
            tab === "day" ? (
              <div className="ims-row">
                <Button size="sm" variant="ghost" icon="chevronLeft" aria-label="Previous day" onClick={() => setDate((d) => shiftDate(d, -1))} />
                <Input size="sm" type="date" max={session.today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Closing date" style={{ width: 160 }} />
                <Button size="sm" variant="ghost" icon="chevronRight" aria-label="Next day" disabled={date >= session.today} onClick={() => setDate((d) => shiftDate(d, 1))} />
                {date !== session.today ? (
                  <Button size="sm" onClick={() => setDate(session.today)}>
                    Today
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        />
        <SubTabs
          label="Closing sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "day", label: "Day close" },
            { value: "history", label: "History" },
          ]}
        />
        {tab === "day" ? <DayClose date={date} onReport={setReport} /> : <History onOpen={setReport} 
            onPickDay={(d) => {
              setDate(d);
              setTab("day");
            }}
          />}
      </Stack>
      {report ? <ReportDialog id={report} onClose={() => setReport(null)} /> : null}
    </RequirePerm>
  );
}

/* ---------- Day close ---------- */

function DayClose({ date, onReport }: { date: string; onReport: (id: string) => void }) {
  const state = useImsData(() => finance.closingDay(date), [date]);
  return (
    <Loaded state={state} rows={3}>
      {(d) => <DayBody key={`${d.date}-${d.closing?.status ?? "none"}-${d.closing?.updatedAt ?? ""}`} day={d} onReport={onReport} />}
    </Loaded>
  );
}

function DayBody({ day, onReport }: { day: ClosingDay; onReport: (id: string) => void }) {
  const { run, busy } = useImsAction();
  const locked = day.closing?.status === "closed";
  const [opening, setOpening] = useState(String(day.openingCash));
  const [counted, setCounted] = useState(locked && day.closing?.countedCash !== null && day.closing ? String(day.closing.countedCash) : "");
  const [notes, setNotes] = useState(day.closing?.notes ?? "");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ImsExpense | null>(null);
  const [reopening, setReopening] = useState(false);
  const [counter, setCounter] = useState(false);

  const f = day.figures;
  const openingCash = round2(num(opening));
  const expected = locked && day.closing ? day.closing.expectedCash : round2(f.expectedCash - day.openingCash + openingCash);
  const countedCash = counted.trim() === "" ? null : round2(num(counted));
  const variance = locked && day.closing ? day.closing.variance : countedCash === null ? null : round2(countedCash - expected);
  const needsNote = variance !== null && Math.abs(variance) >= 1;
  const canClose = !locked && countedCash !== null && (!needsNote || notes.trim().length > 0) && day.date <= day.today;
  const totalIn = f.totals.sales + f.totals.collections;
  const totalOut = f.totals.paid + f.totals.expenses;

  return (
    <Stack gap={16}>
      {locked && day.closing ? (
        <Alert
          tone="emerald"
          title={`${dateLabel(day.date)} is closed`}
          actions={
            <>
              <Button size="sm" icon="printer" onClick={() => day.closing && onReport(day.closing.id)}>
                Report
              </Button>
              {day.canReopen ? (
                <Button size="sm" variant="ghost" onClick={() => setReopening(true)}>
                  Reopen day
                </Button>
              ) : null}
            </>
          }
        >
          Closed by {day.closing.closedByName ?? "—"} · {stampLabel(day.closing.closedAt)}. Sales, payments and expenses dated this day are locked{day.canReopen ? "." : " — only an owner can reopen it."}
        </Alert>
      ) : day.date < day.today ? (
        <Alert tone="amber" title={`${dateLabel(day.date)} hasn't been closed`}>
          Count the drawer as it stood at the end of that day, or reconcile from your notes.
        </Alert>
      ) : null}

      <Grid cols={4} min={170}>
        <KpiCard label="Sales" value={inrCompact(f.totals.sales)} chip={{ color: "mint", glyph: "🧾" }} delta={`${day.sales.count} invoice${day.sales.count === 1 ? "" : "s"}${day.sales.posCount ? ` · ${day.sales.posCount} POS` : ""}`} deltaTone="up" />
        <KpiCard label="Collections" value={inrCompact(f.totals.collections)} chip={{ color: "blue", glyph: "📥" }} delta="Receipts against earlier invoices" deltaTone="muted" />
        <KpiCard label="Paid to suppliers" value={inrCompact(f.totals.paid)} chip={{ color: "lavender", glyph: "📤" }} delta="Bill payments" deltaTone="muted" />
        <KpiCard label="Expenses" value={inrCompact(f.totals.expenses)} valueTone={f.totals.expenses > 0 ? "coral" : undefined} chip={{ color: "rose", glyph: "💸" }} delta={`${day.expenses.length} entr${day.expenses.length === 1 ? "y" : "ies"}`} deltaTone="muted" />
      </Grid>

      <div className="fin-closing-grid">
        <Stack gap={16}>
          <WidgetCard title="Money in & out by method" note={`Net ${inrExact(round2(totalIn - totalOut))}`}>
            <MethodTable figures={f} />
          </WidgetCard>

          <WidgetCard title="Sales summary">
            <Stats
              items={[
                { label: "Invoiced", value: inrExact(day.sales.total) },
                { label: "POS counter", value: inrExact(day.sales.posTotal) },
                { label: "On credit", value: inrExact(day.sales.credit), tone: day.sales.credit > 0 ? "amber" : null },
                { label: "GST collected", value: inrExact(day.sales.tax) },
              ]}
            />
          </WidgetCard>

          <Card interactive={false}>
            <div className="ims-between" style={{ marginBottom: 10 }}>
              <div className="fin-section-title" style={{ margin: 0 }}>
                Expenses
              </div>
              {!locked ? (
                <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                  Add expense
                </Button>
              ) : null}
            </div>
            <ExpenseTable expenses={day.expenses} locked={locked} onDelete={setDeleting} />
          </Card>
        </Stack>

        <Card interactive={false} className="fin-closing-side">
          <div className="fin-section-title">Cash reconciliation</div>
          <Stack gap={12}>
            <Field label="Opening cash" hint={day.lastClosing ? `Counted cash at the close of ${dateLabel(day.lastClosing.date)}: ${inrExact(day.suggestedOpening)}` : "No earlier closing — enter the float you started with."}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="0.01" value={opening} disabled={locked} onChange={(e) => setOpening(e.target.value)} />}
            </Field>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <tbody>
                  <tr>
                    <td>Opening cash</td>
                    <td className="is-num">{inrExact(locked && day.closing ? day.closing.openingCash : openingCash)}</td>
                  </tr>
                  <tr>
                    <td>+ Cash sales</td>
                    <td className="is-num">{inrExact(f.sales.cash)}</td>
                  </tr>
                  <tr>
                    <td>+ Cash collections</td>
                    <td className="is-num">{inrExact(f.collections.cash)}</td>
                  </tr>
                  <tr>
                    <td>− Cash paid to suppliers</td>
                    <td className="is-num">{inrExact(f.paid.cash)}</td>
                  </tr>
                  <tr>
                    <td>− Cash expenses</td>
                    <td className="is-num">{inrExact(f.expenses.cash)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td>Expected in drawer</td>
                    <td className="is-num">{inrExact(expected)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Field label="Counted cash" hint="Count the drawer, including coins.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="0.01" value={counted} disabled={locked} onChange={(e) => setCounted(e.target.value)} placeholder={String(expected)} />}
            </Field>
            {!locked ? (
              <div className="ims-row">
                <Switch checked={counter} onChange={setCounter} aria-label="Use denomination counter" />
                <span className="ims-muted">Denomination counter</span>
                <Button size="sm" variant="ghost" style={{ marginLeft: "auto" }} onClick={() => setCounted(String(expected))}>
                  Matches expected
                </Button>
              </div>
            ) : null}
            {counter && !locked ? <DenominationCounter onTotal={(t) => setCounted(String(t))} /> : null}
            {variance !== null ? (
              <div className={`fin-variance ${varianceClass(variance)}`} role="status">
                <span>
                  <span className="ims-strong">{varianceText(variance)}</span>
                  <br />
                  <small className="ims-faint">Counted {inrExact(locked && day.closing ? (day.closing.countedCash ?? 0) : (countedCash ?? 0))} vs expected {inrExact(expected)}</small>
                </span>
                <b>{variance > 0 ? "+" : ""}{inrExact(variance)}</b>
              </div>
            ) : null}
            <Field label={needsNote && !locked ? "Notes (required — explain the difference)" : "Notes"} error={needsNote && !locked && !notes.trim() ? "Add a note before closing with a cash difference." : undefined}>
              {({ id, invalid }) => <Textarea id={id} rows={3} value={notes} disabled={locked} aria-invalid={invalid} onChange={(e) => setNotes(e.target.value)} placeholder="Handed over to, petty cash, anything unusual…" />}
            </Field>
            {!locked ? (
              <Button
                variant="primary"
                icon="lock"
                block
                disabled={!canClose || busy === "close"}
                onClick={() =>
                  run("close", () => finance.closeDay({ date: day.date, openingCash, countedCash: countedCash ?? 0, notes: notes.trim() || null }), {
                    success: `${dateLabel(day.date)} closed`,
                  })
                }
              >
                Close {day.date === day.today ? "today" : dateLabel(day.date)}
              </Button>
            ) : null}
            {!locked ? <p className="fin-note">Closing locks this date: invoices, payments and expenses dated {dateLabel(day.date)} can no longer be added or changed until an owner reopens it.</p> : null}
          </Stack>
        </Card>
      </div>

      {adding ? <ExpenseDialog date={day.date} onClose={() => setAdding(false)} /> : null}
      <DeleteExpense expense={deleting} onClose={() => setDeleting(null)} />
      <ReasonDialog
        open={reopening}
        onClose={() => setReopening(false)}
        title={`Reopen ${dateLabel(day.date)}?`}
        description="The day unlocks so entries can be corrected. Close it again once done."
        confirmLabel="Reopen day"
        busy={busy === "reopen"}
        suggestions={["Missed an expense", "Wrong counted cash", "Late invoice entry"]}
        onConfirm={async (reason) => {
          if (!day.closing) return;
          const id = day.closing.id;
          const out = await run("reopen", () => finance.reopenDay(id, reason), { success: "Day reopened" });
          if (out) setReopening(false);
        }}
      />
    </Stack>
  );
}

function MethodTable({ figures: f }: { figures: DayFigures }) {
  const rows: ReadonlyArray<{ label: string; values: Record<PayMethod, number>; total: number; out?: boolean }> = [
    { label: "Sales", values: f.sales, total: f.totals.sales },
    { label: "Collections", values: f.collections, total: f.totals.collections },
    { label: "Supplier payments", values: f.paid, total: f.totals.paid, out: true },
    { label: "Expenses", values: f.expenses, total: f.totals.expenses, out: true },
  ];
  const used = PAY_METHODS.filter((m) => rows.some((r) => Math.abs(r.values[m] ?? 0) >= 0.005) || m === "cash");
  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        <thead>
          <tr>
            <th />
            {used.map((m) => (
              <th key={m} className="is-num">
                {methodLabel(m)}
              </th>
            ))}
            <th className="is-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {used.map((m) => (
                <td key={m} className={`is-num${r.out && (r.values[m] ?? 0) > 0 ? " ims-neg" : ""}`}>
                  {(r.values[m] ?? 0) ? inrExact(r.values[m]) : "—"}
                </td>
              ))}
              <td className="is-num ims-strong">{inrExact(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Net</td>
            {used.map((m) => (
              <td key={m} className="is-num">
                {inrExact(round2((f.sales[m] ?? 0) + (f.collections[m] ?? 0) - (f.paid[m] ?? 0) - (f.expenses[m] ?? 0)))}
              </td>
            ))}
            <td className="is-num">{inrExact(round2(f.totals.sales + f.totals.collections - f.totals.paid - f.totals.expenses))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ExpenseTable({ expenses, locked, onDelete }: { expenses: ImsExpense[]; locked: boolean; onDelete: (e: ImsExpense) => void }) {
  const columns: BosColumn<ImsExpense>[] = [
    {
      key: "what",
      header: "Expense",
      cell: (e) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{e.category}</span>
          <small>{[e.description, e.vendor, e.reference].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    { key: "method", header: "Method", cell: (e) => <Badge tone="neutral">{methodLabel(e.method)}</Badge> },
    { key: "gst", header: "GST", align: "right", mono: true, cell: (e) => (e.gstAmount ? inrExact(e.gstAmount) : <span className="ims-faint">—</span>) },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (e) => inrExact(e.amount) },
    {
      key: "x",
      header: "",
      align: "right",
      cell: (e) =>
        locked ? null : (
          <Button size="sm" variant="ghost" icon="x" aria-label={`Delete ${e.category} expense`} onClick={() => onDelete(e)} />
        ),
    },
  ];
  return (
    <DataTable
      caption="Expenses for the day"
      columns={columns}
      rows={expenses}
      rowKey={(e) => e.id}
      empty={
        <EmptyState glyph="💸" title="No expenses recorded">
          Add petty cash spends, transport, salaries or utilities paid today so the drawer reconciles.
        </EmptyState>
      }
    />
  );
}

function DenominationCounter({ onTotal }: { onTotal: (total: number) => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const total = useMemo(() => DENOMINATIONS.reduce((s, d) => s + d * Math.max(0, Math.floor(num(counts[d] ?? ""))), 0), [counts]);
  return (
    <div className="fin-box">
      <div className="fin-denoms">
        {DENOMINATIONS.map((d) => (
          <label key={d} className="fin-denom">
            <span>₹{d}</span>
            <Input size="sm" type="number" inputMode="numeric" min={0} step={1} value={counts[d] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value }))} aria-label={`Number of ₹${d}`} placeholder="0" />
          </label>
        ))}
      </div>
      <div className="ims-between" style={{ marginTop: 10 }}>
        <span className="ims-strong">{inrExact(total)}</span>
        <Button size="sm" onClick={() => onTotal(total)} disabled={total <= 0}>
          Use as counted cash
        </Button>
      </div>
    </div>
  );
}

function ExpenseDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const categories = session.settings.taxonomy.expenseCategories;
  const [category, setCategory] = useState(categories[0] ?? "General");
  const [amount, setAmount] = useState("");
  const [gst, setGst] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [reference, setReference] = useState("");
  const amt = round2(num(amount));
  const gstAmt = round2(num(gst));
  const valid = amt > 0 && gstAmt >= 0 && gstAmt < amt && category.trim().length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add expense"
      description={`Dated ${dateLabel(date)}. Cash expenses reduce the expected drawer balance.`}
      icon={{ tone: "coral", name: "wallet" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || busy === "expense"}
            onClick={async () => {
              const out = await run(
                "expense",
                () =>
                  finance.addExpense({
                    date,
                    category: category.trim(),
                    amount: amt,
                    gstAmount: gstAmt,
                    method,
                    description: description.trim() || null,
                    vendor: vendor.trim() || null,
                    reference: reference.trim() || null,
                  }),
                { success: `Expense of ${inrExact(amt)} added` },
              );
              if (out) onClose();
            }}
          >
            Add expense
          </Button>
        </>
      }
    >
      <FormGrid columns="1fr 1fr">
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {(categories.length ? categories : ["General"]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Paid by">{({ id }) => <MethodSelect id={id} value={method} onChange={setMethod} />}</Field>
        <Field label="Amount (incl. GST)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
        <Field label="GST included" hint="Optional — for input credit tracking." error={gstAmt >= amt && amt > 0 ? "GST must be less than the amount." : undefined}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="0.01" value={gst} onChange={(e) => setGst(e.target.value)} />}
        </Field>
        <Field label="Paid to">{({ id }) => <Input id={id} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor / person" />}</Field>
        <Field label="Reference">{({ id }) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Receipt / UTR no." />}</Field>
      </FormGrid>
      <div style={{ marginTop: 12 }}>
        <Field label="Description">{({ id }) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" />}</Field>
      </div>
    </Dialog>
  );
}

function DeleteExpense({ expense, onClose }: { expense: ImsExpense | null; onClose: () => void }) {
  const { run, busy } = useImsAction();
  return (
    <Dialog
      open={expense !== null}
      onClose={onClose}
      title="Delete this expense?"
      description={expense ? `${expense.category} · ${inrExact(expense.amount)} (${methodLabel(expense.method)})` : undefined}
      icon={{ tone: "coral", name: "warning" }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy === "del-expense"}
            onClick={async () => {
              if (!expense) return;
              const out = await run("del-expense", () => finance.deleteExpense(expense.id).then(() => true), { success: "Expense deleted" });
              if (out) onClose();
            }}
          >
            Delete
          </Button>
        </>
      }
    />
  );
}

/* ---------- History & report ---------- */

function History({ onOpen, onPickDay }: { onOpen: (id: string) => void; onPickDay: (date: string) => void }) {
  const state = useImsData(() => finance.closingHistory(90), []);
  const columns: BosColumn<ImsClosing>[] = [
    { key: "date", header: "Date", cell: (c) => <span className="ims-strong">{dateLabel(c.date)}</span> },
    { key: "status", header: "Status", cell: (c) => (c.status === "closed" ? <Badge tag="mint">Closed</Badge> : <Badge tag="blue">Reopened</Badge>) },
    { key: "opening", header: "Opening", align: "right", mono: true, cell: (c) => inrExact(c.openingCash) },
    { key: "expected", header: "Expected", align: "right", mono: true, cell: (c) => inrExact(c.expectedCash) },
    { key: "counted", header: "Counted", align: "right", mono: true, cell: (c) => (c.countedCash === null ? "—" : inrExact(c.countedCash)) },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      mono: true,
      cell: (c) => <span className={c.variance <= -1 ? "ims-neg" : c.variance >= 1 ? "fin-over" : "ims-faint"}>{Math.abs(c.variance) < 1 ? "—" : `${c.variance > 0 ? "+" : ""}${inrExact(c.variance)}`}</span>,
    },
    { key: "by", header: "Closed by", cell: (c) => <span className="ims-cell-stack"><span>{c.closedByName ?? "—"}</span><small>{stampLabel(c.closedAt)}</small></span> },
    {
      key: "go",
      header: "",
      align: "right",
      cell: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => onPickDay(c.date)}>
            Open day
          </Button>
        </span>
      ),
    },
  ];
  return (
    <Loaded state={state} rows={3}>
      {(h) => (
        <Stack gap={16}>
          <Grid cols={4} min={170}>
            <KpiCard label="Days closed" value={String(h.stats.days)} chip={{ color: "mint", glyph: "🔒" }} delta="Last 90 closings" deltaTone="muted" />
            <KpiCard label="Short days" value={String(h.stats.shortDays)} valueTone={h.stats.shortDays ? "coral" : undefined} chip={{ color: "rose", glyph: "▼" }} delta="Counted less than expected" deltaTone={h.stats.shortDays ? "down" : "up"} />
            <KpiCard label="Over days" value={String(h.stats.overDays)} chip={{ color: "amber", glyph: "▲" }} delta="Counted more than expected" deltaTone={h.stats.overDays ? "warn" : "muted"} />
            <KpiCard label="Net variance" value={inrExact(h.stats.netVariance)} valueTone={h.stats.netVariance <= -1 ? "coral" : h.stats.netVariance >= 1 ? "amber" : "emerald"} chip={{ color: "blue", glyph: "±" }} delta="Sum over closed days" deltaTone="info" />
          </Grid>
          <Card interactive={false}>
            <DataTable
              caption="Closing history"
              columns={columns}
              rows={h.closings}
              rowKey={(c) => c.id}
              onRowClick={(c) => onOpen(c.id)}
              chevron
              empty={
                <EmptyState glyph="🔒" title="No days closed yet">
                  Close today from the Day close tab to start your cash history.
                </EmptyState>
              }
            />
          </Card>
        </Stack>
      )}
    </Loaded>
  );
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const print = usePrint();
  const state = useImsData(async () => {
    const { closing, expenses } = await finance.closing(id);
    const day = await finance.closingDay(closing.date);
    return { closing, expenses, day };
  }, [id]);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Daily closing report"
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="printer" disabled={!state.data} onClick={print}>
            Print
          </Button>
        </>
      }
    >
      <div className="fin-xl">
        <Loaded state={state} rows={3}>
          {(r) => <ClosingPaper closing={r.closing} expenses={r.expenses} day={r.day} />}
        </Loaded>
      </div>
    </Dialog>
  );
}

function ClosingPaper({ closing: c, expenses, day }: { closing: ImsClosing; expenses: ImsExpense[]; day: ClosingDay }) {
  const { session } = useIms();
  const seller = sellerOf(session);
  const f = day.figures;
  return (
    <article className="bos-inv-paper" aria-label={`Closing report — ${dateLabel(c.date)}`} style={{ position: "static" }}>
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{seller.name || "Your business"}</div>
          <div className="ims-paper-seller">{[seller.address, seller.state, seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.phone].filter(Boolean).join("\n")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">DAY CLOSE</div>
          <div className="ims-paper-sub">{dateLabel(c.date)}</div>
          <div className="ims-paper-sub">{c.status === "closed" ? `Closed by ${c.closedByName ?? "—"} · ${stampLabel(c.closedAt)}` : "Reopened — not final"}</div>
        </div>
      </div>

      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>Particulars</th>
            {PAY_METHODS.map((m) => (
              <th key={m} className="fin-paper-num">
                {methodLabel(m)}
              </th>
            ))}
            <th className="fin-paper-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Sales", f.sales, f.totals.sales],
              ["Collections", f.collections, f.totals.collections],
              ["Supplier payments", f.paid, f.totals.paid],
              ["Expenses", f.expenses, f.totals.expenses],
            ] as const
          ).map(([label, values, total]) => (
            <tr key={label}>
              <td>{label}</td>
              {PAY_METHODS.map((m) => (
                <td key={m} className="fin-paper-num">
                  {(values[m] ?? 0) ? inrExact(values[m]) : "—"}
                </td>
              ))}
              <td className="fin-paper-num">{inrExact(total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bos-inv-totals" style={{ width: 320 }}>
        <div className="bos-inv-totals-row">
          <span>Opening cash</span>
          <span>{inrExact(c.openingCash)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Expected cash</span>
          <span>{inrExact(c.expectedCash)}</span>
        </div>
        <div className="bos-inv-totals-row">
          <span>Counted cash</span>
          <span>{c.countedCash === null ? "—" : inrExact(c.countedCash)}</span>
        </div>
        <div className="bos-inv-totals-row is-total">
          <span>{varianceText(c.variance)}</span>
          <span>
            {c.variance > 0 ? "+" : ""}
            {inrExact(c.variance)}
          </span>
        </div>
      </div>

      <div className="fin-paper-grid" style={{ marginTop: 16 }}>
        <div>
          <b>Invoices</b>
          {day.sales.count} · {inrExact(day.sales.total)}
        </div>
        <div>
          <b>POS sales</b>
          {day.sales.posCount} · {inrExact(day.sales.posTotal)}
        </div>
        <div>
          <b>Credit sales</b>
          {inrExact(day.sales.credit)}
        </div>
        <div>
          <b>GST on sales</b>
          {inrExact(day.sales.tax)}
        </div>
      </div>

      {expenses.length ? (
        <table className="bos-inv-paper-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Expense</th>
              <th>Paid to</th>
              <th>Method</th>
              <th className="fin-paper-num">GST</th>
              <th className="fin-paper-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "normal" }}>
                  {e.category}
                  {e.description ? <small>{e.description}</small> : null}
                </td>
                <td>{e.vendor || "—"}</td>
                <td>{methodLabel(e.method)}</td>
                <td className="fin-paper-num">{e.gstAmount ? inrExact(e.gstAmount) : "—"}</td>
                <td className="fin-paper-num">{inrExact(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {c.notes ? <div className="bos-inv-notes" style={{ whiteSpace: "pre-wrap" }}>{c.notes}</div> : null}
      <div className="fin-paper-sign">
        <span>Prepared by</span>
        <span>Verified by</span>
      </div>
    </article>
  );
}
