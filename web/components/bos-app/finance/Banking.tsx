"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  useToast,
  WidgetCard,
  WidgetRow,
  type BosColumn,
  type BosPastel,
} from "@/components/bos";
import { bos, type BankAccountInput, type BankCandidate, type BankReconcileInput, type BosBankAccount, type BosBankTxn } from "@/lib/bos-app/api";
import { bankTxnBadge, dateLabel, inr, inrCompact, todayLocal } from "@/lib/bos-app/format";
import { findHeaderRow, guessMapping, mappingReady, parseCsv, toStatementLines, type StatementMapping } from "@/lib/bos-app/statement";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

const PAGE = 50;
const MAX_LINES = 5000;
const DOTS: ReadonlyArray<BosPastel> = ["blue", "mint", "lavender", "sage", "rose"];
const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;
const signed = (n: number) => (n < 0 ? `−${inr(-n)}` : inr(n));

const reconcileInputOf = (c: BankCandidate, note?: string | null): BankReconcileInput =>
  c.action === "match" ? { action: "match", type: c.type as Exclude<BankCandidate["type"], "invoice">, id: c.id, note } : { action: "settle", type: c.type as Exclude<BankCandidate["type"], "payment">, id: c.id, note };

const actionLabel = (c: BankCandidate) =>
  c.action === "match" ? "Match" : c.type === "invoice" ? (c.exact ? "Record payment" : "Record part-payment") : c.type === "bill" ? "Pay bill" : c.type === "expense" ? "Reimburse" : "Mark salaries paid";

