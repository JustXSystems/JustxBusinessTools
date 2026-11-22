"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, FormGrid, Input, Select, Switch, Textarea, type BosColumn } from "@/components/bos";
import { finance, type RecurringProfile, type RecurringInput } from "@/lib/ims/finance";
import { addDaysISO, dateLabel } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, PageHeader, Stack, useIms, useImsAction, useImsData } from "../core";
import { blankLine, lineKey, LineEditor, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { PartySelect } from "../shared/pickers";
import { BackLink } from "./shared";

type View = { kind: "list" } | { kind: "edit"; id: string | null };

const FREQ: Array<{ value: RecurringInput["frequency"]; label: string }> = [
  { value: "days", label: "Day(s)" },
  { value: "weeks", label: "Week(s)" },
  { value: "months", label: "Month(s)" },
  { value: "years", label: "Year(s)" },
];

export function RecurringPanel({ onOpenInvoice }: { onOpenInvoice: (id: string) => void }) {
  const [view, setView] = useState<View>({ kind: "list" });
  if (view.kind === "edit") {
    return <RecurringEditor id={view.id} onClose={() => setView({ kind: "list" })} onOpenInvoice={onOpenInvoice} />;
  }
  return <RecurringList onNew={() => setView({ kind: "edit", id: null })} onEdit={(id) => setView({ kind: "edit", id })} onOpenInvoice={onOpenInvoice} />;
}

function RecurringList({ onNew, onEdit, onOpenInvoice }: { onNew: () => void; onEdit: (id: string) => void; onOpenInvoice: (id: string) => void }) {
  const { can } = useIms();
  const { run, busy } = useImsAction();
  const state = useImsData(() => finance.recurringProfiles(), []);
  const columns: BosColumn<RecurringProfile>[] = [
    {
      key: "name",
      header: "Profile",
      cell: (p) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{p.profileName}</span>
          <small>
            Every {p.repeatEvery} {p.frequency}
            {p.autoIssue ? " · auto-issue" : " · draft"}
          </small>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (p) => p.customerName,
    },
    {
      key: "next",
      header: "Next run",
      cell: (p) => dateLabel(p.nextRunOn),
    },
    {
      key: "last",
      header: "Last invoice",
      cell: (p) =>
        p.lastInvoiceId && p.lastInvoiceNo ? (
          <button type="button" className="ims-doc-ref" onClick={() => onOpenInvoice(p.lastInvoiceId!)}>
            {p.lastInvoiceNo}
          </button>
        ) : (
          <span className="ims-faint">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => <Badge tag={p.status === "active" ? "mint" : p.status === "paused" ? "lavender" : "blue"}>{p.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (p) => (
        <div className="ims-row">
          {can("sales") && p.status === "active" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === `run-${p.id}`}
              onClick={() =>
                void run(`run-${p.id}`, () => finance.runRecurring(p.id), { success: "Invoice generated from schedule" }).then((out) => {
                  if (out?.invoice?.invoice.id) onOpenInvoice(out.invoice.invoice.id);
                  state.reload();
                })
              }
            >
              Run now
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onEdit(p.id)}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Stack gap={16}>
      <PageHeader
        title="Recurring invoices"
        sub="Profiles that mint GST tax invoices on a schedule — Zoho / QuickBooks-style OOTB billing."
        actions={
          can("sales") ? (
            <div className="ims-row">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === "tick"}
                onClick={() => void run("tick", () => finance.tickRecurring(), { success: "Due profiles processed" }).then(() => state.reload())}
              >
                Process due
              </Button>
              <Button variant="primary" icon="plus" onClick={onNew}>
                New profile
              </Button>
            </div>
          ) : null
        }
      />
      <LoadedList state={state} columns={columns} onNew={onNew} />
    </Stack>
  );
}

function LoadedList({
  state,
  columns,
  onNew,
}: {
  state: ReturnType<typeof useImsData<{ profiles: RecurringProfile[] }>>;
  columns: BosColumn<RecurringProfile>[];
  onNew: () => void;
}) {
  if (state.error) return <ErrorBlock error={state.error} onRetry={state.reload} />;
  if (!state.data) return <LoadingBlock rows={2} />;
  const profiles = state.data.profiles;
  if (!profiles.length) {
    return (
      <EmptyState
        title="No recurring profiles yet"
        actions={
          <Button variant="primary" icon="plus" onClick={onNew}>
            New profile
          </Button>
        }
      >
        Set up AMC, rentals or monthly supply invoices once — IMS generates the rest.
      </EmptyState>
    );
  }
  return <DataTable columns={columns} rows={profiles} rowKey={(p) => p.id} />;
}

function RecurringEditor({ id, onClose, onOpenInvoice }: { id: string | null; onClose: () => void; onOpenInvoice: (id: string) => void }) {
  const state = useImsData(() => (id ? finance.recurringProfile(id).then((r) => r.profile) : Promise.resolve(null)), [id]);
  if (id && state.data === null) {
    return state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : <LoadingBlock rows={2} />;
  }
  return <RecurringForm key={id ?? "new"} profile={state.data} onClose={onClose} onOpenInvoice={onOpenInvoice} />;
}

function RecurringForm({
  profile,
  onClose,
  onOpenInvoice,
}: {
  profile: RecurringProfile | null;
  onClose: () => void;
  onOpenInvoice: (id: string) => void;
}) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const today = session.today;
  const [profileName, setProfileName] = useState(profile?.profileName ?? "");
  const [customer, setCustomer] = useState({ id: profile?.customerId ?? null, name: profile?.customerName ?? "" });
  const [frequency, setFrequency] = useState<RecurringInput["frequency"]>(profile?.frequency ?? "months");
  const [repeatEvery, setRepeatEvery] = useState(String(profile?.repeatEvery ?? 1));
  const [startOn, setStartOn] = useState(profile?.startOn ?? today);
  const [endOn, setEndOn] = useState(profile?.endOn ?? "");
  const [autoIssue, setAutoIssue] = useState(profile?.autoIssue ?? false);
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [terms, setTerms] = useState(profile?.terms ?? session.settings.terms ?? "");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    profile?.lines?.length
      ? profile.lines.map((l) => ({
          key: lineKey(),
          itemId: l.itemId ?? null,
          name: l.name,
          sku: l.sku ?? null,
          hsn: l.hsn ?? null,
          unit: l.unit ?? null,
          qty: l.qty,
          rate: l.rate,
          discountPct: l.discountPct,
          gstRate: l.gstRate,
        }))
      : [blankLine(session.settings.defaultGstRate)],
  );
  const [touched, setTouched] = useState(false);

  const input = useMemo((): RecurringInput => {
    return {
      profileName: profileName.trim(),
      frequency,
      repeatEvery: Math.max(1, Number(repeatEvery) || 1),
      startOn,
      endOn: endOn || null,
      autoIssue,
      customerId: customer.id,
      customerName: customer.name.trim(),
      lines: toLineInputs(lines),
      roundToRupee: true,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
    };
  }, [profileName, frequency, repeatEvery, startOn, endOn, autoIssue, customer, lines, notes, terms]);

  const invalid = !input.profileName || !input.customerName || !input.lines.length;

  const save = async () => {
    setTouched(true);
    if (invalid) return;
    const out = await run(
      "save",
      async () => (profile ? finance.updateRecurring(profile.id, input) : finance.createRecurring(input)),
      { success: profile ? "Profile updated" : "Recurring profile created" },
    );
    if (out) onClose();
  };

  return (
    <Stack gap={16}>
      <BackLink onClick={onClose}>All recurring</BackLink>
      <PageHeader title={profile ? "Edit recurring profile" : "New recurring profile"} sub="Each run creates a tax invoice. Auto-issue posts stock when the schedule fires." />
      {profile?.status === "ended" ? <Alert tone="amber" title="Ended">This profile no longer generates invoices.</Alert> : null}
      <Card interactive={false}>
        <FormGrid columns="1fr 1fr">
          <Field label="Profile name *" error={touched && !input.profileName ? "Required" : undefined}>
            {({ id: fid, describedBy }) => <Input id={fid} aria-describedby={describedBy} value={profileName} maxLength={160} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. Cascade AMC monthly" />}
          </Field>
          <Field label="Customer *">
            {({ id: fid }) => <PartySelect id={fid} kind="customer" value={customer} onChange={(v) => setCustomer({ id: v.id, name: v.name })} />}
          </Field>
          <Field label="Repeat every">
            {({ id: fid, describedBy }) => (
              <div className="ims-row">
                <Input id={fid} aria-describedby={describedBy} type="number" min={1} max={120} value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} style={{ maxWidth: 88 }} />
                <Select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringInput["frequency"])} aria-label="Frequency">
                  {FREQ.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </Field>
          <Field label="Start on">
            {({ id: fid, describedBy }) => <Input id={fid} aria-describedby={describedBy} type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />}
          </Field>
          <Field label="End on" hint="Optional">
            {({ id: fid, describedBy }) => <Input id={fid} aria-describedby={describedBy} type="date" value={endOn} min={startOn} onChange={(e) => setEndOn(e.target.value)} />}
          </Field>
          <label className="ims-row" style={{ fontSize: 12.5, alignSelf: "end" }}>
            <Switch checked={autoIssue} onChange={setAutoIssue} aria-label="Auto-issue generated invoices" />
            Auto-issue when generated
          </label>
        </FormGrid>
      </Card>
      <Card interactive={false}>
        <div className="ims-compose-section">
          <h2 className="ims-compose-section-title">Line items</h2>
          <LineEditor lines={lines} onChange={setLines} intraState price="selling" roundToRupee />
        </div>
      </Card>
      <Card interactive={false}>
        <FormGrid columns="1fr 1fr">
          <Field label="Notes">{({ id: fid, describedBy }) => <Textarea id={fid} aria-describedby={describedBy} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />}</Field>
          <Field label="Terms">{({ id: fid, describedBy }) => <Textarea id={fid} aria-describedby={describedBy} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />}</Field>
        </FormGrid>
      </Card>
      <div className="fin-sticky-actions">
        <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
          Cancel
        </Button>
        {profile?.status === "active" ? (
          <Button
            disabled={Boolean(busy)}
            onClick={() =>
              void run("run", () => finance.runRecurring(profile.id, { issue: autoIssue }), { success: "Invoice generated" }).then((out) => {
                if (out?.invoice?.invoice.id) onOpenInvoice(out.invoice.invoice.id);
              })
            }
          >
            Generate now
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => void save()} disabled={Boolean(busy)}>
          {busy === "save" ? "Saving…" : profile ? "Save profile" : "Create profile"}
        </Button>
      </div>
      {!profile ? (
        <p className="ims-muted" style={{ fontSize: 12.5 }}>
          First run on {dateLabel(startOn)} · preview next after that ~ {dateLabel(addDaysISO(startOn, frequency === "days" ? Number(repeatEvery) || 1 : frequency === "weeks" ? 7 * (Number(repeatEvery) || 1) : 30))}
        </p>
      ) : null}
    </Stack>
  );
}
