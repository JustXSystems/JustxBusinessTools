"use client";

import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, FormGrid, Input, ModuleToolbar, SearchInput, Segmented, Select, Textarea, type BosColumn, type BosPastel } from "@/components/bos";
import {
  bos,
  type AgreementType,
  type BosAgreement,
  type ComplianceArea,
  type ComplianceItem,
  type PoliciesOverview,
  type Recurrence,
} from "@/lib/bos-app/api";
import { AGREEMENT_TYPE_LABEL, agreementBadge, COMPLIANCE_AREA_LABEL, complianceBadge, dateLabel, RECURRENCE_LABEL } from "@/lib/bos-app/format";
import { StatusBadge, useBosAction, useBosApp } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Overview = PoliciesOverview;

const AREAS: ReadonlyArray<ComplianceArea> = ["pf", "esi", "pt", "tds", "lwf", "posh", "shops", "gratuity", "bonus", "other"];
const RECURRENCES: ReadonlyArray<Recurrence> = ["none", "monthly", "quarterly", "half_yearly", "yearly"];
const AGREEMENT_TYPES: ReadonlyArray<AgreementType> = ["employment", "nda", "non_compete", "consultant", "internship", "other"];
const AREA_TAG: Record<ComplianceArea, BosPastel> = { pf: "blue", esi: "mint", pt: "lavender", tds: "rose", lwf: "sage", posh: "rose", shops: "sage", gratuity: "blue", bonus: "mint", other: "sage" };
const TYPE_TAG: Record<AgreementType, BosPastel> = { employment: "blue", nda: "lavender", non_compete: "rose", consultant: "mint", internship: "sage", other: "sage" };

const faint = (text: ReactNode = "—") => <span className="bos-text-faint">{text}</span>;
const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
  e.stopPropagation();
  fn();
};

