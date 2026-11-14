"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  FilterChip,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  type BosColumn,
} from "@/components/bos";
import {
  BOM_DOC_STATUS_LABEL,
  BOM_INVOICE_CONVERT_LABEL,
  bom,
  type BomDoc,
  type BomDocStatus,
  type BomHealth,
} from "@/lib/ims/bom";
import { ims } from "@/lib/ims/api";
import { withBasePath } from "@/lib/base-path";
import { dateLabel, downloadCsv, inrCompact, inrExact, PERIOD_OPTIONS, stampLabel, type BadgeView } from "@/lib/ims/format";
import { PeriodSelect, type PeriodOrAll } from "../finance/shared";
import { Loaded, PageHeader, Stack, StatusBadge, useIms, useImsAction, useImsData } from "../core";

export type BomListSort = "recent" | "date" | "docNo" | "customer" | "amount" | "status";
type BomColKey = "package" | "progress" | "preparedBy" | "health";

const PAGE_SIZE = 25;
const PREFS_KEY = "ims.bom.list.prefs";

const BOM_STATUS_BADGE: Record<BomDocStatus, BadgeView> = {
  draft: { text: "DRAFT", tone: "amber" },
  confirmed: { text: "CONFIRMED", tone: "emerald" },
  cancelled: { text: "CANCELLED", tone: "coral" },
};

const BOM_LIST_SORT_LABEL: Record<BomListSort, string> = {
  recent: "Recently updated",
  date: "Document date",
  docNo: "Doc number",
  customer: "Customer",
  amount: "Amount (high → low)",
  status: "Status",
};

const COL_LABEL: Record<BomColKey, string> = {
  package: "Package",
  progress: "Progress",
  preparedBy: "Prepared by",
  health: "Health",
};

function healthOf(d: BomDoc): BomHealth {
  return d.health ?? { score: 100, flags: [] };
}

function HealthCell({ d }: { d: BomDoc }) {
  const h = healthOf(d);
  const tone = h.score >= 85 ? "emerald" : h.score >= 60 ? "amber" : "coral";
  return (
    <span className="ims-cell-stack" title={h.flags.length ? h.flags.join(" · ") : "Healthy"}>
      <Badge tone={tone}>{h.score}</Badge>
      {h.flags.length ? <small className="ims-faint">{h.flags[0]}{h.flags.length > 1 ? ` +${h.flags.length - 1}` : ""}</small> : <small className="ims-faint">OK</small>}
    </span>
  );
}

type ListPrefs = {
  status?: "all" | BomDocStatus;
  invoice?: "all" | "linked" | "none";
  stock?: "all" | "issued" | "pending";
  sort?: BomListSort;
  period?: PeriodOrAll;
  minTotal?: string;
  maxTotal?: string;
  columns?: BomColKey[];
  view?: "table" | "cards";
};

/** Drafts: anyone with BOM access. Confirmed/cancelled: owners only, and never when invoice or stock is linked. */
export function canDeleteBomDoc(doc: Pick<BomDoc, "status" | "invoiceId" | "stockIssuedAt">, isOwner: boolean): boolean {
  if (doc.invoiceId || doc.stockIssuedAt) return false;
  if (doc.status === "draft") return true;
  return isOwner;
}

function readPrefs(): ListPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as ListPrefs;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: ListPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota */
  }
}

function BomSortHeader({ label, active, onClick, align }: { label: string; active: boolean; onClick: () => void; align?: "left" | "right" }) {
  return (
    <button type="button" className={`ims-bom-sort-th${active ? " is-active" : ""}${align === "right" ? " is-num" : ""}`} onClick={onClick} aria-pressed={active}>
      {label}
      <span aria-hidden="true">{active ? " ▾" : ""}</span>
    </button>
  );
}

