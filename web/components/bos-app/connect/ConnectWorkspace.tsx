"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Grid, KpiCard, ModuleToolbar, Pagination, ProgressBar, SearchInput, Segmented, useToast, WidgetCard, WidgetRow, type BosColumn } from "@/components/bos";
import { bos, type ConnectorItem, type ConnectorSummary, type ConnectorTarget, type SyncResult } from "@/lib/bos-app/api";
import { dateLabel, inr, timeAgo } from "@/lib/bos-app/format";
import { withBasePath } from "@/lib/base-path";
import { LiveWorkspace, Loaded, Stack, useBosAction, useBosApp, useBosData, useWorkspaceModule, type LiveModule } from "../core";

const TARGET_LABEL: Record<ConnectorTarget, string> = { party: "Customer", invoice: "Invoice", project: "Project" };
const TARGET_FLOW: Record<ConnectorTarget, string> = { party: "Customers & Vendors", invoice: "GST Invoices (draft)", project: "Projects" };

function useOpenTarget() {
  const { navigate } = useBosApp();
  return (target: ConnectorTarget, id: string) => {
    if (target === "invoice") navigate("finance", "invoices", `open:${id}`);
    else if (target === "party") navigate("finance", "customers");
    else navigate("projects", "list", `open:${id}`);
  };
}

function SyncButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const { run, busy } = useBosAction();
  const { show } = useToast();
  return (
    <Button
      size="sm"
      variant={variant}
      icon="refresh"
      disabled={busy !== null}
      onClick={async () => {
        const r: SyncResult | undefined = await run("sync", () => bos.sync(true));
        if (r?.errors?.length) show({ tone: "amber", title: "Some records were skipped", description: r.errors.slice(0, 3).join(" · ") });
        else if (r) show({ tone: "blue", title: r.imported.length ? `${r.imported.length} new item${r.imported.length === 1 ? "" : "s"} in BOS` : "Already up to date", description: r.imported.slice(0, 3).map((i) => i.label).join(" · ") || undefined });
      }}
    >
      {busy === "sync" ? "Syncing…" : "Sync now"}
    </Button>
  );
}

/* ---------- Overview ---------- */

function Overview() {
  const { canManage, navigate } = useBosApp();
  const state = useBosData(async () => {
    const [c, ev] = await Promise.all([bos.connectors(), bos.events({ limit: 60 }).catch(() => ({ events: [] }))]);
    return { ...c, imports: ev.events.filter((e) => e.type.startsWith("connect.")).slice(0, 6) };
  });

  return (
    <Loaded state={state}>
      {({ connectors, autoSync, lastSyncAt, imports }) => {
        const total = connectors.reduce((s, c) => s + c.total, 0);
        const linked = connectors.reduce((s, c) => s + c.linked, 0);
        const pending = connectors.reduce((s, c) => s + c.pending, 0);
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Connected tools" value={connectors.length} chip={{ color: "blue", glyph: "⇄" }} delta="Reading live JBT records" deltaTone="muted" />
              <KpiCard label="Records available" value={total} chip={{ color: "lavender", glyph: "▤" }} delta="Non-draft documents" deltaTone="muted" />
              <KpiCard label="Linked to BOS" value={linked} chip={{ color: "mint", glyph: "✓" }} delta={total ? `${Math.round((linked / total) * 100)}% coverage` : "—"} />
              <KpiCard label="Ready to import" value={pending} chip={{ color: "amber", glyph: "↓" }} delta={autoSync ? "Auto-sync is on" : "Auto-sync is off"} deltaTone={pending ? "warn" : "muted"} />
            </Grid>
            <ModuleToolbar>
              <span className="bos-text-faint" style={{ fontSize: 12.5 }}>
                {lastSyncAt ? `Last synced ${timeAgo(new Date(lastSyncAt).toISOString())}` : "Not synced yet"} · approved quotations become customers + draft invoices, submitted surveys become customers + projects
              </span>
              <span className="bos-spacer" />
              {canManage ? (
                <Button size="sm" variant="ghost" onClick={() => navigate("settings", "integrations")}>
                  Sync settings
                </Button>
              ) : null}
              <SyncButton />
            </ModuleToolbar>
            <Grid cols={2}>
              {connectors.map((c) => (
                <ConnectorCard key={c.id} connector={c} />
              ))}
            </Grid>
            <WidgetCard title="🔄 Recent imports" dot="mint">
              {imports.length ? (
                imports.map((e) => <WidgetRow key={e.id} label={e.summary} value={timeAgo(e.createdAt)} valueTone="faint" soft />)
              ) : (
                <WidgetRow label={<span className="bos-text-faint">Nothing imported yet — press Sync now.</span>} />
              )}
            </WidgetCard>
          </Stack>
        );
      }}
    </Loaded>
  );
}

