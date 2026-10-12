"use client";

import "./purchase.css";
import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, DataTable, Dialog, EmptyState, FilterChip, Grid, KpiCard, Pagination, PersonCell, SearchInput, Select, type BosColumn } from "@/components/bos";
import { dateLabel, downloadCsv, downloadXlsx, inr, inrCompact, readSheet, type ExportColumn } from "@/lib/ims/format";
import { purchase, type Party, type PartyStats } from "@/lib/ims/purchase";
import { Loaded, PageHeader, PersonAvatar, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { PartyDialog } from "./PartyDialog";
import { PartyDetailDialog } from "./PartyDetail";
import { ConfirmDialog, KindBadge } from "./ui";

type KindTab = "all" | "supplier" | "customer";
type Flag = "gstin" | "balance" | "openPo" | "archived";
const PAGE = 50;

type Row = Party & { stats: PartyStats };

const EXPORT_COLUMNS: ReadonlyArray<ExportColumn<Row>> = [
  { header: "Name", value: (p) => p.name },
  { header: "Type", value: (p) => p.kind },
  { header: "Contact person", value: (p) => p.contactPerson },
  { header: "Mobile", value: (p) => p.mobile },
  { header: "Email", value: (p) => p.email },
  { header: "GSTIN", value: (p) => p.gstin },
  { header: "PAN", value: (p) => p.pan },
  { header: "Address", value: (p) => p.address },
  { header: "City", value: (p) => p.city },
  { header: "State", value: (p) => p.state },
  { header: "State code", value: (p) => p.stateCode },
  { header: "Payment terms days", value: (p) => p.paymentTermsDays },
  { header: "Credit limit", value: (p) => p.creditLimit },
  { header: "Opening balance", value: (p) => p.openingBalance },
  { header: "Account manager", value: (p) => p.accountManagerName },
  { header: "Tags", value: (p) => p.tags.join(", ") },
  { header: "Items supplied", value: (p) => p.stats.itemsSupplied },
  { header: "Open PO value", value: (p) => p.stats.openPoValue },
  { header: "Receivable", value: (p) => p.stats.receivable },
  { header: "Payable", value: (p) => p.stats.payable },
  { header: "Net balance", value: (p) => p.stats.netBalance },
  { header: "Last purchase", value: (p) => p.stats.lastPurchaseDate },
  { header: "Active", value: (p) => (p.active ? "Yes" : "No") },
  { header: "Notes", value: (p) => p.notes },
];

const TEMPLATE_HEADERS = ["Name", "Type", "Contact person", "Mobile", "Email", "GSTIN", "Address", "City", "State", "Payment terms days", "Credit limit", "Opening balance", "Tags", "Notes"];

function BalanceCell({ s }: { s: PartyStats }) {
  if (Math.abs(s.netBalance) < 0.005) return <span className="ims-faint">Settled</span>;
  return s.netBalance > 0 ? (
    <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
      <span className="ims-num ims-strong" style={{ color: "var(--bos-amber-600)" }}>
        {inr(s.netBalance)}
      </span>
      <small>they owe</small>
    </span>
  ) : (
    <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
      <span className="ims-num ims-strong" style={{ color: "var(--bos-coral-600)" }}>
        {inr(-s.netBalance)}
      </span>
      <small>we owe</small>
    </span>
  );
}

export function PartiesModule() {
  const { can, takeIntent } = useIms();
  const { run, busy } = useImsAction();
  const [intent] = useState(() => takeIntent("parties"));
  const [kind, setKind] = useState<KindTab>("all");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [flags, setFlags] = useState<ReadonlySet<Flag>>(new Set());
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Party | null | "new">(intent === "new" ? "new" : null);
  const [viewing, setViewing] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [archiving, setArchiving] = useState<Party | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const showArchived = flags.has("archived");
  const state = useImsData(() => purchase.parties({ stats: true, includeInactive: showArchived }), [showArchived]);
  const canManage = can("suppliers");

  const toggle = (f: Flag) => {
    setFlags((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
    setPage(0);
  };

  const all = useMemo(() => (state.data?.parties ?? []) as Row[], [state.data]);
  const states = useMemo(() => [...new Set(all.map((p) => p.state).filter((s): s is string => Boolean(s)))].sort(), [all]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (p) =>
        (kind === "all" || p.kind === kind || p.kind === "both") &&
        (!stateFilter || p.state === stateFilter) &&
        (!flags.has("gstin") || Boolean(p.gstin)) &&
        (!flags.has("balance") || Math.abs(p.stats.netBalance) >= 0.005) &&
        (!flags.has("openPo") || p.stats.openPoCount > 0) &&
        (showArchived || p.active) &&
        (!q || [p.name, p.contactPerson, p.mobile, p.email, p.gstin, p.city, p.tags.join(" ")].some((v) => v && v.toLowerCase().includes(q))),
    );
  }, [all, kind, stateFilter, flags, showArchived, query]);
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));

  const active = all.filter((p) => p.active);
  const suppliers = active.filter((p) => p.kind !== "customer");
  const customers = active.filter((p) => p.kind !== "supplier");
  const payable = suppliers.reduce((s, p) => s + p.stats.payable, 0);
  const receivable = customers.reduce((s, p) => s + p.stats.receivable, 0);
  const openPo = suppliers.reduce((s, p) => s + p.stats.openPoValue, 0);

  const onImport = async (file: File) => {
    const sheet = await readSheet(file).catch(() => null);
    if (!sheet?.length) {
      setImportResult({ created: 0, updated: 0, errors: ["The file is empty or couldn't be read. Use the CSV template as a starting point."] });
      return;
    }
    const out = await run("import", () => purchase.importParties(sheet, kind === "customer" ? "customer" : "supplier"), { success: "Import finished" });
    if (out) setImportResult(out);
  };

  const exportAll = (format: "csv" | "xlsx") =>
    run(
      `export-${format}`,
      async () => {
        const { parties } = await purchase.exportParties();
        if (format === "csv") downloadCsv("parties", parties, EXPORT_COLUMNS);
        else await downloadXlsx("parties", "Parties", parties, EXPORT_COLUMNS);
      },
      { refresh: false },
    );

  const columns: BosColumn<Row>[] = [
    {
      key: "name",
      header: "Name",
      cell: (p) => (
        <PersonCell
          avatar={<PersonAvatar name={p.name} />}
          name={
            <span className="ims-row" style={{ gap: 6 }}>
              {p.name}
              {!p.active ? <Badge tone="neutral" auto>ARCHIVED</Badge> : null}
            </span>
          }
          role={[p.contactPerson, p.city].filter(Boolean).join(" · ") || undefined}
        />
      ),
    },
    { key: "kind", header: "Type", cell: (p) => <KindBadge kind={p.kind} /> },
    { key: "gstin", header: "GSTIN", mono: true, cell: (p) => p.gstin ?? <span className="ims-faint">Unregistered</span> },
    { key: "mobile", header: "Mobile", mono: true, cell: (p) => p.mobile ?? "—" },
    { key: "items", header: "Items", align: "right", cell: (p) => (p.kind === "customer" ? "—" : p.stats.itemsSupplied || "—") },
    {
      key: "openPo",
      header: "Open POs",
      align: "right",
      cell: (p) =>
        p.stats.openPoCount ? (
          <span className="ims-cell-stack" style={{ alignItems: "flex-end" }}>
            <span className="ims-num">{inr(p.stats.openPoValue)}</span>
            <small>{p.stats.openPoCount} open</small>
          </span>
        ) : (
          "—"
        ),
    },
    { key: "balance", header: "Balance", align: "right", cell: (p) => <BalanceCell s={p.stats} /> },
    { key: "last", header: "Last purchase", mono: true, cell: (p) => (p.stats.lastPurchaseDate ? dateLabel(p.stats.lastPurchaseDate) : "—") },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            cell: (p: Row) => (
              <span className="ims-row" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                  Edit
                </Button>
                {p.active ? (
                  <Button size="sm" variant="ghost" onClick={() => setArchiving(p)}>
                    Remove
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => run("restore", () => purchase.updateParty(p.id, { active: true }), { success: "Restored", description: p.name })}>
                    Restore
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Suppliers & Customers"
        sub="Every vendor and customer with GSTIN, terms, credit and live balances from bills and invoices."
        actions={
          <>
            {canManage ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void onImport(file);
                  }}
                />
                <Button size="sm" icon="download" onClick={() => fileRef.current?.click()} disabled={busy === "import"}>
                  {busy === "import" ? "Importing…" : "Import"}
                </Button>
              </>
            ) : null}
            <Button size="sm" icon="file" onClick={() => exportAll("xlsx")} disabled={busy === "export-xlsx"}>
              Excel
            </Button>
            <Button size="sm" onClick={() => exportAll("csv")} disabled={busy === "export-csv"}>
              CSV
            </Button>
            {can("suppliers") || can("po") || can("sales") ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
                Add {kind === "customer" ? "customer" : "supplier"}
              </Button>
            ) : null}
          </>
        }
      />
      <Loaded state={state}>
        {() => (
          <Stack>
            <Grid cols={4} min={150}>
              <KpiCard label="Suppliers" value={suppliers.length} chip={{ color: "lavender", glyph: "🚚" }} delta={`${suppliers.filter((p) => p.stats.openPoCount).length} with open POs`} deltaTone="muted" />
              <KpiCard label="Customers" value={customers.length} chip={{ color: "mint", glyph: "👥" }} delta={`${active.filter((p) => p.gstin).length} parties with GSTIN`} deltaTone="muted" />
              <KpiCard label="We owe suppliers" value={inrCompact(payable)} chip={{ color: "rose", glyph: "₹" }} delta={`Open POs ${inrCompact(openPo)}`} deltaTone={payable ? "warn" : "muted"} />
              <KpiCard label="Customers owe us" value={inrCompact(receivable)} chip={{ color: "amber", glyph: "₹" }} delta="Issued invoice balances" deltaTone={receivable ? "info" : "muted"} />
            </Grid>

            <div>
              <SubTabs<KindTab>
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setPage(0);
                }}
                label="Party type"
                options={[
                  { value: "all", label: `All · ${active.length}` },
                  { value: "supplier", label: `Suppliers · ${suppliers.length}` },
                  { value: "customer", label: `Customers · ${customers.length}` },
                ]}
              />
              <div className="ims-toolbar" style={{ marginTop: 10 }}>
                <div className="ims-grow">
                  <SearchInput
                    placeholder="Search name, contact, mobile, GSTIN, city, tag…"
                    aria-label="Search suppliers and customers"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <Select
                  size="sm"
                  aria-label="Filter by state"
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value);
                    setPage(0);
                  }}
                  style={{ width: "auto", minWidth: 150 }}
                >
                  <option value="">All states</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <FilterChip active={flags.has("gstin")} onClick={() => toggle("gstin")}>
                  With GSTIN
                </FilterChip>
                <FilterChip active={flags.has("balance")} onClick={() => toggle("balance")}>
                  Has balance
                </FilterChip>
                <FilterChip active={flags.has("openPo")} onClick={() => toggle("openPo")}>
                  Open POs
                </FilterChip>
                <FilterChip active={showArchived} onClick={() => toggle("archived")}>
                  Show archived
                </FilterChip>
              </div>
            </div>

            {all.length === 0 ? (
              <EmptyState
                icon="users"
                title="No suppliers or customers yet"
                actions={
                  canManage ? (
                    <>
                      <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
                        Add supplier
                      </Button>
                      <Button onClick={() => fileRef.current?.click()}>Import from Excel</Button>
                    </>
                  ) : undefined
                }
              >
                Add the vendors you buy from and the customers you sell to — or import them from a spreadsheet.
              </EmptyState>
            ) : (
              <div>
                <DataTable
                  caption="Suppliers and customers"
                  columns={columns}
                  rows={pageRows}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => setViewing(p.id)}
                  chevron
                  empty="No parties match these filters."
                />
                <Pagination
                  actions={
                    pages > 1 ? (
                      <>
                        <Button size="sm" icon="chevronLeft" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
                        <span className="ims-faint">
                          Page {page + 1} of {pages}
                        </span>
                        <Button size="sm" icon="chevronRight" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
                      </>
                    ) : undefined
                  }
                >
                  Showing {pageRows.length} of {rows.length}
                  {rows.length !== all.length ? ` (filtered from ${all.length})` : ""}
                  {state.data?.truncated ? " · first 5,000 by name" : ""}
                </Pagination>
              </div>
            )}
          </Stack>
        )}
      </Loaded>

      <PartyDialog
        open={editing !== null}
        party={editing === "new" ? null : editing}
        defaultKind={kind === "customer" ? "customer" : "supplier"}
        onClose={() => setEditing(null)}
      />
      <PartyDetailDialog
        partyId={viewing}
        onClose={() => setViewing(null)}
        onEdit={(p) => {
          setViewing(null);
          setEditing(p);
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={`Remove ${archiving?.name ?? ""}?`}
        description="Parties with POs, bills, invoices, items or stock history are archived (kept on past documents and reports, hidden from pickers). Unused parties are deleted."
        confirmLabel="Remove"
        destructive
        busy={busy === "archive"}
        onConfirm={async () => {
          if (!archiving) return;
          const p = archiving;
          await run("archive", () => purchase.deleteParty(p.id), { success: "Removed", description: p.name });
          setArchiving(null);
        }}
      />
      <Dialog
        open={importResult !== null}
        onClose={() => setImportResult(null)}
        title="Import summary"
        wide
        actions={
          <>
            <Button
              variant="ghost"
              icon="download"
              onClick={() =>
                downloadCsv<Record<string, never>>(
                  "parties-template",
                  [],
                  TEMPLATE_HEADERS.map((h) => ({ header: h, value: () => "" })),
                )
              }
            >
              CSV template
            </Button>
            <Button variant="primary" onClick={() => setImportResult(null)}>
              Done
            </Button>
          </>
        }
      >
        {importResult ? (
          <div className="bos-stack" style={{ gap: 12 }}>
            <p>
              <b>{importResult.created}</b> added · <b>{importResult.updated}</b> updated (matched by GSTIN, then by name)
              {importResult.errors.length ? (
                <>
                  {" "}
                  · <b>{importResult.errors.length}</b> skipped
                </>
              ) : null}
            </p>
            {importResult.errors.length ? (
              <Alert tone="amber" title="Rows that need attention">
                <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 200, overflowY: "auto" }}>
                  {importResult.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <p className="ims-faint">Columns recognised: {TEMPLATE_HEADERS.join(", ")}. Type accepts supplier, customer or both.</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
