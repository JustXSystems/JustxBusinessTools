"use client";

import { useState, type ReactNode } from "react";
import { Alert, Button, Card, Field, FilterChip, FormGrid, Input, Select, Switch, Textarea, WidgetCard, WidgetRow } from "@/components/bos";
import { bos, type BosSettings, type LeaveType } from "@/lib/bos-app/api";
import { LEAVE_LABEL } from "@/lib/bos-app/format";
import { ActivityLog } from "../ActivityLog";
import { LiveWorkspace, Stack, useBosAction, useBosApp, useWorkspaceModule, type LiveModule } from "../core";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Edits a slice of settings; only changed keys are sent. */
function SettingsSection({ title, note, children }: { title: string; note?: string; children: (draft: BosSettings, set: <K extends keyof BosSettings>(k: K, v: BosSettings[K]) => void, disabled: boolean) => ReactNode }) {
  const { session, setSettings, canManage } = useBosApp();
  const { run, busy } = useBosAction();
  const [draft, setDraft] = useState<BosSettings>(session.settings);
  const set = <K extends keyof BosSettings>(k: K, v: BosSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const changed = (Object.keys(draft) as Array<keyof BosSettings>).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(session.settings[k]));

  return (
    <Card interactive={false} style={{ maxWidth: 760 }}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const patch = Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<BosSettings>;
          const out = await run("settings", () => bos.saveSettings(patch), { success: "Settings saved", description: title });
          if (out) {
            setSettings(out.settings);
            setDraft(out.settings);
          }
        }}
      >
        <div className="bos-row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="bos-kpi-label">{title}</div>
            {note ? (
              <div className="bos-text-faint" style={{ fontSize: 12, marginTop: 4 }}>
                {note}
              </div>
            ) : null}
          </div>
        </div>
        {!canManage ? (
          <div style={{ marginBottom: 14 }}>
            <Alert tone="blue" title="View only">
              Only owners and admins can change BOS settings.
            </Alert>
          </div>
        ) : null}
        {children(draft, set, !canManage)}
        {canManage ? (
          <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 18, gap: 8 }}>
            <Button size="sm" disabled={!changed.length} onClick={() => setDraft(session.settings)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" type="submit" icon="check" disabled={!changed.length || busy !== null}>
              {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Saved"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

const nullable = (s: string) => (s.trim() ? s : null);

function CompanySettings() {
  return (
    <SettingsSection title="Company & GST registration" note="Printed on every invoice. The registered state decides CGST + SGST versus IGST.">
      {(d, set, disabled) => (
        <FormGrid>
          <Field label="Company name" full>{({ id }) => <Input id={id} required disabled={disabled} value={d.companyName} onChange={(e) => set("companyName", e.target.value)} />}</Field>
          <Field label="GSTIN">{({ id }) => <Input id={id} disabled={disabled} value={d.gstin ?? ""} placeholder="29ABCDE1234F1Z5" onChange={(e) => set("gstin", nullable(e.target.value.toUpperCase()))} />}</Field>
          <Field label="Registered state" hint="Matches place of supply on invoices">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={disabled} value={d.state ?? ""} placeholder="e.g. Karnataka" onChange={(e) => set("state", nullable(e.target.value))} />}
          </Field>
          <Field label="State code">{({ id }) => <Input id={id} disabled={disabled} value={d.stateCode ?? ""} placeholder="29" maxLength={4} onChange={(e) => set("stateCode", nullable(e.target.value))} />}</Field>
          <Field label="Phone">{({ id }) => <Input id={id} type="tel" disabled={disabled} value={d.phone ?? ""} onChange={(e) => set("phone", nullable(e.target.value))} />}</Field>
          <Field label="Email" full>{({ id }) => <Input id={id} type="email" disabled={disabled} value={d.email ?? ""} onChange={(e) => set("email", nullable(e.target.value))} />}</Field>
          <Field label="Registered address" full>{({ id }) => <Textarea id={id} rows={2} disabled={disabled} value={d.address ?? ""} onChange={(e) => set("address", nullable(e.target.value))} />}</Field>
        </FormGrid>
      )}
    </SettingsSection>
  );
}

function InvoicingSettings() {
  return (
    <SettingsSection title="Invoicing & terms" note="Numbers continue per financial year, e.g. INV/26-27/0001.">
      {(d, set, disabled) => (
        <FormGrid>
          <Field label="Invoice prefix">{({ id }) => <Input id={id} disabled={disabled} value={d.invoicePrefix} maxLength={12} pattern="[A-Za-z0-9-]+" onChange={(e) => set("invoicePrefix", e.target.value)} />}</Field>
          <Field label="Financial year starts">
            {({ id }) => (
              <Select id={id} disabled={disabled} value={String(d.fiscalYearStart)} onChange={(e) => set("fiscalYearStart", Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Default GST rate (%)">{({ id }) => <Input id={id} type="number" min={0} max={100} step="any" disabled={disabled} value={d.defaultTaxRate} onChange={(e) => set("defaultTaxRate", Number(e.target.value))} />}</Field>
          <Field label="Payment terms (days)">{({ id }) => <Input id={id} type="number" min={0} max={365} disabled={disabled} value={d.paymentTermsDays} onChange={(e) => set("paymentTermsDays", Number(e.target.value))} />}</Field>
          <Field label="Default invoice notes" full>
            {({ id }) => <Textarea id={id} rows={3} disabled={disabled} value={d.invoiceNotes ?? ""} placeholder="Bank details, UPI ID, terms…" onChange={(e) => set("invoiceNotes", nullable(e.target.value))} />}
          </Field>
        </FormGrid>
      )}
    </SettingsSection>
  );
}

export function HrSettings() {
  return (
    <SettingsSection title="HR policy" note="Leave allowance per employee per year, and your weekly off days.">
      {(d, set, disabled) => (
        <Stack gap={16}>
          <FormGrid>
            <Field label="Employee ID prefix">{({ id }) => <Input id={id} disabled={disabled} value={d.employeePrefix} maxLength={12} pattern="[A-Za-z0-9-]+" onChange={(e) => set("employeePrefix", e.target.value)} />}</Field>
            {(["casual", "sick", "earned"] as LeaveType[]).map((t) => (
              <Field key={t} label={`${LEAVE_LABEL[t]} (days / year)`}>
                {({ id }) => <Input id={id} type="number" min={0} max={366} disabled={disabled} value={d.leavePolicy[t] ?? 0} onChange={(e) => set("leavePolicy", { ...d.leavePolicy, [t]: Number(e.target.value) })} />}
              </Field>
            ))}
          </FormGrid>
          <div>
            <div className="bos-field-label" style={{ marginBottom: 8 }}>
              Weekly off
            </div>
            <div className="bos-row" style={{ gap: 6, flexWrap: "wrap" }} role="group" aria-label="Weekly off days">
              {WEEKDAYS.map((w, i) => (
                <FilterChip
                  key={w}
                  disabled={disabled}
                  active={d.weekendDays.includes(i)}
                  onClick={() => set("weekendDays", d.weekendDays.includes(i) ? d.weekendDays.filter((x) => x !== i) : [...d.weekendDays, i].sort())}
                >
                  {w}
                </FilterChip>
              ))}
            </div>
          </div>
        </Stack>
      )}
    </SettingsSection>
  );
}

function IntegrationSettings() {
  const { session, mode } = useBosApp();
  return (
    <Stack>
      <SettingsSection
        title="Sync with JBT tools"
        note="When on, opening BOS imports approved quotations and saved site surveys automatically. The first sync brings in every eligible past record — to review them first, import one by one from Connected Tools."
      >
        {(d, set, disabled) => (
          <label className="bos-row" style={{ gap: 10, fontSize: 13 }}>
            <Switch checked={d.autoSync} disabled={disabled} onChange={(v) => set("autoSync", v)} aria-label="Automatic sync" />
            Automatic sync {d.autoSync ? "on" : "off"}
          </label>
        )}
      </SettingsSection>
      <WidgetCard title="🧩 Deployment" dot="lavender" style={{ maxWidth: 760 }}>
        <WidgetRow label="Running as" value={mode === "standalone" ? "Standalone app (/bos)" : "JBT tool (/tools/bos)"} />
        <WidgetRow label="Host" value={session.host.toUpperCase()} />
        <WidgetRow label="Tenant" value={`#${session.tenantId}`} />
        <WidgetRow label="Connectors" value={session.connectors.map((c) => c.label).join(" · ") || "None"} />
        <WidgetRow label="Notifications" value="BOS events appear in JBT notifications" valueTone="faint" />
      </WidgetCard>
    </Stack>
  );
}

const MODULES: ReadonlyArray<LiveModule> = [
  { key: "company", label: "Company & GST", icon: "🏢", title: "Company & GST", sub: "Legal name, GSTIN, registered state and address", render: () => <CompanySettings /> },
  { key: "invoicing", label: "Invoicing", icon: "🧾", title: "Invoicing & Terms", sub: "Numbering, financial year, default GST rate, payment terms and notes", render: () => <InvoicingSettings /> },
  { key: "hrpolicy", label: "HR Policy", icon: "🗓️", title: "HR Policy", sub: "Leave allowances, weekly off and employee numbering", render: () => <HrSettings /> },
  { key: "integrations", label: "Integrations", icon: "🔗", title: "Integrations", sub: "JBT tool sync, notifications and deployment details", render: () => <IntegrationSettings /> },
  { key: "audit", label: "Audit Log", icon: "🔍", title: "Audit Log", sub: "Append-only trail of every action in BOS — who, what and when", render: () => <ActivityLog /> },
];

export function SettingsWorkspace() {
  const { session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("settings", "company");
  return (
    <LiveWorkspace
      modules={MODULES}
      active={nav.active}
      onSelect={nav.onSelect}
      navSeq={nav.navSeq}
      brandName={session.brand?.name || session.settings.companyName || "Justx BOS"}
      logoSrc={logoSrc}
      onSearch={openPalette}
      label="Settings"
    />
  );
}
