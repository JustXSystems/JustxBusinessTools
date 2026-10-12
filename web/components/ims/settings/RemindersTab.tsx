"use client";

import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Field, FilterChip, FormGrid, Input, Select, Textarea } from "@/components/bos";
import type { ReminderSettings, ReminderTemplate } from "@/lib/ims/api";
import { addDaysISO, dateLabel, inrExact } from "@/lib/ims/format";
import { REMINDER_CHANNELS, REMINDER_PLACEHOLDERS, REMINDER_RULES, renderTemplate, unknownPlaceholders } from "@/lib/ims/settings";
import { useIms } from "../core";
import { SectionCard, ToggleRow, type TabProps } from "./parts";

type Channel = ReminderTemplate["channel"];
const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

export function RemindersTab({ draft, set, errors, readOnly }: TabProps) {
  const { session } = useIms();
  const r = draft.reminders;
  const update = (patch: Partial<ReminderSettings>) => set("reminders", { ...r, ...patch });
  const [active, setActive] = useState(0);
  const index = Math.min(active, r.templates.length - 1);
  const tpl = r.templates[index];
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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
      <SectionCard title="Collection reminders" desc="Nudge customers about unpaid invoices on a schedule. Receivables uses these rules and templates when sending reminders.">
        <ToggleRow label="Send reminders automatically" desc="When off, reminders are suggested in Receivables and sent by hand." checked={r.autoEnabled} disabled={readOnly} onChange={(v) => update({ autoEnabled: v })} />
        <div className="ims-toggle-row" style={{ alignItems: "flex-start", flexDirection: "column" }}>
          <div className="ims-toggle-row-label">When to remind</div>
          <div className="ims-chips" style={{ gap: 14 }}>
            {REMINDER_RULES.map((rule) => (
              <label key={rule.key} className="ims-row" style={{ gap: 8, fontSize: 13 }}>
                <Checkbox checked={r.rules[rule.key]} disabled={readOnly} onChange={(v) => update({ rules: { ...r.rules, [rule.key]: v } })} aria-label={rule.label} />
                {rule.label}
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
    </fieldset>
  );
}