/** Finance → Banking: bank & cash accounts, statement import and reconciliation. Managers only. */
export function Banking() {
  const { canManage, takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("banking"));
  const [accountId, setAccountId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  if (!canManage) return <ManagersOnly>Bank accounts, statements and reconciliation are limited to owners and admins.</ManagersOnly>;
  return accountId ? <AccountView id={accountId} onBack={() => setAccountId(null)} /> : <BankingHome onOpen={setAccountId} />;
}

/* ---------- Accounts overview ---------- */

function BankingHome({ onOpen }: { onOpen: (id: string) => void }) {
  const { run, busy } = useBosAction();
  const [adding, setAdding] = useState(false);
  const state = useBosData(() => bos.bankingOverview(), []);
  return (
    <Loaded state={state}>
      {({ accounts, totals }) => {
        const active = accounts.filter((a) => !a.archived);
        const archived = accounts.filter((a) => a.archived);
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Bank balance" value={inrCompact(totals.bank)} chip={{ color: "blue", glyph: "🏦" }} delta={plural(active.filter((a) => a.kind === "bank").length, "account")} deltaTone="muted" />
              <KpiCard label="Cash in hand" value={inrCompact(totals.cash)} chip={{ color: "mint", glyph: "₹" }} delta="Cash book" deltaTone="muted" />
              <KpiCard label="Money in · this month" value={inrCompact(totals.moneyIn)} chip={{ color: "lavender", glyph: "↓" }} delta={`Out ${inrCompact(totals.moneyOut)}`} deltaTone="muted" />
              <KpiCard label="To reconcile" value={totals.unreconciled.toLocaleString("en-IN")} chip={{ color: "rose", glyph: "⇄" }} delta={totals.unreconciled ? "Statement lines not yet matched" : "All caught up"} deltaTone={totals.unreconciled ? "warn" : "up"} />
            </Grid>
            {!active.length ? (
              <Alert
                tone="blue"
                title="Add your first bank or cash account"
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                    Add account
                  </Button>
                }
              >
                Enter the balance on a start date, then import your bank&apos;s CSV statement. BOS suggests the invoice, bill, expense claim or payroll run behind each line, so reconciling is mostly one click. Nothing is connected to your bank — you stay in control of what&apos;s imported.
              </Alert>
            ) : null}
            {active.length ? (
              <>
                <ModuleToolbar>
                  <span className="bos-kpi-label">Accounts</span>
                  <span className="bos-spacer" />
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                    Add account
                  </Button>
                </ModuleToolbar>
                <Grid cols={3} min={240}>
                  {active.map((a, i) => (
                    <AccountCard key={a.id} account={a} dot={DOTS[i % DOTS.length]} onOpen={() => onOpen(a.id)} />
                  ))}
                </Grid>
              </>
            ) : null}
            {archived.length ? (
              <WidgetCard title="🗄️ Archived accounts" dot="sage" style={{ maxWidth: 760 }}>
                {archived.map((a) => (
                  <WidgetRow
                    key={a.id}
                    label={`${a.name} · ${inr(a.balance)}`}
                    value={busy === `restore-${a.id}` ? "Restoring…" : "Restore"}
                    valueTone="blue"
                    onClick={() => run(`restore-${a.id}`, () => bos.updateBankAccount(a.id, { archived: false }), { success: "Account restored", description: a.name })}
                  />
                ))}
              </WidgetCard>
            ) : null}
            <AccountDialog open={adding} account={null} onClose={() => setAdding(false)} onSaved={(a) => onOpen(a.id)} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

function AccountCard({ account: a, dot, onOpen }: { account: BosBankAccount; dot: BosPastel; onOpen: () => void }) {
  const diff = a.statementBalance === null ? null : Math.round((a.balance - a.statementBalance) * 100) / 100;
  return (
    <WidgetCard title={`${a.kind === "cash" ? "💵" : "🏦"} ${a.name}`} dot={dot}>
      <WidgetRow label={a.kind === "cash" ? "Cash balance" : [a.bankName, a.accountLast4 && `••${a.accountLast4}`].filter(Boolean).join(" · ") || "Book balance"} value={inr(a.balance)} />
      {a.kind === "bank" ? (
        <WidgetRow
          label={a.statementDate ? `Statement · ${dateLabel(a.statementDate)}` : "Statement"}
          value={a.statementBalance === null ? "Not imported" : diff ? `Differs ${signed(diff)}` : "Matches ✓"}
          valueTone={a.statementBalance === null ? "faint" : diff ? "amber" : "emerald"}
        />
      ) : null}
      <WidgetRow label="To reconcile" value={a.unreconciled} valueTone={a.unreconciled ? "coral" : "faint"} />
      <WidgetRow label={a.lastTxnDate ? `Last line ${dateLabel(a.lastTxnDate)}` : "No lines yet"} value="Open" valueTone="blue" chevron onClick={onOpen} />
    </WidgetCard>
  );
}

function AccountDialog({ open, account, onClose, onSaved }: { open: boolean; account: BosBankAccount | null; onClose: () => void; onSaved?: (a: BosBankAccount) => void }) {
  const { run, busy } = useBosAction();
  const init = () => ({
    name: account?.name ?? "",
    kind: account?.kind ?? ("bank" as BosBankAccount["kind"]),
    bankName: account?.bankName ?? "",
    accountLast4: account?.accountLast4 ?? "",
    ifsc: account?.ifsc ?? "",
    openingBalance: account ? String(account.openingBalance) : "",
    openingDate: account?.openingDate ?? `${todayLocal().slice(0, 7)}-01`,
  });
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (open) setValues(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refill each time the dialog opens
  }, [open, account?.id]);
  const v = f.values;
  const bank = v.kind === "bank";
  const submit = async () => {
    const input: BankAccountInput = {
      name: v.name.trim(),
      kind: v.kind,
      bankName: bank ? v.bankName.trim() || null : null,
      accountLast4: bank ? v.accountLast4.trim() || null : null,
      ifsc: bank ? v.ifsc.trim().toUpperCase() || null : null,
      openingBalance: Number(v.openingBalance) || 0,
      openingDate: v.openingDate,
    };
    const out = await run("account", () => (account ? bos.updateBankAccount(account.id, input) : bos.createBankAccount(input)), { success: account ? "Account updated" : "Account added", description: input.name });
    if (!out) return;
    onClose();
    onSaved?.(out.account);
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={account ? `Edit ${account.name}` : "Add an account"}
      description="The opening balance is what the account held at the start of the opening date. Statement lines before that date are skipped on import."
      icon={{ tone: "blue", name: "wallet" }}
      submitLabel={account ? "Save" : "Add account"}
      busy={busy === "account"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Account name">{({ id }) => <Input id={id} required maxLength={120} value={v.name} placeholder={bank ? "e.g. HDFC Current" : "e.g. Office cash"} onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.kind} disabled={Boolean(account?.txnCount)} onChange={(e) => f.set("kind")(e.target.value as BosBankAccount["kind"])}>
              <option value="bank">Bank account</option>
              <option value="cash">Cash book</option>
            </Select>
          )}
        </Field>
        {bank ? (
          <>
            <Field label="Bank">{({ id }) => <Input id={id} maxLength={120} value={v.bankName} placeholder="e.g. HDFC Bank" onChange={(e) => f.set("bankName")(e.target.value)} />}</Field>
            <Field label="Last 4 digits of the account number" hint="BOS doesn't store the full number">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} inputMode="numeric" maxLength={4} pattern="\d{4}" value={v.accountLast4} onChange={(e) => f.set("accountLast4")(e.target.value.replace(/\D/g, ""))} />}
            </Field>
            <Field label="IFSC">{({ id }) => <Input id={id} maxLength={11} value={v.ifsc} placeholder="HDFC0001234" onChange={(e) => f.set("ifsc")(e.target.value.toUpperCase())} />}</Field>
          </>
        ) : null}
        <Field label="Opening balance (₹)">
          {({ id }) => <Input id={id} type="number" step="0.01" inputMode="decimal" value={v.openingBalance} placeholder="0" onChange={(e) => f.set("openingBalance")(e.target.value)} />}
        </Field>
        <Field label="Opening date">{({ id }) => <Input id={id} type="date" required value={v.openingDate} max={todayLocal()} onChange={(e) => f.set("openingDate")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- One account ---------- */

type Filter = "open" | "all" | "done" | "excluded";

function AccountView({ id, onBack }: { id: string; onBack: () => void }) {
  const { run, busy } = useBosAction();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<"edit" | "import" | "entry" | "archive" | "delete" | null>(null);
  const [reconciling, setReconciling] = useState<BosBankTxn | null>(null);
  const [undoing, setUndoing] = useState<BosBankTxn | null>(null);
  const state = useBosData(() => bos.bankAccount(id), [id]);

  return (
    <Loaded state={state} rows={2}>
      {({ account: a, transactions, categories, truncated }) => {
        const q = query.trim().toLowerCase();
        const matches = (t: BosBankTxn) => !q || `${t.description} ${t.reference ?? ""} ${t.matchLabel ?? ""} ${t.category ?? ""} ${Math.abs(t.amount)}`.toLowerCase().includes(q);
        const inFilter = (t: BosBankTxn) => (filter === "open" ? t.status === "unmatched" : filter === "done" ? t.status === "matched" || t.status === "categorized" : filter === "excluded" ? t.status === "excluded" : true);
        const rows = transactions.filter((t) => inFilter(t) && matches(t));
        const pages = Math.max(1, Math.ceil(rows.length / PAGE));
        const current = Math.min(page, pages - 1);
        const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
        const open = transactions.filter((t) => t.status === "unmatched");
        const suggested = open.filter((t) => t.suggestion).length;
        const diff = a.statementBalance === null ? null : Math.round((a.balance - a.statementBalance) * 100) / 100;
        const reconciledPct = transactions.length ? Math.round(((transactions.length - open.length) / transactions.length) * 100) : 100;
        const accept = (t: BosBankTxn) =>
          t.suggestion && run(`accept-${t.id}`, () => bos.reconcileBankTxn(t.id, reconcileInputOf(t.suggestion!)), { success: t.suggestion.action === "match" ? "Matched" : "Recorded and matched", description: t.suggestion.label });

        const columns: BosColumn<BosBankTxn>[] = [
          { key: "date", header: "Date", mono: true, cell: (t) => dateLabel(t.date) },
          {
            key: "description",
            header: "Description",
            cell: (t) => (
              <span style={{ display: "block", maxWidth: 360, overflowWrap: "anywhere" }}>
                {t.description}
                {t.reference ? <span className="bos-text-faint"> · {t.reference}</span> : null}
                {t.source === "manual" ? <span className="bos-text-faint"> · manual</span> : null}
              </span>
            ),
          },
          { key: "in", header: "Money in", align: "right", mono: true, cell: (t) => (t.amount > 0 ? <span style={{ color: "var(--bos-emerald-600)" }}>{inr(t.amount)}</span> : "") },
          { key: "out", header: "Money out", align: "right", mono: true, cell: (t) => (t.amount < 0 ? inr(-t.amount) : "") },
          { key: "balance", header: "Balance", align: "right", mono: true, cell: (t) => (t.statementBalance === null ? "" : inr(t.statementBalance)) },
          {
            key: "status",
            header: "Reconciliation",
            cell: (t) => (
              <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                <StatusBadge view={bankTxnBadge(t.status)} />
                {t.status === "matched" && t.matchLabel ? <span className="bos-text-faint" style={{ fontSize: 11.5 }}>{t.matchLabel}</span> : null}
                {t.status === "categorized" ? <span className="bos-text-faint" style={{ fontSize: 11.5 }}>{t.category}</span> : null}
                {t.status === "unmatched" && t.suggestion ? (
                  <span style={{ fontSize: 11.5, color: "var(--bos-blue-600)" }}>
                    Suggested: {t.suggestion.label}
                    {t.suggestion.action === "settle" ? ` (${actionLabel(t.suggestion).toLowerCase()})` : ""}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            cell: (t) => (
              <span className="bos-row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                {t.status === "unmatched" && t.suggestion ? (
                  <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => accept(t)}>
                    {busy === `accept-${t.id}` ? "…" : "Accept"}
                  </Button>
                ) : null}
                {t.status === "unmatched" ? (
                  <Button size="sm" variant={t.suggestion ? "ghost" : undefined} onClick={() => setReconciling(t)}>
                    Reconcile
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setUndoing(t)}>
                    Undo
                  </Button>
                )}
              </span>
            ),
          },
        ];

        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to banking
              </button>
              <div className="bos-app-actions">
                {a.archived ? (
                  <Button size="sm" onClick={() => run("restore", () => bos.updateBankAccount(a.id, { archived: false }), { success: "Account restored", description: a.name })}>
                    Restore account
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDialog(a.txnCount ? "archive" : "delete")}>
                      {a.txnCount ? "Archive" : "Delete"}
                    </Button>
                    <Button size="sm" icon="edit" onClick={() => setDialog("edit")}>
                      Edit
                    </Button>
                    <Button size="sm" icon="plus" onClick={() => setDialog("entry")}>
                      Add entry
                    </Button>
                    {a.kind === "bank" ? (
                      <Button size="sm" variant="primary" icon="download" onClick={() => setDialog("import")}>
                        Import statement
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <Stack>
              <Grid cols={4} min={140}>
                <KpiCard label={a.kind === "cash" ? "Cash balance" : "Book balance"} value={inr(a.balance)} chip={{ color: "blue", glyph: a.kind === "cash" ? "₹" : "🏦" }} delta={`Opening ${inr(a.openingBalance)} on ${dateLabel(a.openingDate)}`} deltaTone="muted" interactive={false} />
                <KpiCard
                  label="Statement balance"
                  value={a.statementBalance === null ? "—" : inr(a.statementBalance)}
                  chip={{ color: "lavender", glyph: "📄" }}
                  delta={a.statementBalance === null ? (a.kind === "cash" ? "Cash book has no statement" : "Import a statement with a balance column") : diff ? `Book differs by ${signed(diff)}` : `Matches · ${dateLabel(a.statementDate)}`}
                  deltaTone={a.statementBalance === null ? "muted" : diff ? "warn" : "up"}
                  interactive={false}
                />
                <KpiCard label="To reconcile" value={open.length.toLocaleString("en-IN")} chip={{ color: "rose", glyph: "⇄" }} delta={suggested ? `${suggested} with a suggestion` : open.length ? "Reconcile line by line" : "All caught up"} deltaTone={open.length ? "warn" : "up"} interactive={false} />
                <KpiCard label="Reconciled" value={`${reconciledPct}%`} valueTone={reconciledPct === 100 ? "emerald" : undefined} chip={{ color: "mint", glyph: "✓" }} delta={plural(transactions.length, "line")} deltaTone="muted" interactive={false} />
              </Grid>
              {diff ? (
                <Alert tone="amber" title="Book balance and statement balance differ">
                  {`The statement shows ${inr(a.statementBalance!)} on ${dateLabel(a.statementDate)} but the book balance is ${inr(a.balance)}. Check the opening balance and date, entries added by hand, or lines missing from the import.`}
                </Alert>
              ) : null}
              <div>
                <ModuleToolbar>
                  <Segmented<Filter>
                    role="radio"
                    size="sm"
                    aria-label="Show lines"
                    options={[
                      { value: "open", label: `To reconcile (${open.length})` },
                      { value: "done", label: "Reconciled" },
                      { value: "excluded", label: "Excluded" },
                      { value: "all", label: "All" },
                    ]}
                    value={filter}
                    onChange={(f) => {
                      setFilter(f);
                      setPage(0);
                    }}
                  />
                  <span className="bos-spacer" />
                  <SearchInput
                    placeholder="Search narration, reference, amount…"
                    aria-label="Search statement lines"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </ModuleToolbar>
                <div style={{ marginTop: 12 }}>
                  <DataTable
                    caption={`Statement lines, ${a.name}`}
                    columns={columns}
                    rows={shown}
                    rowKey={(t) => t.id}
                    onRowClick={(t) => (t.status === "unmatched" ? setReconciling(t) : setUndoing(t))}
                    empty={transactions.length ? (filter === "open" && !q ? "Everything is reconciled. 🎉" : "No lines match.") : a.kind === "bank" ? "No statement lines yet — import your bank's CSV statement." : "No entries yet — add cash in and out as it happens."}
                    compact
                  />
                  <Pagination
                    actions={
                      pages > 1 ? (
                        <>
                          <Button size="sm" variant="ghost" icon="chevronLeft" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" />
                          <span className="bos-text-faint" style={{ fontSize: 12 }}>
                            {current + 1} / {pages}
                          </span>
                          <Button size="sm" variant="ghost" icon="chevronRight" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page" />
                        </>
                      ) : undefined
                    }
                  >
                    {plural(rows.length, "line")}
                    {truncated ? " · showing the latest 2,000" : ""}
                  </Pagination>
                </div>
              </div>
            </Stack>
            <AccountDialog open={dialog === "edit"} account={a} onClose={() => setDialog(null)} />
            {dialog === "import" ? <ImportDialog open account={a} onClose={() => setDialog(null)} /> : null}
            <EntryDialog open={dialog === "entry"} account={a} onClose={() => setDialog(null)} />
            <ReconcileDialog key={reconciling?.id ?? "none"} txn={reconciling} categories={categories} onClose={() => setReconciling(null)} />
            <ConfirmDialog
              open={undoing !== null}
              onClose={() => setUndoing(null)}
              title="Undo this reconciliation?"
              description={
                undoing?.status === "matched" && undoing.matchLabel
                  ? `The line goes back to "To reconcile". ${undoing.matchLabel} stays as it is — if it was recorded from this line by mistake, reverse it in its own module.`
                  : 'The line goes back to "To reconcile".'
              }
              confirmLabel="Undo"
              busy={busy === "undo"}
              onConfirm={async () => {
                const t = undoing;
                if (!t) return;
                await run("undo", () => bos.unreconcileBankTxn(t.id), { success: "Reconciliation undone", tone: "amber" });
                setUndoing(null);
              }}
            />
            <ConfirmDialog
              open={dialog === "archive"}
              onClose={() => setDialog(null)}
              title={`Archive ${a.name}?`}
              description="It disappears from the totals and can't take new lines. Its history stays and you can restore it any time."
              confirmLabel="Archive"
              busy={busy === "archive"}
              onConfirm={async () => {
                const ok = await run("archive", () => bos.updateBankAccount(a.id, { archived: true }), { success: "Account archived", description: a.name });
                setDialog(null);
                if (ok) onBack();
              }}
            />
            <ConfirmDialog
              open={dialog === "delete"}
              onClose={() => setDialog(null)}
              destructive
              title={`Delete ${a.name}?`}
              description="The account has no lines yet, so nothing else is affected."
              confirmLabel="Delete"
              busy={busy === "delete"}
              onConfirm={async () => {
                const ok = await run("delete", () => bos.deleteBankAccount(a.id), { success: "Account deleted", description: a.name });
                setDialog(null);
                if (ok !== undefined) onBack();
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- Manual entry ---------- */

function EntryDialog({ open, account, onClose }: { open: boolean; account: BosBankAccount; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const init = () => ({ date: todayLocal(), direction: "out", amount: "", description: "", reference: "" });
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (open) setValues(init());
  }, [open, setValues]);
  const v = f.values;
  const submit = async () => {
    const amount = Math.abs(Number(v.amount) || 0);
    const ok = await run(
      "entry",
      () => bos.addBankEntry(account.id, { date: v.date, description: v.description.trim(), reference: v.reference.trim() || null, amount: v.direction === "in" ? amount : -amount }),
      { success: "Entry added", description: `${v.direction === "in" ? "In" : "Out"} ${inr(amount)} · ${account.name}` },
    );
    if (ok) onClose();
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`Add an entry · ${account.name}`}
      description={account.kind === "cash" ? "Record cash coming in or going out. Reconcile it to an invoice, bill or claim afterwards." : "For a transaction that isn't in an imported statement yet."}
      icon={{ tone: "emerald", name: "plus" }}
      submitLabel="Add entry"
      busy={busy === "entry"}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label="Date">{({ id }) => <Input id={id} type="date" required min={account.openingDate} max={todayLocal()} value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        <Field label="Direction">
          {({ id }) => (
            <Select id={id} value={v.direction} onChange={(e) => f.set("direction")(e.target.value)}>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)">{({ id }) => <Input id={id} type="number" required min={0.01} step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => f.set("amount")(e.target.value)} />}</Field>
        <Field label="Reference">{({ id }) => <Input id={id} maxLength={120} value={v.reference} placeholder="Optional" onChange={(e) => f.set("reference")(e.target.value)} />}</Field>
        <Field label="Description" full>
          {({ id }) => <Input id={id} required maxLength={300} value={v.description} placeholder="e.g. Petty cash — courier" onChange={(e) => f.set("description")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Statement import ---------- */

type Picked = { fileName: string; rows: string[][]; header: number };

function ColumnSelect({ label, header, value, onChange, optional }: { label: string; header: ReadonlyArray<string>; value: number; onChange: (i: number) => void; optional?: boolean }) {
  return (
    <Field label={label}>
      {({ id }) => (
        <Select id={id} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
          <option value="-1">{optional ? "— none —" : "Choose a column"}</option>
          {header.map((h, i) => (
            <option key={i} value={String(i)}>
              {h || `Column ${i + 1}`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function ImportDialog({ open, account, onClose }: { open: boolean; account: BosBankAccount; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const { show } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setProblem(null);
    if (!/\.(csv|txt)$/i.test(f.name) && f.type !== "text/csv") {
      setProblem("Choose a CSV file. In your bank's net banking, download the statement as CSV (or open the Excel file and save it as CSV).");
      return;
    }
    const rows = parseCsv(await f.text());
    const header = findHeaderRow(rows);
    if (header < 0) {
      setPicked(null);
      setProblem("Couldn't find the column headings (a date column and withdrawal/deposit or amount columns). Make sure this is the statement CSV from your bank.");
      return;
    }
    setPicked({ fileName: f.name, rows, header });
    setMapping(guessMapping(rows[header]));
  };

  const parsed = useMemo(() => (picked && mapping && mappingReady(mapping) ? toStatementLines(picked.rows, picked.header, mapping) : null), [picked, mapping]);
  const lines = parsed?.lines ?? [];
  const before = lines.filter((l) => l.date < account.openingDate).length;
  const moneyIn = lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0);
  const moneyOut = lines.reduce((s, l) => s + (l.amount < 0 ? -l.amount : 0), 0);
  const header = picked ? picked.rows[picked.header] : [];
  const split = mapping ? mapping.amount < 0 : true;
  const setCol = (key: keyof StatementMapping) => (i: number) => setMapping((m) => (m ? { ...m, [key]: i } : m));

  const submit = async () => {
    if (!lines.length) return;
    const out = await run("import", () => bos.importStatement(account.id, lines));
    if (!out) return;
    const notes = [out.skipped && `${plural(out.skipped, "line")} already imported`, out.beforeOpening && `${plural(out.beforeOpening, "line")} before the opening date`].filter(Boolean).join(" · ");
    show({ tone: out.imported ? "emerald" : "amber", title: out.imported ? `Imported ${plural(out.imported, "line")}` : "Nothing new to import", description: notes || undefined });
    onClose();
  };

  const preview: BosColumn<(typeof lines)[number]>[] = [
    { key: "date", header: "Date", mono: true, cell: (l) => dateLabel(l.date) },
    { key: "description", header: "Description", cell: (l) => <span style={{ display: "block", maxWidth: 280, overflowWrap: "anywhere" }}>{l.description}</span> },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (l) => signed(l.amount) },
    { key: "balance", header: "Balance", align: "right", mono: true, cell: (l) => (l.balance === null ? "" : inr(l.balance)) },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Import a statement · ${account.name}`}
      description="Upload the CSV statement from your net banking. Lines already imported are skipped, so overlapping statements are safe."
      icon={{ tone: "blue", name: "download" }}
      wide
      actionsNote={parsed ? `${plural(lines.length, "line")} ready${parsed.skipped ? ` · ${parsed.skipped} rows without a date or amount skipped` : ""}` : undefined}
      actions={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!lines.length || lines.length > MAX_LINES || busy === "import"} onClick={submit}>
            {busy === "import" ? "Importing…" : lines.length ? `Import ${plural(lines.length, "line")}` : "Import"}
          </Button>
        </>
      }
    >
      <Stack gap={14}>
        <div className="bos-row" style={{ gap: 10, flexWrap: "wrap" }}>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv,.txt"
            hidden
            aria-label="Statement CSV file"
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button size="sm" icon="file" onClick={() => file.current?.click()}>
            {picked ? "Choose another file" : "Choose CSV file"}
          </Button>
          {picked ? <span className="bos-text-faint" style={{ fontSize: 12.5 }}>{picked.fileName}</span> : null}
        </div>
        {problem ? (
          <Alert tone="coral" title="Can't read this file">
            {problem}
          </Alert>
        ) : null}
        {picked && mapping ? (
          <>
            <FormGrid>
              <ColumnSelect label="Date" header={header} value={mapping.date} onChange={setCol("date")} />
              <ColumnSelect label="Narration / description" header={header} value={mapping.description} onChange={setCol("description")} />
              <Field label="Amounts are in">
                {({ id }) => (
                  <Select
                    id={id}
                    value={split ? "split" : "single"}
                    onChange={(e) => setMapping((m) => (m ? (e.target.value === "split" ? { ...m, amount: -1, drCr: -1 } : { ...m, debit: -1, credit: -1, amount: m.amount >= 0 ? m.amount : m.debit }) : m))}
                  >
                    <option value="split">Separate withdrawal and deposit columns</option>
                    <option value="single">One amount column</option>
                  </Select>
                )}
              </Field>
              {split ? (
                <>
                  <ColumnSelect label="Withdrawal (money out)" header={header} value={mapping.debit} onChange={setCol("debit")} />
                  <ColumnSelect label="Deposit (money in)" header={header} value={mapping.credit} onChange={setCol("credit")} />
                </>
              ) : (
                <>
                  <ColumnSelect label="Amount" header={header} value={mapping.amount} onChange={setCol("amount")} />
                  <ColumnSelect label="Dr / Cr indicator" header={header} value={mapping.drCr} onChange={setCol("drCr")} optional />
                </>
              )}
              <ColumnSelect label="Reference / cheque no." header={header} value={mapping.reference} onChange={setCol("reference")} optional />
              <ColumnSelect label="Closing balance" header={header} value={mapping.balance} onChange={setCol("balance")} optional />
            </FormGrid>
            {!mappingReady(mapping) ? (
              <Alert tone="amber" title="Choose the columns">
                Pick the date, narration and amount columns to see a preview.
              </Alert>
            ) : lines.length > MAX_LINES ? (
              <Alert tone="amber" title="Statement is too long">
                {`This file has ${plural(lines.length, "line")}. Import up to ${MAX_LINES.toLocaleString("en-IN")} at a time — download a shorter period from your bank.`}
              </Alert>
            ) : lines.length ? (
              <>
                <Grid cols={3} min={140}>
                  <KpiCard label="Period" value={`${dateLabel(lines[0].date)} – ${dateLabel(lines[lines.length - 1].date)}`} chip={{ color: "blue", glyph: "📅" }} delta={parsed?.reversed ? "Newest-first file, put in date order" : plural(lines.length, "line")} deltaTone="muted" interactive={false} />
                  <KpiCard label="Money in" value={inr(moneyIn)} chip={{ color: "mint", glyph: "↓" }} delta={`${lines.filter((l) => l.amount > 0).length} credits`} deltaTone="muted" interactive={false} />
                  <KpiCard label="Money out" value={inr(moneyOut)} chip={{ color: "rose", glyph: "↑" }} delta={`${lines.filter((l) => l.amount < 0).length} debits`} deltaTone="muted" interactive={false} />
                </Grid>
                {before ? (
                  <Alert tone="amber" title={`${plural(before, "line")} before the opening date`}>
                    {`They're dated before ${dateLabel(account.openingDate)}, which the opening balance already covers, so they'll be skipped. Edit the account to move the opening date if needed.`}
                  </Alert>
                ) : null}
                <DataTable caption="Statement preview" columns={preview} rows={lines.slice(0, 6)} rowKey={(l) => `${l.date}-${l.description}-${l.amount}-${l.balance}`} compact />
              </>
            ) : (
              <Alert tone="amber" title="No lines found">
                No rows have both a date and an amount with these columns. Check the column choices above.
              </Alert>
            )}
          </>
        ) : !problem ? (
          <PlainNote>
            Supported: HDFC, SBI, ICICI, Axis, Kotak and most other banks&apos; CSV exports — separate withdrawal/deposit columns or one amount column with Dr/Cr. Dates like 01/10/2026, 01-Oct-2026 or 2026-10-01.
          </PlainNote>
        ) : null}
      </Stack>
    </Dialog>
  );
}

const PlainNote = ({ children }: { children: ReactNode }) => (
  <div className="bos-text-faint" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
    {children}
  </div>
);

/* ---------- Reconcile one line ---------- */

function ReconcileDialog({ txn, categories, onClose }: { txn: BosBankTxn | null; categories: ReadonlyArray<string>; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = useBosData(() => (txn ? bos.bankCandidates(txn.id) : Promise.resolve(null)), [txn?.id]);
  if (!txn) return null;
  const credit = txn.amount > 0;
  const act = async (key: string, input: BankReconcileInput, success: string, description?: string) => {
    const ok = await run(key, () => bos.reconcileBankTxn(txn.id, input), { success, description });
    if (ok) onClose();
  };
  const candidates = state.data?.candidates ?? [];
  return (
    <>
      <Dialog
        open={!confirmDelete}
        onClose={onClose}
        title={`${credit ? "Money in" : "Money out"} · ${inr(Math.abs(txn.amount))}`}
        description={`${dateLabel(txn.date)} · ${txn.description}${txn.reference ? ` · ${txn.reference}` : ""}`}
        icon={{ tone: credit ? "emerald" : "coral", name: "refresh" }}
        wide
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete line
            </Button>
            <span className="bos-spacer" />
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        <Stack gap={16}>
          <div>
            <div className="bos-kpi-label" style={{ marginBottom: 8 }}>
              {credit ? "Invoice payments and open invoices" : "Bills, expense claims and payroll"}
            </div>
            {state.data === null && !state.error ? (
              <PlainNote>Looking for matches…</PlainNote>
            ) : candidates.length ? (
              <div className="bos-bank-candidates">
                {candidates.map((c) => (
                  <div key={`${c.type}-${c.id}`} className="bos-bank-candidate">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.label}</div>
                      <div className="bos-text-faint" style={{ fontSize: 12 }}>
                        {c.detail}
                      </div>
                    </div>
                    <span className="bos-mono" style={{ fontSize: 12.5 }}>
                      {inr(c.amount)}
                    </span>
                    <Button size="sm" variant={c === candidates[0] ? "primary" : undefined} disabled={busy !== null} onClick={() => act(`c-${c.id}`, reconcileInputOf(c, note.trim() || null), c.action === "match" ? "Matched" : "Recorded and matched", c.label)}>
                      {busy === `c-${c.id}` ? "Saving…" : actionLabel(c)}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <Alert tone="blue" title="No matching record">
                {`Nothing in BOS ${credit ? "received" : "paid"} ${inr(Math.abs(txn.amount))} around ${dateLabel(txn.date)}. Categorise the line below, or record the ${credit ? "invoice payment" : "bill or claim"} first and come back.`}
              </Alert>
            )}
            {candidates.some((c) => c.action === "settle") ? (
              <PlainNote>
                <span style={{ display: "block", marginTop: 8 }}>
                  &ldquo;Record payment&rdquo;, &ldquo;Pay bill&rdquo;, &ldquo;Reimburse&rdquo; and &ldquo;Mark salaries paid&rdquo; update that record too, dated {dateLabel(txn.date)}.
                </span>
              </PlainNote>
            ) : null}
          </div>
          <div>
            <div className="bos-kpi-label" style={{ marginBottom: 8 }}>
              Or categorise
            </div>
            <div className="bos-row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px" }}>
                <Field label="Category">
                  {({ id }) => (
                    <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">Choose…</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Button size="sm" disabled={!category || busy !== null} onClick={() => act("categorize", { action: "categorize", category, note: note.trim() || null }, "Categorised", category)}>
                {busy === "categorize" ? "Saving…" : "Categorise"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("exclude", { action: "exclude", note: note.trim() || null }, "Excluded from reconciliation")}>
                Exclude
              </Button>
            </div>
            <PlainNote>
              <span style={{ display: "block", marginTop: 6 }}>Exclude duplicates and reversed entries. Categorised lines are for reconciliation only — they don&apos;t change profit &amp; loss.</span>
            </PlainNote>
          </div>
          <Field label="Note" hint="Optional, saved with the reconciliation">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </Stack>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title="Delete this statement line?"
        description="It's removed from the account and the balance. Importing the same statement again would bring it back."
        confirmLabel="Delete"
        busy={busy === "delete-line"}
        onConfirm={async () => {
          const ok = await run("delete-line", () => bos.deleteBankTxn(txn.id), { success: "Line deleted" });
          setConfirmDelete(false);
          if (ok !== undefined) onClose();
        }}
      />
    </>
  );
}
