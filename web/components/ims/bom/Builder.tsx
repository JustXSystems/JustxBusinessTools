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
  BOM_PROPOSAL_STATUS_LABEL,
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
import { inr, inrExact, stampLabel } from "@/lib/ims/format";
import { formatCatalogEnsureSummary, exportBomExcel } from "@/lib/ims/bom-excel";
import { ensureBomPackageCatalog, ensureStockLinesForSave } from "@/lib/ims/ensure-catalog";
import { canRevokeBomProposal, proposalShareButtonLabel, shareBomProposal } from "@/lib/ims/bom-proposal-share";
import { purchase } from "@/lib/ims/purchase";
import { withBasePath } from "@/lib/base-path";
import { ErrorBlock, LoadingBlock, PageHeader, RequirePerm, Stack, useIms, useImsAction, useImsData, useOpenIntent, usePrint } from "../core";
import { ItemPickerDialog, PartySelect } from "../shared/pickers";
import {
  BOM_COLUMN_LABEL,
  BOM_INDUSTRY_PACK_META,
  BOM_PAPER_DENSITIES,
  BOM_PAPER_PURPOSE_META,
  bomIndustryPackMeta,
  normalizeBomIndustryPack,
  normalizeBomPaperDensity,
  normalizeBomPaperPurpose,
  scheduleColumnsFor,
  type BomIndustryPackId,
  type BomPaperDensity,
  type BomPaperPurpose,
} from "@/lib/ims/bom-paper";
import { BomPaper, mergePaperOptions, modelFromDoc, type BomPaperModel } from "./BomPaper";
import { BomActivityStrip, BomList, canDeleteBomDoc } from "./BomList";
import { BomSplitLayout } from "./BomSplitLayout";
import { DeliveryChallanPanel, DeliveryChallanWorkspace, type DcWorkspace } from "./DeliveryChallanPanel";

type View =
  | { mode: "list" }
  | { mode: "edit"; id: string | null; packageId?: string | null }
  | { mode: "view"; id: string };

type EditorLine = BomDocLineInput & { key: string; baseQty: number; issuedQty?: number };

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
  optionalFlag: false,
  optionKey: "",
  alternateItemIds: [],
  issuedQty: 0,
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
          onDuplicated={(id) => setView({ mode: "edit", id })}
        />
      ) : (
        <BomList
          onNew={(packageId) => setView({ mode: "edit", id: null, packageId })}
          onOpen={(id) => setView({ mode: "view", id })}
          onEdit={(id) => setView({ mode: "edit", id })}
        />
      )}
    </RequirePerm>
  );
}

