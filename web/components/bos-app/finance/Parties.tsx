"use client";

import { useState } from "react";
import { Badge, Button, DataTable, Grid, KpiCard, ModuleToolbar, Pagination, PersonCell, SearchInput, Segmented, type BosColumn } from "@/components/bos";
import { bos, type BosParty } from "@/lib/bos-app/api";
import { inr, inrCompact, sourceLabel } from "@/lib/bos-app/format";
import { Loaded, PersonAvatar, Stack, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, PartyDialog } from "../dialogs";

type Filter = "all" | "customer" | "vendor";

const KIND_TAG = { customer: { text: "CUSTOMER", tag: "mint" }, vendor: { text: "VENDOR", tag: "lavender" }, both: { text: "BOTH", tag: "blue" } } as const;

export function Parties() {
  const { canManage, navigate } = useBosApp();
  const { run, busy } = useBosAction();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BosParty | null | "new">(null);
  const [archiving, setArchiving] = useState<BosParty | null>(null);
  const state = useBosData(() => bos.parties(), []);

  return (
    <Loaded state={state}>
      {({ parties, truncated }) => {
        const q = query.trim().toLowerCase();
        const rows = parties.filter(
          (p) =>
            (filter === "all" || p.kind === filter || p.kind === "both") &&
            (!q || `${p.name} ${p.company ?? ""} ${p.phone ?? ""} ${p.gstin ?? ""} ${p.city ?? ""}`.toLowerCase().includes(q)),
        );
        const customers = parties.filter((p) => p.kind !== "vendor");
        const receivable = customers.reduce((s, p) => s + (p.balance ?? 0), 0);
        const synced = parties.filter((p) => p.sourceTool).length;

        const columns: BosColumn<BosParty>[] = [
          { key: "name", header: "Name", cell: (p) => <PersonCell avatar={<PersonAvatar name={p.name} />} name={p.name} role={[p.company, p.city].filter(Boolean).join(" · ") || undefined} /> },
          { key: "kind", header: "Type", cell: (p) => <Badge tag={KIND_TAG[p.kind].tag}>{KIND_TAG[p.kind].text}</Badge> },
          { key: "gstin", header: "GSTIN", mono: true, cell: (p) => p.gstin ?? "—" },
          { key: "phone", header: "Phone", mono: true, cell: (p) => p.phone ?? "—" },
          { key: "invoiced", header: "Invoiced", align: "right", mono: true, cell: (p) => (p.kind === "vendor" ? "—" : inr(p.invoiced ?? 0)) },
          {
            key: "balance",
            header: "Balance",
            align: "right",
            mono: true,
            cell: (p) => (p.balance ? <span style={{ color: "var(--bos-amber-600)", fontWeight: 650 }}>{inr(p.balance)}</span> : "—"),
          },
          { key: "source", header: "Source", cell: (p) => (p.sourceTool ? <Badge tag="sage">{sourceLabel(p.sourceTool)}</Badge> : <span className="bos-text-faint">Manual</span>) },
          ...(canManage
            ? [
                {
                  key: "actions",
                  header: "",
                  cell: (p: BosParty) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiving(p);
                      }}
                    >
                      Archive
                    </Button>
                  ),
                },
              ]
            : []),
        ];

        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Customers" value={customers.length} chip={{ color: "mint", glyph: "👥" }} delta={`${synced} synced from JBT tools`} deltaTone="muted" />
              <KpiCard label="Vendors" value={parties.filter((p) => p.kind !== "customer").length} chip={{ color: "lavender", glyph: "🏭" }} delta="Bills & payables" deltaTone="muted" />
              <KpiCard label="Receivable" value={inrCompact(receivable)} chip={{ color: "rose", glyph: "₹" }} delta="Open invoice balance" deltaTone={receivable ? "warn" : "muted"} />
              <KpiCard label="With GSTIN" value={parties.filter((p) => p.gstin).length} chip={{ color: "blue", glyph: "✓" }} delta="B2B-ready records" deltaTone="muted" />
            </Grid>
            <ModuleToolbar>
              <SearchInput placeholder="Search name, phone, GSTIN, city…" aria-label="Search customers and vendors" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="bos-spacer" />
              <Button size="sm" onClick={() => navigate("connect")}>
                Sync from tools
              </Button>
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
                New
              </Button>
            </ModuleToolbar>
            <div className="bos-subtabs" style={{ paddingTop: 0 }}>
              <Segmented<Filter>
                role="radio"
                size="sm"
                aria-label="Filter by type"
                options={[
                  { value: "all", label: "All" },
                  { value: "customer", label: "Customers" },
                  { value: "vendor", label: "Vendors" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </div>
            <div>
              <DataTable
                caption="Customers and vendors"
                columns={columns}
                rows={rows}
                rowKey={(p) => p.id}
                onRowClick={(p) => setEditing(p)}
                chevron
                empty={parties.length ? "No matches for your search." : "No customers yet — add one, or sync approved quotations and site surveys from Connected Tools."}
              />
              <Pagination>
                Showing {rows.length} of {parties.length}
                {truncated ? " · the first 5,000 by name" : ""}
              </Pagination>
            </div>
            <PartyDialog open={editing !== null} party={editing === "new" ? null : editing} onClose={() => setEditing(null)} defaultKind={filter === "vendor" ? "vendor" : "customer"} />
            <ConfirmDialog
              open={archiving !== null}
              onClose={() => setArchiving(null)}
              title={`Archive ${archiving?.name ?? ""}?`}
              description="Archived records disappear from lists and pickers. Their invoices and bills are kept."
              confirmLabel="Archive"
              destructive
              busy={busy === "archive"}
              onConfirm={async () => {
                if (!archiving) return;
                await run("archive", () => bos.archiveParty(archiving.id), { success: "Archived", description: archiving.name });
                setArchiving(null);
              }}
            />
          </Stack>
        );
      }}
    </Loaded>
  );
}
