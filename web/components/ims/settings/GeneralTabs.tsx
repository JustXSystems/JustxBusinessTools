"use client";

import { Alert, Field, FormGrid, Input, Select, Textarea } from "@/components/bos";
import type {
  BomIndustryPackId,
  BomPaperDensity,
  BomPaperTemplateId,
  BomPaperTone,
  ImsSettingsMeta,
} from "@/lib/ims/api";
import {
  BOM_INDUSTRY_PACK_META,
  BOM_PAPER_DENSITIES,
  BOM_PAPER_PURPOSE_META,
  BOM_PAPER_TONES,
  bomIndustryPackMeta,
  bomPackFromBusinessType,
  bomPaperPurposeMeta,
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperPurpose,
  normalizeBomPaperTone,
  sampleBomPaperModel,
  withCommercialSample,
} from "@/lib/ims/bom-paper";
import { GST_RATES, inr } from "@/lib/ims/format";
import { GST_STATES, MONTHS, PREFIX_FIELDS, docNoSample, fiscalYearLabel, gstinPlace } from "@/lib/ims/settings";
import "../bom/bom.css";
import { BomPaper } from "../bom/BomPaper";
import { useIms } from "../core";
import { SectionCard, ToggleRow, type TabProps } from "./parts";

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
  const sample = sampleBomPaperModel(draft.businessName || session.brand?.name || "Your business", pack);
  const previewModel = {
    ...withCommercialSample(sample),
    template: purpose,
    industryPack: pack,
    tone,
    density,
    hideMargin,
    customerState: sample.customerState || draft.state || null,
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
                onChange={(e) => set("bomIndustryPack", e.target.value as BomIndustryPackId)}
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

      <SectionCard title="Purchasing" desc="How purchase orders flow from draft to supplier.">
        <FormGrid>
          <Field label="PO approval limit (₹)" error={errors.poApprovalLimit} hint={draft.poApprovalLimit > 0 ? `POs of ${inr(draft.poApprovalLimit)} or more need an approver` : "0 — every submitted PO needs approval"}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step={500} inputMode="decimal" value={draft.poApprovalLimit} onChange={(e) => set("poApprovalLimit", Number(e.target.value))} />}
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
                {[...new Set<number>([...GST_RATES, draft.defaultGstRate])]
                  .sort((a, b) => a - b)
                  .map((r) => (
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
    </fieldset>
  );
}
