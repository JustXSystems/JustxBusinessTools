"use client";

import { useState } from "react";
import { Badge, DataTable, Input, PersonCell, Select, Switch, type BosColumn } from "@/components/bos";
import type { ImsMember, ImsRole } from "@/lib/ims/api";
import { EDITABLE_ROLES, ROLE_INFO, settingsApi } from "@/lib/ims/settings";
import { Loaded, PersonAvatar, useIms, useImsAction, useImsData } from "../core";
import { RoleGuide } from "./AccessTabs";
import { SectionCard } from "./parts";

type MemberPatch = Parameters<typeof settingsApi.saveMember>[1];

const PHONE_RE = /^[+\d][\d\s-]{5,19}$/;

function PhoneCell({ member, disabled, onSave }: { member: ImsMember; disabled: boolean; onSave: (phone: string | null) => void }) {
  const [value, setValue] = useState(member.phone ?? "");
  const trimmed = value.trim();
  const invalid = trimmed !== "" && !PHONE_RE.test(trimmed);
  const commit = () => {
    if (invalid || trimmed === (member.phone ?? "")) return;
    onSave(trimmed || null);
  };
  return (
    <Input
      size="sm"
      type="tel"
      inputMode="tel"
      value={value}
      disabled={disabled}
      placeholder="—"
      maxLength={20}
      aria-label={`${member.name ?? "Member"} phone`}
      aria-invalid={invalid || undefined}
      title={invalid ? "Enter a valid phone number" : undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      style={{ width: 150 }}
    />
  );
}

export function TeamTab() {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const state = useImsData(() => settingsApi.team(), []);

  const save = (m: ImsMember, patch: MemberPatch, success: string) => run(`member-${m.userId}`, () => settingsApi.saveMember(m.userId, patch), { success, description: m.name ?? m.email ?? undefined });

  return (
    <div>
      <Loaded state={state} rows={4}>
        {({ members, canManage }) => {
          const columns: BosColumn<ImsMember>[] = [
            {
              key: "name",
              header: "Member",
              cell: (m) => (
                <PersonCell
                  avatar={<PersonAvatar name={m.name ?? m.email} />}
                  name={
                    <span className="ims-row" style={{ gap: 6 }}>
                      {m.name ?? m.email ?? `User ${m.userId}`}
                      {m.userId === session.actor.userId ? (
                        <Badge tone="blue" auto>
                          YOU
                        </Badge>
                      ) : null}
                      {!m.active ? (
                        <Badge tone="neutral" auto>
                          INACTIVE
                        </Badge>
                      ) : null}
                    </span>
                  }
                  role={m.email ?? undefined}
                />
              ),
            },
            {
              key: "role",
              header: "IMS role",
              cell: (m) =>
                m.locked || !canManage ? (
                  <span className="ims-cell-stack">
                    <span>{ROLE_INFO[m.imsRole].label}</span>
                    {m.locked ? <small>Set by platform role ({m.platformRole})</small> : null}
                  </span>
                ) : (
                  <Select
                    size="sm"
                    value={m.imsRole}
                    disabled={busy === `member-${m.userId}`}
                    aria-label={`${m.name ?? "Member"} role`}
                    title={ROLE_INFO[m.imsRole].desc}
                    onChange={(e) => {
                      const role = e.target.value as Exclude<ImsRole, "owner">;
                      void save(m, { imsRole: role }, `Role changed to ${ROLE_INFO[role].label}`);
                    }}
                    style={{ width: "auto", minWidth: 150 }}
                  >
                    {EDITABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_INFO[r].label}
                      </option>
                    ))}
                  </Select>
                ),
            },
            { key: "phone", header: "Phone", cell: (m) => <PhoneCell key={m.phone ?? ""} member={m} disabled={!canManage} onSave={(phone) => void save(m, { phone }, "Phone saved")} /> },
            {
              key: "am",
              header: "Account manager",
              cell: (m) => (
                <Switch
                  checked={m.isAccountManager}
                  disabled={!canManage || busy === `member-${m.userId}`}
                  aria-label={`${m.name ?? "Member"} is an account manager`}
                  onChange={(v) => void save(m, { isAccountManager: v }, v ? "Marked as account manager" : "No longer an account manager")}
                />
              ),
            },
            {
              key: "active",
              header: "Active",
              cell: (m) => (
                <Switch
                  checked={m.active}
                  disabled={!canManage || m.locked || m.userId === session.actor.userId || busy === `member-${m.userId}`}
                  aria-label={`${m.name ?? "Member"} has IMS access`}
                  onChange={(v) => void save(m, { active: v }, v ? "Access restored" : "Access paused")}
                />
              ),
            },
          ];
          return (
            <SectionCard
              title="Team & access"
              desc={
                canManage
                  ? "Everyone in your workspace can use IMS. Pick each person's role here; platform owners, admins and viewers are fixed. Account managers can be assigned to parties."
                  : "Only owners and people with the Settings permission can change roles."
              }
            >
              <DataTable caption="IMS team members" columns={columns} rows={members} rowKey={(m) => String(m.userId)} empty="No team members yet." />
            </SectionCard>
          );
        }}
      </Loaded>
      <SectionCard title="What each role can do" desc="Defaults — fine-tune them under Role permissions.">
        <RoleGuide />
      </SectionCard>
    </div>
  );
}