function ConnectorCard({ connector: c }: { connector: ConnectorSummary }) {
  const { selectModule } = useBosApp();
  const pct = c.total ? Math.round((c.linked / c.total) * 100) : 0;
  return (
    <Card interactive={false} className="bos-app-connector">
      <div className="bos-app-connector-head">
        <span className="bos-app-connector-icon" aria-hidden="true">
          {c.icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="bos-app-connector-name">{c.label}</div>
          <div className="bos-text-faint" style={{ fontSize: 11.5 }}>
            {c.total} records · {c.linked} linked · {c.pending} ready
          </div>
        </div>
        <Badge tone="emerald">LIVE</Badge>
      </div>
      <div className="bos-app-connector-desc">{c.description}</div>
      <div className="bos-app-flow">
        <span>{c.label}</span>
        {c.targets.map((t) => (
          <span key={t} className="bos-row" style={{ gap: 6 }}>
            <span className="bos-app-flow-arrow">→</span>
            <span>{TARGET_FLOW[t]}</span>
          </span>
        ))}
      </div>
      <ProgressBar value={pct} tone="emerald" label={`${pct}% of records linked`} />
      <div className="bos-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" onClick={() => selectModule("connect", c.id)}>
          Review records
        </Button>
        <a className="bos-btn bos-btn-secondary bos-btn-sm" href={withBasePath(c.href)}>
          Open {c.label} ↗
        </a>
      </div>
    </Card>
  );
}

/* ---------- Connector records ---------- */

type Filter = "all" | "pending" | "linked";

function ConnectorRecords({ tool }: { tool: string }) {
  const { run, busy } = useBosAction();
  const openTarget = useOpenTarget();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const state = useBosData(() => bos.connectorItems(tool), [tool]);

  return (
    <Loaded state={state}>
      {({ connector, items }) => {
        const q = query.trim().toLowerCase();
        const isLinked = (i: ConnectorItem) => connector.targets.every((t) => i.links[t] || !i.suggested.includes(t));
        const rows = items.filter(
          (i) => (filter === "all" || (filter === "linked" ? Object.keys(i.links).length > 0 : !isLinked(i))) && (!q || `${i.docNo} ${i.title} ${i.party.name} ${i.party.company ?? ""}`.toLowerCase().includes(q)),
        );
        const columns: BosColumn<ConnectorItem>[] = [
          { key: "docNo", header: "Document", mono: true, cell: (i) => i.docNo },
          {
            key: "party",
            header: "Customer",
            cell: (i) => (
              <span>
                {i.party.name}
                {i.party.city ? <span className="bos-text-faint"> · {i.party.city}</span> : null}
              </span>
            ),
          },
          { key: "date", header: "Date", mono: true, cell: (i) => dateLabel(i.date) },
          { key: "status", header: "Status", cell: (i) => <Badge tone={i.status === "approved" ? "emerald" : i.status === "rejected" ? "coral" : "blue"}>{i.status.toUpperCase()}</Badge> },
          { key: "amount", header: "Amount", align: "right", mono: true, cell: (i) => (i.amount ? inr(i.amount) : "—") },
          {
            key: "targets",
            header: "In BOS",
            cell: (i) => (
              <span className="bos-row" style={{ gap: 6, flexWrap: "wrap" }}>
                {connector.targets.map((t) => {
                  const id = i.links[t];
                  return id ? (
                    <Button key={t} size="sm" variant="ghost" icon="check" onClick={() => openTarget(t, id)}>
                      {TARGET_LABEL[t]}
                    </Button>
                  ) : (
                    <Button
                      key={t}
                      size="sm"
                      variant={i.suggested.includes(t) ? "primary" : "secondary"}
                      icon="plus"
                      disabled={busy !== null}
                      title={i.suggested.includes(t) ? `Recommended for ${i.status} records` : undefined}
                      onClick={() => run(`imp-${i.ref}-${t}`, () => bos.importRecord(tool, i.ref, t), { success: `${TARGET_LABEL[t]} created`, description: `${i.docNo} · ${i.party.name}` })}
                    >
                      {TARGET_LABEL[t]}
                    </Button>
                  );
                })}
              </span>
            ),
          },
        ];
        return (
          <Stack>
            <Alert tone="blue" title={`${connector.icon} ${connector.label} → Justx BOS`}>
              {connector.description} Imports are idempotent — a record is never duplicated, and the original document in {connector.label} is never modified.
            </Alert>
            <ModuleToolbar>
              <SearchInput placeholder="Search document, customer…" aria-label={`Search ${connector.label}`} value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <a className="bos-btn bos-btn-secondary bos-btn-sm" href={withBasePath(connector.href)}>
                Open {connector.label} ↗
              </a>
              <SyncButton variant="secondary" />
            </ModuleToolbar>
            <div className="bos-subtabs" style={{ paddingTop: 0 }}>
              <Segmented<Filter>
                role="radio"
                size="sm"
                aria-label="Filter records"
                options={[
                  { value: "all", label: `All · ${items.length}` },
                  { value: "pending", label: "Ready to import" },
                  { value: "linked", label: "Linked" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </div>
            <div>
              <DataTable caption={`${connector.label} records`} columns={columns} rows={rows} rowKey={(i) => i.ref} empty={items.length ? "No records in this view." : `No ${connector.label} documents yet — anything saved there (except drafts) shows up here.`} />
              <Pagination>
                Showing {rows.length} of {items.length}
              </Pagination>
            </div>
          </Stack>
        );
      }}
    </Loaded>
  );
}

export function ConnectWorkspace() {
  const { session, logoSrc, openPalette } = useBosApp();
  const nav = useWorkspaceModule("connect", "overview");
  const modules: LiveModule[] = [
    { key: "overview", label: "Overview", icon: "🔗", title: "Connected Tools", sub: "BOS reads your JBT tools — quotations and site surveys flow into customers, invoices and projects", render: () => <Overview /> },
    ...session.connectors.map<LiveModule>((c) => ({
      key: c.id,
      label: c.label,
      icon: c.icon,
      title: c.label,
      sub: `Records from ${c.label} and what they became in BOS`,
      render: () => <ConnectorRecords tool={c.id} />,
    })),
  ];
  return (
    <LiveWorkspace
      modules={modules}
      active={nav.active}
      onSelect={nav.onSelect}
      navSeq={nav.navSeq}
      brandName={session.brand?.name || session.settings.companyName || "Justx BOS"}
      logoSrc={logoSrc}
      onSearch={openPalette}
      label="Connected tools"
    />
  );
}