function ProgressBadges({ d }: { d: BomDoc }) {
  return (
    <span className="ims-bom-list-flow">
      {d.invoiceId ? (
        <Badge tone="blue" title={d.invoiceConvertMode ? BOM_INVOICE_CONVERT_LABEL[d.invoiceConvertMode] : undefined}>
          Invoiced
        </Badge>
      ) : d.status === "confirmed" ? (
        <Badge tone="amber">No invoice</Badge>
      ) : null}
      {d.stockIssuedAt ? (
        <Badge tone="emerald">Stock out</Badge>
      ) : d.status === "confirmed" ? (
        <Badge tone="amber">Needs stock</Badge>
      ) : null}
      {!d.invoiceId && !d.stockIssuedAt && d.status !== "confirmed" ? <span className="ims-faint">—</span> : null}
    </span>
  );
}

export function BomList({
  onNew,
  onOpen,
  onEdit,
}: {
  onNew: (packageId: string | null) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const { session, can, navigate } = useIms();
  const isOwner = session.access.role === "owner";
  const canSales = can("sales");
  const canConfirm = isOwner || can("approvals") || !session.settings.bomConfirmNeedsApproval;
  const { run, busy } = useImsAction();

  const [prefsReady, setPrefsReady] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState<"all" | BomDocStatus>("all");
  const [invoice, setInvoice] = useState<"all" | "linked" | "none">("all");
  const [stock, setStock] = useState<"all" | "issued" | "pending">("all");
  const [sort, setSort] = useState<BomListSort>("recent");
  const [period, setPeriod] = useState<PeriodOrAll>("all");
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [columns, setColumns] = useState<BomColKey[]>(["package", "progress", "health"]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [page, setPage] = useState(0);
  const [pkgId, setPkgId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => {
    const p = readPrefs();
    if (p.status) setStatus(p.status);
    if (p.invoice) setInvoice(p.invoice);
    if (p.stock) setStock(p.stock);
    if (p.sort) setSort(p.sort);
    if (p.period) setPeriod(p.period);
    if (p.minTotal != null) setMinTotal(p.minTotal);
    if (p.maxTotal != null) setMaxTotal(p.maxTotal);
    if (p.columns?.length) setColumns(p.columns.filter((c): c is BomColKey => c in COL_LABEL));
    if (p.view) setView(p.view);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!prefsReady) return;
    writePrefs({ status, invoice, stock, sort, period, minTotal, maxTotal, columns, view });
  }, [prefsReady, status, invoice, stock, sort, period, minTotal, maxTotal, columns, view]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [qDebounced, status, invoice, stock, sort, period, minTotal, maxTotal]);

  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  const minN = minTotal.trim() ? Number(minTotal) : undefined;
  const maxN = maxTotal.trim() ? Number(maxTotal) : undefined;

  const docsState = useImsData(
    () =>
      bom.docs({
        q: qDebounced || undefined,
        status,
        invoice,
        stock,
        period,
        sort,
        minTotal: Number.isFinite(minN) ? minN : undefined,
        maxTotal: Number.isFinite(maxN) ? maxN : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [qDebounced, status, invoice, stock, sort, period, minTotal, maxTotal, page],
  );
  useEffect(() => {
    if (!docsState.data) return;
    const maxPage = Math.max(0, Math.ceil(docsState.data.total / PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [docsState.data, page]);
  const pkgsState = useImsData(() => bom.packages({ limit: 100 }), []);
  const packages = pkgsState.data?.packages ?? [];
  const filtersOn =
    status !== "all" ||
    invoice !== "all" ||
    stock !== "all" ||
    period !== "all" ||
    Boolean(qDebounced) ||
    Boolean(minTotal.trim()) ||
    Boolean(maxTotal.trim());

  const clearFilters = () => {
    setQ("");
    setQDebounced("");
    setStatus("all");
    setInvoice("all");
    setStock("all");
    setPeriod("all");
    setMinTotal("");
    setMaxTotal("");
    setPage(0);
  };

  const toggleCol = (key: BomColKey) => {
    setColumns((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  };

  const deleteDoc = async (d: BomDoc) => {
    const kind = d.status === "draft" ? "draft" : d.status;
    if (!window.confirm(`Delete ${kind} ${d.docNo}? This cannot be undone.`)) return;
    await run(
      `del-${d.id}`,
      async () => {
        await bom.deleteDoc(d.id);
        return true;
      },
      { success: `${d.docNo} deleted` },
    );
  };

  const duplicateDoc = async (d: BomDoc) => {
    const out = await run("dup", () => bom.duplicateDoc(d.id), { success: `Copied ${d.docNo}` });
    if (out?.doc) onEdit(out.doc.id);
  };

  const confirmDoc = async (d: BomDoc) => {
    if (!canConfirm) {
      window.alert("Confirming a BOM needs Approvals permission. Ask an owner or manager.");
      return;
    }
    const out = await run(
      `confirm-${d.id}`,
      async () => {
        const { gates } = await bom.docGates(d.id);
        if (gates.errors.length) throw new Error(gates.errors.map((e) => e.message).join(" · "));
        if (gates.warnings.length) {
          const ok = window.confirm(`Warnings before confirm:\n\n${gates.warnings.map((w) => `• ${w.message}`).join("\n")}\n\nConfirm anyway?`);
          if (!ok) return null;
        }
        return bom.confirmDoc(d.id, { acknowledgeWarnings: true });
      },
      { success: "BOM confirmed" },
    );
    if (out) setSelected(new Set());
  };

  const shareProposal = async (d: BomDoc) => {
    if (d.status !== "confirmed") {
      window.alert("Confirm the BOM before sharing a proposal link.");
      return;
    }
    const out = await run("proposal", () => bom.createProposal(d.id), { success: "Proposal link ready" });
    if (!out) return;
    const path = withBasePath(`/bom/proposal/${out.token}`);
    const url = `${window.location.origin}${path}`;
    window.prompt("Share this proposal link:", url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const openCompare = (ids: string[]) => {
    if (ids.length === 1) navigate("bomCompare", `doc:${ids[0]}`);
    else if (ids.length >= 2) navigate("bomCompare", `docs:${ids[0]},${ids[1]}`);
  };

  const bulkDelete = async (rows: BomDoc[]) => {
    const eligible = rows.filter((d) => selected.has(d.id) && canDeleteBomDoc(d, isOwner));
    if (!eligible.length) {
      window.alert("None of the selected BOMs can be deleted (invoice/stock linked, or not permitted).");
      return;
    }
    if (!window.confirm(`Delete ${eligible.length} BOM${eligible.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    await run(
      "bulk-del",
      async () => {
        let n = 0;
        for (const d of eligible) {
          await bom.deleteDoc(d.id);
          n += 1;
        }
        return n;
      },
      { success: `Deleted ${eligible.length} BOM${eligible.length === 1 ? "" : "s"}` },
    );
    setSelected(new Set());
  };

  const exportRows = (rows: BomDoc[], label: string) => {
    downloadCsv(label, rows, [
      { header: "Doc no", value: (d) => d.docNo },
      { header: "Date", value: (d) => d.docDate },
      { header: "Customer", value: (d) => d.customerName },
      { header: "Location", value: (d) => d.location ?? "" },
      { header: "Package", value: (d) => d.packageName ?? "" },
      { header: "Prepared by", value: (d) => d.preparedBy ?? "" },
      { header: "Status", value: (d) => BOM_DOC_STATUS_LABEL[d.status as BomDocStatus] ?? d.status },
      { header: "Total", value: (d) => d.grandTotal },
      { header: "Invoice", value: (d) => (d.invoiceId ? "Yes" : "No") },
      { header: "Stock", value: (d) => (d.stockIssuedAt ? "Issued" : "—") },
    ]);
  };

  const startGuided = () => {
    onNew(pkgId || null);
  };

  const rowActions = (d: BomDoc): ReactNode => (
    <span className="ims-row ims-bom-row-actions" style={{ justifyContent: "flex-end", gap: 4, flexWrap: "nowrap" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void duplicateDoc(d)} title="Duplicate as draft">
        Copy
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openCompare([d.id])} title="Compare revisions / variants">
        Diff
      </Button>
      {d.status === "draft" && canConfirm ? (
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void confirmDoc(d)}>
          Confirm
        </Button>
      ) : null}
      {d.status === "confirmed" ? (
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void shareProposal(d)} title="Copy proposal share link">
          Share
        </Button>
      ) : null}
      {d.status === "confirmed" && !d.invoiceId && canSales ? (
        <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)} title="Open to convert to invoice">
          Invoice
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)} title="Open to print / PDF">
        Print
      </Button>
      {canDeleteBomDoc(d, isOwner) ? (
        <Button size="sm" variant="ghost" disabled={Boolean(busy)} aria-label={`Delete ${d.docNo}`} title={d.status === "draft" ? "Delete draft" : "Delete (owner)"} onClick={() => void deleteDoc(d)}>
          Delete
        </Button>
      ) : null}
    </span>
  );

  return (
    <Stack gap={16}>
      <PageHeader
        title="Create / Maintain"
        sub="Search, sort and open customer BOMs — compose from a package, confirm, invoice and issue stock."
        actions={
          <div className="ims-bom-list-create">
            <Select size="sm" value={pkgId} onChange={(e) => setPkgId(e.target.value)} aria-label="Package template for new BOM" style={{ maxWidth: 220 }}>
              <option value="">Blank document</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.capacityLabel ? ` (${p.capacityLabel})` : ""}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon="plus" onClick={() => onNew(pkgId || null)}>
              New BOM
            </Button>
          </div>
        }
      />

      <Loaded state={docsState}>
        {(data) => {
          const counts = data.counts ?? {
            all: data.total,
            draft: 0,
            confirmed: 0,
            cancelled: 0,
            stockPending: 0,
            invoiced: 0,
            pipelineValue: 0,
          };
          const rows = data.docs;
          const total = data.total;
          const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
          const current = Math.min(page, pageCount - 1);
          const sortHeader = (key: BomListSort, label: string, align?: "left" | "right") => (
            <BomSortHeader label={label} active={sort === key} align={align} onClick={() => setSort(key)} />
          );

          const columnsDef: BosColumn<BomDoc>[] = [
            {
              key: "doc",
              header: sortHeader("date", "Document"),
              width: "18%",
              cell: (d) => (
                <span className="ims-cell-stack">
                  <span className="ims-strong">{d.docNo}</span>
                  <small>{dateLabel(d.docDate)}</small>
                </span>
              ),
            },
            {
              key: "customer",
              header: sortHeader("customer", "Customer"),
              cell: (d) => (
                <span className="ims-cell-stack">
                  <span className="ims-strong" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.customerName || "Untitled customer"}
                  </span>
                  <small>{[d.location, d.projectRef, d.capacityLabel || d.title].filter(Boolean).join(" · ") || "—"}</small>
                </span>
              ),
            },
            ...(columns.includes("package")
              ? [
                  {
                    key: "package",
                    header: "Package",
                    cell: (d: BomDoc) => d.packageName || <span className="ims-faint">Blank</span>,
                  } satisfies BosColumn<BomDoc>,
                ]
              : []),
            {
              key: "total",
              header: sortHeader("amount", "Total", "right"),
              align: "right" as const,
              mono: true,
              cell: (d: BomDoc) => inrExact(d.grandTotal),
            },
            ...(columns.includes("progress")
              ? [
                  {
                    key: "flow",
                    header: "Progress",
                    cell: (d: BomDoc) => <ProgressBadges d={d} />,
                  } satisfies BosColumn<BomDoc>,
                ]
              : []),
            ...(columns.includes("preparedBy")
              ? [
                  {
                    key: "preparedBy",
                    header: "Prepared by",
                    cell: (d: BomDoc) => d.preparedBy || <span className="ims-faint">—</span>,
                  } satisfies BosColumn<BomDoc>,
                ]
              : []),
            ...(columns.includes("health")
              ? [
                  {
                    key: "health",
                    header: "Health",
                    cell: (d: BomDoc) => <HealthCell d={d} />,
                  } satisfies BosColumn<BomDoc>,
                ]
              : []),
            {
              key: "status",
              header: sortHeader("status", "Status"),
              cell: (d) => <StatusBadge view={BOM_STATUS_BADGE[d.status as BomDocStatus] ?? BOM_STATUS_BADGE.draft} />,
            },
            {
              key: "actions",
              header: "",
              align: "right",
              width: 260,
              cell: (d) => rowActions(d),
            },
          ];

          const showGuided = !filtersOn && total === 0;

          return (
            <Stack gap={16}>
              <Grid cols={4} min={140}>
                <KpiCard
                  interactive={false}
                  label="In pipeline"
                  value={inrCompact(counts.pipelineValue)}
                  chip={{ color: "lavender", glyph: "☰" }}
                  delta={`${counts.all} document${counts.all === 1 ? "" : "s"} in view`}
                  deltaTone="muted"
                />
                <button type="button" className="ims-bom-kpi-hit" onClick={() => setStatus("draft")} aria-label="Show draft BOMs">
                  <KpiCard interactive={false} label="Drafts" value={counts.draft} chip={{ color: "amber", glyph: "✎" }} delta={status === "draft" ? "Filtered" : "Click to filter"} deltaTone="muted" />
                </button>
                <button
                  type="button"
                  className="ims-bom-kpi-hit"
                  onClick={() => {
                    setStatus("all");
                    setStock("pending");
                    setInvoice("all");
                  }}
                  aria-label="Show BOMs waiting on stock"
                >
                  <KpiCard
                    interactive={false}
                    label="Stock pending"
                    value={counts.stockPending}
                    valueTone={counts.stockPending > 0 ? "amber" : undefined}
                    chip={{ color: "rose", glyph: "⬆" }}
                    delta={stock === "pending" ? "Filtered" : counts.stockPending ? "Click to filter" : "All clear"}
                    deltaTone={counts.stockPending ? "down" : "up"}
                  />
                </button>
                <button
                  type="button"
                  className="ims-bom-kpi-hit"
                  onClick={() => {
                    setInvoice("linked");
                    setStock("all");
                  }}
                  aria-label="Show invoiced BOMs"
                >
                  <KpiCard interactive={false} label="Invoiced" value={counts.invoiced} chip={{ color: "blue", glyph: "🧾" }} delta={invoice === "linked" ? "Filtered" : "Click to filter"} deltaTone="muted" />
                </button>
              </Grid>

              {showGuided ? (
                <Card interactive={false} className="ims-bom-guided">
                  <h2 className="ims-bom-guided-title">Create your first BOM</h2>
                  <p className="ims-bom-guided-sub">Pick a starting point — you can change everything on the next screen.</p>
                  <FormGrid>
                    <Field label="1 · Start from">
                      {({ id }) => (
                        <Select id={id} value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
                          <option value="">Blank document</option>
                          {packages.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.capacityLabel ? ` (${p.capacityLabel})` : ""}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="2 · Then compose">
                      {({ id }) => (
                        <p id={id} className="ims-faint" style={{ margin: "8px 0 0" }}>
                          Next screen: pick customer, set capacity{pkgId ? " (package default applied)" : ""}, edit lines, live preview.
                        </p>
                      )}
                    </Field>
                  </FormGrid>
                  <div className="ims-toolbar" style={{ marginBottom: 0, marginTop: 12 }}>
                    <Button variant="primary" icon="plus" onClick={startGuided}>
                      Continue to compose
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card interactive={false} className="ims-bom-list-card">
                  <div className="ims-toolbar">
                    <SearchInput
                      wrapperClassName="ims-grow"
                      placeholder="Search doc no, customer, location, package, project…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      aria-label="Search BOMs"
                    />
                    <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value as BomListSort)} aria-label="Sort by" style={{ width: "auto" }}>
                      {(Object.keys(BOM_LIST_SORT_LABEL) as BomListSort[]).map((k) => (
                        <option key={k} value={k}>
                          Sort · {BOM_LIST_SORT_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <Segmented
                      size="sm"
                      role="radio"
                      aria-label="View"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "table" as const, label: "☰", ariaLabel: "Table view" },
                        { value: "cards" as const, label: "▦", ariaLabel: "Card view" },
                      ]}
                    />
                    <Button size="sm" variant={colsOpen ? "secondary" : "ghost"} onClick={() => setColsOpen((v) => !v)}>
                      Columns
                    </Button>
                    <Button size="sm" icon="download" disabled={!rows.length} onClick={() => exportRows(rows, "bom-docs")}>
                      Export
                    </Button>
                  </div>

                  {colsOpen ? (
                    <div className="ims-bom-list-chips" role="group" aria-label="Visible columns">
                      {(Object.keys(COL_LABEL) as BomColKey[]).map((k) => (
                        <FilterChip key={k} active={columns.includes(k)} onClick={() => toggleCol(k)}>
                          {COL_LABEL[k]}
                        </FilterChip>
                      ))}
                    </div>
                  ) : null}

                  <div className="ims-toolbar" style={{ marginTop: 8 }}>
                    <PeriodSelect value={period} onChange={(p) => setPeriod(p)} />
                  </div>

                  <div className="ims-toolbar" style={{ marginTop: 8 }}>
                    <Segmented
                      size="sm"
                      scroll
                      role="tabs"
                      aria-label="BOM status"
                      value={status}
                      onChange={setStatus}
                      options={[
                        { value: "all" as const, label: `All · ${counts.all}` },
                        { value: "draft" as const, label: `Draft · ${counts.draft}` },
                        { value: "confirmed" as const, label: `Confirmed · ${counts.confirmed}` },
                        { value: "cancelled" as const, label: `Cancelled · ${counts.cancelled}` },
                      ]}
                    />
                  </div>

                  <div className="ims-bom-list-chips">
                    <FilterChip active={invoice === "all"} onClick={() => setInvoice("all")}>
                      Any invoice
                    </FilterChip>
                    <FilterChip active={invoice === "none"} onClick={() => setInvoice("none")}>
                      No invoice
                    </FilterChip>
                    <FilterChip active={invoice === "linked"} onClick={() => setInvoice("linked")}>
                      Invoiced
                    </FilterChip>
                    <FilterChip active={stock === "all"} onClick={() => setStock("all")}>
                      Any stock
                    </FilterChip>
                    <FilterChip active={stock === "pending"} onClick={() => setStock("pending")}>
                      Stock pending
                    </FilterChip>
                    <FilterChip active={stock === "issued"} onClick={() => setStock("issued")}>
                      Stock issued
                    </FilterChip>
                    <Input
                      size="sm"
                      inputMode="decimal"
                      placeholder="Min ₹"
                      value={minTotal}
                      onChange={(e) => setMinTotal(e.target.value)}
                      aria-label="Minimum total"
                      style={{ width: 88 }}
                    />
                    <Input
                      size="sm"
                      inputMode="decimal"
                      placeholder="Max ₹"
                      value={maxTotal}
                      onChange={(e) => setMaxTotal(e.target.value)}
                      aria-label="Maximum total"
                      style={{ width: 88 }}
                    />
                    {filtersOn ? (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear
                      </Button>
                    ) : null}
                  </div>

                  {view === "table" ? (
                    <div className="ims-bom-list-desktop">
                      <DataTable
                        caption="Bill of materials"
                        columns={columnsDef}
                        rows={rows}
                        rowKey={(d) => d.id}
                        onRowClick={(d) => onOpen(d.id)}
                        chevron
                        selection={{
                          selected,
                          onChange: setSelected,
                        }}
                        bulkActions={(count) => (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={count < 1}
                              onClick={() => exportRows(rows.filter((d) => selected.has(d.id)), "bom-docs-selected")}
                            >
                              Export selected
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={count < 1}
                              onClick={() => openCompare([...selected].slice(0, 2))}
                              title={count >= 2 ? "Compare first two selected" : "Select one or two BOMs"}
                            >
                              Compare
                            </Button>
                            <Button size="sm" variant="ghost" disabled={!count || Boolean(busy)} onClick={() => void bulkDelete(rows)}>
                              Delete selected
                            </Button>
                          </>
                        )}
                        empty={
                          <EmptyState
                            glyph="☰"
                            title={filtersOn ? "No BOMs match these filters" : "No BOM documents yet"}
                            actions={
                              filtersOn ? (
                                <Button variant="ghost" onClick={clearFilters}>
                                  Clear filters
                                </Button>
                              ) : (
                                <Button variant="primary" icon="plus" onClick={() => onNew(pkgId || null)}>
                                  Create first BOM
                                </Button>
                              )
                            }
                          >
                            {filtersOn
                              ? stock === "pending"
                                ? "No confirmed BOMs are waiting on stock for this view."
                                : "Try another status, period, invoice or amount filter."
                              : "Choose a package template next to New BOM (or leave blank), then compose lines."}
                          </EmptyState>
                        }
                      />
                    </div>
                  ) : null}

                  <div className={view === "cards" ? "ims-bom-list-cards" : "ims-bom-list-cards ims-bom-list-cards--mobile-only"}>
                    {rows.length === 0 ? (
                      <EmptyState glyph="☰" title={filtersOn ? "No BOMs match these filters" : "No BOM documents yet"}>
                        {filtersOn ? "Try clearing filters." : "Create a BOM to get started."}
                      </EmptyState>
                    ) : (
                      rows.map((d) => (
                        <div
                          key={d.id}
                          className="ims-bom-mobile-card"
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpen(d.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpen(d.id);
                            }
                          }}
                        >
                          <div className="ims-bom-mobile-card-top">
                            <span className="ims-strong">{d.docNo}</span>
                            <StatusBadge view={BOM_STATUS_BADGE[d.status as BomDocStatus] ?? BOM_STATUS_BADGE.draft} />
                          </div>
                          <div className="ims-bom-mobile-card-body">
                            <div>{d.customerName || "Untitled customer"}</div>
                            <small className="ims-faint">{[dateLabel(d.docDate), d.packageName, inrExact(d.grandTotal)].filter(Boolean).join(" · ")}</small>
                            <ProgressBadges d={d} />
                            <HealthCell d={d} />
                          </div>
                          <div className="ims-bom-mobile-card-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                            {rowActions(d)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {total > 0 ? (
                    <Pagination
                      actions={
                        <>
                          <Button size="sm" variant="ghost" disabled={current <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                            Previous
                          </Button>
                          <Button size="sm" variant="ghost" disabled={current >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                            Next
                          </Button>
                        </>
                      }
                    >
                      {total === 0 ? "No results" : `${current * PAGE_SIZE + 1}–${Math.min((current + 1) * PAGE_SIZE, total)} of ${total}`}
                      {sort !== "recent" ? ` · ${BOM_LIST_SORT_LABEL[sort]}` : ""}
                      {period !== "all" ? ` · ${PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period}` : ""}
                    </Pagination>
                  ) : null}
                </Card>
              )}
            </Stack>
          );
        }}
      </Loaded>
    </Stack>
  );
}

/** Compact activity feed for the BOM viewer. */
export function BomActivityStrip({ docId }: { docId: string }) {
  const state = useImsData(() => ims.events({ entityType: "bom_doc", entityId: docId, limit: 12 }), [docId]);
  if (!state.data && !state.error) return null;
  const events = state.data?.events ?? [];
  if (!events.length && state.error) return null;
  if (!events.length) return null;

  return (
    <Card interactive={false} className="ims-bom-activity">
      <div className="ims-bom-activity-head">Activity</div>
      <ol className="ims-bom-activity-list">
        {events.map((e) => (
          <li key={e.id}>
            <span>{e.summary}</span>
            <small>{[e.actorName, stampLabel(e.createdAt)].filter(Boolean).join(" · ")}</small>
          </li>
        ))}
      </ol>
    </Card>
  );
}
