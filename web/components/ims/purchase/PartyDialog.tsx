"use client";

import "./purchase.css";
import { useState } from "react";
import { Alert, Button, Dialog, Field, FormGrid, Input, Segmented, Select, Textarea } from "@/components/bos";
import { ims, type PartyKind } from "@/lib/ims/api";
import { inr } from "@/lib/ims/format";
import { purchase, type Party, type PartyInput } from "@/lib/ims/purchase";
import { GST_STATES, gstinPlace, isValidGstin, stateCodeOf } from "@/lib/ims/settings";
import { useImsAction, useImsData } from "../core";

type Form = {
  kind: PartyKind;
  name: string;
  contactPerson: string;
  mobile: string;
  email: string;
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  paymentTermsDays: string;
  creditLimit: string;
  balanceType: "none" | "receivable" | "payable";
  balanceAmount: string;
  accountManagerId: string;
  tags: string;
  notes: string;
};

const toForm = (p: Party | null, kind: PartyKind): Form => ({
  kind: p?.kind ?? kind,
  name: p?.name ?? "",
  contactPerson: p?.contactPerson ?? "",
  mobile: p?.mobile ?? "",
  email: p?.email ?? "",
  gstin: p?.gstin ?? "",
  pan: p?.pan ?? "",
  address: p?.address ?? "",
  city: p?.city ?? "",
  state: p?.state ?? "",
  paymentTermsDays: p?.paymentTermsDays == null ? "" : String(p.paymentTermsDays),
  creditLimit: p?.creditLimit == null ? "" : String(p.creditLimit),
  balanceType: !p?.openingBalance ? "none" : p.openingBalance > 0 ? "receivable" : "payable",
  balanceAmount: p?.openingBalance ? String(Math.abs(p.openingBalance)) : "",
  accountManagerId: p?.accountManagerId == null ? "" : String(p.accountManagerId),
  tags: p?.tags.join(", ") ?? "",
  notes: p?.notes ?? "",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s()-]{6,}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.name.trim()) e.name = "Name is required";
  if (f.mobile.trim() && !PHONE_RE.test(f.mobile.trim())) e.mobile = "Use a valid phone number";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "Use a valid email";
  if (f.gstin.trim() && !isValidGstin(f.gstin)) e.gstin = "15 characters, e.g. 29ABCDE1234F1Z5";
  if (f.pan.trim() && !PAN_RE.test(f.pan.trim().toUpperCase())) e.pan = "PAN looks like ABCDE1234F";
  const terms = Number(f.paymentTermsDays);
  if (f.paymentTermsDays.trim() && (!Number.isInteger(terms) || terms < 0 || terms > 365)) e.paymentTermsDays = "0–365 days";
  if (f.creditLimit.trim() && !(Number(f.creditLimit) >= 0)) e.creditLimit = "Enter a positive amount";
  if (f.balanceType !== "none" && !(Number(f.balanceAmount) > 0)) e.balanceAmount = "Enter the opening amount";
  return e;
}

const nullable = (s: string) => (s.trim() ? s.trim() : null);

/**
 * Add / edit a supplier or customer. Sections: identity, contact, tax & address, terms.
 * State and state code follow the GSTIN automatically.
 */
export function PartyDialog({
  open,
  onClose,
  party,
  defaultKind = "supplier",
  lockKind,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  party: Party | null;
  defaultKind?: PartyKind;
  lockKind?: boolean;
  onSaved?: (party: Party) => void;
}) {
  return open ? <PartyForm key={party?.id ?? "new"} onClose={onClose} party={party} defaultKind={defaultKind} lockKind={lockKind} onSaved={onSaved} /> : <Dialog open={false} onClose={onClose} title="" />;
}