function Described({ title, sub, width = 300 }: { title: ReactNode; sub?: ReactNode; width?: number }) {
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

/* ---------- Compliance calendar (managers) ---------- */

type FilingDialog = { kind: "edit"; item: ComplianceItem | null } | { kind: "done"; item: ComplianceItem } | { kind: "remove"; item: ComplianceItem } | { kind: "templates" };
type FilingShow = "open" | "done" | "all";

export function ComplianceTab({ o }: { o: Overview }) {
  const { run, busy } = useBosAction();
  const [show, setShow] = useState<FilingShow>("open");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<FilingDialog | null>(null);
  const close = () => setDialog(null);
  const q = query.trim().toLowerCase();
  const shown = o.compliance.filter(
    (c) => (show === "all" || (show === "done" ? c.status === "done" : c.status === "open")) && (!q || `${c.title} ${c.responsible ?? ""} ${c.reference ?? ""}`.toLowerCase().includes(q)),
  );
  const toAdd = o.templates.filter((t) => !t.added).length;
  const columns: BosColumn<ComplianceItem>[] = [
    { key: "title", header: "Filing", cell: (c) => <Described title={c.title} sub={c.note ?? undefined} width={340} /> },
    { key: "area", header: "Area", cell: (c) => <Badge tag={AREA_TAG[c.area]}>{COMPLIANCE_AREA_LABEL[c.area].toUpperCase()}</Badge> },
    { key: "due", header: "Due", mono: true, cell: (c) => <Described title={dateLabel(c.dueOn)} sub={RECURRENCE_LABEL[c.recurrence]} width={140} /> },
    { key: "who", header: "Responsible", cell: (c) => c.responsible ?? faint() },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <Described
          width={200}
          title={<StatusBadge view={complianceBadge(c.state)} />}
          sub={c.status === "done" ? [`Filed ${dateLabel(c.doneOn)}`, c.reference ? `ref ${c.reference}` : null].filter(Boolean).join(" · ") : undefined}
        />
      ),
    },
    {
      key: "act",
      header: "",
      cell: (c) =>
        c.status === "open" ? (
          <span className="bos-row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <Button size="sm" variant="primary" onClick={stop(() => setDialog({ kind: "done", item: c }))}>
              Mark filed
            </Button>
            <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${c.title}`} onClick={stop(() => setDialog({ kind: "edit", item: c }))} />
            <Button size="sm" variant="ghost" icon="x" aria-label={`Remove ${c.title}`} onClick={stop(() => setDialog({ kind: "remove", item: c }))} />
          </span>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy === `reopen-${c.id}`} onClick={() => void run(`reopen-${c.id}`, () => bos.reopenFiling(c.id), { success: "Filing reopened", description: c.title })}>
            Reopen
          </Button>
        ),
    },
  ];
  return (
    <>
      <ModuleToolbar>
        <Segmented<FilingShow>
          size="sm"
          aria-label="Show filings"
          options={[
            { value: "open", label: `To do · ${o.compliance.filter((c) => c.status === "open").length}` },
            { value: "done", label: "Done" },
            { value: "all", label: "All" },
          ]}
          value={show}
          onChange={setShow}
        />
        <SearchInput placeholder="Search filing, person or reference…" aria-label="Search filings" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="bos-spacer" />
        <Button size="sm" variant="ghost" disabled={!toAdd} onClick={() => setDialog({ kind: "templates" })}>
          Standard filings{toAdd ? ` · ${toAdd}` : ""}
        </Button>
        <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog({ kind: "edit", item: null })}>
          Add filing
        </Button>
      </ModuleToolbar>
      {!o.compliance.length ? (
        <Alert tone="blue" title="Start your compliance calendar">
          Add the usual PF, ESI, TDS, professional tax, POSH and labour-welfare filings in one go with <strong>Standard filings</strong>, then adjust the dates for your state. Recurring filings
          roll forward when you mark them filed.
        </Alert>
      ) : null}
      <DataTable caption="Compliance calendar" columns={columns} rows={shown} rowKey={(c) => c.id} empty={show === "open" ? "Nothing to file — you're up to date." : "No filings yet."} />

      {dialog?.kind === "templates" ? <TemplatesDialog o={o} onClose={close} /> : null}
      {dialog?.kind === "edit" ? <FilingEditDialog item={dialog.item} onClose={close} /> : null}
      {dialog?.kind === "done" ? <FiledDialog item={dialog.item} today={o.today} onClose={close} /> : null}
      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          open
          onClose={close}
          destructive
          title={`Remove ${dialog.item.title}?`}
          description={dialog.item.recurrence === "none" ? "It's taken off the calendar." : "It's taken off the calendar and won't repeat. Filings already marked done stay."}
          confirmLabel="Remove"
          busy={busy === "remove-filing"}
          onConfirm={async () => {
            const out = await run("remove-filing", () => bos.deleteFiling(dialog.item.id).then(() => true), { success: "Filing removed", description: dialog.item.title });
            if (out) close();
          }}
        />
      ) : null}
    </>
  );
}

function TemplatesDialog({ o, onClose }: { o: Overview; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(o.templates.filter((t) => !t.added).map((t) => t.key)));
  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <FormDialog
      open
      onClose={onClose}
      title="Add standard filings"
      description="Common statutory filings for Indian employers, each with its next due date."
      icon={{ tone: "blue", name: "calendar" }}
      submitLabel={picked.size ? `Add ${picked.size} filing${picked.size === 1 ? "" : "s"}` : "Close"}
      busy={busy === "templates"}
      wide
      onSubmit={async () => {
        if (!picked.size) return onClose();
        const out = await run("templates", () => bos.addComplianceTemplates([...picked]), { success: "Filings added", description: "Check the dates for your state" });
        if (out) onClose();
      }}
    >
      <Alert tone="amber" title="Check the dates">
        These are the usual due dates. Some vary by state and change over time — confirm them with your accountant and edit any of them after adding.
      </Alert>
      <div className="bos-pick-list" role="group" aria-label="Standard filings">
        {o.templates.map((t) => (
          <label key={t.key} className="bos-pick-row" style={{ alignItems: "flex-start" }}>
            <Checkbox checked={t.added || picked.has(t.key)} disabled={t.added} onChange={() => toggle(t.key)} aria-label={t.title} />
            <span style={{ display: "block" }}>
              <span style={{ fontWeight: 600 }}>{t.title}</span>
              <span className="bos-text-faint" style={{ display: "block", fontSize: 12 }}>
                {t.added ? "Already on your calendar" : `${RECURRENCE_LABEL[t.recurrence]} · next due ${dateLabel(t.firstDue)}`} — {t.note}
              </span>
            </span>
          </label>
        ))}
      </div>
    </FormDialog>
  );
}

function FilingEditDialog({ item, onClose }: { item: ComplianceItem | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    title: item?.title ?? "",
    area: item?.area ?? ("other" as ComplianceArea),
    dueOn: item?.dueOn ?? "",
    recurrence: item?.recurrence ?? ("none" as Recurrence),
    responsible: item?.responsible ?? "",
    note: item?.note ?? "",
  }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={item ? `Edit ${item.title}` : "Add a filing"}
      description={item ? undefined : "A return, payment, licence renewal or any other date you can't miss."}
      icon={{ tone: "blue", name: "calendar" }}
      submitLabel={item ? "Save" : "Add filing"}
      busy={busy === "filing"}
      wide
      onSubmit={async () => {
        const input = { title: v.title.trim(), area: v.area, dueOn: v.dueOn, recurrence: v.recurrence, responsible: v.responsible.trim() || null, note: v.note.trim() || null };
        const out = await run("filing", () => (item ? bos.updateFiling(item.id, input) : bos.createFiling(input)), { success: item ? "Filing saved" : "Filing added", description: input.title });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Filing" full>
          {({ id }) => <Input id={id} required maxLength={160} value={v.title} placeholder="e.g. Factory licence renewal" onChange={(e) => f.set("title")(e.target.value)} />}
        </Field>
        <Field label="Area">
          {({ id }) => (
            <Select id={id} value={v.area} onChange={(e) => f.set("area")(e.target.value as ComplianceArea)}>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {COMPLIANCE_AREA_LABEL[a]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due on">
          {({ id }) => <Input id={id} type="date" required value={v.dueOn} onChange={(e) => f.set("dueOn")(e.target.value)} />}
        </Field>
        <Field label="Repeats" hint={v.recurrence === "none" ? undefined : "The next one is added when you mark this filed"}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.recurrence} onChange={(e) => f.set("recurrence")(e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Responsible" hint="Optional — e.g. your CA or payroll consultant">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={v.responsible} onChange={(e) => f.set("responsible")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Note">
        {({ id }) => <Textarea id={id} rows={2} maxLength={1000} value={v.note} placeholder="Portal, login owner, documents needed…" onChange={(e) => f.set("note")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function FiledDialog({ item, today, onClose }: { item: ComplianceItem; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ doneOn: today, reference: "", note: "" }));
  const v = f.values;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Mark ${item.title} filed`}
      description={`Due ${dateLabel(item.dueOn)}.${item.recurrence === "none" ? "" : ` The next ${RECURRENCE_LABEL[item.recurrence].toLowerCase()} one is added to the calendar.`}`}
      icon={{ tone: "emerald", name: "check" }}
      submitLabel="Mark filed"
      busy={busy === "filed"}
      onSubmit={async () => {
        const out = await run("filed", () => bos.markFiled(item.id, { doneOn: v.doneOn || undefined, reference: v.reference.trim() || null, note: v.note.trim() || null }), {
          success: "Marked filed",
          description: item.title,
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Filed on">
          {({ id }) => <Input id={id} type="date" required max={today} value={v.doneOn} onChange={(e) => f.set("doneOn")(e.target.value)} />}
        </Field>
        <Field label="Reference" hint="Challan, acknowledgement or receipt number">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={v.reference} onChange={(e) => f.set("reference")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Note" hint="Optional — replaces the filing's note">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} maxLength={1000} value={v.note} onChange={(e) => f.set("note")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

/* ---------- Agreements ---------- */

type AgreementDialog = { kind: "edit"; agreement: BosAgreement | null } | { kind: "end"; agreement: BosAgreement } | { kind: "remove"; agreement: BosAgreement };
type AgreementShow = "current" | "ended" | "all";

export function AgreementsTab({ o }: { o: Overview }) {
  const { run, busy } = useBosAction();
  const [show, setShow] = useState<AgreementShow>("current");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<AgreementDialog | null>(null);
  const close = () => setDialog(null);
  const q = query.trim().toLowerCase();
  const shown = o.agreements.filter(
    (a) =>
      (show === "all" || (show === "ended" ? a.status === "ended" : a.status !== "ended")) &&
      (!q || `${a.title} ${a.agreementNo} ${a.employeeName ?? ""} ${a.counterparty ?? ""}`.toLowerCase().includes(q)),
  );
  const columns: BosColumn<BosAgreement>[] = [
    { key: "title", header: "Agreement", cell: (a) => <Described title={a.title} sub={[a.agreementNo, a.note].filter(Boolean).join(" · ")} width={280} /> },
    ...(o.manager
      ? [{ key: "with", header: "With", cell: (a: BosAgreement) => <Described title={a.employeeName ?? a.counterparty ?? "—"} sub={a.employeeId ? (a.empCode ?? "Employee") : "Outside party"} width={200} /> }]
      : []),
    { key: "type", header: "Type", cell: (a) => <Badge tag={TYPE_TAG[a.type]}>{AGREEMENT_TYPE_LABEL[a.type].toUpperCase()}</Badge> },
    { key: "signed", header: "Signed", mono: true, cell: (a) => (a.signedOn ? dateLabel(a.signedOn) : faint("Not yet")) },
    { key: "ends", header: "Ends", mono: true, cell: (a) => (a.status === "ended" ? `Ended ${dateLabel(a.endedOn)}` : a.expiresOn ? dateLabel(a.expiresOn) : faint("No end date")) },
    { key: "status", header: "Status", cell: (a) => <StatusBadge view={agreementBadge(a.state)} /> },
    {
      key: "doc",
      header: "Signed copy",
      cell: (a) =>
        a.documentUrl ? (
          <a href={a.documentUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            Open ↗
          </a>
        ) : (
          faint()
        ),
    },
    ...(o.manager
      ? [
          {
            key: "act",
            header: "",
            cell: (a: BosAgreement) => (
              <span className="bos-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                {a.status === "ended" ? (
                  <Button size="sm" variant="ghost" disabled={busy === `reinstate-${a.id}`} onClick={() => void run(`reinstate-${a.id}`, () => bos.reinstateAgreement(a.id), { success: "Agreement reinstated", description: a.title })}>
                    Reinstate
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "end", agreement: a })}>
                    End
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${a.agreementNo}`} onClick={() => setDialog({ kind: "edit", agreement: a })} />
                <Button size="sm" variant="ghost" icon="x" aria-label={`Delete ${a.agreementNo}`} onClick={() => setDialog({ kind: "remove", agreement: a })} />
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      {o.manager ? (
        <ModuleToolbar>
          <Segmented<AgreementShow>
            size="sm"
            aria-label="Show agreements"
            options={[
              { value: "current", label: "Current" },
              { value: "ended", label: "Ended" },
              { value: "all", label: "All" },
            ]}
            value={show}
            onChange={setShow}
          />
          <SearchInput placeholder="Search agreement, person or party…" aria-label="Search agreements" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="bos-spacer" />
          <Button size="sm" variant="primary" icon="plus" onClick={() => setDialog({ kind: "edit", agreement: null })}>
            Add agreement
          </Button>
        </ModuleToolbar>
      ) : null}
      <DataTable
        caption={o.manager ? "Agreements" : "Your agreements"}
        columns={columns}
        rows={shown}
        rowKey={(a) => a.id}
        empty={o.manager ? "No agreements yet — record employment contracts, NDAs and contractor agreements with Add agreement." : "HR hasn't recorded any agreements with you yet."}
      />

      {dialog?.kind === "edit" ? <AgreementEditDialog o={o} agreement={dialog.agreement} onClose={close} /> : null}
      {dialog?.kind === "end" ? <EndDialog agreement={dialog.agreement} today={o.today} onClose={close} /> : null}
      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          open
          onClose={close}
          destructive
          title={`Delete ${dialog.agreement.agreementNo}?`}
          description="It's removed from the register for good. To keep the record, end it instead."
          confirmLabel="Delete"
          busy={busy === "remove-agreement"}
          onConfirm={async () => {
            const out = await run("remove-agreement", () => bos.deleteAgreement(dialog.agreement.id).then(() => true), { success: "Agreement deleted", description: dialog.agreement.title });
            if (out) close();
          }}
        />
      ) : null}
    </>
  );
}

function AgreementEditDialog({ o, agreement: a, onClose }: { o: Overview; agreement: BosAgreement | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const { session } = useBosApp();
  const f = useFormState(() => ({
    type: a?.type ?? ("employment" as AgreementType),
    title: a?.title ?? "",
    party: a && !a.employeeId ? "outside" : "employee",
    employeeId: a?.employeeId ?? "",
    counterparty: a?.counterparty ?? "",
    signedOn: a?.signedOn ?? "",
    startsOn: a?.startsOn ?? "",
    expiresOn: a?.expiresOn ?? "",
    documentUrl: a?.documentUrl ?? "",
    note: a?.note ?? "",
  }));
  const v = f.values;
  const employees = o.employees.filter((e) => e.status !== "exited" || e.id === a?.employeeId);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={a ? `Edit ${a.agreementNo}` : "Add an agreement"}
      description={a ? undefined : `An agreement ${session.settings.companyName ? `${session.settings.companyName} has ` : ""}with an employee, contractor or agency. Link the signed copy from wherever you keep it.`}
      icon={{ tone: "blue", glyph: "✍" }}
      submitLabel={a ? "Save" : "Add agreement"}
      busy={busy === "agreement"}
      wide
      onSubmit={async () => {
        const input = {
          type: v.type,
          title: v.title.trim(),
          employeeId: v.party === "employee" ? v.employeeId || null : null,
          counterparty: v.party === "outside" ? v.counterparty.trim() || null : null,
          signedOn: v.signedOn || null,
          startsOn: v.startsOn || null,
          expiresOn: v.expiresOn || null,
          documentUrl: v.documentUrl.trim() || null,
          note: v.note.trim() || null,
        };
        const out = await run("agreement", () => (a ? bos.updateAgreement(a.id, input) : bos.createAgreement(input)), {
          success: a ? "Agreement saved" : "Agreement added",
          description: input.title || AGREEMENT_TYPE_LABEL[input.type],
        });
        if (out) onClose();
      }}
    >
      <FormGrid>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.type} onChange={(e) => f.set("type")(e.target.value as AgreementType)}>
              {AGREEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AGREEMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" hint="Optional — defaults to the type">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={160} value={v.title} onChange={(e) => f.set("title")(e.target.value)} />}
        </Field>
        <Field label="With">
          {({ id }) => (
            <Select id={id} value={v.party} onChange={(e) => f.set("party")(e.target.value)}>
              <option value="employee">An employee</option>
              <option value="outside">An outside party (contractor, agency…)</option>
            </Select>
          )}
        </Field>
        {v.party === "employee" ? (
          <Field label="Employee">
            {({ id }) => (
              <Select id={id} required value={v.employeeId} onChange={(e) => f.set("employeeId")(e.target.value)}>
                <option value="">Pick an employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.status === "exited" ? " (left)" : e.designation ? ` — ${e.designation}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Party">
            {({ id }) => <Input id={id} required maxLength={160} value={v.counterparty} placeholder="e.g. Sunrise Manpower Services" onChange={(e) => f.set("counterparty")(e.target.value)} />}
          </Field>
        )}
        <Field label="Signed on" hint="Leave empty until it's signed">
          {({ id, describedBy }) => <Input id={id} type="date" aria-describedby={describedBy} value={v.signedOn} onChange={(e) => f.set("signedOn")(e.target.value)} />}
        </Field>
        <Field label="Starts on">
          {({ id }) => <Input id={id} type="date" value={v.startsOn} onChange={(e) => f.set("startsOn")(e.target.value)} />}
        </Field>
        <Field label="Ends on" hint="Optional — you'll see it 30 days before it expires">
          {({ id, describedBy }) => <Input id={id} type="date" aria-describedby={describedBy} value={v.expiresOn} onChange={(e) => f.set("expiresOn")(e.target.value)} />}
        </Field>
        <Field label="Signed copy link" hint="Optional — Google Drive, OneDrive, SharePoint…">
          {({ id, describedBy }) => <Input id={id} type="url" aria-describedby={describedBy} maxLength={500} value={v.documentUrl} placeholder="https://" onChange={(e) => f.set("documentUrl")(e.target.value)} />}
        </Field>
      </FormGrid>
      <Field label="Note">
        {({ id }) => <Textarea id={id} rows={2} maxLength={1000} value={v.note} placeholder="Notice period, renewal terms, who holds the original…" onChange={(e) => f.set("note")(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

function EndDialog({ agreement: a, today, onClose }: { agreement: BosAgreement; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [on, setOn] = useState(today);
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`End ${a.agreementNo}?`}
      description={`${a.title} with ${a.employeeName ?? a.counterparty ?? "—"}. It stays in the register as ended, and can be reinstated.`}
      icon={{ tone: "amber", name: "clock" }}
      submitLabel="End agreement"
      busy={busy === "end"}
      onSubmit={async () => {
        const out = await run("end", () => bos.endAgreement(a.id, on || undefined), { success: "Agreement ended", description: a.title });
        if (out) onClose();
      }}
    >
      <Field label="Ended on">
        {({ id }) => <Input id={id} type="date" required value={on} onChange={(e) => setOn(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}
