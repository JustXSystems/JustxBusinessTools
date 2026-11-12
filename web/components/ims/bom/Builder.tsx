"use client";

import "./bom.css";
import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, EmptyState, Field, FilterChip, FormGrid, Input, Select, Textarea } from "@/components/bos";
import {
  BOM_DOC_STATUS_LABEL,
  BOM_INVOICE_CONVERT_LABEL,
  BOM_INVOICE_CONVERT_MODES,
  BOM_LINE_KIND_LABEL,
  BOM_LINE_KINDS,
  bom,
  computeBomTotals,
  inferBaseQty,
  previewBomInvoice,
  qtyForCapacity,
  type BomBusiness,
  type BomDoc,
  type BomDocLineInput,
  type BomDocStatus,
  type BomInvoiceConvertMode,
  type BomLineKind,
  type BomPackage,
} from "@/lib/ims/bom";
import type { ImsItem } from "@/lib/ims/api";
import { inr, inrExact } from "@/lib/ims/format";
import { formatCatalogEnsureSummary, exportBomExcel } from "@/lib/ims/bom-excel";
import { ensureBomPackageCatalog, ensureStockLinesForSave } from "@/lib/ims/ensure-catalog";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData, useOpenIntent, usePrint } from "../core";
import { ItemPickerDialog, PartySelect } from "../shared/pickers";
import { BomPaper, modelFromDoc, type BomPaperModel } from "./BomPaper";
import { BomSplitLayout } from "./BomSplitLayout";

type View =
  | { mode: "list" }
  | { mode: "edit"; id: string | null; packageId?: string | null }
  | { mode: "view"; id: string };

type EditorLine = BomDocLineInput & { key: string; baseQty: number };

const blankLine = (section = "Main Items"): EditorLine => ({
  key: Math.random().toString(36).slice(2),
  section,
  lineKind: "stock",
  description: "",
  makeText: "",
  qty: 1,
  baseQty: 1,
  unit: "nos",
  rate: 0,
  scaleByCapacity: false,
  remarks: "",
});

export default function BomBuilderScreen() {
  const openId = useOpenIntent("bom");
  const [view, setView] = useState<View>(() => (openId ? { mode: "view", id: openId } : { mode: "list" }));
  return (
    <RequirePerm perm="bom" what="BOM documents">
      {view.mode === "edit" ? (
        <BomEditor
          id={view.id}
          packageId={view.packageId ?? null}
          onBack={() => setView({ mode: "list" })}
          onSaved={(id) => setView({ mode: "view", id })}
        />
      ) : view.mode === "view" ? (
        <BomViewer
          id={view.id}
          onBack={() => setView({ mode: "list" })}
          onEdit={() => setView({ mode: "edit", id: view.id })}
        />
      ) : (
        <BomList
          onNew={(packageId) => setView({ mode: "edit", id: null, packageId })}
          onOpen={(id) => setView({ mode: "view", id })}
        />
      )}
    </RequirePerm>
  );
}

