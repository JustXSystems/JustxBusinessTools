"use client";

import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Field, FilterChip, FormGrid, Input, Select, Textarea } from "@/components/bos";
import type { AuditRuleSettings, DunningLevel, DunningTone, ReminderSettings, ReminderTemplate } from "@/lib/ims/api";
import { DEFAULT_DUNNING_LEVELS, DUNNING_TONE_LABEL } from "@/lib/ims/finance";
import { addDaysISO, dateLabel, inrExact } from "@/lib/ims/format";
import {
  DEFAULT_AUDIT_RULE_SETTINGS,
  DEFAULT_AUDIT_SEVERITY_AMOUNT,
  DEFAULT_BANK_MATCH_SETTINGS,
  DEFAULT_REMINDER_OFFSETS,
  REMINDER_CHANNELS,
  REMINDER_PLACEHOLDERS,
  reminderRulesFromOffsets,
  renderTemplate,
  unknownPlaceholders,
} from "@/lib/ims/settings";
import { useIms } from "../core";
import { SectionCard, ToggleRow, type TabProps } from "./parts";

type Channel = ReminderTemplate["channel"];
const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

export function RemindersTab({ draft, set, errors, readOnly }: TabProps) {
  const { session } = useIms();
  const r = draft.reminders;
  const offsets = { ...DEFAULT_REMINDER_OFFSETS, ...(r.offsets ?? {}), due: 0 };
  const ruleCatalogue = reminderRulesFromOffsets(offsets);
  const update = (patch: Partial<ReminderSettings>) => set("reminders", { ...r, offsets, ...patch });
  const [active, setActive] = useState(0);
  const index = Math.min(active, r.templates.length - 1);
  const tpl = r.templates[index];
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const levels = draft.dunningSequences ?? DEFAULT_DUNNING_LEVELS.map((l) => ({ ...l }));
  const setLevel = (i: number, patch: Partial<DunningLevel>) => set("dunningSequences", levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLevel = () => {
    const last = levels[levels.length - 1];
    set("dunningSequences", [...levels, { key: `L${levels.length + 1}`, label: `Level ${levels.length + 1}`, minDaysOverdue: (last?.minDaysOverdue ?? 0) + 15, tone: "final" }]);
  };
  const agingBreaks = draft.agingBreaks ?? [15, 30, 60, 90];
  const setBreak = (i: number, raw: string) => {
    const next = [...agingBreaks];
    next[i] = Number(raw);
    set("agingBreaks", next);
  };
  const ar = draft.arPriority ?? { critical: 91, high: 61, medium: 31 };
  const bm = draft.bankMatchDefaults ?? DEFAULT_BANK_MATCH_SETTINGS;
  const rules = draft.auditRules ?? DEFAULT_AUDIT_RULE_SETTINGS;
  const setRule = (key: keyof AuditRuleSettings, raw: string) => set("auditRules", { ...rules, [key]: Number(raw) });
  const severity = draft.auditSeverityAmount ?? DEFAULT_AUDIT_SEVERITY_AMOUNT;

  const setTpl = (patch: Partial<ReminderTemplate>) => update({ templates: r.templates.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  const addTpl = () => {
    const n = r.templates.length + 1;
    update({ templates: [...r.templates, { key: `custom-${Date.now().toString(36)}`, label: `Template ${n}`, channel: "whatsapp", body: "Dear {customer}, invoice {invoice} for {amount} is due on {due}. – {business}" }] });
    setActive(r.templates.length);
  };
  const removeTpl = () => {
    update({ templates: r.templates.filter((_, i) => i !== index) });
    setActive(Math.max(0, index - 1));
  };
  const insert = (token: string) => {
    if (!tpl) return;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? tpl.body.length;
    const end = el?.selectionEnd ?? tpl.body.length;
    setTpl({ body: `${tpl.body.slice(0, start)}${token}${tpl.body.slice(end)}` });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const sample = {
    customer: "Sharma Traders",
    invoice: `${draft.invoicePrefix}/0042`,
    amount: inrExact(18450),
    due: dateLabel(addDaysISO(session.today, -7)),
    days: 7,
    business: draft.businessName || "Your business",
  };
  const unknown = tpl ? unknownPlaceholders(`${tpl.subject ?? ""} ${tpl.body}`) : [];

  return (
    <fieldset className="ims-set-fieldset" disabled={readOnly}>
      <SectionCard title="Aging & priority" desc="Day caps used by Receivables, Payables and stock aging charts. Changing breaks renames the five buckets.">
        <FormGrid>
          {(["1st", "2nd", "3rd", "4th"] as const).map((label, i) => (
            <Field key={label} label={`${label} bucket ends (days)`} error={i === 0 ? errors.agingBreaks : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  type="number"
                  min={1}
                  max={3650}
                  value={agingBreaks[i] ?? ""}
                  onChange={(e) => setBreak(i, e.target.value)}
                />
              )}
            </Field>
          ))}
          <Field label="AR critical ≥ (days)" error={errors.arPriority} hint="High and medium must be lower">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={2} max={3650} value={ar.critical} onChange={(e) => set("arPriority", { ...ar, critical: Number(e.target.value) })} />
            )}
          </Field>
          <Field label="AR high ≥ (days)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3650} value={ar.high} onChange={(e) => set("arPriority", { ...ar, high: Number(e.target.value) })} />}
          </Field>
          <Field label="AR medium ≥ (days)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3650} value={ar.medium} onChange={(e) => set("arPriority", { ...ar, medium: Number(e.target.value) })} />}
          </Field>
          <Field label="AP due soon (days)" error={errors.apDueSoonDays} hint="Bills due within this many days show as Due soon">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={365} value={draft.apDueSoonDays ?? 7} onChange={(e) => set("apDueSoonDays", Number(e.target.value))} />
            )}
          </Field>
        </FormGrid>
      </SectionCard>

      <SectionCard
        title="Audit & bank rules"
        desc="Thresholds the Auditor workspace uses to raise findings and match bank statement lines. Statutory GST slabs and the CGST / SGST split are fixed by law and not editable here."
        actions={
          readOnly ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                set("bankMatchDefaults", { ...DEFAULT_BANK_MATCH_SETTINGS });
                set("auditRules", { ...DEFAULT_AUDIT_RULE_SETTINGS });
                set("auditSeverityAmount", { ...DEFAULT_AUDIT_SEVERITY_AMOUNT });
              }}
            >
              Reset to defaults
            </Button>
          )
        }
      >
        {errors.bankMatchDefaults || errors.auditRules || errors.auditSeverityAmount ? (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="coral" title="Fix the audit & bank rules">
              {[errors.bankMatchDefaults, errors.auditRules, errors.auditSeverityAmount].filter(Boolean).join(" · ")}
            </Alert>
          </div>
        ) : null}
        <FormGrid>
          <Field label="Bank match window (± days)" hint="How far apart a statement line and a receipt / payment can be (1–30)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={30} value={bm.windowDays} onChange={(e) => set("bankMatchDefaults", { ...bm, windowDays: Number(e.target.value) })} />}
          </Field>
          <Field label="Auto-match min score" hint="Auto-match only pairs lines scoring at least this (50–100)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={50} max={100} value={bm.autoScore} onChange={(e) => set("bankMatchDefaults", { ...bm, autoScore: Number(e.target.value) })} />}
          </Field>
          <Field label="Bank amount tolerance (₹)" hint="Largest amount difference still treated as the same amount (0–10)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={10} step="0.05" value={bm.amountTolerance} onChange={(e) => set("bankMatchDefaults", { ...bm, amountTolerance: Number(e.target.value) })} />}
          </Field>
          <Field label="Overdue receivable after (days)" hint="Flag unpaid invoices past due by more than this">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3650} value={rules.overdueArDays} onChange={(e) => setRule("overdueArDays", e.target.value)} />}
          </Field>
          <Field label="Overdue payable after (days)" hint="Flag unpaid supplier bills past due by more than this">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={3650} value={rules.overdueApDays} onChange={(e) => setRule("overdueApDays", e.target.value)} />}
          </Field>
          <Field label="Unreconciled bank line after (days)" hint="Unmatched statement lines older than this are flagged (0–365)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={365} value={rules.unreconciledDays} onChange={(e) => setRule("unreconciledDays", e.target.value)} />}
          </Field>
          <Field label="Large stock adjustment (₹)" hint="Adjustments at or above this value are flagged">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} step={1000} value={rules.largeAdjustment} onChange={(e) => setRule("largeAdjustment", e.target.value)} />}
          </Field>
          <Field label="Large write-off (₹)" hint="Write-offs, and expenses without a voucher, at or above this are flagged">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} step={1000} value={rules.largeWriteOff} onChange={(e) => setRule("largeWriteOff", e.target.value)} />}
          </Field>
          <Field label="GST mismatch tolerance (₹)" hint="Invoice tax may differ from the recomputed tax by up to this much (0–100)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={100} step="0.5" value={rules.gstTolerance} onChange={(e) => setRule("gstTolerance", e.target.value)} />}
          </Field>
          <Field label="Large B2C inter-state invoice (₹)" hint="Audit warning only — GSTR-1 B2CL reporting stays at the statutory limit">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} step={1000} value={rules.b2cLargeLimit} onChange={(e) => setRule("b2cLargeLimit", e.target.value)} />}
          </Field>
          <Field label="High severity from (₹)" hint="Overdue receivables / payables at or above this rate High">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} step={1000} value={severity.high} onChange={(e) => set("auditSeverityAmount", { ...severity, high: Number(e.target.value) })} />}
          </Field>
          <Field label="Critical severity from (₹)" hint="Overdue receivables at or above this rate Critical (must exceed High)">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={2} step={1000} value={severity.critical} onChange={(e) => set("auditSeverityAmount", { ...severity, critical: Number(e.target.value) })} />}
          </Field>
        </FormGrid>
      </SectionCard>

      <SectionCard title="Collection reminders" desc="Nudge customers about unpaid invoices on a schedule. Receivables uses these rules and templates when sending reminders.">
        <ToggleRow label="Send reminders automatically" desc="When off, reminders are suggested in Receivables and sent by hand." checked={r.autoEnabled} disabled={readOnly} onChange={(v) => update({ autoEnabled: v })} />
        <div className="ims-toggle-row" style={{ alignItems: "flex-start", flexDirection: "column" }}>
          <div className="ims-toggle-row-label">When to remind</div>
          <div className="ims-chips" style={{ gap: 14, flexDirection: "column", alignItems: "stretch" }}>
            {ruleCatalogue.map((rule) => (
              <label key={rule.key} className="ims-row" style={{ gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                <Checkbox checked={r.rules[rule.key]} disabled={readOnly} onChange={(v) => update({ rules: { ...r.rules, [rule.key]: v } })} aria-label={rule.label} />
                <span style={{ minWidth: 160 }}>{rule.label}</span>
                {rule.key === "due" ? (
                  <span className="ims-faint">day 0</span>
                ) : (
                  <Input
                    size="sm"
                    type="number"
                    min={-365}
                    max={3650}
                    disabled={readOnly}
                    value={offsets[rule.key]}
                    aria-label={`${rule.key} offset days`}
                    onChange={(e) => update({ offsets: { ...offsets, [rule.key]: Number(e.target.value), due: 0 } })}
                    style={{ width: 88 }}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
        <div className="ims-toggle-row" style={{ alignItems: "flex-start", flexDirection: "column" }}>
          <div className="ims-toggle-row-label">Channels</div>
          <div className="ims-chips" role="group" aria-label="Reminder channels">
            {REMINDER_CHANNELS.map((c) => {
              const on = r.channels.includes(c.value);
              return (
                <FilterChip
                  key={c.value}
                  active={on}
                  aria-pressed={on}
                  disabled={readOnly || (on && r.channels.length === 1)}
                  onClick={() => update({ channels: on ? r.channels.filter((x) => x !== c.value) : [...r.channels, c.value] })}
                >
                  {c.label}
                </FilterChip>
              );
            })}
          </div>
          <div className="ims-toggle-row-desc">At least one channel stays on.</div>
        </div>
      </SectionCard>

      <SectionCard
        title="Message templates"
        desc="Placeholders are filled in per invoice when the reminder is sent."
        actions={
          readOnly ? null : (
            <Button size="sm" icon="plus" onClick={addTpl} disabled={r.templates.length >= 20}>
              New template
            </Button>
          )
        }
      >
        {errors.reminders ? (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="coral" title="Fix the templates">
              {errors.reminders}
            </Alert>
          </div>
        ) : null}
        {tpl ? (
          <div className="ims-tpl">
            <div className="ims-tpl-list" role="tablist" aria-label="Templates">
              {r.templates.map((t, i) => (
                <button key={t.key} type="button" role="tab" aria-selected={i === index} className={`ims-tpl-item${i === index ? " is-active" : ""}`} onClick={() => setActive(i)}>
                  <span>{t.label || "Untitled"}</span>
                  <small>{CHANNEL_LABEL[t.channel]}</small>
                </button>
              ))}
            </div>
            <div className="bos-stack" style={{ gap: 14 }} role="tabpanel">
              <FormGrid>
                <Field label="Name">{({ id }) => <Input id={id} value={tpl.label} maxLength={80} onChange={(e) => setTpl({ label: e.target.value })} />}</Field>
                <Field label="Channel">
                  {({ id }) => (
                    <Select id={id} value={tpl.channel} onChange={(e) => setTpl({ channel: e.target.value as Channel, subject: e.target.value === "email" ? (tpl.subject ?? "Payment reminder: invoice {invoice}") : undefined })}>
                      {REMINDER_CHANNELS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {tpl.channel === "email" ? (
                  <Field label="Subject" full>
                    {({ id }) => <Input id={id} value={tpl.subject ?? ""} maxLength={200} onChange={(e) => setTpl({ subject: e.target.value })} />}
                  </Field>
                ) : null}
                <Field label="Message" full hint={tpl.channel === "sms" ? `${tpl.body.length} characters · ${Math.max(1, Math.ceil(tpl.body.length / 160))} SMS` : `${tpl.body.length} / 2000 characters`}>
                  {({ id, describedBy }) => <Textarea ref={bodyRef} id={id} aria-describedby={describedBy} rows={tpl.channel === "email" ? 7 : 4} maxLength={2000} value={tpl.body} onChange={(e) => setTpl({ body: e.target.value })} />}
                </Field>
              </FormGrid>
              {readOnly ? null : (
                <div className="ims-chips" aria-label="Insert placeholder">
                  {REMINDER_PLACEHOLDERS.map((p) => (
                    <FilterChip key={p.token} onClick={() => insert(p.token)} title={p.label}>
                      {p.token}
                    </FilterChip>
                  ))}
                </div>
              )}
              {unknown.length ? (
                <Alert tone="amber" title="Unknown placeholders">
                  {unknown.join(", ")} won&apos;t be replaced. Use {REMINDER_PLACEHOLDERS.map((p) => p.token).join(" ")}.
                </Alert>
              ) : null}
              <div>
                <div className="ims-toggle-row-label" style={{ marginBottom: 6 }}>
                  Preview
                </div>
                <div className={`ims-preview${tpl.channel === "email" ? " is-email" : tpl.channel === "sms" ? " is-sms" : ""}`} aria-live="polite">
                  {tpl.channel === "email" && tpl.subject ? <div className="ims-preview-subject">{renderTemplate(tpl.subject, sample)}</div> : null}
                  {renderTemplate(tpl.body, sample) || <span className="ims-faint">Empty message</span>}
                </div>
              </div>
              {readOnly ? null : (
                <div>
                  <Button size="sm" variant="ghost" disabled={r.templates.length <= 1} onClick={removeTpl}>
                    Delete this template
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="ims-faint">No templates.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Dunning letter levels"
        desc="Multi-level overdue letters printed from Receivables. A customer's oldest overdue invoice picks the suggested level; you can still send any level by hand."
        actions={
          readOnly ? null : (
            <>
              <Button size="sm" variant="ghost" onClick={() => set("dunningSequences", DEFAULT_DUNNING_LEVELS.map((l) => ({ ...l })))}>
                Reset to L1–L3
              </Button>
              <Button size="sm" icon="plus" onClick={addLevel} disabled={levels.length >= 8}>
                Add level
              </Button>
            </>
          )
        }
      >
        {errors.dunningSequences ? (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="coral" title="Fix the dunning levels">
              {errors.dunningSequences}
            </Alert>
          </div>
        ) : null}
        <FormGrid>
          <Field label="Firm letter: pay within (days)" error={errors.dunningFirmPayWithinDays} hint="Firm-tone letters ask for payment “within the next N days” (1–90, default 7).">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={1} max={90} value={draft.dunningFirmPayWithinDays ?? 7} onChange={(e) => set("dunningFirmPayWithinDays", Number(e.target.value))} />
            )}
          </Field>
        </FormGrid>
        <div className="bos-stack" style={{ gap: 10 }}>
          {levels.map((l, i) => (
            <FormGrid key={i} columns="90px 1fr 130px 150px auto">
              <Field label={i === 0 ? "Key" : undefined}>{({ id }) => <Input id={id} className="ims-mono" value={l.key} maxLength={24} onChange={(e) => setLevel(i, { key: e.target.value.toUpperCase() })} />}</Field>
              <Field label={i === 0 ? "Name" : undefined}>{({ id }) => <Input id={id} value={l.label} maxLength={80} onChange={(e) => setLevel(i, { label: e.target.value })} />}</Field>
              <Field label={i === 0 ? "Days overdue ≥" : undefined}>
                {({ id }) => <Input id={id} type="number" min={0} max={3650} step={1} value={l.minDaysOverdue} onChange={(e) => setLevel(i, { minDaysOverdue: Math.round(Number(e.target.value) || 0) })} />}
              </Field>
              <Field label={i === 0 ? "Tone" : undefined}>
                {({ id }) => (
                  <Select id={id} value={l.tone} onChange={(e) => setLevel(i, { tone: e.target.value as DunningTone })}>
                    {(Object.keys(DUNNING_TONE_LABEL) as DunningTone[]).map((t) => (
                      <option key={t} value={t}>
                        {DUNNING_TONE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {readOnly ? null : (
                <div style={{ alignSelf: "end" }}>
                  <Button size="sm" variant="ghost" disabled={levels.length <= 1} onClick={() => set("dunningSequences", levels.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              )}
            </FormGrid>
          ))}
        </div>
      </SectionCard>
    </fieldset>
  );
}
