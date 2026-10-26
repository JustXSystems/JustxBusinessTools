"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, FilterChip, SearchInput, Segmented, type BosColumn } from "@/components/bos";
import { withBasePath } from "@/lib/base-path";
import { dateLabel, inr, stampLabel, timeAgo } from "@/lib/ims/format";
import {
  imsSystem,
  type CatalogImportResponse,
  type CatalogState,
  type ConnectCatalogCard,
  type ConnectCatalogItem,
  type ConnectCatalogParty,
  type ConnectLink,
  type ConnectOverview,
  type ConnectRecord,
  type ConnectSourceCard,
  type DocImportResult,
} from "@/lib/ims/system";
import { Loaded, PageHeader, PersonAvatar, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { ToolHead, useDebounced } from "./shared";

type Tab = "tools" | "links";
type Panel = { kind: "source"; tool: ConnectSourceCard } | { kind: "items" | "parties"; tool: ConnectCatalogCard } | null;

const STATE_BADGE: Record<CatalogState, { tone: "emerald" | "blue" | "neutral"; text: string }> = {
  linked: { tone: "emerald", text: "Linked" },
  match: { tone: "blue", text: "Matches existing" },
  new: { tone: "neutral", text: "New" },
};

export function ConnectModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("connect"));
  const [tab, setTab] = useState<Tab>(intent === "links" ? "links" : "tools");
  const state = useImsData(() => imsSystem.connectOverview(), []);
  const [panel, setPanel] = useState<Panel>(null);
  const [autoOpened, setAutoOpened] = useState(false);

  if (!autoOpened && state.data && intent) {
    setAutoOpened(true);
    const [kind, id] = intent.split(":");
    const src = kind === "source" ? state.data.sources.find((s) => s.id === id) : undefined;
    const cat = kind === "items" || kind === "parties" ? state.data.catalogs.find((c) => c.id === id) : undefined;
    if (src) setPanel({ kind: "source", tool: src });
    else if (cat) setPanel({ kind: kind === "items" ? "items" : "parties", tool: cat });
  }

  return (
    <Stack>
      <PageHeader title="Connected Tools" sub="Bring quotations, products and contacts from your other Justx tools into IMS — every import is linked, so nothing is brought in twice." />
      <SubTabs
        label="Connected tools"
        value={tab}
        onChange={setTab}
        options={[
          { value: "tools", label: "Tools" },
          { value: "links", label: "Linked records" },
        ]}
      />
      {tab === "tools" ? (
        <Loaded state={state}>{(d) => <ToolsTab data={d} onOpen={setPanel} />}</Loaded>
      ) : (
        <LinksTab tools={state.data ? [...state.data.sources, ...state.data.catalogs].map((t) => ({ id: t.id, label: t.label })) : []} />
      )}
      {panel?.kind === "source" ? <SourceDialog key={panel.tool.id} tool={panel.tool} canImport={state.data?.can.importDocuments ?? false} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === "items" ? <CatalogItemsDialog key={`i-${panel.tool.id}`} tool={panel.tool} canImport={state.data?.can.importItems ?? false} onClose={() => setPanel(null)} /> : null}
      {panel?.kind === "parties" ? <CatalogPartiesDialog key={`p-${panel.tool.id}`} tool={panel.tool} canImport={state.data?.can.importParties ?? false} onClose={() => setPanel(null)} /> : null}
    </Stack>
  );
}

function OpenToolLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="bos-btn bos-btn-ghost bos-btn-sm" href={withBasePath(href)} aria-label={`Open ${label}`}>
      Open tool ↗
    </a>
  );
}