function BomViewer({
  id,
  onBack,
  onEdit,
  onDuplicated,
}: {
  id: string;
  onBack: () => void;
  onEdit: () => void;
  onDuplicated: (id: string) => void;
}) {
  const { can, navigate, session } = useIms();
  const isOwner = session.access.role === "owner";
  const canConfirm = isOwner || can("approvals") || !session.settings.bomConfirmNeedsApproval;
  const { run, busy } = useImsAction();
  const print = usePrint();
  const state = useImsData(() => bom.doc(id), [id]);
  const availability = useImsData(() => bom.availability(id), [id, state.data?.doc?.stockIssuedAt, state.data?.doc?.updatedAt]);
  const [convertMode, setConvertMode] = useState<BomInvoiceConvertMode>("lump_sum");
  const [issueOnCreate, setIssueOnCreate] = useState(false);
  const [linkDcIds, setLinkDcIds] = useState<string[]>([]);
  const [customerState, setCustomerState] = useState<string | null>(null);
  const [dcWorkspace, setDcWorkspace] = useState<DcWorkspace | null>(null);
  const doc = state.data?.doc;
  const canApproveDc = isOwner || can("approvals");
  const stockViaDc = linkDcIds.length > 0;
  const partyId = doc?.partyId ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!partyId) {
      setCustomerState(null);
      return;
    }
    purchase
      .party(partyId)
      .then((detail) => {
        if (!cancelled) setCustomerState(detail.party?.state ?? null);
      })
      .catch(() => {
        if (!cancelled) setCustomerState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);
  const stockShortfalls = useMemo(
    () => (availability.data?.items ?? []).filter((i) => i.shortfall > 0),
    [availability.data],
  );
  const allowNegative = Boolean(availability.data?.allowNegativeStock);
  const blockOnShortfall = stockShortfalls.length > 0 && !allowNegative;
  if (!state.data && !state.error) return <LoadingBlock />;
  if (state.error || !state.data || !doc) return <ErrorBlock error={state.error ?? new Error("Not found")} onRetry={state.reload} />;

  const business = {
    ...state.data.business,
    logoUrl: state.data.business.logoUrl || session.brand?.logoUrl || null,
  };
  const paperOpts = mergePaperOptions(
    {
      template: session.settings.bomPaperTemplate,
      industryPack: session.settings.bomIndustryPack ?? "general",
      tone: session.settings.bomPaperTone ?? "neutral",
      density: session.settings.bomPaperDensity ?? "comfort",
      hideMargin: session.settings.bomHideMargin ?? false,
      scheduleColumns: session.settings.bomScheduleColumns ?? null,
    },
    doc.paper,
  );
  const model = modelFromDoc(doc, business, { ...paperOpts, customerState });
  const confirmed = doc.status === "confirmed";
  const reloadAll = () => {
    state.reload();
    availability.reload();
  };

  return (
    <Stack>
      <PageHeader
        title={doc.docNo}
        sub={`${doc.customerName || "No customer"} · ${BOM_DOC_STATUS_LABEL[doc.status]}${dcWorkspace ? " · Delivery challan" : ""}`}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                if (dcWorkspace) setDcWorkspace(null);
                else onBack();
              }}
            >
              {dcWorkspace ? "Back to BOM" : "Back"}
            </Button>
            <Button variant="ghost" onClick={print}>
              Print / PDF
            </Button>
            {!dcWorkspace ? (
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                const out = await run("dup", () => bom.duplicateDoc(doc.id), { success: `Copied ${doc.docNo}` });
                if (out?.doc) onDuplicated(out.doc.id);
              }}
            >
              Duplicate
            </Button>
            ) : null}
            {!dcWorkspace && doc.status === "draft" ? (
              <>
                <Button variant="ghost" onClick={onEdit}>
                  Edit
                </Button>
                {canConfirm ? (
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
                ) : (
                  <Button variant="ghost" disabled title="Needs Approvals permission">
                    Confirm locked
                  </Button>
                )}
              </>
            ) : null}
            {!dcWorkspace ? (
              <>
                {canDeleteBomDoc(doc, isOwner) ? (
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy)}
                    title={doc.status === "draft" ? "Delete draft" : "Delete (owner)"}
                    onClick={async () => {
                      const kind = doc.status === "draft" ? "draft" : doc.status;
                      if (!window.confirm(`Delete ${kind} ${doc.docNo}? This cannot be undone.`)) return;
                      const out = await run(
                        "delete",
                        async () => {
                          await bom.deleteDoc(doc.id);
                          return true;
                        },
                        { success: `${doc.docNo} deleted` },
                      );
                      if (out) onBack();
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
                <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void exportBomExcel(doc, business)}>
                  Export Excel
                </Button>
                {confirmed ? (
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      try {
                        const shared = await shareBomProposal(doc, async (id, body) => {
                          const out = await run("proposal", () => bom.createProposal(id, body), {
                            success: body?.renew ? "New proposal round ready" : "Proposal link ready",
                            refresh: false,
                          });
                          if (!out) throw new Error("Could not prepare proposal link");
                          return out;
                        });
                        if (!shared) return;
                        window.prompt(
                          shared.reused
                            ? "Existing proposal link (prior status kept):"
                            : shared.renewed
                              ? "New decision-round link:"
                              : "Share this proposal link:",
                          shared.url,
                        );
                        try {
                          await navigator.clipboard.writeText(shared.url);
                        } catch {
                          /* ignore */
                        }
                        if (window.confirm("Open WhatsApp share?")) window.open(shared.whatsappUrl, "_blank", "noopener,noreferrer");
                        reloadAll();
                      } catch {
                        /* run() already toasted API errors */
                      }
                    }}
                  >
                    {proposalShareButtonLabel(doc.proposalStatus)}
                  </Button>
                ) : null}
                {confirmed && canRevokeBomProposal(doc.proposalStatus) ? (
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      if (!window.confirm("Revoke the customer share link? They will no longer be able to open or respond.")) return;
                      const out = await run("proposal-revoke", () => bom.revokeProposal(doc.id), { success: "Proposal link revoked" });
                      if (out) reloadAll();
                    }}
                  >
                    Revoke link
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
            ) : null}
          </>
        }
      />

      {dcWorkspace && doc ? (
        <DeliveryChallanWorkspace
          doc={doc}
          workspace={dcWorkspace}
          busy={busy}
          run={run}
          canApprove={canApproveDc}
          selectedDcIds={linkDcIds}
          onToggleDc={(dcId) =>
            setLinkDcIds((prev) => (prev.includes(dcId) ? prev.filter((x) => x !== dcId) : [...prev, dcId]))
          }
          onBack={() => setDcWorkspace(null)}
          onClose={() => {
            setDcWorkspace(null);
            reloadAll();
          }}
          onCreated={(dcId) => {
            setDcWorkspace({ kind: "manage", dcId });
            reloadAll();
          }}
          onRefresh={reloadAll}
        />
      ) : (
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
                            disabled={Boolean(!stockViaDc && doc.stockIssuedAt && convertMode === "explode_lines")}
                          >
                            <option value="draft">Save as draft invoice</option>
                            <option
                              value="issue"
                              disabled={Boolean(!stockViaDc && doc.stockIssuedAt && convertMode === "explode_lines")}
                            >
                              {stockViaDc
                                ? "Create and issue (stock already on linked DCs)"
                                : "Create and issue (posts stock for linked lines)"}
                            </option>
                          </Select>
                        )}
                      </Field>
                    </div>
                    {linkDcIds.length ? (
                      <Alert tone="blue" title={`${linkDcIds.length} delivery challan(s) selected`}>
                        Invoice will reference these DCs. Stock out stays on DC approve — invoice issue will not post stock again. Tick DCs under Delivery challans below.
                      </Alert>
                    ) : null}
                    {!stockViaDc && doc.stockIssuedAt && convertMode === "explode_lines" ? (
                      <Alert tone="amber" title="Stock already issued">
                        Explode + issue is blocked unless you link approved delivery challans. Create a draft explode invoice, switch to lump-sum, or tick DCs below.
                      </Alert>
                    ) : null}
                    {issueOnCreate && convertMode === "explode_lines" && !stockViaDc && !can("stockOut") ? (
                      <Alert tone="amber" title="Stock-out permission needed">
                        Issuing an explode invoice without DC links posts stock. Ask an owner for Stock out, save as draft, or link approved DCs.
                      </Alert>
                    ) : null}
                    {issueOnCreate && convertMode === "explode_lines" && !stockViaDc && stockShortfalls.length ? (
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
                          (issueOnCreate && convertMode === "explode_lines" && !stockViaDc && Boolean(doc.stockIssuedAt)) ||
                          (issueOnCreate && convertMode === "explode_lines" && !stockViaDc && !can("stockOut")) ||
                          (issueOnCreate && convertMode === "explode_lines" && !stockViaDc && blockOnShortfall)
                        }
                        onClick={async () => {
                          const out = await run(
                            "invoice",
                            () =>
                              bom.createInvoice(doc.id, {
                                mode: convertMode,
                                issue: issueOnCreate,
                                dcIds: linkDcIds.length ? linkDcIds : undefined,
                              }),
                            { success: issueOnCreate ? "Invoice issued from BOM" : "Draft invoice created" },
                          );
                          if (out?.invoice?.invoice?.id) {
                            setLinkDcIds([]);
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

              <DeliveryChallanPanel
                doc={doc}
                busy={Boolean(busy)}
                onDone={reloadAll}
                run={run}
                canApprove={canApproveDc}
                selectedDcIds={linkDcIds}
                onToggleDc={(dcId) =>
                  setLinkDcIds((prev) => (prev.includes(dcId) ? prev.filter((x) => x !== dcId) : [...prev, dcId]))
                }
                onOpenWorkspace={setDcWorkspace}
              />

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
      )}
      {confirmed && doc.proposalStatus ? (
        <Card interactive={false} className="ims-bom-proposal-status">
          <div className="ims-bom-proposal-status-head">
            <Badge
              tone={
                doc.proposalStatus === "accepted"
                  ? "emerald"
                  : doc.proposalStatus === "rejected" || doc.proposalStatus === "revoked"
                    ? "coral"
                    : "amber"
              }
            >
              {BOM_PROPOSAL_STATUS_LABEL[doc.proposalStatus] ?? doc.proposalStatus}
            </Badge>
            <strong>Customer proposal</strong>
          </div>
          <p className="ims-faint" style={{ margin: "6px 0 0" }}>
            {doc.proposalStatus === "sent"
              ? "Link shared — waiting for the customer to open it."
              : doc.proposalStatus === "viewed"
                ? "Customer opened the link — waiting for accept or reject."
                : doc.proposalStatus === "accepted"
                  ? "Customer accepted this materials proposal."
                  : doc.proposalStatus === "rejected"
                    ? "Customer rejected this materials proposal."
                    : "Share link was revoked."}
          </p>
          <dl className="ims-bom-proposal-status-meta">
            {doc.proposalSentAt ? (
              <>
                <dt>Sent</dt>
                <dd>{stampLabel(doc.proposalSentAt)}</dd>
              </>
            ) : null}
            {doc.proposalRespondedAt ? (
              <>
                <dt>Responded</dt>
                <dd>{stampLabel(doc.proposalRespondedAt)}</dd>
              </>
            ) : null}
            {doc.proposalResponseNote ? (
              <>
                <dt>Note</dt>
                <dd>{doc.proposalResponseNote}</dd>
              </>
            ) : null}
          </dl>
          {doc.proposalToken && doc.proposalStatus && doc.proposalStatus !== "revoked" ? (
            <div className="ims-toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const path = withBasePath(`/bom/proposal/${doc.proposalToken}`);
                  const url = `${window.location.origin}${path}`;
                  window.prompt(
                    doc.proposalStatus === "accepted" || doc.proposalStatus === "rejected"
                      ? "Existing proposal link (decision already recorded):"
                      : "Customer proposal link:",
                    url,
                  );
                  try {
                    await navigator.clipboard.writeText(url);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Copy link
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      <BomActivityStrip docId={doc.id} />
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
  const [customerPreview, setCustomerPreview] = useState(
    initial?.paper?.hideMargin ?? Boolean(settings.bomHideMargin),
  );
  const [docPurpose, setDocPurpose] = useState<BomPaperPurpose>(
    normalizeBomPaperPurpose(initial?.paper?.purpose ?? settings.bomPaperTemplate),
  );
  const [docPack, setDocPack] = useState<BomIndustryPackId>(
    normalizeBomIndustryPack(initial?.paper?.industryPack ?? settings.bomIndustryPack),
  );
  const [docDensity, setDocDensity] = useState<BomPaperDensity>(
    normalizeBomPaperDensity(initial?.paper?.density ?? settings.bomPaperDensity),
  );

  const seeded = fromPackage;
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [title, setTitle] = useState(initial?.title ?? seeded?.name ?? "");
  const [capacityLabel, setCapacityLabel] = useState(initial?.capacityLabel ?? seeded?.capacityLabel ?? "");
  const [docDate, setDocDate] = useState(initial?.docDate ?? session.today);
  const [marginPct, setMarginPct] = useState(String(initial?.marginPct ?? seeded?.defaultMarginPct ?? 0));
  const [taxPct, setTaxPct] = useState(String(initial?.taxPct ?? seeded?.defaultTaxPct ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [scopeOfSupply, setScopeOfSupply] = useState(initial?.scopeOfSupply ?? "");
  const [exclusions, setExclusions] = useState(initial?.exclusions ?? "");
  const [preparedBy, setPreparedBy] = useState(initial?.preparedBy ?? session.actor.name ?? "");
  const [projectRef, setProjectRef] = useState(initial?.projectRef ?? "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? "");
  const [deliveryTerms, setDeliveryTerms] = useState(initial?.deliveryTerms ?? "");
  const [warrantyTerms, setWarrantyTerms] = useState(initial?.warrantyTerms ?? "");
  const [partyId, setPartyId] = useState<string | null>(initial?.partyId ?? null);
  const [customerState, setCustomerState] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    if (!initial?.partyId) return;
    purchase
      .party(initial.partyId)
      .then((detail) => {
        if (!cancelled && detail.party?.state) setCustomerState(detail.party.state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initial?.partyId]);
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
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey ?? "",
        alternateItemIds: l.alternateItemIds ?? [],
        issuedQty: Number(l.issuedQty) || 0,
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
          optionalFlag: Boolean(l.optionalFlag),
          optionKey: l.optionKey ?? "",
          alternateItemIds: l.alternateItemIds ?? [],
        }));
    }
    const packSections = bomIndustryPackMeta(
      normalizeBomIndustryPack(initial?.paper?.industryPack ?? settings.bomIndustryPack),
    ).defaultSections;
    return packSections.map((section) => blankLine(section));
  });

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const l of lines) if (!names.includes(l.section)) names.push(l.section);
    return names.length ? names : [...bomIndustryPackMeta(docPack).defaultSections];
  }, [lines, docPack]);

  /** When pack changes and the sheet is still empty placeholders, rebuild section shells. */
  useEffect(() => {
    if (initial?.lines?.length || seeded?.lines?.length) return;
    setLines((prev) => {
      const allBlank = prev.every((l) => !l.description.trim() && !l.itemId);
      if (!allBlank) return prev;
      const wanted = [...bomIndustryPackMeta(docPack).defaultSections];
      const current: string[] = [];
      for (const l of prev) if (!current.includes(l.section)) current.push(l.section);
      if (wanted.length === current.length && wanted.every((s, i) => s === current[i])) return prev;
      return wanted.map((section) => blankLine(section));
    });
  }, [docPack, initial?.lines?.length, seeded?.lines?.length]);

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
      accent: business.accent ?? null,
      bankName: business.bankName ?? null,
      bankBranch: business.bankBranch ?? null,
      bankAccount: business.bankAccount ?? null,
      bankIfsc: business.bankIfsc ?? null,
      bankUpi: business.bankUpi ?? null,
    },
    docNo: initial?.docNo ?? "Draft",
    docDate,
    status: initial?.status ?? "draft",
    title: title || "Materials proposal",
    capacityLabel,
    customerName,
    location,
    customerState: customerState || null,
    projectRef,
    preparedBy,
    notes,
    revision: initial?.revision ?? 1,
    validUntil: validUntil || null,
    paymentTerms: paymentTerms || null,
    deliveryTerms: deliveryTerms || null,
    warrantyTerms: warrantyTerms || null,
    scopeOfSupply: scopeOfSupply || null,
    exclusions: exclusions || null,
    marginPct: Number(marginPct) || 0,
    taxPct: Number(taxPct) || 0,
    template: docPurpose,
    industryPack: docPack,
    tone: settings.bomPaperTone ?? "neutral",
    density: docDensity,
    hideMargin: customerPreview,
    scheduleColumns: settings.bomScheduleColumns ?? null,
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
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey ?? null,
        alternateCount: Array.isArray(l.alternateItemIds) ? l.alternateItemIds.length : 0,
        issuedQty: Number(l.issuedQty) || 0,
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
    projectRef: projectRef.trim() || null,
    partyId,
    marginPct: Number(marginPct) || 0,
    taxPct: Number(taxPct) || 0,
    notes: notes.trim() || null,
    preparedBy: preparedBy.trim() || null,
    validUntil: validUntil.trim() || null,
    paymentTerms: paymentTerms.trim() || null,
    deliveryTerms: deliveryTerms.trim() || null,
    warrantyTerms: warrantyTerms.trim() || null,
    scopeOfSupply: scopeOfSupply.trim() || null,
    exclusions: exclusions.trim() || null,
    paper: {
      purpose: docPurpose,
      industryPack: docPack,
      density: docDensity,
      hideMargin: customerPreview,
    },
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
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey?.trim() || null,
        alternateItemIds: Array.isArray(l.alternateItemIds) ? l.alternateItemIds : [],
        issuedQty: Number(l.issuedQty) || 0,
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
          return s ? { ...l, ...s, baseQty: l.baseQty, issuedQty: l.issuedQty } : l;
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
      optionalFlag: Boolean(l.optionalFlag),
      optionKey: l.optionKey?.trim() || null,
      alternateItemIds: Array.isArray(l.alternateItemIds) ? l.alternateItemIds : [],
      issuedQty: Number(l.issuedQty) || 0,
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
                    window.alert("No rate cards yet. Create one under Rate Cards.");
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
                      if (v.party?.state) setCustomerState(v.party.state);
                      else if (!v.id) setCustomerState("");
                    }}
                  />
                )}
              </Field>
              <Field label="Location / site" hint="Site or city — not used for GST place of supply">
                {({ id }) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site / city / plant" />}
              </Field>
              <Field label="Customer state (GST)" hint="Billing state for CGST/SGST vs IGST">
                {({ id }) => (
                  <Input
                    id={id}
                    value={customerState}
                    onChange={(e) => setCustomerState(e.target.value)}
                    placeholder="e.g. Karnataka"
                  />
                )}
              </Field>
              <Field label="Title">
                {({ id }) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Package title" />}
              </Field>
              <Field
                label={bomIndustryPackMeta(docPack).sizeLabel}
                hint={`Schedule columns: ${scheduleColumnsFor(docPurpose, docPack, settings.bomScheduleColumns)
                  .filter((c) => c !== "check" && c !== "index")
                  .map((c) => BOM_COLUMN_LABEL[c])
                  .join(" · ")}. Scale-marked lines multiply by the first number in this field.`}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    value={capacityLabel}
                    onChange={(e) => applyCapacityScale(e.target.value)}
                    placeholder={docPack === "solar" ? "e.g. 3KW 1PH" : "e.g. Standard / Size S"}
                  />
                )}
              </Field>
              <Field label="Date">
                {({ id }) => <Input id={id} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
              </Field>
              <Field label="Prepared by">
                {({ id }) => <Input id={id} value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />}
              </Field>
              <Field label="Project ref">
                {({ id }) => <Input id={id} value={projectRef} onChange={(e) => setProjectRef(e.target.value)} placeholder="Site / job / PO ref" />}
              </Field>
              <Field label="Valid until">
                {({ id }) => <Input id={id} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
              </Field>
              <Field label="Margin %">
                {({ id }) => <Input id={id} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} inputMode="decimal" />}
              </Field>
              <Field label="Tax %">
                {({ id }) => <Input id={id} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" />}
              </Field>
              <Field label="Payment terms">
                {({ id }) => <Input id={id} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. 40% advance · 60% delivery" />}
              </Field>
              <Field label="Delivery terms">
                {({ id }) => <Input id={id} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} placeholder="e.g. 7–10 working days" />}
              </Field>
              <Field label="Warranty terms">
                {({ id }) => <Input id={id} value={warrantyTerms} onChange={(e) => setWarrantyTerms(e.target.value)} placeholder="OEM + workmanship" />}
              </Field>
              <Field label="Paper purpose" hint="Overrides tenant default for this BOM">
                {({ id }) => (
                  <Select id={id} value={docPurpose} onChange={(e) => setDocPurpose(normalizeBomPaperPurpose(e.target.value))}>
                    {BOM_PAPER_PURPOSE_META.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Industry pack">
                {({ id }) => (
                  <Select id={id} value={docPack} onChange={(e) => setDocPack(normalizeBomIndustryPack(e.target.value))}>
                    {BOM_INDUSTRY_PACK_META.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Print density">
                {({ id }) => (
                  <Select id={id} value={docDensity} onChange={(e) => setDocDensity(normalizeBomPaperDensity(e.target.value))}>
                    {BOM_PAPER_DENSITIES.map((d) => (
                      <option key={d} value={d}>
                        {d[0]!.toUpperCase() + d.slice(1)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <Field label="Scope of supply" full>
                {({ id }) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={scopeOfSupply}
                    onChange={(e) => setScopeOfSupply(e.target.value)}
                    placeholder="What is included in this proposal"
                  />
                )}
              </Field>
              <Field label="Exclusions" full>
                {({ id }) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={exclusions}
                    onChange={(e) => setExclusions(e.target.value)}
                    placeholder="What is not included"
                  />
                )}
              </Field>
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
                          Scale with {bomIndustryPackMeta(docPack).sizeLabel.toLowerCase()}
                        </label>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(l.optionalFlag)}
                            onChange={(e) => updateLine(l.key, { optionalFlag: e.target.checked })}
                          />
                          Optional
                        </label>
                        <Input
                          value={l.optionKey ?? ""}
                          onChange={(e) => updateLine(l.key, { optionKey: e.target.value })}
                          placeholder="Option key"
                          style={{ maxWidth: 110 }}
                        />
                        <Input
                          value={l.remarks ?? ""}
                          onChange={(e) => updateLine(l.key, { remarks: e.target.value })}
                          placeholder="Remarks"
                          style={{ maxWidth: 180 }}
                        />
                        {Array.isArray(l.alternateItemIds) && l.alternateItemIds.length > 0 ? (
                          <Badge tone="neutral">{l.alternateItemIds.length} alt{l.alternateItemIds.length === 1 ? "" : "s"}</Badge>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const wanted = [...bomIndustryPackMeta(docPack).defaultSections];
                const missing = wanted.filter((s) => !sections.includes(s));
                if (!missing.length) return;
                setLines((prev) => [...prev, ...missing.map((section) => blankLine(section))]);
              }}
            >
              Add pack sections
            </Button>
          </div>
          </>
        }
        preview={
          <div className="ims-bom-preview-wrap">
            <div className="ims-bom-preview-toolbar" role="group" aria-label="Preview mode">
              <FilterChip active={!customerPreview} onClick={() => setCustomerPreview(false)}>
                Internal cost
              </FilterChip>
              <FilterChip active={customerPreview} onClick={() => setCustomerPreview(true)}>
                Customer PDF
              </FilterChip>
            </div>
            <BomPaper model={paperModel} />
          </div>
        }
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
