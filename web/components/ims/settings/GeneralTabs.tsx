"use client";

import { Alert, Button, Field, FormGrid, Input, Select, Textarea } from "@/components/bos";
import type {
  BomIndustryPackId,
  BomPaperDensity,
  BomPaperTemplateId,
  BomPaperTone,
  BomScheduleColumnId,
  ImsSettingsMeta,
} from "@/lib/ims/api";
import {
  BOM_COLUMN_LABEL,
  BOM_CONFIGURABLE_COLUMNS,
  BOM_INDUSTRY_PACK_META,
  BOM_PAPER_DENSITIES,
  BOM_PAPER_PURPOSE_META,
  BOM_PAPER_TONES,
  BOM_REQUIRED_COLUMNS,
  bomIndustryPackMeta,
  bomPackFromBusinessType,
  bomPaperPurposeMeta,
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperPurpose,
  normalizeBomPaperTone,
  normalizeBomScheduleColumns,
  sampleBomPaperModel,
  scheduleColumnsFor,
  withCommercialSample,
  type BomScheduleColumn,
} from "@/lib/ims/bom-paper";
import { COMMON_CURRENCIES, methodLabel, PAY_METHODS, POS_PAY_METHODS } from "@/lib/ims/finance";
import { gstRatesFor, inr } from "@/lib/ims/format";
import { GST_STATES, MONTHS, PREFIX_FIELDS, docNoSample, fiscalYearLabel, gstinPlace } from "@/lib/ims/settings";
import "../bom/bom.css";
import { BomPaper } from "../bom/BomPaper";
import { useIms } from "../core";
import { MethodPicker, NumberListInput, SectionCard, ToggleRow, type TabProps } from "./parts";

export const EXCISE_TYPES = new Set(["liquor_retail", "bar_pub"]);

export function BusinessTab({ draft, set, errors, readOnly, meta }: TabProps & { meta: ImsSettingsMeta }) {
  const { session } = useIms();
  const place = gstinPlace(draft.gstin);
  const exciseForced = EXCISE_TYPES.has(draft.businessType);

  return (
    <fieldset className="ims-set-fieldset" disabled={readOnly}>
      <SectionCard title="Business profile" desc="Printed on purchase orders, invoices and bills, and used to decide CGST + SGST versus IGST.">
        <FormGrid>
          <Field label="Business name" error={errors.businessName}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={draft.businessName} maxLength={200} onChange={(e) => set("businessName", e.target.value)} />}
          </Field>
          <Field label="Business type" hint={exciseForced ? "Excise tracking is always on for this type." : undefined}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={draft.businessType}
                onChange={(e) => {
                  const next = e.target.value;
                  set("businessType", next);
                  if (EXCISE_TYPES.has(next)) set("exciseEnabled", true);
                  // Suggest industry pack from business type when still on general default.
                  if (!draft.bomIndustryPack || draft.bomIndustryPack === "general") {
                    set("bomIndustryPack", bomPackFromBusinessType(next));
                  }
                }}
              >
                {meta.businessTypes.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint={place ? `Registered in ${place.state} (${place.stateCode})` : "15 characters, e.g. 29ABCDE1234F1Z5"}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="ims-mono"
                value={draft.gstin ?? ""}
                maxLength={15}
                placeholder="Unregistered"
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().replace(/\s/g, "");
                  set("gstin", v || null);
                  const p = gstinPlace(v);
                  if (p) {
                    set("state", p.state);
                    set("stateCode", p.stateCode);
                  }
                }}
              />
            )}
          </Field>
          <Field label="State" hint={place ? "Taken from the GSTIN" : "Place of supply for intra/inter-state GST"}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={GST_STATES.find((s) => s.code === draft.stateCode)?.code ?? ""}
                disabled={Boolean(place)}
                onChange={(e) => {
                  const s = GST_STATES.find((x) => x.code === e.target.value);
                  set("state", s?.name ?? null);
                  set("stateCode", s?.code ?? null);
                }}
              >
                <option value="">Select state…</option>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Address" full>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={500} value={draft.address ?? ""} onChange={(e) => set("address", e.target.value || null)} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="tel" inputMode="tel" maxLength={40} value={draft.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />}
          </Field>
          <Field label="Email" error={errors.email}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="email" maxLength={180} value={draft.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />}
          </Field>
          <Field
            label="Base currency"
            error={errors.baseCurrency}
            hint="Invoices and bills in another currency lock an FX rate against this base. Each document also stores its base-currency total."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                className="ims-mono"
                list="ims-base-currency-options"
                maxLength={3}
                placeholder="INR"
                value={draft.baseCurrency ?? "INR"}
                onChange={(e) => set("baseCurrency", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              />
            )}
          </Field>
          <datalist id="ims-base-currency-options">
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Field label="UPI ID (VPA)" hint="Printed as a payment QR on issued tax invoices when a balance is due.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                className="ims-mono"
                maxLength={80}
                placeholder="business@upi"
                value={draft.bankUpi ?? ""}
                onChange={(e) => set("bankUpi", e.target.value.trim() || null)}
              />
            )}
          </Field>
          <Field label="Bank account name">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={draft.bankAccountName ?? ""} onChange={(e) => set("bankAccountName", e.target.value || null)} />}
          </Field>
          <Field label="Account number">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} className="ims-mono" maxLength={40} value={draft.bankAccountNo ?? ""} onChange={(e) => set("bankAccountNo", e.target.value || null)} />}
          </Field>
          <Field label="IFSC">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                className="ims-mono"
                maxLength={20}
                value={draft.bankIfsc ?? ""}
                onChange={(e) => set("bankIfsc", e.target.value.toUpperCase() || null)}
              />
            )}
          </Field>
          <Field label="Bank name">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={draft.bankName ?? ""} onChange={(e) => set("bankName", e.target.value || null)} />}
          </Field>
          <ToggleRow
            label="MSME registered"
            desc="Shows UDYAM / MSME declaration on tax invoice paper"
            checked={draft.msmeRegistered}
            onChange={(v) => set("msmeRegistered", v)}
          />
          <Field label="UDYAM registration no." hint={draft.msmeRegistered ? "Printed next to MSME declaration" : "Enable MSME registered to print"}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                className="ims-mono"
                maxLength={32}
                disabled={!draft.msmeRegistered}
                placeholder="UDYAM-XX-00-0000000"
                value={draft.msmeUdyam ?? ""}
                onChange={(e) => set("msmeUdyam", e.target.value.trim().toUpperCase() || null)}
              />
            )}
          </Field>
          <Field label="Financial year starts in" hint={`Current year: FY ${fiscalYearLabel(session.today, draft.fiscalYearStart)}`}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={draft.fiscalYearStart} onChange={(e) => set("fiscalYearStart", Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
      </SectionCard>

      <SectionCard title="Excise" desc="Tracks bottle volumes and excise categories on items for liquor retail and bars.">
        <ToggleRow
          label="Enable excise tracking"
          desc={exciseForced ? "Required for liquor retail and bar / pub businesses." : "Adds volume (ml) and excise category to items and reports."}
          checked={draft.exciseEnabled || exciseForced}
          disabled={readOnly || exciseForced}
          onChange={(v) => set("exciseEnabled", v)}
        />
      </SectionCard>
    </fieldset>
  );
}