function ToolsTab({ data, onOpen }: { data: ConnectOverview; onOpen: (p: Panel) => void }) {
  const none = !data.sources.length && !data.catalogs.length;
  return (
    <Stack gap={16}>
      {none ? (
        <Card interactive={false}>
          <EmptyState glyph="⧉" title="No connected tools yet">
            Quotation V1 and Justx BOS appear here once they&apos;re enabled for your organisation.
          </EmptyState>
        </Card>
      ) : null}
      <div className="ims-sys-tools">
        {data.sources.map((s) => (
          <Card key={s.id} interactive={false} className="ims-sys-tool">
            <ToolHead glyph={s.icon} title={s.label} sub={s.description} />
            {s.error ? <Alert tone="amber" title="Couldn't read this tool">{s.error}</Alert> : null}
            <div className="ims-sys-tool-stats">
              <span>
                <b>{s.total}</b> documents
              </span>
              <span>
                <b>{s.ready}</b> approved, not imported
              </span>
              <span>
                <b>{s.imported}</b> imported
              </span>
            </div>
            <div className="ims-sys-flow">
              {s.icon} {s.label} <span aria-hidden="true">→</span> 🧾 Draft invoices + customers
            </div>
            <div className="ims-sys-tool-actions">
              <Button size="sm" variant={s.ready ? "primary" : "secondary"} disabled={!s.total} onClick={() => onOpen({ kind: "source", tool: s })}>
                {s.ready ? `Review ${s.ready} ready` : "Browse documents"}
              </Button>
              <OpenToolLink href={s.href} label={s.label} />
            </div>
          </Card>
        ))}
        {data.catalogs.map((c) => (
          <Card key={c.id} interactive={false} className="ims-sys-tool">
            <ToolHead glyph={c.icon} title={`${c.label} catalog`} sub={c.description} />
            <div className="ims-sys-tool-stats">
              <span>
                <b>
                  {c.itemsLinked}/{c.items}
                </b>{" "}
                products linked
              </span>
              <span>
                <b>
                  {c.partiesLinked}/{c.parties}
                </b>{" "}
                contacts linked
              </span>
            </div>
            <div className="ims-sys-flow">
              {c.icon} Products, customers &amp; vendors <span aria-hidden="true">→</span> 📦 Items + 👥 Parties
            </div>
            <div className="ims-sys-tool-actions">
              <Button size="sm" disabled={!c.items} onClick={() => onOpen({ kind: "items", tool: c })}>
                Products ({c.items})
              </Button>
              <Button size="sm" disabled={!c.parties} onClick={() => onOpen({ kind: "parties", tool: c })}>
                Contacts ({c.parties})
              </Button>
              <OpenToolLink href={c.href} label={c.label} />
            </div>
          </Card>
        ))}
        {data.outbound.map((o) => (
          <Card key={o.id} interactive={false} className="ims-sys-tool">
            <ToolHead glyph={o.icon} title={`IMS → ${o.label}`} sub={o.description} />
            <div className="ims-sys-tool-stats">
              <span>
                <b>{o.available}</b> issued invoices available
              </span>
              <span>
                <b>{inr(o.value)}</b> total
              </span>
            </div>
            <div className="ims-sys-flow">
              🧾 IMS invoices <span aria-hidden="true">→</span> {o.icon} {o.label} → Connected tools
            </div>
            <div className="ims-sys-tool-actions">
              <OpenToolLink href={o.href} label={o.label} />
            </div>
          </Card>
        ))}
      </div>
      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 10 }}>
          <b>Recent imports</b>
        </div>
        {data.recent.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {data.recent.map((r) => (
              <div key={r.id} className="ims-row" style={{ gap: 10, alignItems: "flex-start" }}>
                <PersonAvatar name={r.actorName} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5 }}>{r.summary}</div>
                  <div className="ims-sys-mini">
                    {r.actorName ?? "System"} · {stampLabel(r.createdAt)}
                  </div>
                </div>
                <span className="ims-faint" style={{ fontSize: 12 }}>
                  {timeAgo(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="ims-muted" style={{ margin: 0, fontSize: 13 }}>
            Nothing imported yet.
          </p>
        )}
      </Card>
    </Stack>
  );
}

/* ---------- Documents → draft invoices ---------- */

