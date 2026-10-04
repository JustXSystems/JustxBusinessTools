"use client";

import { useState } from "react";
import { Badge, Button, DataTable, Grid, Kanban, KpiCard, ModuleToolbar, Pagination, SearchInput, type BosColumn, type BosKanbanColumn } from "@/components/bos";
import { bos, type BosProject, type ProjectStatus } from "@/lib/bos-app/api";
import { dateLabel, dayMonth, inr, inrCompact, PROJECT_STAGES, sourceLabel, todayLocal } from "@/lib/bos-app/format";
import { LiveWorkspace, Loaded, PersonAvatar, Stack, useBosAction, useBosApp, useBosData, useWorkspaceModule, type LiveModule } from "../core";
import { ProjectDialog, usePartyList } from "../dialogs";

const STAGE_LABEL: Record<ProjectStatus, string> = { ...Object.fromEntries(PROJECT_STAGES.map((s) => [s.key, s.label])), cancelled: "Cancelled" } as Record<ProjectStatus, string>;

function useProjects() {
  return useBosData(() => bos.projects(), []);
}

/** Dialog state for a module, opened by a click or by an `open:<id>` intent (deep link). */
function useProjectEditor(module: string) {
  const { takeIntent } = useBosApp();
  const [editing, setEditing] = useState<BosProject | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => {
    const intent = takeIntent(module);
    return intent?.startsWith("open:") ? intent.slice(5) : null;
  });
  return {
    active: editing !== null || openId !== null,
    edit: setEditing,
    close: () => {
      setEditing(null);
      setOpenId(null);
    },
    current: (projects: ReadonlyArray<BosProject>): BosProject | "new" | null => editing ?? projects.find((p) => p.id === openId) ?? null,
  };
}

function ProjectKpis({ projects }: { projects: ReadonlyArray<BosProject> }) {
  const today = todayLocal();
  const value = (s: ProjectStatus[]) => projects.filter((p) => s.includes(p.status)).reduce((a, p) => a + p.valueEstimate, 0);
  const late = projects.filter((p) => p.dueDate && p.dueDate < today && (p.status === "active" || p.status === "planned"));
  return (
    <Grid cols={4} min={140}>
      <KpiCard label="Pipeline" value={inrCompact(value(["lead", "planned"]))} chip={{ color: "lavender", glyph: "◈" }} delta={`${projects.filter((p) => p.status === "lead" || p.status === "planned").length} leads & planned`} deltaTone="muted" />
      <KpiCard label="In execution" value={inrCompact(value(["active"]))} chip={{ color: "blue", glyph: "▶" }} delta={`${projects.filter((p) => p.status === "active").length} active`} deltaTone="info" />
      <KpiCard label="Completed" value={inrCompact(value(["completed"]))} chip={{ color: "mint", glyph: "✓" }} delta={`${projects.filter((p) => p.status === "completed").length} delivered`} />
      <KpiCard label="Past due" value={late.length} valueTone={late.length ? "coral" : undefined} chip={{ color: "rose", glyph: "!" }} delta={late.length ? "Active or planned beyond due date" : "Everything on schedule"} deltaTone={late.length ? "down" : "up"} />
    </Grid>
  );
}

