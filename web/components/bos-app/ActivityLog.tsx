"use client";

import { useState } from "react";
import { Badge, DataTable, ModuleToolbar, Pagination, SearchInput, Segmented, type BosColumn } from "@/components/bos";
import type { BosPastel } from "@/components/bos";
import { bos, type BosEvent } from "@/lib/bos-app/api";
import { timeAgo } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, useBosData } from "./core";

type Scope = "all" | "finance" | "hr" | "projects" | "system";

const SCOPE_OF: Record<string, Exclude<Scope, "all">> = {
  invoice: "finance",
  payment: "finance",
  bill: "finance",
  expense: "finance",
  party: "finance",
  payroll_run: "finance",
  payroll_settings: "finance",
  bank_account: "finance",
  bank_txn: "finance",
  budget: "finance",
  asset: "finance",
  account: "finance",
  journal: "finance",
  accounting: "finance",
  sales: "finance",
  sales_item: "finance",
  employee: "hr",
  opening: "hr",
  candidate: "hr",
  training: "hr",
  certificate: "hr",
  kra: "hr",
  promotion: "hr",
  pip: "hr",
  recognition: "hr",
  travel: "hr",
  service: "hr",
  policy: "hr",
  compliance: "hr",
  agreement: "hr",
  leave: "hr",
  attendance: "hr",
  holiday: "hr",
  department: "hr",
  profile_change: "hr",
  project: "projects",
};

const SCOPE_TAG: Record<Exclude<Scope, "all">, { label: string; tag: BosPastel }> = {
  finance: { label: "FINANCE", tag: "mint" },
  hr: { label: "HR", tag: "lavender" },
  projects: { label: "PROJECTS", tag: "blue" },
  system: { label: "SYSTEM", tag: "sage" },
};

const scopeOf = (e: BosEvent) => SCOPE_OF[e.entityType] ?? "system";

/** Immutable audit trail of everything done in BOS (who, what, when). */
export function ActivityLog({ initialScope = "all", limit = 200 }: { initialScope?: Scope; limit?: number }) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const [query, setQuery] = useState("");
  const state = useBosData(() => bos.events({ limit }), [limit]);

  return (
    <Loaded state={state} rows={1}>
      {({ events }) => {
        const q = query.trim().toLowerCase();
        const rows = events.filter((e) => (scope === "all" || scopeOf(e) === scope) && (!q || `${e.summary} ${e.actorName ?? ""} ${e.type}`.toLowerCase().includes(q)));
        const columns: BosColumn<BosEvent>[] = [
          {
            key: "when",
            header: "When",
            mono: true,
            width: 150,
            cell: (e) => <span title={e.createdAt}>{timeAgo(e.createdAt)}</span>,
          },
          {
            key: "actor",
            header: "By",
            cell: (e) => (
              <span className="bos-row" style={{ gap: 8 }}>
                <PersonAvatar name={e.actorName ?? "System"} size="xs" />
                {e.actorName ?? "System"}
              </span>
            ),
          },
          { key: "summary", header: "Activity", cell: (e) => e.summary },
          {
            key: "scope",
            header: "Area",
            cell: (e) => {
              const s = SCOPE_TAG[scopeOf(e)];
              return <Badge tag={s.tag}>{s.label}</Badge>;
            },
          },
          { key: "type", header: "Event", mono: true, cell: (e) => e.type },
        ];
        return (
          <Stack gap={16}>
            <ModuleToolbar>
              <SearchInput placeholder="Search activity, people, events…" aria-label="Search audit log" value={query} onChange={(e) => setQuery(e.target.value)} />
            </ModuleToolbar>
            <div className="bos-subtabs" style={{ paddingTop: 0 }}>
              <Segmented<Scope>
                role="radio"
                size="sm"
                scroll
                aria-label="Filter by area"
                options={[
                  { value: "all", label: "All" },
                  { value: "finance", label: "Finance" },
                  { value: "hr", label: "HR" },
                  { value: "projects", label: "Projects" },
                  { value: "system", label: "System & sync" },
                ]}
                value={scope}
                onChange={setScope}
              />
            </div>
            <div>
              <DataTable caption="Audit log" columns={columns} rows={rows} rowKey={(e) => String(e.id)} compact empty="No activity recorded yet." />
              <Pagination>
                Showing {rows.length} of the latest {events.length} events · entries are append-only
              </Pagination>
            </div>
          </Stack>
        );
      }}
    </Loaded>
  );
}