function BomList({ onNew, onOpen }: { onNew: (packageId: string | null) => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [invoice, setInvoice] = useState<"all" | "linked" | "none">("all");
  const [stock, setStock] = useState<"all" | "issued" | "pending">("all");
  const [pkgId, setPkgId] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const docsState = useImsData(
    () => bom.docs({ q: qDebounced, status, invoice, stock, limit: 100 }),
    [qDebounced, status, invoice, stock],
  );
  const pkgsState = useImsData(() => bom.packages({ limit: 100 }), []);
  const docs = docsState.data?.docs ?? [];
  const packages = pkgsState.data?.packages ?? [];
  const filtered = status !== "all" || invoice !== "all" || stock !== "all" || Boolean(qDebounced);

  return (
    <Stack>
      <PageHeader
        title="BILL OF MATERIALS - BOM"
        sub="Compose a customer bill of materials from a package template — live preview, save and print."
        actions={<Button onClick={() => onNew(pkgId || null)}>New BOM</Button>}
      />

      <Card>
        <FormGrid>
          <Field label="Search">
            {({ id }) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Doc no, customer, location…" />}
          </Field>
          <Field label="Start from package">
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
        </FormGrid>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {(["all", "draft", "confirmed", "cancelled"] as const).map((s) => (
            <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
              {s === "all" ? "All status" : BOM_DOC_STATUS_LABEL[s]}
            </FilterChip>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
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
        </div>
      </Card>

      {docsState.error ? <ErrorBlock error={docsState.error} onRetry={docsState.reload} /> : null}
      {!docsState.data && !docsState.error ? <LoadingBlock /> : null}
      {docsState.data && docs.length === 0 ? (
        <EmptyState
          title={filtered ? "No BOMs match these filters" : "No BOM documents yet"}
          actions={
            filtered ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                  setInvoice("all");
                  setStock("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => onNew(pkgId || null)}>Create first BOM</Button>
            )
          }
        >
          {filtered
            ? stock === "pending"
              ? "No confirmed BOMs are waiting on stock for this view."
              : "Try another status, invoice or stock chip."
            : "Pick a package template above (or start blank), then fill customer and lines."}
        </EmptyState>
      ) : null}

      {docs.map((d) => (
        <Card key={d.id} interactive onClick={() => onOpen(d.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700 }}>
                {d.docNo} · {d.customerName || "Untitled customer"}
              </div>
              <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                {[d.capacityLabel || d.title, d.location, d.docDate, inr(d.grandTotal)].filter(Boolean).join(" · ")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {d.invoiceId ? (
                  <Badge tone="blue">
                    Invoice{d.invoiceConvertMode ? ` · ${BOM_INVOICE_CONVERT_LABEL[d.invoiceConvertMode]}` : ""}
                  </Badge>
                ) : d.status === "confirmed" ? (
                  <Badge tone="amber">No invoice</Badge>
                ) : null}
                {d.stockIssuedAt ? <Badge tone="emerald">Stock out</Badge> : d.status === "confirmed" ? <Badge tone="amber">Needs stock</Badge> : null}
              </div>
            </div>
            <Badge tone={d.status === "confirmed" ? "emerald" : d.status === "cancelled" ? "coral" : "amber"}>
              {BOM_DOC_STATUS_LABEL[d.status as BomDocStatus] ?? d.status}
            </Badge>
          </div>
        </Card>
      ))}
    </Stack>
  );
}

function PartialIssueForm({
  doc,
  busy,
  onDone,
  run,
}: {
  doc: BomDoc;
  busy: boolean;
  onDone: () => void;
  run: ReturnType<typeof useImsAction>["run"];
}) {
  const stockLines = useMemo(
    () =>
      (doc.lines ?? [])
        .filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0)
        .map((l) => {
          const issued = Number(l.issuedQty ?? 0);
          const remaining = Math.max(0, Number(l.qty) - issued);
          return { line: l, remaining, issued };
        })
        .filter((x) => x.remaining > 0),
    [doc.lines],
  );
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [serialById, setSerialById] = useState<Record<string, string>>({});

  if (!stockLines.length) return null;

  return (
    <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Partial issue</div>
      {stockLines.map(({ line, remaining, issued }) => (
        <div key={line.id} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--bos-border, #e2e8f0)", paddingTop: 8 }}>
          <div style={{ fontSize: 13 }}>
            {line.description}{" "}
            <span style={{ opacity: 0.65 }}>
              · remaining {remaining} {line.unit}
              {issued > 0 ? ` (issued ${issued})` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input
              value={qtyById[line.id] ?? String(remaining)}
              onChange={(e) => setQtyById((prev) => ({ ...prev, [line.id]: e.target.value }))}
              placeholder="Qty"
              style={{ width: 100 }}
            />
            <Input
              value={serialById[line.id] ?? ""}
              onChange={(e) => setSerialById((prev) => ({ ...prev, [line.id]: e.target.value }))}
              placeholder="Serial / lot notes"
              style={{ flex: 1, minWidth: 160 }}
            />
          </div>
        </div>
      ))}
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          const lines = stockLines
            .map(({ line, remaining }) => {
              const qty = Number(qtyById[line.id] ?? remaining) || 0;
              return {
                lineId: line.id,
                qty: Math.min(Math.max(0, qty), remaining),
                serialNotes: serialById[line.id]?.trim() || null,
              };
            })
            .filter((l) => l.qty > 0);
          if (!lines.length) {
            window.alert("Enter at least one quantity to issue.");
            return;
          }
          const out = await run("partial-stock", () => bom.issueStockPartial(doc.id, { lines }), {
            success: "Partial stock issued",
          });
          if (out) onDone();
        }}
      >
        Issue selected qty
      </Button>
    </div>
  );
}

function BomViewer({ id, onBack, onEdit }: { id: string; onBack: () => void; onEdit: () => void }) {
  const { can, navigate, session } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const state = useImsData(() => bom.doc(id), [id]);
  const availability = useImsData(() => bom.availability(id), [id, state.data?.doc?.stockIssuedAt, state.data?.doc?.updatedAt]);
  const [convertMode, setConvertMode] = useState<BomInvoiceConvertMode>("lump_sum");
  const [issueOnCreate, setIssueOnCreate] = useState(false);
  const doc = state.data?.doc;
  const stockShortfalls = useMemo(
    () => (availability.data?.items ?? []).filter((i) => i.shortfall > 0),
    [availability.data],
  );
  const allowNegative = Boolean(availability.data?.allowNegativeStock);
  const blockOnShortfall = stockShortfalls.length > 0 && !allowNegative;
  const linkedInvoice = state.data?.linkedInvoice ?? null;
  const explodeDraftLinked =
    Boolean(doc?.invoiceId) &&
    doc?.invoiceConvertMode === "explode_lines" &&
    linkedInvoice?.status === "draft";
  const explodeStockPosted =
    doc?.invoiceConvertMode === "explode_lines" &&
    linkedInvoice?.status === "issued" &&
    Boolean(linkedInvoice?.stockPosted);

  if (!state.data && !state.error) return <LoadingBlock />;
  if (state.error || !state.data || !doc) return <ErrorBlock error={state.error ?? new Error("Not found")} onRetry={state.reload} />;

  const business = {
    ...state.data.business,
    logoUrl: state.data.business.logoUrl || session.brand?.logoUrl || null,
  };
  const model = modelFromDoc(doc, business, session.settings.bomPaperTemplate);
  const confirmed = doc.status === "confirmed";
  const stockable = (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0).length;
  const reloadAll = () => {
    state.reload();
    availability.reload();
  };

  return (
    <Stack>
      <PageHeader
        title={doc.docNo}
        sub={`${doc.customerName || "No customer"} · ${BOM_DOC_STATUS_LABEL[doc.status]}`}
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button variant="ghost" onClick={print}>
              Print / PDF
            </Button>
            {doc.status === "draft" ? (
              <>
                <Button variant="ghost" onClick={onEdit}>
                  Edit
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const out = await run(
                      "confirm",
                      async () => {
                        const { gates } = await bom.docGates(doc.id);
                        if (gates.errors.length) {
                          throw new Error(gates.errors.map((e) => e.message).join(" · "));
                        }
                        if (gates.warnings.length) {
                          const ok = window.confirm(
                            `Warnings before confirm:\n\n${gates.warnings.map((w) => `• ${w.message}`).join("\n")}\n\nConfirm anyway?`,
                          );
                          if (!ok) return null;
                        }
                        return bom.confirmDoc(doc.id, { acknowledgeWarnings: true });
                      },
                      { success: "BOM confirmed" },
                    );
                    if (out) reloadAll();
                  }}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!window.confirm(`Delete draft ${doc.docNo}? This cannot be undone.`)) return;
                    const out = await run("delete", async () => {
                      await bom.deleteDoc(doc.id);
                      return true;
                    }, { success: "Draft BOM deleted" });
                    if (out) onBack();
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => void exportBomExcel(doc, business)}
            >
              Export Excel
            </Button>
            {confirmed ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const out = await run("proposal", () => bom.createProposal(doc.id), { success: "Proposal link ready" });
                  if (!out) return;
                  const url = `${window.location.origin}/bom/proposal/${out.token}`;
                  const wa = `https://wa.me/?text=${encodeURIComponent(`Please review our materials proposal: ${url}`)}`;
                  window.prompt("Share this proposal link (copied to clipboard if supported):", url);
                  try {
                    await navigator.clipboard.writeText(url);
                  } catch {
                    /* ignore */
                  }
                  if (window.confirm("Open WhatsApp share?")) window.open(wa, "_blank", "noopener,noreferrer");
                  reloadAll();
                }}
              >
                Share proposal
              </Button>
            ) : null}
            {confirmed && availability.data?.hasShortfall && can("po") ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  if (!window.confirm("Draft purchase orders for shortfall items, grouped by preferred supplier?")) return;
                  const out = await run("create-pos", () => bom.createPosFromShortfall(doc.id), {
                    success: "Draft POs created from shortfall",
                  });
                  if (out?.orders?.length) {
                    window.alert(`Created ${out.orders.length} draft PO(s):\n${out.orders.map((o) => `${o.poNo} · ${o.supplierName}`).join("\n")}`);
                  }
                  reloadAll();
                }}
              >
                Draft POs (shortfall)
              </Button>
            ) : null}
            {confirmed && availability.data?.hasShortfall ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const out = await run("alts", () => bom.suggestAlternates(doc.id), { success: "Checked alternates" });
                  if (!out) return;
                  const lines = out.suggestions ?? [];
                  if (!lines.length) {
                    window.alert("No alternate suggestions for current shortfalls.");
                    return;
                  }
                  const msg = lines
                    .map((s) => `${s.description}: ${s.suggested?.name ?? "none"} (need ${s.need}, on hand ${s.onHand})`)
                    .join("\n");
                  window.alert(`Alternate suggestions:\n${msg}`);
                }}
              >
                Suggest alternates
              </Button>
            ) : null}
            {confirmed ? (
              <>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const out = await run("pick", () => bom.pickList(doc.id), { success: "Pick list ready" });
                    if (!out?.lines?.length) {
                      window.alert("Nothing left to pick.");
                      return;
                    }
                    window.alert(
                      out.lines
                        .map((l) => `${l.description}: pick ${l.remainingQty} ${l.unit} (on hand ${l.onHand})${l.serialNotes ? ` · ${l.serialNotes}` : ""}`)
                        .join("\n"),
                    );
                  }}
                >
                  Pick list
                </Button>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (!window.confirm("Freeze as-built sold vs issued quantities?")) return;
                    const out = await run("as-built", () => bom.asBuilt(doc.id), { success: "As-built frozen" });
                    if (out?.variance?.length) {
                      window.alert(
                        out.variance
                          .map((v) => `${v.description}: sold ${v.soldQty}, issued ${v.issuedQty}, var ${v.variance}`)
                          .join("\n"),
                      );
                    }
                    reloadAll();
                  }}
                >
                  Freeze as-built
                </Button>
                <Button
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    const out = await run("service-kit", () => bom.serviceKit(doc.id), { success: "Service kit" });
                    window.alert(
                      out?.lines?.length
                        ? out.lines.map((l) => `${l.description} · ${l.qty} ${l.unit}`).join("\n")
                        : "No service/spare lines on this BOM.",
                    );
                  }}
                >
                  Service kit
                </Button>
              </>
            ) : null}
            {confirmed && !doc.invoiceId && !doc.stockIssuedAt ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const out = await run("reopen", () => bom.reopenDoc(doc.id), { success: "Reopened as draft" });
                  if (out) reloadAll();
                }}
              >
                Reopen
              </Button>
            ) : null}
            {doc.status !== "cancelled" && !doc.invoiceId && !doc.stockIssuedAt ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const out = await run("cancel", () => bom.cancelDoc(doc.id), { success: "BOM cancelled" });
                  if (out) reloadAll();
                }}
              >
                Cancel
              </Button>
            ) : null}
          </>
        }
      />

      <BomSplitLayout
        confirm={confirmed}
        compose={
          confirmed ? (
            <div className="ims-bom-compose-actions">
              <Card className="ims-bom-action-card">
                <Alert tone="blue" title="Create GST invoice">
                  Choose how this BOM becomes a tax invoice. Lump-sum bills one package line; explode copies every BOM line (stock lines keep catalogue links).
                </Alert>
                {doc.invoiceId ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge tone="emerald">Invoice linked · {doc.invoiceConvertMode ? BOM_INVOICE_CONVERT_LABEL[doc.invoiceConvertMode] : "—"}</Badge>
                    {can("sales") ? (
                      <Button size="sm" onClick={() => navigate("sales", `open:${doc.invoiceId}`)}>
                        Open invoice
                      </Button>
                    ) : null}
                  </div>
                ) : can("sales") ? (
                  <>
                    {!doc.partyId ? (
                      <Alert tone="amber" title="Walk-in / free-text customer">
                        No saved party is linked — GSTIN and billing address won’t auto-fill on the invoice. Pick a catalogue customer if you need full GST details.
                      </Alert>
                    ) : null}
                    <div className="ims-bom-action-fields">
                      <Field label="Convert mode">
                        {({ id: fid }) => (
                          <Select id={fid} value={convertMode} onChange={(e) => setConvertMode(e.target.value as BomInvoiceConvertMode)}>
                            {BOM_INVOICE_CONVERT_MODES.map((m) => (
                              <option key={m} value={m}>
                                {BOM_INVOICE_CONVERT_LABEL[m]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field label="On create">
                        {({ id: fid }) => (
                          <Select
                            id={fid}
                            value={issueOnCreate ? "issue" : "draft"}
                            onChange={(e) => setIssueOnCreate(e.target.value === "issue")}
                            disabled={Boolean(doc.stockIssuedAt && convertMode === "explode_lines")}
                          >
                            <option value="draft">Save as draft invoice</option>
                            <option value="issue" disabled={Boolean(doc.stockIssuedAt && convertMode === "explode_lines")}>
                              Create and issue (posts stock for linked lines)
                            </option>
                          </Select>
                        )}
                      </Field>
                    </div>
                    {doc.stockIssuedAt && convertMode === "explode_lines" ? (
                      <Alert tone="amber" title="Stock already issued">
                        Explode + issue is blocked. Create a draft explode invoice, or switch to lump-sum.
                      </Alert>
                    ) : null}
                    {issueOnCreate && convertMode === "explode_lines" && !can("stockOut") ? (
                      <Alert tone="amber" title="Stock-out permission needed">
                        Issuing an explode invoice posts stock. Ask an owner for Stock out, or save as draft.
                      </Alert>
                    ) : null}
                    {issueOnCreate && convertMode === "explode_lines" && stockShortfalls.length ? (
                      <Alert tone={blockOnShortfall ? "coral" : "amber"} title={blockOnShortfall ? "Insufficient stock" : "Stock below need"}>
                        {stockShortfalls
                          .slice(0, 4)
                          .map((s) => `${s.name}: need ${s.need} ${s.unit}, have ${s.have}`)
                          .join(" · ")}
                        {allowNegative ? " · Negative stock is allowed in Settings." : ""}
                      </Alert>
                    ) : null}
                    {(() => {
                      const gstRate = doc.taxPct > 0 ? doc.taxPct : 18;
                      const preview = previewBomInvoice(doc, convertMode, gstRate);
                      return (
                        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                          <div>
                            Preview · taxable {inrExact(preview.taxable)} · GST ~{gstRate}% {inrExact(preview.tax)} · ~{inrExact(preview.grand)}
                          </div>
                          <div style={{ marginTop: 4 }}>{preview.note}</div>
                        </div>
                      );
                    })()}
                    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        disabled={
                          Boolean(busy) ||
                          (issueOnCreate && convertMode === "explode_lines" && Boolean(doc.stockIssuedAt)) ||
                          (issueOnCreate && convertMode === "explode_lines" && !can("stockOut")) ||
                          (issueOnCreate && convertMode === "explode_lines" && blockOnShortfall)
                        }
                        onClick={async () => {
                          const out = await run(
                            "invoice",
                            () => bom.createInvoice(doc.id, { mode: convertMode, issue: issueOnCreate }),
                            { success: issueOnCreate ? "Invoice issued from BOM" : "Draft invoice created" },
                          );
                          if (out?.invoice?.invoice?.id) {
                            reloadAll();
                            navigate("sales", `open:${out.invoice.invoice.id}`);
                          }
                        }}
                      >
                        Create invoice
                      </Button>
                    </div>
                  </>
                ) : (
                  <Alert tone="amber" title="Sales permission needed">
                    Your IMS role needs Sales invoices to convert a BOM.
                  </Alert>
                )}
              </Card>

              <Card className="ims-bom-action-card">
                <Alert tone="blue" title="Issue materials (stock out)">
                  Posts OUT movements for stock lines linked to catalogue items. Use this when the invoice is lump-sum (or not issued yet) and you still need to deduct components.
                </Alert>
                {doc.stockIssuedAt ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge tone="emerald">
                      Stock issued · {doc.stockIssueCount} item{doc.stockIssueCount === 1 ? "" : "s"} · {doc.stockIssuedAt}
                    </Badge>
                    {can("stockOut") && !explodeStockPosted ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={async () => {
                          if (!window.confirm("Return these materials to stock and clear the BOM issue flag?")) return;
                          const out = await run("revstock", () => bom.reverseStock(doc.id), { success: "BOM stock reversed" });
                          if (out) reloadAll();
                        }}
                      >
                        Reverse stock
                      </Button>
                    ) : explodeStockPosted ? (
                      <span style={{ fontSize: 13, opacity: 0.75 }}>Stock came from the explode invoice — cancel that invoice to return materials.</span>
                    ) : null}
                  </div>
                ) : can("stockOut") ? (
                  explodeStockPosted ? (
                    <Alert tone="amber" title="Stock already posted">
                      Materials went out with the linked explode invoice. Cancel that invoice if you need to return stock.
                    </Alert>
                  ) : explodeDraftLinked ? (
                    <Alert tone="amber" title="Draft explode invoice linked">
                      Issue or delete the draft explode invoice before issuing stock from this BOM — otherwise Sales issue will be blocked.
                      {can("sales") && doc.invoiceId ? (
                        <div style={{ marginTop: 8 }}>
                          <Button size="sm" onClick={() => navigate("sales", `open:${doc.invoiceId}`)}>
                            Open draft invoice
                          </Button>
                        </div>
                      ) : null}
                    </Alert>
                  ) : (
                    <>
                      <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 10 }}>
                        {stockable
                          ? `${stockable} stock line${stockable === 1 ? "" : "s"} ready to issue.`
                          : "No stock-linked lines yet — edit the BOM and link catalogue items on stock lines."}
                      </div>
                      {stockShortfalls.length ? (
                        <Alert tone={blockOnShortfall ? "coral" : "amber"} title={blockOnShortfall ? "Insufficient stock" : "Stock below need"}>
                          {stockShortfalls
                            .slice(0, 4)
                            .map((s) => `${s.name}: need ${s.need} ${s.unit}, have ${s.have}`)
                            .join(" · ")}
                          {stockShortfalls.length > 4 ? ` · +${stockShortfalls.length - 4} more` : ""}
                          {allowNegative ? " · Negative stock is allowed in Settings." : ""}
                        </Alert>
                      ) : null}
                      <Button
                        disabled={Boolean(busy) || !stockable || blockOnShortfall}
                        onClick={async () => {
                          if (stockShortfalls.length && allowNegative) {
                            if (!window.confirm("On-hand is below need, but negative stock is allowed. Issue anyway?")) return;
                          }
                          const out = await run("stock", () => bom.issueStock(doc.id), { success: "Stock issued from BOM" });
                          if (out) reloadAll();
                        }}
                      >
                        Issue all stock
                      </Button>
                      <PartialIssueForm doc={doc} busy={Boolean(busy)} onDone={reloadAll} run={run} />
                    </>
                  )
                ) : (
                  <Alert tone="amber" title="Stock-out permission needed">
                    Your IMS role needs Stock out to issue materials.
                  </Alert>
                )}
              </Card>

              {doc.notes ? (
                <Card className="ims-bom-action-card ims-bom-action-card--notes">
                  <div style={{ whiteSpace: "pre-wrap" }}>{doc.notes}</div>
                </Card>
              ) : null}
            </div>
          ) : doc.notes ? (
            <Card>
              <div style={{ whiteSpace: "pre-wrap" }}>{doc.notes}</div>
            </Card>
          ) : null
        }
        preview={<BomPaper model={model} />}
      />
    </Stack>
  );
}