function Board() {
  const { run } = useBosAction();
  const editor = useProjectEditor("board");
  const [query, setQuery] = useState("");
  const customers = usePartyList("customer", editor.active);
  const state = useProjects();

  return (
    <Loaded state={state}>
      {({ projects }) => {
        const q = query.trim().toLowerCase();
        const shown = projects.filter((p) => !q || `${p.name} ${p.partyName ?? ""} ${p.siteAddress ?? ""}`.toLowerCase().includes(q));
        const today = todayLocal();
        const columns: BosKanbanColumn[] = PROJECT_STAGES.map((s) => {
          const list = shown.filter((p) => p.status === s.key);
          return {
            id: s.key,
            title: s.label,
            dot: s.dot,
            highlightCount: s.key === "lead" || s.key === "active" ? { value: inrCompact(list.reduce((a, p) => a + p.valueEstimate, 0)), color: s.dot } : undefined,
            cards: list.map((p) => ({
              id: p.id,
              title: (
                <button type="button" className="bos-link" style={{ textAlign: "left", font: "inherit", color: "inherit" }} onClick={() => editor.edit(p)}>
                  {p.name}
                </button>
              ),
              tag: p.sourceTool ? <Badge tag="sage">{sourceLabel(p.sourceTool)}</Badge> : p.valueEstimate ? <Badge tag="mint">{inrCompact(p.valueEstimate)}</Badge> : undefined,
              people: p.partyName ? <PersonAvatar name={p.partyName} size="xs" /> : undefined,
              due: p.dueDate ? <span style={p.dueDate < today && s.key !== "completed" ? { color: "var(--bos-coral-600)" } : undefined}>{dayMonth(p.dueDate)}</span> : undefined,
            })),
          };
        });
        return (
          <Stack>
            <ProjectKpis projects={projects} />
            <ModuleToolbar>
              <SearchInput placeholder="Search projects, customers, sites…" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" onClick={() => editor.edit("new")}>
                New project
              </Button>
            </ModuleToolbar>
            <Kanban
              aria-label="Projects by stage"
              columns={columns}
              onMove={(cardId, _from, to) => {
                const p = projects.find((x) => x.id === cardId);
                if (p) void run(`move-${p.id}`, () => bos.updateProject(p.id, { status: to as ProjectStatus }), { success: `Moved to ${STAGE_LABEL[to as ProjectStatus]}`, description: p.name });
              }}
            />
            <ProjectEditor projects={projects} editor={editor} customers={customers} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

function ProjectEditor({ projects, editor, customers }: { projects: ReadonlyArray<BosProject>; editor: ReturnType<typeof useProjectEditor>; customers: ReturnType<typeof usePartyList> }) {
  const current = editor.current(projects);
  return <ProjectDialog open={current !== null} project={current === "new" ? null : current} onClose={editor.close} customers={customers} />;
}

function ProjectList() {
  const editor = useProjectEditor("list");
  const [query, setQuery] = useState("");
  const customers = usePartyList("customer", editor.active);
  const state = useProjects();

  return (
    <Loaded state={state}>
      {({ projects }) => {
        const q = query.trim().toLowerCase();
        const rows = projects.filter((p) => !q || `${p.name} ${p.partyName ?? ""} ${p.siteAddress ?? ""} ${p.status}`.toLowerCase().includes(q));
        const columns: BosColumn<BosProject>[] = [
          { key: "name", header: "Project", cell: (p) => <strong style={{ fontWeight: 650 }}>{p.name}</strong> },
          { key: "party", header: "Customer", cell: (p) => p.partyName ?? "—" },
          { key: "stage", header: "Stage", cell: (p) => <Badge tone={p.status === "completed" ? "emerald" : p.status === "active" ? "blue" : p.status === "cancelled" ? "coral" : p.status === "on_hold" ? "amber" : "neutral"}>{STAGE_LABEL[p.status].toUpperCase()}</Badge> },
          { key: "value", header: "Value", align: "right", mono: true, cell: (p) => (p.valueEstimate ? inr(p.valueEstimate) : "—") },
          { key: "start", header: "Start", mono: true, cell: (p) => dateLabel(p.startDate) },
          { key: "due", header: "Due", mono: true, cell: (p) => dateLabel(p.dueDate) },
          { key: "source", header: "Source", cell: (p) => (p.sourceTool ? <Badge tag="sage">{sourceLabel(p.sourceTool)}</Badge> : <span className="bos-text-faint">Manual</span>) },
        ];
        return (
          <Stack>
            <ModuleToolbar>
              <SearchInput placeholder="Search projects…" aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button size="sm" variant="primary" icon="plus" onClick={() => editor.edit("new")}>
                New project
              </Button>
            </ModuleToolbar>
            <div>
              <DataTable caption="All projects" columns={columns} rows={rows} rowKey={(p) => p.id} onRowClick={(p) => editor.edit(p)} chevron empty="No projects yet — create one, or import site surveys from Connected Tools." />
              <Pagination>
                Showing {rows.length} of {projects.length}
              </Pagination>
            </div>
            <ProjectEditor projects={projects} editor={editor} customers={customers} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

const MODULES: ReadonlyArray<LiveModule> = [
  { key: "board", label: "Pipeline", icon: "🗂️", title: "Project Pipeline", sub: "Drag projects across stages — lead, planned, active, on hold and completed", render: () => <Board /> },
  { key: "list", label: "All Projects", icon: "📋", title: "All Projects", sub: "Every project with customer, value, schedule and source", render: () => <ProjectList /> },
];

export function ProjectsWorkspace() {
  const { session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("projects", "board");
  return (
    <LiveWorkspace
      modules={MODULES}
      active={nav.active}
      onSelect={nav.onSelect}
      navSeq={nav.navSeq}
      brandName={session.brand?.name || session.settings.companyName || "Justx Projects"}
      logoSrc={logoSrc}
      onSearch={openPalette}
      label="Project modules"
    />
  );
}
