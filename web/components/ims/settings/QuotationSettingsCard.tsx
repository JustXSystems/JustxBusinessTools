"use client";

import { useState } from "react";
import { Alert, Button, Field, FormGrid, Input, Select, Textarea, useToast } from "@/components/bos";
import type { ImsQuoteSettings } from "@/lib/ims/api";
import { DEFAULT_IMS_QUOTE_SETTINGS, imsQuotations } from "@/lib/ims/quotations";
import { BASE_TERMS, quoteTermsForOptions, type EngagementKey } from "@/lib/quotation-v1";
import { QUOTATION_EMAIL_TEMPLATES } from "@/lib/quotation-email-templates";
import { useIms } from "../core";
import { SectionCard, ToggleRow, type TabProps } from "./parts";

const ENGAGEMENT_OPTIONS = quoteTermsForOptions();

export function QuotationSettingsCard({ draft, set, readOnly }: TabProps) {
  const qs: ImsQuoteSettings = {
    ...DEFAULT_IMS_QUOTE_SETTINGS,
    ...(draft.quoteSettings ?? {}),
    termsByEngagement: { ...(draft.quoteSettings?.termsByEngagement ?? {}) },
  };
  const [activeEng, setActiveEng] = useState<EngagementKey>("epc");

  const patch = (next: Partial<ImsQuoteSettings>) => set("quoteSettings", { ...qs, ...next });
  const setTerm = (eng: EngagementKey, value: string) => {
    const terms = { ...(qs.termsByEngagement ?? {}) };
    if (value.trim()) terms[eng] = value;
    else delete terms[eng];
    patch({ termsByEngagement: terms });
  };

  return (
    <SectionCard
      title="Quotations (V1 parity)"
      desc="Numbering, letterhead extras, sheet defaults, email template and per-engagement terms for IMS Quotations. Business name, logo, GSTIN, address and accent come from Business Profile."
    >
      <FormGrid>
        <Field label="Quotation prefix" hint="Blank = auto 3-letter code from company name (e.g. JXS)">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={qs.quotePrefix}
              maxLength={8}
              placeholder="e.g. QT"
              onChange={(e) => patch({ quotePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
            />
          )}
        </Field>
        <Field label="Numbering format" hint="V1 Category/For format keeps existing client numbering seamless">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={qs.numberingMode}
              onChange={(e) => patch({ numberingMode: e.target.value as ImsQuoteSettings["numberingMode"] })}
            >
              <option value="v1_category">V1 Category / For (PREFIX-SOL/INST-YYYY/MM-0001)</option>
              <option value="ims_fy">IMS Fiscal Year (PREFIX/26-27/0001)</option>
            </Select>
          )}
        </Field>
        <Field label="Default validity (days)" hint="Auto-fills Valid Till from Quotation Date">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              min={0}
              max={365}
              value={qs.defaultValidityDays}
              onChange={(e) => patch({ defaultValidityDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
            />
          )}
        </Field>
        <Field label="Default email template" hint="Used when sending quotations via Email">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={qs.defaultEmailTemplateId || "classic"}
              onChange={(e) => patch({ defaultEmailTemplateId: e.target.value })}
            >
              {QUOTATION_EMAIL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Letterhead tagline">
          {({ id }) => (
            <Input
              id={id}
              value={qs.tagline}
              maxLength={160}
              placeholder="Quotations · Service · Sales"
              onChange={(e) => patch({ tagline: e.target.value })}
            />
          )}
        </Field>
        <Field label="Jurisdiction / Place" hint="Printed on letterhead & default terms">
          {({ id }) => (
            <Input
              id={id}
              value={qs.place}
              maxLength={80}
              placeholder="Bengaluru"
              onChange={(e) => patch({ place: e.target.value })}
            />
          )}
        </Field>
        <Field label="Landline">
          {({ id }) => (
            <Input id={id} value={qs.landline} maxLength={40} placeholder="080-..." onChange={(e) => patch({ landline: e.target.value })} />
          )}
        </Field>
        <Field label="Website">
          {({ id }) => (
            <Input id={id} value={qs.website} maxLength={160} placeholder="https://..." onChange={(e) => patch({ website: e.target.value })} />
          )}
        </Field>
        <Field label="Sales email" hint="Optional CC / letterhead sales contact">
          {({ id }) => (
            <Input id={id} type="email" value={qs.salesEmail} maxLength={180} onChange={(e) => patch({ salesEmail: e.target.value })} />
          )}
        </Field>
        <Field label="Manager email" hint="Optional escalation / approval contact">
          {({ id }) => (
            <Input id={id} type="email" value={qs.managerEmail} maxLength={180} onChange={(e) => patch({ managerEmail: e.target.value })} />
          )}
        </Field>
        <Field label="Default GST note" hint="Shown beside totals on the quote sheet (blank = built-in default)">
          {({ id }) => (
            <Input
              id={id}
              value={qs.defaultGstNote}
              maxLength={300}
              placeholder="e.g. GST as applicable on date of invoicing."
              onChange={(e) => patch({ defaultGstNote: e.target.value })}
            />
          )}
        </Field>
        <Field label="Default buyback / trade-in label" hint="Label for negative line amounts">
          {({ id }) => (
            <Input
              id={id}
              value={qs.defaultBuybackLabel}
              maxLength={120}
              placeholder="Less: Old Buyback"
              onChange={(e) => patch({ defaultBuybackLabel: e.target.value })}
            />
          )}
        </Field>
      </FormGrid>

      <ToggleRow
        label="Show GST% and GST Amount columns by default"
        desc="New quotations start with GST columns visible on the live preview and PDF. Can still be toggled per quotation."
        checked={qs.defaultShowGstColumns}
        disabled={readOnly}
        onChange={(v) => patch({ defaultShowGstColumns: v })}
      />

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <b style={{ fontSize: 13.5 }}>Default Terms &amp; Notes per Engagement (&ldquo;For&rdquo;)</b>
            <div style={{ fontSize: 12, color: "var(--bos-muted)" }}>
              Leave blank to use the built-in default. Use <code>{"{WARRANTY}"}</code> to auto-insert the category warranty line.
            </div>
          </div>
          <Select
            aria-label="Engagement type for terms"
            value={activeEng}
            onChange={(e) => setActiveEng(e.target.value as EngagementKey)}
            style={{ maxWidth: 280 }}
          >
            {ENGAGEMENT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label} ({opt.categories})
              </option>
            ))}
          </Select>
        </div>
        <Textarea
          rows={6}
          value={qs.termsByEngagement[activeEng] ?? ""}
          placeholder={BASE_TERMS[activeEng]}
          onChange={(e) => setTerm(activeEng, e.target.value)}
        />
      </div>
    </SectionCard>
  );
}

export function QuotationRemindersCard({ readOnly }: { readOnly: boolean }) {
  const { session } = useIms();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const isOwner = session.access.role === "owner";

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await imsQuotations.runFollowUpRemindersNow();
      const summary = `Date ${r.date}: ${r.due} due · ${r.sent} sent · ${r.queued} queued · ${r.skipped} skipped`;
      setLastResult(summary);
      toast.show({ tone: "emerald", title: `Follow-up reminders ran (${r.due} due)` });
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Failed to run follow-up reminders" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <SectionCard
      title="Quotation follow-up reminders"
      desc="Daily automated follow-up reminders cover both IMS Quotations and standalone Quotation V1 quotes whose follow-up date is today."
    >
      <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--bos-muted)" }}>
          Email recipients, CC owners, and WhatsApp numbers are inherited from Business Profile → Send settings.
        </div>
        <Button size="sm" variant="secondary" disabled={readOnly || !isOwner || running} onClick={runNow}>
          {running ? "Running…" : "Run today's reminders now"}
        </Button>
      </div>
      {lastResult ? (
        <Alert tone="blue" title="Last manual run">
          {lastResult}
        </Alert>
      ) : null}
    </SectionCard>
  );
}
