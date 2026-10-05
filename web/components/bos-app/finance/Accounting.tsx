"use client";

import { useState, type ReactNode } from "react";
import {
  Alert,
  BosIcon,
  Button,
  DataTable,
  Dialog,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  WidgetRow,
  useToast,
  type BosColumn,
} from "@/components/bos";
import {
  bos,
  type AccountingOverview,
  type AccountLedger,
  type AccountType,
  type BosAccount,
  type BosJournal,
  type OpeningBalances,
  type OpeningLine,
  type PostingSource,
  type PostingSummary,
  type TrialBalance,
} from "@/lib/bos-app/api";
import { accountTypeBadge, dateLabel, drCr, inr, inrCompact, normalBalance, todayLocal } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type View = "chart" | "ledger" | "journals" | "summary" | "opening";
type Acct = AccountingOverview["accounts"][number];
type Range = { from: string; to: string };

const TYPES: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: "asset", label: "Assets" },
  { value: "liability", label: "Liabilities" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expenses" },
];

const SOURCE_LABEL: Record<PostingSource, string> = {
  opening: "Opening balances",
  journal: "Manual entry",
  invoice: "Invoice",
  payment: "Receipt",
  bill: "Bill",
  bill_payment: "Bill payment",
  expense: "Expense claim",
  reimbursement: "Reimbursement",
  payroll: "Payroll",
  payroll_payment: "Salary payment",
  bank: "Bank line",
  asset: "Asset",
  depreciation: "Depreciation",
  disposal: "Disposal",
};

/** Finance module holding each source record; `open` modules take an "open:<id>" intent. */
const SOURCE_MODULE: Partial<Record<PostingSource, { module: string; open?: boolean }>> = {
  invoice: { module: "invoices", open: true },
  payment: { module: "invoices", open: true },
  bill: { module: "payables" },
  bill_payment: { module: "payables" },
  expense: { module: "expenses" },
  reimbursement: { module: "expenses" },
  payroll: { module: "payroll", open: true },
  payroll_payment: { module: "payroll", open: true },
  bank: { module: "banking" },
  asset: { module: "assets", open: true },
  depreciation: { module: "assets", open: true },
  disposal: { module: "assets", open: true },
};

const accountLabel = (a: Pick<BosAccount, "code" | "name">) => `${a.code} · ${a.name}`;
const amountOf = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};
const sum = (values: ReadonlyArray<number>) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
const splitList = (v: string) => [...new Set(v.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean))];
const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const dash = (n: number) => (n ? inr(n) : faint());