function SourceDialog({ tool, canImport, onClose }: { tool: ConnectSourceCard; canImport: boolean; onClose: () => void }) {
  const { navigate } = useIms();
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.sourceRecords(tool.id), [tool.id]);
  const [filter, setFilter] = useState<"ready" | "all" | "imported">(tool.ready ? "ready" : "all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase(), 150);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<DocImportResult[] | null>(null);
  const rows = useMemo(() => {
    const list = state.data?.records ?? [];
    return list.filter(
      (r) =>
        (filter === "all" || (filter === "imported" ? r.imported : !r.imported && r.status === "approved")) &&
        (!dq || `${r.docNo} ${r.party.name} ${r.party.company ?? ""} ${r.title}`.toLowerCase().includes(dq)),
    );
  }, [state.data, filter, dq]);
  const importable = rows.filter((r) => !r.imported);
  const picked = [...selected].filter((ref) => importable.some((r) => r.ref === ref));
  const goInvoice = (id: string) => {
    onClose();
    navigate("sales", `open:${id}`);
  };

  const columns: BosColumn<ConnectRecord>[] = [
    { key: "doc", header: "Document", cell: (r) => <span className="ims-cell-stack"><span className="ims-strong ims-num">{r.docNo}</span><small>{dateLabel(r.date)}</small></span> },
    { key: "party", header: "Customer", cell: (r) => <span className="ims-cell-stack"><span>{r.party.company || r.party.name}</span><small>{[r.party.gstin, r.placeOfSupply].filter(Boolean).join(" · ") || "—"}</small></span> },
    { key: "title", header: "About", cell: (r) => <span className="ims-cell-stack"><span>{r.title}</span><small>{r.lineCount} line{r.lineCount === 1 ? "" : "s"}</small></span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="ims-num">{inr(r.amount)}</span> },
    { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "approved" ? "emerald" : "neutral"}>{r.status}</Badge> },
    {
      key: "imported",
      header: "In IMS",
      cell: (r) => {
        const inv = r.invoice;
        return inv ? (
          <button
            type="button"
            style={{ background: "none", border: 0, padding: 0, color: "var(--bos-blue-600)", cursor: "pointer", font: "inherit" }}
            onClick={(e) => {
              e.stopPropagation();
              goInvoice(inv.id);
            }}
          >
            {inv.invoiceNo} ↗
          </button>
        ) : (
          <span className="ims-faint">—</span>
        );
      },
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`${tool.icon} ${tool.label}`}
      description="Imported documents become draft invoices (with a DRAFT number until issued) and their customers join your parties. Lines are matched to your items by name."
      actionsNote={<OpenToolLink href={tool.href} label={tool.label} />}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {canImport ? (
            <Button
              variant="primary"
              disabled={!picked.length || isBusy("import")}
              onClick={async () => {
                const r = await run("import", () => imsSystem.importSource(tool.id, picked), { success: "Import finished" });
                if (r) {
                  setResults(r.results);
                  setSelected(new Set());
                  state.reload();
                }
              }}
            >
              {isBusy("import") ? "Importing…" : `Import ${picked.length || ""} as draft invoice${picked.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={12}>
        {!canImport ? <Alert tone="blue" title="View only">Importing creates draft sales invoices, so it needs the Sales invoices permission.</Alert> : null}
        {results ? <DocResults results={results} onOpen={goInvoice} /> : null}
        <div className="ims-toolbar" style={{ marginBottom: 0 }}>
          <Segmented
            size="sm"
            role="radio"
            aria-label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ready", label: "Approved, not imported" },
              { value: "all", label: "All" },
              { value: "imported", label: "Imported" },
            ]}
          />
          <SearchInput wrapperClassName="ims-grow" placeholder="Search number, customer…" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Loaded state={state}>
          {() => (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.ref}
              compact
              caption={`${tool.label} documents`}
              selection={canImport ? { selected, onChange: (next) => setSelected(new Set([...next].filter((ref) => importable.some((r) => r.ref === ref)))) } : undefined}
              bulkActions={(n) => <span className="ims-muted" style={{ fontSize: 13 }}>{n} selected</span>}
              empty={<EmptyState glyph={tool.icon} title="Nothing here">{filter === "ready" ? "No approved documents waiting. Approve a quotation in the tool, or switch to All." : "No documents match."}</EmptyState>}
            />
          )}
        </Loaded>
      </Stack>
    </Dialog>
  );
}

function DocResults({ results, onOpen }: { results: DocImportResult[]; onOpen: (id: string) => void }) {
  const ok = results.filter((r) => r.status === "imported");
  const bad = results.filter((r) => r.status !== "imported");
  return (
    <Alert tone={bad.some((r) => r.status === "failed") ? "amber" : "emerald"} title={`${ok.length} imported${bad.length ? ` · ${bad.length} not imported` : ""}`}>
      <ul className="ims-sys-steps" style={{ marginTop: 6 }}>
        {results.map((r) => (
          <li key={r.ref}>
            <Badge tone={r.status === "imported" ? "emerald" : r.status === "skipped" ? "neutral" : "coral"}>{r.status}</Badge>
            <span>
              <b>{r.docNo}</b>
              {r.status === "imported" ? (
                <>
                  {" → "}
                  <button type="button" style={{ background: "none", border: 0, padding: 0, color: "var(--bos-blue-600)", cursor: "pointer", font: "inherit" }} onClick={() => r.invoiceId && onOpen(r.invoiceId)}>
                    {r.invoiceNo}
                  </button>
                  {` · ${r.partyName ?? ""}${r.partyCreated ? " (new customer)" : ""} · ${r.linkedLines ?? 0} line${r.linkedLines === 1 ? "" : "s"} linked to items${r.freeLines ? `, ${r.freeLines} free-text` : ""}`}
                </>
              ) : (
                ` — ${r.message ?? ""}`
              )}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/* ---------- Catalog → items / parties ---------- */

function CatalogResults({ res, onOpen }: { res: CatalogImportResponse; onOpen: (id: string) => void }) {
  const { summary } = res;
  return (
    <Alert tone={summary.failed ? "amber" : "emerald"} title={`${summary.created} created · ${summary.linked} linked to existing${summary.skipped ? ` · ${summary.skipped} already imported` : ""}${summary.failed ? ` · ${summary.failed} failed` : ""}`}>
      {res.results.some((r) => r.status === "failed") ? (
        <ul className="ims-sys-steps" style={{ marginTop: 6 }}>
          {res.results
            .filter((r) => r.status === "failed")
            .map((r) => (
              <li key={r.ref}>
                <Badge tone="coral">failed</Badge>
                <span>
                  <b>{r.name}</b> — {r.message}
                </span>
              </li>
            ))}
        </ul>
      ) : (
        <div className="ims-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {res.results
            .filter((r) => r.id && r.status !== "skipped")
            .slice(0, 12)
            .map((r) => (
              <FilterChip key={r.ref} onClick={() => r.id && onOpen(r.id)}>
                {r.name} ↗
              </FilterChip>
            ))}
        </div>
      )}
    </Alert>
  );
}

function useStateFilter<T extends { state: CatalogState }>(list: ReadonlyArray<T> | undefined, text: (row: T) => string) {
  const [filter, setFilter] = useState<CatalogState | "todo" | "all">("todo");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase(), 150);
  const rows = useMemo(() => (list ?? []).filter((r) => (filter === "all" || (filter === "todo" ? r.state !== "linked" : r.state === filter)) && (!dq || text(r).toLowerCase().includes(dq))), [list, filter, dq, text]);
  return { filter, setFilter, q, setQ, rows };
}

function CatalogToolbar({ filter, setFilter, q, setQ, noun }: { filter: CatalogState | "todo" | "all"; setFilter: (f: CatalogState | "todo" | "all") => void; q: string; setQ: (v: string) => void; noun: string }) {
  return (
    <div className="ims-toolbar" style={{ marginBottom: 0 }}>
      <Segmented
        size="sm"
        role="radio"
        aria-label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "todo", label: "Not linked yet" },
          { value: "new", label: "New" },
          { value: "match", label: "Matches" },
          { value: "linked", label: "Linked" },
          { value: "all", label: "All" },
        ]}
      />
      <SearchInput wrapperClassName="ims-grow" placeholder={`Search ${noun}…`} aria-label={`Search ${noun}`} value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  );
}

const itemText = (i: ConnectCatalogItem) => `${i.name} ${i.sku ?? ""} ${i.hsn ?? ""}`;
const partyText = (p: ConnectCatalogParty) => `${p.name} ${p.company ?? ""} ${p.gstin ?? ""} ${p.phone ?? ""} ${p.city ?? ""}`;

function CatalogItemsDialog({ tool, canImport, onClose }: { tool: ConnectCatalogCard; canImport: boolean; onClose: () => void }) {
  const { navigate } = useIms();
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.catalogItems(tool.id), [tool.id]);
  const f = useStateFilter(state.data?.items, itemText);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<CatalogImportResponse | null>(null);
  const pickable = f.rows.filter((r) => r.state !== "linked");
  const picked = [...selected].filter((ref) => pickable.some((r) => r.ref === ref));
  const open = (id: string) => {
    onClose();
    navigate("items", `open:${id}`);
  };
  const columns: BosColumn<ConnectCatalogItem>[] = [
    { key: "name", header: "Product", cell: (i) => <span className="ims-cell-stack"><span className="ims-strong">{i.name}</span><small>{[i.sku, i.kind === "service" ? "Service" : null].filter(Boolean).join(" · ") || "—"}</small></span> },
    { key: "hsn", header: "HSN · GST", cell: (i) => <span className="ims-muted">{[i.hsn, `${i.gstRate}%`].filter(Boolean).join(" · ")}</span> },
    { key: "unit", header: "Unit", cell: (i) => i.unit ?? "—" },
    { key: "rate", header: "Rate", align: "right", cell: (i) => <span className="ims-num">{inr(i.rate)}</span> },
    {
      key: "state",
      header: "In IMS",
      cell: (i) => (
        <span className="ims-cell-stack" style={{ gap: 2 }}>
          <Badge tone={STATE_BADGE[i.state].tone}>{STATE_BADGE[i.state].text}</Badge>
          {i.state === "match" ? <small>{i.matchName}</small> : null}
        </span>
      ),
    },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`${tool.icon} ${tool.label} products`}
      description="Products matching an IMS item by SKU or name are linked (blank HSN, SKU and price are filled in); the rest become new items with no stock."
      actionsNote={<OpenToolLink href={tool.href} label={tool.label} />}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {canImport ? (
            <Button
              variant="primary"
              disabled={!picked.length || isBusy("import")}
              onClick={async () => {
                const r = await run("import", () => imsSystem.importCatalogItems(tool.id, picked), { success: "Products imported" });
                if (r) {
                  setRes(r);
                  setSelected(new Set());
                  state.reload();
                }
              }}
            >
              {isBusy("import") ? "Importing…" : `Import ${picked.length || ""} product${picked.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={12}>
        {!canImport ? <Alert tone="blue" title="View only">Importing products needs the Items permission.</Alert> : null}
        {res ? <CatalogResults res={res} onOpen={open} /> : null}
        <CatalogToolbar {...f} noun="products" />
        <Loaded state={state}>
          {() => (
            <DataTable
              columns={columns}
              rows={f.rows}
              rowKey={(i) => i.ref}
              compact
              caption="Catalog products"
              onRowClick={(i) => (i.linkedId ? open(i.linkedId) : undefined)}
              selection={canImport ? { selected, onChange: (next) => setSelected(new Set([...next].filter((ref) => pickable.some((r) => r.ref === ref)))) } : undefined}
              bulkActions={(n) => <span className="ims-muted" style={{ fontSize: 13 }}>{n} selected</span>}
              empty={<EmptyState icon="box" title="Nothing to show">{f.filter === "todo" ? "Every product is already linked to an IMS item." : "No products match."}</EmptyState>}
            />
          )}
        </Loaded>
      </Stack>
    </Dialog>
  );
}

function CatalogPartiesDialog({ tool, canImport, onClose }: { tool: ConnectCatalogCard; canImport: boolean; onClose: () => void }) {
  const { navigate } = useIms();
  const { run, isBusy } = useImsAction();
  const state = useImsData(() => imsSystem.catalogParties(tool.id), [tool.id]);
  const f = useStateFilter(state.data?.parties, partyText);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<CatalogImportResponse | null>(null);
  const pickable = f.rows.filter((r) => r.state !== "linked");
  const picked = [...selected].filter((ref) => pickable.some((r) => r.ref === ref));
  const open = (id: string) => {
    onClose();
    navigate("parties", `open:${id}`);
  };
  const columns: BosColumn<ConnectCatalogParty>[] = [
    { key: "name", header: "Name", cell: (p) => <span className="ims-cell-stack"><span className="ims-strong">{p.company || p.name}</span><small>{p.company && p.name !== p.company ? p.name : p.email ?? "—"}</small></span> },
    { key: "kind", header: "Type", cell: (p) => <Badge tone={p.kind === "supplier" ? "lavender" : p.kind === "both" ? "blue" : "neutral"}>{p.kind}</Badge> },
    { key: "gstin", header: "GSTIN", mono: true, cell: (p) => p.gstin ?? "—" },
    { key: "contact", header: "Contact", cell: (p) => <span className="ims-cell-stack"><span>{p.phone ?? "—"}</span><small>{[p.city, p.state].filter(Boolean).join(", ")}</small></span> },
    {
      key: "state",
      header: "In IMS",
      cell: (p) => (
        <span className="ims-cell-stack" style={{ gap: 2 }}>
          <Badge tone={STATE_BADGE[p.state].tone}>{STATE_BADGE[p.state].text}</Badge>
          {p.state === "match" ? <small>{p.matchName}</small> : null}
        </span>
      ),
    },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`${tool.icon} ${tool.label} customers & vendors`}
      description="Contacts matching an IMS party by GSTIN (or name + mobile) are linked and their blank details filled in; vendors become suppliers, customers stay customers."
      actionsNote={<OpenToolLink href={tool.href} label={tool.label} />}
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {canImport ? (
            <Button
              variant="primary"
              disabled={!picked.length || isBusy("import")}
              onClick={async () => {
                const r = await run("import", () => imsSystem.importCatalogParties(tool.id, picked), { success: "Contacts imported" });
                if (r) {
                  setRes(r);
                  setSelected(new Set());
                  state.reload();
                }
              }}
            >
              {isBusy("import") ? "Importing…" : `Import ${picked.length || ""} contact${picked.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={12}>
        {!canImport ? <Alert tone="blue" title="View only">Importing contacts needs the Suppliers & parties permission.</Alert> : null}
        {res ? <CatalogResults res={res} onOpen={open} /> : null}
        <CatalogToolbar {...f} noun="contacts" />
        <Loaded state={state}>
          {() => (
            <DataTable
              columns={columns}
              rows={f.rows}
              rowKey={(p) => p.ref}
              compact
              caption="Catalog contacts"
              onRowClick={(p) => (p.linkedId ? open(p.linkedId) : undefined)}
              selection={canImport ? { selected, onChange: (next) => setSelected(new Set([...next].filter((ref) => pickable.some((r) => r.ref === ref)))) } : undefined}
              bulkActions={(n) => <span className="ims-muted" style={{ fontSize: 13 }}>{n} selected</span>}
              empty={<EmptyState icon="users" title="Nothing to show">{f.filter === "todo" ? "Every contact is already linked to an IMS party." : "No contacts match."}</EmptyState>}
            />
          )}
        </Loaded>
      </Stack>
    </Dialog>
  );
}

/* ---------- Linked records ---------- */

function LinksTab({ tools }: { tools: ReadonlyArray<{ id: string; label: string }> }) {
  const { navigate } = useIms();
  const [tool, setTool] = useState("");
  const [type, setType] = useState<"" | "invoice" | "party" | "item">("");
  const state = useImsData(() => imsSystem.links({ tool: tool || undefined, type: type || undefined, limit: 500 }), [tool, type]);
  const open = (l: ConnectLink) => {
    if (!l.exists) return;
    navigate(l.targetType === "invoice" ? "sales" : l.targetType === "item" ? "items" : "parties", `open:${l.targetId}`);
  };
  const columns: BosColumn<ConnectLink>[] = [
    { key: "date", header: "Linked", cell: (l) => <span className="ims-cell-stack"><span>{dateLabel(l.date)}</span><small>{timeAgo(l.createdAt)}</small></span> },
    { key: "tool", header: "From", cell: (l) => l.toolLabel },
    { key: "type", header: "Became", cell: (l) => <Badge tone={l.targetType === "invoice" ? "blue" : l.targetType === "item" ? "lavender" : "neutral"}>{l.targetType === "invoice" ? "Invoice" : l.targetType === "item" ? "Item" : "Party"}</Badge> },
    { key: "label", header: "IMS record", cell: (l) => <span className="ims-cell-stack"><span className={l.exists ? "ims-strong" : "ims-faint"}>{l.label}</span><small>{l.sub}</small></span> },
  ];
  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <FilterChip active={!tool} onClick={() => setTool("")}>
            All tools
          </FilterChip>
          {tools.map((t) => (
            <FilterChip key={t.id} active={tool === t.id} onClick={() => setTool(t.id)}>
              {t.label}
            </FilterChip>
          ))}
          <span className="ims-faint">|</span>
          {(
            [
              ["", "Everything"],
              ["invoice", "Invoices"],
              ["party", "Parties"],
              ["item", "Items"],
            ] as const
          ).map(([v, label]) => (
            <FilterChip key={v || "all"} active={type === v} onClick={() => setType(v)}>
              {label}
            </FilterChip>
          ))}
        </div>
        <Loaded state={state}>
          {(d) => (
            <DataTable
              columns={columns}
              rows={d.links}
              rowKey={(l) => `${l.sourceTool}:${l.sourceRef}:${l.targetType}`}
              onRowClick={open}
              chevron
              caption="Linked records"
              empty={<EmptyState glyph="⧉" title="No linked records">Anything you import from another tool is listed here with a link to the IMS record it became.</EmptyState>}
            />
          )}
        </Loaded>
        <p className="ims-sys-mini" style={{ margin: 0 }}>
          The reverse direction works too: IMS invoices are available in Justx BOS → Connected tools.
        </p>
      </Stack>
    </Card>
  );
}

export default ConnectModule;