export function DocumentsTab({ draft, set, errors, readOnly }: TabProps) {
  const { session } = useIms();
  const today = session.today;
  const purpose = normalizeBomPaperPurpose(draft.bomPaperTemplate);
  const pack = normalizeBomIndustryPack(draft.bomIndustryPack);
  const tone = normalizeBomPaperTone(draft.bomPaperTone);
  const density = normalizeBomPaperDensity(draft.bomPaperDensity);
  const hideMargin = Boolean(draft.bomHideMargin);
  const purposeMeta = bomPaperPurposeMeta(purpose);
  const packMeta = bomIndustryPackMeta(pack);
  const packDefaultCols = scheduleColumnsFor(purpose, pack);
  const selectedCols = normalizeBomScheduleColumns(
    draft.bomScheduleColumns?.length ? draft.bomScheduleColumns : packDefaultCols,
    packDefaultCols,
  );
  const usingPackDefaults = !draft.bomScheduleColumns?.length;
  const toggleColumn = (col: BomScheduleColumn) => {
    if ((BOM_REQUIRED_COLUMNS as readonly string[]).includes(col)) return;
    const next = new Set(selectedCols);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    set("bomScheduleColumns", normalizeBomScheduleColumns([...next], packDefaultCols) as BomScheduleColumnId[]);
  };
  const sample = sampleBomPaperModel(draft.businessName || session.brand?.name || "Your business", pack);
  const previewModel = {
    ...withCommercialSample(sample),
    template: purpose,
    industryPack: pack,
    tone,
    density,
    hideMargin,
    customerState: sample.customerState || draft.state || null,
    scheduleColumns: selectedCols,
  };

  return (
    <fieldset className="ims-set-fieldset" disabled={readOnly}>
      <SectionCard
        title="BOM document purpose"
        desc="Five document jobs for preview and print/PDF — pick purpose, industry pack, and tone. Legacy skins migrate automatically."
      >
        <div className="ims-bom-tpl-mini-grid" role="radiogroup" aria-label="BOM document purpose">
          {BOM_PAPER_PURPOSE_META.map((t) => {
            const selected = purpose === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={`${t.label} — ${t.tagline}`}
                className={`ims-bom-tpl-mini${selected ? " is-selected" : ""}`}
                disabled={readOnly}
                onClick={() => set("bomPaperTemplate", t.id as BomPaperTemplateId)}
              >
                <span className={`ims-bom-tpl-swatch ims-bom-tpl-swatch--${t.id}`} aria-hidden>
                  <span className="ims-bom-tpl-swatch-rail" />
                  <span className="ims-bom-tpl-swatch-block is-a" />
                  <span className="ims-bom-tpl-swatch-block is-b" />
                  <span className="ims-bom-tpl-swatch-lines" />
                </span>
                <span className="ims-bom-tpl-mini-label">{t.short}</span>
              </button>
            );
          })}
        </div>

        <div className="ims-bom-tpl-inspect" aria-live="polite">
          <div className="ims-bom-tpl-inspect-main">
            <div className="ims-bom-tpl-inspect-title">
              <strong>{purposeMeta.label}</strong>
              <span className="ims-bom-tpl-era">{packMeta.short}</span>
            </div>
            <p>{purposeMeta.tagline}</p>
            <div className="ims-bom-tpl-audience">{purposeMeta.audience}</div>
          </div>
          <ul className="ims-bom-tpl-inspect-feats">
            {purposeMeta.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>

        <FormGrid>
          <Field label="Industry pack" hint={packMeta.tagline}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={pack}
                onChange={(e) => {
                  set("bomIndustryPack", e.target.value as BomIndustryPackId);
                  // Follow the new pack’s defaults until the user customizes columns again.
                  set("bomScheduleColumns", null);
                }}
              >
                {BOM_INDUSTRY_PACK_META.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tone" hint="Visual voice of the paper">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={tone}
                onChange={(e) => set("bomPaperTone", e.target.value as BomPaperTone)}
              >
                {BOM_PAPER_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Density" hint="Table padding for print">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={density}
                onChange={(e) => set("bomPaperDensity", e.target.value as BomPaperDensity)}
              >
                {BOM_PAPER_DENSITIES.map((d) => (
                  <option key={d} value={d}>
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>

        <ToggleRow
          label="Hide margin on customer PDF"
          desc="Fold margin into supply total — internal cost stays in the builder"
          checked={hideMargin}
          onChange={(v) => set("bomHideMargin", v)}
          disabled={readOnly}
        />

        <ToggleRow
          label="Confirm needs Approvals"
          desc="Only owners and roles with Approvals can confirm a BOM — staff can still draft and edit"
          checked={Boolean(draft.bomConfirmNeedsApproval)}
          onChange={(v) => set("bomConfirmNeedsApproval", v)}
          disabled={readOnly}
        />

        <ToggleRow
          label="Quotation reference required"
          desc="BOM confirm is blocked until a quotation reference is entered — use the quotation field on the BOM composer"
          checked={Boolean(draft.bomRequireQuotationRef)}
          onChange={(v) => set("bomRequireQuotationRef", v)}
          disabled={readOnly}
        />

        <div className="ims-bom-col-config" aria-label="Schedule columns">
          <div className="ims-bom-col-config-head">
            <div>
              <div className="ims-bom-col-config-title">Schedule columns</div>
              <div className="ims-bom-col-config-desc">
                Choose which columns appear on preview and PDF. Item and Qty stay on. Field purpose hides rate/amount automatically.
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly || usingPackDefaults}
              onClick={() => set("bomScheduleColumns", null)}
            >
              Reset to pack
            </Button>
          </div>
          <div className="ims-bom-col-chips" role="group">
            {BOM_CONFIGURABLE_COLUMNS.map((col) => {
              const on = selectedCols.includes(col);
              const locked = (BOM_REQUIRED_COLUMNS as readonly string[]).includes(col);
              return (
                <button
                  key={col}
                  type="button"
                  className={`ims-bom-col-chip${on ? " is-on" : ""}${locked ? " is-locked" : ""}`}
                  aria-pressed={on}
                  disabled={readOnly || locked}
                  title={locked ? "Required on every schedule" : BOM_COLUMN_LABEL[col]}
                  onClick={() => toggleColumn(col)}
                >
                  {BOM_COLUMN_LABEL[col]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ims-bom-tpl-preview" aria-label="BOM template preview">
          <div className="ims-bom-tpl-preview-label">
            Live preview · {purposeMeta.label} · {packMeta.label}
          </div>
          <div className="ims-bom-tpl-preview-frame">
            <BomPaper model={previewModel} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Document numbering" desc="Format matches Quotation V1: CompanyCode-DOCTYPE-YYYY/MM-XXXX. Sequence restarts each calendar month. DOC TYPE uses letters, digits and dashes only (up to 12).">
        <div className="ims-prefix-grid">
          {PREFIX_FIELDS.map((f) => (
            <div key={f.key} className="ims-prefix">
              <Field label={f.label} hint={errors[f.key] ? undefined : f.hint} error={errors[f.key]}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} size="sm" className="ims-mono" maxLength={12} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value.toUpperCase().replace(/\s/g, ""))} />
                )}
              </Field>
              <div className="ims-prefix-sample" aria-live="polite">
                Next: <b>{docNoSample(draft[f.key], today, draft.businessName)}</b>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Purchasing & sales approvals" desc="How purchase orders and large invoices flow to Approvals.">
        <FormGrid>
          <Field label="PO approval limit (₹)" error={errors.poApprovalLimit} hint={draft.poApprovalLimit > 0 ? `POs of ${inr(draft.poApprovalLimit)} or more need an approver` : "0 — every submitted PO needs approval"}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step={500} inputMode="decimal" value={draft.poApprovalLimit} onChange={(e) => set("poApprovalLimit", Number(e.target.value))} />}
          </Field>
          <Field
            label="Invoice approval limit (₹)"
            error={errors.invoiceApprovalLimit}
            hint={
              draft.invoiceApprovalLimit > 0
                ? `Tax invoices / retainers of ${inr(draft.invoiceApprovalLimit)} or more queue for Approvals on Save & issue`
                : "0 — issue immediately (no invoice approval)"
            }
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                type="number"
                min={0}
                step={500}
                inputMode="decimal"
                value={draft.invoiceApprovalLimit}
                onChange={(e) => set("invoiceApprovalLimit", Number(e.target.value))}
              />
            )}
          </Field>
          <Field label="Delete untouched drafts after (days)" error={errors.draftPoPurgeDays} hint={draft.draftPoPurgeDays > 0 ? `Drafts idle for ${draft.draftPoPurgeDays} days are removed` : "0 — keep drafts forever"}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} max={365} value={draft.draftPoPurgeDays} onChange={(e) => set("draftPoPurgeDays", Number(e.target.value))} />}
          </Field>
          <Field label="Default payment terms (days)" error={errors.paymentTermsDays} hint="Used when a party has no terms of its own">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} max={365} value={draft.paymentTermsDays} onChange={(e) => set("paymentTermsDays", Number(e.target.value))} />}
          </Field>
          <Field label="Default GST rate" hint="Pre-filled on new items and blank lines">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={draft.defaultGstRate} onChange={(e) => set("defaultGstRate", Number(e.target.value))}>
                {gstRatesFor(draft, [draft.defaultGstRate]).map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Default terms & conditions" full hint="Printed at the foot of new purchase orders">
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={4} maxLength={4000} value={draft.terms ?? ""} onChange={(e) => set("terms", e.target.value || null)} />}
          </Field>
        </FormGrid>
      </SectionCard>

      <SectionCard
        title="Sales & payment defaults"
        desc="Pre-fills for the invoice editor, counter (POS), payment dialogs and installment plans. Existing documents are never changed."
      >
        <FormGrid>
          <Field label="Payment term chips (days)" error={errors.paymentTermPresets} hint="Quick-pick buttons on invoices; 0 shows as “On receipt”. Up to 12, each 0–365.">
            {({ id, describedBy, invalid }) => (
              <NumberListInput id={id} describedBy={describedBy} invalid={invalid} readOnly={readOnly} values={draft.paymentTermPresets ?? []} onChange={(v) => set("paymentTermPresets", v)} placeholder="0, 7, 15, 30, 45, 60" />
            )}
          </Field>
          <Field label="GST rate options (%)" error={errors.gstRateOptions} hint="Offered in line editors, items, categories and the default GST list. Up to 20 rates.">
            {({ id, describedBy, invalid }) => (
              <NumberListInput id={id} describedBy={describedBy} invalid={invalid} readOnly={readOnly} values={draft.gstRateOptions ?? []} onChange={(v) => set("gstRateOptions", v)} placeholder="0, 5, 12, 18, 28" />
            )}
          </Field>
          <Field label="Default retention %" error={errors.defaultRetentionPct} hint="Pre-filled on new invoices (0 = none)">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} max={100} step="0.01" value={draft.defaultRetentionPct ?? 0} onChange={(e) => set("defaultRetentionPct", Number(e.target.value))} />
            )}
          </Field>
          <Field label="Default payment method" error={errors.defaultPayMethod} hint="Pre-selected when recording receipts and expenses">
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} value={draft.defaultPayMethod} onChange={(e) => set("defaultPayMethod", e.target.value)}>
                {(draft.payMethods ?? []).map((m) => (
                  <option key={m} value={m}>
                    {methodLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Payment methods" full error={errors.payMethods} hint="Methods offered in payment dialogs. At least one stays on.">
            {() => (
              <MethodPicker
                label="Payment methods"
                readOnly={readOnly}
                options={PAY_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
                values={draft.payMethods ?? []}
                onChange={(next) => {
                  set("payMethods", next);
                  if (!next.includes(draft.defaultPayMethod)) set("defaultPayMethod", next.includes("cash") ? "cash" : (next[0] ?? "cash"));
                }}
              />
            )}
          </Field>
          <Field label="Counter (POS) methods" full error={errors.posPayMethods} hint="Cash, UPI and card are the only methods the counter supports.">
            {() => (
              <MethodPicker
                label="Counter methods"
                readOnly={readOnly}
                options={POS_PAY_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
                values={draft.posPayMethods ?? []}
                onChange={(next) => set("posPayMethods", next)}
              />
            )}
          </Field>
          <Field label="Default installments" error={errors.defaultInstallmentCount} hint="Pre-filled in the payment-plan form (1–60, not above the maximum)">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={60} value={draft.defaultInstallmentCount ?? 3} onChange={(e) => set("defaultInstallmentCount", Number(e.target.value))} />
            )}
          </Field>
          <Field label="Months between installments" error={errors.installmentEveryMonths} hint="Gap used when a plan is split automatically (1–12)">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={12} value={draft.installmentEveryMonths ?? 1} onChange={(e) => set("installmentEveryMonths", Number(e.target.value))} />
            )}
          </Field>
          <Field label="Max installments per plan" error={errors.maxInstallments} hint="Ceiling enforced by the server (1–60)">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={60} value={draft.maxInstallments ?? 60} onChange={(e) => set("maxInstallments", Number(e.target.value))} />
            )}
          </Field>
        </FormGrid>
        <ToggleRow
          label="Round new invoices to the nearest rupee"
          desc="Default for the “Round total” switch on new invoices"
          checked={draft.defaultRoundToRupee ?? true}
          disabled={readOnly}
          onChange={(v) => set("defaultRoundToRupee", v)}
        />
        <ToggleRow
          label="Round counter (POS) bills to the nearest rupee"
          desc="Applies to every counter sale"
          checked={draft.posRoundToRupee ?? true}
          disabled={readOnly}
          onChange={(v) => set("posRoundToRupee", v)}
        />
      </SectionCard>

      <SectionCard title="Stock rules">
        <ToggleRow
          label="Allow negative stock"
          desc="Let stock-out and sales go below zero. Keep this off unless you bill before receiving goods."
          checked={draft.allowNegativeStock}
          disabled={readOnly}
          onChange={(v) => set("allowNegativeStock", v)}
        />
        {draft.allowNegativeStock ? (
          <Alert tone="amber" title="Negative stock is allowed">
            Reports may show negative quantities until goods are received.
          </Alert>
        ) : null}
      </SectionCard>

      <SectionCard title="Print & attachments" desc="Batch printing and file upload limits used across Sales, Bills and Audit.">
        <FormGrid>
          <Field
            label="Print pack max"
            error={errors.printPackMax}
            hint={`Sales “Print pack” includes at most this many selected invoices (currently ${draft.printPackMax ?? 25})`}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                type="number"
                min={1}
                max={200}
                value={draft.printPackMax ?? 25}
                onChange={(e) => set("printPackMax", Number(e.target.value))}
              />
            )}
          </Field>
          <Field
            label="Attachment max size (MB)"
            error={errors.attachmentMaxBytes}
            hint="Invoice, bill and audit uploads. Larger files should be linked by URL instead."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                type="number"
                min={0.25}
                max={20}
                step={0.25}
                value={Number((((draft.attachmentMaxBytes ?? 2 * 1024 * 1024) / (1024 * 1024)) * 100).toFixed(0)) / 100}
                onChange={(e) => set("attachmentMaxBytes", Math.round(Number(e.target.value) * 1024 * 1024))}
              />
            )}
          </Field>
        </FormGrid>
      </SectionCard>
    </fieldset>
  );
}
