"use client";

import { useState, type ReactNode } from "react";
import { Alert, Button, DataTable, Field, Grid, Input, KpiCard, ModuleToolbar, Pagination, Segmented, WidgetCard, WidgetRow, type BosColumn } from "@/components/bos";
import { bos, type ExpenseRegisterRow, type FinanceReport, type PnlRow, type PurchaseRegisterRow, type SalesRegisterRow } from "@/lib/bos-app/api";
import { billBadge, dateLabel, expenseBadge, inr, inrCompact, invoiceBadge, monthLabel, reportRange, todayLocal, type ReportPreset } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosApp, useBosData } from "../core";

type Period = ReportPreset | "custom";
type RegisterKey = "sales" | "purchases" | "expenses";

const PAGE = 50;

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "month", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "quarter", label: "This quarter" },
  { value: "fy", label: "This financial year" },
  { value: "custom", label: "Custom" },
];

const REGISTERS: ReadonlyArray<{ value: RegisterKey; label: string }> = [
  { value: "sales", label: "Sales register" },
  { value: "purchases", label: "Purchase register" },
  { value: "expenses", label: "Expense register" },
];

/** A register table that pages on screen and always exports every row it has. */
function Register<T>({
  caption,
  columns,
  rows,
  rowKey,
  truncated,
  empty,
  onExport,
  onRowClick,
}: {
  caption: string;
  columns: ReadonlyArray<BosColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  truncated: boolean;
  empty: ReactNode;
  onExport: () => void;
  onRowClick?: (row: T) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div>
      <DataTable caption={caption} columns={columns} rows={rows.slice(0, shown)} rowKey={rowKey} onRowClick={onRowClick} empty={empty} />
      <Pagination
        actions={
          <>
            {rows.length > shown ? (
              <Button size="sm" onClick={() => setShown((s) => s + PAGE)}>
                Show more
              </Button>
            ) : null}
            <Button size="sm" disabled={!rows.length} onClick={onExport}>
              Download CSV
            </Button>
          </>
        }
      >
        {rows.length ? `Showing ${Math.min(shown, rows.length)} of ${rows.length}` : "No entries"}
        {truncated ? ` · first ${rows.length} only — narrow the period to list the rest` : ""}
      </Pagination>
    </div>
  );
}

function exportPnl(r: FinanceReport) {
  const line = (label: string, p: Omit<PnlRow, "month">) => ({ Month: label, "Sales (excl. GST)": p.sales, "Purchases (excl. GST)": p.purchases, Expenses: p.expenses, Payroll: p.payroll, Net: p.net });
  downloadCsv(`profit-and-loss_${r.from}_${r.to}.csv`, ["Month", "Sales (excl. GST)", "Purchases (excl. GST)", "Expenses", "Payroll", "Net"], [...r.pnl.months.map((m) => line(monthLabel(m.month), m)), line("Total", r.pnl.total)]);
}