function PartyForm({ onClose, party, defaultKind, lockKind, onSaved }: { onClose: () => void; party: Party | null; defaultKind: PartyKind; lockKind?: boolean; onSaved?: (party: Party) => void }) {
  const { run, busy } = useImsAction();
  const [f, setF] = useState<Form>(() => toForm(party, defaultKind));
  const [touched, setTouched] = useState(false);
  const team = useImsData(() => ims.team().then((r) => r.members.filter((m) => m.active)), []);
  const errors = validate(f);
  const shown = touched ? errors : {};
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const place = gstinPlace(f.gstin);
  const stateCode = place?.stateCode ?? stateCodeOf(f.state);
  const managers = [...(team.data ?? [])].sort((a, b) => Number(b.isAccountManager) - Number(a.isAccountManager) || String(a.name ?? a.email).localeCompare(String(b.name ?? b.email)));

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const amount = Number(f.balanceAmount) || 0;
    const input: PartyInput = {
      kind: f.kind,
      name: f.name.trim(),
      contactPerson: nullable(f.contactPerson),
      mobile: nullable(f.mobile),
      email: nullable(f.email),
      gstin: nullable(f.gstin.toUpperCase()),
      pan: nullable(f.pan.toUpperCase()),
      address: nullable(f.address),
      city: nullable(f.city),
      state: place?.state ?? nullable(f.state),
      stateCode: stateCode,
      paymentTermsDays: f.paymentTermsDays.trim() ? Number(f.paymentTermsDays) : null,
      creditLimit: f.creditLimit.trim() ? Number(f.creditLimit) : null,
      openingBalance: f.balanceType === "none" ? 0 : f.balanceType === "receivable" ? amount : -amount,
      accountManagerId: f.accountManagerId ? Number(f.accountManagerId) : null,
      tags: f.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: nullable(f.notes),
    };
    const out = await run("party-save", () => (party ? purchase.updateParty(party.id, input) : purchase.createParty(input)), {
      success: party ? "Saved" : f.kind === "customer" ? "Customer added" : "Supplier added",
      description: input.name,
    });
    if (out) {
      onSaved?.(out.party);
      onClose();
    }
  };

  const kindWord = f.kind === "customer" ? "customer" : f.kind === "both" ? "party" : "supplier";
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      dismissible={false}
      title={party ? `Edit ${party.name}` : `Add ${kindWord}`}
      description={party ? "Changes apply to new documents; issued POs and invoices keep their snapshot." : "Only the name is required — add GSTIN for correct CGST/SGST vs IGST on documents."}
      actionsNote={touched && Object.keys(errors).length ? <span style={{ color: "var(--bos-coral-600)" }}>Fix the highlighted fields</span> : undefined}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy === "party-save"}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy === "party-save"}>
            {busy === "party-save" ? "Saving…" : party ? "Save changes" : `Add ${kindWord}`}
          </Button>
        </>
      }
    >
      <form
        className="ims-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="ims-form-section" aria-labelledby="pf-identity">
          <h3 className="ims-form-section-title" id="pf-identity">
            Identity
          </h3>
          <FormGrid>
            <Field label="Type" full>
              {() => (
                <Segmented<PartyKind>
                  role="radio"
                  size="sm"
                  aria-label="Party type"
                  options={(lockKind ? [f.kind] : (["supplier", "customer", "both"] as PartyKind[])).map((k) => ({ value: k, label: k === "both" ? "Supplier & customer" : k === "supplier" ? "Supplier" : "Customer" }))}
                  value={f.kind}
                  onChange={(k) => set("kind", k)}
                />
              )}
            </Field>
            <Field label="Business name *" error={shown.name}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Havells India Distribution" maxLength={200} />}
            </Field>
            <Field label="Tags" hint="Comma separated — e.g. preferred, cables">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="preferred, local" />}
            </Field>
          </FormGrid>
        </section>

        <section className="ims-form-section" aria-labelledby="pf-contact">
          <h3 className="ims-form-section-title" id="pf-contact">
            Contact
          </h3>
          <FormGrid>
            <Field label="Contact person">
              {({ id }) => <Input id={id} value={f.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Mobile" error={shown.mobile}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="tel" inputMode="tel" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="+91 90000 00000" />}
            </Field>
            <Field label="Email" error={shown.email} full>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="orders@example.com" />}
            </Field>
          </FormGrid>
        </section>

        <section className="ims-form-section" aria-labelledby="pf-tax">
          <h3 className="ims-form-section-title" id="pf-tax">
            Tax &amp; address
          </h3>
          <FormGrid>
            <Field label="GSTIN" error={shown.gstin} hint={place ? `Registered in ${place.state} (${place.stateCode})` : "Leave blank for unregistered parties"}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={f.gstin}
                  maxLength={15}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().replace(/\s/g, "");
                    const derived = gstinPlace(v);
                    setF((s) => ({ ...s, gstin: v, ...(derived ? { state: derived.state, pan: s.pan || v.slice(2, 12) } : {}) }));
                  }}
                  placeholder="29ABCDE1234F1Z5"
                  style={{ textTransform: "uppercase" }}
                />
              )}
            </Field>
            <Field label="PAN" error={shown.pan}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={f.pan} maxLength={10} onChange={(e) => set("pan", e.target.value.toUpperCase())} placeholder="ABCDE1234F" style={{ textTransform: "uppercase" }} />}
            </Field>
            <Field label="Address" full>
              {({ id }) => <Textarea id={id} rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />}
            </Field>
            <Field label="City">
              {({ id }) => <Input id={id} value={f.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />}
            </Field>
            <Field label="State" hint={stateCode ? `GST state code ${stateCode}` : place ? undefined : "Decides CGST + SGST vs IGST"}>
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={f.state} onChange={(e) => set("state", e.target.value)} disabled={Boolean(place)}>
                  <option value="">Select state…</option>
                  {f.state && !GST_STATES.some((s) => s.name === f.state) ? <option value={f.state}>{f.state}</option> : null}
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FormGrid>
        </section>

        <section className="ims-form-section" aria-labelledby="pf-terms">
          <h3 className="ims-form-section-title" id="pf-terms">
            Terms &amp; balances
          </h3>
          <FormGrid>
            <Field label="Payment terms (days)" error={shown.paymentTermsDays} hint="Blank uses the default from Settings">
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} max={365} inputMode="numeric" value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} placeholder="30" />}
            </Field>
            <Field label="Credit limit (₹)" error={shown.creditLimit} hint={f.creditLimit && Number(f.creditLimit) > 0 ? inr(Number(f.creditLimit)) : undefined}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step="any" inputMode="decimal" value={f.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} />}
            </Field>
            <Field label="Opening balance" full>
              {() => (
                <Segmented<Form["balanceType"]>
                  role="radio"
                  size="sm"
                  aria-label="Opening balance type"
                  options={[
                    { value: "none", label: "None" },
                    { value: "receivable", label: "They owe us" },
                    { value: "payable", label: "We owe them" },
                  ]}
                  value={f.balanceType}
                  onChange={(v) => set("balanceType", v)}
                />
              )}
            </Field>
            {f.balanceType !== "none" ? (
              <Field label="Opening amount (₹) *" error={shown.balanceAmount}>
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step="any" inputMode="decimal" value={f.balanceAmount} onChange={(e) => set("balanceAmount", e.target.value)} />}
              </Field>
            ) : null}
            <Field label="Account manager" hint={team.data && !team.data.some((m) => m.isAccountManager) ? "Flag account managers in Settings → Team" : undefined}>
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={f.accountManagerId} onChange={(e) => set("accountManagerId", e.target.value)}>
                  <option value="">{team.data === null ? "Loading…" : "Unassigned"}</option>
                  {managers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                      {m.isAccountManager ? " ★" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Notes" full>
              {({ id }) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} placeholder="Delivery days, bank details, preferred contact time…" />}
            </Field>
          </FormGrid>
        </section>
        {party && !party.active ? (
          <Alert tone="amber" title="This party is archived">
            It won&apos;t appear in pickers until restored.
          </Alert>
        ) : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
