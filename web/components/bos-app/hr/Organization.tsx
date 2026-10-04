"use client";

import { useState } from "react";
import { Button, DataTable, EmptyState, Grid, KpiCard, ModuleToolbar, OrgChart, Segmented, type BosOrgNode } from "@/components/bos";
import { bos, type BosDepartment, type BosEmployee } from "@/lib/bos-app/api";
import { initialsOf, toneFor } from "@/lib/bos-app/format";
import { Loaded, Stack, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, DepartmentDialog } from "../dialogs";

/** Builds the reporting tree from `managerId`; several top-level people hang off a virtual company node. */
export function buildOrgTree(employees: ReadonlyArray<BosEmployee>, companyName: string): BosOrgNode | null {
  const active = employees.filter((e) => e.status !== "exited");
  if (!active.length) return null;
  const ids = new Set(active.map((e) => e.id));
  const reports = new Map<string, BosEmployee[]>();
  const roots: BosEmployee[] = [];
  for (const e of active) {
    if (e.managerId && ids.has(e.managerId) && e.managerId !== e.id) reports.set(e.managerId, [...(reports.get(e.managerId) ?? []), e]);
    else roots.push(e);
  }
  const seen = new Set<string>();
  const node = (e: BosEmployee): BosOrgNode => {
    seen.add(e.id);
    const children = (reports.get(e.id) ?? []).filter((c) => !seen.has(c.id)).map(node);
    return { id: e.id, name: e.name, role: e.designation ?? e.departmentName ?? undefined, initials: initialsOf(e.name), tone: toneFor(e.name), children: children.length ? children : undefined };
  };
  const top = roots.map(node);
  if (top.length === 1) return top[0];
  return { id: "company", name: companyName || "Company", role: "Organization", initials: initialsOf(companyName || "Co"), virtual: true, children: top };
}

type Tab = "chart" | "departments";

export function Organization() {
  const { canManage, session, navigate } = useBosApp();
  const { run, busy } = useBosAction();
  const [tab, setTab] = useState<Tab>("chart");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BosDepartment | null>(null);
  const state = useBosData(async () => {
    const [d, e] = await Promise.all([bos.departments(), bos.employees()]);
    return { departments: d.departments, employees: e.employees };
  });

  return (
    <Loaded state={state} rows={1}>
      {({ departments, employees }) => {
        const tree = buildOrgTree(employees, session.settings.companyName);
        const active = employees.filter((e) => e.status !== "exited");
        const managers = new Set(active.map((e) => e.managerId).filter(Boolean)).size;
        const unassigned = active.filter((e) => !e.departmentId).length;
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Departments" value={departments.length} chip={{ color: "blue", glyph: "▦" }} delta={unassigned ? `${unassigned} people unassigned` : "Everyone assigned"} deltaTone={unassigned ? "warn" : "up"} />
              <KpiCard label="People" value={active.length} chip={{ color: "mint", glyph: "◎" }} delta="Active, probation & notice" deltaTone="muted" />
              <KpiCard label="Managers" value={managers} chip={{ color: "lavender", glyph: "◈" }} delta={managers ? `~${Math.round(active.length / Math.max(1, managers))} reports each` : "Set reporting managers"} deltaTone="muted" />
              <KpiCard label="Designations" value={new Set(active.map((e) => e.designation).filter(Boolean)).size} chip={{ color: "rose", glyph: "✦" }} delta="Distinct titles" deltaTone="muted" />
            </Grid>
            <ModuleToolbar>
              <Segmented<Tab>
                role="tabs"
                size="sm"
                aria-label="Organization views"
                options={[
                  { value: "chart", label: "Org chart" },
                  { value: "departments", label: "Departments" },
                ]}
                value={tab}
                onChange={setTab}
              />
              <span className="bos-spacer" />
              {canManage ? (
                <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                  New department
                </Button>
              ) : null}
            </ModuleToolbar>
            {tab === "chart" ? (
              tree ? (
                <OrgChart root={tree} onSelect={(n) => !n.virtual && navigate("hr", "employees", `open:${n.id}`)} />
              ) : (
                <EmptyState glyph="🏢" title="No reporting lines yet">
                  Add employees and set their reporting manager to see the org chart.
                </EmptyState>
              )
            ) : (
              <DataTable
                caption="Departments"
                rows={departments}
                rowKey={(d) => d.id}
                empty="No departments yet."
                columns={[
                  { key: "name", header: "Department", cell: (d) => <strong style={{ fontWeight: 650 }}>{d.name}</strong> },
                  { key: "code", header: "Code", mono: true, cell: (d) => d.code ?? "—" },
                  { key: "head", header: "Head", cell: (d) => employees.find((e) => e.id === d.headEmployeeId)?.name ?? "—" },
                  { key: "headcount", header: "Headcount", align: "right", mono: true, cell: (d) => d.headcount },
                  {
                    key: "actions",
                    header: "",
                    cell: (d) =>
                      canManage ? (
                        <Button size="sm" variant="ghost" disabled={d.headcount > 0} title={d.headcount > 0 ? "Move people out before deleting" : undefined} onClick={() => setRemoving(d)}>
                          Delete
                        </Button>
                      ) : null,
                  },
                ]}
              />
            )}
            <DepartmentDialog open={adding} onClose={() => setAdding(false)} />
            <ConfirmDialog
              open={removing !== null}
              onClose={() => setRemoving(null)}
              destructive
              title={`Delete ${removing?.name ?? "department"}?`}
              confirmLabel="Delete"
              busy={busy === "dept-del"}
              onConfirm={async () => {
                if (!removing) return;
                await run("dept-del", () => bos.deleteDepartment(removing.id), { success: "Department deleted", description: removing.name });
                setRemoving(null);
              }}
            />
          </Stack>
        );
      }}
    </Loaded>
  );
}