function BomEditor({
  id,
  packageId,
  onBack,
  onSaved,
}: {
  id: string | null;
  packageId: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const existing = useImsData(() => (id ? bom.doc(id) : Promise.resolve(null)), [id]);
  const pkgState = useImsData(() => (packageId && !id ? bom.package(packageId).then((r) => r.package) : Promise.resolve(null)), [packageId, id]);

  if (id && !existing.data && !existing.error) return <LoadingBlock />;
  if (id && existing.error) return <ErrorBlock error={existing.error} onRetry={existing.reload} />;
  if (packageId && !id && !pkgState.data && !pkgState.error) return <LoadingBlock />;
  if (packageId && !id && pkgState.error) return <ErrorBlock error={pkgState.error} onRetry={pkgState.reload} />;

  return (
    <BomEditorForm
      key={id ?? packageId ?? "new"}
      initial={existing.data?.doc ?? null}
      business={
        existing.data?.business ?? {
          name: null,
          gstin: null,
          address: null,
          state: null,
          phone: null,
          email: null,
          logoUrl: null,
        }
      }
      fromPackage={pkgState.data}
      packageId={packageId}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
}

function BomEditorForm({
  initial,
  business,
  fromPackage,
  packageId,
  onBack,
  onSaved,
}: {
  initial: BomDoc | null;
  business: BomBusiness;
  fromPackage: BomPackage | null;
  packageId: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { session } = useIms();
  const { run, busy } = useImsAction();
  const print = usePrint();
  const settings = session.settings;

  const seeded = fromPackage;
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [title, setTitle] = useState(initial?.title ?? seeded?.name ?? "");
  const [capacityLabel, setCapacityLabel] = useState(initial?.capacityLabel ?? seeded?.capacityLabel ?? "");
  const [docDate, setDocDate] = useState(initial?.docDate ?? session.today);
  const [marginPct, setMarginPct] = useState(String(initial?.marginPct ?? seeded?.defaultMarginPct ?? 0));
  const [taxPct, setTaxPct] = useState(String(initial?.taxPct ?? seeded?.defaultTaxPct ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [preparedBy, setPreparedBy] = useState(initial?.preparedBy ?? session.actor.name ?? "");
  const [partyId, setPartyId] = useState<string | null>(initial?.partyId ?? null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [lines, setLines] = useState<EditorLine[]>(() => {
    if (initial?.lines?.length) {
      const cap = initial.capacityLabel ?? "";
      return initial.lines.map((l) => ({
        key: l.id,
        id: l.id,
        section: l.section,
        lineKind: l.lineKind,
        itemId: l.itemId,
        description: l.description,
        makeText: l.makeText ?? "",
        qty: l.qty,
        baseQty: inferBaseQty(l.qty, l.scaleByCapacity, cap),
        unit: l.unit,
        rate: l.rate,
        scaleByCapacity: l.scaleByCapacity,
        remarks: l.remarks ?? "",
      }));
    }
    if (seeded?.lines?.length) {
      const cap = seeded.capacityLabel ?? "";
      return seeded.lines
        .filter((l) => l.active)
        .map((l) => ({
          key: l.id,
          section: l.section,
          lineKind: l.lineKind,
          itemId: l.itemId,
          description: l.description,
          makeText: l.makeText ?? "",
          qty: qtyForCapacity(l.qty, l.scaleByCapacity, cap),
          baseQty: l.qty,
          unit: l.unit,
          rate: l.defaultRate,
          scaleByCapacity: l.scaleByCapacity,
          remarks: l.remarks ?? "",
        }));
    }
    return [blankLine("Main Items"), blankLine("Accessories & Services")];
  });

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const l of lines) if (!names.includes(l.section)) names.push(l.section);
    return names.length ? names : ["Main Items"];
  }, [lines]);

  const totals = useMemo(
    () => computeBomTotals(
      lines.map((l) => ({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0 })),
      Number(marginPct) || 0,
      Number(taxPct) || 0,
    ),
    [lines, marginPct, taxPct],
  );

  const paperModel: BomPaperModel = {
    business: {
      name: business.name || settings.businessName,
      gstin: business.gstin || settings.gstin,
      address: business.address || settings.address,
      state: business.state || settings.state,
      phone: business.phone || settings.phone,
      email: business.email || settings.email,
      logoUrl: business.logoUrl || session.brand?.logoUrl || null,
    },
    docNo: initial?.docNo ?? "Draft",
    docDate,
    status: initial?.status ?? "draft",
    title: title || "Bill of materials",
    capacityLabel,
    customerName,
    location,
    preparedBy,
    notes,
    marginPct: Number(marginPct) || 0,
    taxPct: Number(taxPct) || 0,
    template: settings.bomPaperTemplate,
    lines: lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        section: l.section,
        lineKind: l.lineKind,
        description: l.description,
        makeText: l.makeText ?? null,
        qty: Number(l.qty) || 0,
        unit: l.unit,
        rate: Number(l.rate) || 0,
        amount: Math.round(((Number(l.qty) || 0) * (Number(l.rate) || 0) + Number.EPSILON) * 100) / 100,
        remarks: l.remarks ?? null,
      })),
    totals,
  };

  const updateLine = (key: string, patch: Partial<BomDocLineInput> & { baseQty?: number }) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next: EditorLine = { ...l, ...patch };
        if (patch.qty !== undefined && patch.baseQty === undefined) {
          const q = Number(patch.qty) || 0;
          next.baseQty = next.scaleByCapacity ? inferBaseQty(q, true, capacityLabel) : q;
        }
        if (patch.lineKind === "scaled" && patch.scaleByCapacity === undefined) next.scaleByCapacity = true;
        if (patch.lineKind && patch.lineKind !== "scaled" && patch.scaleByCapacity === undefined && l.lineKind === "scaled") {
          next.scaleByCapacity = false;
        }
        if (patch.scaleByCapacity !== undefined || patch.lineKind === "scaled") {
          next.qty = qtyForCapacity(next.baseQty, Boolean(next.scaleByCapacity), capacityLabel);
        }
        return next;
      }),
    );
  };

  const applyCapacityScale = (nextCapacity: string) => {
    setCapacityLabel(nextCapacity);
    setLines((prev) =>
      prev.map((l) =>
        l.scaleByCapacity ? { ...l, qty: qtyForCapacity(l.baseQty, true, nextCapacity) } : l,
      ),
    );
  };

  const linkItem = (key: string, item: ImsItem) => {
    updateLine(key, {
      itemId: item.id,
      description: item.name,
      unit: item.unit || "nos",
      rate: item.sellingPrice,
      lineKind: "stock",
      makeText: item.brand || undefined,
    });
    setPickFor(null);
  };

  const payload = () => ({
    packageId: initial?.packageId ?? packageId,
    docDate,
    capacityLabel: capacityLabel.trim() || null,
    title: title.trim() || null,
    customerName: customerName.trim(),
    location: location.trim() || null,
    partyId,
    marginPct: Number(marginPct) || 0,
    taxPct: Number(taxPct) || 0,
    notes: notes.trim() || null,
    preparedBy: preparedBy.trim() || null,
    lines: lines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        id: l.id,
        section: l.section.trim() || "Main Items",
        sortNo: i,
        lineKind: l.lineKind,
        itemId: l.itemId ?? null,
        description: l.description.trim(),
        makeText: l.makeText?.trim() || null,
        qty: Number(l.qty) || 0,
        unit: l.unit.trim() || "nos",
        scaleByCapacity: Boolean(l.scaleByCapacity),
        rate: Number(l.rate) || 0,
        remarks: l.remarks?.trim() || null,
      })),
  });

  const save = async () => {
    const ensured = await run(
      "ensure-catalog",
      () => ensureStockLinesForSave(lines.filter((l) => l.description.trim()), { source: "BOM document save", rateKey: "rate" }),
      { refresh: false },
    );
    const synced = ensured?.lines ?? lines.filter((l) => l.description.trim());
    if (ensured?.lines) {
      setLines((prev) =>
        prev.map((l) => {
          const s = synced.find((x) => x.key === l.key);
          return s ? { ...l, ...s, baseQty: l.baseQty } : l;
        }),
      );
    }
    const body = payload();
    body.lines = synced.map((l, i) => ({
      id: l.id,
      section: l.section.trim() || "Main Items",
      sortNo: i,
      lineKind: l.lineKind,
      itemId: l.itemId ?? null,
      description: l.description.trim(),
      makeText: l.makeText?.trim() || null,
      qty: Number(l.qty) || 0,
      unit: l.unit.trim() || "nos",
      scaleByCapacity: Boolean(l.scaleByCapacity),
      rate: Number(l.rate) || 0,
      remarks: l.remarks?.trim() || null,
    }));
    if (!body.lines.length) return;
    const syncNote =
      ensured?.summary && (ensured.summary.created || ensured.summary.matched)
        ? formatCatalogEnsureSummary(ensured.summary)
        : undefined;
    if (initial) {
      const out = await run("save", () => bom.saveDoc(initial.id, body), { success: "BOM saved", description: syncNote });
      if (out?.doc) onSaved(out.doc.id);
    } else {
      const out = await run("create", () => bom.createDoc(body), { success: "BOM created", description: syncNote });
      if (out?.doc) onSaved(out.doc.id);
    }
  };

  return (
    <Stack>
      <PageHeader
        title={initial ? `Edit ${initial.docNo}` : "New BOM"}
        sub="Stock lines sync to Inventory Items on save. Compose left — live preview right."
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button variant="ghost" onClick={print}>
              Print / PDF
            </Button>
            {initial ? (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const cards = await bom.rateCards();
                  const list = cards.rateCards ?? [];
                  if (!list.length) {
                    window.alert("No rate cards yet. Create one under BOM Rate Cards.");
                    return;
                  }
                  const choice = window.prompt(
                    `Apply rate card by number:\n${list.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}`,
                    "1",
                  );
                  const idx = Number(choice) - 1;
                  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return;
                  const card = list[idx]!;
                  const out = await run(
                    "apply-rate",
                    async () => {
                      await bom.saveDoc(initial.id, payload());
                      return bom.applyRateCard(initial.id, card.id);
                    },
                    { success: `Applied ${card.name}` },
                  );
                  if (out?.doc?.lines) {
                    setLines(
                      out.doc.lines.map((l) => ({
                        key: l.id,
                        id: l.id,
                        section: l.section,
                        lineKind: l.lineKind,
                        itemId: l.itemId,
                        description: l.description,
                        makeText: l.makeText ?? "",
                        qty: l.qty,
                        baseQty: inferBaseQty(l.qty, l.scaleByCapacity, capacityLabel),
                        unit: l.unit,
                        rate: l.rate,
                        scaleByCapacity: l.scaleByCapacity,
                        remarks: l.remarks ?? "",
                        serviceSpare: Boolean(l.serviceSpare),
                        alternateItemIds: l.alternateItemIds ?? [],
                        optionalFlag: Boolean(l.optionalFlag),
                        optionKey: l.optionKey ?? "",
                      })),
                    );
                  }
                }}
              >
                Apply rate card
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                const out = await run("sync-inventory", async () => {
                  const { packages: next, summary } = await ensureBomPackageCatalog(
                    [
                      {
                        name: "doc",
                        lines: lines.map(({ key: _k, rate, ...rest }) => ({
                          ...rest,
                          defaultRate: rate,
                        })),
                      },
                    ],
                    { source: "BOM document sync" },
                  );
                  const linked = next[0]?.lines ?? [];
                  setLines((prev) =>
                    prev.map((l, i) => {
                      const m = linked[i];
                      if (!m?.itemId) return l;
                      return {
                        ...l,
                        itemId: m.itemId,
                        unit: m.unit || l.unit,
                        rate: l.rate || m.defaultRate || 0,
                        makeText: l.makeText || m.makeText || "",
                      };
                    }),
                  );
                  return summary;
                });
                if (out) {
                  await run(
                    "sync-summary",
                    async () => true,
                    {
                      success: "Inventory sync finished",
                      description: formatCatalogEnsureSummary(out),
                      tone: out.ambiguous || out.unmatched ? "amber" : "emerald",
                      refresh: false,
                    },
                  );
                }
              }}
            >
              Sync inventory
            </Button>
            <Button onClick={() => void save()} disabled={Boolean(busy) || !lines.some((l) => l.description.trim())}>
              Save
            </Button>
          </>
        }
      />

      <BomSplitLayout
        compose={
          <>
          {seeded && !seeded.active ? (
            <Alert tone="amber" title="Inactive package template">
              This package is inactive. You can still compose the BOM, but saving from it may be rejected — reactivate the package or copy lines into a blank BOM.
            </Alert>
          ) : null}

          <Card>
            <FormGrid>
              <Field label="Customer">
                {({ id }) => (
                  <PartySelect
                    id={id}
                    kind="customer"
                    value={{ id: partyId, name: customerName }}
                    onChange={(v) => {
                      setPartyId(v.id);
                      setCustomerName(v.name);
                      if (v.party?.city && !location.trim()) setLocation(v.party.city);
                    }}
                  />
                )}
              </Field>
              <Field label="Location / site">
                {({ id }) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site / city / plant" />}
              </Field>
              <Field label="Title">
                {({ id }) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Package title" />}
              </Field>
              <Field label="Capacity / size" hint="Lines marked “Scale with capacity” multiply by the first number (e.g. 3KW → ×3).">
                {({ id }) => (
                  <Input
                    id={id}
                    value={capacityLabel}
                    onChange={(e) => applyCapacityScale(e.target.value)}
                    placeholder="e.g. 3KW / Size S"
                  />
                )}
              </Field>
              <Field label="Date">
                {({ id }) => <Input id={id} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
              </Field>
              <Field label="Prepared by">
                {({ id }) => <Input id={id} value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />}
              </Field>
              <Field label="Margin %">
                {({ id }) => <Input id={id} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} inputMode="decimal" />}
              </Field>
              <Field label="Tax %">
                {({ id }) => <Input id={id} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" />}
              </Field>
            </FormGrid>
            <div style={{ marginTop: 12 }}>
              <Field label="Notes" full>
                {({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </div>
          </Card>

          {sections.map((section) => (
            <Card key={section}>
              <div className="ims-bom-section-bar">
                <span>{section}</span>
                <Button size="sm" variant="ghost" onClick={() => setLines((prev) => [...prev, blankLine(section)])}>
                  Add line
                </Button>
              </div>
              <div className="ims-bom-line-editor" style={{ marginTop: 10 }}>
                {lines
                  .filter((l) => l.section === section)
                  .map((l) => (
                    <div key={l.key}>
                      <div className="ims-bom-line-row">
                        <span style={{ opacity: 0.5, paddingTop: 8 }}>•</span>
                        <Input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} placeholder="Description" />
                        <Input value={l.makeText ?? ""} onChange={(e) => updateLine(l.key, { makeText: e.target.value })} placeholder="Make / brand" />
                        <Input value={String(l.qty)} onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) || 0 })} placeholder="Qty" />
                        <Input value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value })} placeholder="Unit" />
                        <Select value={l.lineKind} onChange={(e) => updateLine(l.key, { lineKind: e.target.value as BomLineKind })}>
                          {BOM_LINE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {BOM_LINE_KIND_LABEL[k]}
                            </option>
                          ))}
                        </Select>
                        <Input value={String(l.rate ?? 0)} onChange={(e) => updateLine(l.key, { rate: Number(e.target.value) || 0 })} placeholder="Rate" />
                        <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove">
                          ×
                        </Button>
                      </div>
                      <div className="ims-bom-line-meta">
                        <Button size="sm" variant="ghost" onClick={() => setPickFor(l.key)}>
                          {l.itemId ? "Change item" : "Pick inventory item"}
                        </Button>
                        {l.itemId ? (
                          <Button size="sm" variant="ghost" onClick={() => updateLine(l.key, { itemId: null })}>
                            Unlink
                          </Button>
                        ) : null}
                        {l.itemId ? (
                          <Badge tone="emerald">In inventory</Badge>
                        ) : l.lineKind === "stock" && l.description.trim() ? (
                          <Badge tone="amber">Will sync on save</Badge>
                        ) : null}
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(l.scaleByCapacity)}
                            onChange={(e) => updateLine(l.key, { scaleByCapacity: e.target.checked })}
                          />
                          Scale with capacity
                        </label>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const next = window.prompt("New section name", "Extras");
                if (next?.trim()) setLines((prev) => [...prev, blankLine(next.trim())]);
              }}
            >
              Add section
            </Button>
          </div>
          </>
        }
        preview={<BomPaper model={paperModel} />}
      />

      <ItemPickerDialog
        open={Boolean(pickFor)}
        onClose={() => setPickFor(null)}
        title="Link inventory item"
        allowCreate
        createHint={pickFor ? lines.find((l) => l.key === pickFor)?.description : undefined}
        onPick={(item) => {
          if (pickFor) linkItem(pickFor, item);
        }}
      />
    </Stack>
  );
}
