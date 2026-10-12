"use client";

import "./finance.css";
import { useMemo, useState } from "react";
import { Badge, Button, Card, DataTable, Dialog, EmptyState, Field, FormGrid, Grid, Input, KpiCard, SearchInput, Segmented, Select, Textarea, type BosColumn } from "@/components/bos";
import { finance, LEDGER_CATEGORY_LABEL, methodLabel, reminderLink, type LedgerData, type LedgerEntry, type LedgerEntryCategory, type PartyBalance, type PayMethod } from "@/lib/ims/finance";
import { dateLabel, downloadCsv, inrCompact, inrExact, num, round2, stampLabel } from "@/lib/ims/format";
import { Loaded, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData } from "../core";
import { PartySelect } from "../shared/pickers";
import { ConfirmDialog, KeyValues, MethodSelect, PeriodSelect, QuickChips, sellerOf, type PeriodOrAll } from "./shared";
import { balanceText, StatementDialog } from "./Statement";

type TypeFilter = "all" | "credit" | "debit";
type StatusFilter = "pending" | "settled" | "all";
type PartyFilter = "all" | "receivable" | "payable";
type Dlg = null | { kind: "add"; type: "credit" | "debit"; party?: { id: string | null; name: string; phone: string | null } } | { kind: "settle"; entry: LedgerEntry } | { kind: "delete"; entry: LedgerEntry } | { kind: "view"; entry: LedgerEntry };

export function LedgerModule() {
  const { can } = useIms();
  const canWrite = can("receivables") || can("payables");
  const [dlg, setDlg] = useState<Dlg>(null);
  const [statementOf, setStatementOf] = useState<{ id: string | null; name: string } | null>(null);
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [period, setPeriod] = useState<PeriodOrAll>("all");
  const [q, setQ] = useState("");
  const state = useImsData(
    () => finance.ledger({ type: type === "all" ? undefined : type, status: status === "all" ? undefined : status, period, q: q.trim() || undefined }),
    [type, status, period, q],
  );

  return (
    <RequirePerm perm={["receivables", "payables", "reports"]} what="the credit / debit ledger">
      <Stack>
        <PageHeader
          title="Credit / Debit Ledger"
          sub="Running balance per party, plus quick udhaar entries outside invoices and bills."
          actions={
            canWrite ? (
              <>
                <Button icon="plus" onClick={() => setDlg({ kind: "add", type: "debit" })}>
                  Debit (you owe)
                </Button>
                <Button variant="primary" icon="plus" onClick={() => setDlg({ kind: "add", type: "credit" })}>
                  Credit (they owe)
                </Button>
              </>
            ) : null
          }
        />
        <Loaded state={state}>
          {(data) => (
            <LedgerBody
              data={data}
              canWrite={canWrite}
              filters={{ type, status, period, q }}
              setters={{ setType, setStatus, setPeriod, setQ }}
              onDialog={setDlg}
              onStatement={setStatementOf}
            />
          )}
        </Loaded>
      </Stack>

      {dlg?.kind === "add" ? <EntryDialog type={dlg.type} party={dlg.party} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === "settle" ? <SettleDialog entry={dlg.entry} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === "view" ? <EntryView entry={dlg.entry} canWrite={canWrite} onClose={() => setDlg(null)} onDialog={setDlg} /> : null}
      <DeleteEntryDialog entry={dlg?.kind === "delete" ? dlg.entry : null} onClose={() => setDlg(null)} />
      <StatementDialog party={statementOf} onClose={() => setStatementOf(null)} />
    </RequirePerm>
  );
}