function exportRegister(r: FinanceReport, key: RegisterKey) {
  const period = `${r.from}_${r.to}`;
  if (key === "sales") {
    const headers = ["Invoice No", "Date", "Customer", "GSTIN", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Invoice total", "Balance due", "Status"];
    downloadCsv(
      `sales-register_${period}.csv`,
      headers,
      r.sales.rows.map((s) => ({
        "Invoice No": s.invoiceNo,
        Date: s.date,
        Customer: s.partyName,
        GSTIN: s.partyGstin ?? "",
        "Place of supply": s.placeOfSupply ?? "",
        "Taxable value": s.taxable,
        CGST: s.cgst,
        SGST: s.sgst,
        IGST: s.igst,
        "Invoice total": s.total,
        "Balance due": s.balance,
        Status: s.status,
      })),
    );
  } else if (key === "purchases") {
    const headers = ["Bill No", "Date", "Vendor", "Category", "Amount (excl. GST)", "GST", "Total", "Status"];
    downloadCsv(
      `purchase-register_${period}.csv`,
      headers,
      r.purchases.rows.map((b) => ({ "Bill No": b.billNo ?? "", Date: b.date, Vendor: b.partyName, Category: b.category ?? "", "Amount (excl. GST)": b.amount, GST: b.tax, Total: b.total, Status: b.status })),
    );
  } else {
    const headers = ["Date", "Claimant", "Category", "Description", "Amount", "Status"];
    downloadCsv(
      `expense-register_${period}.csv`,
      headers,
      r.expenses.rows.map((e) => ({ Date: e.date, Claimant: e.claimant ?? "", Category: e.category, Description: e.description ?? "", Amount: e.amount, Status: e.status })),
    );
  }
}

const SALES_COLUMNS: BosColumn<SalesRegisterRow>[] = [
  { key: "invoiceNo", header: "Invoice", mono: true, cell: (s) => s.invoiceNo },
  { key: "date", header: "Date", mono: true, cell: (s) => dateLabel(s.date) },
  { key: "party", header: "Customer", cell: (s) => <span>{s.partyName}{s.partyGstin ? <span className="bos-text-faint"> · {s.partyGstin}</span> : null}</span> },
  { key: "taxable", header: "Taxable", align: "right", mono: true, cell: (s) => inr(s.taxable) },
  { key: "gst", header: "GST", align: "right", mono: true, cell: (s) => inr(s.cgst + s.sgst + s.igst) },
  { key: "total", header: "Total", align: "right", mono: true, cell: (s) => inr(s.total) },
  { key: "status", header: "Status", cell: (s) => <StatusBadge view={invoiceBadge(s.status)} /> },
];

const PURCHASE_COLUMNS: BosColumn<PurchaseRegisterRow>[] = [
  { key: "vendor", header: "Vendor", cell: (b) => <span>{b.partyName}{b.billNo ? <span className="bos-text-faint"> · {b.billNo}</span> : null}</span> },
  { key: "date", header: "Date", mono: true, cell: (b) => dateLabel(b.date) },
  { key: "category", header: "Category", cell: (b) => b.category ?? "—" },
  { key: "amount", header: "Amount", align: "right", mono: true, cell: (b) => inr(b.amount) },
  { key: "tax", header: "GST", align: "right", mono: true, cell: (b) => inr(b.tax) },
  { key: "total", header: "Total", align: "right", mono: true, cell: (b) => inr(b.total) },
  { key: "status", header: "Status", cell: (b) => <StatusBadge view={billBadge(b.status)} /> },
];

const EXPENSE_COLUMNS: BosColumn<ExpenseRegisterRow>[] = [
  { key: "date", header: "Date", mono: true, cell: (e) => dateLabel(e.date) },
  { key: "claimant", header: "Claimant", cell: (e) => e.claimant ?? "—" },
  { key: "category", header: "Category", cell: (e) => <span>{e.category}{e.description ? <span className="bos-text-faint"> · {e.description}</span> : null}</span> },
  { key: "amount", header: "Amount", align: "right", mono: true, cell: (e) => inr(e.amount) },
  { key: "status", header: "Status", cell: (e) => <StatusBadge view={expenseBadge(e.status)} /> },
];

type PnlLine = Omit<PnlRow, "month"> & { key: string; label: string; total?: boolean };

const money = (pick: (l: PnlLine) => number, tone?: (n: number) => string | undefined) =>
  function MoneyCell(l: PnlLine) {
    const n = pick(l);
    const text = inr(n);
    const color = tone?.(n);
    return l.total ? <strong style={color ? { color } : undefined}>{text}</strong> : <span style={color ? { color } : undefined}>{text}</span>;
  };
const netTone = (n: number) => (n < 0 ? "var(--bos-coral-600)" : undefined);

const PNL_COLUMNS: BosColumn<PnlLine>[] = [
  { key: "month", header: "Month", cell: (l) => (l.total ? <strong>{l.label}</strong> : l.label) },
  { key: "sales", header: "Sales", align: "right", mono: true, cell: money((l) => l.sales) },
  { key: "purchases", header: "Purchases", align: "right", mono: true, cell: money((l) => l.purchases) },
  { key: "expenses", header: "Expenses", align: "right", mono: true, cell: money((l) => l.expenses) },
  { key: "payroll", header: "Payroll", align: "right", mono: true, cell: money((l) => l.payroll) },
  { key: "net", header: "Net", align: "right", mono: true, cell: money((l) => l.net, netTone) },
];

/** Finance → Reports: accrual P&L for a period plus sales, purchase and expense registers (CSV). */
export function FinanceReports() {
  const { canManage } = useBosApp();
  return canManage ? <ReportsBody /> : <ManagersOnly>Financial reports bring every invoice, bill and claim together, so they&apos;re limited to owners and admins.</ManagersOnly>;
}

function ReportsBody() {
  const { session, navigate } = useBosApp();
  const fyStart = session.settings.fiscalYearStart;
  const today = todayLocal();
  const [period, setPeriod] = useState<Period>("fy");
  const [custom, setCustom] = useState(() => reportRange("fy", today, fyStart));
  const [register, setRegister] = useState<RegisterKey>("sales");
  const range = period === "custom" ? custom : reportRange(period, today, fyStart);
  const state = useBosData(() => bos.financeReport(range.from, range.to), [range.from, range.to]);

  return (
    <Stack>
      <ModuleToolbar>
        <Segmented<Period>
          role="radio"
          size="sm"
          scroll
          aria-label="Report period"
          options={PERIODS}
          value={period}
          onChange={(p) => {
            if (p === "custom") setCustom(range);
            setPeriod(p);
          }}
        />
        {period === "custom" ? (
          <>
            <Field label="From">{({ id }) => <Input id={id} type="date" size="sm" value={custom.from} max={custom.to || today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />}</Field>
            <Field label="To">{({ id }) => <Input id={id} type="date" size="sm" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />}</Field>
          </>
        ) : null}
      </ModuleToolbar>
      <Loaded state={state}>
        {(r) => {
          const { total } = r.pnl;
          const margin = total.sales > 0 ? Math.round((total.net / total.sales) * 100) : null;
          const lines: PnlLine[] = [...r.pnl.months.map((m) => ({ ...m, key: m.month, label: monthLabel(m.month) })), { ...total, key: "total", label: "Total", total: true }];
          return (
            <Stack>
              <Grid cols={5} min={140}>
                <KpiCard label="Sales" value={inrCompact(total.sales)} chip={{ color: "blue", glyph: "₹" }} delta="Issued invoices, excl. GST" deltaTone="muted" />
                <KpiCard label="Purchases" value={inrCompact(total.purchases)} chip={{ color: "lavender", glyph: "↓" }} delta="Approved bills, excl. GST" deltaTone="muted" />
                <KpiCard label="Expenses" value={inrCompact(total.expenses)} chip={{ color: "amber", glyph: "◎" }} delta="Approved expense claims" deltaTone="muted" />
                <KpiCard label="Payroll" value={inrCompact(total.payroll)} chip={{ color: "rose", glyph: "👥" }} delta="Finalised runs, employer cost" deltaTone="muted" />
                <KpiCard
                  label={total.net >= 0 ? "Net profit" : "Net loss"}
                  value={inrCompact(Math.abs(total.net))}
                  valueTone={total.net >= 0 ? "emerald" : "coral"}
                  chip={{ color: "mint", glyph: "=" }}
                  delta={margin === null ? "No sales in this period" : `${margin}% of sales`}
                  deltaTone={total.net >= 0 ? "up" : "down"}
                />
              </Grid>
              <Grid template="1.6fr 1fr">
                <div>
                  <DataTable caption={`Profit & loss, ${dateLabel(r.from)} to ${dateLabel(r.to)}`} columns={PNL_COLUMNS} rows={lines} rowKey={(l) => l.key} compact />
                  <Pagination
                    actions={
                      <Button size="sm" onClick={() => exportPnl(r)}>
                        Download CSV
                      </Button>
                    }
                  >
                    Profit &amp; loss · {dateLabel(r.from)} – {dateLabel(r.to)}
                  </Pagination>
                </div>
                <Stack>
                  <WidgetCard title="🧾 Expenses by category" dot="rose">
                    {r.expenseByCategory.length ? (
                      r.expenseByCategory.slice(0, 8).map((c) => <WidgetRow key={c.category} label={c.category} value={inr(c.total)} />)
                    ) : (
                      <WidgetRow label={<span className="bos-text-faint">No approved claims in this period</span>} />
                    )}
                  </WidgetCard>
                  <WidgetCard title="📚 More reports" dot="blue">
                    <WidgetRow label="GST summary (GSTR-1 / 3B)" chevron onClick={() => navigate("finance", "gsttax")} />
                    <WidgetRow label="Receivables aging" chevron onClick={() => navigate("finance", "receivables")} />
                    <WidgetRow label="Payables & vendor bills" chevron onClick={() => navigate("finance", "payables")} />
                  </WidgetCard>
                </Stack>
              </Grid>
              <ModuleToolbar>
                <Segmented<RegisterKey> role="tabs" size="sm" scroll aria-label="Registers" options={REGISTERS} value={register} onChange={setRegister} />
              </ModuleToolbar>
              {register === "sales" ? (
                <Register
                  key={`sales:${r.from}:${r.to}`}
                  caption="Sales register"
                  columns={SALES_COLUMNS}
                  rows={r.sales.rows}
                  rowKey={(s) => s.id}
                  truncated={r.sales.truncated}
                  empty="No issued invoices in this period."
                  onExport={() => exportRegister(r, "sales")}
                  onRowClick={(s) => navigate("finance", "invoices", `open:${s.id}`)}
                />
              ) : register === "purchases" ? (
                <Register
                  key={`purchases:${r.from}:${r.to}`}
                  caption="Purchase register"
                  columns={PURCHASE_COLUMNS}
                  rows={r.purchases.rows}
                  rowKey={(b) => b.id}
                  truncated={r.purchases.truncated}
                  empty="No approved bills in this period."
                  onExport={() => exportRegister(r, "purchases")}
                />
              ) : (
                <Register
                  key={`expenses:${r.from}:${r.to}`}
                  caption="Expense register"
                  columns={EXPENSE_COLUMNS}
                  rows={r.expenses.rows}
                  rowKey={(e) => e.id}
                  truncated={r.expenses.truncated}
                  empty="No approved expense claims in this period."
                  onExport={() => exportRegister(r, "expenses")}
                />
              )}
              <Alert tone="blue" title="How these figures are worked out">
                Accrual basis, by document date. Sales are issued (non-void) invoices and purchases are approved or paid vendor bills, both excluding GST — GST collected and input credit aren&apos;t income or cost, see GST &amp; Tax. Expenses are approved or reimbursed claims as claimed. Payroll is the employer&apos;s cost (gross pay plus employer PF and ESI) of finalised runs, counted in the payroll month. Depreciation isn&apos;t included yet.
              </Alert>
            </Stack>
          );
        }}
      </Loaded>
    </Stack>
  );
}