function Described({ title, sub, width = 320 }: { title: ReactNode; sub?: ReactNode; width?: number }) {
  return (
    <span style={{ display: "block", maxWidth: width }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {sub ? (
        <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

function AccountOptions({ accounts }: { accounts: ReadonlyArray<BosAccount> }) {
  return (
    <>
      {TYPES.map((t) => {
        const list = accounts.filter((a) => a.type === t.value);
        return list.length ? (
          <optgroup key={t.value} label={t.label}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
                {a.archived ? " (archived)" : ""}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

function RangeInputs({ range, max, onChange }: { range: Range; max: string; onChange: (r: Range) => void }) {
  return (
    <>
      <Input size="sm" type="date" aria-label="From" value={range.from} max={range.to || max} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} style={{ width: "auto" }} />
      <span className="bos-text-faint">to</span>
      <Input size="sm" type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} style={{ width: "auto" }} />
    </>
  );
}

/** Finance → Accounting: chart of accounts, general ledger, manual entries, balance summary and opening balances. Managers only. */
export function Accounting() {
  const { canManage, takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("accounting"));
  if (!canManage) return <ManagersOnly>The chart of accounts, ledger and manual entries are limited to owners and admins.</ManagersOnly>;
  return <AccountingHome intent={intent} />;
}

function AccountingHome({ intent }: { intent: string | null }) {
  const { navigate } = useBosApp();
  const [view, setView] = useState<View>(intent === "new" ? "journals" : "chart");
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [journalId, setJournalId] = useState<string | null>(null);
  const [posting, setPosting] = useState(intent === "new");
  const [editing, setEditing] = useState<Acct | "new" | null>(null);
  const state = useBosData(() => bos.accountingOverview(), []);

  const openLedger = (id: string) => {
    setLedgerId(id);
    setView("ledger");
  };
  const openPosting = (p: PostingSummary) => {
    if (p.source === "journal") return setJournalId(p.sourceId);
    if (p.source === "opening") return setView("opening");
    const target = SOURCE_MODULE[p.source];
    if (target) navigate("finance", target.module, target.open ? `open:${p.linkId}` : undefined);
  };

  return (
    <Loaded state={state}>
      {(o) => {
        const t = o.totals;
        const ledgerAccount = ledgerId ?? (o.accounts.find((a) => a.systemKey === "bank") ?? o.accounts[0])?.id ?? "";
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard
                label="Opening balances"
                value={o.booksStart ? inr(t.openingTotal) : "Not set"}
                chip={{ color: "lavender", glyph: "⚖" }}
                delta={o.booksStart ? `Books start ${dateLabel(o.booksStart)}` : "Books run from your first record"}
                deltaTone="muted"
              />
              <KpiCard label="Cash & bank" value={inr(t.cashAndBank)} chip={{ color: "blue", glyph: "₹" }} delta={`${inrCompact(t.receivables)} to collect · ${inrCompact(t.payables)} to pay`} deltaTone="muted" />
              <KpiCard label="Manual entries (MTD)" value={t.manualMtd.toLocaleString("en-IN")} chip={{ color: "sage", glyph: "✎" }} delta="Journal vouchers this month" deltaTone="muted" />
              <KpiCard
                label={`Net profit (${o.fyLabel})`}
                value={inr(t.net)}
                valueTone={t.net < 0 ? "coral" : "emerald"}
                chip={{ color: "mint", glyph: "Σ" }}
                delta={`Income ${inrCompact(t.income)} · Expenses ${inrCompact(t.expense)}`}
                deltaTone="muted"
              />
            </Grid>

            {!o.booksStart && view !== "opening" ? (
              <Alert
                tone="blue"
                title="Your ledger is built from BOS records"
                actions={
                  <Button size="sm" onClick={() => setView("opening")}>
                    Set opening balances
                  </Button>
                }
              >
                Every invoice, payment, bill, expense claim, payroll run, categorised bank line and asset is posted to the ledger automatically — nothing to re-enter. If you kept books elsewhere before BOS, pick a books-start date and
                bring in the balances on that day.
              </Alert>
            ) : null}
            {Math.abs(t.suspense) >= 0.5 ? (
              <Alert tone="amber" title={`${inr(Math.abs(t.suspense))} is waiting in Suspense`}>
                Assets bought without an approved bill, and the proceeds when an asset is sold, are parked in the Suspense account. Post a manual entry to move them to the bank, a loan or capital.
              </Alert>
            ) : null}
            {Math.abs(t.openingDifference) >= 0.5 ? (
              <Alert tone="amber" title={`Opening balances are off by ${inr(Math.abs(t.openingDifference))}`}>
                Opening debits and credits don&apos;t match, so the difference sits in the Opening balance adjustment account. Review the opening balances to clear it.
              </Alert>
            ) : null}

            <div>
              <ModuleToolbar>
                <Segmented<View>
                  size="sm"
                  aria-label="Accounting view"
                  options={[
                    { value: "chart", label: "Chart of accounts" },
                    { value: "ledger", label: "General ledger" },
                    { value: "journals", label: "Manual entries" },
                    { value: "summary", label: "Balance summary" },
                    { value: "opening", label: "Opening balances" },
                  ]}
                  value={view}
                  onChange={setView}
                />
                <span className="bos-spacer" />
                {view === "chart" ? (
                  <Button size="sm" icon="plus" onClick={() => setEditing("new")}>
                    Add account
                  </Button>
                ) : null}
                {view === "chart" || view === "journals" ? (
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setPosting(true)}>
                    New entry
                  </Button>
                ) : null}
              </ModuleToolbar>
              <div style={{ marginTop: 12 }}>
                {view === "chart" ? <ChartView o={o} onLedger={openLedger} onEdit={setEditing} onOpen={openPosting} /> : null}
                {view === "ledger" && ledgerAccount ? <LedgerView o={o} accountId={ledgerAccount} onAccount={setLedgerId} onOpen={openPosting} /> : null}
                {view === "journals" ? <JournalsView o={o} onOpen={setJournalId} /> : null}
                {view === "summary" ? <SummaryView o={o} onLedger={openLedger} /> : null}
                {view === "opening" ? <OpeningView o={o} /> : null}
              </div>
            </div>

            {editing ? <AccountDialog account={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
            {posting ? <JournalDialog o={o} onClose={() => setPosting(false)} onPosted={(j) => setJournalId(j.id)} /> : null}
            {journalId ? <JournalView id={journalId} onClose={() => setJournalId(null)} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Chart of accounts ---------- */

function ChartView({ o, onLedger, onEdit, onOpen }: { o: AccountingOverview; onLedger: (id: string) => void; onEdit: (a: Acct) => void; onOpen: (p: PostingSummary) => void }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const q = query.trim().toLowerCase();
  const archivedCount = o.accounts.filter((a) => a.archived).length;
  const shown = o.accounts.filter((a) => a.archived === archived && (!q || [a.code, a.name, a.description, ...a.categories].some((s) => s?.toLowerCase().includes(q))));

  const columns: BosColumn<Acct>[] = [
    { key: "code", header: "Code", mono: true, width: 80, cell: (a) => a.code },
    {
      key: "account",
      header: "Account",
      cell: (a) => <Described title={a.name} sub={[a.description, a.categories.length ? `Bills & claims: ${a.categories.join(", ")}` : null].filter(Boolean).join(" · ")} width={380} />,
    },
    { key: "type", header: "Type", cell: (a) => <StatusBadge view={accountTypeBadge(a.type)} /> },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (a) => (a.used || a.balance ? inr(normalBalance(a.balance, a.type)) : faint()) },
    {
      key: "edit",
      header: "",
      align: "right",
      cell: (a) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Edit ${accountLabel(a)}`}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(a);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  const recent = o.recent.map((p, n) => ({ ...p, n }));
  const recentColumns: BosColumn<(typeof recent)[number]>[] = [
    { key: "date", header: "Date", mono: true, cell: (p) => dateLabel(p.date) },
    { key: "description", header: "Description", cell: (p) => <Described title={p.memo} sub={`${SOURCE_LABEL[p.source]} · ${p.ref}`} width={280} /> },
    { key: "debit", header: "Debit", cell: (p) => p.debit.join(", ") },
    { key: "credit", header: "Credit", cell: (p) => p.credit.join(", ") },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (p) => inr(p.amount) },
  ];

  return (
    <Stack gap={16}>
      <ModuleToolbar>
        <Segmented<"active" | "archived">
          role="radio"
          size="sm"
          aria-label="Show accounts"
          options={[
            { value: "active", label: `Active (${o.accounts.length - archivedCount})` },
            { value: "archived", label: `Archived (${archivedCount})` },
          ]}
          value={archived ? "archived" : "active"}
          onChange={(v) => setArchived(v === "archived")}
        />
        <span className="bos-spacer" />
        <SearchInput placeholder="Search code, name, category…" aria-label="Search accounts" value={query} onChange={(e) => setQuery(e.target.value)} />
      </ModuleToolbar>
      <DataTable caption="Chart of accounts" columns={columns} rows={shown} rowKey={(a) => a.id} onRowClick={(a) => onLedger(a.id)} empty={archived ? "No archived accounts." : "No accounts match."} />
      <p className="bos-text-faint" style={{ fontSize: 12, margin: 0 }}>
        Balances are as of today, shown on each account&apos;s normal side (a negative figure is a contra balance). Click an account to open its ledger.
      </p>
      <DataTable caption="General ledger — recent entries" columns={recentColumns} rows={recent} rowKey={(p) => String(p.n)} onRowClick={onOpen} compact empty="Nothing posted yet." />
    </Stack>
  );
}

function AccountDialog({ account, onClose }: { account: Acct | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const f = useFormState(() => ({
    code: account?.code ?? "",
    name: account?.name ?? "",
    type: account?.type ?? ("expense" as AccountType),
    description: account?.description ?? "",
    categories: account?.categories.join(", ") ?? "",
  }));
  const v = f.values;
  const system = Boolean(account?.systemKey);

  const submit = async () => {
    const input = { code: v.code.trim(), name: v.name.trim(), type: v.type, description: v.description.trim() || null, categories: v.type === "expense" ? splitList(v.categories) : [] };
    const out = await run("account", () => (account ? bos.updateAccount(account.id, input) : bos.createAccount(input)), { success: account ? "Account updated" : "Account added", description: accountLabel(input) });
    if (out) onClose();
  };
  const setArchived = async (archived: boolean) => {
    if (!account) return;
    const out = await run("archive", () => bos.updateAccount(account.id, { archived }), { success: archived ? "Account archived" : "Account restored", description: accountLabel(account) });
    if (out) onClose();
  };

  if (account && confirmingDelete) {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        destructive
        title={`Delete ${accountLabel(account)}?`}
        description="Nothing has been posted to this account, so it's removed from the chart."
        confirmLabel="Delete"
        busy={busy === "delete"}
        onConfirm={async () => {
          const done = await run(
            "delete",
            async () => {
              await bos.deleteAccount(account.id);
              return true;
            },
            { success: "Account deleted", description: accountLabel(account) },
          );
          if (done) onClose();
        }}
      />
    );
  }

  const housekeeping =
    account && !system ? (
      account.archived ? (
        <Button size="sm" variant="ghost" disabled={busy === "archive"} onClick={() => setArchived(false)}>
          Restore
        </Button>
      ) : account.used ? (
        <Button size="sm" variant="ghost" disabled={busy === "archive"} onClick={() => setArchived(true)}>
          Archive
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
          Delete
        </Button>
      )
    ) : system ? (
      <span className="bos-text-faint" style={{ fontSize: 12 }}>
        BOS posts to this account, so its type stays fixed.
      </span>
    ) : null;

  return (
    <FormDialog
      open
      onClose={onClose}
      title={account ? `Edit ${accountLabel(account)}` : "Add an account"}
      description="Accounts group your ledger postings. Expense accounts can collect bill and expense-claim categories."
      icon={{ tone: "blue", name: "layers" }}
      submitLabel={account ? "Save" : "Add account"}
      busy={busy === "account"}
      onSubmit={submit}
      note={housekeeping}
    >
      <FormGrid>
        <Field label="Code" hint="Up to 12 letters, digits or dashes">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} required maxLength={12} value={v.code} placeholder="e.g. 5150" onChange={(e) => f.set("code")(e.target.value)} />}
        </Field>
        <Field label="Account name">{({ id }) => <Input id={id} required maxLength={120} value={v.name} placeholder="e.g. Rent" onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.type} disabled={system} onChange={(e) => f.set("type")(e.target.value as AccountType)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label.replace(/ies$/, "y").replace(/s$/, "")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description">{({ id }) => <Input id={id} maxLength={300} value={v.description} placeholder="Optional" onChange={(e) => f.set("description")(e.target.value)} />}</Field>
      </FormGrid>
      {v.type === "expense" ? (
        <Field label="Bill & claim categories" hint="Comma-separated. Bills, expense claims and bank lines in these categories post here instead of the default account.">
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} value={v.categories} placeholder="e.g. Rent, Office rent" onChange={(e) => f.set("categories")(e.target.value)} />}
        </Field>
      ) : null}
    </FormDialog>
  );
}

/* ---------- General ledger ---------- */

function LedgerView({ o, accountId, onAccount, onOpen }: { o: AccountingOverview; accountId: string; onAccount: (id: string) => void; onOpen: (p: PostingSummary) => void }) {
  const [range, setRange] = useState<Range>({ from: o.fyStart, to: o.today });
  const state = useBosData(() => bos.accountLedger(accountId, range.from, range.to), [accountId, range.from, range.to]);
  type Line = AccountLedger["lines"][number] & { n: number };
  const columns: BosColumn<Line>[] = [
    { key: "date", header: "Date", mono: true, cell: (l) => dateLabel(l.date) },
    { key: "description", header: "Description", cell: (l) => <Described title={l.memo} sub={`${SOURCE_LABEL[l.source]} · ${l.ref}`} /> },
    { key: "debit", header: "Debit", align: "right", mono: true, cell: (l) => dash(l.debit) },
    { key: "credit", header: "Credit", align: "right", mono: true, cell: (l) => dash(l.credit) },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (l) => drCr(l.balance) },
  ];
  return (
    <Stack gap={12}>
      <ModuleToolbar>
        <Select size="sm" aria-label="Account" value={accountId} onChange={(e) => onAccount(e.target.value)} style={{ width: "auto", maxWidth: 320 }}>
          <AccountOptions accounts={o.accounts} />
        </Select>
        <RangeInputs range={range} max={o.today} onChange={setRange} />
        <span className="bos-spacer" />
        <Button size="sm" icon="download" disabled={!state.data?.lines.length} onClick={() => state.data && exportLedger(state.data)}>
          Download CSV
        </Button>
      </ModuleToolbar>
      <Loaded state={state} rows={2}>
        {(ledger) => (
          <Stack gap={12}>
            <Grid cols={4} min={140}>
              <KpiCard label={`Opening · ${dateLabel(ledger.from)}`} value={drCr(ledger.opening)} interactive={false} />
              <KpiCard label="Debits" value={inr(ledger.debit)} interactive={false} />
              <KpiCard label="Credits" value={inr(ledger.credit)} interactive={false} />
              <KpiCard label={`Closing · ${dateLabel(ledger.to)}`} value={drCr(ledger.closing)} interactive={false} />
            </Grid>
            {ledger.truncated ? <Alert tone="amber" title="Showing the latest 5,000 entries">Narrow the dates to see the rest.</Alert> : null}
            <DataTable
              caption={`Ledger, ${accountLabel(ledger.account)}`}
              columns={columns}
              rows={ledger.lines.map((l, n) => ({ ...l, n }))}
              rowKey={(l) => String(l.n)}
              onRowClick={onOpen}
              compact
              empty="No entries in this period."
            />
          </Stack>
        )}
      </Loaded>
    </Stack>
  );
}

function exportLedger(ledger: AccountLedger) {
  const headers = ["Date", "Source", "Reference", "Description", "Debit", "Credit", "Balance"];
  downloadCsv(
    `ledger_${ledger.account.code}_${ledger.from}_${ledger.to}.csv`,
    headers,
    [
      { Date: ledger.from, Source: "", Reference: "", Description: "Opening balance", Debit: "", Credit: "", Balance: ledger.opening },
      ...ledger.lines.map((l) => ({ Date: l.date, Source: SOURCE_LABEL[l.source], Reference: l.ref, Description: l.memo, Debit: l.debit || "", Credit: l.credit || "", Balance: l.balance })),
    ],
  );
}

/* ---------- Manual entries ---------- */

function JournalsView({ o, onOpen }: { o: AccountingOverview; onOpen: (id: string) => void }) {
  const [range, setRange] = useState<Range>({ from: o.fyStart, to: o.today });
  const state = useBosData(() => bos.journals(range.from, range.to), [range.from, range.to]);
  type Row = BosJournal & { lineCount: number };
  const columns: BosColumn<Row>[] = [
    { key: "no", header: "Entry", mono: true, cell: (j) => j.journalNo },
    { key: "date", header: "Date", mono: true, cell: (j) => dateLabel(j.date) },
    { key: "narration", header: "Narration", cell: (j) => <Described title={j.narration} sub={j.status === "void" ? `Void · ${j.voidReason ?? ""}` : undefined} width={360} /> },
    { key: "lines", header: "Lines", align: "right", mono: true, cell: (j) => j.lineCount },
    { key: "total", header: "Amount", align: "right", mono: true, cell: (j) => (j.status === "void" ? faint(inr(j.total)) : inr(j.total)) },
    { key: "status", header: "Status", cell: (j) => <StatusBadge view={j.status === "void" ? { text: "VOID", tone: "neutral" } : { text: "POSTED", tone: "emerald" }} /> },
  ];
  return (
    <Stack gap={12}>
      <ModuleToolbar>
        <RangeInputs range={range} max={o.today} onChange={setRange} />
      </ModuleToolbar>
      <Loaded state={state} rows={2}>
        {({ journals }) => (
          <DataTable caption="Manual entries" columns={columns} rows={journals} rowKey={(j) => j.id} onRowClick={(j) => onOpen(j.id)} empty="No manual entries in this period. Use them for capital, loans, drawings, corrections and anything BOS doesn't post itself." />
        )}
      </Loaded>
    </Stack>
  );
}

type DraftLine = { key: string; accountId: string; debit: string; credit: string; note: string };
let lineSeq = 0;
const blankLine = (): DraftLine => ({ key: `jl-${++lineSeq}`, accountId: "", debit: "", credit: "", note: "" });

function JournalDialog({ o, onClose, onPosted }: { o: AccountingOverview; onClose: () => void; onPosted: (j: BosJournal) => void }) {
  const { run, busy } = useBosAction();
  const { show } = useToast();
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine(), blankLine()]);
  const active = o.accounts.filter((a) => !a.archived);
  const debit = sum(lines.map((l) => amountOf(l.debit)));
  const credit = sum(lines.map((l) => amountOf(l.credit)));
  const off = Math.abs(debit - credit) >= 0.005;
  const monthEnd = (() => {
    const [y, m] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  })();

  const setLine = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const submit = async () => {
    const used = lines.filter((l) => amountOf(l.debit) || amountOf(l.credit));
    const problem = used.length < 2 ? "Add at least two lines with an amount" : used.some((l) => !l.accountId) ? "Pick an account on every line" : off ? "Debits and credits must be equal" : null;
    if (problem) return show({ tone: "coral", title: "Can't post this entry yet", description: problem });
    const out = await run(
      "journal",
      () =>
        bos.createJournal({
          date,
          narration: narration.trim(),
          lines: used.map((l) => ({ accountId: l.accountId, debit: amountOf(l.debit), credit: amountOf(l.credit), note: l.note.trim() || null })),
        }),
      { success: "Entry posted", description: narration.trim() },
    );
    if (!out) return;
    onClose();
    onPosted(out.journal);
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title="New manual entry"
      description="A journal voucher for anything BOS doesn't post itself — capital, loans, drawings, interest, corrections. Debits must equal credits."
      icon={{ tone: "blue", name: "file" }}
      submitLabel="Post entry"
      busy={busy === "journal"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Date">{({ id }) => <Input id={id} type="date" required min={o.booksStart ?? undefined} max={monthEnd} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Narration">{({ id }) => <Input id={id} required maxLength={300} value={narration} placeholder="e.g. Capital introduced by the owner" onChange={(e) => setNarration(e.target.value)} />}</Field>
      </FormGrid>
      <div className="bos-journal-line is-head" aria-hidden="true">
        <span>Account</span>
        <span>Debit (₹)</span>
        <span>Credit (₹)</span>
        <span>Note</span>
        <span />
      </div>
      <div role="list" aria-label="Entry lines">
        {lines.map((l, i) => (
          <div key={l.key} className="bos-journal-line" role="listitem">
            <Select size="sm" aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })}>
              <option value="">Pick an account…</option>
              <AccountOptions accounts={active} />
            </Select>
            <Input size="sm" aria-label={`Line ${i + 1} debit`} type="number" inputMode="decimal" min={0} step="0.01" value={l.debit} onChange={(e) => setLine(l.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })} />
            <Input size="sm" aria-label={`Line ${i + 1} credit`} type="number" inputMode="decimal" min={0} step="0.01" value={l.credit} onChange={(e) => setLine(l.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })} />
            <Input size="sm" aria-label={`Line ${i + 1} note`} maxLength={200} value={l.note} placeholder="Optional" onChange={(e) => setLine(l.key, { note: e.target.value })} />
            <button type="button" className="bos-inv-remove" aria-label={`Remove line ${i + 1}`} title="Remove line" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              <BosIcon name="x" />
            </button>
          </div>
        ))}
      </div>
      <div className="bos-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          Add line
        </Button>
        <div className="bos-journal-totals" aria-live="polite">
          <span>Debits {inr(debit)}</span>
          <span>Credits {inr(credit)}</span>
          <span className={off ? "is-off" : undefined}>{off ? `Off by ${inr(Math.abs(debit - credit))}` : debit ? "Balanced" : ""}</span>
        </div>
      </div>
    </FormDialog>
  );
}

function JournalView({ id, onClose }: { id: string; onClose: () => void }) {
  const [voiding, setVoiding] = useState(false);
  const state = useBosData(() => bos.journal(id), [id]);
  const j = state.data?.journal;
  if (voiding && j) return <VoidDialog journal={j} onClose={() => setVoiding(false)} />;
  type Line = NonNullable<typeof state.data>["lines"][number];
  const columns: BosColumn<Line>[] = [
    { key: "account", header: "Account", cell: (l) => <Described title={accountLabel(l)} sub={l.note ?? undefined} width={300} /> },
    { key: "debit", header: "Debit", align: "right", mono: true, cell: (l) => dash(l.debit) },
    { key: "credit", header: "Credit", align: "right", mono: true, cell: (l) => dash(l.credit) },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={j ? `${j.journalNo} · ${dateLabel(j.date)}` : "Manual entry"}
      description={j?.narration}
      icon={{ tone: j?.status === "void" ? "amber" : "blue", name: "file" }}
      wide
      actionsNote={j?.status === "void" ? `Voided${j.voidedAt ? ` ${dateLabel(j.voidedAt.slice(0, 10))}` : ""} · ${j.voidReason ?? ""}` : undefined}
      actions={
        <>
          {j?.status === "posted" ? (
            <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}>
              Void entry
            </Button>
          ) : null}
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Loaded state={state} rows={1}>
          {({ lines, journal }) => (
            <DataTable
              caption={`Lines, ${journal.journalNo}`}
              columns={columns}
              rows={[...lines, { id: "total", accountId: "", code: "", name: "Total", debit: journal.total, credit: journal.total, note: null }]}
              rowKey={(l) => l.id}
              compact
            />
          )}
        </Loaded>
      </div>
    </Dialog>
  );
}

function VoidDialog({ journal, onClose }: { journal: BosJournal; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Void ${journal.journalNo}?`}
      description="The entry stays on record, marked void, and drops out of every balance. Post a fresh entry if it needs replacing."
      icon={{ tone: "coral", name: "warning" }}
      submitLabel="Void entry"
      busy={busy === "void"}
      onSubmit={async () => {
        const out = await run("void", () => bos.voidJournal(journal.id, reason.trim()), { success: "Entry voided", description: journal.journalNo });
        if (out) onClose();
      }}
    >
      <Field label="Reason">{({ id }) => <Input id={id} required maxLength={300} value={reason} placeholder="e.g. Posted to the wrong account" onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormDialog>
  );
}

/* ---------- Balance summary ---------- */

function SummaryView({ o, onLedger }: { o: AccountingOverview; onLedger: (id: string) => void }) {
  const [range, setRange] = useState<Range>({ from: o.fyStart, to: o.today });
  const state = useBosData(() => bos.trialBalance(range.from, range.to), [range.from, range.to]);
  return (
    <Stack gap={12}>
      <ModuleToolbar>
        <RangeInputs range={range} max={o.today} onChange={setRange} />
        <span className="bos-spacer" />
        <Button size="sm" icon="download" disabled={!state.data} onClick={() => state.data && exportTrialBalance(state.data)}>
          Download CSV
        </Button>
      </ModuleToolbar>
      <Loaded state={state} rows={2}>
        {(tb) => <TrialBalanceTables tb={tb} onLedger={onLedger} />}
      </Loaded>
    </Stack>
  );
}

function TrialBalanceTables({ tb, onLedger }: { tb: TrialBalance; onLedger: (id: string) => void }) {
  type Row = TrialBalance["rows"][number];
  const s = tb.statements;
  const balanced = Math.abs(s.difference) < 0.5 && Math.abs(tb.totals.debit - tb.totals.credit) < 0.5;
  const rows = tb.rows.filter((r) => r.opening || r.debit || r.credit || r.closing);
  const columns: BosColumn<Row>[] = [
    { key: "code", header: "Code", mono: true, cell: (r) => r.code },
    { key: "account", header: "Account", cell: (r) => <span style={{ fontWeight: r.id === "total" ? 700 : 600 }}>{r.name}</span> },
    { key: "type", header: "Type", cell: (r) => (r.id === "total" ? null : <StatusBadge view={accountTypeBadge(r.type)} />) },
    { key: "opening", header: "Opening", align: "right", mono: true, cell: (r) => (r.id === "total" ? null : drCr(r.opening)) },
    { key: "debit", header: "Debit", align: "right", mono: true, cell: (r) => dash(r.debit) },
    { key: "credit", header: "Credit", align: "right", mono: true, cell: (r) => dash(r.credit) },
    {
      key: "closing",
      header: "Closing",
      align: "right",
      mono: true,
      cell: (r) => (r.id === "total" ? `${inr(tb.totals.closingDebit)} Dr · ${inr(tb.totals.closingCredit)} Cr` : drCr(r.closing)),
    },
  ];
  const total: Row = { id: "total", code: "", name: "Total", type: "asset", systemKey: null, categories: [], description: null, archived: false, opening: 0, debit: tb.totals.debit, credit: tb.totals.credit, closing: 0 };
  return (
    <Stack gap={16}>
      <Grid cols={2} min={260}>
        <WidgetCard title={`📈 Profit & loss · ${dateLabel(tb.from)} – ${dateLabel(tb.to)}`} dot="mint">
          <WidgetRow label="Income" value={inr(s.income)} />
          <WidgetRow label="Expenses" value={inr(s.expense)} />
          <WidgetRow label={s.net < 0 ? "Net loss" : "Net profit"} value={inr(Math.abs(s.net))} valueTone={s.net < 0 ? "coral" : "emerald"} />
        </WidgetCard>
        <WidgetCard title={`🏛️ Balance sheet · ${dateLabel(tb.to)}`} dot="lavender">
          <WidgetRow label="Assets" value={inr(s.assets)} />
          <WidgetRow label="Liabilities" value={inr(s.liabilities)} />
          <WidgetRow label="Equity" value={inr(s.equity)} />
          <WidgetRow label="Profit to date (not yet closed)" value={inr(s.profitToDate)} />
          <WidgetRow label="Check" value={balanced ? "Balanced ✓" : `Off by ${inr(Math.abs(s.difference))}`} valueTone={balanced ? "emerald" : "coral"} />
        </WidgetCard>
      </Grid>
      <DataTable caption="Trial balance" columns={columns} rows={[...rows, total]} rowKey={(r) => r.id} onRowClick={(r) => r.id !== "total" && onLedger(r.id)} compact empty="Nothing posted yet." />
      <p className="bos-text-faint" style={{ fontSize: 12, margin: 0 }}>
        Built from every BOS record plus manual entries. Reports → Profit &amp; loss counts invoices, bills and claims only, so it can differ from this summary — here bank-categorised lines, payroll, depreciation and manual
        entries are included too, and bills or claims may sit in their own expense accounts.
      </p>
    </Stack>
  );
}

function exportTrialBalance(tb: TrialBalance) {
  const headers = ["Code", "Account", "Type", "Opening Dr", "Opening Cr", "Debit", "Credit", "Closing Dr", "Closing Cr"];
  const side = (n: number, dr: boolean) => (dr ? (n > 0 ? n : "") : n < 0 ? -n : "");
  downloadCsv(
    `trial-balance_${tb.from}_${tb.to}.csv`,
    headers,
    tb.rows
      .filter((r) => r.opening || r.debit || r.credit || r.closing)
      .map((r) => ({
        Code: r.code,
        Account: r.name,
        Type: accountTypeBadge(r.type).text,
        "Opening Dr": side(r.opening, true),
        "Opening Cr": side(r.opening, false),
        Debit: r.debit || "",
        Credit: r.credit || "",
        "Closing Dr": side(r.closing, true),
        "Closing Cr": side(r.closing, false),
      })),
  );
}

/* ---------- Opening balances ---------- */

function OpeningView({ o }: { o: AccountingOverview }) {
  const state = useBosData(() => bos.openingBalances(), []);
  return <Loaded state={state} rows={2}>{(data) => <OpeningEditor key={data.booksStart ?? "none"} o={o} data={data} />}</Loaded>;
}

type Amounts = Record<string, { debit: string; credit: string }>;
const toAmounts = (lines: ReadonlyArray<OpeningLine>): Amounts =>
  Object.fromEntries(lines.map((l) => [l.accountId, { debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" }]));

function OpeningEditor({ o, data }: { o: AccountingOverview; data: OpeningBalances }) {
  const { run, busy } = useBosAction();
  const { show } = useToast();
  const [booksStart, setBooksStart] = useState(data.booksStart ?? o.fyStart);
  const [amounts, setAmounts] = useState<Amounts>(() => toAmounts(data.lines));
  const [scope, setScope] = useState<"balance" | "all">("balance");
  const has = (id: string) => Boolean(amountOf(amounts[id]?.debit ?? "") || amountOf(amounts[id]?.credit ?? ""));
  const editable = o.accounts.filter((a) => a.systemKey !== "opening_adjustment" && (!a.archived || has(a.id)));
  const shown = editable.filter((a) => scope === "all" || a.type === "asset" || a.type === "liability" || a.type === "equity" || has(a.id));
  const lines = editable.map((a) => ({ accountId: a.id, debit: amountOf(amounts[a.id]?.debit ?? ""), credit: amountOf(amounts[a.id]?.credit ?? "") })).filter((l) => l.debit || l.credit);
  const debit = sum(lines.map((l) => l.debit));
  const credit = sum(lines.map((l) => l.credit));
  const difference = Math.round((debit - credit) * 100) / 100;

  const setAmount = (id: string, side: "debit" | "credit", value: string) =>
    setAmounts((m) => ({ ...m, [id]: side === "debit" ? { debit: value, credit: value ? "" : (m[id]?.credit ?? "") } : { credit: value, debit: value ? "" : (m[id]?.debit ?? "") } }));

  const suggest = async () => {
    const out = await run("suggest", () => bos.openingBalances(booksStart), { refresh: false });
    if (!out?.suggestion) return;
    setAmounts(toAmounts(out.suggestion));
    show(
      out.suggestion.length
        ? { tone: "emerald", title: "Filled from BOS records", description: `Balances from everything dated before ${dateLabel(booksStart)} — review and save.` }
        : { tone: "blue", title: "No BOS records before this date", description: "Enter the balances from your previous books." },
    );
  };
  const save = () => run("opening", () => bos.saveOpening({ booksStart, lines }), { success: "Opening balances saved", description: `Books start ${dateLabel(booksStart)}` });

  const columns: BosColumn<Acct>[] = [
    { key: "code", header: "Code", mono: true, width: 80, cell: (a) => a.code },
    { key: "account", header: "Account", cell: (a) => <span style={{ fontWeight: 600 }}>{a.name}</span> },
    { key: "type", header: "Type", cell: (a) => <StatusBadge view={accountTypeBadge(a.type)} /> },
    {
      key: "debit",
      header: "Debit (₹)",
      align: "right",
      cell: (a) => (
        <Input size="sm" aria-label={`${accountLabel(a)} opening debit`} type="number" inputMode="decimal" min={0} step="0.01" value={amounts[a.id]?.debit ?? ""} onChange={(e) => setAmount(a.id, "debit", e.target.value)} style={{ width: 130 }} />
      ),
    },
    {
      key: "credit",
      header: "Credit (₹)",
      align: "right",
      cell: (a) => (
        <Input size="sm" aria-label={`${accountLabel(a)} opening credit`} type="number" inputMode="decimal" min={0} step="0.01" value={amounts[a.id]?.credit ?? ""} onChange={(e) => setAmount(a.id, "credit", e.target.value)} style={{ width: 130 }} />
      ),
    },
  ];

  return (
    <Stack gap={12}>
      <p className="bos-text-faint" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
        Opening balances are what each account held at the close of the day before the books start. BOS records dated earlier are left out of the ledger — their effect is in these balances. &ldquo;Fill from BOS records&rdquo; works them
        out from everything already in BOS; add anything kept outside BOS (capital, loans, older balances) before saving.
      </p>
      <ModuleToolbar>
        <label className="bos-row" style={{ gap: 8, alignItems: "center", fontSize: 12.5 }}>
          Books start
          <Input size="sm" type="date" required max={data.today} value={booksStart} onChange={(e) => e.target.value && setBooksStart(e.target.value)} style={{ width: "auto" }} />
        </label>
        <Button size="sm" icon="refresh" disabled={busy === "suggest"} onClick={suggest}>
          Fill from BOS records
        </Button>
        <span className="bos-spacer" />
        <Segmented<"balance" | "all">
          role="radio"
          size="sm"
          aria-label="Accounts to show"
          options={[
            { value: "balance", label: "Balance-sheet accounts" },
            { value: "all", label: "All accounts" },
          ]}
          value={scope}
          onChange={setScope}
        />
      </ModuleToolbar>
      <DataTable caption="Opening balances" columns={columns} rows={shown} rowKey={(a) => a.id} compact />
      <div className="bos-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="bos-journal-totals" style={{ justifyContent: "flex-start", marginTop: 0 }} aria-live="polite">
          <span>Debits {inr(debit)}</span>
          <span>Credits {inr(credit)}</span>
          <span className={Math.abs(difference) >= 0.5 ? "is-off" : undefined}>{Math.abs(difference) >= 0.5 ? `Off by ${inr(Math.abs(difference))} — goes to Opening balance adjustment` : "Balanced"}</span>
        </div>
        <div className="bos-app-actions">
          <Button size="sm" variant="ghost" disabled={!lines.length} onClick={() => setAmounts({})}>
            Clear all
          </Button>
          <Button size="sm" variant="primary" disabled={busy === "opening" || !booksStart || booksStart > data.today} onClick={save}>
            {busy === "opening" ? "Saving…" : "Save opening balances"}
          </Button>
        </div>
      </div>
    </Stack>
  );
}