function LedgerBody({
  data,
  canWrite,
  filters,
  setters,
  onDialog,
  onStatement,
}: {
  data: LedgerData;
  canWrite: boolean;
  filters: { type: TypeFilter; status: StatusFilter; period: PeriodOrAll; q: string };
  setters: { setType: (v: TypeFilter) => void; setStatus: (v: StatusFilter) => void; setPeriod: (v: PeriodOrAll) => void; setQ: (v: string) => void };
  onDialog: (d: Dlg) => void;
  onStatement: (p: { id: string | null; name: string }) => void;
}) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const [partyFilter, setPartyFilter] = useState<PartyFilter>("all");
  const [partyQ, setPartyQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const s = data.summary;
  const business = sellerOf(session).name;

  const parties = useMemo(() => {
    const needle = partyQ.trim().toLowerCase();
    return data.parties
      .filter((p) => Math.abs(p.balance) >= 0.005)
      .filter((p) => (partyFilter === "receivable" ? p.balance > 0 : partyFilter === "payable" ? p.balance < 0 : true))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.mobile ?? "").includes(needle))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [data.parties, partyFilter, partyQ]);
  const visibleParties = showAll ? parties : parties.slice(0, 12);

  const remind = (e: LedgerEntry) => {
    const msg = `Namaste ${e.partyName}, a gentle reminder from ${business}: ${inrExact(e.amount)} is pending${e.dueDate ? ` (due ${dateLabel(e.dueDate)})` : ""}${e.refNo ? ` against ${e.refNo}` : ""}. Kindly clear it at the earliest. Thank you!`;
    window.open(reminderLink("whatsapp", e.phone, msg), "_blank", "noopener");
  };

  const columns: BosColumn<LedgerEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (e) => (
        <span className="ims-cell-stack">
          <span>{dateLabel(e.date)}</span>
          <small>{e.refNo ?? LEDGER_CATEGORY_LABEL[e.category as LedgerEntryCategory] ?? e.category}</small>
        </span>
      ),
    },
    {
      key: "party",
      header: "Party",
      cell: (e) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{e.partyName}</span>
          <small>{[e.phone, e.notes].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (e) => (e.type === "credit" ? <Badge tag="sage">Credit · they owe</Badge> : <Badge tag="rose">Debit · you owe</Badge>),
    },
    {
      key: "due",
      header: "Due",
      cell: (e) =>
        e.status === "settled" ? (
          <span className="ims-faint">Settled {dateLabel(e.settledOn)}</span>
        ) : e.dueDate ? (
          <span className="ims-cell-stack">
            <span className={e.overdue ? "ims-neg" : undefined}>{dateLabel(e.dueDate)}</span>
            {e.overdue ? <small>{e.daysOverdue}d overdue</small> : null}
          </span>
        ) : (
          <span className="ims-faint">No due date</span>
        ),
    },
    { key: "amount", header: "Amount", align: "right", mono: true, cell: (e) => <span className={e.type === "debit" ? "ims-neg" : undefined}>{inrExact(e.amount)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (e) =>
        canWrite ? (
          <span className="ims-row" style={{ justifyContent: "flex-end" }} onClick={(ev) => ev.stopPropagation()}>
            {e.status === "pending" && e.type === "credit" ? (
              <Button size="sm" variant="ghost" icon="bell" disabled={!e.phone} title={e.phone ? "Send WhatsApp reminder" : "Add a phone number to remind"} onClick={() => remind(e)}>
                Remind
              </Button>
            ) : null}
            {e.status === "pending" ? (
              <Button size="sm" variant="success" onClick={() => onDialog({ kind: "settle", entry: e })}>
                Settle
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy === `reopen-${e.id}`} onClick={() => run(`reopen-${e.id}`, () => finance.reopenEntry(e.id), { success: "Entry reopened" })}>
                Reopen
              </Button>
            )}
          </span>
        ) : null,
    },
  ];

  return (
    <Stack gap={16}>
      <Grid cols={4} min={170}>
        <KpiCard label="Receivable (net)" value={inrCompact(s.receivable)} valueTone="emerald" chip={{ color: "mint", glyph: "📥" }} delta={`${s.receivableParties} part${s.receivableParties === 1 ? "y owes" : "ies owe"} you`} deltaTone="up" />
        <KpiCard label="Payable (net)" value={inrCompact(s.payable)} valueTone={s.payable > 0 ? "coral" : undefined} chip={{ color: "rose", glyph: "📤" }} delta={`You owe ${s.payableParties} part${s.payableParties === 1 ? "y" : "ies"}`} deltaTone={s.payableParties ? "warn" : "muted"} />
        <KpiCard label="Udhaar to collect" value={inrCompact(s.manualCredit.total)} chip={{ color: "sage", glyph: "🤝" }} delta={s.manualCredit.overdue ? `${s.manualCredit.overdue} overdue of ${s.manualCredit.count}` : `${s.manualCredit.count} pending entr${s.manualCredit.count === 1 ? "y" : "ies"}`} deltaTone={s.manualCredit.overdue ? "down" : "muted"} />
        <KpiCard label="Udhaar to pay" value={inrCompact(s.manualDebit.total)} chip={{ color: "amber", glyph: "🧾" }} delta={s.manualDebit.overdue ? `${s.manualDebit.overdue} overdue of ${s.manualDebit.count}` : `${s.manualDebit.count} pending entr${s.manualDebit.count === 1 ? "y" : "ies"}`} deltaTone={s.manualDebit.overdue ? "down" : "muted"} />
      </Grid>

      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="fin-section-title">Party balances</div>
            <span className="ims-faint">Invoices, receipts, bills, payments, returns and manual entries combined. Click a party for its statement.</span>
          </div>
          <div className="ims-row">
            <SearchInput placeholder="Find party…" value={partyQ} onChange={(e) => setPartyQ(e.target.value)} aria-label="Find party" />
            <Segmented
              size="sm"
              aria-label="Balance direction"
              value={partyFilter}
              onChange={setPartyFilter}
              options={[
                { value: "all", label: "All" },
                { value: "receivable", label: "They owe" },
                { value: "payable", label: "You owe" },
              ]}
            />
          </div>
        </div>
        {visibleParties.length ? (
          <div className="fin-party-grid">
            {visibleParties.map((p) => (
              <PartyCard key={p.key} party={p} onOpen={() => onStatement({ id: p.partyId, name: p.name })} />
            ))}
          </div>
        ) : (
          <EmptyState glyph="⚖" title="All square">
            No outstanding balances{partyQ ? " match this search" : ""}.
          </EmptyState>
        )}
        {parties.length > 12 ? (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${parties.length} parties`}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card interactive={false}>
        <div className="fin-section-title">Udhaar &amp; manual entries</div>
        <div className="ims-toolbar">
          <SearchInput wrapperClassName="ims-grow" placeholder="Search party, phone, reference, notes…" value={filters.q} onChange={(e) => setters.setQ(e.target.value)} aria-label="Search entries" />
          <Segmented
            size="sm"
            aria-label="Entry type"
            value={filters.type}
            onChange={setters.setType}
            options={[
              { value: "all", label: "All" },
              { value: "credit", label: "Credit" },
              { value: "debit", label: "Debit" },
            ]}
          />
          <Segmented
            size="sm"
            aria-label="Entry status"
            value={filters.status}
            onChange={setters.setStatus}
            options={[
              { value: "pending", label: "Pending" },
              { value: "settled", label: "Settled" },
              { value: "all", label: "All" },
            ]}
          />
          <Button
            size="sm"
            icon="download"
            disabled={!data.entries.length}
            onClick={() =>
              downloadCsv("ledger-entries", data.entries, [
                { header: "Date", value: (e) => e.date },
                { header: "Party", value: (e) => e.partyName },
                { header: "Phone", value: (e) => e.phone },
                { header: "Type", value: (e) => (e.type === "credit" ? "Credit (they owe)" : "Debit (you owe)") },
                { header: "Category", value: (e) => LEDGER_CATEGORY_LABEL[e.category as LedgerEntryCategory] ?? e.category },
                { header: "Amount", value: (e) => e.amount },
                { header: "Due date", value: (e) => e.dueDate },
                { header: "Reference", value: (e) => e.refNo },
                { header: "Status", value: (e) => e.status },
                { header: "Settled on", value: (e) => e.settledOn },
                { header: "Method", value: (e) => (e.settleMethod ? methodLabel(e.settleMethod) : "") },
                { header: "Notes", value: (e) => e.notes },
              ])
            }
          >
            Export
          </Button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <PeriodSelect value={filters.period} onChange={setters.setPeriod} />
        </div>
        <DataTable
          caption="Ledger entries"
          columns={columns}
          rows={data.entries}
          rowKey={(e) => e.id}
          onRowClick={(e) => onDialog({ kind: "view", entry: e })}
          empty={
            <EmptyState
              glyph="🤝"
              title={filters.q || filters.type !== "all" || filters.period !== "all" ? "No entries match these filters" : filters.status === "pending" ? "No pending udhaar" : "No entries yet"}
              actions={
                canWrite ? (
                  <Button variant="primary" icon="plus" onClick={() => onDialog({ kind: "add", type: "credit" })}>
                    Add credit entry
                  </Button>
                ) : undefined
              }
            >
              Record goods given on credit or money you owe without raising an invoice or bill.
            </EmptyState>
          }
        />
      </Card>
    </Stack>
  );
}

function PartyCard({ party, onOpen }: { party: PartyBalance; onOpen: () => void }) {
  const owes = party.balance > 0;
  return (
    <button type="button" className="fin-party" onClick={onOpen} aria-label={`Statement for ${party.name}`}>
      <span className="fin-party-name">{party.name}</span>
      <small className="ims-faint">{[party.kind ? party.kind[0].toUpperCase() + party.kind.slice(1) : null, party.mobile].filter(Boolean).join(" · ") || "Unlinked party"}</small>
      <span className={`fin-party-bal ${owes ? "is-pos" : "is-neg"}`}>{balanceText(party.balance)}</span>
      <small className="ims-faint">
        {owes ? "Owes you" : "You owe"}
        {party.lastActivity ? ` · last ${dateLabel(party.lastActivity)}` : ""}
      </small>
    </button>
  );
}

const CATEGORY_OPTIONS: ReadonlyArray<LedgerEntryCategory> = ["udhaar", "opening", "adjustment", "credit_note", "debit_note"];

function EntryDialog({ type: initialType, party, onClose }: { type: "credit" | "debit"; party?: { id: string | null; name: string; phone: string | null }; onClose: () => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const [type, setType] = useState(initialType);
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: party?.id ?? null, name: party?.name ?? "" });
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(session.today);
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState<LedgerEntryCategory>("udhaar");
  const [refNo, setRefNo] = useState("");
  const [notes, setNotes] = useState("");
  const amt = round2(num(amount));
  const valid = who.name.trim().length > 0 && amt > 0 && Boolean(date);
  const addDays = (d: number) => {
    const t = new Date(`${date || session.today}T00:00:00`);
    t.setDate(t.getDate() + d);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={type === "credit" ? "New credit entry" : "New debit entry"}
      description={type === "credit" ? "The party owes you this amount (goods given on udhaar, cash lent, etc.)." : "You owe the party this amount (goods taken on credit, cash borrowed, etc.)."}
      icon={{ tone: type === "credit" ? "emerald" : "coral", name: "plus" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || busy === "entry"}
            onClick={async () => {
              const out = await run(
                "entry",
                () =>
                  finance.addEntry({
                    type,
                    partyId: who.id,
                    partyName: who.name.trim(),
                    phone: phone.trim() || null,
                    amount: amt,
                    date,
                    dueDate: dueDate || null,
                    category,
                    refNo: refNo.trim() || null,
                    notes: notes.trim() || null,
                  }),
                { success: `${type === "credit" ? "Credit" : "Debit"} of ${inrExact(amt)} recorded` },
              );
              if (out) onClose();
            }}
          >
            Save entry
          </Button>
        </>
      }
    >
      <Stack gap={14}>
        <Segmented
          block
          aria-label="Entry type"
          value={type}
          onChange={setType}
          options={[
            { value: "credit", label: "Credit · they owe you" },
            { value: "debit", label: "Debit · you owe them" },
          ]}
        />
        <FormGrid columns="1fr 1fr">
          <Field label="Party" hint="Pick a saved party or type any name.">
            {({ id }) => (
              <PartySelect
                id={id}
                kind={type === "credit" ? "customer" : "supplier"}
                value={who}
                onChange={(v) => {
                  setWho({ id: v.id, name: v.name });
                  if (v.party?.mobile) setPhone(v.party.mobile);
                }}
              />
            )}
          </Field>
          <Field label="Phone" hint="Used for WhatsApp reminders.">
            {({ id }) => <Input id={id} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" />}
          </Field>
          <Field label="Amount">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}</Field>
          <Field label="Category">
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as LedgerEntryCategory)}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {LEDGER_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date">{({ id }) => <Input id={id} type="date" max={session.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Due date" hint="Optional — overdue entries are flagged.">
            {({ id }) => (
              <Stack gap={6}>
                <Input id={id} type="date" min={date} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                <QuickChips
                  label="Due in"
                  active={null}
                  options={[
                    { key: "7", label: "7 days" },
                    { key: "15", label: "15 days" },
                    { key: "30", label: "30 days" },
                  ]}
                  onPick={(k) => setDueDate(addDays(Number(k)))}
                />
              </Stack>
            )}
          </Field>
          <Field label="Reference">{({ id }) => <Input id={id} value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Slip / khata page no." />}</Field>
        </FormGrid>
        <Field label="Notes">{({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was given / taken" />}</Field>
      </Stack>
    </Dialog>
  );
}

function SettleDialog({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const [date, setDate] = useState(session.today);
  const [method, setMethod] = useState<PayMethod>("cash");
  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.type === "credit" ? `Collect ${inrExact(entry.amount)} from ${entry.partyName}` : `Pay ${inrExact(entry.amount)} to ${entry.partyName}`}
      description="Marks the entry as settled in full and adds the money movement to that day's closing."
      icon={{ tone: "emerald", name: "check" }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            disabled={!date || busy === "settle"}
            onClick={async () => {
              const out = await run("settle", () => finance.settleEntry(entry.id, { date, method }), { success: "Entry settled" });
              if (out) onClose();
            }}
          >
            Mark settled
          </Button>
        </>
      }
    >
      <FormGrid columns="1fr 1fr">
        <Field label="Settled on">{({ id }) => <Input id={id} type="date" max={session.today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Method">{({ id }) => <MethodSelect id={id} value={method} onChange={setMethod} />}</Field>
      </FormGrid>
    </Dialog>
  );
}

function EntryView({ entry: e, canWrite, onClose, onDialog }: { entry: LedgerEntry; canWrite: boolean; onClose: () => void; onDialog: (d: Dlg) => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${e.type === "credit" ? "Credit" : "Debit"} · ${e.partyName}`}
      description={`${inrExact(e.amount)} · ${e.status === "settled" ? "Settled" : e.overdue ? `${e.daysOverdue} days overdue` : "Pending"}`}
      icon={{ tone: e.type === "credit" ? "emerald" : "coral", name: "wallet" }}
      actions={
        <>
          {canWrite ? (
            <Button variant="ghost" onClick={() => onDialog({ kind: "delete", entry: e })}>
              Delete
            </Button>
          ) : null}
          {canWrite ? (
            <Button icon="plus" onClick={() => onDialog({ kind: "add", type: e.type, party: { id: e.partyId, name: e.partyName, phone: e.phone } })}>
              Another for this party
            </Button>
          ) : null}
          {canWrite && e.status === "pending" ? (
            <Button variant="success" onClick={() => onDialog({ kind: "settle", entry: e })}>
              Settle
            </Button>
          ) : null}
        </>
      }
    >
      <KeyValues
        rows={[
          ["Type", e.type === "credit" ? "Credit — party owes you" : "Debit — you owe the party"],
          ["Category", LEDGER_CATEGORY_LABEL[e.category as LedgerEntryCategory] ?? e.category],
          ["Date", dateLabel(e.date)],
          ["Due", e.dueDate ? dateLabel(e.dueDate) : null],
          ["Phone", e.phone],
          ["Reference", e.refNo],
          ["Notes", e.notes],
          ["Settled", e.status === "settled" ? `${dateLabel(e.settledOn)}${e.settleMethod ? ` · ${methodLabel(e.settleMethod)}` : ""}${e.settledByName ? ` · ${e.settledByName}` : ""}` : null],
          ["Added by", e.createdByName ? `${e.createdByName} · ${stampLabel(e.createdAt)}` : stampLabel(e.createdAt)],
        ]}
      />
    </Dialog>
  );
}

function DeleteEntryDialog({ entry, onClose }: { entry: LedgerEntry | null; onClose: () => void }) {
  const { run, busy } = useImsAction();
  return (
    <ConfirmDialog
      open={entry !== null}
      onClose={onClose}
      title="Delete this entry?"
      description={entry ? `${entry.partyName} · ${inrExact(entry.amount)}. Party balances will be recalculated.` : undefined}
      confirmLabel="Delete entry"
      destructive
      busy={busy === "delete-entry"}
      onConfirm={async () => {
        if (!entry) return;
        const out = await run("delete-entry", () => finance.deleteEntry(entry.id).then(() => true), { success: "Entry deleted" });
        if (out) onClose();
      }}
    />
  );
}
