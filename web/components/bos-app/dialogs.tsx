"use client";

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Checkbox, Dialog, Field, FormGrid, Input, Select, Textarea, type BosIconName, type BosTone } from "@/components/bos";
import {
  bos,
  type BosEmployee,
  type BosHoliday,
  type BosInvoice,
  type BosParty,
  type BosProject,
  type LeaveType,
  type PartyKind,
  type PaymentMethod,
  type ProjectStatus,
} from "@/lib/bos-app/api";
import { addDaysISO, inr, LEAVE_LABEL, PROJECT_STAGES, todayLocal } from "@/lib/bos-app/format";
import { useBosAction, useBosApp } from "./core";

/* ---------- Building blocks ---------- */

export function useFormState<T extends Record<string, unknown>>(initial: () => T) {
  const [values, setValues] = useState<T>(initial);
  const set = <K extends keyof T>(key: K) => (value: T[K]) => setValues((v) => ({ ...v, [key]: value }));
  return { values, set, setValues, reset: () => setValues(initial()) };
}

export function FormDialog({
  open,
  onClose,
  title,
  description,
  icon,
  submitLabel,
  busy,
  onSubmit,
  wide,
  children,
  note,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: { tone: BosTone; name?: BosIconName; glyph?: ReactNode };
  submitLabel: string;
  busy?: boolean;
  onSubmit: () => void;
  wide?: boolean;
  children: ReactNode;
  note?: ReactNode;
}) {
  const formId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={icon}
      wide={wide}
      actionsNote={note}
      actions={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
        style={{ marginBottom: 20 }}
      >
        {children}
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={{ tone: destructive ? "coral" : "blue", name: destructive ? "warning" : "alert" }}
      actions={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant={destructive ? "destructive" : "primary"} disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}

const optional = (v: string) => (v.trim() ? v.trim() : null);

/** Text input backed by a datalist of parties; resolves the typed name to a party id when it matches. */
export function PartyField({
  label,
  parties,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  parties: ReadonlyArray<BosParty>;
  value: string;
  onChange: (name: string, party: BosParty | null) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  return (
    <Field label={label}>
      {({ id }) => (
        <>
          <Input
            id={id}
            list={listId}
            required={required}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              const name = e.target.value;
              onChange(name, parties.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null);
            }}
          />
          <datalist id={listId}>
            {parties.map((p) => (
              <option key={p.id} value={p.name}>
                {[p.company, p.city].filter(Boolean).join(" · ")}
              </option>
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

type PickableEmployee = Pick<BosEmployee, "id" | "name" | "empCode" | "status">;

function EmployeeSelect({ employees, value, onChange, label = "Employee", allowSelf }: { employees: ReadonlyArray<PickableEmployee>; value: string; onChange: (id: string) => void; label?: string; allowSelf?: boolean }) {
  return (
    <Field label={label}>
      {({ id }) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {allowSelf ? <option value="">Myself</option> : <option value="">Select…</option>}
          {employees
            .filter((e) => e.status !== "exited")
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.empCode}
              </option>
            ))}
        </Select>
      )}
    </Field>
  );
}

/* ---------- Leave ---------- */

export function ApplyLeaveDialog({ open, onClose, employees = [], employeeId }: { open: boolean; onClose: () => void; employees?: ReadonlyArray<BosEmployee>; employeeId?: string }) {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ employeeId: employeeId ?? "", leaveType: "casual" as LeaveType, fromDate: todayLocal(), toDate: todayLocal(), halfDay: false, reason: "" }));
  const { reset } = f;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form each time it opens
  }, [open]);
  const v = f.values;
  const submit = async () => {
    const ok = await run(
      "leave",
      () => bos.applyLeave({ employeeId: v.employeeId || undefined, leaveType: v.leaveType, fromDate: v.fromDate, toDate: v.halfDay ? v.fromDate : v.toDate, halfDay: v.halfDay, reason: optional(v.reason) }),
      { success: "Leave request submitted", description: "Your approver has been notified." },
    );
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title="Apply for leave" icon={{ tone: "blue", name: "calendar" }} submitLabel="Submit request" busy={busy === "leave"} onSubmit={submit} wide>
      <FormGrid>
        {canManage && employees.length && !employeeId ? <EmployeeSelect employees={employees} value={v.employeeId} onChange={f.set("employeeId")} allowSelf /> : null}
        <Field label="Leave type">
          {({ id }) => (
            <Select id={id} value={v.leaveType} onChange={(e) => f.set("leaveType")(e.target.value as LeaveType)}>
              {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => (
                <option key={t} value={t}>
                  {LEAVE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">{({ id }) => <Input id={id} type="date" required value={v.fromDate} onChange={(e) => f.setValues((s) => ({ ...s, fromDate: e.target.value, toDate: s.toDate < e.target.value ? e.target.value : s.toDate }))} />}</Field>
        {!v.halfDay ? <Field label="To">{({ id }) => <Input id={id} type="date" required min={v.fromDate} value={v.toDate} onChange={(e) => f.set("toDate")(e.target.value)} />}</Field> : null}
        <Field label="Reason" full>
          {({ id }) => <Textarea id={id} rows={2} value={v.reason} onChange={(e) => f.set("reason")(e.target.value)} placeholder="Optional" />}
        </Field>
      </FormGrid>
      <label className="bos-row" style={{ gap: 8, marginTop: 12, fontSize: 12.5 }}>
        <Checkbox checked={v.halfDay} onChange={f.set("halfDay")} aria-label="Half day" />
        Half day
      </label>
    </FormDialog>
  );
}

/* ---------- Expense claim ---------- */

export type ExpensePrefill = { employeeId?: string; category?: string; description?: string; spentOn?: string };

export function ExpenseDialog({
  open,
  onClose,
  categories,
  employees = [],
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  categories: ReadonlyArray<string>;
  employees?: ReadonlyArray<PickableEmployee>;
  prefill?: ExpensePrefill;
}) {
  const { canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({
    employeeId: prefill?.employeeId ?? "",
    category: prefill?.category ?? categories[0] ?? "Travel",
    amount: "",
    spentOn: prefill?.spentOn ?? todayLocal(),
    description: prefill?.description ?? "",
  }));
  const { reset } = f;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form each time it opens
  }, [open]);
  const v = f.values;
  const submit = async () => {
    const ok = await run(
      "expense",
      () => bos.createExpense({ employeeId: v.employeeId || null, category: v.category, amount: Number(v.amount), spentOn: v.spentOn, description: optional(v.description) }),
      { success: "Expense claim submitted", description: `${inr(Number(v.amount))} · ${v.category}` },
    );
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title="Claim an expense" icon={{ tone: "emerald", name: "receipt" }} submitLabel="Submit claim" busy={busy === "expense"} onSubmit={submit} wide>
      <FormGrid>
        {canManage && employees.length ? <EmployeeSelect employees={employees} value={v.employeeId} onChange={f.set("employeeId")} label="Claimant" allowSelf /> : null}
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={v.category} onChange={(e) => f.set("category")(e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={1} step="0.01" required value={v.amount} onChange={(e) => f.set("amount")(e.target.value)} />}</Field>
        <Field label="Spent on">{({ id }) => <Input id={id} type="date" required max={todayLocal()} value={v.spentOn} onChange={(e) => f.set("spentOn")(e.target.value)} />}</Field>
        <Field label="Description" full>
          {({ id }) => <Textarea id={id} rows={2} value={v.description} onChange={(e) => f.set("description")(e.target.value)} placeholder="e.g. Site visit — fuel & tolls" />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Customers & vendors ---------- */

export function PartyDialog({ open, onClose, party, defaultKind = "customer", onSaved }: { open: boolean; onClose: () => void; party?: BosParty | null; defaultKind?: PartyKind; onSaved?: (p: BosParty) => void }) {
  const { run, busy } = useBosAction();
  const init = () => ({
    kind: (party?.kind ?? defaultKind) as PartyKind,
    name: party?.name ?? "",
    company: party?.company ?? "",
    gstin: party?.gstin ?? "",
    phone: party?.phone ?? "",
    email: party?.email ?? "",
    address: party?.address ?? "",
    city: party?.city ?? "",
    state: party?.state ?? "",
  });
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (open) setValues(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the record each time the dialog opens
  }, [open, party?.id]);
  const v = f.values;
  const submit = async () => {
    const body = { kind: v.kind, name: v.name.trim(), company: optional(v.company), gstin: optional(v.gstin), phone: optional(v.phone), email: optional(v.email), address: optional(v.address), city: optional(v.city), state: optional(v.state) };
    const out = await run("party", () => (party ? bos.updateParty(party.id, body) : bos.createParty(body)), { success: party ? "Saved" : `${v.kind === "vendor" ? "Vendor" : "Customer"} added`, description: body.name });
    if (out) {
      onSaved?.(out.party);
      onClose();
    }
  };
  const text = (key: "name" | "company" | "gstin" | "phone" | "email" | "address" | "city" | "state", label: string, extra: { type?: string; required?: boolean; full?: boolean; placeholder?: string } = {}) => (
    <Field label={label} full={extra.full}>
      {({ id }) => <Input id={id} type={extra.type ?? "text"} required={extra.required} placeholder={extra.placeholder} value={v[key]} onChange={(e) => f.set(key)(e.target.value)} />}
    </Field>
  );
  return (
    <FormDialog open={open} onClose={onClose} title={party ? `Edit ${party.name}` : "New customer or vendor"} icon={{ tone: "blue", name: "users" }} submitLabel={party ? "Save changes" : "Add"} busy={busy === "party"} onSubmit={submit} wide>
      <FormGrid>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.kind} onChange={(e) => f.set("kind")(e.target.value as PartyKind)}>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
              <option value="both">Customer &amp; vendor</option>
            </Select>
          )}
        </Field>
        {text("name", "Name", { required: true })}
        {text("company", "Company")}
        {text("gstin", "GSTIN", { placeholder: "29ABCDE1234F1Z5" })}
        {text("phone", "Phone", { type: "tel" })}
        {text("email", "Email", { type: "email" })}
        {text("address", "Address", { full: true })}
        {text("city", "City")}
        {text("state", "State", { placeholder: "Place of supply" })}
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Payments ---------- */

export function PaymentDialog({ invoice, onClose }: { invoice: BosInvoice | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ amount: invoice ? String(invoice.balance) : "", paidOn: todayLocal(), method: "bank" as PaymentMethod, reference: "" }));
  const { setValues } = f;
  useEffect(() => {
    if (invoice) setValues({ amount: String(invoice.balance), paidOn: todayLocal(), method: "bank", reference: "" });
  }, [invoice, setValues]);
  const v = f.values;
  const submit = async () => {
    if (!invoice) return;
    const ok = await run("payment", () => bos.recordPayment(invoice.id, { amount: Number(v.amount), paidOn: v.paidOn, method: v.method, reference: optional(v.reference) }), {
      success: "Payment recorded",
      description: `${inr(Number(v.amount))} against ${invoice.invoiceNo}`,
    });
    if (ok) onClose();
  };
  return (
    <FormDialog
      open={invoice !== null}
      onClose={onClose}
      title="Record payment"
      description={invoice ? `${invoice.invoiceNo} · ${invoice.partyName} · balance ${inr(invoice.balance)}` : undefined}
      icon={{ tone: "emerald", name: "wallet" }}
      submitLabel="Record payment"
      busy={busy === "payment"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Amount (₹)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={1} step="0.01" max={invoice?.balance} required value={v.amount} onChange={(e) => f.set("amount")(e.target.value)} />}</Field>
        <Field label="Received on">{({ id }) => <Input id={id} type="date" required value={v.paidOn} onChange={(e) => f.set("paidOn")(e.target.value)} />}</Field>
        <Field label="Method">
          {({ id }) => (
            <Select id={id} value={v.method} onChange={(e) => f.set("method")(e.target.value as PaymentMethod)}>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Reference">{({ id }) => <Input id={id} value={v.reference} placeholder="UTR / cheque no." onChange={(e) => f.set("reference")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Vendor bills ---------- */

export function BillDialog({ open, onClose, vendors }: { open: boolean; onClose: () => void; vendors: ReadonlyArray<BosParty> }) {
  const { session } = useBosApp();
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ partyName: "", partyId: "", billNo: "", billDate: todayLocal(), dueDate: addDaysISO(todayLocal(), session.settings.paymentTermsDays || 15), category: "", amount: "", taxAmount: "" }));
  const { reset } = f;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form each time it opens
  }, [open]);
  const v = f.values;
  const submit = async () => {
    const ok = await run(
      "bill",
      () =>
        bos.createBill({
          partyId: v.partyId || null,
          partyName: v.partyName.trim(),
          billNo: optional(v.billNo),
          billDate: v.billDate,
          dueDate: v.dueDate,
          category: optional(v.category),
          amount: Number(v.amount),
          taxAmount: Number(v.taxAmount || 0),
        }),
      { success: "Bill added", description: "Sent for approval." },
    );
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title="Add vendor bill" icon={{ tone: "amber", name: "file" }} submitLabel="Add bill" busy={busy === "bill"} onSubmit={submit} wide note="Bills go to owners/admins for approval.">
      <FormGrid>
        <PartyField label="Vendor" parties={vendors} required value={v.partyName} onChange={(name, p) => f.setValues((s) => ({ ...s, partyName: name, partyId: p?.id ?? "" }))} />
        <Field label="Bill number">{({ id }) => <Input id={id} value={v.billNo} onChange={(e) => f.set("billNo")(e.target.value)} />}</Field>
        <Field label="Bill date">{({ id }) => <Input id={id} type="date" required value={v.billDate} onChange={(e) => f.set("billDate")(e.target.value)} />}</Field>
        <Field label="Due date">{({ id }) => <Input id={id} type="date" required min={v.billDate} value={v.dueDate} onChange={(e) => f.set("dueDate")(e.target.value)} />}</Field>
        <Field label="Amount before tax (₹)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" required value={v.amount} onChange={(e) => f.set("amount")(e.target.value)} />}</Field>
        <Field label="GST on bill (₹)" hint="Counts as input tax credit">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" inputMode="decimal" min={0} step="0.01" value={v.taxAmount} onChange={(e) => f.set("taxAmount")(e.target.value)} />}
        </Field>
        <Field label="Category" full>{({ id }) => <Input id={id} value={v.category} placeholder="e.g. Panels, Logistics, Rent" onChange={(e) => f.set("category")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Projects ---------- */

export function ProjectDialog({ open, onClose, project, customers }: { open: boolean; onClose: () => void; project?: BosProject | null; customers: ReadonlyArray<BosParty> }) {
  const { run, busy } = useBosAction();
  const init = () => ({
    name: project?.name ?? "",
    partyName: project?.partyName ?? "",
    partyId: project?.partyId ?? "",
    status: (project?.status ?? "lead") as ProjectStatus,
    valueEstimate: project ? String(project.valueEstimate || "") : "",
    startDate: project?.startDate ?? "",
    dueDate: project?.dueDate ?? "",
    siteAddress: project?.siteAddress ?? "",
  });
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (open) setValues(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the record each time the dialog opens
  }, [open, project?.id]);
  const v = f.values;
  const submit = async () => {
    const body = {
      name: v.name.trim(),
      partyId: v.partyId || null,
      partyName: optional(v.partyName),
      status: v.status,
      valueEstimate: Number(v.valueEstimate || 0),
      startDate: v.startDate || null,
      dueDate: v.dueDate || null,
      siteAddress: optional(v.siteAddress),
    };
    const ok = await run("project", () => (project ? bos.updateProject(project.id, body) : bos.createProject(body)), { success: project ? "Project updated" : "Project created", description: body.name });
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title={project ? "Edit project" : "New project"} icon={{ tone: "blue", name: "layers" }} submitLabel={project ? "Save" : "Create project"} busy={busy === "project"} onSubmit={submit} wide>
      <FormGrid>
        <Field label="Project name" full>{({ id }) => <Input id={id} required value={v.name} onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <PartyField label="Customer" parties={customers} value={v.partyName} onChange={(name, p) => f.setValues((s) => ({ ...s, partyName: name, partyId: p?.id ?? "" }))} />
        <Field label="Stage">
          {({ id }) => (
            <Select id={id} value={v.status} onChange={(e) => f.set("status")(e.target.value as ProjectStatus)}>
              {PROJECT_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
              <option value="cancelled">Cancelled</option>
            </Select>
          )}
        </Field>
        <Field label="Estimated value (₹)">{({ id }) => <Input id={id} type="number" inputMode="decimal" min={0} value={v.valueEstimate} onChange={(e) => f.set("valueEstimate")(e.target.value)} />}</Field>
        <Field label="Start date">{({ id }) => <Input id={id} type="date" value={v.startDate} onChange={(e) => f.set("startDate")(e.target.value)} />}</Field>
        <Field label="Due date">{({ id }) => <Input id={id} type="date" min={v.startDate || undefined} value={v.dueDate} onChange={(e) => f.set("dueDate")(e.target.value)} />}</Field>
        <Field label="Site address">{({ id }) => <Input id={id} value={v.siteAddress} onChange={(e) => f.set("siteAddress")(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Masters ---------- */

export function HolidayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ date: todayLocal(), name: "", kind: "public" as BosHoliday["kind"] }));
  const { reset } = f;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form each time it opens
  }, [open]);
  const v = f.values;
  const submit = async () => {
    const ok = await run("holiday", () => bos.createHoliday({ date: v.date, name: v.name.trim(), kind: v.kind }), { success: "Holiday added", description: v.name });
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title="Add holiday" icon={{ tone: "emerald", name: "calendar" }} submitLabel="Add" busy={busy === "holiday"} onSubmit={submit}>
      <div className="bos-stack" style={{ gap: 14 }}>
        <Field label="Date">{({ id }) => <Input id={id} type="date" required value={v.date} onChange={(e) => f.set("date")(e.target.value)} />}</Field>
        <Field label="Name">{({ id }) => <Input id={id} required value={v.name} placeholder="e.g. Diwali" onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={v.kind} onChange={(e) => f.set("kind")(e.target.value as BosHoliday["kind"])}>
              <option value="public">Mandatory (public)</option>
              <option value="optional">Restricted (optional)</option>
              <option value="company">Company holiday</option>
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

export function DepartmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ name: "", code: "" }));
  const { reset } = f;
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset the form each time it opens
  }, [open]);
  const { name, code } = f.values;
  const setName = f.set("name");
  const setCode = f.set("code");
  const submit = async () => {
    const ok = await run("dept", () => bos.createDepartment({ name: name.trim(), code: optional(code) }), { success: "Department created", description: name });
    if (ok) onClose();
  };
  return (
    <FormDialog open={open} onClose={onClose} title="New department" icon={{ tone: "blue", name: "grid" }} submitLabel="Create" busy={busy === "dept"} onSubmit={submit}>
      <div className="bos-stack" style={{ gap: 14 }}>
        <Field label="Name">{({ id }) => <Input id={id} required value={name} placeholder="e.g. Field Operations" onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Code">{({ id }) => <Input id={id} value={code} placeholder="Optional, e.g. OPS" onChange={(e) => setCode(e.target.value)} />}</Field>
      </div>
    </FormDialog>
  );
}

/** Loads the party list once per dialog open (customers or vendors). */
export function usePartyList(kind: "customer" | "vendor", enabled: boolean) {
  const [parties, setParties] = useState<BosParty[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    bos
      .parties({ kind })
      .then((r) => alive && setParties(r.parties))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind, enabled]);
  return useMemo(() => parties, [parties]);
}
