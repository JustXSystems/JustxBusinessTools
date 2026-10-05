"use client";

import { DataTable, WidgetCard, WidgetRow, type BosColumn } from "@/components/bos";
import type { BadgeView } from "@/lib/bos-app/format";
import { Stack, StatusBadge, useBosApp } from "../core";
import { HrSettings } from "../settings/SettingsWorkspace";

type Access = { role: string; who: string; apply: BadgeView; approve: BadgeView; records: BadgeView; pay: BadgeView; reports: BadgeView };

const YES: BadgeView = { text: "YES", tone: "emerald" };
const NO: BadgeView = { text: "NO", tone: "coral" };
const OWN: BadgeView = { text: "OWN ONLY", tone: "blue" };

/** Mirrors the API's rules: managers (owners, admins, single-user installs) decide; everyone else self-serves. */
const ACCESS: ReadonlyArray<Access> = [
  { role: "Owner / Admin", who: "Organization owners and admins", apply: YES, approve: YES, records: YES, pay: { text: "YES · AUDITED", tone: "emerald" }, reports: YES },
  { role: "Staff", who: "Team members", apply: OWN, approve: NO, records: NO, pay: OWN, reports: NO },
  { role: "Viewer", who: "Read-only members", apply: NO, approve: NO, records: NO, pay: OWN, reports: NO },
];

const COLUMNS: BosColumn<Access>[] = [
  { key: "role", header: "Role", cell: (a) => <span>{a.role}<span className="bos-text-faint"> · {a.who}</span></span> },
  { key: "apply", header: "Apply for leave & claims", cell: (a) => <StatusBadge view={a.apply} /> },
  { key: "approve", header: "Approve requests", cell: (a) => <StatusBadge view={a.approve} /> },
  { key: "records", header: "Edit employees & attendance", cell: (a) => <StatusBadge view={a.records} /> },
  { key: "pay", header: "Salary & bank details", cell: (a) => <StatusBadge view={a.pay} /> },
  { key: "reports", header: "Reports & settings", cell: (a) => <StatusBadge view={a.reports} /> },
];

/** HR → Settings & Access: the HR policy, who can do what, and shortcuts to the HR masters. */
export function HrAccess() {
  const { navigate } = useBosApp();
  return (
    <Stack>
      <HrSettings />
      <div>
        <DataTable caption="Who can do what in HR" columns={COLUMNS} rows={ACCESS} rowKey={(a) => a.role} compact />
        <p className="bos-text-faint" style={{ fontSize: 12, marginTop: 8 }}>
          Roles come from your Justx Business Tools team (Admin → Team). Change someone&apos;s role there and BOS follows.
        </p>
      </div>
      <WidgetCard title="🗂️ Masters" dot="lavender" style={{ maxWidth: 760 }}>
        <WidgetRow label="Departments & org chart" chevron onClick={() => navigate("hr", "orgchart")} />
        <WidgetRow label="Holiday calendar" chevron onClick={() => navigate("hr", "leave", "holidays")} />
        <WidgetRow label="Company, GST & financial year" chevron onClick={() => navigate("settings", "company")} />
      </WidgetCard>
    </Stack>
  );
}
